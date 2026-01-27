/**
 * SpeechmaticsMessageProcessor - Traitement des messages utilisateur et generation de reponses
 *
 * Ce module extrait la logique de traitement des messages de SpeechmaticsVoiceAgent :
 * - processUserMessage: traite un message utilisateur final et genere une reponse LLM
 * - Gere la queue de messages en attente
 * - Gere l'abort-on-continue et la deduplication
 *
 * Pattern: Uses dependency injection via MessageProcessorDeps interface
 */

import * as Sentry from '@sentry/nextjs';
import { devLog, devWarn, devError } from '@/lib/utils';
import { cleanTextForTTS } from '@/lib/sanitize';
import { SpeechmaticsLLM } from './speechmatics-llm';
import type { ElevenLabsTTS } from './elevenlabs';
import type { SpeechmaticsStateMachine } from './speechmatics-state-machine';
import type { SpeechmaticsAudio } from './speechmatics-audio';
import type {
  SpeechmaticsConfig,
  SpeechmaticsMessageCallback,
  SpeechmaticsErrorCallback,
  SpeechmaticsAudioCallback,
} from './speechmatics-types';
import {
  QUEUED_MESSAGE_RETRY_DELAY_MS,
  RECENT_HISTORY_COUNT,
  MIN_RESPONSE_INTERVAL_MS,
  MAX_RAPID_RESPONSES,
  RAPID_RESPONSE_WINDOW_MS,
  CIRCUIT_BREAKER_COOLDOWN_MS,
} from './speechmatics-constants';
import { normalizeForEchoDetection } from './speechmatics-echo-detection';

// =============================================================================
// Loop Detection State (Anti-Echo Protection)
// =============================================================================

/** Timestamps of recent AI responses for loop detection */
const recentResponseTimestamps: number[] = [];

/** Last time the circuit breaker was triggered */
let circuitBreakerTriggeredAt: number = 0;


// =============================================================================
// Duplicate AI Response Prevention (BUG-044)
// =============================================================================

/** Track recent AI responses to prevent duplicates from race conditions */
interface RecentAIResponse {
  content: string;
  normalizedContent: string;
  timestamp: number;
}

const recentAIResponses: RecentAIResponse[] = [];
const MAX_RECENT_RESPONSES = 3;
const DUPLICATE_WINDOW_MS = 10000; // 10 second window for duplicate detection

/**
 * Check if an AI response is a duplicate of a recent one
 * Returns true if this response should be skipped
 */
function isDuplicateAIResponse(content: string): boolean {
  const now = Date.now();
  const normalizedContent = normalizeForEchoDetection(content);

  // Clean old entries
  while (recentAIResponses.length > 0 && now - recentAIResponses[0].timestamp > DUPLICATE_WINDOW_MS) {
    recentAIResponses.shift();
  }

  // Check for duplicates
  for (const recent of recentAIResponses) {
    // Check exact match
    if (recent.normalizedContent === normalizedContent) {
      devLog('[Speechmatics] 🔄 DUPLICATE AI response detected (exact match) - skipping');
      return true;
    }

    // Check high similarity (>90% word overlap)
    const newWords = normalizedContent.split(/\s+/).filter(w => w.length > 2);
    const recentWords = new Set(recent.normalizedContent.split(/\s+/).filter(w => w.length > 2));

    if (newWords.length > 0 && recentWords.size > 0) {
      let matchedWords = 0;
      for (const word of newWords) {
        if (recentWords.has(word)) {
          matchedWords++;
        }
      }
      const similarity = matchedWords / Math.max(newWords.length, recentWords.size);

      if (similarity > 0.9) {
        devLog('[Speechmatics] 🔄 DUPLICATE AI response detected (similarity:', (similarity * 100).toFixed(0) + '%) - skipping');
        return true;
      }
    }
  }

  return false;
}

/**
 * Record an AI response as processed
 */
function recordAIResponse(content: string): void {
  const now = Date.now();
  const normalizedContent = normalizeForEchoDetection(content);

  // Clean old entries to keep only MAX_RECENT_RESPONSES
  while (recentAIResponses.length >= MAX_RECENT_RESPONSES) {
    recentAIResponses.shift();
  }

  recentAIResponses.push({
    content,
    normalizedContent,
    timestamp: now,
  });
}

/**
 * Check if responses are happening too rapidly (potential loop)
 * Returns true if circuit breaker should activate
 */
