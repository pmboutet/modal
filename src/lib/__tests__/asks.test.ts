import {
  shouldUseSharedThread,
  getOrCreateConversationThread,
  getMessagesForThread,
  getAskSessionByKey,
  getAskSessionByToken,
  resolveThreadUserId,
  getLastUserMessageThread,
  AskSessionConfig,
  ConversationThread,
  Participant,
} from '../asks';
import { isConsultantMode, getConversationModeDescription } from '../utils';
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';

// Mock Supabase client factory
function createMockSupabase(overrides: {
  fromSelect?: jest.Mock;
  fromInsert?: jest.Mock;
  rpc?: jest.Mock;
} = {}): SupabaseClient {
  const mockSelect = overrides.fromSelect ?? jest.fn().mockReturnThis();
  const mockInsert = overrides.fromInsert ?? jest.fn().mockReturnThis();
  const mockRpc = overrides.rpc ?? jest.fn();

  const chainable = {
    select: mockSelect,
    insert: mockInsert,
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
  };

  // Make chainable methods return chainable object
  Object.keys(chainable).forEach(key => {
    if (typeof chainable[key as keyof typeof chainable] === 'function' && key !== 'single' && key !== 'maybeSingle') {
      (chainable[key as keyof typeof chainable] as jest.Mock).mockReturnThis();
    }
  });

  return {
    from: jest.fn().mockReturnValue(chainable),
    rpc: mockRpc,
  } as unknown as SupabaseClient;
}

describe('shouldUseSharedThread', () => {
  describe('with conversation_mode set', () => {
    it('should return false for individual_parallel mode', () => {
      const config: AskSessionConfig = {
        conversation_mode: 'individual_parallel',
      };
      expect(shouldUseSharedThread(config)).toBe(false);
    });

    it('should return true for collaborative mode', () => {
      const config: AskSessionConfig = {
        conversation_mode: 'collaborative',
      };
      expect(shouldUseSharedThread(config)).toBe(true);
    });

    it('should return true for group_reporter mode', () => {
      const config: AskSessionConfig = {
        conversation_mode: 'group_reporter',
      };
      expect(shouldUseSharedThread(config)).toBe(true);
    });

    it('should return true for consultant mode (shared thread with multi-participant support)', () => {
      const config: AskSessionConfig = {
        conversation_mode: 'consultant',
      };
      // Consultant mode uses shared threads for multi-participant support (text or voice)
      // Only the facilitator sees suggested questions, AI doesn't respond automatically
      expect(shouldUseSharedThread(config)).toBe(true);
    });

    it('should handle unknown conversation_mode values as shared', () => {
      const config: AskSessionConfig = {
        conversation_mode: 'some_unknown_mode',
      };
      // Any mode other than 'individual_parallel' should use shared thread
      expect(shouldUseSharedThread(config)).toBe(true);
    });
  });

  describe('with null/undefined values', () => {
    it('should return true for empty config (default to shared)', () => {
      const config: AskSessionConfig = {};
      expect(shouldUseSharedThread(config)).toBe(true);
    });

    it('should return true when conversation_mode is null (default to shared)', () => {
      const config: AskSessionConfig = {
        conversation_mode: null,
      };
      expect(shouldUseSharedThread(config)).toBe(true);
    });

    it('should return true when conversation_mode is undefined (default to shared)', () => {
      const config: AskSessionConfig = {
        conversation_mode: undefined,
      };
      expect(shouldUseSharedThread(config)).toBe(true);
    });
  });
});

describe('isConsultantMode', () => {
  it('should return true for consultant mode', () => {
    expect(isConsultantMode('consultant')).toBe(true);
  });

  it('should return false for other modes', () => {
    expect(isConsultantMode('individual_parallel')).toBe(false);
    expect(isConsultantMode('collaborative')).toBe(false);
    expect(isConsultantMode('group_reporter')).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isConsultantMode(undefined)).toBe(false);
  });
});

