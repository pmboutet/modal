# Step Completion System

This document describes the step completion system used in ASK conversations to guide users through structured conversation plans.

## Overview

The step completion system allows AI agents to guide conversations through predefined steps, each with specific objectives. When the AI determines a step's objective has been met, it signals completion using a `STEP_COMPLETE` marker, which triggers:

1. Step status update in the database
2. AI-generated summary of the completed step
3. Activation of the next step
4. UI updates to reflect progress

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Response   │────>│  detectStep     │────>│  step-complete  │
│ (with marker)   │     │  Complete()     │     │  API endpoint   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        v
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   UI Update     │<────│  step-summary   │<────│  completeStep() │
│ (progress bar)  │     │  API endpoint   │     │  function       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Database Schema

### ask_conversation_plans

Main table storing conversation plans.

```sql
CREATE TABLE public.ask_conversation_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_thread_id UUID NOT NULL REFERENCES conversation_threads(id),

  -- Metadata
  title TEXT,
  objective TEXT,
  total_steps INTEGER DEFAULT 0,
  completed_steps INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',  -- 'active', 'completed', 'abandoned'

  -- Current step tracking
  current_step_id VARCHAR(100),  -- step_identifier (e.g., "step_1")

  -- Legacy JSONB (backward compatibility)
  plan_data JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ask_conversation_plan_steps

Normalized table storing individual steps.

```sql
CREATE TABLE public.ask_conversation_plan_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES ask_conversation_plans(id),

  -- Step identification
  step_identifier VARCHAR(100) NOT NULL,  -- e.g., "step_1", "step_2"
  step_order INTEGER NOT NULL,            -- 1-based index

  -- Step content
  title TEXT NOT NULL,
  objective TEXT NOT NULL,

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- Values: 'pending', 'active', 'completed', 'skipped'

  -- AI-generated summary
  summary TEXT,
  summary_error TEXT,  -- Stores error if summary generation fails

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ,   -- When status changed to 'active'
  completed_at TIMESTAMPTZ,   -- When status changed to 'completed'

  UNIQUE(plan_id, step_identifier),
  UNIQUE(plan_id, step_order)
);
```

### Messages Linking

Messages are linked to steps via `plan_step_id`:

```sql
ALTER TABLE public.messages
ADD COLUMN plan_step_id UUID REFERENCES ask_conversation_plan_steps(id);
```

## STEP_COMPLETE Marker

### Format

The AI signals step completion by including a marker in its response:

```
STEP_COMPLETE:step_1
```

Supported formats:
- `STEP_COMPLETE:step_1` - Standard format
- `STEP_COMPLETE: step_1` - With space
- `**STEP_COMPLETE:step_1**` - Markdown bold
- `**STEP_COMPLETE:**` - Without step_id (uses current step)
- `STEP_COMPLETE:` - Without step_id (uses current step)

### Detection Function

Located in `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/lib/sanitize.ts`:

```typescript
/**
 * Detects and extracts step completion information from message content.
 * Returns the step ID if present, or null if no marker found.
 */
export function detectStepComplete(content: string): { hasMarker: boolean; stepId: string | null } {
  // Clean markdown formatting around STEP_COMPLETE for detection
  const cleanedForDetection = content.replace(
    /(\*{1,2}|_{1,2})(STEP_COMPLETE:?\s*\w*)(\*{1,2}|_{1,2})/gi,
    '$2'
  );

  const stepCompleteMatch = cleanedForDetection.match(/STEP_COMPLETE:\s*(\w+)/i);
  const hasStepCompleteWithId = stepCompleteMatch !== null;

  // Also detect STEP_COMPLETE without ID
  const hasStepCompleteWithoutId = !hasStepCompleteWithId &&
    /STEP_COMPLETE:?\s*(?!\w)/i.test(cleanedForDetection);

  return {
    hasMarker: hasStepCompleteWithId || hasStepCompleteWithoutId,
    stepId: stepCompleteMatch?.[1] ?? null
  };
}
```

### Cleaning Function

Removes the marker from displayed content:

```typescript
/**
 * Removes STEP_COMPLETE markers from message content for display.
 */