function checkRapidResponseRate(): boolean {
  const now = Date.now();

  // Clean old timestamps
  while (recentResponseTimestamps.length > 0 &&
         now - recentResponseTimestamps[0] > RAPID_RESPONSE_WINDOW_MS) {
    recentResponseTimestamps.shift();
  }

  // Check if we're in cooldown
  if (circuitBreakerTriggeredAt > 0 && now - circuitBreakerTriggeredAt < CIRCUIT_BREAKER_COOLDOWN_MS) {
    devWarn('[Speechmatics] 🔴 Circuit breaker active - blocking response');
    return true;
  }

  // Check if we had a response too recently
  if (recentResponseTimestamps.length > 0) {
    const lastResponse = recentResponseTimestamps[recentResponseTimestamps.length - 1];
    if (now - lastResponse < MIN_RESPONSE_INTERVAL_MS) {
      devWarn('[Speechmatics] ⚠️ Response too soon after previous one:', now - lastResponse, 'ms');
    }
  }

  // Check for rapid response pattern
  if (recentResponseTimestamps.length >= MAX_RAPID_RESPONSES) {
    devError('[Speechmatics] 🔴 LOOP DETECTED - Too many rapid responses:', recentResponseTimestamps.length, 'in', RAPID_RESPONSE_WINDOW_MS / 1000, 's');
    circuitBreakerTriggeredAt = now;
    return true;
  }

  return false;
}

/**
 * Record that a response was generated
 */
function recordResponseTimestamp(): void {
  recentResponseTimestamps.push(Date.now());
}

/**
 * Reset loop detection state (call on disconnect/reconnect)
 */
export function resetLoopDetectionState(): void {
  recentResponseTimestamps.length = 0;
  circuitBreakerTriggeredAt = 0;
  // BUG-044: Also reset duplicate AI response tracking
  recentAIResponses.length = 0;
  devLog('[Speechmatics] Loop detection state reset');
}

/**
 * Dependencies required by SpeechmaticsMessageProcessor
 */
export interface MessageProcessorDeps {
  // Module getters
  getConfig: () => SpeechmaticsConfig | null;
  getAudio: () => SpeechmaticsAudio | null;
  getTTS: () => ElevenLabsTTS | null;

  // State machine
  stateMachine: SpeechmaticsStateMachine;

  // LLM instance (shared)
  llm: SpeechmaticsLLM;

  // AbortController management
  getLlmAbortController: () => AbortController | null;
  setLlmAbortController: (controller: AbortController | null) => void;

  // Callbacks
  onMessageCallback: SpeechmaticsMessageCallback | null;
  onErrorCallback: SpeechmaticsErrorCallback | null;
  onAudioCallback: SpeechmaticsAudioCallback | null;
}

/**
 * Process a user message (final transcript) and generate LLM response
 *
 * This is the main message processing function that:
 * 1. Validates and deduplicates the message
 * 2. Handles queuing if agent is busy
 * 3. Calls the LLM for response generation
 * 4. Generates TTS audio from the response
 * 5. Notifies callbacks with the response
 *
 * @param transcript - The final user transcript to process
 * @param deps - Dependencies (modules, callbacks)
 */
