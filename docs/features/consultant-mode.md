# Consultant Mode - ASK Conversation System

## Overview

Consultant Mode is a specialized conversation mode in the ASK system designed for **AI-assisted consultant sessions**. Unlike other conversation modes where the AI actively participates in the dialogue, in Consultant Mode the AI acts as an **invisible assistant** that:

- **Listens** to the conversation via real-time Speech-to-Text with speaker diarization
- **Suggests questions** to the consultant (displayed only to the spokesperson)
- **Detects insights** from the conversation automatically
- Can **trigger step completion** automatically based on conversation progress
- **Does NOT respond** in the conversation (no TTS output)

### Key Differentiator

| Feature | Standard Modes | Consultant Mode |
|---------|---------------|-----------------|
| AI Response | AI responds to participants | AI does NOT respond |
| TTS Output | Enabled | Disabled |
| Diarization | Optional | Required |
| Question Suggestions | No | Yes (to spokesperson) |
| Insight Detection | Yes | Yes |
| Step Completion | Manual/AI | Automatic detection |

## When to Use Consultant Mode

Consultant Mode is ideal for:

1. **Face-to-face interviews** where a consultant facilitates conversation with multiple participants
2. **Physical group sessions** where the AI should not interrupt the natural flow
3. **Research interviews** where the consultant needs real-time question suggestions
4. **Focus groups** where capturing insights without AI intervention is critical

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        CONSULTANT MODE FLOW                               │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────┐    Audio     ┌──────────────────┐    Transcript    ┌────────────────┐
│ Microphone  │ ───────────► │ Speechmatics STT │ ───────────────► │ Message Store  │
│ (Physical)  │              │ (Diarization)    │                  │                │
└─────────────┘              └──────────────────┘                  └────────────────┘
                                    │                                       │
                                    │ Speaker Labels                        │
                                    │ (S1, S2, S3...)                       │
                                    ▼                                       ▼
                             ┌──────────────────┐              ┌────────────────────────┐
                             │ Speaker Assignment│              │ useConsultantAnalysis  │
                             │ Overlay           │              │ (periodic: 10s)        │
                             └──────────────────┘              └────────────────────────┘
                                                                           │
                                    ┌──────────────────────────────────────┤
                                    │                                      │
                                    ▼                                      ▼
                        ┌─────────────────────┐              ┌────────────────────────┐
                        │ Consultant Helper   │              │ Insight Detection      │
                        │ Agent               │              │ Agent                  │
                        └─────────────────────┘              └────────────────────────┘
                                    │                                      │
                                    ▼                                      ▼
                        ┌─────────────────────┐              ┌────────────────────────┐
                        │ Suggested Questions │              │ Insights Panel         │
                        │ (Spokesperson Only) │              │ (All viewers)          │
                        └─────────────────────┘              └────────────────────────┘
```

### Conversation Mode Type

Consultant mode is defined as a `AskConversationMode` in the type system:

```typescript
// src/types/index.ts
export type AskConversationMode =
  | "individual_parallel"  // Multiple people respond individually, no cross-visibility
  | "collaborative"        // Multi-voice conversation, everyone sees everything
  | "group_reporter"       // Group contributes, one reporter consolidates
  | "consultant";          // AI listens and suggests questions to consultant, no TTS
```

## Implementation Details

### 1. Database Configuration

The conversation mode is stored in `ask_sessions.conversation_mode`:

```sql
-- Migration 080: Add consultant conversation mode
ALTER TABLE public.ask_sessions
  ADD CONSTRAINT check_conversation_mode
  CHECK (conversation_mode IN ('individual_parallel', 'collaborative', 'group_reporter', 'consultant'));
```

### 2. Checking Consultant Mode

Use the utility function to check if a session is in consultant mode:

```typescript
// src/lib/utils.ts
export function isConsultantMode(conversationMode: string | undefined): boolean {
  return conversationMode === 'consultant';
}

// Or directly in components:
const isConsultantMode = sessionData.ask?.conversationMode === 'consultant';
```

### 3. API Response Behavior

In the `/api/ask/[key]/respond` route, consultant mode skips AI response generation:

```typescript
// src/app/api/ask/[key]/respond/route.ts
const isConsultantMode = askRow.conversation_mode === 'consultant';

