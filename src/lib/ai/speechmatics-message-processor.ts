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
  ECHO_LOOP_SIMILARITY_THRESHOLD,
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

/** Last AI response content for echo comparison */
let lastAIResponseContent: string = '';

/**
 * Check if a user message looks like an echo of the AI's last response
 * Uses word overlap to detect when microphone picked up TTS playback
 */
function detectPotentialEchoLoop(userMessage: string, recentAgentMessages: string[]): {
  isLikelyEcho: boolean;
  similarity: number;
  matchedWith: string;
} {
  const normalizedUser = normalizeForEchoDetection(userMessage);
  const userWords = normalizedUser.split(/\s+/).filter(w => w.length > 2);

  if (userWords.length < 3) {
    return { isLikelyEcho: false, similarity: 0, matchedWith: '' };
  }

  for (const agentMessage of recentAgentMessages) {
    const normalizedAgent = normalizeForEchoDetection(agentMessage);
    const agentWords = new Set(normalizedAgent.split(/\s+/).filter(w => w.length > 2));

    if (agentWords.size === 0) continue;

    let matchedWords = 0;
    for (const word of userWords) {
      if (agentWords.has(word)) {
        matchedWords++;
      }
    }

    const similarity = matchedWords / userWords.length;

    if (similarity >= ECHO_LOOP_SIMILARITY_THRESHOLD) {
      return {
        isLikelyEcho: true,
        similarity,
        matchedWith: agentMessage.substring(0, 100) + (agentMessage.length > 100 ? '...' : ''),
      };
    }
  }

  return { isLikelyEcho: false, similarity: 0, matchedWith: '' };
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
  lastAIResponseContent = '';
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

  // Check if user message looks like recent AI speech (echo detection)
  const recentAgentMessages = deps.stateMachine.getRecentHistory(3)
    .filter(msg => msg.role === 'agent')
    .map(msg => msg.content);

  if (recentAgentMessages.length > 0) {
    const echoCheck = detectPotentialEchoLoop(transcript, recentAgentMessages);
    if (echoCheck.isLikelyEcho) {
      devError('[Speechmatics] 🔄 ECHO LOOP DETECTED - User message matches AI speech');
      devError('[Speechmatics] Similarity:', (echoCheck.similarity * 100).toFixed(1) + '%');
      devError('[Speechmatics] User said:', transcript.substring(0, 80) + '...');
      devError('[Speechmatics] Matched AI:', echoCheck.matchedWith);

      // Don't process this message - it's likely the microphone picking up TTS
      Sentry.addBreadcrumb({
        category: 'speechmatics',
        message: 'Echo loop detected - message blocked',
        level: 'warning',
        data: {
          userMessage: transcript.substring(0, 100),
          similarity: echoCheck.similarity,
          matchedWith: echoCheck.matchedWith,
        },
      });

      return;
    }
  }

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
  deps.stateMachine.transition({ type: 'GENERATION_START', message: transcript });

  // Add user message to conversation history
  deps.stateMachine.addUserMessage(transcript);

  // Update audio manager with conversation history for start-of-turn detection
  const audio = deps.getAudio();
  if (audio) {
    const historyForDetection = deps.stateMachine.getRecentHistory(RECENT_HISTORY_COUNT).map(msg => ({
      role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content,
    }));
    audio.updateConversationHistory(historyForDetection);
  }

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

    // Add to conversation history
    deps.stateMachine.addAgentMessage(llmResponse);

    // LOOP DETECTION: Record this response for rate limiting
    recordResponseTimestamp();
    lastAIResponseContent = llmResponse;
    devLog('[Speechmatics] ✅ Response generated, timestamp recorded for loop detection');

    // Update audio manager with conversation history
    if (audio) {
      const historyForDetection = deps.stateMachine.getRecentHistory(RECENT_HISTORY_COUNT).map(msg => ({
        role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content,
      }));
      audio.updateConversationHistory(historyForDetection);
    }

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
