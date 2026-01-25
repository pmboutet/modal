/**
 * WebSocket management for Speechmatics Voice Agent
 */

import { devLog, devWarn, devError } from '@/lib/utils';
import type { SpeechmaticsConfig, SpeechmaticsConnectionCallback, SpeechmaticsErrorCallback } from './speechmatics-types';
import { SpeechmaticsAuth } from './speechmatics-auth';

export class SpeechmaticsWebSocket {
  private ws: WebSocket | null = null;
  private wsConnected: boolean = false;
  private isDisconnecting: boolean = false; // Track if we're intentionally disconnecting
  private readonly RECONNECT_DELAY_MS = 5000; // Increased to 5 seconds to ensure server releases session
  private readonly QUOTA_ERROR_DELAY_MS = 10000; // 10 seconds delay after quota errors
  private readonly SERVER_SESSION_RELEASE_DELAY_MS = 3000; // Additional delay after disconnect to ensure server releases session (increased for reliability)
  private lastDisconnectTimestamp: number = 0;
  private static lastGlobalDisconnectTimestamp: number = 0;
  public static lastQuotaErrorTimestamp: number = 0; // Track last quota error to enforce longer delay (public for access from speechmatics.ts)
  private static globalDisconnectPromise: Promise<void> | null = null;
  private messageHandler: ((data: any) => void) | null = null;
  // BUG-018 FIX: Track the most recent handler set via setMessageHandler()
  // This is separate from messageHandler (which can be nulled on disconnect) to preserve
  // dynamic handler changes across reconnects
  private currentMessageHandler: ((data: any) => void) | null = null;

  constructor(
    private auth: SpeechmaticsAuth,
    private onConnectionCallback: SpeechmaticsConnectionCallback | null,
    private onErrorCallback: SpeechmaticsErrorCallback | null,
    private readonly initialMessageHandler: (data: any) => void
  ) {
    this.messageHandler = initialMessageHandler;
  }

  /**
   * Update the message handler - called when reconnecting to restore the handler
   * BUG-006 FIX: Provides a way to reinitialize the handler after disconnect
   * BUG-018 FIX: Also tracks the handler in currentMessageHandler to preserve
   * dynamic changes across reconnects
   */
  setMessageHandler(handler: (data: any) => void): void {
    this.messageHandler = handler;
    // BUG-018 FIX: Store in currentMessageHandler so it survives disconnect/reconnect cycles
    this.currentMessageHandler = handler;
  }

