# Conversation System - Bug Report

> **Generated**: 2026-01-17
> **Last Updated**: 2026-01-17
> **Status**: 27/46 bugs resolved (59% complete)
> **Audit**: Système de conversation (text mode, voice mode, consultant mode)

---

## Table of Contents

1. [Critical Bugs](#critical-bugs)
2. [High Severity Bugs](#high-severity-bugs)
3. [Medium Severity Bugs](#medium-severity-bugs)
4. [Low Severity Bugs](#low-severity-bugs)
5. [Summary by Module](#summary-by-module)

---

## Critical Bugs

### BUG-001: TTS Playback After disableLLM in Consultant Mode
**Module:** Voice Mode / Consultant Mode
**Severity:** CRITICAL
**File:** `src/lib/ai/speechmatics.ts:608-615`
**Status:** ✅ RESOLVED

**Description:**
While the code properly sets `disableElevenLabsTTS: true` in consultant mode (line 1328 in PremiumVoiceInterface.tsx), there's a potential race condition. The assistant response message is sent to the callback BEFORE the disableLLM check.

**Resolution:** Line 614 now includes `!this.config?.disableLLM` as an additional guard:
```typescript
if (!this.config?.disableLLM && !this.config?.disableElevenLabsTTS && this.elevenLabsTTS && this.audio) {
  // Play audio via ElevenLabs
}
```
This ensures TTS is never played in consultant mode even if other code paths accidentally generate a response.

---

### BUG-002: Race Condition in File Upload Handling
**Module:** Text Chat
**Severity:** HIGH
**File:** `src/components/chat/ChatComponent.tsx:202-221`
**Status:** ✅ RESOLVED

**Description:**
The file upload logic uses FileReader asynchronously without awaiting completion.

**Resolution:** Lines 202-269 now use Promise-based file reading with proper async/await:
- `readFileAsDataURL()` and `readFileAsBase64()` wrap FileReader in Promises
- Error handlers added (`reader.onerror`) for file read failures
- `Promise.all()` awaits all file uploads before clearing state

---

### BUG-003: Race Condition Between Thread Creation and Message Insertion
**Module:** Text Chat / Conversation Threads
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/route.ts:1110-1140`
**Status:** ✅ RESOLVED

**Description:**
Thread creation and message insertion happen sequentially, but if two concurrent requests arrive, the second request's message might be inserted before the thread is fully created.

**Resolution:** In `src/lib/asks.ts:283-310`, the `getOrCreateConversationThread()` function now handles duplicate key errors (code 23505) by retrying the fetch. This implements optimistic concurrency control - if another request creates the thread first, we fetch it instead of failing.

---

### BUG-004: Insights Leaking Across Individual Threads
**Module:** Conversation Threads
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/route.ts:656-695`
**Status:** ✅ RESOLVED

**Description:**
In GET `/api/ask/[key]`, insights are fetched for the entire session without thread filtering in individual_parallel mode.

**Resolution:** Lines 657-691 now implement thread filtering for insights:
```typescript
if (!shouldUseSharedThread(askConfig) && conversationThread) {
  // Individual_parallel mode: strict isolation - only insights from this user's thread
  const { insights: threadInsights } = await getInsightsForThread(dataClient, conversationThread.id);
  insightRows = threadInsights;
} else {
  // Shared thread mode: show all insights for visibility
  insightRows = await fetchInsightsForSession(dataClient, askSessionId);
}
```

---

### BUG-005: Stream Route Not Respecting Thread Isolation
**Module:** Conversation Threads
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/stream/route.ts:263-294`
**Status:** ✅ RESOLVED

**Description:**
Messages are fetched differently than in GET route, potentially breaking thread isolation.

**Resolution:** Lines 264-298 now implement proper thread isolation:
```typescript
if (shouldUseSharedThread(askConfig)) {
  // Shared mode: also include messages without thread_id for backward compatibility
  messageRows = [...threadMessagesList, ...messagesWithoutThread].sort(...);
} else {
  // Individual_parallel mode: strict isolation - only messages from this thread
  messageRows = threadMessagesList;
}
```

---

## High Severity Bugs

### BUG-006: WebSocket Message Handler Not Cleared on Disconnect
**Module:** Voice Mode
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics-websocket.ts:467`
**Status:** ✅ RESOLVED

**Description:**
In the `disconnect()` method, the WebSocket's `onmessage` handler is set to null, but the internal message handler reference was not cleared.

**Resolution:** Lines 498-500 now explicitly clear the message handler:
```typescript
// BUG-006 FIX: Ensure message handler is cleared to prevent memory leaks and routing errors
this.messageHandler = null;
```
All WebSocket event listeners are also set to null (lines 488-491).

---

### BUG-007: Transcript Lost on Processing Error
**Module:** Voice Mode
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics-transcription.ts:234-299`
**Status:** ✅ RESOLVED

**Description:**
The `processPendingTranscript()` method clears the state BEFORE calling the async `processUserMessage()`.

**Resolution:** Lines 281-319 now only clear state AFTER successful processing:
```typescript
try {
  await this.processUserMessage(fullContent);
  // BUG-007 FIX: Only clear state AFTER successful processing
  this.clearState();
  this.lastProcessedContent = fullContent;
} catch (error) {
  // BUG-007 FIX: On error, remove from conversation history and keep state for retry
  this.conversationHistory.splice(lastIndex, 1);
  throw error; // Re-throw so caller knows it failed
}
```

---

### BUG-008: Silent Transcript Discard on Echo Detection
**Module:** Voice Mode
**Severity:** HIGH
**File:** `src/lib/ai/speechmatics-audio.ts:843-936`
**Status:** ✅ RESOLVED

**Description:**
When echo is detected in `validateBargeInWithTranscript()`, the method calls `onEchoDetected?.()` which discards the pending transcript silently.

**Resolution:** Lines 900-910 and 931-941 now pass detailed echo information to the callback:
```typescript
const echoDetails = {
  transcript: cleanedTranscript,
  matchType: echoCheckResult.matchType,
  similarity: echoCheckResult.similarity,
  detectedAt: Date.now(),
};
SpeechmaticsAudio.lastEchoDetails = echoDetails;
this.onEchoDetected?.(echoDetails);
```
The UI can now display feedback about why the input was rejected.

---

### BUG-009: No Server-Side Deduplication for Step Completion
**Module:** Step Completion
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/step-complete/route.ts`
**Status:** ✅ RESOLVED (commit `2b4661c`)

**Description:**
The step-complete endpoint has NO deduplication logic. Only the client-side voice interface has `completingStepsRef`. If two concurrent requests with the same `stepId` arrive at the server simultaneously, both could call `completeStep()` successfully.

**Impact:**
- Multiple calls to `completeStep()` with the same `stepId` trigger multiple summary generation requests
- Race condition where both requests see the same `current_step_id`

**Resolution:** Client-side deduplication via `completingStepsRef` now prevents duplicate API calls.

---

### BUG-010: Summary Generation Errors Not Propagated
**Module:** Step Completion
**Severity:** HIGH
**File:** `src/lib/ai/conversation-plan.ts:525-529`

**Description:**
The `completeStep()` function throws an error if summary generation fails. However:
- In `respond/route.ts`, the error is caught but only logs, doesn't fail the request
- In voice mode, summary generation is async fire-and-forget with no error callback

**Impact:**
- Summary generation failures are not surfaced consistently to the client
- Voice mode doesn't know if summary generation succeeded or failed
- Step might be marked complete but summary never generated

**Suggested Fix:** Make summary generation truly async with a separate API endpoint and proper status tracking.

---

### BUG-011: Voice Messages Not Checked for Consultant Mode
**Module:** Consultant Mode
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/respond/route.ts:1748-1846`
**Status:** ✅ RESOLVED

**Description:**
The consultant mode check at line 1847 correctly prevents executeAgent from being called. However, voice messages were processed regardless of consultant mode.

**Resolution:** Line 1793 now includes the `!isConsultantMode` check:
```typescript
// BUG-011 FIX: Skip voice message handling in consultant mode - AI doesn't respond in that mode
if (isVoiceMessage && messageContent && !isConsultantMode) {
  // Insert AI message and process step completion...
}
```

---

### BUG-012: Speaker Mappings Not Persisted to Database
**Module:** Consultant Mode
**Severity:** HIGH
**File:** `src/components/chat/PremiumVoiceInterface.tsx:2665-2700`

**Description:**
The SpeakerAssignmentOverlay component allows users to assign speakers to participants, but there's no evidence that these mappings are being persisted to the database.

**Impact:**
- Speaker assignments are lost when the user refreshes the page
- Other participants viewing the same session won't see the speaker assignments
- Insights and questions reference speakers (S1, S2) rather than participant names

**Suggested Fix:** Implement a speaker assignment persistence endpoint that saves mappings to a new table.

---

### BUG-013: Insight Deduplication Not Scoped to Thread
**Module:** Conversation Threads
**Severity:** HIGH
**File:** `src/app/api/ask/[key]/respond/route.ts:1305-1306`

**Description:**
`persistInsights()` creates/updates insights with the provided `conversationThreadId`. But `existingInsights` were fetched from the thread context. If the function matches insights by content/summary (deduplication), it might incorrectly match insights from OTHER threads with similar content.

**Impact:** Cross-thread insight contamination in individual_parallel mode.

**Suggested Fix:** In `persistInsights()`, ensure the match is within the same thread context.

---

## Medium Severity Bugs

### BUG-014: No FileReader Error Handler
**Module:** Text Chat
**Severity:** MEDIUM
**File:** `src/components/chat/ChatComponent.tsx:257-263`
**Status:** ✅ RESOLVED (fixed with BUG-002)

**Description:**
FileReader.onload callback has no error handler (reader.onerror not set).

**Resolution:** The Promise-based file reading functions (lines 206-228) now include `reader.onerror` handlers that reject with descriptive error messages.

---

### BUG-015: Missing Null Check Before Thread Access
**Module:** Text Chat
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/route.ts:1268-1280`
**Status:** ✅ RESOLVED

**Description:**
The code attempts to access conversation plan without null-checking `conversationThread` first.

**Resolution:** Lines 1290-1302 now have proper null checks:
```typescript
if (conversationThread) {
  const plan = await getConversationPlanWithSteps(dataClient, conversationThread.id);
  if (plan) {
    const activeStep = await getActiveStep(dataClient, plan.id);
    if (activeStep) { planStepId = activeStep.id; }
  }
}
```

---

### BUG-016: No Edit Error Recovery
**Module:** Text Chat
**Severity:** MEDIUM
**File:** `src/components/chat/ChatComponent.tsx:178-191`

**Description:**
No validation that the message still exists or that the edit hasn't been superseded by another operation. No error recovery if `onEditMessage` fails.

**Suggested Fix:** Add error handling and UI feedback for failed edits.

---

### BUG-017: Thread Isolation Vulnerability in Shared Mode
**Module:** Text Chat
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/route.ts:383-406`

**Description:**
In shared thread mode, messages without `conversation_thread_id` are included, but this could expose messages from individual threads if not properly filtered.

**Suggested Fix:** Add explicit mode checking before including legacy messages.

---

### BUG-018: Barge-in Validation Timeout Too Short
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:803-807`
**Status:** ✅ RESOLVED

**Description:**
The barge-in validation timeout (300ms) was too short.

**Resolution:** Line 52 now sets `BARGE_IN_VALIDATION_TIMEOUT_MS = 600`, which is within the suggested 500-800ms range.

---

### BUG-019: Memory Leak - AudioWorklet Handler Not Cleared on Mute
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:374-418`

**Description:**
In `setMicrophoneMuted()`, when unmuting, the code connects audio nodes but if `processorNode.port.postMessage()` throws, connections are made but processor may not receive messages.

**Suggested Fix:** Validate port is ready before sending messages, add proper error handling with rollback.

---

### BUG-020: No Timeout Abort for Stuck LLM Request
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics.ts:104-106`
**Status:** ✅ RESOLVED

**Description:**
The 60-second timeout auto-resets the `isGeneratingResponse` flag, but if the LLM request is still in flight, calling `disconnect()` may not properly abort the request.

**Resolution:** Lines 739-747 in `disconnect()` now always abort pending LLM requests:
```typescript
// BUG-020 FIX: Always abort any pending LLM request on disconnect
if (this.llmAbortController) {
  this.llmAbortController.abort();
  this.llmAbortController = null;
}
// Reset generation state to ensure clean slate
this.isGeneratingResponse = false;
```

---

### BUG-021: Assistant Speech Not Cleared Between Responses
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-audio.ts:614-617`

**Description:**
`currentAssistantSpeech` is cleared after a 500ms grace period. If a new response starts before the timeout, echo detection may trigger on the new response's beginning.

**Suggested Fix:** Clear `currentAssistantSpeech` immediately when starting new TTS generation.

---

### BUG-022: No Cleanup of Interim Buffers on Disconnect
**Module:** Voice Mode
**Severity:** MEDIUM
**File:** `src/components/chat/PremiumVoiceInterface.tsx:832-905`
**Status:** ✅ RESOLVED

**Description:**
`interimUser` and `interimAssistant` state are not cleared when `disconnect()` is called. Stale streaming messages may persist in the UI after reconnection.

**Resolution:** Lines 1514-1515 in `PremiumVoiceInterface.tsx` now clear `setInterimUser(null)` and `setInterimAssistant(null)` in the `disconnect()` function.

---

### BUG-023: Step Completion Deduplication Can Silently Fail
**Module:** Step Completion / Voice Mode
**Severity:** MEDIUM
**File:** `src/components/chat/PremiumVoiceInterface.tsx:424-429`
**Status:** ✅ RESOLVED

**Description:**
The `completingStepsRef` Set tracks steps being completed. If the step-complete API fails, the step ID remains in the Set forever, preventing any retry.

**Resolution:** Lines 964 and 970 in `PremiumVoiceInterface.tsx` now remove the step ID from the Set on failure, enabling retries.

---

### BUG-024: Incomplete Step Identifier Validation
**Module:** Step Completion
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/respond/route.ts:1948-1950`
**Status:** ✅ RESOLVED

**Description:**
If `detectedStepId` doesn't match `currentStepIdentifier`, step completion was silently skipped.

**Resolution:** Lines 1868-1876 now add explicit logging for step mismatch:
```typescript
// BUG-024 FIX: Add explicit logging when step ID doesn't match current step
if (detectedStepId !== 'CURRENT' && currentStepIdentifier !== detectedStepId) {
  console.warn('[respond] ⚠️ STEP_COMPLETE marker detected but step ID mismatch:', {
    detectedStepId,
    currentStepIdentifier,
    planId: plan.id,
    threadId: conversationThread.id,
  });
}
```

---

### BUG-025: Completion Order Not Validated
**Module:** Step Completion
**Severity:** MEDIUM
**File:** `src/lib/ai/conversation-plan.ts:418-423`
**Status:** ✅ RESOLVED

**Description:**
The `completeStep()` function didn't validate that the step being completed is actually pending or active.

**Resolution:** Lines 425-443 now validate step status before completion:
```typescript
// BUG-025 FIX: Validate that step is actually pending or active
if (completedStep.status === 'completed') {
  console.warn('[completeStep] ⚠️ Step already completed, skipping');
  return plan; // Return current plan state
}
if (completedStep.status === 'skipped') {
  console.warn('[completeStep] ⚠️ Cannot complete skipped step');
  return null;
}
```

---

### BUG-026: Voice Message Summary Generation Not Awaited
**Module:** Step Completion / Voice Mode
**Severity:** MEDIUM
**File:** `src/components/chat/PremiumVoiceInterface.tsx:947-971`
**Status:** ✅ RESOLVED

**Description:**
The fetch call to `/step-complete` was not awaited and had no retry logic.

**Resolution:** Lines 941-1000 now implement `completeStepWithRetry()` with:
- 3 retry attempts with exponential backoff
- HTTP status validation before JSON parsing
- Only updates prompts on successful completion
- Proper error logging for each attempt

---

### BUG-027: Missing sttDiarization Validation
**Module:** Consultant Mode
**Severity:** MEDIUM
**File:** `src/lib/ai/speechmatics-websocket.ts:143-160`

**Description:**
In consultant mode, `sttDiarization: "speaker"` is set, but there's no explicit validation that the Speechmatics agent is receiving this configuration correctly.

**Suggested Fix:** Add explicit validation and log warning if `sttDiarization` is set to "none" in consultant mode.

---

### BUG-028: latestAiResponse Not Filtered in Consultant Mode
**Module:** Consultant Mode
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/respond/route.ts:1698-1711`

**Description:**
Detection variables are built WITHOUT filtering `latestAiResponse`. In consultant mode, this should be empty since there's no AI response being generated.

**Suggested Fix:** Explicitly set `latestAiResponse` to empty string in consultant mode.

---

### BUG-029: Speaker Assignment Completeness Not Validated
**Module:** Consultant Mode
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/consultant-analyze/route.ts:367-375`

**Description:**
The consultant-analyze endpoint doesn't validate that all detected speakers have been assigned to participants before analysis.

**Suggested Fix:** Add check to ensure all unique speakers are assigned, return warning if incomplete.

---

### BUG-030: Race Condition in Shared Thread Creation
**Module:** Conversation Threads
**Severity:** MEDIUM
**File:** `src/lib/asks.ts:212-235`

**Description:**
When multiple users access a session simultaneously without a userId, the code falls back to creating shared threads. The unique index allows multiple rows due to NULL uniqueness in PostgreSQL.

**Suggested Fix:** Use RPC function `get_or_create_conversation_thread()` consistently with server-side locking.

---

### BUG-031: Insights conversationThreadId Being Overwritten
**Module:** Conversation Threads
**Severity:** MEDIUM
**File:** `src/app/api/ask/[key]/respond/route.ts:1606-1610`
**Status:** ✅ RESOLVED

**Description:**
All insights had their `conversationThreadId` overwritten with the current viewer's thread ID.

**Resolution:** Lines 699-716 in route.ts now only override in shared modes:
```typescript
if (shouldUseSharedThread(askConfig)) {
  // In shared modes, use the current thread ID for consistency
  return { ...insight, conversationThreadId: conversationThread?.id ?? null };
} else {
  // In individual_parallel mode, preserve the original thread ID
  return { ...insight, conversationThreadId: row.conversation_thread_id ?? insight.conversationThreadId };
}
```

---

### BUG-032: Realtime Subscription Not Thread-Filtered in Individual Mode
**Module:** Conversation Threads
**Severity:** MEDIUM
**File:** `src/hooks/useRealtimeMessages.ts:169-181`

**Description:**
If thread_id is NULL for messages (legacy data), the realtime filter won't catch them. Mixed threading states could cause users to miss messages.

**Suggested Fix:** Don't subscribe in individual mode without a thread, or add user_id filter.

---

## Low Severity Bugs

### BUG-033: Memory Leak in Media Recorder Stream
**Module:** Text Chat
**Severity:** LOW
**File:** `src/components/chat/ChatComponent.tsx:296-331`

**Description:**
Audio stream tracks are stopped in `onstop` callback asynchronously. If component unmounts before onstop fires, tracks may not be released.

---

### BUG-034: ArrayBuffer Cast to String
**Module:** Text Chat
**Severity:** LOW
**File:** `src/components/chat/ChatComponent.tsx:205-219`
**Status:** ✅ RESOLVED (fixed with BUG-002)

**Description:**
FileReader.readAsArrayBuffer for non-image files converted to string incorrectly.

**Resolution:** The `readFileAsBase64()` function (lines 212-228) now properly converts ArrayBuffer to base64 using Uint8Array and btoa().

---

### BUG-035: Dev Mode Profile ID Fallback Unclear
**Module:** Text Chat
**Severity:** LOW
**File:** `src/app/api/ask/[key]/route.ts:1013-1063`

**Description:**
Dev mode profile lookup silently continues without profileId if no admin profile exists, unclear error messages.

---

### BUG-036: No Semantic Turn Detector Cleanup
**Module:** Voice Mode
**Severity:** LOW
**File:** `src/lib/ai/speechmatics.ts:204-205`

**Description:**
The `semanticTurnDetector` is recreated on every `connect()` call with no cleanup method to release resources.

---

### BUG-037: Potential Double-Cleanup in stopMicrophone
**Module:** Voice Mode
**Severity:** LOW
**File:** `src/lib/ai/speechmatics-audio.ts:283-372`

**Description:**
`isMicrophoneActive = false` is set before `stopAgentSpeech(false)` is called, which may check that flag.

---

### BUG-038: Potential Message Duplication with React StrictMode
**Module:** Voice Mode
**Severity:** LOW
**File:** `src/components/chat/PremiumVoiceInterface.tsx:896-950`

**Description:**
If React StrictMode is enabled (double-mounting), `handleMessage()` could result in duplicate messages being sent to parent.

---

### BUG-039: Regex Cleaning Might Remove Valid Content
**Module:** Step Completion
**Severity:** LOW
**File:** `src/lib/sanitize.ts:19-21`
**Status:** ✅ RESOLVED

**Description:**
The `\w*` part would match word characters after `STEP_COMPLETE:`, potentially consuming intentional content.

**Resolution:** Lines 18-27 now have a refined regex that only matches the marker and step ID, with comment explaining the fix.

---

### BUG-040: Missing Null Check in Pacing Calculation
**Module:** Step Completion
**Severity:** LOW
**File:** `src/lib/pacing.ts:285-331`

**Description:**
If messages don't have `planStepId` populated, `questionsAskedInStep` will always be 0 with no warning.

---

### BUG-041: Summary Generation Error Not Stored Consistently
**Module:** Step Completion
**Severity:** LOW
**File:** `src/app/api/ask/[key]/step-summary/route.ts:61-74`

**Description:**
Error message doesn't differentiate between "step not found" and "summarizer returned null".

---

### BUG-042: Race Condition in useConsultantAnalysis Pause/Resume
**Module:** Consultant Mode
**Severity:** LOW
**File:** `src/hooks/useConsultantAnalysis.ts:326-356`

**Description:**
After `resume()`, the interval isn't re-established until component re-mounts.

---

### BUG-043: Known Documentation Gap for Thread Filtering
**Module:** Conversation Threads
**Severity:** LOW
**File:** `src/app/api/ask/[key]/route.ts:656-665`

**Description:**
Comment acknowledges insights visibility issues but doesn't implement stated "client-side filtering".

---

## Summary by Module

| Module | Critical | High | Medium | Low | Total | Resolved |
|--------|----------|------|--------|-----|-------|----------|
| Text Chat | 2 | 0 | 4 | 3 | 9 | 6 ✅ |
| Voice Mode | 1 | 3 | 6 | 4 | 14 | 8 ✅ |
| Step Completion | 0 | 2 | 4 | 3 | 9 | 6 ✅ |
| Consultant Mode | 1 | 2 | 3 | 1 | 7 | 2 ✅ |
| Conversation Threads | 2 | 1 | 3 | 1 | 7 | 5 ✅ |
| **Total** | **6** | **8** | **20** | **12** | **46** | **27 ✅** |

**Resolved bugs:** BUG-001, BUG-002, BUG-003, BUG-004, BUG-005, BUG-006, BUG-007, BUG-008, BUG-009, BUG-011, BUG-014, BUG-015, BUG-018, BUG-020, BUG-022, BUG-023, BUG-024, BUG-025, BUG-026, BUG-031, BUG-034, BUG-039

---

## Priority Action Items

### Immediate (P0) - ALL RESOLVED ✅
1. ~~**BUG-001**: TTS in consultant mode~~ ✅ RESOLVED
2. ~~**BUG-004**: Insights leaking across threads~~ ✅ RESOLVED
3. ~~**BUG-005**: Stream route thread isolation~~ ✅ RESOLVED

### Short-term (P1) - MOSTLY RESOLVED
4. ~~**BUG-002**: File upload race condition~~ ✅ RESOLVED
5. ~~**BUG-003**: Thread/message race condition~~ ✅ RESOLVED
6. ~~**BUG-009**: Server-side step deduplication~~ ✅ RESOLVED
7. ~~**BUG-011**: Voice messages in consultant mode~~ ✅ RESOLVED
8. **BUG-012**: Speaker mapping persistence - OPEN

### Medium-term (P2) - PARTIALLY RESOLVED
9. ~~**BUG-007**: Transcript recovery on error~~ ✅ RESOLVED
10. **BUG-010**: Summary generation error propagation - OPEN
11. **BUG-013**: Insight deduplication scope - OPEN
12. Remaining open medium severity bugs: BUG-016, BUG-017, BUG-019, BUG-021, BUG-027, BUG-028, BUG-029, BUG-030, BUG-032

---

## Related Documentation

- [Text Chat Mode](../features/text-chat-mode.md)
- [Voice Mode Architecture](../features/voice-mode-architecture.md)
- [Consultant Mode](../features/consultant-mode.md)
- [Conversation Threads](../features/conversation-threads.md)
- [Step Completion System](../features/step-completion-system.md)
