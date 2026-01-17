/**
 * useRealtimeMessages - Hook for real-time message synchronization
 *
 * Subscribes to Supabase Realtime for message INSERT events on a specific conversation thread.
 * Used in shared thread modes (collaborative, group_reporter, consultant) so all participants
 * see messages from others in real-time.
 *
 * Includes polling fallback for dev mode where Realtime doesn't work without auth.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Message } from '@/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

type SubscriptionStatus = 'idle' | 'subscribing' | 'subscribed' | 'error';

/**
 * Check if an error message indicates a JWT token expiration
 */
function isTokenExpiredError(errorMessage: string): boolean {
  const lowerError = errorMessage.toLowerCase();
  return lowerError.includes('invalidjwttoken') ||
         lowerError.includes('token has expired') ||
         lowerError.includes('jwt expired') ||
         lowerError.includes('token expired');
}

// Polling interval in ms (3 seconds for responsive updates)
const POLLING_INTERVAL_MS = 3000;

export interface UseRealtimeMessagesConfig {
  /**
   * The conversation thread ID to subscribe to
   */
  conversationThreadId: string | null;

  /**
   * ASK key for message formatting
   */
  askKey: string;

  /**
   * Whether realtime is enabled (should be true for shared thread modes)
   */
  enabled?: boolean;

  /**
   * Callback when a new message is received
   */
  onNewMessage: (message: Message) => void;

  /**
   * Current user's participant ID to avoid duplicating own messages
   */
  currentParticipantId?: string | null;

  /**
   * Invite token for polling endpoint (used in dev mode)
   */
  inviteToken?: string | null;

  /**
   * Enable polling fallback (auto-enabled in dev mode)
   */
  enablePolling?: boolean;
}

interface DatabaseMessageRow {
  id: string;
  ask_session_id: string;
  conversation_thread_id: string | null;
  user_id: string | null;
  sender_type: string;
  content: string;
  message_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  parent_message_id: string | null;
  plan_step_id: string | null;
}

/**
 * Transform a database row into a Message object
 */
function formatDatabaseMessage(row: DatabaseMessageRow, askKey: string): Message {
  const metadata = row.metadata ?? {};

  return {
    id: row.id,
    clientId: row.id, // Use server ID as client ID for realtime messages
    askKey,
    askSessionId: row.ask_session_id,
    conversationThreadId: row.conversation_thread_id,
    content: row.content,
    type: (row.message_type as Message['type']) ?? 'text',
    senderType: (row.sender_type as Message['senderType']) ?? 'user',
    senderId: row.user_id,
    senderName: (metadata.senderName as string) ?? (row.sender_type === 'ai' ? 'Agent' : null),
    timestamp: row.created_at ?? new Date().toISOString(),
    metadata: metadata as Message['metadata'],
  };
}