  async connect(
    config: SpeechmaticsConfig,
    disconnectPromise: Promise<void> | null
  ): Promise<void> {
    // Wait for any global disconnect to complete
    if (SpeechmaticsWebSocket.globalDisconnectPromise) {
      await SpeechmaticsWebSocket.globalDisconnectPromise;
    }

    // Wait for any instance-specific disconnect to complete
    if (disconnectPromise) {
      await disconnectPromise;
    }

    // If there's an existing connection, disconnect it first
    if (this.ws) {
      devLog('[Speechmatics] 🔌 Disconnecting existing WebSocket before reconnecting...');
      await this.disconnect(false);
    }

    // BUG-006 FIX + BUG-018 FIX: Restore message handler if it was cleared during disconnect
    // BUG-018 FIX: Use currentMessageHandler (set via setMessageHandler) if available,
    // otherwise fall back to initialMessageHandler. This preserves dynamic handler changes.
    if (!this.messageHandler) {
      // currentMessageHandler tracks the most recent handler set via setMessageHandler()
      // This ensures dynamic handler changes are preserved across reconnects
      this.messageHandler = this.currentMessageHandler || this.initialMessageHandler;
    }

    const lastDisconnect = Math.max(
      this.lastDisconnectTimestamp,
      SpeechmaticsWebSocket.lastGlobalDisconnectTimestamp
    );

    // BUG-017 FIX: Check if we need to wait due to a recent quota error
    // Only enforce delay if the quota error was within the last 15 seconds
    // This prevents stale quota errors from one instance blocking all future instances indefinitely
    const lastQuotaError = SpeechmaticsWebSocket.lastQuotaErrorTimestamp;
    const QUOTA_ERROR_RELEVANCE_WINDOW_MS = 15000; // 15 seconds - after this, quota error is considered stale
    if (lastQuotaError) {
      const elapsedSinceQuotaError = Date.now() - lastQuotaError;
      // BUG-017 FIX: Only enforce delay if within relevance window
      if (elapsedSinceQuotaError < QUOTA_ERROR_RELEVANCE_WINDOW_MS && elapsedSinceQuotaError < this.QUOTA_ERROR_DELAY_MS) {
        const waitTime = this.QUOTA_ERROR_DELAY_MS - elapsedSinceQuotaError;
        console.log(`[Speechmatics] ⏳ Waiting ${Math.round(waitTime / 1000)}s after quota error before reconnecting...`);
        await this.delay(waitTime);
      } else if (elapsedSinceQuotaError >= QUOTA_ERROR_RELEVANCE_WINDOW_MS) {
        // BUG-017 FIX: Clear stale quota error timestamp so it doesn't affect future checks
        SpeechmaticsWebSocket.lastQuotaErrorTimestamp = 0;
      }
    }

    // Ensure minimum delay between disconnect and reconnect
    if (lastDisconnect) {
      const elapsed = Date.now() - lastDisconnect;
      if (elapsed < this.RECONNECT_DELAY_MS) {
        const waitTime = this.RECONNECT_DELAY_MS - elapsed;
        console.log(`[Speechmatics] ⏳ Waiting ${Math.round(waitTime / 1000)}s before reconnecting (${Math.round(elapsed / 1000)}s since last disconnect)...`);
        await this.delay(waitTime);
      }
    }
    
    this.wsConnected = false;

    // Authenticate with Speechmatics
    await this.auth.authenticate();
    
    if (!this.auth.hasJWT() && !this.auth.getApiKey()) {
      throw new Error('No Speechmatics authentication token available');
    }

    // Determine WebSocket URL
    const language = config.sttLanguage || "fr";
    const region = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SPEECHMATICS_REGION) || 'eu2';
    
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const forceProxy = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SPEECHMATICS_USE_PROXY === 'true');
    const useProxy = forceProxy || (isLocalhost && !this.auth.hasJWT());
    
    let wsUrl: string;
    if (useProxy) {
      const proxyPort = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SPEECHMATICS_PROXY_PORT) || '3001';
      wsUrl = `ws://localhost:${proxyPort}/speechmatics-ws?language=${encodeURIComponent(language)}`;
    } else if (this.auth.hasJWT()) {
      wsUrl = `wss://${region}.rt.speechmatics.com/v2?jwt=${encodeURIComponent(this.auth.getJWT()!)}`;
    } else {
      wsUrl = `wss://${region}.rt.speechmatics.com/v2`;
      devWarn('[Speechmatics] ⚠️ No JWT or proxy, trying direct connection (may fail)');
    }

    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          const error = new Error('Connection timeout: Did not receive RecognitionStarted event within 10 seconds');
          devError('[Speechmatics] ❌', error.message);
          resolved = true;
          reject(error);
        }
      }, 10000);

      try {
        const ws = new WebSocket(wsUrl);
        const currentWs = ws;
        this.ws = ws;

        ws.onopen = () => {
          clearTimeout(timeout);
          
          // Use the language as-is, but ensure it's a valid single language code
          // Speechmatics supports: "fr", "en", "es", "de", etc.
          // For multi-language, we default to "fr" (French)
          let transcriptionLanguage = language;
          if (!language || language === "multi" || language === "fr,en" || language.includes(",")) {
            transcriptionLanguage = "fr"; // Default to French
            devLog('[Speechmatics] ℹ️ Language set to "fr" (default)');
          } else {
            // Ensure it's a valid single language code
            transcriptionLanguage = language.trim().toLowerCase();
            devLog('[Speechmatics] ℹ️ Language set to:', transcriptionLanguage);
          }
          
          const endOfUtteranceSilenceTrigger = (() => {
            if (typeof config.sttEndOfUtteranceSilenceTrigger === 'number' && !Number.isNaN(config.sttEndOfUtteranceSilenceTrigger)) {
              return Math.min(2, Math.max(0, config.sttEndOfUtteranceSilenceTrigger));
            }
            return 0.7; // Default recommended range for voice AI use cases (0.5 - 0.8s)
          })();

          // Build diarization config if enabled (default: "speaker" for voice identification)
          const diarizationMode = config.sttDiarization ?? "speaker";
          const diarizationConfig: any = {};

          // BUG-027 FIX: Validate sttDiarization in consultant mode
          // Consultant mode requires speaker diarization to distinguish between participants
          if (config.disableLLM && diarizationMode === "none") {
            devWarn('[Speechmatics] ⚠️ WARNING: sttDiarization is set to "none" in consultant mode (disableLLM=true). ' +
              'Speaker diarization is recommended in consultant mode to distinguish between multiple speakers. ' +
              'Consider setting sttDiarization to "speaker" for proper speaker identification.');
          }

          if (diarizationMode !== "none") {
            diarizationConfig.diarization = diarizationMode;

            // Speaker diarization specific config
            if (diarizationMode === "speaker" || diarizationMode === "channel_and_speaker") {
              diarizationConfig.speaker_diarization_config = {
                speaker_sensitivity: config.sttSpeakerSensitivity ?? 0.5,
                prefer_current_speaker: config.sttPreferCurrentSpeaker !== false, // Default: true
              };
              // Only add max_speakers if explicitly set (null = unlimited)
              if (typeof config.sttMaxSpeakers === 'number' && config.sttMaxSpeakers >= 2) {
                diarizationConfig.speaker_diarization_config.max_speakers = config.sttMaxSpeakers;
              }
            }
          }

          const settings: any = {
            message: "StartRecognition",
            audio_format: {
              type: "raw",
              encoding: "pcm_s16le",
              sample_rate: 16000,
            },
            transcription_config: {
              language: transcriptionLanguage,
              enable_partials: config.sttEnablePartials !== false,
              // Low latency mode: reduce max_delay for faster response
              // Default to 1.0s for low latency (was 3.0s)
              max_delay: config.sttMaxDelay ?? (config.lowLatencyMode !== false ? 1.0 : 3.0),
              // Use "standard" operating point for lower latency (was "enhanced")
              // "enhanced" provides better accuracy but higher latency
              operating_point: config.sttOperatingPoint || (config.lowLatencyMode !== false ? "standard" : "enhanced"),
              conversation_config: {
                end_of_utterance_silence_trigger: endOfUtteranceSilenceTrigger,
              },
              // Diarization config for speaker identification
              ...diarizationConfig,
            },
          };

          devLog('[Speechmatics] 📤 Sending StartRecognition:', {
            language: transcriptionLanguage,
            originalLanguage: language,
            enable_partials: config.sttEnablePartials !== false,
            max_delay: config.sttMaxDelay ?? (config.lowLatencyMode !== false ? 1.0 : 3.0),
            operating_point: config.sttOperatingPoint || (config.lowLatencyMode !== false ? "standard" : "enhanced"),
            lowLatencyMode: config.lowLatencyMode !== false,
            end_of_utterance_silence_trigger: endOfUtteranceSilenceTrigger,
            diarization: diarizationMode,
            speaker_sensitivity: diarizationMode !== "none" ? (config.sttSpeakerSensitivity ?? 0.5) : undefined,
            max_speakers: config.sttMaxSpeakers ?? 'unlimited',
          });

          ws.send(JSON.stringify(settings));
        };

        ws.onmessage = (event) => {
          try {
            if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
              // Binary data - log for debugging
              devLog('[Speechmatics] 📦 Received binary data from server (size:', event.data instanceof Blob ? event.data.size : (event.data as ArrayBuffer).byteLength, ')');
              return;
            }

            const text = typeof event.data === 'string' ? event.data : event.data.toString();
            const data = JSON.parse(text);
            
            // Log only partial transcripts (interim text as user speaks)
            // Final transcripts (AddTranscript) are accumulated and logged once complete
            if (data.message === 'AddPartialTranscript') {
              const transcript = data.metadata?.transcript || '';
              if (transcript && transcript.trim()) {
                devLog('[Speechmatics] 📝:', transcript);
              }
            }
            
            if (data.message === "RecognitionStarted") {
              if (this.ws === currentWs && !resolved) {
                clearTimeout(timeout);
                resolved = true;
                this.wsConnected = true;
                this.onConnectionCallback?.(true);
                resolve();
              }
            }
            
            // Call the message handler if it exists
            if (this.messageHandler) {
              this.messageHandler(data);
            }
          } catch (error) {
            if (!(event.data instanceof Blob || event.data instanceof ArrayBuffer)) {
              devError('[Speechmatics] ❌ Error parsing WebSocket message:', error);
            }
          }
        };

        ws.onerror = (error) => {
          if (!resolved && this.ws === currentWs) {
            devError('[Speechmatics] ❌ WebSocket error:', error);
            clearTimeout(timeout);
            resolved = true;
            const err = new Error(`Speechmatics WebSocket error: ${error}`);
            this.onErrorCallback?.(err);
            reject(err);
          }
        };

        ws.onclose = (event) => {
          devLog('[Speechmatics] 🔚 WebSocket onclose event', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            timestamp: new Date().toISOString(),
            isDisconnecting: this.isDisconnecting,
            wsState: ws.readyState,
            isCurrentWs: this.ws === currentWs,
          });
          
          if (this.ws === currentWs) {
            this.wsConnected = false;
            this.onConnectionCallback?.(false);
            
            // Don't report errors if we're intentionally disconnecting
            if (this.isDisconnecting) {
              devLog('[Speechmatics] ℹ️ Intentional disconnect - ignoring close event');
              return;
            }
            
            // Handle quota errors more gracefully
            if (event.code === 4005 || event.reason?.includes('quota') || event.reason?.includes('Quota') || event.reason?.includes('Concurrent')) {
              // Record quota error timestamp to enforce longer delay on reconnect
              SpeechmaticsWebSocket.lastQuotaErrorTimestamp = Date.now();
              const error = new Error(`Speechmatics quota exceeded. Please wait 10 seconds before trying again, or check your account limits. If you have multiple tabs open, close them to free up concurrent sessions.`);
              devError('[Speechmatics] ⏳ Quota error - preventing reconnection for 10 seconds');
              if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                this.onErrorCallback?.(error);
                reject(error);
              } else {
                this.onErrorCallback?.(error);
              }
              return;
            }
            
            // Code 1005 (No Status Received) is often used for normal closures, don't treat as error
            // Code 1000 (Normal Closure) is also normal
            if (event.code === 1005 || event.code === 1000) {
              if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                resolve();
              }
              return;
            }
            
            if (!resolved) {
              clearTimeout(timeout);
              resolved = true;
              const error = new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason || ''}`);
              this.onErrorCallback?.(error);
              reject(error);
            } else if (event.code !== 1000 && event.code !== 1005) {
              // Only report unexpected closes after connection was established (excluding normal closure codes)
              const error = new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason || ''}`);
              this.onErrorCallback?.(error);
            }
          }
        };
      } catch (error) {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          devError('[Speechmatics] ❌ Error creating WebSocket:', error);
          reject(error);
        }
      }
    });
  }

  async disconnect(isDisconnected: boolean): Promise<void> {
    const disconnectStartTime = Date.now();
    devLog('[Speechmatics] 🔌 DISCONNECT START', {
      timestamp: new Date().toISOString(),
      wsState: this.ws?.readyState,
      wsConnected: this.wsConnected,
      isDisconnecting: this.isDisconnecting,
    });
    
    // Mark as intentionally disconnecting to avoid error callbacks
    this.isDisconnecting = true;
    
    const ws = this.ws;
    if (!ws) {
      devLog('[Speechmatics] ⚠️ No WebSocket to disconnect');
      this.wsConnected = false;
      this.isDisconnecting = false;
      return;
    }

    devLog('[Speechmatics] 📊 WebSocket state before disconnect:', {
      readyState: ws.readyState,
      readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState],
      url: ws.url?.substring(0, 50) + '...',
    });

    // Step 1: Send EndOfStream message if connection is open
    // According to Speechmatics API docs, this properly closes the session on server side
    // CRITICAL: We must send EndOfStream BEFORE closing the WebSocket
    // This tells the server to release the session properly
    if (ws.readyState === WebSocket.OPEN) {
      try {
        // Send EndOfStream with proper format according to Speechmatics API
        const endOfStreamMessage = JSON.stringify({ 
          message: "EndOfStream",
          last_seq_no: 0 
        });
        
        devLog('[Speechmatics] 📤 Sending EndOfStream:', {
          message: endOfStreamMessage,
          timestamp: new Date().toISOString(),
        });
        
        // Send the message
        ws.send(endOfStreamMessage);
        devLog('[Speechmatics] ✅ EndOfStream message sent to server');
        
        // CRITICAL: Wait for server to process EndOfStream and release the session
        // According to Speechmatics API docs:
        // - EndOfStream declares that the client has no more audio to send
        // - The server needs time to process this and release the session from quota
        // - Without this wait, the session may not be released before we reconnect
        // Recommended: wait at least 1-2 seconds after EndOfStream before closing
        devLog('[Speechmatics] ⏳ Waiting 1.5s for server to process EndOfStream...');
        await this.delay(1500); // 1.5 seconds to ensure server processes EndOfStream and releases session
        
        devLog('[Speechmatics] ✅ Waited for server to process EndOfStream', {
          elapsed: Date.now() - disconnectStartTime,
          wsState: ws.readyState,
        });
      } catch (error) {
        devError('[Speechmatics] ❌ Error sending EndOfStream:', error);
        // Continue with closure even if EndOfStream fails, but wait anyway
        // This ensures any pending session on server side has time to timeout/release
        devLog('[Speechmatics] ⏳ Waiting 1.5s after EndOfStream error...');
        await this.delay(1500);
      }
    } else {
      // Connection not open, but wait anyway to ensure any pending session is released
      // If we couldn't send EndOfStream, the server may still have the session active
      devWarn('[Speechmatics] ⚠️ WebSocket not open, cannot send EndOfStream', {
        readyState: ws.readyState,
        readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState],
        'waiting-for-timeout': '2s',
      });
      await this.delay(2000); // Longer wait if we couldn't send EndOfStream
    }

    // Step 2: Close WebSocket with proper close code (1000 = Normal Closure)
    devLog('[Speechmatics] 🔒 Step 2: Closing WebSocket...', {
      readyState: ws.readyState,
      readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState],
    });
    
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        // Use 1000 (Normal Closure) - this is the proper way to close according to WebSocket spec
        devLog('[Speechmatics] 📤 Calling ws.close(1000, "Normal closure")');
        ws.close(1000, 'Normal closure');
        devLog('[Speechmatics] ✅ ws.close() called');
      } else if (ws.readyState === WebSocket.CLOSING) {
        devLog('[Speechmatics] ℹ️ WebSocket already closing, waiting...');
      } else if (ws.readyState === WebSocket.CLOSED) {
        devLog('[Speechmatics] ℹ️ WebSocket already closed');
        // Already closed, nothing to do
        if (this.ws === ws) {
          this.ws = null;
        }
        this.wsConnected = false;
        this.isDisconnecting = false;
        devLog('[Speechmatics] ✅ Disconnect complete (already closed)', {
          totalTime: Date.now() - disconnectStartTime,
        });
        return;
      }
    } catch (error) {
      devError('[Speechmatics] ❌ Error closing WebSocket:', error);
      // Force close if normal close failed
      try {
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          devLog('[Speechmatics] 🔧 Force closing WebSocket...');
          ws.close();
        }
      } catch {
        // Ignore secondary errors
      }
    }

    // Step 3: Wait for WebSocket to be fully closed
    // This ensures the connection is completely terminated before we continue
    devLog('[Speechmatics] ⏳ Step 3: Waiting for WebSocket to close (max 3s)...');
    const closeStartTime = Date.now();
    await this.waitForWebSocketClose(ws, 3000).catch(() => {
      // Timeout waiting for close, but continue anyway
      devWarn('[Speechmatics] ⚠️ Timeout waiting for WebSocket close, forcing cleanup', {
        elapsed: Date.now() - closeStartTime,
        finalState: ws.readyState,
      });
    });
    devLog('[Speechmatics] ✅ WebSocket close confirmed', {
      elapsed: Date.now() - closeStartTime,
      finalState: ws.readyState,
    });

    // Step 4: Remove ALL WebSocket event listeners before clearing reference
    // This prevents any handlers from firing after disconnect
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        devLog('[Speechmatics] 🧹 WebSocket event listeners removed');
      } catch (error) {
        devWarn('[Speechmatics] ⚠️ Error removing WebSocket listeners:', error);
      }
    }

    // Step 4c: Clear the message handler reference to prevent stale handlers on reconnect
    // BUG-006 FIX: Ensure message handler is cleared to prevent memory leaks and routing errors
    this.messageHandler = null;

    // Step 4b: Clean up reference
    if (this.ws === ws) {
      this.ws = null;
      devLog('[Speechmatics] 🧹 WebSocket reference cleared');
    }

    this.wsConnected = false;
    this.lastDisconnectTimestamp = Date.now();
    SpeechmaticsWebSocket.lastGlobalDisconnectTimestamp = this.lastDisconnectTimestamp;
    
    devLog('[Speechmatics] 📊 State after WebSocket close:', {
      wsConnected: this.wsConnected,
      lastDisconnectTimestamp: this.lastDisconnectTimestamp,
      timeSinceStart: Date.now() - disconnectStartTime,
    });
    
    // Step 5: Wait additional time to ensure server releases the session
    // This is critical - Speechmatics needs time to release the session on their side
    // According to Speechmatics API docs:
    // - For quota_exceeded errors: "we recommend adding a client retry interval of at least 5-10 seconds"
    // - This means the server needs time to release the session from quota
    // We already waited 1.5 seconds after EndOfStream, so this is additional safety
    devLog('[Speechmatics] ⏳ Step 5: Waiting additional', this.SERVER_SESSION_RELEASE_DELAY_MS, 'ms for server to release session...');
    await this.delay(this.SERVER_SESSION_RELEASE_DELAY_MS);
    
    const totalDisconnectTime = Date.now() - disconnectStartTime;
    devLog('[Speechmatics] ✅ DISCONNECT COMPLETE', {
      totalTime: totalDisconnectTime,
      timestamp: new Date().toISOString(),
      'session-should-be-released': true,
    });
    
    // Step 6: Reset disconnecting flag
    this.isDisconnecting = false;
  }

  isConnected(): boolean {
    return this.wsConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  send(data: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitForWebSocketClose(ws: WebSocket, timeoutMs = 3000): Promise<void> {
    // If already closed, return immediately
    if (ws.readyState === WebSocket.CLOSED) {
      return;
    }

    // Wait for close event or timeout
    await new Promise<void>(resolve => {
      let resolved = false;
      
      const handleClose = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve();
        }
      };

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve();
        }
      }, timeoutMs);

      const cleanup = () => {
        ws.removeEventListener('close', handleClose);
        ws.removeEventListener('error', handleClose); // Also listen for error as it might close the connection
        clearTimeout(timeout);
      };

      // Listen for both close and error events
      ws.addEventListener('close', handleClose, { once: true });
      ws.addEventListener('error', handleClose, { once: true });
      
      // Also check periodically if already closed (in case event was missed)
      const checkInterval = setInterval(() => {
        if (ws.readyState === WebSocket.CLOSED) {
          if (!resolved) {
            resolved = true;
            clearInterval(checkInterval);
            cleanup();
            resolve();
          }
        }
      }, 100);
      
      // Clear interval on timeout or close
      setTimeout(() => clearInterval(checkInterval), timeoutMs);
    });
  }
}