export function cleanStepCompleteMarker(content: string): string {
  return content
    .replace(/(\*{1,2}|_{1,2})?(STEP_COMPLETE:?\s*\w*)(\*{1,2}|_{1,2})?/gi, '')
    .trim();
}
```

## Step Completion API

### POST /api/ask/[key]/step-complete

Endpoint to mark a step as completed.

**Location**: `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/app/api/ask/[key]/step-complete/route.ts`

**Request**:
```json
{
  "stepId": "step_1"
}
```

**Headers**:
- `Content-Type: application/json`
- `X-Invite-Token: <token>` (optional, for participant authentication)

**Response**:
```json
{
  "success": true,
  "data": {
    "conversationPlan": { /* Updated plan with steps */ },
    "completedStepId": "step_1",
    "nextStepId": "step_2"
  }
}
```

**Flow**:
1. Validate request and authentication
2. Get ASK session and conversation thread
3. Call `completeStep()` to update step status
4. Trigger async summary generation via `/api/ask/[key]/step-summary`
5. Return updated plan

### POST /api/ask/[key]/step-summary

Generates AI summary for a completed step.

**Location**: `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/app/api/ask/[key]/step-summary/route.ts`

**Request**:
```json
{
  "stepId": "uuid-of-step-record",
  "askSessionId": "uuid-of-ask-session"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "summary": "Summary text generated by AI..."
  }
}
```

## Step Completion Logic

### completeStep() Function

Located in `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/lib/ai/conversation-plan.ts`:

```typescript
export async function completeStep(
  supabase: SupabaseClient,
  conversationThreadId: string,
  completedStepIdentifier: string,
  stepSummary?: string,
  askSessionId?: string
): Promise<ConversationPlan | null> {
  // 1. Get the plan
  const plan = await getConversationPlan(supabase, conversationThreadId);

  // 2. Get the step to complete
  const completedStep = await getPlanStep(supabase, plan.id, completedStepIdentifier);

  // 3. Mark step as completed via RPC
  await supabase.rpc('complete_plan_step', {
    p_step_id: completedStep.id,
    p_summary: stepSummary || completedStep.summary,
  });

  // 4. Find and activate the next step
  const nextStep = await supabase.rpc('get_next_plan_step', {
    p_plan_id: plan.id,
    p_current_step_order: completedStep.step_order,
  });

  if (nextStep) {
    await supabase.rpc('activate_plan_step', { p_step_id: nextStep.id });
  }

  // 5. Update plan's current_step_id
  await supabase.rpc('update_plan_current_step', {
    p_plan_id: plan.id,
    p_current_step_id: nextStep?.step_identifier ?? null,
  });

  // 6. Trigger summary generation (REQUIRED)
  if (askSessionId) {
    await fetch(`${baseUrl}/api/ask/${askKey}/step-summary`, {
      method: 'POST',
      body: JSON.stringify({ stepId: completedStep.id, askSessionId }),
    });
  }

  return updatedPlan;
}
```

### detectStepCompletion() Function

Wrapper function in conversation-plan.ts that uses the centralized detection:

```typescript
export function detectStepCompletion(content: string): string | null {
  const { hasMarker, stepId } = detectStepComplete(content);

  if (!hasMarker) {
    return null;
  }

  // Return step_id if found, otherwise 'CURRENT' to use the current active step
  return stepId ?? 'CURRENT';
}
```

## Text Mode Step Completion

In text mode (via `/api/ask/[key]/respond`), step completion is handled synchronously:

```typescript
// In respond/route.ts
const detectedStepId = detectStepCompletion(latestAiResponse);
if (detectedStepId) {
  const plan = await getConversationPlanWithSteps(supabase, conversationThread.id);
  const currentStep = getCurrentStep(plan);

  const stepIdToComplete = detectedStepId === 'CURRENT'
    ? currentStep?.step_identifier
    : detectedStepId;

  if (currentStep && (detectedStepId === 'CURRENT' || currentStep.step_identifier === detectedStepId)) {
    await completeStep(
      adminSupabase,
      conversationThread.id,
      stepIdToComplete!,
      undefined,  // No pre-generated summary
      askRow.id   // Triggers async summary generation
    );
  }
}
```

## Voice Mode Step Completion

Voice mode has additional complexity due to streaming and potential duplicate detections.

### Deduplication with completingStepsRef

Located in `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/components/chat/PremiumVoiceInterface.tsx`:

```typescript
// Track steps being completed to prevent duplicate API calls
const completingStepsRef = useRef<Set<string>>(new Set());

