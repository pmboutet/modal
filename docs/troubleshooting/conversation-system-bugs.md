# Conversation System - Bug Report

> **Generated**: 2026-01-17
> **Last Updated**: 2026-01-17
> **Status**: 14/35 bugs resolved (Critical + HIGH bugs fixed)

---

## Table of Contents

1. [Critical Bugs](#critical-bugs)
2. [High Severity Bugs](#high-severity-bugs)
3. [Medium Severity Bugs](#medium-severity-bugs)
4. [Low Severity Bugs](#low-severity-bugs)
5. [Summary by Module](#summary-by-module)

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

**Description:**
Token validation doesn't check if the authenticated user has permission to fetch ALL messages in that thread.

---

### BUG-027: Message Content Not Sanitized Before Storage
**Module:** Security
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/route.ts:815-820`

**Description:**
User message content is inserted directly without sanitization.

**Suggested Fix:**
Apply `sanitizeText()` to message content before insertion.

---

### BUG-028: Insufficient Authorization in Message Editing
**Module:** Security
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/message/[messageId]/route.ts:208-215`

**Description:**
The ownership check can be bypassed if profileId is null in certain scenarios.

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

## Summary by Module

| Module | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| Text Chat | 1 | 2 | 1 | 2 | 6 |
| Voice Mode | 1 | 2 | 4 | 1 | 8 |
| Consultant Mode | 0 | 2 | 2 | 3 | 7 |
| Conversation Threads | 1 | 2 | 4 | 1 | 8 |
| Security | 2 | 1 | 2 | 1 | 6 |
| **Total** | **5** | **9** | **13** | **8** | **35** |

---

## Priority Action Items

### Immediate (P0)
1. **BUG-001**: Missing JSON error handling in POST route
2. **BUG-002**: Missing await in consultant mode processUserMessage
3. **BUG-003**: Race condition in shared thread creation
4. **BUG-004**: Participant data exposure via RPC
5. **BUG-005**: Message isolation bypass

### Short-term (P1)
6. **BUG-006**: Missing await on validateBargeInWithTranscript
7. **BUG-007**: Logic error in findIndex for error recovery
8. **BUG-011**: Insight thread ID override
9. **BUG-012**: Missing thread isolation in insight retrieval
10. **BUG-013**: Unvalidated participant ID in speaker assignment

### Medium-term (P2)
11. All remaining HIGH severity bugs
12. Security-related MEDIUM bugs (BUG-026, BUG-027, BUG-028)
13. Voice mode stability bugs

---

## Related Documentation

- [Database Schema](../architecture/database-schema.md)
- [RLS Security Guide](../security/rls-guide.md)
- [Agent Configuration](../ai-system/agent-configuration.md)
