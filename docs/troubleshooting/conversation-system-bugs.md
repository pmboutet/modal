# Conversation System - Bug Report

> **Generated**: 2026-01-17
> **Last Updated**: 2026-01-17
> **Status**: 35/35 Phase 1 bugs resolved | 60 Phase 2 bugs identified (by conversation type)

---

## Table of Contents

1. [Critical Bugs](#critical-bugs)
2. [High Severity Bugs](#high-severity-bugs)
3. [Medium Severity Bugs](#medium-severity-bugs)
4. [Low Severity Bugs](#low-severity-bugs)
5. [Summary by Module](#summary-by-module)
6. [Phase 2: Bugs by Conversation Type](#phase-2-bugs-by-conversation-type)
   - [Individual Parallel Mode](#individual-parallel-mode)
   - [Shared Thread Mode](#shared-thread-mode)
   - [Voice Mode (Extended)](#voice-mode-extended)
   - [Consultant Mode (Extended)](#consultant-mode-extended)
   - [Conversation Plan & Steps](#conversation-plan--steps)

---

## Critical Bugs

### BUG-001: Missing Error Handling in POST Route request.json()
**Module:** Text Chat / API
**Severity:** CRITICAL
**File:** `src/app/api/ask/[key]/route.ts:813`
**Status:** ✅ RESOLVED

**Description:**
The `await request.json()` call can fail with a SyntaxError if the client sends invalid JSON, but there's no try-catch wrapper around it.

**Resolution:** Added try-catch wrapper around `request.json()` that returns a 400 Bad Request with a clear error message.

---

### BUG-002: Missing `await` on processUserMessage() in Consultant Mode
**Module:** Voice Mode
**Severity:** CRITICAL
**File:** `src/lib/ai/speechmatics.ts:532`
**Status:** ✅ RESOLVED

**Description:**
In consultant mode (`disableLLM=true`), when processing queued messages, the code calls `processUserMessage()` without `await`.

**Resolution:** Added `await` and try-catch wrapper to properly handle errors and prevent state inconsistency.

---

### BUG-003: Race Condition in Thread Creation Without Unique Index for NULL
**Module:** Conversation Threads
**Severity:** CRITICAL
**File:** `src/lib/asks.ts:283-322`
**Status:** ✅ RESOLVED

**Description:**
For shared threads (user_id = NULL), PostgreSQL's unique index doesn't prevent duplicates because NULL values are considered distinct.

**Resolution:**
- Created migration `134_fix_shared_thread_unique_constraint.sql`
- Cleaned up 4 existing duplicate shared threads
- Added partial unique index `conversation_threads_shared_unique_idx`
- Code already handles duplicate key errors with retry logic

---

### BUG-004: Participant Data Exposure via RPC Functions
**Module:** Security
**Severity:** MEDIUM (downgraded after review)
**File:** `src/app/api/ask/token/[token]/route.ts:85-232`
**Status:** ✅ REVIEWED - NOT A BUG

**Description:**
Initial concern was that participant data could leak across sessions.

**Resolution:**
After code review, the data fetching is properly scoped:
- Participants are fetched with `.eq('ask_session_id', askRow.ask_session_id)` (line 121)
- Profiles are only fetched for user_ids from messages belonging to this session
- All data is scoped to the validated ask_session

This is expected behavior for session participants to see each other's basic info.

---

### BUG-005: Message Isolation Bypass in Individual Parallel Mode
**Module:** Security / Conversation Threads
**Severity:** CRITICAL
**File:** `src/app/api/ask/[key]/message/[messageId]/route.ts:253-276`
**Status:** ✅ RESOLVED

**Description:**
When deleting subsequent messages, the code only filters by `conversation_thread_id` if the message has one.

**Resolution:**
Added thread isolation check using `shouldUseSharedThread()`:
- In individual_parallel mode, deletion is blocked if message lacks thread_id
- Added import for `shouldUseSharedThread` from asks.ts
- Added `conversation_mode` to ask_sessions select query

---

## High Severity Bugs

### BUG-006: Missing `await` on validateBargeInWithTranscript()
**Module:** Voice Mode
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics.ts:379,407`
**Status:** ✅ REVIEWED - INTENTIONAL

**Description:**
The `validateBargeInWithTranscript()` method is async but invoked without `await`.

**Resolution:** After review, this is intentional "fire-and-forget" behavior. The barge-in validation runs asynchronously to avoid blocking the transcript processing. The method handles its own errors internally.

---

### BUG-007: Logic Error in findIndex() for Error Recovery
**Module:** Voice Mode
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics-transcription.ts:307-314`
**Status:** ✅ RESOLVED

**Description:**
The error recovery code uses flawed `findIndex()` logic that could remove the wrong message if duplicates exist.

**Resolution:** Simplified the logic to directly check and pop the last element if it matches, using `pop()` instead of `splice(findIndex())`.

---

### BUG-008: Missing User Feedback on Recording Errors
**Module:** Text Chat
**Severity:** HIGH
**File:** `src/components/chat/ChatComponent.tsx:376-378`
**Status:** ✅ RESOLVED

**Description:**
When `navigator.mediaDevices.getUserMedia()` fails, only a console.error is logged. User receives no UI feedback.

**Resolution:** Added `recordingError` state with error-specific messages (NotAllowedError → "Microphone access denied", NotFoundError → "No microphone found", etc.) and UI display to inform the user.

---

### BUG-009: MediaRecorder Stream Leak on Component Unmount
**Module:** Text Chat
**Severity:** HIGH
**File:** `src/components/chat/ChatComponent.tsx:351-379`
**Status:** ✅ RESOLVED

**Description:**
When the component unmounts during recording, the MediaRecorder stream's audio tracks are never stopped.

**Resolution:** Added cleanup in the existing useEffect to stop MediaRecorder and release all tracks on unmount:
```typescript
if (mediaRecorderRef.current?.state === 'recording') {
  mediaRecorderRef.current.stop();
}
mediaRecorderRef.current?.stream?.getTracks().forEach(track => track.stop());
```

---

### BUG-010: Stale Closure in handleSpeakerAssignmentConfirm
**Module:** Consultant Mode
**Severity:** HIGH
**File:** `src/components/chat/PremiumVoiceInterface.tsx:1152-1157`
**Status:** ✅ RESOLVED

**Description:**
The `onSpeakerMappingChange` callback captures stale `speakerMappings` state through a setTimeout.

**Resolution:** Used functional setState update pattern to access current state:
```typescript
setSpeakerMappings(currentMappings => {
  setTimeout(() => onSpeakerMappingChange(currentMappings), 0);
  return currentMappings;
});
```

---

### BUG-011: Insight Thread ID Override in Shared Mode
**Module:** Conversation Threads
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/respond/route.ts:1631-1647`
**Status:** ✅ RESOLVED (via BUG-031 FIX)

**Description:**
Insights were being overridden with the current conversation thread ID in shared modes.

**Resolution:** Fixed with BUG-031 FIX - the code now uses `shouldUseSharedThread()` to only override thread ID in shared modes. In individual_parallel mode, the original thread ID is preserved.

---

### BUG-012: Missing Thread Isolation in Insight Retrieval
**Module:** Conversation Threads
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/respond/route.ts:1612-1629`
**Status:** ✅ RESOLVED

**Description:**
If there's no conversationThread in individual_parallel mode, ALL session insights were returned.

**Resolution:** Added check using `shouldUseSharedThread()` - in individual_parallel mode without a thread, returns empty insights array to maintain isolation:
```typescript
} else if (!shouldUseSharedThread(askConfig)) {
  console.warn('[respond] Individual parallel mode without thread - returning empty insights for isolation');
  insightRows = [];
}
```

---

### BUG-013: Unvalidated Participant ID in Speaker Assignment
**Module:** Security
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/messages/speaker-assignment/route.ts:131-142`
**Status:** ✅ RESOLVED

**Description:**
The speaker assignment endpoint fetched participant without validating it belongs to the current ask_session.

**Resolution:** Added session validation to the participant query:
```typescript
.eq('id', validatedBody.participantId)
.eq('ask_session_id', askSession.id) // BUG-013 FIX
```

---

### BUG-014: Consultant Mode Not Fully Blocking AI Response
**Module:** Consultant Mode
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/respond/route.ts:2050-2055`
**Status:** ✅ RESOLVED

**Description:**
The `insightsOnly` code path was using stale AI responses even in consultant mode.

**Resolution:** Added consultant mode check in the else block:
```typescript
// BUG-014 FIX: In consultant mode, use empty string since AI doesn't generate responses
latestAiResponse = isConsultantMode ? '' : latestAiMessage.content;
```

---

## Medium Severity Bugs

### BUG-015: Race Condition in File Promise.all()
**Module:** Text Chat
**Severity:** MEDIUM
**File:** `src/components/chat/ChatComponent.tsx:241-269`

**Description:**
If `onSendMessage` callback fails silently or if one file fails to process, subsequent files are still processed. The text message is sent anyway, creating inconsistency.

**Impact:** Files may fail silently, user believes all content was sent but only partial content was transmitted.

---

### BUG-016: Race Condition in setCurrentAssistantSpeech() Clearing Logic
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:1139-1151`

**Description:**
Race window exists where echo detection reads stale content while the clearing timer is about to fire.

---

### BUG-017: Static Quota Error Timestamp Persists Across Instances
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-websocket.ts:17,70-77`

**Description:**
The `lastQuotaErrorTimestamp` is a static class variable shared across ALL instances. If one instance experiences a quota error, ALL subsequent instances will enforce the 10-second delay.

**Suggested Fix:**
Only enforce the delay if the quota error was within the last 15 seconds.

---

### BUG-018: Message Handler Restoration Doesn't Preserve Dynamic Changes
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-websocket.ts:500,58-62`

**Description:**
On reconnect, only the initial handler is restored, not the current one if `setMessageHandler()` was called dynamically.

---

### BUG-019: Unhandled Promise in Error Processing Queue
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics.ts:687-691`

**Description:**
If `processUserMessage()` throws synchronously, the catch won't handle it.

**Suggested Fix:**
Wrap in try-catch at the callback level with async/await.

---

### BUG-020: Missing Interval Cleanup in useConsultantAnalysis
**Module:** Consultant Mode
**Severity:** MEDIUM
**File:** `src/hooks/useConsultantAnalysis.ts:326-356`

**Description:**
The interval checks `isPaused` inside the callback with a stale closure value.

---

### BUG-021: Race Condition in notifySpeakerChange
**Module:** Consultant Mode
**Severity:** MEDIUM
**File:** `src/hooks/useConsultantAnalysis.ts:289-297`

**Description:**
Multiple rapid speaker changes could trigger multiple concurrent API calls to the consultant-analyze endpoint.

**Suggested Fix:**
Add a check if analysis is already running before calling performAnalysis.

---

### BUG-022: Message Thread ID Not Validated in Stream Route
**Module:** Conversation Threads
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/stream/route.ts:538`

**Description:**
If `conversationThread` is null in individual_parallel mode, the message is inserted without a thread ID.

**Suggested Fix:**
Validate thread exists before inserting in individual_parallel mode.

---

### BUG-023: Insight Detection Job Race Condition
**Module:** Conversation Threads
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/respond/route.ts:1165-1185`

**Description:**
String matching on error messages is fragile for distinguishing "job already running" from other unique constraint violations.

---

### BUG-024: Plan Step Completion Without Proper Error Handling
**Module:** Conversation Threads
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/stream/route.ts:596-640`

**Description:**
If `completeStep()` fails, the stream sends a `step_completed` event anyway, creating a disconnect between UI and database state.

---

### BUG-025: Step Summary Generation Doesn't Retry on Failure
**Module:** Conversation Threads
**Severity:** MEDIUM
**File:** `src/lib/ai/conversation-plan.ts:488-558`

**Description:**
Network issues cause step completion to fail entirely with no retry mechanism.

---

### BUG-026: Invite Token Not Properly Validated in Messages Endpoint
**Module:** Security
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/messages/route.ts:86-100`
**Status:** ✅ RESOLVED

**Description:**
Token validation didn't check if the requested threadId belongs to the ask_session, allowing cross-session message access.

**Resolution:** Added thread ownership validation before fetching messages:
```typescript
const { data: thread } = await dataClient
  .from('conversation_threads')
  .select('id, ask_session_id')
  .eq('id', threadId)
  .maybeSingle();

if (!thread || thread.ask_session_id !== askRow.id) {
  return 403; // Thread not found or doesn't belong to this session
}
```

---

### BUG-027: Message Content Not Sanitized Before Storage
**Module:** Security
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/route.ts:815-820`
**Status:** ✅ RESOLVED

**Description:**
User message content was inserted directly without sanitization, risking XSS attacks.

**Resolution:** Added sanitization using existing `sanitizeText()` function:
```typescript
import { sanitizeText } from '@/lib/sanitize';
// ...
const sanitizedContent = sanitizeText(body.content);
```

---

### BUG-028: Insufficient Authorization in Message Editing
**Module:** Security
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/message/[messageId]/route.ts:208-215`
**Status:** ✅ RESOLVED

**Description:**
The ownership check could be bypassed if profileId was null (e.g., profile lookup failure).

**Resolution:** Added explicit check for profileId before ownership verification:
```typescript
// BUG-028 FIX: Require valid profile for authorization
if (!isDevBypass && !profileId) {
  return permissionDeniedResponse();
}
```

---

## Low Severity Bugs

### BUG-029: Potential Memory Leak in Audio Buffer Decoding
**Module:** Voice Mode
**Severity:** LOW
**File:** `src/lib/ai/speechmatics-audio.ts:1079-1082`

**Description:**
Creating a new `Uint8Array` wrapper can cause the original data to be copied unnecessarily.

---

### BUG-030: Inconsistent Error Messages in Authentication Flows
**Module:** Text Chat / API
**Severity:** LOW
**File:** `src/app/api/ask/[key]/route.ts:241-258`

**Description:**
Some permission errors return 403, others return 401, making client-side error handling unpredictable.

---

### BUG-031: Memory Accumulation in Processed IDs Set
**Module:** Text Chat
**Severity:** LOW
**File:** `src/hooks/useRealtimeMessages.ts:144-147`

**Description:**
Over long-running sessions, the processedIdsRef set size can exceed limits.

---

### BUG-032: Missing Dependency in useCallback for speakerMappings
**Module:** Consultant Mode
**Severity:** LOW
**File:** `src/components/chat/PremiumVoiceInterface.tsx:1158`

**Description:**
Including `speakerMappings` in dependency array causes unnecessary callback recreation.

---

### BUG-033: Incomplete Speaker Tracking in handleMessage
**Module:** Consultant Mode
**Severity:** LOW
**File:** `src/components/chat/PremiumVoiceInterface.tsx:842-865`

**Description:**
Speaker detection only adds speakers on non-interim messages, causing delayed detection.

---

### BUG-034: Message ID Collision Risk in parseConsultantHelperResponse
**Module:** Consultant Mode
**Severity:** LOW
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:64-68`

**Description:**
Using `Date.now()` for IDs risks collisions if multiple analyses trigger within the same millisecond.

---

### BUG-035: Token Prefix Logging
**Module:** Security
**Severity:** LOW
**File:** `src/app/api/ask/token/[token]/route.ts:262`

**Description:**
Token prefixes are logged, which can be a security risk.

**Suggested Fix:**
Use placeholder like `[TOKEN]` instead of actual token data in logs.

---

### BUG-036: Insight Deduplication Key Doesn't Include Type First
**Module:** Conversation Threads
**Severity:** LOW
**File:** `src/app/api/ask/[key]/respond/route.ts:737-742`

**Description:**
Type is included at the end of deduplication key. Two insights with identical content but different types may be treated as duplicates.

---

## Summary by Module (Phase 1 - All Resolved ✅)

| Module | Critical | High | Medium | Low | Total | Status |
|--------|----------|------|--------|-----|-------|--------|
| Text Chat | 1 | 2 | 1 | 2 | 6 | ✅ |
| Voice Mode | 1 | 2 | 4 | 1 | 8 | ✅ |
| Consultant Mode | 0 | 2 | 2 | 3 | 7 | ✅ |
| Conversation Threads | 1 | 2 | 4 | 1 | 8 | ✅ |
| Security | 2 | 1 | 2 | 1 | 6 | ✅ |
| **Total** | **5** | **9** | **13** | **8** | **35** | ✅ |

> All Phase 1 bugs have been resolved. See Phase 2 section for newly identified bugs organized by conversation type.

---

## Priority Action Items (Phase 1 - All Completed ✅)

### Immediate (P0) - ✅ COMPLETED
1. ~~**BUG-001**: Missing JSON error handling in POST route~~
2. ~~**BUG-002**: Missing await in consultant mode processUserMessage~~
3. ~~**BUG-003**: Race condition in shared thread creation~~
4. ~~**BUG-004**: Participant data exposure via RPC~~ (Reviewed - Not a bug)
5. ~~**BUG-005**: Message isolation bypass~~

### Short-term (P1) - ✅ COMPLETED
6. ~~**BUG-006**: Missing await on validateBargeInWithTranscript~~ (Intentional)
7. ~~**BUG-007**: Logic error in findIndex for error recovery~~
8. ~~**BUG-011**: Insight thread ID override~~
9. ~~**BUG-012**: Missing thread isolation in insight retrieval~~
10. ~~**BUG-013**: Unvalidated participant ID in speaker assignment~~

### Medium-term (P2) - ✅ COMPLETED
11. ~~All remaining HIGH severity bugs~~
12. ~~Security-related MEDIUM bugs (BUG-026, BUG-027, BUG-028)~~
13. ~~Voice mode stability bugs (BUG-016 to BUG-019, BUG-029)~~

> **See Phase 2 section below for newly identified bugs.**

---

## Phase 2: Bugs by Conversation Type

> **Analysis Date**: 2026-01-17
> **Total Bugs Found**: 61 (2 Critical, 19 High, 31 Medium, 9 Low)
> **Resolved**: 1 (BUG-IP-009)

---

### Individual Parallel Mode

Bugs related to `individual_parallel` conversation mode where each participant has their own isolated thread.

#### BUG-IP-001: Voice Agent Init Uses Wrong Thread Resolution
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/voice-agent/init/route.ts:82-100`
**Status:** 🔴 OPEN

**Description:**
The voice agent init route uses `resolveThreadUserId()` which falls back to the "first participant" in dev mode. Unlike `stream` and `respond` routes which use `getLastUserMessageThread()`, voice init picks the first participant, violating thread isolation.

**Impact:** Voice messages may be saved to the wrong participant's thread.

---

#### BUG-IP-002: Missing Thread Ownership Validation in Messages Route
**Severity:** CRITICAL
**File:** `src/app/api/ask/[key]/messages/route.ts:102-120`
**Status:** 🔴 OPEN

**Description:**
The route validates thread belongs to ask_session (BUG-026 FIX) but does NOT validate that the requesting user/participant owns that specific thread. A user could fetch messages from another participant's thread by guessing the thread ID.

**Impact:** Thread isolation vulnerability - Participant A could fetch Participant B's messages.

---

#### BUG-IP-003: Potential NULL Thread ID in AI Message Insert
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/respond/route.ts:1823-1830`
**Status:** 🔴 OPEN

**Description:**
The route doesn't validate that `conversationThread` is set before calling `insertAiMessage()`. If thread resolution fails silently, AI messages get inserted with `conversation_thread_id = NULL`, breaking isolation.

---

#### BUG-IP-004: Inconsistent Insight Isolation Logic
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/route.ts:663-693` vs `respond/route.ts:1620-1639`
**Status:** 🔴 OPEN

**Description:**
The insight filtering logic differs between `route.ts` (GET) and `respond/route.ts`. The conditional order is confusing and error-prone, potentially causing insight leakage.

---

#### BUG-IP-005: Step Complete Uses Wrong Thread Resolution
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/step-complete/route.ts:91-104`
**Status:** 🔴 OPEN

**Description:**
Uses `resolveThreadUserId()` instead of `getLastUserMessageThread()` to find thread before completing a step. Could mark steps complete in the wrong participant's thread.

---

#### BUG-IP-006: Missing Thread Ownership Check in GET Endpoint
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/route.ts:315-350`
**Status:** 🔴 OPEN

**Description:**
GET endpoint determines thread using `resolveThreadUserId()` but doesn't validate that the requesting user owns that thread.

---

#### BUG-IP-007: Realtime Subscription Doesn't Check Thread Ownership
**Severity:** MEDIUM
**File:** `src/hooks/useRealtimeMessages.ts:169-181`
**Status:** 🔴 OPEN

**Description:**
Realtime subscription subscribes to thread by ID without validating user authorization to listen to that thread.

---

#### BUG-IP-008: Conversation Plan Isolation Not Enforced
**Severity:** MEDIUM
**File:** `src/lib/ai/conversation-plan.ts:237-240`
**Status:** 🔴 OPEN

**Description:**
Plan data doesn't include thread validation. If a user obtains another participant's thread ID, they can fetch that participant's entire conversation plan.

---

#### BUG-IP-009: Initial Message Not Spoken in Voice Mode
**Severity:** HIGH
**File:** `src/components/chat/PremiumVoiceInterface.tsx:1405-1452`
**Status:** ✅ RESOLVED

**Description:**
In individual_parallel mode with voice mode (STT + TTS), when a user activates voice mode after page load, the initial welcome message already exists (created by `GET /api/ask/[key]`) but was never spoken via TTS. The condition `messages.length === 0` was false because the initial message was already created server-side.

**Impact:** Users in individual_parallel mode would enter voice mode and hear silence instead of the welcome message.

**Resolution:** Added logic to detect and speak the existing initial message:
```typescript
// If initial message already exists (created by GET /api/ask/[key]) but never spoken
if (messages.length === 1 && messages[0].role === 'assistant') {
  await agent.speakInitialMessage(messages[0].content);
}
```

---

### Shared Thread Mode

Bugs related to `shared` conversation mode where all participants use a single shared thread.

#### BUG-SH-001: Missing Thread ID in Realtime Subscription
**Severity:** HIGH
**File:** `src/hooks/useRealtimeMessages.ts:170-182`
**Status:** 🔴 OPEN

**Description:**
If a shared thread hasn't been initialized yet, the subscription fails. The hook assumes `conversationThreadId` is always provided with no fallback for pre-thread sessions.

---

#### BUG-SH-002: Participant Context Loss - User ID Exposure
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/route.ts:302-313`
**Status:** 🔴 OPEN

**Description:**
In truly shared mode (collaborative, group_reporter), participant's individual user_id is exposed in AskParticipant response. Shared mode should mask individual identities.

---

#### BUG-SH-003: Thread Initialization Race Condition
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/route.ts:315-349`
**Status:** 🔴 OPEN

**Description:**
If multiple participants hit GET endpoint simultaneously before a thread exists, multiple threads could be created. No guarantee all requests use the SAME shared thread.

---

#### BUG-SH-004: Insight Thread Attribution Bug
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/route.ts:701-718`
**Status:** 🔴 OPEN

**Description:**
In shared mode, ALL insights are assigned the current thread ID, even if originally created in a different thread. Loses original context for legacy messages.

---

#### BUG-SH-005: Realtime Filter Vulnerability
**Severity:** MEDIUM
**File:** `src/hooks/useRealtimeMessages.ts:169-182`
**Status:** 🔴 OPEN

**Description:**
Realtime subscription filter on `conversation_thread_id` has no validation that thread belongs to current ask_session.

---

#### BUG-SH-006: Missing Thread Type Validation in Polling
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/messages/route.ts:102-120`
**Status:** 🔴 OPEN

**Description:**
Endpoint validates ask_session ownership but not thread type (shared vs individual). User could request messages from another user's individual thread.

---

#### BUG-SH-007: Voice AI Response to Wrong Thread
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/respond/route.ts:1818-1830`
**Status:** 🔴 OPEN

**Description:**
In shared mode with multiple voice participants, if voice mode creates a user-specific thread, AI response gets saved to individual thread instead of shared thread.

---

#### BUG-SH-008: SenderId Exposes Identity in Shared Mode
**Severity:** MEDIUM
**File:** `src/hooks/useRealtimeMessages.ts:86-103`
**Status:** 🔴 OPEN

**Description:**
`formatDatabaseMessage()` exposes `user_id` as `senderId`. In shared/consultant mode, this defeats the purpose of shared mode where speaker identity should be maintained via voice diarization, not user_id.

---

### Voice Mode (Extended)

Additional bugs found in voice mode beyond the original Phase 1 findings.

#### BUG-VM-001: Audio Playback State Race Condition
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics-audio.ts:510-551`
**Status:** 🔴 OPEN

**Description:**
Multiple queued audio chunks could arrive while `isPlayingAudio` is being set to false. Next chunk could start playing before onended handler fires, causing chunks to be skipped or double-played.

---

#### BUG-VM-002: Unhandled AudioContext State After Resume
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:162-165`
**Status:** 🔴 OPEN

**Description:**
After `audioContext.resume()`, there's no verification that the context actually resumed successfully.

---

#### BUG-VM-003: Missing WebSocket Check in Audio Sending
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:223-288`
**Status:** 🔴 OPEN

**Description:**
WebSocket could close between the OPEN check (line 223) and actual send (line 287) due to async timing.

---

#### BUG-VM-004: Barge-in Validation Timeout Never Fires
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics-audio.ts:833-835, 1079-1085`
**Status:** 🔴 OPEN

**Description:**
If `validateBargeInWithTranscript()` is never called (e.g., VAD not triggering), the pending validation hangs forever, blocking future barge-ins.

---

#### BUG-VM-005: Microphone Permission Error Not Handled
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:153-155`
**Status:** 🔴 OPEN

**Description:**
`getUserMedia()` can throw with NotAllowedError, NotFoundError, or TypeError. Error is propagated without specific handling; microphone state may be partially initialized.

---

#### BUG-VM-006: TTS Stream Reading Never Completes
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics.ts:627-628`
**Status:** 🔴 OPEN

**Description:**
TTS stream reading loop (`streamToUint8Array`) has no timeout. If ElevenLabs API hangs, the request stays pending forever.

---

#### BUG-VM-007: Transcript Queue Doubles Messages on Error
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics.ts:684-708`
**Status:** 🔴 OPEN

**Description:**
When `processUserMessage()` throws after callback fires, transcript is queued again but also removed from history, causing duplicate/out-of-order processing.

---

#### BUG-VM-008: AudioWorklet Handler Active After Disconnect
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:323-326`
**Status:** 🔴 OPEN

**Description:**
`postMessage()` called AFTER setting `onmessage = null`. AudioWorklet might have queued messages that fire after cleanup.

---

#### BUG-VM-009: Generation State Not Reset on Barge-in
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics.ts:971-995`
**Status:** 🔴 OPEN

**Description:**
`abortResponse()` doesn't reset `isGeneratingResponse = false` immediately. If abort fires before processing completes, agent becomes unresponsive.

---

#### BUG-VM-010: Semantic Turn Detection Never Cancels
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-transcription.ts:514-528`
**Status:** 🔴 OPEN

**Description:**
If semantic detector API hangs, `semanticEvaluationInFlight` never resets, blocking subsequent evaluations indefinitely.

---

#### BUG-VM-011: WebSocket Handler Cleared But Messages Arrive
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-websocket.ts:516-518`
**Status:** 🔴 OPEN

**Description:**
Message handler set to null BEFORE WebSocket close event fires. Server's final messages after EndOfStream arrive as orphaned messages.

---

#### BUG-VM-012: Connection Token Overflow
**Severity:** LOW
**File:** `src/lib/ai/speechmatics.ts:186-189`
**Status:** 🔴 OPEN

**Description:**
`globalConnectionToken` increments forever. After ~2^31 connections, it overflows in JavaScript, causing connection validation to fail.

---

#### BUG-VM-013: isDisconnected Doesn't Prevent All Callbacks
**Severity:** LOW
**File:** `src/lib/ai/speechmatics.ts:311-319`
**Status:** 🔴 OPEN

**Description:**
Check for `isDisconnected` exists in `handleWebSocketMessage()`, but other callbacks like `onConnectionCallback()` still fire after disconnect due to async timing.

---

#### BUG-VM-014: Multiple Concurrent Disconnects
**Severity:** LOW
**File:** `src/lib/ai/speechmatics.ts:737-740`
**Status:** 🔴 OPEN

**Description:**
Calling `disconnect()` from different code paths (user close, error handler, timeout) could start multiple disconnection sequences, causing resources to be cleaned up multiple times.

---

#### BUG-VM-015: Echo Detection Race with Speech Clearing
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:628-645, 1176-1190`
**Status:** 🔴 OPEN

**Description:**
Even with BUG-016 fix using version tokens, if `scheduleClearAssistantSpeech()` fires after version increment but BEFORE new content is set, version check passes and clears wrong content.

---

### Consultant Mode (Extended)

Additional bugs found in consultant mode beyond the original Phase 1 findings.

#### BUG-CM-001: Questions Update Not Checked
**Severity:** MEDIUM
**File:** `src/hooks/useConsultantAnalysis.ts:237-241`
**Status:** 🔴 OPEN

**Description:**
If API returns empty questions array `[]`, local state retains old questions but no callback fires. UI shows stale questions.

---

#### BUG-CM-002: Insights Update Not Checked
**Severity:** MEDIUM
**File:** `src/hooks/useConsultantAnalysis.ts:243-247`
**Status:** 🔴 OPEN

**Description:**
Same as CM-001 but for insights. Empty arrays don't trigger state updates or callbacks.

---

#### BUG-CM-003: Pending Analysis Race Condition
**Severity:** HIGH
**File:** `src/hooks/useConsultantAnalysis.ts:266-277`
**Status:** 🔴 OPEN

**Description:**
Code checks `!isPaused` instead of `isPausedRef.current`, using stale closure value. Analysis may run when user has paused.

---

#### BUG-CM-004: Questions Parsing Silent Limit
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:53-72`
**Status:** 🔴 OPEN

**Description:**
Regex extraction limits to 2 questions max (`index < 2`) without documentation or warning. Questions beyond the second are silently ignored.

---

#### BUG-CM-005: No Analysis on Empty Conversations
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:481-487`
**Status:** 🔴 OPEN

**Description:**
Returns empty questions immediately if no messages. AI should provide initial guidance/opening questions even when conversation is empty.

---

#### BUG-CM-006: Current User ID Not Propagated
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:161-233, 532-541`
**Status:** 🔴 OPEN

**Description:**
`currentUserId` is identified but NOT passed to consultant helper agent variables. Agent can't provide personalized suggestions.

---

#### BUG-CM-007: Insight Detection Called Without Context
**Severity:** LOW
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:562-574`
**Status:** 🔴 OPEN

**Description:**
Fetch to `/api/ask/[key]/respond` with `detectInsights: true` doesn't set consultant mode context. Insights detection unaware there's no AI response.

---

#### BUG-CM-008: Missing Error Handling in Callbacks
**Severity:** LOW
**File:** `src/hooks/useConsultantAnalysis.ts:250-252`
**Status:** 🔴 OPEN

**Description:**
`onStepCompleted` callback isn't wrapped in try-catch. If parent's callback throws, it breaks analysis flow.

---

#### BUG-CM-009: Speaker Change Bypasses Debounce
**Severity:** MEDIUM
**File:** `src/hooks/useConsultantAnalysis.ts:302-310`
**Status:** 🔴 OPEN

**Description:**
`notifySpeakerChange()` calls `performAnalysis()` immediately, bypassing MIN_ANALYSIS_GAP debounce. Rapid speaker changes trigger excessive API calls.

---

#### BUG-CM-010: Step Completion Async Timing
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:620-626`
**Status:** 🔴 OPEN

**Description:**
Response returns BEFORE step summary is generated (async operation). UI reflects step completion before summary is ready.

---

#### BUG-CM-011: No Validation of Agent Response
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:593-597`
**Status:** 🔴 OPEN

**Description:**
If `helperResult.content` is null/empty, parser returns empty results with no error logging. Silent failure.

---

#### BUG-CM-012: Thread Identification Fails Silently
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:222-233`
**Status:** 🔴 OPEN

**Description:**
If `currentUserId` is null, endpoint warns but continues with shared thread fallback. Returns 200 OK instead of 401 Unauthorized. Consultant sees no questions because looking at empty shared thread.

---

#### BUG-CM-013: Empty Results Not Distinguished
**Severity:** MEDIUM
**File:** `src/hooks/useConsultantAnalysis.ts:237-247`
**Status:** 🔴 OPEN

**Description:**
Parent component can't distinguish between "questions were analyzed and found to be empty" vs "not analyzed at all".

---

#### BUG-CM-014: Parallel Calls Return Misaligned Data
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:551-589`
**Status:** 🔴 OPEN

**Description:**
Consultant helper and insight detection run in parallel. If one takes longer, API returns results from different "moments" in time with no timestamp coordination.

---

#### BUG-CM-015: Missing Null Safety in Message Count
**Severity:** LOW
**File:** `src/hooks/useConsultantAnalysis.ts:201-204`
**Status:** 🔴 OPEN

**Description:**
If `messageCount` is undefined or NaN, comparison behaves unexpectedly. No validation that messageCount is a valid positive integer.

---

#### BUG-CM-016: isPaused Stale in notifySpeakerChange
**Severity:** MEDIUM
**File:** `src/hooks/useConsultantAnalysis.ts:296-311`
**Status:** 🔴 OPEN

**Description:**
`notifySpeakerChange` uses `isPaused` from closure instead of `isPausedRef.current`, causing stale state.

---

#### BUG-CM-017: Analysis Too Frequent
**Severity:** LOW
**File:** `src/hooks/useConsultantAnalysis.ts:21-26`
**Status:** 🔴 OPEN

**Description:**
Default analysis interval is 10 seconds with 3-second debounce. For frequent conversations, this causes high API load and rapid token consumption.

---

#### BUG-CM-018: No Staleness Indicator
**Severity:** LOW
**File:** `src/hooks/useConsultantAnalysis.ts`
**Status:** 🔴 OPEN

**Description:**
Hook returns `isAnalyzing` but no `lastAnalyzedAt` timestamp. UI can't show how old current questions are.

---

#### BUG-CM-019: RLS Bypass Silent Failure
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:168-260`
**Status:** 🔴 OPEN

**Description:**
If RPC function has bugs or service role is misconfigured, lookup fails silently. If both token AND auth lookups fail, `currentUserId` becomes null and analysis runs against fallback thread returning no data.

---

### Conversation Plan & Steps

Bugs related to conversation plan and step management.

#### BUG-PS-001: Race Condition in Step Completion
**Severity:** CRITICAL
**File:** `src/lib/ai/conversation-plan.ts:445-580`
**Status:** 🔴 OPEN

**Description:**
`completeStep()` marks step as completed in DB (line 446), then attempts summary generation (lines 531-563). If summary fails and throws, step is already marked complete with no summary - inconsistent state.

---

#### BUG-PS-002: Missing activated_at on Plan Start
**Severity:** MEDIUM
**File:** `migrations/105_create_conversation_plan_rpc.sql:65-81`
**Status:** 🔴 OPEN

**Description:**
Only first active step gets `activated_at` set in RPC. TypeScript code doesn't explicitly set it for active step, causing NULL value that affects elapsed time calculation.

---

#### BUG-PS-003: current_step_id vs Active Step Mismatch
**Severity:** MEDIUM
**File:** `src/lib/ai/conversation-plan.ts:699-714, 378-397`
**Status:** 🔴 OPEN

**Description:**
`current_step_id` field can become out of sync with actual active step status. `getCurrentStep()` uses `current_step_id`, `getActiveStep()` queries by `status = 'active'` - different sources of truth.

---

#### BUG-PS-004: Step Summary Silent Failure
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/step-summary/route.ts:88-125`
**Status:** 🔴 OPEN

**Description:**
If AI summarizer returns null/empty, endpoint stores `[ERREUR]` prefix message in summary field but still returns success. Callers think summary was generated when it actually failed.

---

#### BUG-PS-005: Step Messages Filtering Fails Silently
**Severity:** MEDIUM
**File:** `src/lib/ai/conversation-agent.ts:150-180, 352-363`
**Status:** 🔴 OPEN

**Description:**
`formatStepMessages()` expects `currentStepId` (identifier like "step_1") but filters by UUID. If step record not found, falls back to all messages instead of step-specific messages.

---

#### BUG-PS-006: No Locking on Simultaneous Completions
**Severity:** HIGH
**File:** `src/lib/ai/conversation-plan.ts:404-584`
**Status:** 🔴 OPEN

**Description:**
`completeStep()` has no database-level locking or transaction. Two simultaneous requests can both pass the completion check, causing duplicate summary generation and step completed twice.

---

#### BUG-PS-007: Step Elapsed Time Not Reset
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/timer/route.ts:429-481`
**Status:** 🔴 OPEN

**Description:**
When step is activated via `activate_plan_step()` RPC, `elapsed_active_seconds` is NOT reset to 0. Time tracking starts from incorrect baseline.

---

#### BUG-PS-008: Plan State Stale When Fetch Fails
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/respond/route.ts:2007-2049`
**Status:** 🔴 OPEN

**Description:**
If `getConversationPlanWithSteps()` fails or returns null, code continues with potentially stale plan data. Step completion might target wrong step.

---

#### BUG-PS-009: No Overtime Tracking Across Steps
**Severity:** MEDIUM
**File:** `src/lib/pacing.ts` (referenced in timer)
**Status:** 🔴 OPEN

**Description:**
No mechanism to mark a step as "overtime", track cumulative overtime across steps, prevent further steps if overtime exceeded, or alert AI agent that plan is behind schedule.

---

#### BUG-PS-010: NULL activated_at in Duration Calculation
**Severity:** MEDIUM
**File:** `src/lib/ai/conversation-plan.ts:656-664`
**Status:** 🔴 OPEN

**Description:**
Line 657 falls back to `created_at` if `activated_at` is NULL. But `created_at` might be hours before step actually started, making duration calculation invalid.

---

## Phase 2 Summary by Conversation Type

| Conversation Type | Critical | High | Medium | Low | Total | Resolved |
|-------------------|----------|------|--------|-----|-------|----------|
| Individual Parallel | 1 | 5 | 3 | 0 | 9 | 1 ✅ |
| Shared Thread | 0 | 4 | 4 | 0 | 8 | 0 |
| Voice Mode (Extended) | 0 | 5 | 6 | 4 | 15 | 0 |
| Consultant Mode (Extended) | 0 | 4 | 10 | 5 | 19 | 0 |
| Plan & Steps | 1 | 1 | 8 | 0 | 10 | 0 |
| **Total** | **2** | **19** | **31** | **9** | **61** | **1** |

---

## Phase 2 Priority Action Items

### Immediate (P0)
1. **BUG-IP-002**: Thread ownership validation in messages route (CRITICAL)
2. **BUG-PS-001**: Race condition in step completion/summary (CRITICAL)

### Short-term (P1 - HIGH)
3. **BUG-IP-001**: Voice agent init wrong thread resolution
4. **BUG-IP-003**: NULL thread ID in AI message insert
5. **BUG-IP-005**: Step complete wrong thread resolution
6. **BUG-SH-001**: Missing thread ID in realtime subscription
7. **BUG-SH-003**: Thread initialization race condition
8. **BUG-SH-004**: Insight thread attribution bug
9. **BUG-SH-007**: Voice AI response to wrong thread
10. **BUG-VM-001**: Audio playback state race condition
11. **BUG-VM-004**: Barge-in validation timeout
12. **BUG-VM-006**: TTS stream reading timeout
13. **BUG-VM-007**: Transcript queue doubles messages
14. **BUG-VM-009**: Generation state not reset
15. **BUG-CM-003**: Pending analysis race condition
16. **BUG-CM-005**: No analysis on empty conversations
17. **BUG-CM-012**: Thread identification fails silently
18. **BUG-CM-019**: RLS bypass silent failure
19. **BUG-PS-006**: No locking on simultaneous completions

### Medium-term (P2 - MEDIUM)
20. All remaining MEDIUM severity bugs in each category

---

## Related Documentation

- [Database Schema](../architecture/database-schema.md)
- [RLS Security Guide](../security/rls-guide.md)
- [Agent Configuration](../ai-system/agent-configuration.md)
