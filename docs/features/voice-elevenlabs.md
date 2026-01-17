# Configuration d'ElevenLabs pour la Synthèse Vocale (TTS)

## Vue d'ensemble

ElevenLabs est utilisé dans ce projet pour la synthèse vocale (Text-to-Speech) dans le mode **hybrid-voice-agent**. Ce mode combine :
- **Deepgram** pour la reconnaissance vocale (Speech-to-Text / STT)
- **LLM** (Anthropic ou OpenAI) pour générer les réponses
- **ElevenLabs** pour la synthèse vocale (Text-to-Speech / TTS)

## Prérequis

1. Un compte ElevenLabs (gratuit ou payant)
2. Une clé API ElevenLabs
3. Accès à la base de données Supabase
4. Accès aux variables d'environnement (local ou Vercel)

## Étape 1 : Obtenir une clé API ElevenLabs

1. **Créer un compte ElevenLabs**
   - Allez sur https://elevenlabs.io
   - Créez un compte (plan gratuit disponible avec limites)

2. **Obtenir votre clé API**
   - Connectez-vous à votre compte
   - Allez dans **Profile** → **API Keys**
   - Cliquez sur **Generate New API Key**
   - Copiez la clé API (elle ne sera affichée qu'une seule fois)

3. **Choisir une voix (optionnel)**
   - Allez dans **Voices** dans le dashboard ElevenLabs
   - Explorez les voix disponibles
   - Notez l'ID de la voix que vous souhaitez utiliser (ex: `21m00Tcm4TlvDq8ikWAM` pour Rachel)
   - Vous pouvez aussi créer une voix personnalisée

## Étape 2 : Configurer la variable d'environnement

### En développement local

1. Créez ou modifiez le fichier `.env.local` à la racine du projet :

```env
ELEVENLABS_API_KEY=votre_cle_api_elevenlabs_ici
```

2. Redémarrez le serveur de développement :
```bash
npm run dev
```

### En production (Vercel)

1. Allez sur votre projet Vercel
2. **Settings** → **Environment Variables**
3. Ajoutez la variable :
   - **Name** : `ELEVENLABS_API_KEY`
   - **Value** : votre clé API ElevenLabs
   - **Environment** : Production, Preview, Development (selon vos besoins)
4. Cliquez sur **Save**
5. **Redéployez** votre application pour que la variable soit prise en compte

## Étape 3 : Configurer la base de données

### Option A : Via l'interface Admin (Recommandé)

1. Connectez-vous à l'application en tant qu'administrateur
2. Allez dans la section **Admin** → **AI Models**
3. Créez ou modifiez une configuration de modèle avec le provider `hybrid-voice-agent`
4. Configurez les champs ElevenLabs :
   - **ElevenLabs Voice ID** : L'ID de la voix (ex: `21m00Tcm4TlvDq8ikWAM`)
   - **ElevenLabs Model ID** : Le modèle TTS (ex: `eleven_turbo_v2_5` ou `eleven_multilingual_v2`)
   - **ElevenLabs API Key Env Var** : `ELEVENLABS_API_KEY` (par défaut)

### Option B : Via SQL direct

Exécutez cette requête SQL dans l'éditeur SQL de Supabase :

```sql
-- Mettre à jour une configuration de modèle existante
UPDATE ai_model_configs
SET 
  elevenlabs_voice_id = '21m00Tcm4TlvDq8ikWAM',  -- Remplacez par votre voice ID
  elevenlabs_model_id = 'eleven_turbo_v2_5',     -- Modèle TTS
  elevenlabs_api_key_env_var = 'ELEVENLABS_API_KEY'
WHERE provider = 'hybrid-voice-agent';

-- Ou créer une nouvelle configuration
INSERT INTO ai_model_configs (
  code,
  name,
  provider,
  model,
  api_key_env_var,
  elevenlabs_voice_id,
  elevenlabs_model_id,
  elevenlabs_api_key_env_var
) VALUES (
  'hybrid-voice-agent-elevenlabs',
  'Hybrid Voice Agent avec ElevenLabs',
  'hybrid-voice-agent',
  'claude-3-5-haiku-latest',  -- Modèle LLM
  'ANTHROPIC_API_KEY',        -- Clé API pour le LLM
  '21m00Tcm4TlvDq8ikWAM',     -- Voice ID ElevenLabs
  'eleven_turbo_v2_5',        -- Modèle TTS ElevenLabs
  'ELEVENLABS_API_KEY'        -- Variable d'environnement pour ElevenLabs
);
```

## Étape 4 : Modèles et voix disponibles

### Modèles TTS ElevenLabs

- `eleven_turbo_v2_5` (par défaut) - Rapide, optimisé pour la latence
- `eleven_multilingual_v2` - Support multilingue (FR, EN, ES, DE, etc.)
- `eleven_monolingual_v1` - Anglais uniquement

### Voix par défaut (exemples)

- **Rachel** : `21m00Tcm4TlvDq8ikWAM` (voix féminine anglaise)
- **Domi** : `AZnzlk1XvdvUeBnXmlld` (voix féminine anglaise)
- **Bella** : `EXAVITQu4vr4xnSDxMaL` (voix féminine anglaise)
- **Antoni** : `ErXwobaYiN019PkySvjV` (voix masculine anglaise)
- **Elli** : `MF3mGyEYCl7XYWbV9V6O` (voix féminine anglaise)
- **Josh** : `TxGEqnHWrfWFTfGW9XjX` (voix masculine anglaise)
- **Arnold** : `VR6AewLTigWG4xSOukaG` (voix masculine anglaise)
- **Adam** : `pNInz6obpgDQGcFmaJgB` (voix masculine anglaise)
- **Sam** : `yoZ06aMxZJJ28mfd3POQ` (voix masculine anglaise)

**Note** : Pour obtenir la liste complète des voix disponibles avec votre compte, utilisez l'API ElevenLabs ou consultez le dashboard.

## Étape 5 : Utilisation dans l'application

### Configuration d'un ASK avec voice mode

1. Créez ou modifiez un ASK
2. Dans les paramètres du modèle, sélectionnez :
   - **Provider** : `hybrid-voice-agent`
   - **ElevenLabs Voice ID** : Choisissez une voix
   - **ElevenLabs Model ID** : Choisissez un modèle TTS

### Test de la configuration

1. Ouvrez un ASK avec le mode vocal activé
2. Cliquez sur le bouton de mode vocal
3. Parlez dans le microphone
4. L'agent devrait répondre avec la voix ElevenLabs configurée

## Dépannage

### Erreur : "ElevenLabs API key is not set"

**Problème** : La variable d'environnement `ELEVENLABS_API_KEY` n'est pas configurée.

**Solution** :
1. Vérifiez que la variable est définie dans `.env.local` (local) ou dans Vercel (production)
2. Redémarrez le serveur de développement ou redéployez sur Vercel
3. Vérifiez que le nom de la variable est exactement `ELEVENLABS_API_KEY` (sensible à la casse)

### Erreur : "ElevenLabs API error (401)"

**Problème** : La clé API est invalide ou expirée.

**Solution** :
1. Vérifiez que la clé API est correcte dans votre compte ElevenLabs
2. Générez une nouvelle clé API si nécessaire
3. Mettez à jour la variable d'environnement

### Erreur : "ElevenLabs API error (429)"

**Problème** : Vous avez atteint la limite de votre plan ElevenLabs.

**Solution** :
1. Vérifiez votre utilisation dans le dashboard ElevenLabs
2. Attendez que la limite se réinitialise (généralement mensuel)
3. Ou passez à un plan supérieur

### La voix ne fonctionne pas

**Problème** : La configuration de la voix n'est pas correcte.

**Solution** :
1. Vérifiez que `elevenlabs_voice_id` est correct dans la base de données
2. Vérifiez que le voice ID existe dans votre compte ElevenLabs
3. Testez avec une voix par défaut (ex: `21m00Tcm4TlvDq8ikWAM`)

### Le modèle TTS ne fonctionne pas

**Problème** : Le modèle ID est incorrect ou non disponible.

**Solution** :
1. Vérifiez que `elevenlabs_model_id` est correct (ex: `eleven_turbo_v2_5`)
2. Vérifiez que le modèle est disponible dans votre plan ElevenLabs
3. Utilisez `eleven_turbo_v2_5` qui est généralement disponible sur tous les plans

## Vérification de la configuration

### Vérifier la variable d'environnement

```bash
# En local
echo $ELEVENLABS_API_KEY

# Ou dans Node.js
node -e "console.log(process.env.ELEVENLABS_API_KEY)"
```

### Vérifier la configuration dans la base de données

```sql
SELECT 
  code,
  name,
  provider,
  elevenlabs_voice_id,
  elevenlabs_model_id,
  elevenlabs_api_key_env_var
FROM ai_model_configs
WHERE provider = 'hybrid-voice-agent';
```

### Tester l'API ElevenLabs directement

```bash
curl -X GET "https://api.elevenlabs.io/v1/voices" \
  -H "xi-api-key: VOTRE_CLE_API"
```

## Paramètres avancés

### Personnaliser les paramètres de voix

Vous pouvez modifier les paramètres de voix dans le code (`src/lib/ai/elevenlabs.ts`) :

- **stability** (0.0 - 1.0) : Stabilité de la voix (défaut: 0.5)
- **similarityBoost** (0.0 - 1.0) : Similarité avec la voix originale (défaut: 0.75)
- **style** (0.0 - 1.0) : Style de la voix (défaut: 0.0)
- **useSpeakerBoost** (boolean) : Amélioration du locuteur (défaut: true)

### Créer une voix personnalisée

1. Allez dans **Voices** → **Add Voice** dans le dashboard ElevenLabs
2. Suivez les instructions pour créer une voix personnalisée
3. Utilisez le voice ID généré dans votre configuration

## Ressources

- [Documentation ElevenLabs API](https://elevenlabs.io/docs)
- [Dashboard ElevenLabs](https://elevenlabs.io/app)
- [Liste des voix disponibles](https://elevenlabs.io/app/voices)

## Support

Si vous rencontrez des problèmes :
1. Vérifiez les logs du serveur (console du navigateur et logs Vercel)
2. Vérifiez les logs de l'API ElevenLabs dans le dashboard
3. Consultez la documentation ElevenLabs pour les erreurs spécifiques

---

## Voice Configuration Validation

### Validation Scripts

**1. Database Verification:**
```bash
node scripts/verify-voice-config-db.js
```

Checks:
- `ai_model_configs` table structure (Deepgram and ElevenLabs columns)
- Existing configurations
- NULL/invalid values
- Consistency between provider and configured fields

**2. API Verification:**
```bash
node scripts/verify-voice-config-apis.js
```

Checks:
- Deepgram and ElevenLabs API key validity
- Available Deepgram models (STT, TTS, LLM)
- Available ElevenLabs voices
- Consistency between DB values and APIs

**3. Complete Validation:**
```bash
node scripts/validate-voice-config.js
```

Runs all checks and generates a complete report.

### Supported Deepgram Models

**STT (Speech-to-Text):**
- `nova-2` (recommended, multilingual)
- `nova-3` (multilingual)
- `nova` (legacy)
- `enhanced`, `base`

**TTS (Text-to-Speech):**
- `aura-2-thalia-en` (recommended)
- `aura-2-asteria-en`, `aura-2-luna-en`, `aura-2-stella-en`
- `aura-thalia-en`, `aura-asteria-en` (legacy)

**LLM - Anthropic:**
- `claude-3-5-haiku-latest` (recommended)
- `claude-3-5-sonnet-20241022`
- `claude-sonnet-4-20250514`
- `claude-3-opus-20240229`

**LLM - OpenAI:**
- `gpt-4o` (recommended)
- `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`

### Required Configuration

**For `deepgram-voice-agent`:**
- `deepgram_stt_model` (required)
- `deepgram_tts_model` (required)
- `deepgram_llm_provider` (required)
- `deepgram_voice_agent_model` (required)

**For `hybrid-voice-agent`:**
- `deepgram_stt_model` (required)
- `deepgram_llm_provider` (required)
- `deepgram_voice_agent_model` (required)
- `elevenlabs_voice_id` (required)
- `elevenlabs_model_id` (required, default: `eleven_turbo_v2_5`)

### Environment Variables

- `DEEPGRAM_API_KEY` - Deepgram API key (required)
- `ELEVENLABS_API_KEY` - ElevenLabs API key (required for hybrid-voice-agent)

### Best Practices

1. **Use multilingual models for STT** - Prefer `nova-2` or `nova-3` for automatic language detection
2. **Validate before deployment** - Run verification scripts regularly
3. **Handle errors gracefully** - API errors are caught and logged, fallbacks are in place
4. **Security** - API keys are never exposed client-side

---

## Voice Mode Step Completion

### Overview

Voice mode supports automatic step completion when the AI emits a `STEP_COMPLETE` marker in its response. This enables the same multi-step conversation flow as text mode, where the AI can progress through a conversation plan.

### How It Works

1. **Detection**: When an AI message is finalized, `PremiumVoiceInterface` uses `detectStepComplete()` to scan for `STEP_COMPLETE` markers
2. **API Call**: If a marker is found, the client calls `POST /api/ask/[key]/step-complete` with the step ID
3. **Prompt Refresh**: After successful completion, `updatePromptsFromApi()` fetches fresh prompts with the new step context
4. **Deduplication**: A `completingStepsRef` Set prevents duplicate API calls for the same step

### STEP_COMPLETE Marker Formats

The AI can emit these formats (all detected automatically):
- `STEP_COMPLETE: step_1` - Completes specific step
- `STEP_COMPLETE:` - Completes current step
- `**STEP_COMPLETE: step_1**` - Markdown bold formatting (cleaned for TTS)

### Step-Complete API Endpoint

**Endpoint**: `POST /api/ask/[key]/step-complete`

**Request**:
```json
{
  "stepId": "step_1"
}
```

**Headers**:
- `Content-Type: application/json`
- `x-invite-token: <token>` (optional, for guest participants)

**Response**:
```json
{
  "success": true,
  "data": {
    "conversationPlan": { ... },
    "completedStepId": "step_1",
    "nextStepId": "step_2"
  }
}
```

**Error Responses**:
- `400` - Missing stepId
- `404` - ASK session or thread not found
- `500` - Step completion failed

### Code Flow

```
AI Response with STEP_COMPLETE marker
        ↓
handleMessage() in PremiumVoiceInterface
        ↓
detectStepComplete() → { hasMarker: true, stepId: "step_1" }
        ↓
Check completingStepsRef (deduplication)
        ↓
POST /api/ask/[key]/step-complete
        ↓
completeStep() marks step as completed
        ↓
updatePromptsFromApi() refreshes agent prompts
```

### Deduplication Logic

Voice mode can emit multiple message events for the same response (interim → final). To prevent duplicate step completions:

1. `completingStepsRef` is a `Set<string>` that tracks steps being completed
2. Before calling the API, check if the step ID is already in the set
3. On success, the step remains in the set (already completed)
4. On failure, the step is removed from the set (can retry)

```typescript
// DEDUPLICATION: Skip if this step is already being completed
if (stepIdToComplete && completingStepsRef.current.has(stepIdToComplete)) {
  console.log('STEP_COMPLETE skipped (already completing):', stepIdToComplete);
} else if (stepIdToComplete && askKey) {
  completingStepsRef.current.add(stepIdToComplete);
  // ... call API
}
```

---

## Voice Mode Welcome Message

### Overview

When voice mode starts with no existing messages, the system generates and speaks an initial welcome message. This maintains consistency with text mode, where an empty conversation triggers an AI greeting.

### How It Works

1. After the Speechmatics agent connects, `PremiumVoiceInterface` checks if `messages.length === 0`
2. If empty (and not in consultant mode), calls `POST /api/ask/[key]/respond` with empty content
3. The respond endpoint recognizes empty content as a greeting trigger
4. The AI response is passed to `agent.speakInitialMessage()` for TTS playback

### `speakInitialMessage()` Method

Located in `SpeechmaticsVoiceAgent` (`src/lib/ai/speechmatics.ts`):

```typescript
async speakInitialMessage(text: string): Promise<void> {
  // 1. Skip if text is empty or TTS is disabled
  // 2. Add to conversation history
  // 3. Emit message callback for UI display
  // 4. Clean STEP_COMPLETE markers before TTS
  // 5. Generate and play TTS audio via ElevenLabs
}
```

### Features

- **DRY with text mode**: Uses the same `/api/ask/[key]/respond` endpoint
- **STEP_COMPLETE cleaning**: Markers are removed before TTS to avoid speaking them
- **Graceful degradation**: If TTS is disabled, message is still displayed
- **Error handling**: Failures don't break the voice session

### Configuration Exclusions

Initial welcome message is skipped when:
- `consultantMode` is enabled (AI only listens)
- Messages already exist in the conversation
- The ASK key is missing

---

## Periodic Prompt Updates (Time Variables)

### Problem Solved

Voice mode prompts include time variables (`step_elapsed_minutes`, `is_overtime`, `step_is_overtime`) that are calculated server-side. Without periodic updates, these values become stale and overtime warnings never fire.

### Solution

`PremiumVoiceInterface` refreshes prompts every 30 seconds during active voice sessions:

1. A `useEffect` hook watches `elapsedMinutes` changes
2. Every 30 seconds (0.5 minute slot), `updatePromptsFromApi()` is called
3. Fresh prompts are fetched from `/api/ask/[key]/agent-config`
4. The Speechmatics agent's prompts are updated without reconnection

### Implementation

```typescript
// Calculate the current "update slot" (every 0.5 minute = 30 seconds)
const currentSlot = Math.floor(elapsedMinutes * 2);

// Skip if we're still in the same slot
if (currentSlot === lastPromptUpdateMinuteRef.current) {
  return;
}

// Update the ref and refresh prompts
lastPromptUpdateMinuteRef.current = currentSlot;
updatePromptsFromApi(`periodic time update at ${elapsedMinutes.toFixed(1)}min`);
```

### Skip Conditions

Periodic updates are skipped when:
- `elapsedMinutes` is undefined
- Timer is paused (`isTimerPaused`)
- Still in the first slot (initial load)
- Speechmatics agent is not connected

---

## `updatePromptsFromApi()` Function

### Purpose

Centralized function to refresh voice agent prompts from the server. Used by:
- Step changes (conversation plan progression)
- Step completion (after STEP_COMPLETE detected)
- Periodic time variable updates

### Implementation

```typescript
const updatePromptsFromApi = useCallback(async (reason: string) => {
  const agent = agentRef.current;
  if (!(agent instanceof SpeechmaticsVoiceAgent) || !agent.isConnected()) {
    return;
  }

  const response = await fetch(`/api/ask/${askKey}/agent-config`);
  const result = await response.json();

  agent.updatePrompts({
    systemPrompt: result.data.systemPrompt,
    userPrompt: result.data.userPrompt,
    promptVariables: result.data.promptVariables,
  });

  console.log('[PremiumVoiceInterface] Prompts updated:', reason);
}, [askKey]);
```

### Key Features

- **No reconnection**: Updates prompts without dropping the WebSocket connection
- **Reason logging**: Each call logs why the update was triggered
- **Error handling**: Failures are logged but don't break the session