// In handleMessage callback:
const { hasMarker, stepId: detectedStepId } = detectStepComplete(rawMessage.content);
if (hasMarker) {
  const stepIdToComplete = detectedStepId === 'CURRENT' || !detectedStepId
    ? conversationPlan?.current_step_id
    : detectedStepId;

  // DEDUPLICATION: Skip if already completing
  if (stepIdToComplete && completingStepsRef.current.has(stepIdToComplete)) {
    console.log('[PremiumVoiceInterface] Skipped (already completing):', stepIdToComplete);
  } else if (stepIdToComplete) {
    // Mark step as being completed
    completingStepsRef.current.add(stepIdToComplete);

    fetch(`/api/ask/${askKey}/step-complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ stepId: stepIdToComplete }),
    })
      .then(result => {
        if (result.success) {
          updatePromptsFromApi(`step completed: ${stepIdToComplete}`);
        } else {
          // Remove from set on failure for retry
          completingStepsRef.current.delete(stepIdToComplete);
        }
      })
      .catch(error => {
        completingStepsRef.current.delete(stepIdToComplete);
      });
  }
}
```

### Prompt Updates After Step Completion

After a step is completed in voice mode, prompts are refreshed to include new step context:

```typescript
const updatePromptsFromApi = useCallback(async (reason: string) => {
  const response = await fetch(`/api/ask/${askKey}/agent-config`);
  const { systemPrompt, userPrompt, promptVariables } = await response.json().data;

  // Update the agent's prompts without reconnecting
  agent.updatePrompts({ systemPrompt, userPrompt, promptVariables });
}, [askKey]);
```

## Time Variables and Overtime

### Available Time Variables

Calculated in `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/lib/pacing.ts`:

| Variable | Description |
|----------|-------------|
| `conversation_elapsed_minutes` | Total active conversation time |
| `step_elapsed_minutes` | Time spent on current step |
| `time_remaining_minutes` | Remaining time budget |
| `is_overtime` | Whether conversation exceeds expected duration |
| `overtime_minutes` | Minutes over expected duration |
| `step_is_overtime` | Whether current step exceeds its time budget |
| `step_overtime_minutes` | Minutes over step time budget |
| `questions_asked_total` | Total AI messages count |
| `questions_asked_in_step` | AI messages in current step |

### Periodic Prompt Updates

Voice mode refreshes prompts every 30 seconds to update time variables:

```typescript
// In PremiumVoiceInterface.tsx
useEffect(() => {
  // Calculate update slot (every 0.5 minute = 30 seconds)
  const currentSlot = Math.floor(elapsedMinutes * 2);

  if (currentSlot === lastPromptUpdateMinuteRef.current) {
    return;  // Same slot, skip
  }

  lastPromptUpdateMinuteRef.current = currentSlot;
  updatePromptsFromApi(`periodic time update at ${elapsedMinutes.toFixed(1)}min`);
}, [elapsedMinutes, isTimerPaused, updatePromptsFromApi]);
```

## Step Transitions

### When a Step is Completed

1. **Database Updates**:
   - Step status changes from `active` to `completed`
   - `completed_at` timestamp is set
   - Plan's `completed_steps` counter is incremented

2. **Next Step Activation**:
   - Next step (by `step_order`) status changes from `pending` to `active`
   - `activated_at` timestamp is set
   - Plan's `current_step_id` is updated

3. **Summary Generation**:
   - `/api/ask/[key]/step-summary` is called
   - AI generates summary using the `ask-conversation-step-summarizer` agent
   - Summary is stored in the step's `summary` field

4. **Prompt Context Updates**:
   - `current_step` and `current_step_id` variables update
   - `completed_steps_summary` includes the new summary
   - `step_messages` filters to only show new step's messages

### When All Steps are Complete

1. Plan status changes to `completed`
2. `all_steps_completed` variable becomes `true`
3. `is_last_step` was `true` on the final step
4. UI displays completion celebration

## UI Components

### StepCompletionCard

Displayed when a step is completed:

```tsx
<StepCompletionCard
  stepNumber={stepNumber}
  stepTitle={completedStep.title}
  stepObjective={completedStep.objective}
  variant="light"
  className="mb-3"
/>
```

### ChatComponent Step Detection

```typescript
// In ChatComponent.tsx MessageBubble
const { hasMarker: hasStepComplete, stepId: completedStepId } = detectStepComplete(message.content);

const completedStep = hasStepComplete && conversationPlan
  ? completedStepId
    ? conversationPlan.plan_data.steps.find(step => step.id === completedStepId)
    : conversationPlan.plan_data.steps.find(step => step.status === 'active')
  : undefined;

// Clean marker from display
const cleanContent = cleanStepCompleteMarker(message.content);
```

### Interview Completion Celebration

When all steps are completed, ChatComponent displays a celebration:

```typescript
const allStepsCompleted = conversationPlan && conversationPlan.plan_data.steps.length > 0
  ? conversationPlan.plan_data.steps.every(step => step.status === 'completed')
  : false;

{allStepsCompleted && (
  <motion.div className="relative overflow-hidden rounded-2xl...">
    <h3>Entretien termine !</h3>
    <p>Toutes les etapes ont ete completees avec succes !</p>
  </motion.div>
)}
```

## Testing

### Test Step Detection

```bash
# Run unit tests for sanitize.ts
npm test -- --testPathPattern="sanitize.test"
```

### Test Step Completion API

```bash
# Complete a step
curl -s -X POST 'http://localhost:3000/api/ask/ma-ask-key/step-complete' \
  -H 'Content-Type: application/json' \
  -d '{"stepId":"step_1"}'
```

### Check Step Status via Database

```bash
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT
  s.step_identifier,
  s.title,
  s.status,
  s.summary IS NOT NULL as has_summary,
  s.activated_at,
  s.completed_at
FROM ask_conversation_plan_steps s
JOIN ask_conversation_plans p ON s.plan_id = p.id
JOIN conversation_threads t ON p.conversation_thread_id = t.id
JOIN ask_sessions a ON t.ask_session_id = a.id
WHERE a.ask_key = 'ma-ask-key'
ORDER BY s.step_order;
"
```

## Troubleshooting

### Step Not Completing

1. Check if marker is in correct format: `STEP_COMPLETE:step_id`
2. Verify step exists and is currently active
3. Check for RLS policy issues on step tables
4. Look for errors in Sentry or server logs

### Duplicate Step Completions

1. Check `completingStepsRef` in voice mode logs
2. Look for multiple API calls in network tab
3. Verify deduplication logic is running

### Summary Not Generating

1. Check `/api/ask/[key]/step-summary` endpoint logs
2. Verify `ask-conversation-step-summarizer` agent is configured
3. Check `summary_error` field in step record:

```bash
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT step_identifier, summary_error
FROM ask_conversation_plan_steps
WHERE summary_error IS NOT NULL;
"
```

## Related Files

- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/lib/sanitize.ts` - Marker detection/cleaning
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/lib/ai/conversation-plan.ts` - Plan management functions
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/lib/ai/conversation-agent.ts` - Agent variable building
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/lib/pacing.ts` - Time tracking utilities
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/app/api/ask/[key]/step-complete/route.ts` - Step completion API
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/app/api/ask/[key]/step-summary/route.ts` - Summary generation API
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/app/api/ask/[key]/respond/route.ts` - Text mode response handler
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/components/chat/ChatComponent.tsx` - Text chat UI
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/src/components/chat/PremiumVoiceInterface.tsx` - Voice mode UI
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/migrations/057_add_conversation_plans.sql` - Initial schema
- `/Users/pmboutet/Documents/GitHub/agentic-design-flow/migrations/058_refactor_conversation_plans.sql` - Normalized steps schema