if (!isConsultantMode) {
  // Regular text mode: call executeAgent
  const aiResult = await executeAgent({...});
  // Save AI response...
} else {
  // Consultant mode: AI doesn't respond automatically
  // Only insight detection runs
}
```

### 4. Consultant Helper Agent

A dedicated AI agent (`ask-consultant-helper`) analyzes conversations and suggests questions:

**Agent Configuration:**
- **Slug:** `ask-consultant-helper`
- **Purpose:** Analyze live conversation transcripts and suggest questions
- **Output:** 2 suggested questions + optional STEP_COMPLETE marker

**Key Prompt Variables:**
- `ask_question` - Central question of the interview
- `ask_description` - Context/description
- `current_step` - Current conversation step title
- `current_step_id` - Current step identifier (for STEP_COMPLETE)
- `messages_json` - Full conversation transcript with speaker labels
- `expected_duration_minutes` - Target duration
- `conversation_elapsed_minutes` - Time elapsed

### 5. Consultant Analyze API Endpoint

**Endpoint:** `POST /api/ask/[key]/consultant-analyze`

This endpoint is called periodically by the `useConsultantAnalysis` hook and:

1. Validates consultant mode
2. Fetches conversation context
3. Calls the consultant helper agent
4. Parses suggested questions
5. Triggers insight detection in parallel
6. Detects and handles step completion

**Response Format:**
```typescript
interface ConsultantAnalyzeResponse {
  questions: SuggestedQuestion[];  // Max 2 questions
  insights: Insight[];             // Detected insights
  stepCompleted?: string;          // Step ID if completed
}
```

### 6. useConsultantAnalysis Hook

**Location:** `src/hooks/useConsultantAnalysis.ts`

A React hook that manages periodic AI analysis for consultant mode:

```typescript
const consultantAnalysis = useConsultantAnalysis({
  askKey: 'my-ask-key',
  enabled: isConsultantMode,
  messageCount: messages.length,  // Triggers analysis on new messages
  inviteToken: 'optional-token',
  onQuestionsUpdate: (questions) => { /* handle questions */ },
  onInsightsUpdate: (insights) => { /* handle insights */ },
  onStepCompleted: (stepId) => { /* handle step completion */ },
});
```

**Features:**
- Automatic periodic analysis (default: every 10 seconds)
- Only analyzes when `messageCount` increases
- Debouncing to prevent excessive API calls (minimum 3s gap)
- Speaker change detection triggers immediate analysis
- Pause/resume functionality

### 7. Voice Interface Integration

In `PremiumVoiceInterface`, consultant mode enables:

**No TTS Output:**
```typescript
// src/components/chat/PremiumVoiceInterface.tsx
consultantMode?: boolean; // If true, AI listens but doesn't respond (no TTS, diarization enabled)
```

**Speaker Diarization:**
- Speakers are identified as S1, S2, S3, etc.
- The first speaker is typically assigned as the CONSULTANT
- Speaker assignment overlay allows mapping speakers to participants

**Speaker Assignment:**
```typescript
export interface SpeakerMapping {
  speaker: string;          // e.g., "S1"
  participantId: string | null;
  participantName: string;
  shouldTranscribe: boolean;
}
```

### 8. UI Components Affected

#### ChatComponent (`src/components/chat/ChatComponent.tsx`)

Accepts `consultantMode` prop:
```typescript
interface ChatComponentProps {
  // ... other props
  consultantMode?: boolean;
  onSpeakerChange?: (speaker: string) => void;
}
```

When enabled:
- Passes `consultantMode={true}` to `PremiumVoiceInterface`
- Notifies parent of speaker changes for analysis triggers

#### InsightPanel (`src/components/insight/InsightPanel.tsx`)

Behavior changes in consultant mode:
```typescript
interface InsightPanelProps {
  isConsultantMode?: boolean;  // Changes display logic
  isSpokesperson?: boolean;    // Shows full content instead of summary
}
```

#### SuggestedQuestionsPanel

Only displayed to spokesperson in consultant mode:
```typescript
{isConsultantMode && isSpokesperson && (
  <SuggestedQuestionsPanel
    questions={consultantAnalysis.questions}
    isAnalyzing={consultantAnalysis.isAnalyzing}
  />
)}
```

## Configuration Examples

### Creating a Consultant Mode ASK

Via Admin API:
```bash
curl -X POST 'http://localhost:3000/api/admin/asks' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "User Research Interview",
    "question": "What challenges do you face in your daily workflow?",
    "projectId": "uuid-here",
    "conversationMode": "consultant",
    "deliveryMode": "physical",
    "expectedDurationMinutes": 20,
    "startDate": "2024-01-15",
    "endDate": "2024-01-20"
  }'