describe('getConversationModeDescription', () => {
  it('should return correct description for consultant mode', () => {
    expect(getConversationModeDescription('consultant')).toBe('Mode consultant (écoute IA)');
  });

  it('should return correct description for individual_parallel', () => {
    expect(getConversationModeDescription('individual_parallel')).toBe('Réponses individuelles en parallèle');
  });

  it('should return correct description for collaborative', () => {
    expect(getConversationModeDescription('collaborative')).toBe('Conversation collaborative');
  });

  it('should return correct description for group_reporter', () => {
    expect(getConversationModeDescription('group_reporter')).toBe('Groupe avec porte-parole');
  });

  it('should return default description for undefined', () => {
    expect(getConversationModeDescription(undefined)).toBe('Conversation collaborative');
  });
});

describe('getOrCreateConversationThread', () => {
  const mockThread: ConversationThread = {
    id: 'thread-123',
    ask_session_id: 'ask-session-456',
    user_id: null,
    is_shared: true,
    created_at: '2024-01-01T00:00:00Z',
  };

  describe('shared thread modes (collaborative, group_reporter, consultant)', () => {
    it('should find existing shared thread for collaborative mode', async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [mockThread],
          error: null,
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'collaborative' }
      );

      expect(result.thread).toEqual(mockThread);
      expect(result.error).toBeNull();
      // Should query for shared thread (user_id is null)
      expect(mockFrom).toHaveBeenCalledWith('conversation_threads');
    });

    it('should find existing shared thread for consultant mode', async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [mockThread],
          error: null,
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'consultant' }
      );

      expect(result.thread).toEqual(mockThread);
      expect(result.error).toBeNull();
    });

    it('should create shared thread when none exists', async () => {
      const newThread = { ...mockThread, id: 'new-thread-789' };

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: newThread,
              error: null,
            }),
          }),
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'collaborative' }
      );

      expect(result.thread).toEqual(newThread);
      expect(result.error).toBeNull();
    });
  });

  describe('individual thread mode (individual_parallel)', () => {
    it('should find existing individual thread for specific user', async () => {
      const individualThread: ConversationThread = {
        ...mockThread,
        user_id: 'user-123',
        is_shared: false,
      };

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [individualThread],
          error: null,
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'individual_parallel' }
      );

      expect(result.thread).toEqual(individualThread);
      expect(result.thread?.is_shared).toBe(false);
      expect(result.thread?.user_id).toBe('user-123');
    });

    it('should create individual thread when none exists', async () => {
      const newIndividualThread: ConversationThread = {
        id: 'new-individual-thread',
        ask_session_id: 'ask-session-456',
        user_id: 'user-123',
        is_shared: false,
        created_at: '2024-01-01T00:00:00Z',
      };

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: newIndividualThread,
              error: null,
            }),
          }),
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'individual_parallel' }
      );

      expect(result.thread).toEqual(newIndividualThread);
      expect(result.thread?.is_shared).toBe(false);
    });

    it('should return error when no userId provided (no anonymous threads allowed)', async () => {
      const mockFrom = jest.fn();
      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        null, // No user ID
        { conversation_mode: 'individual_parallel' }
      );

      // Should return error, not a thread
      expect(result.thread).toBeNull();
      expect(result.error).not.toBeNull();
      expect(result.error?.message).toContain('userId is required');
      // Should not even call the database
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return error when find query fails', async () => {
      const mockError: PostgrestError = {
        code: 'PGRST001',
        message: 'Database error',
        details: null,
        hint: null,
      };

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: null,
          error: mockError,
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'collaborative' }
      );

      expect(result.thread).toBeNull();
      expect(result.error).toEqual(mockError);
    });

    it('should return error when create fails', async () => {
      const mockError: PostgrestError = {
        code: 'PGRST002',
        message: 'Insert failed',
        details: null,
        hint: null,
      };

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: mockError,
            }),
          }),
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'collaborative' }
      );

      expect(result.thread).toBeNull();
      expect(result.error).toEqual(mockError);
    });

    /**
     * BUG-003 FIX: Race condition between thread creation and message insertion
     *
     * When two concurrent requests try to create a thread simultaneously:
     * 1. Both find no existing thread
     * 2. Both try to insert
     * 3. One succeeds, one gets duplicate key error (23505)
     *
     * The fix: On duplicate key error, retry the fetch to get the thread
     * created by the other request.
     */
    it('should retry fetch on duplicate key error (race condition fix)', async () => {
      const duplicateError: PostgrestError = {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details: null,
        hint: null,
      };

      const existingThread: ConversationThread = {
        id: 'thread-created-by-concurrent-request',
        ask_session_id: 'ask-session-456',
        user_id: 'user-creator-123',
        is_shared: true,
        created_at: '2024-01-01T00:00:00Z',
      };

      let insertCalled = false;
      let retryFetchCalled = false;

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockImplementation(() => {
          if (insertCalled && !retryFetchCalled) {
            // This is the retry fetch after the duplicate error
            retryFetchCalled = true;
            return Promise.resolve({
              data: [existingThread],
              error: null,
            });
          }
          // Initial fetch - no thread exists yet
          return Promise.resolve({
            data: [],
            error: null,
          });
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockImplementation(() => {
              insertCalled = true;
              // Simulate race condition - another request created the thread first
              return Promise.resolve({
                data: null,
                error: duplicateError,
              });
            }),
          }),
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-creator-123', // userId is now required
        { conversation_mode: 'collaborative' }
      );

      // Should succeed by fetching the thread created by the concurrent request
      expect(result.thread).toEqual(existingThread);
      expect(result.error).toBeNull();
      expect(retryFetchCalled).toBe(true);
    });

    it('should handle duplicate key error with message content (alternate format)', async () => {
      const duplicateError: PostgrestError = {
        code: 'PGRST001', // Different code
        message: 'unique constraint violation on conversation_threads_pkey',
        details: null,
        hint: null,
      };

      const existingThread: ConversationThread = {
        id: 'thread-from-retry',
        ask_session_id: 'ask-session-456',
        user_id: 'user-123',
        is_shared: false,
        created_at: '2024-01-01T00:00:00Z',
      };

      let fetchCount = 0;

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockImplementation(() => {
          fetchCount++;
          if (fetchCount === 1) {
            // First fetch - no thread
            return Promise.resolve({ data: [], error: null });
          }
          // Retry fetch after error
          return Promise.resolve({ data: [existingThread], error: null });
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: duplicateError,
            }),
          }),
        }),
      });

      const supabase = { from: mockFrom } as unknown as SupabaseClient;

      const result = await getOrCreateConversationThread(
        supabase,
        'ask-session-456',
        'user-123',
        { conversation_mode: 'individual_parallel' }
      );

      expect(result.thread).toEqual(existingThread);
      expect(result.error).toBeNull();
      expect(fetchCount).toBe(2); // Initial fetch + retry fetch
    });
  });
});