export async function processUserMessage(
  transcript: string,
  deps: MessageProcessorDeps
): Promise<void> {
  const processStartedAt = Date.now();
  const normalizedTranscript = transcript.trim().toLowerCase();
  const config = deps.getConfig();

  // Emit USER_SPEECH_END event to state machine
  deps.stateMachine.transition({
    type: 'USER_SPEECH_END',
    message: transcript,
    timestamp: new Date().toISOString()
  });

  // DEDUPLICATION: Skip if this is identical to what we just processed
  if (deps.stateMachine.isDuplicateMessage(normalizedTranscript, processStartedAt)) {
    return;
  }

  // If we were aborted due to user continuation, clear the flag and proceed
  if (deps.stateMachine.wasAbortedDueToUserContinuation()) {
    deps.stateMachine.clearAbortedDueToUserContinuation();
  }

  // ==========================================================================
  // LOOP DETECTION: Check if this looks like an echo of AI speech
  // ==========================================================================

  // Check circuit breaker first (too many rapid responses)
  if (checkRapidResponseRate()) {
    devError('[Speechmatics] 🛑 BLOCKING MESSAGE - Circuit breaker active to prevent loop');
    deps.onErrorCallback?.(new Error('Voice loop detected - please wait a moment before speaking'));
    return;
  }

  // NOTE: Echo detection is now handled upstream via speaker identity.
  // If speaker == primary speaker -> process, if speaker != primary -> popup shown to user.
  // No need for word-overlap echo detection here anymore.

  if (deps.stateMachine.isGenerating()) {
    // SAFETY CHECK: Auto-reset if generation has been stuck for too long
    if (deps.stateMachine.isGenerationTimedOut()) {
      devWarn('[Speechmatics] Generation stuck for', Math.round((processStartedAt - deps.stateMachine.getContext().generationStartedAt) / 1000), 'seconds - auto-resetting flag');
      deps.stateMachine.transition({ type: 'GENERATION_TIMEOUT' });
      const controller = deps.getLlmAbortController();
      if (controller) {
        controller.abort();
        deps.setLlmAbortController(null);
      }
    } else {
      // DEDUPLICATION: Check if this message is already in queue or identical to what's being processed
      const smContext = deps.stateMachine.getContext();
      const isInQueue = smContext.messageQueue.some(q => q.content.trim().toLowerCase() === normalizedTranscript);
      const isCurrentlyProcessing = smContext.lastSentUserMessage.trim().toLowerCase() === normalizedTranscript;

      if (isInQueue || isCurrentlyProcessing) {
        return;
      }

      // Queue the message via state machine
      deps.stateMachine.queueMessage(transcript, new Date().toISOString());
      return;
    }
  }

  // Emit GENERATION_START event to state machine
  devLog('[Speechmatics] 🚀 GENERATION_START - LLM call starting for:', transcript.substring(0, 50));
  deps.stateMachine.transition({ type: 'GENERATION_START', message: transcript });

  // Add user message to conversation history
  deps.stateMachine.addUserMessage(transcript);

  // Get audio for TTS playback later
  const audio = deps.getAudio();

  // In consultant mode (disableLLM), skip LLM response generation entirely
  if (config?.disableLLM) {
    deps.stateMachine.transition({ type: 'GENERATION_COMPLETE', response: '' });
    // Process any queued messages
    if (deps.stateMachine.hasQueuedMessages()) {
      const next = deps.stateMachine.processNextQueuedMessage();
      if (next) {
        try {
          await processUserMessage(next.content, deps);
        } catch (error) {
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
            tags: {
              module: 'speechmatics',
              operation: 'process_queued_message_consultant_mode',
            },
            extra: {
              messageContent: next.content.substring(0, 100),
            },
            level: 'error',
          });
          devError('[Speechmatics] Error processing queued message in consultant mode:', error);
        }
      }
    }
    return;
  }

  // SAFETY GUARD: Handle case when an LLM call is already in progress
  const existingController = deps.getLlmAbortController();
  if (existingController) {
    const context = deps.stateMachine.getContext();

    // If this is due to user continuation (user spoke during generation and abort was triggered),
    // DON'T process - the user is still speaking, wait for complete message
    if (context.responseAbortedDueToUserContinuation) {
      devLog('[Speechmatics] Ignoring message during user continuation - abort in progress');
      return;
    }

    // A new complete message arrived while LLM is generating → abort old call and process new one
    // This prevents "stale" responses and ensures the latest user message is addressed
    devWarn('[Speechmatics] New message arrived while LLM in progress - aborting current call to process new message');
    existingController.abort();
    deps.setLlmAbortController(null);
    // Remove the incomplete user message from history since we're abandoning that response
    deps.stateMachine.removeLastMessage('user');
    deps.stateMachine.transition({ type: 'ABORT' });
    // Continue to process the new message below...
  }

  // Create abort controller for this LLM request
  const abortController = new AbortController();
  deps.setLlmAbortController(abortController);
  const signal = abortController.signal;

  try {
    const llmProvider = config?.llmProvider || "anthropic";
    const llmApiKey = config?.llmApiKey || await deps.llm.getLLMApiKey(llmProvider);
    const llmModel = config?.llmModel || (llmProvider === "openai" ? "gpt-4o" : "claude-3-5-haiku-latest");

    // Build messages for LLM
    const recentHistory = deps.stateMachine.getRecentHistory(RECENT_HISTORY_COUNT);

    // Use user prompt if available, otherwise use transcript directly
    const { renderTemplate } = await import('./templates');
    const userPrompt = config?.userPrompt;
    let userMessageContent: string;
    if (userPrompt && userPrompt.trim()) {
      const baseVariables = config?.promptVariables || {};
      const variables: Record<string, string | null | undefined> = {
        ...baseVariables,
        latest_user_message: transcript,
      };
      userMessageContent = renderTemplate(userPrompt, variables);
    } else {
      userMessageContent = transcript;
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: config?.systemPrompt || '' },
      ...recentHistory.map((msg: { role: 'user' | 'agent'; content: string }) => ({
        role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content,
      })),
      { role: 'user', content: userMessageContent },
    ];

    // Call LLM with abort signal
    const llmResponse = await deps.llm.callLLM(
      llmProvider,
      llmApiKey,
      llmModel,
      messages,
      {
        enableThinking: config?.enableThinking,
        thinkingBudgetTokens: config?.thinkingBudgetTokens,
        signal,
      }
    );

    // Emit GENERATION_COMPLETE event
    deps.stateMachine.transition({
      type: 'GENERATION_COMPLETE',
      response: llmResponse
    });

    // USER-SPEAKING CHECK: If user started speaking while LLM was generating, drop the response
    const partialFlagIsFresh = deps.stateMachine.isPartialFlagFresh();
    if (partialFlagIsFresh) {
      devLog('[Speechmatics] LLM response dropped - user spoke during generation');
      deps.stateMachine.removeLastMessage('user');
      deps.stateMachine.transition({ type: 'ABORT' });
      return;
    }

    // Log that response was NOT dropped (helps debugging)
    if (deps.stateMachine.getContext().receivedPartialDuringGeneration) {
      devLog('[Speechmatics] LLM response NOT dropped - partial was stale');
    }

    // BUG-044 FIX: Check for duplicate AI response (race condition prevention)
    if (isDuplicateAIResponse(llmResponse)) {
      devLog('[Speechmatics] 🛑 Duplicate AI response detected - dropping to prevent duplicates in DB');
      // Remove the user message we added since we're not responding
      deps.stateMachine.removeLastMessage('user');
      deps.stateMachine.transition({ type: 'ABORT' });
      return;
    }

    // Record this response to detect future duplicates
    recordAIResponse(llmResponse);

    // Add to conversation history
    deps.stateMachine.addAgentMessage(llmResponse);

    // LOOP DETECTION: Record this response for rate limiting
    recordResponseTimestamp();
    devLog('[Speechmatics] ✅ Response generated, timestamp recorded for loop detection');

    // Notify callback with FINAL agent response
    deps.onMessageCallback?.({
      role: 'agent',
      content: llmResponse,
      timestamp: new Date().toISOString(),
      isInterim: false,
    });

    // Generate TTS audio only if ElevenLabs is enabled
    const tts = deps.getTTS();
    if (!config?.disableLLM && !config?.disableElevenLabsTTS && tts && audio) {
      try {
        const ttsText = cleanTextForTTS(llmResponse);
        audio.setCurrentAssistantSpeech(ttsText);

        const audioStream = await tts.streamTextToSpeech(ttsText);
        const audioData = await audio.streamToUint8Array(audioStream);
        if (audioData) {
          deps.onAudioCallback?.(audioData);
          deps.stateMachine.transition({ type: 'TTS_START' });
          await audio.playAudio(audioData).catch(err => {
            devError('[Speechmatics] Error playing audio:', err);
          });
        }
      } catch (error) {
        devError('[Speechmatics] Error generating TTS audio:', error);
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: {
            component: 'speechmatics',
            error_type: 'tts_generation',
          },
          extra: {
            responseLength: llmResponse.length,
            hasElevenLabsTTS: Boolean(tts),
            voiceId: config?.elevenLabsVoiceId,
          },
          level: 'error',
        });
      }
    }

    // DEDUPLICATION: Track the successfully processed message
    deps.stateMachine.markMessageProcessed(deps.stateMachine.getContext().lastSentUserMessage);

    // Process queued messages
    if (deps.stateMachine.hasQueuedMessages()) {
      const nextMessage = deps.stateMachine.processNextQueuedMessage();
      if (nextMessage) {
        await processUserMessage(nextMessage.content, deps);
      }
    }
  } catch (error) {
    // Check if error was caused by user aborting (barge-in or continuation)
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }

    devError('[Speechmatics] Error processing user message:', error);

    deps.stateMachine.transition({
      type: 'GENERATION_ERROR',
      error: error instanceof Error ? error : new Error(String(error))
    });

    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: {
        component: 'speechmatics',
        error_type: 'user_message_processing',
      },
      extra: {
        transcriptLength: transcript.length,
        hasLLMConfig: Boolean(config?.llmProvider),
        llmProvider: config?.llmProvider,
      },
      level: 'error',
    });

    deps.onErrorCallback?.(error instanceof Error ? error : new Error(String(error)));

    // CRITICAL: Even on error, try to process queued messages
    if (deps.stateMachine.hasQueuedMessages()) {
      const nextMessage = deps.stateMachine.processNextQueuedMessage();
      if (nextMessage) {
        setTimeout(async () => {
          try {
            await processUserMessage(nextMessage.content, deps);
          } catch (err) {
            devError('[Speechmatics] Error processing queued message:', err);
          }
        }, QUEUED_MESSAGE_RETRY_DELAY_MS);
      }
    }
  } finally {
    deps.setLlmAbortController(null);
  }
}