```

### Testing Consultant Analysis Endpoint

```bash
# Test consultant-analyze endpoint
curl -X POST 'http://localhost:3000/api/ask/your-ask-key/consultant-analyze' \
  -H 'Content-Type: application/json' \
  -H 'X-Invite-Token: your-invite-token' \
  -d '{}'

# Expected response:
# {
#   "success": true,
#   "data": {
#     "questions": [
#       { "id": "q-xxx-0", "text": "Could you elaborate on...", "timestamp": "..." },
#       { "id": "q-xxx-1", "text": "What specific examples...", "timestamp": "..." }
#     ],
#     "insights": [...],
#     "stepCompleted": null
#   }
# }
```

## Step Completion Detection

The consultant helper agent can automatically detect when a conversation step should be completed.

### Detection Markers

The agent outputs a marker when objectives are met:
```
STEP_COMPLETE:step_1
```

Or with markdown formatting:
```
**STEP_COMPLETE:step_1**
```

Or for current step:
```
STEP_COMPLETE:
```

### Completion Triggers

The agent triggers step completion when:
1. The step's objective is clearly achieved
2. Participants have sufficiently addressed the topic
3. Signs of fatigue or repetition are detected
4. The conversation is going in circles

## Troubleshooting

### No Questions Appearing

1. **Check conversation mode:** Ensure `conversationMode === 'consultant'`
2. **Check spokesperson status:** Only spokespersons see suggested questions
3. **Check message count:** Analysis only runs when new messages arrive
4. **Check API logs:** Look for errors in `/api/ask/[key]/consultant-analyze`

### Empty Messages in Thread

In consultant mode, all participants share the same thread (shared thread). Speaker identification is handled via:
- **Voice mode:** Diarization labels (S1, S2, S3, etc.) are assigned by Speechmatics STT
- **Text mode:** Message metadata contains the participant identifier

If you see empty messages:

1. Verify user identification (invite token or auth cookie)
2. Check speaker mapping for diarization labels in voice mode
3. Verify message metadata contains correct participant info in text mode
4. See API logs for "No user identified" warnings

### Analysis Not Triggering

1. Verify `enabled` is true in `useConsultantAnalysis`
2. Check that `messageCount` is changing
3. Ensure minimum 3-second gap between analyses (debounce)
4. Check if analysis is paused (`isPaused` state)

## Testing

### Unit Tests

The hook has comprehensive tests at:
`src/hooks/__tests__/useConsultantAnalysis.test.ts`

Run tests:
```bash
npm test -- --testPathPattern="useConsultantAnalysis"
```

### Manual Testing

1. Create an ASK with `conversationMode: 'consultant'`
2. Join as a participant with spokesperson role
3. Start voice mode
4. Speak into the microphone
5. Verify:
   - Transcript appears without AI responses
   - Suggested questions panel shows after ~10 seconds
   - Insights are detected
   - Step completion triggers at appropriate moments

## Related Documentation

- [Voice Mode with ElevenLabs](/docs/features/voice-elevenlabs.md)
- [Conversation Agent Reference](/docs/ai-system/conversation-agent-reference.md)
- [Handlebars Templates](/docs/features/handlebars-templates.md)
- [Database Schema](/docs/architecture/database-schema.md)

## Code References

| Component | File Path |
|-----------|-----------|
| Type Definition | `src/types/index.ts` |
| Utility Function | `src/lib/utils.ts#isConsultantMode` |
| API Respond Route | `src/app/api/ask/[key]/respond/route.ts` |
| Consultant Analyze API | `src/app/api/ask/[key]/consultant-analyze/route.ts` |
| Analysis Hook | `src/hooks/useConsultantAnalysis.ts` |
| Hook Tests | `src/hooks/__tests__/useConsultantAnalysis.test.ts` |
| Chat Component | `src/components/chat/ChatComponent.tsx` |
| Voice Interface | `src/components/chat/PremiumVoiceInterface.tsx` |
| Insight Panel | `src/components/insight/InsightPanel.tsx` |
| Home Page Integration | `src/app/HomePage.tsx` |
| DB Migration (mode) | `migrations/080_add_consultant_conversation_mode.sql` |
| DB Migration (agent) | `migrations/081_add_consultant_helper_agent.sql` |