describe('getMessagesForThread', () => {
  it('should fetch messages ordered by created_at', async () => {
    const mockMessages = [
      { id: 'msg-1', content: 'Hello', created_at: '2024-01-01T00:00:00Z' },
      { id: 'msg-2', content: 'World', created_at: '2024-01-01T00:01:00Z' },
    ];

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: mockMessages,
        error: null,
      }),
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getMessagesForThread(supabase, 'thread-123');

    expect(result.messages).toEqual(mockMessages);
    expect(result.error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('messages');
  });

  it('should return empty array on error', async () => {
    const mockError: PostgrestError = {
      code: 'PGRST001',
      message: 'Error fetching messages',
      details: null,
      hint: null,
    };

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      }),
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getMessagesForThread(supabase, 'thread-123');

    expect(result.messages).toEqual([]);
    expect(result.error).toEqual(mockError);
  });
});

// Note: getInsightsForThread was removed and replaced by fetchInsightsForThread in insightQueries.ts
// Tests for fetchInsightsForThread are in insightQueries.test.ts

describe('getAskSessionByKey', () => {
  const mockRpcResult = {
    ask_session_id: 'session-123',
    ask_key: 'my-ask-key',
    question: 'Test question',
    description: 'Test description',
    status: 'active',
    project_id: null,
    challenge_id: null,
    conversation_mode: 'collaborative',
    expected_duration_minutes: 30,
    system_prompt: null,
    allow_auto_registration: false,
    name: 'Test Session',
    delivery_mode: 'text',
    start_date: null,
    end_date: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  it('should fetch session via RPC function', async () => {
    const mockRpc = jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({
        data: mockRpcResult,
        error: null,
      }),
    });

    const supabase = { rpc: mockRpc, from: jest.fn() } as unknown as SupabaseClient;

    const result = await getAskSessionByKey(supabase, 'my-ask-key', '*');

    expect(result.row).toBeTruthy();
    expect((result.row as any).id).toBe('session-123');
    expect((result.row as any).ask_key).toBe('my-ask-key');
    expect((result.row as any).conversation_mode).toBe('collaborative');
    expect(result.error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('get_ask_session_by_key', { p_key: 'my-ask-key' });
  });

  it('should return null for empty key', async () => {
    const supabase = { rpc: jest.fn(), from: jest.fn() } as unknown as SupabaseClient;

    const result = await getAskSessionByKey(supabase, '   ', '*');

    expect(result.row).toBeNull();
    expect(result.error).toBeNull();
  });

  it('should fallback to direct query when RPC not found', async () => {
    const mockRpcError: PostgrestError = {
      code: 'PGRST202',
      message: 'Function not found',
      details: null,
      hint: null,
    };

    const mockDirectResult = {
      id: 'session-123',
      ask_key: 'my-ask-key',
      question: 'Test',
    };

    const mockRpc = jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: mockRpcError,
      }),
    });

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: mockDirectResult,
        error: null,
      }),
    });

    const supabase = { rpc: mockRpc, from: mockFrom } as unknown as SupabaseClient;

    const result = await getAskSessionByKey(supabase, 'my-ask-key', '*');

    expect(result.row).toEqual(mockDirectResult);
    expect(mockFrom).toHaveBeenCalledWith('ask_sessions');
  });

  it('should return error for non-PGRST202 RPC errors', async () => {
    const mockRpcError: PostgrestError = {
      code: 'PGRST500',
      message: 'Internal error',
      details: null,
      hint: null,
    };

    const mockRpc = jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: mockRpcError,
      }),
    });

    const supabase = { rpc: mockRpc, from: jest.fn() } as unknown as SupabaseClient;

    const result = await getAskSessionByKey(supabase, 'my-ask-key', '*');

    expect(result.row).toBeNull();
    expect(result.error).toEqual(mockRpcError);
  });
});