export function useRealtimeMessages({
  conversationThreadId,
  askKey,
  enabled = true,
  onNewMessage,
  currentParticipantId,
  inviteToken,
  enablePolling,
}: UseRealtimeMessagesConfig) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPollTimestampRef = useRef<string | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isTokenExpired, setIsTokenExpired] = useState(false);

  // Auto-enable polling in dev mode
  const isDevMode = typeof window !== 'undefined' &&
    (process.env.NEXT_PUBLIC_IS_DEV === 'true' || localStorage.getItem('dev_mode_override') === 'true');
  const shouldPoll = enablePolling ?? isDevMode;

  // Stable callback ref to avoid recreating subscription
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;

  const handleNewMessage = useCallback((payload: { new: DatabaseMessageRow }) => {
    const row = payload.new;

    // Skip if we've already processed this message (dedup)
    if (processedIdsRef.current.has(row.id)) {
      return;
    }

    // Mark as processed
    processedIdsRef.current.add(row.id);

    // BUG-031 FIX: Limit the set size to prevent memory accumulation in long-running sessions
    // When set exceeds 1000 IDs, keep only the last 500 most recent IDs
    if (processedIdsRef.current.size > 1000) {
      const arr = Array.from(processedIdsRef.current);
      processedIdsRef.current = new Set(arr.slice(-500));
    }

    const message = formatDatabaseMessage(row, askKey);
    onNewMessageRef.current(message);
  }, [askKey]);

  useEffect(() => {
    // Don't subscribe if disabled or no thread ID
    if (!enabled || !conversationThreadId || !supabase) {
      setSubscriptionStatus('idle');
      return;
    }

    let retryCount = 0;
    const maxRetries = 3;
    let retryTimeout: NodeJS.Timeout | null = null;

    const subscribe = async () => {
      setSubscriptionStatus('subscribing');
      setLastError(null);

      // Create channel for this conversation thread
      const channelName = `messages:thread:${conversationThreadId}`;
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_thread_id=eq.${conversationThreadId}`,
          },
          handleNewMessage
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            setSubscriptionStatus('subscribed');
            retryCount = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const errorMessage = err?.message || `Subscription ${status}`;

            // Retry logic with exponential backoff
            if (retryCount < maxRetries) {
              retryCount++;
              const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);

              // Clean up current channel before retry
              if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
              }

              retryTimeout = setTimeout(() => {
                subscribe();
              }, delay);
            } else {
              setSubscriptionStatus('error');
              setLastError(errorMessage);

              // Check if this is a token expiration error
              if (isTokenExpiredError(errorMessage)) {
                setIsTokenExpired(true);
                console.warn('[Realtime] JWT token expired - user needs to refresh session');
              } else {
                console.error('[Realtime] Subscription failed:', errorMessage);
              }
            }
          } else if (status === 'CLOSED') {
            setSubscriptionStatus('idle');
          }
        });

      channelRef.current = channel;
    };

    subscribe();

    // Cleanup on unmount or when dependencies change
    return () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setSubscriptionStatus('idle');
    };
  }, [enabled, conversationThreadId, handleNewMessage]);

  // Clear processed IDs when thread changes
  useEffect(() => {
    processedIdsRef.current.clear();
    lastPollTimestampRef.current = null;
  }, [conversationThreadId]);

  // Polling fallback for dev mode (where Realtime doesn't work without auth)
  useEffect(() => {
    if (!shouldPoll || !enabled || !conversationThreadId || !askKey) {
      return;
    }

    // Only start polling if Realtime isn't working
    // Wait a bit for Realtime to connect first
    const startPollingTimeout = setTimeout(() => {
      if (subscriptionStatus !== 'subscribed') {
        setIsPolling(true);
      }
    }, 2000);

    return () => {
      clearTimeout(startPollingTimeout);
    };
  }, [shouldPoll, enabled, conversationThreadId, askKey, subscriptionStatus]);

  // Polling logic
  useEffect(() => {
    if (!isPolling || !conversationThreadId || !askKey) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const pollForMessages = async () => {
      try {
        // Build the endpoint URL
        const endpoint = inviteToken
          ? `/api/ask/${askKey}/messages?token=${inviteToken}&threadId=${conversationThreadId}`
          : `/api/ask/${askKey}/messages?threadId=${conversationThreadId}`;

        // Add since parameter if we have a last timestamp
        const url = lastPollTimestampRef.current
          ? `${endpoint}&since=${encodeURIComponent(lastPollTimestampRef.current)}`
          : endpoint;

        const response = await fetch(url);
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (!data.success || !data.data?.messages) {
          return;
        }

        const messages: Message[] = data.data.messages;

        // Process new messages
        for (const message of messages) {
          if (!processedIdsRef.current.has(message.id)) {
            processedIdsRef.current.add(message.id);
            onNewMessageRef.current(message);

            // Update last poll timestamp
            if (message.timestamp && (!lastPollTimestampRef.current || message.timestamp > lastPollTimestampRef.current)) {
              lastPollTimestampRef.current = message.timestamp;
            }
          }
        }

        // Limit processed IDs set size
        if (processedIdsRef.current.size > 1000) {
          const arr = Array.from(processedIdsRef.current);
          processedIdsRef.current = new Set(arr.slice(-500));
        }
      } catch (error) {
        // Silent fail - polling will retry
      }
    };

    // Initial poll
    pollForMessages();

    // Set up interval
    pollingIntervalRef.current = setInterval(pollForMessages, POLLING_INTERVAL_MS);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isPolling, conversationThreadId, askKey, inviteToken]);

  return {
    isSubscribed: subscriptionStatus === 'subscribed',
    subscriptionStatus,
    lastError,
    isPolling,
    isTokenExpired,
  };
}
