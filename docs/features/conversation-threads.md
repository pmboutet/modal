# Conversation Threads and Session Isolation

This document describes the conversation thread system that provides message isolation and visibility control in ASK sessions.

## Table of Contents

- [Overview](#overview)
- [Database Schema](#database-schema)
- [Conversation Modes](#conversation-modes)
- [Thread Lookup Logic](#thread-lookup-logic)
- [Thread Creation and Management](#thread-creation-and-management)
- [Message and Insight Association](#message-and-insight-association)
- [Realtime Subscriptions](#realtime-subscriptions)
- [RLS Security Policies](#rls-security-policies)
- [API Integration](#api-integration)
- [Code Examples](#code-examples)
- [Troubleshooting](#troubleshooting)

---

## Overview

The conversation thread system provides isolation between participants in ASK sessions. It enables different conversation modes:

- **Shared threads**: All participants see all messages (collaborative, group_reporter, consultant modes)
- **Individual threads**: Each participant has their own isolated conversation (individual_parallel mode)

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Thread** | A logical container for messages and insights within an ASK session |
| **Shared Thread** | `is_shared=true`, `user_id=NULL` - Visible to all session participants |
| **Individual Thread** | `is_shared=false`, `user_id=<profile_id>` - Private to one participant |
| **Conversation Plan** | Each thread has its own AI-generated conversation plan |

---

## Database Schema

### conversation_threads Table

```sql
CREATE TABLE public.conversation_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ask_session_id UUID NOT NULL REFERENCES public.ask_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_shared BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one thread per (session, user) pair
-- For shared threads (user_id IS NULL), multiple can exist per session
-- but in practice we create only one and use .limit(1) queries
CREATE UNIQUE INDEX conversation_threads_unique_idx
  ON public.conversation_threads (ask_session_id, user_id);
```

### Foreign Key References

Messages and insights reference threads via `conversation_thread_id`:

```sql
-- In messages table
ALTER TABLE public.messages
  ADD COLUMN conversation_thread_id UUID
  REFERENCES public.conversation_threads(id) ON DELETE SET NULL;

-- In insights table
ALTER TABLE public.insights
  ADD COLUMN conversation_thread_id UUID
  REFERENCES public.conversation_threads(id) ON DELETE SET NULL;
```

### Conversation Plans Association

Each thread has at most one conversation plan:

```sql
CREATE TABLE public.ask_conversation_plans (
  id UUID PRIMARY KEY,
  conversation_thread_id UUID UNIQUE NOT NULL
    REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  -- ... other fields
);
```

---

## Conversation Modes

The `conversation_mode` field on `ask_sessions` determines thread behavior:

| Mode | Thread Type | Visibility | Use Case |
|------|-------------|------------|----------|
| `individual_parallel` | Individual | Private | Multiple people respond individually, no cross-visibility |
| `collaborative` | Shared | Everyone | Multi-voice conversation, everyone sees everything |
| `group_reporter` | Shared | Everyone | Group contributes, one reporter consolidates |
| `consultant` | Shared | Everyone | AI listens and suggests questions, no TTS |

### Mode Detection Logic

```typescript
// src/lib/asks.ts
export function shouldUseSharedThread(askSession: AskSessionConfig): boolean {
  // Only individual_parallel uses individual threads
  const individualModes = ['individual_parallel'];
  return !individualModes.includes(askSession.conversation_mode ?? '');
}
```

---

## Thread Lookup Logic

### Key Helper Functions

Located in `src/lib/asks.ts`:

#### 1. shouldUseSharedThread()

Determines if a session should use shared or individual threads:

```typescript
export function shouldUseSharedThread(askSession: AskSessionConfig): boolean {
  const individualModes = ['individual_parallel'];
  return !individualModes.includes(askSession.conversation_mode ?? '');
}
```

#### 2. resolveThreadUserId()

Determines the user ID for thread operations, with dev mode support:

```typescript
export function resolveThreadUserId(
  profileId: string | null,
  conversationMode: string | null | undefined,
  participants: Participant[],
  isDevMode: boolean
): string | null {
  // If we have a profileId, use it
  if (profileId) {
    return profileId;
  }

  // In dev mode with individual_parallel, use first participant's user_id
  if (isDevMode && conversationMode === 'individual_parallel') {
    const firstParticipant = participants.find(p => p.user_id);
    if (firstParticipant?.user_id) {
      return firstParticipant.user_id;
    }
  }

  // Default: return null (will use shared thread fallback)
  return null;
}
```

#### 3. getOrCreateConversationThread()

Main function for thread management:

```typescript
export async function getOrCreateConversationThread(
  supabase: SupabaseClient,
  askSessionId: string,
  userId: string | null,
  askConfig: AskSessionConfig
): Promise<{ thread: ConversationThread | null; error: PostgrestError | null }>
```

**Logic flow:**

1. Determine if shared thread is needed via `shouldUseSharedThread()`
2. For shared mode: Look for existing thread with `is_shared=true`, `user_id=NULL`
3. For individual mode: Look for thread with `user_id=<userId>`, `is_shared=false`
4. If no thread found, create a new one
5. For individual mode without userId, fallback to shared thread

#### 4. getConversationThreadId()

Simple lookup by session and optional user:

```typescript
export async function getConversationThreadId(
  client: SupabaseClient,
  askSessionId: string,
  profileId: string | null
): Promise<string | null> {
  const query = client
    .from('conversation_threads')
    .select('id')
    .eq('ask_session_id', askSessionId);

  if (profileId) {
    query.eq('user_id', profileId);
  } else {
    query.eq('is_shared', true);
  }

  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}
```

#### 5. getLastUserMessageThread()

For AI response routes - ensures AI responds in the same thread as the user's message:

```typescript
export async function getLastUserMessageThread(
  supabase: SupabaseClient,
  askSessionId: string
): Promise<{ threadId: string | null; userId: string | null; error: PostgrestError | null }>
```

This is critical for `individual_parallel` mode to ensure AI responses go to the correct participant's thread.

---

## Thread Creation and Management

### Automatic Thread Creation

Threads are created automatically when:

1. A user accesses an ASK session (GET `/api/ask/[key]`)
2. A user sends a message (POST `/api/ask/[key]`)

### RPC Functions for Thread Operations

#### get_or_create_conversation_thread()

```sql
CREATE OR REPLACE FUNCTION public.get_or_create_conversation_thread(
  p_ask_session_id uuid,
  p_user_id uuid,
  p_use_shared boolean
)
RETURNS TABLE (
  thread_id uuid,
  ask_session_id uuid,
  user_id uuid,
  is_shared boolean,
  created_at timestamptz,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

This function bypasses RLS to create threads even for anonymous token-based participants.

#### get_conversation_thread_by_token()

```sql
CREATE OR REPLACE FUNCTION public.get_conversation_thread_by_token(p_token TEXT)
RETURNS TABLE (
  thread_id UUID,
  ask_session_id UUID,
  user_id UUID,
  is_shared BOOLEAN,
  created_at TIMESTAMPTZ
)
```

Used for invite token authentication - returns the correct thread based on conversation mode:
- For `individual_parallel`: Returns the participant's specific thread
- For other modes: Returns the shared thread

---

## Message and Insight Association

### Messages

Every message is associated with a thread via `conversation_thread_id`:

```typescript
// When inserting a message
const insertPayload = {
  ask_session_id: askRow.id,
  content: body.content,
  user_id: finalProfileId,
  conversation_thread_id: conversationThread?.id ?? null,
  // ...
};
```

### Insights

Insights are also scoped to threads:

```typescript
// Insight creation includes thread reference
const insight: Insight = {
  askSessionId,
  conversationThreadId: thread?.id ?? null,
  // ...
};
```

### Querying by Thread

```typescript
// Get messages for a specific thread
export async function getMessagesForThread(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ messages: any[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_thread_id', threadId)
    .order('created_at', { ascending: true });

  return { messages: data ?? [], error };
}

// Get insights for a specific thread
export async function getInsightsForThread(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ insights: any[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('insights')
    .select('*')
    .eq('conversation_thread_id', threadId)
    .order('created_at', { ascending: true });

  return { insights: data ?? [], error };
}
```

---

## Realtime Subscriptions

### useRealtimeMessages Hook

Located in `src/hooks/useRealtimeMessages.ts`, this hook provides real-time message synchronization for shared thread modes.

#### Configuration

```typescript
interface UseRealtimeMessagesConfig {
  conversationThreadId: string | null;
  askKey: string;
  enabled?: boolean;
  onNewMessage: (message: Message) => void;
  currentParticipantId?: string | null;
  inviteToken?: string | null;
  enablePolling?: boolean; // Auto-enabled in dev mode
}
```

#### Subscription Logic

```typescript
// Subscribe to INSERT events on messages table filtered by thread
const channel = supabase
  .channel(`messages:thread:${conversationThreadId}`)
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
  .subscribe();
```

#### Polling Fallback

In dev mode where Realtime may not work without auth, the hook falls back to polling:

```typescript
// GET /api/ask/[key]/messages?threadId=xxx&since=<timestamp>
const endpoint = `/api/ask/${askKey}/messages?threadId=${conversationThreadId}`;
```

---

## RLS Security Policies

### Thread Access Policy

```sql
-- Service role full access
CREATE POLICY "Service role can manage conversation threads"
  ON public.conversation_threads FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

### Message Access via Thread

```sql
-- Policy for realtime subscriptions (works with auth.uid())
CREATE POLICY "Realtime thread participants"
ON messages FOR SELECT
USING (
  conversation_thread_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM conversation_threads ct
    JOIN ask_participants ap ON ap.ask_session_id = ct.ask_session_id
    JOIN profiles p ON p.id = ap.user_id
    WHERE ct.id = messages.conversation_thread_id
    AND ct.is_shared = true
    AND p.auth_id = auth.uid()
  )
);
```

### Helper Function for Thread Access

```sql
CREATE OR REPLACE FUNCTION public.can_access_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Get thread info
  SELECT ask_session_id, is_shared INTO v_ask_session_id, v_is_shared
  FROM conversation_threads
  WHERE id = p_thread_id;

  IF v_is_shared THEN
    -- Check if user is a participant
    RETURN EXISTS (
      SELECT 1 FROM ask_participants
      WHERE ask_session_id = v_ask_session_id
      AND user_id = current_user_id()
    );
  END IF;

  -- For individual threads, check ownership
  RETURN EXISTS (
    SELECT 1 FROM conversation_threads
    WHERE id = p_thread_id
    AND user_id = current_user_id()
  );
END;
$$;
```

---

## API Integration

### GET /api/ask/[key]

Returns session data including thread ID:

```json
{
  "success": true,
  "data": {
    "ask": { ... },
    "messages": [ ... ],
    "insights": [ ... ],
    "conversationPlan": { ... },
    "conversationThreadId": "uuid-of-thread",
    "viewer": { ... }
  }
}
```

Thread determination flow:

1. Load auth context (token or session)
2. Determine `threadProfileId` via `resolveThreadUserId()`
3. Call `getOrCreateConversationThread()`
4. Filter messages by thread (strict isolation in individual_parallel mode)
5. Return thread ID for client-side realtime subscriptions

### POST /api/ask/[key]

Creates a message in the correct thread:

1. Authenticate user (token or session)
2. Determine thread via `getOrCreateConversationThread()`
3. Insert message with `conversation_thread_id`

### GET /api/ask/[key]/messages

Polling endpoint for messages:

```typescript
// Query params
?threadId=<uuid>        // Required
&since=<ISO timestamp>  // Optional - incremental updates
&token=<invite token>   // Optional - authentication
```

---

## Code Examples

### Creating a Thread

```typescript
import { getOrCreateConversationThread, shouldUseSharedThread } from '@/lib/asks';

const askConfig = {
  conversation_mode: askSession.conversation_mode,
};

const { thread, error } = await getOrCreateConversationThread(
  supabase,
  askSessionId,
  profileId, // null for shared thread
  askConfig
);

if (thread) {
  console.log('Thread ID:', thread.id);
  console.log('Is shared:', thread.is_shared);
}
```

### Getting the Correct Thread for a User

```typescript
import { getConversationThreadId, resolveThreadUserId } from '@/lib/asks';

// Determine the user ID for thread lookup
const threadUserId = resolveThreadUserId(
  profileId,
  askSession.conversation_mode,
  participants,
  isDevMode
);

// Get thread ID
const threadId = await getConversationThreadId(
  supabase,
  askSessionId,
  threadUserId
);
```

### Subscribing to Thread Messages (Client)

```typescript
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';

function ChatComponent({ askKey, conversationThreadId }) {
  const handleNewMessage = useCallback((message: Message) => {
    // Add message to state if not already present
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  const { isSubscribed, isPolling } = useRealtimeMessages({
    conversationThreadId,
    askKey,
    enabled: true,
    onNewMessage: handleNewMessage,
    inviteToken, // For token-based auth
  });

  return (
    <div>
      {isPolling && <span>Using polling fallback</span>}
      {/* Messages list */}
    </div>
  );
}
```

### SQL: Check Thread Isolation

```bash
# Verify threads for an ASK session
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT
  ct.id as thread_id,
  ct.is_shared,
  ct.user_id,
  p.email as user_email,
  (SELECT COUNT(*) FROM messages m WHERE m.conversation_thread_id = ct.id) as message_count
FROM conversation_threads ct
LEFT JOIN profiles p ON p.id = ct.user_id
WHERE ct.ask_session_id = (SELECT id FROM ask_sessions WHERE ask_key = 'your-ask-key');
"
```

---

## Troubleshooting

### Common Issues

#### Messages Not Showing for Participant

**Symptoms:** Participant sees no messages or only their own messages.

**Causes:**
1. Thread not created for the participant
2. Messages associated with wrong thread
3. individual_parallel mode with missing user_id

**Debug:**

```bash
# Check threads for session
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT ct.*, p.email
FROM conversation_threads ct
LEFT JOIN profiles p ON p.id = ct.user_id
WHERE ct.ask_session_id = '<session-id>';
"

# Check message thread associations
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT m.id, m.content, m.conversation_thread_id, m.user_id
FROM messages m
WHERE m.ask_session_id = '<session-id>'
ORDER BY m.created_at;
"
```

#### Realtime Not Receiving Messages

**Symptoms:** New messages don't appear in real-time.

**Causes:**
1. RLS policy blocking subscription
2. Thread ID mismatch
3. Dev mode without polling enabled

**Solutions:**
1. Verify thread ID is correct in subscription
2. Check RLS policies for messages table
3. Enable polling fallback in dev mode

#### AI Responding to Wrong Thread

**Symptoms:** AI responses appear in wrong participant's conversation.

**Cause:** Using `resolveThreadUserId()` instead of `getLastUserMessageThread()` in response routes.

**Solution:** In AI response routes (stream, respond), use `getLastUserMessageThread()` to find the thread from the last user message:

```typescript
const { threadId, userId } = await getLastUserMessageThread(
  supabase,
  askSessionId
);
```

### RLS Debug Commands

```bash
# Check if RLS is enabled
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'conversation_threads';
"

# List RLS policies
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'conversation_threads';
"
```

---

## Related Documentation

- [Database Schema](../architecture/database-schema.md) - Full schema reference
- [RLS Permissions Matrix](../security/rls-permissions-matrix.md) - Security policies overview
- [Conversation Plan System](./conversation-plan.md) - How plans integrate with threads

---

## Migration History

| Migration | Description |
|-----------|-------------|
| 040 | Initial conversation_threads table |
| 055 | Fix service role permissions |
| 090 | Add get_or_create_conversation_thread RPC |
| 091 | Fix RPC variable assignments |
| 098 | Add thread-based RLS policy for realtime |
| 109 | Add get_conversation_thread_by_token RPC |