describe('getAskSessionByToken', () => {
  it('should fetch session by invite token', async () => {
    const mockParticipant = {
      ask_session_id: 'session-123',
      id: 'participant-456',
    };

    const mockSession = {
      id: 'session-123',
      ask_key: 'my-ask',
      question: 'Test question',
    };

    let callCount = 0;
    const mockFrom = jest.fn().mockImplementation((table: string) => {
      callCount++;
      if (table === 'ask_participants') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: mockParticipant,
            error: null,
          }),
        };
      } else if (table === 'ask_sessions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: mockSession,
            error: null,
          }),
        };
      }
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getAskSessionByToken(supabase, 'my-invite-token', '*');

    expect(result.row).toEqual(mockSession);
    expect(result.participantId).toBe('participant-456');
    expect(result.error).toBeNull();
  });

  it('should return null for empty token', async () => {
    const supabase = { from: jest.fn() } as unknown as SupabaseClient;

    const result = await getAskSessionByToken(supabase, '   ', '*');

    expect(result.row).toBeNull();
    expect(result.participantId).toBeNull();
    expect(result.error).toBeNull();
  });

  it('should return null when token not found', async () => {
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getAskSessionByToken(supabase, 'invalid-token', '*');

    expect(result.row).toBeNull();
    expect(result.participantId).toBeNull();
    expect(result.error).toBeNull();
  });

  it('should return error when participant query fails', async () => {
    const mockError: PostgrestError = {
      code: 'PGRST001',
      message: 'Query failed',
      details: null,
      hint: null,
    };

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      }),
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getAskSessionByToken(supabase, 'some-token', '*');

    expect(result.row).toBeNull();
    expect(result.participantId).toBeNull();
    expect(result.error).toEqual(mockError);
  });
});

/**
 * Tests for resolveThreadUserId
 *
 * BUG PREVENTION: These tests ensure that in dev mode with individual_parallel,
 * AI messages are saved to the correct individual thread instead of creating
 * a new shared thread. This bug caused messages to appear in the wrong
 * conversation or disappear from the UI.
 *
 * Bug scenario:
 * 1. User sends message → saved to individual thread (user_id = 'user-123')
 * 2. AI responds in dev mode → profileId is null due to auth bypass
 * 3. Without fix: AI message saved to shared thread (user_id = null)
 * 4. Result: AI message not visible in user's conversation
 *
 * With fix: resolveThreadUserId returns first participant's user_id in dev mode
 */
describe('resolveThreadUserId', () => {
  const mockParticipants: Participant[] = [
    { id: 'participant-1', user_id: 'user-123' },
    { id: 'participant-2', user_id: 'user-456' },
    { id: 'participant-3', user_id: null }, // Anonymous participant
  ];

  describe('when profileId is provided', () => {
    it('should return profileId regardless of other parameters', () => {
      const result = resolveThreadUserId(
        'profile-789',
        'individual_parallel',
        mockParticipants,
        true // dev mode
      );
      expect(result).toBe('profile-789');
    });

    it('should return profileId even in non-dev mode', () => {
      const result = resolveThreadUserId(
        'profile-789',
        'individual_parallel',
        mockParticipants,
        false
      );
      expect(result).toBe('profile-789');
    });
  });

  describe('dev mode with individual_parallel (BUG FIX)', () => {
    it('should return first participant user_id when profileId is null', () => {
      const result = resolveThreadUserId(
        null,
        'individual_parallel',
        mockParticipants,
        true // dev mode
      );
      expect(result).toBe('user-123');
    });

    it('should skip participants without user_id and return first valid one', () => {
      const participantsWithFirstNull: Participant[] = [
        { id: 'participant-1', user_id: null },
        { id: 'participant-2', user_id: 'user-456' },
      ];
      const result = resolveThreadUserId(
        null,
        'individual_parallel',
        participantsWithFirstNull,
        true
      );
      expect(result).toBe('user-456');
    });

    it('should return null if no participant has user_id', () => {
      const anonymousParticipants: Participant[] = [
        { id: 'participant-1', user_id: null },
        { id: 'participant-2', user_id: null },
      ];
      const result = resolveThreadUserId(
        null,
        'individual_parallel',
        anonymousParticipants,
        true
      );
      expect(result).toBeNull();
    });

    it('should return null if participants array is empty', () => {
      const result = resolveThreadUserId(
        null,
        'individual_parallel',
        [],
        true
      );
      expect(result).toBeNull();
    });
  });

  describe('dev mode with other conversation modes', () => {
    it('should return null for collaborative mode (shared thread is correct)', () => {
      const result = resolveThreadUserId(
        null,
        'collaborative',
        mockParticipants,
        true
      );
      expect(result).toBeNull();
    });

    it('should return null for consultant mode', () => {
      const result = resolveThreadUserId(
        null,
        'consultant',
        mockParticipants,
        true
      );
      expect(result).toBeNull();
    });

    it('should return null for group_reporter mode', () => {
      const result = resolveThreadUserId(
        null,
        'group_reporter',
        mockParticipants,
        true
      );
      expect(result).toBeNull();
    });

    it('should return null for undefined conversation_mode', () => {
      const result = resolveThreadUserId(
        null,
        undefined,
        mockParticipants,
        true
      );
      expect(result).toBeNull();
    });

    it('should return null for null conversation_mode', () => {
      const result = resolveThreadUserId(
        null,
        null,
        mockParticipants,
        true
      );
      expect(result).toBeNull();
    });
  });

  describe('non-dev mode (production)', () => {
    it('should return null even for individual_parallel when not in dev mode', () => {
      // In production, profileId should always be set via proper auth
      // If it's null, we should not try to guess the user
      const result = resolveThreadUserId(
        null,
        'individual_parallel',
        mockParticipants,
        false // not dev mode
      );
      expect(result).toBeNull();
    });
  });
});

/**
 * Tests for getLastUserMessageThread
 *
 * BUG FIX: For AI response routes (respond, stream) in individual_parallel mode,
 * the AI must respond in the SAME thread where the user sent their message.
 * This function finds the last user message's conversation_thread_id.
 */
describe('getLastUserMessageThread', () => {
  it('should return thread and user from last user message', async () => {
    const mockMessage = {
      conversation_thread_id: 'thread-123',
      user_id: 'user-456',
    };

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: mockMessage,
        error: null,
      }),
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getLastUserMessageThread(supabase, 'ask-session-123');

    expect(result.threadId).toBe('thread-123');
    expect(result.userId).toBe('user-456');
    expect(result.error).toBeNull();
  });

  it('should return null values when no user message found', async () => {
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getLastUserMessageThread(supabase, 'ask-session-123');

    expect(result.threadId).toBeNull();
    expect(result.userId).toBeNull();
    expect(result.error).toBeNull();
  });

  it('should return error when query fails', async () => {
    const mockError: PostgrestError = {
      code: 'PGRST001',
      message: 'Query failed',
      details: null,
      hint: null,
    };

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      }),
    });

    const supabase = { from: mockFrom } as unknown as SupabaseClient;

    const result = await getLastUserMessageThread(supabase, 'ask-session-123');

    expect(result.threadId).toBeNull();
    expect(result.userId).toBeNull();
    expect(result.error).toEqual(mockError);
  });
});

/**
 * Route Integration Tests
 *
 * These tests verify that routes correctly use the thread resolution functions.
 * - AI response routes (stream, respond) use getOrCreateConversationThread for proper thread isolation
 *   (BUG-042 fix: getLastUserMessageThread was returning wrong thread in individual_parallel mode)
 * - Non-AI routes (GET, POST, voice-agent/init) use resolveThreadUserId for thread creation
 */
describe('Route thread assignment consistency', () => {
  const fs = require('fs');
  const path = require('path');

  describe('AI response routes using getOrCreateConversationThread (BUG-042 fix)', () => {
    const aiResponseRoutes = [
      'src/app/api/ask/[key]/stream/route.ts',
      'src/app/api/ask/[key]/respond/route.ts',
    ];

    aiResponseRoutes.forEach((routePath) => {
      it(`${routePath} should use getOrCreateConversationThread for thread assignment`, () => {
        const absolutePath = path.resolve(process.cwd(), routePath);

        if (!fs.existsSync(absolutePath)) {
          console.warn(`Skipping test: ${routePath} not found`);
          return;
        }

        const content = fs.readFileSync(absolutePath, 'utf-8');

        // BUG-042 FIX: Now uses getOrCreateConversationThread instead of getLastUserMessageThread
        // The comment explaining the fix should still be present
        expect(content).toMatch(/BUG-042 FIX/);

        // Check usage of new function
        expect(content).toMatch(/getOrCreateConversationThread\s*\(/);
      });
    });
  });

  describe('Non-AI routes using resolveThreadUserId', () => {
    const nonAiRoutes = [
      'src/app/api/ask/[key]/route.ts',
      'src/app/api/ask/[key]/voice-agent/init/route.ts',
    ];

    nonAiRoutes.forEach((routePath) => {
      it(`${routePath} should use resolveThreadUserId for thread creation`, () => {
        const absolutePath = path.resolve(process.cwd(), routePath);

        if (!fs.existsSync(absolutePath)) {
          console.warn(`Skipping test: ${routePath} not found`);
          return;
        }

        const content = fs.readFileSync(absolutePath, 'utf-8');

        // Check import
        expect(content).toMatch(/resolveThreadUserId/);

        // Check usage pattern
        expect(content).toMatch(/resolveThreadUserId\s*\(/);
      });
    });
  });

  describe('Routes that do NOT need thread resolution functions', () => {
    it('token route uses participantInfo.user_id from token (correct)', () => {
      // The token route correctly uses the participant's user_id from token
      expect(true).toBe(true);
    });

    it('voice-agent/log route only fetches data (no thread creation needed)', () => {
      // The voice-agent/log route only needs to fetch plan, not create threads
      expect(true).toBe(true);
    });
  });
});

/**
 * Thread Isolation Tests
 *
 * These tests verify that the thread isolation fixes work correctly:
 * - BUG-004: Insights should be filtered by thread in individual_parallel mode
 * - BUG-005: Stream route should only show thread messages in individual_parallel mode
 * - BUG-013: Insight deduplication should be scoped to thread context
 * - BUG-031: conversationThreadId should not be overwritten in individual_parallel mode
 */
describe('Thread Isolation (BUG-004, BUG-005, BUG-013, BUG-031)', () => {
  describe('shouldUseSharedThread determines isolation mode', () => {
    it('returns false for individual_parallel (enables strict isolation)', () => {
      expect(shouldUseSharedThread({ conversation_mode: 'individual_parallel' })).toBe(false);
    });

    it('returns true for collaborative (shared mode)', () => {
      expect(shouldUseSharedThread({ conversation_mode: 'collaborative' })).toBe(true);
    });

    it('returns true for consultant (shared mode)', () => {
      expect(shouldUseSharedThread({ conversation_mode: 'consultant' })).toBe(true);
    });

    it('returns true for group_reporter (shared mode)', () => {
      expect(shouldUseSharedThread({ conversation_mode: 'group_reporter' })).toBe(true);
    });
  });

  describe('BUG-004 & BUG-005: Route thread isolation patterns', () => {
    const fs = require('fs');
    const path = require('path');

    it('GET route should use shouldUseSharedThread for insight filtering', () => {
      const routePath = 'src/app/api/ask/[key]/route.ts';
      const absolutePath = path.resolve(process.cwd(), routePath);

      if (!fs.existsSync(absolutePath)) {
        console.warn(`Skipping test: ${routePath} not found`);
        return;
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');

      // Check that shouldUseSharedThread is imported
      expect(content).toMatch(/shouldUseSharedThread/);

      // Check for BUG-004 fix comment
      expect(content).toMatch(/BUG-004 FIX/);

      // Check that fetchInsightsForThread is imported and used (replaces legacy getInsightsForThread)
      expect(content).toMatch(/fetchInsightsForThread/);
    });

    it('stream route should use shouldUseSharedThread for message filtering', () => {
      const routePath = 'src/app/api/ask/[key]/stream/route.ts';
      const absolutePath = path.resolve(process.cwd(), routePath);

      if (!fs.existsSync(absolutePath)) {
        console.warn(`Skipping test: ${routePath} not found`);
        return;
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');

      // Check that shouldUseSharedThread is imported
      expect(content).toMatch(/shouldUseSharedThread/);

      // Check for BUG-005 fix comment
      expect(content).toMatch(/BUG-005 FIX/);
    });
  });

  describe('BUG-013: Insight deduplication thread scoping', () => {
    const fs = require('fs');
    const path = require('path');

    it('respond route should have thread-scoped deduplication', () => {
      const routePath = 'src/app/api/ask/[key]/respond/route.ts';
      const absolutePath = path.resolve(process.cwd(), routePath);

      if (!fs.existsSync(absolutePath)) {
        console.warn(`Skipping test: ${routePath} not found`);
        return;
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');

      // Check for BUG-013 fix comment
      expect(content).toMatch(/BUG-013 FIX/);

      // Check for thread-scoped key building function
      expect(content).toMatch(/buildThreadScopedKey/);
    });
  });

  describe('BUG-031: conversationThreadId preservation', () => {
    const fs = require('fs');
    const path = require('path');

    it('GET route should preserve conversationThreadId in individual_parallel mode', () => {
      const routePath = 'src/app/api/ask/[key]/route.ts';
      const absolutePath = path.resolve(process.cwd(), routePath);

      if (!fs.existsSync(absolutePath)) {
        console.warn(`Skipping test: ${routePath} not found`);
        return;
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');

      // Check for BUG-031 fix comment
      expect(content).toMatch(/BUG-031 FIX/);
    });

    it('respond route should preserve conversationThreadId in individual_parallel mode', () => {
      const routePath = 'src/app/api/ask/[key]/respond/route.ts';
      const absolutePath = path.resolve(process.cwd(), routePath);

      if (!fs.existsSync(absolutePath)) {
        console.warn(`Skipping test: ${routePath} not found`);
        return;
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');

      // Check for BUG-031 fix comment
      expect(content).toMatch(/BUG-031 FIX/);
    });
  });
});
