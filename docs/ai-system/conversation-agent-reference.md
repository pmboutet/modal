# Référence de l'agent ask-conversation-response

## Vue d'ensemble

L'agent `ask-conversation-response` est utilisé pour générer des réponses conversationnelles dans les sessions ASK. Il est utilisé de manière cohérente dans trois contextes principaux :

1. **Chat en mode texte** (home page)
2. **Chat en mode vocal** (Deepgram et Speechmatics)
3. **Mode test** (admin)

Cette documentation décrit le fonctionnement unifié de l'agent, la construction et la fusion des variables, et garantit la cohérence entre tous les modes d'utilisation.

## Architecture unifiée

### Fonction principale : `executeAgent`

Tous les modes utilisent la fonction `executeAgent` de `src/lib/ai/service.ts` pour exécuter l'agent. Cette fonction :

1. Récupère l'agent depuis la base de données
2. Pour `ask-conversation-response`, utilise `getAgentConfigForAsk` pour gérer la priorité des system_prompt
3. Fusionne les variables dans les prompts en utilisant `renderTemplate`
4. Appelle le provider de modèle approprié

### Configuration de l'agent : `getAgentConfigForAsk`

La fonction `getAgentConfigForAsk` dans `src/lib/ai/agent-config.ts` gère la sélection de l'agent selon la priorité suivante :

1. **Priorité 1** : Configuration agent personnalisée (`ai_config.agent_id` ou `ai_config.agent_slug`)
2. **Priorité 2** : Agent par défaut (`ask-conversation-response`)

**Important** : Le `system_prompt` de l'ASK, du projet et du challenge **ne remplacent PAS** le prompt de l'agent. Ils sont fournis comme **variables** (`system_prompt_ask`, `system_prompt_project`, `system_prompt_challenge`) qui peuvent être utilisées dans les templates de l'agent via `{{system_prompt_ask}}`, `{{system_prompt_project}}`, `{{system_prompt_challenge}}`. L'agent est **toujours** utilisé, et les variables sont substituées dans ses prompts.

## Construction des variables

### Fonction utilitaire : `buildChatAgentVariables`

La fonction `buildChatAgentVariables` dans `src/lib/ai/agent-config.ts` est utilisée pour construire les variables de manière standardisée :

```typescript
const variables = await buildChatAgentVariables(supabase, askSessionId, additionalVariables);
```

Cette fonction :
- Récupère la session ASK depuis la base de données
- Récupère le projet associé (si `project_id` est défini)
- Récupère le challenge associé (si `challenge_id` est défini)
- Construit un objet de variables standardisé incluant :
  - `ask_key` : Clé de la session ASK
  - `ask_question` : Question de la session ASK
  - `ask_description` : Description de la session ASK
  - `system_prompt_ask` : System prompt de la session ASK (depuis `ask_sessions.system_prompt`)
  - `system_prompt_project` : System prompt du projet (depuis `projects.system_prompt`)
  - `system_prompt_challenge` : System prompt du challenge (depuis `challenges.system_prompt`)

### Variables supplémentaires

En plus des variables de base, chaque mode ajoute des variables spécifiques au contexte :

#### Mode texte (respond)
- `message_history` : Historique formaté des messages
- `latest_user_message` : Dernier message utilisateur
- `latest_ai_response` : Dernière réponse AI
- `participant_name` : Nom du participant
- `participants` : Liste des participants
- `existing_insights_json` : Insights existants en JSON

#### Mode streaming
- `messages_json` : Messages formatés en JSON
- `participants` : Liste des participants

#### Mode vocal
- `messages_json` : Messages formatés en JSON (pour le logging)
- `participants` : Liste des participants

## Fusion des variables

### Mécanisme de substitution

La fusion des variables utilise la fonction `renderTemplate` de `src/lib/ai/templates.ts` qui remplace les variables au format `{{variable_name}}` dans les prompts.

**Pattern de substitution** : `{{variable_name}}`

**Exemple** :
```
Template: "Question: {{ask_question}}\nDescription: {{ask_description}}"
Variables: { ask_question: "Quelle est votre vision?", ask_description: "Partagez vos idées" }
Résultat: "Question: Quelle est votre vision?\nDescription: Partagez vos idées"
```

### Ordre de fusion

1. Les variables `system_prompt_*` sont récupérées depuis la base de données
2. Les variables sont passées à `getAgentConfigForAsk` ou `executeAgent`
3. `getAgentConfigForAsk` résout le system prompt selon la priorité (ask > challenge > project)
4. `renderTemplate` substitue toutes les variables `{{variable_name}}` dans les prompts résolus

## Initialisation automatique de la conversation

### Vue d'ensemble

L'agent conversation initie automatiquement la conversation lorsqu'il n'y a aucun message dans la session ASK. Cette fonctionnalité est disponible dans trois modes :

1. **Mode texte - GET** : Lors du chargement initial de la session (`GET /api/ask/[key]`)
2. **Mode texte - POST init** : Lorsque l'utilisateur donne le focus au textarea (`POST /api/ask/[key]/init`)
3. **Mode voix** : Lors de l'initialisation de l'agent vocal (`POST /api/ask/[key]/voice-agent/init`)

### Comportement

#### Mode texte - GET (`GET /api/ask/[key]/route.ts`)

Lors du chargement initial d'une session ASK :

1. Le système récupère les messages existants pour le thread de conversation
2. **Si aucun message n'existe** :
   - Les variables sont construites via `buildChatAgentVariables` avec `messages_json: JSON.stringify([])` et `participants: ''`
   - L'agent conversation est appelé avec `executeAgent`
   - Un message initial de l'agent est généré et inséré dans la base de données
   - Le message est associé au thread de conversation approprié (`conversation_thread_id`)
   - Le message initial est inclus dans la réponse de l'API

**Flux backend** (`/api/ask/[key]/route.ts`) :
```typescript
// Si aucun message n'existe, initier la conversation
if (messages.length === 0) {
  // Build variables for agent with empty messages array for initialization
  const baseVariables = await buildChatAgentVariables(dataClient, askSessionId, {
    // For initialization, provide empty messages array
    messages_json: JSON.stringify([]),
    participants: '', // No participants yet for initial message
  });
  
  const agentResult = await executeAgent({
    supabase: dataClient,
    agentSlug: 'ask-conversation-response',
    askSessionId: askSessionId,
    interactionType: 'ask.chat.response',
    variables: baseVariables,
  });

  if (typeof agentResult.content === 'string' && agentResult.content.trim().length > 0) {
    // Insérer le message initial dans la base de données
    const { data: insertedRows } = await dataClient
      .from('messages')
      .insert({
        ask_session_id: askSessionId,
        content: agentResult.content.trim(),
        sender_type: 'ai',
        message_type: 'text',
        metadata: { senderName: 'Agent' },
        conversation_thread_id: conversationThread?.id ?? null,
      });
    
    // Ajouter le message à la liste retournée
    messages.push(initialMessage);
  }
}
```

#### Mode texte - POST init (`POST /api/ask/[key]/init/route.ts`)

Lorsque l'utilisateur donne le focus au textarea dans le composant `ChatComponent` :

1. Le composant vérifie s'il y a des messages existants
2. **Si aucun message n'existe** :
   - Le frontend appelle l'endpoint `POST /api/ask/[key]/init`
   - Le backend vérifie à nouveau s'il y a des messages dans le thread
   - Si aucun message n'existe, l'agent conversation est appelé avec `executeAgent`
   - Les variables sont construites via `buildChatAgentVariables`
   - Un message initial de l'agent est généré et inséré dans la base de données
   - Le message est associé au thread de conversation approprié (`conversation_thread_id`)
   - Le message initial est retourné dans la réponse de l'API
   - Le frontend ajoute le message au state local

**Flux frontend** (`ChatComponent.tsx`) :
```typescript
<Textarea
  onFocus={() => {
    notifyTyping(true);
    onReplyBoxFocusChange?.(true);
    // Initiate conversation if no messages exist
    if (messages.length === 0) {
      onInitConversation?.();
    }
  }}
/>
```

**Flux backend** (`/api/ask/[key]/init/route.ts`) :
```typescript
// Vérifier s'il y a des messages
let hasMessages = false;
if (conversationThread) {
  const { messages: threadMessages } = await getMessagesForThread(
    supabase,
    conversationThread.id
  );
  hasMessages = (threadMessages ?? []).length > 0;
} else {
  // Vérifier les messages sans thread
  const { data: messagesWithoutThread } = await supabase
    .from('messages')
    .select('id')
    .eq('ask_session_id', askRow.id)
    .is('conversation_thread_id', null)
    .limit(1);
  hasMessages = (messagesWithoutThread ?? []).length > 0;
}

// Si aucun message n'existe, initier la conversation
if (!hasMessages) {
  // Build variables for agent with empty messages array for initialization
  const baseVariables = await buildChatAgentVariables(supabase, askRow.id, {
    // For initialization, provide empty messages array
    messages_json: JSON.stringify([]),
    participants: '', // No participants yet for initial message
  });
  
  const agentResult = await executeAgent({
    supabase,
    agentSlug: 'ask-conversation-response',
    askSessionId: askRow.id,
    interactionType: 'ask.chat.response',
    variables: baseVariables,
  });
  // Insérer le message initial...
}
```

#### Mode voix (`POST /api/ask/[key]/voice-agent/init/route.ts`)

Lors de l'initialisation de l'agent vocal :

1. Le système détermine le thread de conversation approprié
2. Vérifie s'il existe des messages dans le thread (ou sans thread pour compatibilité)
3. **Si aucun message n'existe** :
   - Les variables sont construites via `buildChatAgentVariables` avec `messages_json: JSON.stringify([])` et `participants: ''`
   - L'agent conversation est appelé avec `executeAgent`
   - Un message initial de l'agent est généré et inséré dans la base de données
   - Le message est associé au thread de conversation approprié
   - L'initialisation de l'agent vocal continue normalement

**Exemple de code** :
```typescript
// Vérifier s'il y a des messages
let hasMessages = false;
if (conversationThread) {
  const { messages: threadMessages } = await getMessagesForThread(
    supabase,
    conversationThread.id
  );
  hasMessages = (threadMessages ?? []).length > 0;
} else {
  // Vérifier les messages sans thread
  const { data: messagesWithoutThread } = await supabase
    .from('messages')
    .select('id')
    .eq('ask_session_id', askRow.id)
    .is('conversation_thread_id', null)
    .limit(1);
  hasMessages = (messagesWithoutThread ?? []).length > 0;
}

// Si aucun message n'existe, initier la conversation
if (!hasMessages) {
  // Build variables for agent with empty messages array for initialization
  const baseVariables = await buildChatAgentVariables(supabase, askRow.id, {
    // For initialization, provide empty messages array
    messages_json: JSON.stringify([]),
    participants: '', // No participants yet for initial message
  });
  
  const agentResult = await executeAgent({
    supabase,
    agentSlug: 'ask-conversation-response',
    askSessionId: askRow.id,
    interactionType: 'ask.chat.response',
    variables: baseVariables,
  });
  // Insérer le message initial...
}
```

### Prompt de l'agent pour l'initialisation

Le user prompt de l'agent `ask-conversation-response` a été mis à jour pour gérer le cas d'initialisation :

```
Si l'historique de conversation est vide (tableau JSON vide []), génère un message d'accueil qui :
1. Introduit brièvement le sujet de la session (basé sur la question ASK)
2. Invite les participants à partager leurs réflexions
3. Reste concis (2-3 phrases maximum)

Si l'historique contient des messages, fournis une réponse qui :
1. Reconnaît le contenu du dernier message utilisateur
2. Fait le lien avec les échanges précédents si pertinent
3. Pose une question ou fait une observation qui fait avancer la discussion
4. Reste concis (2-3 phrases maximum)

Réponds maintenant :
```

**Points clés** :
- Le prompt détecte automatiquement si `messages_json` est `[]` (initialisation) ou contient des messages
- Pour l'initialisation, l'agent génère un message d'accueil basé sur la question ASK
- Pour la conversation, l'agent répond en tenant compte de l'historique

### Caractéristiques importantes

- **Respect des threads** : Le message initial est créé dans le bon thread (partagé ou individuel)
- **Gestion d'erreurs** : Les erreurs d'initialisation ne font pas échouer la requête principale
- **Cohérence** : Même logique dans les trois modes (GET texte, POST init, POST voice-agent/init)
- **Parité de prompt** : Les trois modes utilisent `buildConversationAgentVariables` (`src/lib/ai/conversation-agent.ts`) pour générer les mêmes variables que le flux conversationnel standard (`messages_json`, `participants`, `system_prompt_*`)
- **Variables complètes** : `buildConversationAgentVariables` fournit `messages_json`, `participants` et délègue à `getAgentConfigForAsk` (via `executeAgent`) pour inclure tous les `system_prompt_*`
- **Variables d'initialisation** : 
  - `messages_json` est fourni comme tableau vide `[]`
  - `participants` est fourni comme chaîne vide `''`
  - Ces valeurs permettent à l'agent de détecter qu'il s'agit d'une initialisation
- **Prompt adaptatif** : Le user prompt de l'agent détecte le tableau vide et génère un message d'accueil approprié
- **Logs** : Des logs sont générés pour le débogage (`💬`, `✅`, `❌`, `⚠️`)

### Cas d'usage

Cette fonctionnalité est particulièrement utile pour :

- **Nouvelles sessions** : Les participants voient immédiatement un message d'accueil de l'agent
- **Expérience utilisateur** : Évite un écran vide et guide l'utilisateur vers la conversation
- **Cohérence** : Garantit qu'il y a toujours au moins un message dans la conversation

## Gestion du flag `voice` sur l'agent conversation

L'agent `ask-conversation-response` est partagé par trois environnements :

1. **Flux texte** (`/api/ask/[key]`, `/api/ask/[key]/respond`, `/api/ask/[key]/init`, `/api/ask/[key]/stream`)  
2. **Flux voix** (`/api/ask/[key]/voice-agent/init`, `/api/ask/[key]/voice-agent/log`)  
3. **Initialisation mixte** : génère d'abord un message texte, puis lance l'agent vocal

### Signification du flag `voice`

Le flag `ai_agents.voice = true` indique que **l'agent PEUT supporter le mode vocal** (il dispose d'une configuration voice-agent). Cependant :

- **Le mode d'exécution (texte ou voix) est déterminé par `interactionType`, PAS par le flag `voice`**
- Le flag `voice` est simplement une capacité, pas une obligation

### Comment ça fonctionne dans `executeAgent`

La fonction `executeAgent` (dans `src/lib/ai/service.ts`) décide d'utiliser le mode voix si et seulement si :

```typescript
const isVoiceAgent = options.interactionType?.includes('voice') ||
                    options.agentSlug?.includes('voice') ||
                    false;
```

**Règle** : Le mode voix est activé UNIQUEMENT si `interactionType` contient `'voice'`.

### Types d'interaction (`interactionType`)

| Endpoint | interactionType | Mode | Résultat |
|----------|----------------|------|----------|
| `/api/ask/[key]/init` | `'ask.chat.response'` | Texte | `AgentExecutionResult` avec `content: string` |
| `/api/ask/[key]/stream` | `'ask.chat.response'` | Texte | Stream texte |
| `/api/ask/[key]/respond` | `'ask.chat.response'` | Texte | `AgentExecutionResult` avec `content: string` |
| `/api/ask/[key]/voice-agent/init` (message initial) | `'ask.chat.response'` | Texte | `AgentExecutionResult` avec `content: string` |
| `/api/ask/[key]/voice-agent/init` (agent voix) | `'ask.chat.response.voice'` | Voix | `VoiceAgentExecutionResult` |
| `/api/ask/[key]/voice-agent/log` | `'ask.chat.response.voice'` | Voix | `VoiceAgentExecutionResult` |

### Configuration recommandée

✅ **Configuration correcte** :
- `ai_agents.voice = true` (l'agent supporte la voix)
- `ai_model_configs.voice_agent_provider = 'speechmatics-voice-agent'` (provider voix configuré)
- Les endpoints texte utilisent `interactionType: 'ask.chat.response'` → mode texte
- Les endpoints voix utilisent `interactionType: 'ask.chat.response.voice'` → mode voix

❌ **Ce qui NE fonctionne PAS** :
- Forcer `voice = false` pour "désactiver" la voix → ça cache la capacité et empêche l'utilisation en voix
- Utiliser `interactionType: 'ask.chat.response.voice'` depuis un endpoint texte → erreur car on attend du texte

### Résumé

- Le flag `voice = true` indique une **capacité**, pas un comportement forcé
- L'`interactionType` détermine le **mode d'exécution réel**
- Un même agent peut servir du texte ET de la voix selon le contexte d'appel

## Utilisation par mode

### 1. Mode texte (home) - `/api/ask/[key]/respond/route.ts`

**Fonction utilisée** : `executeAgent`

**Variables construites** :
```typescript
const promptVariables = buildPromptVariables({
  ask: askRow,
  project: projectData,
  challenge: challengeData,
  messages,
  participants: participantSummaries,
  insights: existingInsights,
  insightTypes,
});

const aiResult = await executeAgent({
  supabase,
  agentSlug: 'ask-conversation-response',
  askSessionId: askRow.id,
  interactionType: 'ask.chat.response',
  variables: promptVariables,
});
```

**Caractéristiques** :
- ✅ Utilise `executeAgent` directement
- ✅ Inclut toutes les variables `system_prompt_*`
- ✅ `executeAgent` utilise `getAgentConfigForAsk` en interne pour `ask-conversation-response`
- ✅ **Initialisation automatique** : Si aucun message n'existe, l'agent initie automatiquement la conversation lorsque l'utilisateur donne le focus au textarea (via `POST /api/ask/[key]/init`)

### 2. Mode streaming (texte) - `/api/ask/[key]/stream/route.ts`

**Fonction utilisée** : `getAgentConfigForAsk` + `callModelProviderStream`

**Variables construites** :
```typescript
const promptVariables = buildPromptVariables({
  ask: askRow,
  project: projectData,
  challenge: challengeData,
  messages,
  participants: participantSummaries,
});

const agentVariables: PromptVariables = {
  ask_key: askRow.ask_key,
  ask_question: promptVariables.ask_question || askRow.question,
  ask_description: promptVariables.ask_description || askRow.description || '',
  participants: promptVariables.participants || '',
  messages_json: JSON.stringify(conversationMessagesPayload),
  system_prompt_ask: promptVariables.system_prompt_ask || '',
  system_prompt_project: promptVariables.system_prompt_project || '',
  system_prompt_challenge: promptVariables.system_prompt_challenge || '',
};

const agentConfig = await getAgentConfigForAsk(dataClient, askRow.id, agentVariables);
```

**Caractéristiques** :
- ✅ Utilise `getAgentConfigForAsk` pour la résolution des prompts
- ✅ Inclut toutes les variables `system_prompt_*`
- ✅ Appelle `callModelProviderStream` directement pour le streaming
- ⚠️ En mode WSS, les prompts system et user peuvent être envoyés séparément pour des raisons de performance (c'est OK)

### 3. Mode vocal (init) - `/api/ask/[key]/voice-agent/init/route.ts`

**Fonction utilisée** : `executeAgent`

**Variables construites** :
```typescript
const baseVariables = await buildChatAgentVariables(supabase, askRow.id);

const promptVariables: PromptVariables = {
  ...baseVariables,
};

const result = await executeAgent({
  supabase,
  agentSlug: 'ask-conversation-response',
  askSessionId: askRow.id,
  interactionType: 'ask.chat.response.voice',
  variables: promptVariables,
});
```

**Caractéristiques** :
- ✅ Utilise `executeAgent` directement
- ✅ Utilise `buildChatAgentVariables` pour récupérer les variables de base
- ✅ Inclut toutes les variables `system_prompt_*` depuis la base de données
- ✅ `executeAgent` utilise `getAgentConfigForAsk` en interne
- ✅ **Initialisation automatique** : Si aucun message n'existe lors de l'initialisation, l'agent initie automatiquement la conversation avant de retourner la réponse

### 4. Mode vocal (log) - `/api/ask/[key]/voice-agent/log/route.ts`

**Fonction utilisée** : `getAgentConfigForAsk`

**Variables construites** :
```typescript
const promptVariables = buildPromptVariables({
  ask: askRow,
  project: projectData,
  challenge: challengeData,
  messages,
  participants: participantSummaries,
});

const agentVariables: PromptVariables = {
  ask_key: askRow.ask_key,
  ask_question: promptVariables.ask_question || askRow.question,
  ask_description: promptVariables.ask_description || askRow.description || '',
  participants: promptVariables.participants || '',
  messages_json: JSON.stringify(conversationMessagesPayload),
  system_prompt_ask: promptVariables.system_prompt_ask || '',
  system_prompt_project: promptVariables.system_prompt_project || '',
  system_prompt_challenge: promptVariables.system_prompt_challenge || '',
};

const agentConfig = await getAgentConfigForAsk(supabase, askRow.id, agentVariables);
```

**Caractéristiques** :
- ✅ Utilise `getAgentConfigForAsk` pour la résolution des prompts
- ✅ Inclut toutes les variables `system_prompt_*`
- ⚠️ Utilisé pour le logging, pas pour l'exécution directe

### 5. Transcription Speechmatics - Traitement des messages vocaux

**Fichier principal** : `src/lib/ai/speechmatics-transcription.ts`

**Classe** : `TranscriptionManager`

#### Vue d'ensemble

Le système de transcription Speechmatics traite les chunks de transcription partiels et finaux avant de les envoyer à l'agent de conversation. Il implémente plusieurs mécanismes pour garantir la qualité et la complétude des messages :

#### Fonctionnalités principales

##### 1. Buffer d'énoncés avec déduplication

**Problème résolu** : Speechmatics renvoie parfois plusieurs versions du même chunk (auto-corrections du modèle).

**Solution** :
- Buffer intelligent qui accumule les chunks partiels
- Détection de similarité (>90%) pour ignorer les duplications
- Fusion intelligente des segments qui se chevauchent
- Nettoyage automatique des répétitions internes (ex: "manifestement manifestement" → "manifestement")

**Configuration** :
```typescript
private readonly UTTERANCE_FINALIZATION_DELAY = 800; // Attendre 0.8s sans nouveau chunk avant finaliser
```

##### 2. Filtrage des fragments

**Problème résolu** : Les micro-chunks (ex: "transcrire", "Et Nous") étaient traités comme des messages complets.

**Solution** :
- Validation de longueur minimale : ≥20 caractères
- Validation de mots minimaux : ≥3 mots
- Détection de fins de phrases incomplètes (ex: se termine par "et", "de", "que")
- Attente automatique si le message est trop court (sauf en cas de timeout de sécurité)

**Configuration** :
```typescript
private readonly MIN_UTTERANCE_CHAR_LENGTH = 20;
private readonly MIN_UTTERANCE_WORDS = 3;
private readonly FRAGMENT_ENDINGS = new Set(['et','de','des','du','si','que',...]);
```

##### 3. Prévisualisation stable

**Problème résolu** : L'interface affichait chaque chunk individuellement, créant une cascade de messages.

**Solution** :
- Un seul message prévisualisé (`isInterim: true`) qui se met à jour progressivement
- Le contenu est nettoyé et dédupliqué avant affichage
- Mise à jour uniquement si le contenu change réellement
- Remplacement automatique par le message final quand disponible

##### 4. Gestion des chunks orphelins

**Problème résolu** : Des chunks arrivent après le message principal avec juste un mot répété ou de la ponctuation.

**Solution** :
- Détection des mots répétés : si le nouveau message contient 1-2 mots déjà présents à la fin du message précédent → ignoré
- Détection de ponctuation répétée : si le nouveau message n'est que de la ponctuation déjà présente en fin de message précédent → ignoré

**Méthodes** :
- `isOrphanWordRepeat()` : Détecte les mots répétés
- `isOrphanPunctuation()` : Détecte la ponctuation répétée

##### 5. Timeout de sécurité

**Problème résolu** : Si Speechmatics ne renvoie plus de chunks, le message reste bloqué.

**Solution** :
- Timeout de sécurité de 5 secondes si aucun nouveau chunk n'arrive
- Flag `force` pour forcer le traitement (utilisé lors de `EndOfStream`)
- Validation finale avant traitement même en mode `force`

**Configuration** :
```typescript
private readonly SILENCE_DETECTION_TIMEOUT = 5000; // Timeout de sécurité (5s)
```

#### Flux de traitement

1. **Réception d'un chunk partiel** (`handlePartialTranscript`)
   - Vérification de déduplication (similarité >90%)
   - Mise à jour du buffer `pendingFinalTranscript`
   - Génération d'un preview nettoyé pour l'UI
   - Réinitialisation du timer de finalisation (0.8s)

2. **Réception d'un chunk final** (`handleFinalTranscript`)
   - Fusion intelligente avec le buffer existant
   - Gestion de la ponctuation isolée
   - Réinitialisation du timer

3. **Finalisation de l'énoncé** (`processPendingTranscript`)
   - Déclenché après 0.8s sans nouveau chunk OU timeout de sécurité (5s)
   - Validation : longueur minimale, mots minimaux, fin de phrase complète
   - Nettoyage : suppression des répétitions, normalisation de la ponctuation
   - Vérification des chunks orphelins (mots/ponctuation répétés)
   - Envoi à l'agent de conversation via `processUserMessage()`

#### Nettoyage des transcriptions

La méthode `cleanTranscript()` applique plusieurs transformations :

1. **Suppression des répétitions de mots** : `/(\b[\w']+\b)(\s+\1\b)+/gi`
2. **Suppression des répétitions de phrases** : Détection de séquences répétées
3. **Normalisation des espaces** : Suppression des espaces multiples
4. **Normalisation de la ponctuation** : Espacement cohérent autour de la ponctuation

#### Exemples de traitement

**Exemple 1 : Déduplication**
```
Chunks reçus :
- "L'idée c'est que"
- "L'idée c'est que le système"
- "L'idée c'est que le système marche"

Résultat final : "L'idée c'est que le système marche"
```

**Exemple 2 : Filtrage de fragment**
```
Chunk reçu : "transcrire"
Action : Attente (trop court, < 20 caractères)
```

**Exemple 3 : Chunk orphelin**
```
Message précédent : "OK, je suis reparti de mon côté."
Chunk orphelin : "côté"
Action : Ignoré (mot répété du message précédent)
```

**Exemple 4 : Ponctuation répétée**
```
Message précédent : "OK, je suis reparti de mon côté."
Chunk orphelin : "."
Action : Ignoré (ponctuation déjà présente)
```

#### Références techniques

- `src/lib/ai/speechmatics-transcription.ts` : Classe `TranscriptionManager`
- `src/lib/ai/speechmatics.ts` : Intégration avec l'agent vocal
- `src/lib/ai/speechmatics-websocket.ts` : Réception des chunks depuis Speechmatics

### 6. Mode test (admin) - `/api/admin/ai/agents/[id]/test/route.ts`

**Fonction utilisée** : `executeAgent` (pour ask-conversation-response) ou `renderTemplate` (pour les autres agents)

**Variables construites** :
```typescript
if (agent.slug === 'ask-conversation-response') {
  const baseVariables = await buildChatAgentVariables(supabase, body.askSessionId);
  
  const testVariables: PromptVariables = {
    ...baseVariables,
    message_history: 'Message 1: Test message\nMessage 2: Another test message',
    latest_user_message: 'Test user message',
    // ... autres variables de test
  };

  const result = await executeAgent({
    supabase,
    agentSlug: agent.slug,
    askSessionId: body.askSessionId,
    interactionType: 'ask.chat.response.test',
    variables: testVariables,
  });
}
```

**Caractéristiques** :
- ✅ Utilise `executeAgent` pour `ask-conversation-response`
- ✅ Utilise `buildChatAgentVariables` pour la cohérence
- ✅ Inclut toutes les variables `system_prompt_*`
- ✅ Fallback vers `renderTemplate` pour les autres agents ou en cas d'erreur

## Variables disponibles

### Variables de base (toujours présentes)

| Variable | Source | Description |
|----------|--------|-------------|
| `ask_key` | `ask_sessions.ask_key` | Clé unique de la session ASK |
| `ask_question` | `ask_sessions.question` | Question de la session ASK |
| `ask_description` | `ask_sessions.description` | Description de la session ASK |
| `system_prompt_ask` | `ask_sessions.system_prompt` | System prompt de la session ASK |
| `system_prompt_project` | `projects.system_prompt` | System prompt du projet (si `project_id` est défini) |
| `system_prompt_challenge` | `challenges.system_prompt` | System prompt du challenge (si `challenge_id` est défini) |

### Variables contextuelles (selon le mode)

| Variable | Mode | Description |
|----------|------|-------------|
| `message_history` | Texte | Historique formaté des messages |
| `messages_json` | Streaming, Vocal | Messages formatés en JSON |
| `latest_user_message` | Texte | Dernier message utilisateur |
| `latest_ai_response` | Texte | Dernière réponse AI |
| `participant_name` | Texte | Nom du participant |
| `participants` | Tous | Liste des participants formatée |
| `existing_insights_json` | Texte | Insights existants en JSON |

## Exemples de prompts fusionnés

### Exemple 1 : Session ASK simple

**Configuration** :
- ASK : `{ question: "Quelle est votre vision?", system_prompt: null }`
- Projet : `{ system_prompt: "Vous travaillez sur un projet innovant." }`
- Challenge : `{ system_prompt: null }`

**System prompt de l'agent** (par défaut) :
```
Tu es un assistant IA spécialisé dans la facilitation de conversations.

Contexte :
- Question ASK : {{ask_question}}
- Description : {{ask_description}}

System prompt projet : {{system_prompt_project}}
System prompt challenge : {{system_prompt_challenge}}
```

**Résultat fusionné** :
```
Tu es un assistant IA spécialisé dans la facilitation de conversations.

Contexte :
- Question ASK : Quelle est votre vision?
- Description : 

System prompt projet : Vous travaillez sur un projet innovant.
System prompt challenge : 
```

### Exemple 2 : Session ASK avec system_prompt personnalisé

**Configuration** :
- ASK : `{ question: "Quelle est votre vision?", system_prompt: "Soyez créatif et innovant." }`
- Projet : `{ system_prompt: "Vous travaillez sur un projet innovant." }`
- Challenge : `{ system_prompt: null }`
- Agent `ask-conversation-response` a un `system_prompt` qui inclut `{{system_prompt_ask}}`, `{{system_prompt_project}}`, etc.

**Résultat** : Le prompt de l'agent est utilisé, et les variables sont substituées.

**System prompt de l'agent** (avant substitution) :
```
Tu es un assistant IA spécialisé dans la facilitation de conversations.

{{system_prompt_ask}}

Contexte :
- Question ASK : {{ask_question}}
- Description : {{ask_description}}

System prompt projet : {{system_prompt_project}}
System prompt challenge : {{system_prompt_challenge}}
```

**System prompt final** (après substitution) :
```
Tu es un assistant IA spécialisé dans la facilitation de conversations.

Soyez créatif et innovant.

Contexte :
- Question ASK : Quelle est votre vision?
- Description : 

System prompt projet : Vous travaillez sur un projet innovant.
System prompt challenge : 
```

## Garanties de cohérence

### 1. Même classe/fonction utilisée

Tous les modes utilisent `executeAgent` ou `getAgentConfigForAsk` qui utilisent la même logique interne :
- `executeAgent` utilise `getAgentConfigForAsk` pour `ask-conversation-response`
- `getAgentConfigForAsk` utilise `renderTemplate` pour la fusion des variables

### 2. Même construction de variables

- Tous les modes récupèrent `system_prompt_*` depuis la base de données
- Tous les modes utilisent `buildChatAgentVariables` ou `buildPromptVariables` qui incluent les `system_prompt_*`

### 3. Même fusion des variables

- Tous les modes utilisent `renderTemplate` pour la substitution
- Le pattern `{{variable_name}}` est utilisé partout
- Les variables `system_prompt_*` sont toujours substituées de la même manière

### 4. Utilisation cohérente de l'agent

- L'agent est **toujours** utilisé (agent configuré dans `ai_config` ou agent par défaut `ask-conversation-response`)
- Les `system_prompt` de l'ASK, projet et challenge sont fournis comme **variables**, pas comme remplacements
- La substitution des variables est gérée par `renderTemplate` de manière uniforme
- Cette fonction est utilisée par `executeAgent` pour `ask-conversation-response`
- Le mode streaming utilise directement `getAgentConfigForAsk`

## Points d'attention

### Mode WSS (WebSocket)

En mode WebSocket (streaming), les prompts system et user peuvent être envoyés séparément pour des raisons de performance. C'est acceptable et n'affecte pas la cohérence de la fusion des variables.

### Variables optionnelles

Les variables `system_prompt_*` peuvent être vides si :
- La session ASK n'a pas de `system_prompt` défini
- Le projet n'a pas de `system_prompt` défini
- Le challenge n'a pas de `system_prompt` défini

Dans ce cas, les variables sont remplacées par des chaînes vides (`''`), ce qui est le comportement attendu.

### Gestion des erreurs

Si une variable n'est pas trouvée dans la base de données :
- `buildChatAgentVariables` lance une erreur si la session ASK n'existe pas
- Les erreurs de récupération de projet/challenge sont loggées mais n'empêchent pas l'exécution
- Les variables manquantes sont remplacées par des chaînes vides

## Maintenance

### Ajouter une nouvelle variable

1. Ajouter la variable à l'interface `PromptVariables` dans `src/lib/ai/agent-config.ts`
2. Ajouter la récupération dans `buildChatAgentVariables` si elle vient de la base de données
3. S'assurer que tous les modes incluent cette variable dans leurs appels
4. Mettre à jour cette documentation

### Modifier la sélection de l'agent

Modifier la fonction `getAgentConfigForAsk` dans `src/lib/ai/agent-config.ts`. L'ordre actuel est :
1. Agent configuré dans `ai_config` (si présent)
2. Agent par défaut `ask-conversation-response`

**Note** : Les `system_prompt` de l'ASK, projet et challenge ne sont **pas** utilisés pour sélectionner l'agent. Ils sont fournis comme variables (`system_prompt_ask`, `system_prompt_project`, `system_prompt_challenge`) qui sont substituées dans les prompts de l'agent via `{{system_prompt_ask}}`, etc.

### Tester la cohérence

Pour vérifier que les prompts fusionnés sont identiques dans tous les modes :
1. Utiliser le mode test admin avec une session ASK
2. Comparer les prompts fusionnés avec ceux du mode texte
3. Vérifier que les variables `system_prompt_*` sont bien substituées

## Système de threads de conversation

### Vue d'ensemble

Le système de threads de conversation permet d'isoler les conversations entre utilisateurs dans une même session ASK. Chaque message et insight est associé à un thread (`conversation_thread_id`).

### Types de threads

#### 1. Thread partagé (Shared Thread)

**Configuration** : `audience_scope = 'group'` ET `response_mode = 'collective'`

**Caractéristiques** :
- `is_shared = true`
- `user_id = NULL`
- Tous les participants voient les mêmes messages et insights
- Un seul thread par session ASK

**Utilisation** : Mode collaboratif où tous les participants partagent la même conversation

#### 2. Thread individuel (Individual Thread)

**Configuration** : `audience_scope = 'individual'` OU `response_mode = 'simultaneous'`

**Caractéristiques** :
- `is_shared = false`
- `user_id = ID du profil utilisateur`
- Chaque utilisateur a son propre thread isolé
- Les messages et insights sont séparés par utilisateur

**Utilisation** : Mode individuel où chaque participant a sa propre conversation privée avec l'agent

### Détermination du thread

La fonction `getOrCreateConversationThread` dans `src/lib/asks.ts` détermine quel thread utiliser :

1. **Vérifie la configuration** : Utilise `shouldUseSharedThread(askConfig)` pour déterminer le mode
2. **Recherche un thread existant** :
   - Mode partagé : cherche un thread avec `user_id = NULL` et `is_shared = true`
   - Mode individuel : cherche un thread avec `user_id = userId` et `is_shared = false`
3. **Crée un nouveau thread** si aucun n'existe

### Filtrage des messages par thread

#### Mode texte (respond) - `/api/ask/[key]/respond/route.ts`

```typescript
if (conversationThread) {
  const { messages: threadMessages, error: threadMessagesError } = await getMessagesForThread(
    supabase,
    conversationThread.id
  );
  messageRows = threadMessages as MessageRow[];
} else {
  // Fallback: get all messages for backward compatibility
  const { data, error: messageError } = await supabase
    .from('messages')
    .select('*')
    .eq('ask_session_id', askRow.id)
    .order('created_at', { ascending: true });
  messageRows = (data ?? []) as MessageRow[];
}
```

**Comportement** :
- Si un thread existe : récupère les messages de ce thread ET les messages sans thread (pour compatibilité arrière)
- Si aucun thread : récupère tous les messages (compatibilité arrière)

#### Mode streaming - `/api/ask/[key]/stream/route.ts`

```typescript
if (conversationThread) {
  const { messages: threadMessages, error: threadMessagesError } = await getMessagesForThread(
    dataClient,
    conversationThread.id
  );
  
  // Also get messages without conversation_thread_id for backward compatibility
  // This ensures messages created before thread creation are still visible
  const { data: messagesWithoutThread, error: messagesWithoutThreadError } = await dataClient
    .from('messages')
    .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id')
    .eq('ask_session_id', askRow.id)
    .is('conversation_thread_id', null)
    .order('created_at', { ascending: true });
  
  // Combine thread messages with messages without thread
  const threadMessagesList = (threadMessages ?? []) as any[];
  const messagesWithoutThreadList = (messagesWithoutThread ?? []) as any[];
  messageRows = [...threadMessagesList, ...messagesWithoutThreadList].sort((a, b) => {
    const timeA = new Date(a.created_at ?? new Date().toISOString()).getTime();
    const timeB = new Date(b.created_at ?? new Date().toISOString()).getTime();
    return timeA - timeB;
  });
} else {
  // Fallback: get all messages for backward compatibility
  const { data, error: messageError } = await dataClient
    .from('messages')
    .select('*')
    .eq('ask_session_id', askRow.id)
    .order('created_at', { ascending: true });
  messageRows = data ?? [];
}
```

**Comportement** : Identique au mode texte - récupère les messages du thread ET les messages sans thread pour la compatibilité arrière

### Association des messages au thread

Lors de la création d'un message, le `conversation_thread_id` est associé :

```typescript
const { data: insertedRows, error: insertError } = await supabase
  .from('messages')
  .insert({
    ask_session_id: askRow.id,
    content: latestAiResponse,
    sender_type: 'ai',
    message_type: 'text',
    metadata: aiMetadata,
    parent_message_id: parentMessageId,
    conversation_thread_id: conversationThread?.id ?? null, // ← Association au thread
  });
```

**Important** : Si `conversationThread` est `null`, le message est créé sans thread (pour compatibilité arrière).

### Flux de données avec threads

#### Flux normal (sans problème)

1. **Frontend envoie un message** → `/api/ask/[key]/stream`
2. **Backend détermine le thread** → `getOrCreateConversationThread(profileId, askConfig)`
3. **Backend crée le message** → `conversation_thread_id: conversationThread?.id`
4. **Backend envoie le message via stream** → Type 'message' avec le message complet
5. **Frontend ajoute au state** → Message visible immédiatement
6. **Backend envoie 'done'** → Fin du stream
7. **Frontend recharge les messages** → `/api/ask/[key]` (optionnel, pour synchroniser)

#### Flux problématique (message disparaît)

1. **Frontend envoie un message** → `/api/ask/[key]/stream`
2. **Backend détermine le thread A** → `getOrCreateConversationThread(profileId1, askConfig)` → Thread A
3. **Backend crée le message** → `conversation_thread_id: Thread A`
4. **Backend envoie le message via stream** → Type 'message' avec le message complet
5. **Frontend ajoute au state** → Message visible immédiatement
6. **Backend envoie 'done'** → Fin du stream
7. **Frontend recharge les messages** → `/api/ask/[key]`
8. **Backend détermine le thread B** → `getOrCreateConversationThread(profileId2, askConfig)` → Thread B (différent !)
9. **Backend filtre les messages** → Seulement les messages du Thread B
10. **Le message créé avec Thread A n'est pas dans la liste** → Message disparaît du state

**Pourquoi le thread peut être différent ?**
- `profileId` différent entre les deux requêtes (mode dev, session expirée, etc.)
- Logique de détermination du thread différente
- Thread créé entre les deux requêtes

### Problèmes connus et corrections

### Message qui disparaît après la détection des insights (problème de thread)

**Symptôme** : Le message de l'agent disparaît quelques secondes après la fin du streaming et la détection des insights.

**Cause racine identifiée** :

Le problème vient d'une **incohérence de thread entre la création du message et le rechargement** :

1. **Lors du streaming** (`/api/ask/[key]/stream/route.ts`) :
   - Le thread est déterminé au début de la requête (ligne 365-370)
   - Le message est créé avec `conversation_thread_id: conversationThread?.id ?? null` (ligne 742)
   - Le message est envoyé au frontend via le stream

2. **Dans le frontend** (`HomePage.tsx`) :
   - Le message est ajouté au state local (ligne 1620-1627)
   - Quand le type 'done' arrive, le code recharge TOUS les messages depuis `/api/ask/[key]` (ligne 1640-1644)
   - **Le state local est remplacé par les messages rechargés**

3. **Lors du rechargement** (`/api/ask/[key]/route.ts`) :
   - Le thread est déterminé à nouveau (ligne 361-366)
   - Les messages sont filtrés par thread (ligne 384-416)
   - **Si le thread déterminé ici est différent du thread utilisé lors de la création, le message ne sera pas dans la liste !**

**Causes possibles de l'incohérence** :

1. **`profileId` différent** :
   - Le `profileId` peut être différent entre le stream et le GET
   - En mode dev, le `profileId` peut ne pas être disponible de manière cohérente
   - Le thread est déterminé avec un `profileId` différent, donc un thread différent

2. **Thread non déterminé correctement** : 
   - En mode dev, le `userId` peut ne pas être disponible
   - Le thread peut être `null` lors de la création mais déterminé lors du rechargement
   - Les messages créés sans thread ne sont pas visibles si un thread est utilisé lors du rechargement

3. **Mode dev - Hot reload** :
   - Next.js peut recharger les composants
   - Le state peut être réinitialisé
   - Les messages peuvent être rechargés avec un thread différent

4. **Détermination du thread à deux endroits différents** :
   - Le thread est déterminé dans `/api/ask/[key]/stream/route.ts` pour créer le message
   - Le thread est déterminé à nouveau dans `/api/ask/[key]/route.ts` pour recharger les messages
   - Si la logique de détermination est différente, les threads peuvent être différents

**Solutions** :

1. **Solution immédiate : Ne pas recharger les messages si le message est déjà dans le state** :
   ```typescript
   // Dans HomePage.tsx, ligne 1637-1644
   } else if (parsed.type === 'done') {
     setAwaitingAiResponse(false);
     // NE PAS recharger si le message final est déjà dans le state
     // Le message a déjà été ajouté via le type 'message' (ligne 1617-1627)
     // Le rechargement peut utiliser un thread différent et faire disparaître le message
     // if (sessionData.inviteToken) {
     //   await loadSessionDataByToken(sessionData.inviteToken);
     // } else if (sessionData.askKey) {
     //   await loadSessionData(sessionData.askKey);
     // }
     if (insightsUpdatedDuringStream) {
       cancelInsightDetectionTimer();
       setIsDetectingInsights(false);
     }
     return insightsUpdatedDuringStream;
   }
   ```

2. **Solution à long terme : Garantir la cohérence du thread** :
   - Utiliser la même logique de détermination du thread dans `/stream` et `/route`
   - S'assurer que le `profileId` est le même dans les deux endpoints
   - Ajouter un paramètre `conversationThreadId` dans l'URL pour forcer l'utilisation du même thread

3. **Vérifier la cohérence du thread** :
   ```typescript
   // S'assurer que le même thread est utilisé pour :
   // - La création du message
   // - Le rechargement des messages
   // - La détection des insights
   console.log('Thread utilisé:', conversationThread?.id);
   console.log('Thread du message créé:', inserted.conversation_thread_id);
   console.log('ProfileId utilisé:', profileId);
   ```

4. **Vérifier le mode de l'ASK** :
   ```typescript
   // Vérifier la configuration de l'ASK
   const askConfig = {
     audience_scope: askRow.audience_scope,
     response_mode: askRow.response_mode,
   };
   const useShared = shouldUseSharedThread(askConfig);
   ```

5. **S'assurer que le thread est déterminé avant la création du message** :
   ```typescript
   // Déterminer le thread AVANT de créer le message
   const { thread: conversationThread, error: threadError } = await getOrCreateConversationThread(
     supabase,
     askRow.id,
     threadUserId,
     askConfig
   );
   
   // Utiliser le même thread pour tous les appels suivants
   ```

6. **Logs de débogage** :
   ```typescript
   console.log('🔍 Thread debug (STREAM):', {
     threadId: conversationThread?.id,
     threadUserId: conversationThread?.user_id,
     isShared: conversationThread?.is_shared,
     profileId: profileId,
     messageThreadId: inserted.conversation_thread_id,
     match: conversationThread?.id === inserted.conversation_thread_id,
   });
   
   console.log('🔍 Thread debug (GET):', {
     threadId: conversationThread?.id,
     threadUserId: conversationThread?.user_id,
     isShared: conversationThread?.is_shared,
     profileId: profileId,
   });
   ```

**Fichiers à vérifier** :
- `src/lib/asks.ts` : Fonctions `getOrCreateConversationThread`, `getMessagesForThread`
- `src/app/api/ask/[key]/respond/route.ts` : Détermination du thread et création des messages
- `src/app/api/ask/[key]/stream/route.ts` : Détermination du thread et streaming
- `src/app/api/ask/[key]/route.ts` : Récupération des messages par thread
- `src/app/HomePage.tsx` : Gestion du state des messages et filtrage par thread

**Corrections à apporter** :

1. **Solution immédiate : Éviter le rechargement inutile** :
   - Le message est déjà dans le state local après le type 'message'
   - Ne pas recharger tous les messages après le type 'done'
   - Le rechargement peut utiliser un thread différent et faire disparaître le message
   - **Fichier** : `src/app/HomePage.tsx` ligne 1637-1644

2. **Solution à long terme : Garantir la cohérence du thread** :
   - Utiliser la même logique de détermination du thread dans `/stream` et `/route`
   - S'assurer que le `profileId` est le même dans les deux endpoints
   - Ajouter des logs pour comparer les threads entre les deux endpoints
   - **Fichiers** : 
     - `src/app/api/ask/[key]/stream/route.ts` ligne 365-370
     - `src/app/api/ask/[key]/route.ts` ligne 361-366

3. **Cohérence du thread** : S'assurer que le même thread est utilisé pour :
   - La création du message
   - Le rechargement des messages (si nécessaire)
   - La détection des insights
   - L'affichage côté frontend

4. **Gestion des messages sans thread** : 
   - En mode compatibilité arrière, les messages sans thread doivent être visibles
   - Vérifier que le filtrage ne supprime pas les messages sans thread si aucun thread n'est utilisé
   - **Fichier** : `src/app/api/ask/[key]/route.ts` ligne 396-416

5. **Détermination du thread** :
   - Déterminer le thread une seule fois au début de la requête
   - Réutiliser le même thread pour tous les appels suivants
   - Ne pas recalculer le thread entre la création du message et le rechargement

6. **Mode dev** :
   - Ajouter des logs pour tracer le thread utilisé dans chaque endpoint
   - Vérifier que le thread ne change pas entre les appels
   - Comparer le `profileId` utilisé dans `/stream` et `/route`
   - S'assurer que le state du frontend est mis à jour avec le bon thread

### Anciens messages non visibles

**Symptôme** : Les anciens messages (créés avant l'introduction des threads ou dans un autre thread) ne sont pas visibles.

**Causes possibles** :

1. **Messages dans un thread différent** :
   - Les anciens messages peuvent avoir été créés avec un `conversation_thread_id` différent
   - Si vous êtes en mode individuel, chaque utilisateur a son propre thread
   - Les messages d'un autre utilisateur ne sont pas visibles dans votre thread

2. **Messages sans thread dans un thread existant** :
   - Les messages créés avant l'introduction des threads ont `conversation_thread_id = NULL`
   - Ces messages sont maintenant récupérés dans `/api/ask/[key]/route.ts` (ligne 396-416)
   - **Correction appliquée** : Le mode streaming récupère aussi ces messages (ligne 394-414)

3. **Thread créé après les messages** :
   - Si un thread a été créé après la création des messages
   - Les messages sans thread devraient être visibles (correction appliquée)
   - Mais si les messages ont un thread différent, ils ne seront pas visibles

**Solutions** :

1. **Vérifier les messages dans la base de données** :
   ```sql
   -- Voir tous les messages d'une session ASK avec leur thread
   SELECT 
     id, 
     content, 
     sender_type,
     conversation_thread_id,
     created_at
   FROM messages
   WHERE ask_session_id = 'YOUR_ASK_SESSION_ID'
   ORDER BY created_at ASC;
   ```

2. **Vérifier les threads existants** :
   ```sql
   -- Voir tous les threads d'une session ASK
   SELECT 
     id,
     user_id,
     is_shared,
     created_at
   FROM conversation_threads
   WHERE ask_session_id = 'YOUR_ASK_SESSION_ID';
   ```

3. **Migration des anciens messages** :
   - Si les anciens messages doivent être associés à un thread spécifique
   - Créer une migration pour associer les messages sans thread au thread approprié
   - Ou laisser les messages sans thread visibles pour tous (comportement actuel)

4. **Mode partagé vs individuel** :
   - En mode partagé (`audience_scope = 'group'` ET `response_mode = 'collective'`) : tous les messages du thread partagé sont visibles
   - En mode individuel : seuls les messages de votre thread sont visibles
   - Les messages sans thread sont visibles dans les deux cas (correction appliquée)

**Corrections appliquées** :

1. **Mode streaming** (`/api/ask/[key]/stream/route.ts`) :
   - Récupère maintenant aussi les messages sans thread (ligne 394-414)
   - Cela garantit que les anciens messages créés avant l'introduction des threads sont visibles
   - Identique au comportement du mode GET (`/api/ask/[key]/route.ts`)

2. **Mode dev avec threads individuels** (`/api/ask/[key]/route.ts`) :
   - **Problème** : En mode dev, si l'ASK est configuré en mode individuel (`audience_scope = 'individual'` ou `response_mode = 'simultaneous'`) mais que `profileId` est `null` (pas d'utilisateur authentifié), le système bascule vers un thread partagé. Dans ce cas, les anciens messages créés dans des threads individuels ne seraient pas visibles.
   - **Solution** : En mode dev, si on détecte cette situation (mode individuel mais utilisation d'un thread partagé à cause de `profileId` null), on récupère **TOUS les messages de tous les threads** pour faciliter le debugging.
   ```typescript
   const isIndividualModeButUsingSharedThread = 
     !shouldUseSharedThread(askConfig) && 
     conversationThread?.is_shared === true &&
     isDevBypass;
   
   if (isIndividualModeButUsingSharedThread) {
     // Récupérer TOUS les messages de tous les threads pour le debugging
     const { data } = await dataClient
       .from('messages')
       .select('...')
       .eq('ask_session_id', askSessionId)
       .order('created_at', { ascending: true });
   }
   ```
   - **Note** : Cette logique est spécifique au mode dev (`isDevBypass === true`). En production, les utilisateurs authentifiés auront un `profileId` valide et verront uniquement les messages de leur thread individuel.

**Diagnostic** :

Pour vérifier pourquoi les anciens messages ne sont pas visibles :

1. **Vérifier le mode de l'ASK** :
   ```sql
   SELECT 
     id,
     ask_key,
     audience_scope,
     response_mode
   FROM ask_sessions
   WHERE ask_key = 'YOUR_ASK_KEY';
   ```

2. **Vérifier votre thread** :
   - En mode partagé : `user_id = NULL`, `is_shared = true`
   - En mode individuel : `user_id = VOTRE_PROFILE_ID`, `is_shared = false`
   - Vérifier quel thread est utilisé lors du chargement

3. **Vérifier où sont les messages** :
   ```sql
   -- Messages dans votre thread
   SELECT COUNT(*) 
   FROM messages m
   JOIN conversation_threads ct ON m.conversation_thread_id = ct.id
   WHERE m.ask_session_id = 'YOUR_ASK_SESSION_ID'
     AND ct.id = 'YOUR_THREAD_ID';
   
   -- Messages sans thread (devraient être visibles maintenant)
   SELECT COUNT(*) 
   FROM messages
   WHERE ask_session_id = 'YOUR_ASK_SESSION_ID'
     AND conversation_thread_id IS NULL;
   
   -- Messages dans d'autres threads (ne seront pas visibles en mode individuel)
   SELECT COUNT(*) 
   FROM messages m
   JOIN conversation_threads ct ON m.conversation_thread_id = ct.id
   WHERE m.ask_session_id = 'YOUR_ASK_SESSION_ID'
     AND ct.id != 'YOUR_THREAD_ID';
   ```

4. **Solution si les messages sont dans un autre thread** :
   - Si vous êtes en mode individuel et que les messages sont dans un autre thread, ils ne seront pas visibles
   - Options :
     - Passer en mode partagé pour voir tous les messages
     - Migrer les messages vers votre thread (nécessite une migration SQL)
     - Créer une fonction pour fusionner les threads

## Références

- `src/lib/ai/service.ts` : Fonction `executeAgent`
- `src/lib/ai/agent-config.ts` : Fonctions `getAgentConfigForAsk`, `buildChatAgentVariables`
- `src/lib/ai/templates.ts` : Fonction `renderTemplate`
- `src/app/api/ask/[key]/respond/route.ts` : Mode texte
- `src/app/api/ask/[key]/route.ts` : Mode texte GET
- `src/app/api/ask/[key]/init/route.ts` : Initialisation automatique de la conversation (mode texte)
- `src/app/api/ask/[key]/stream/route.ts` : Mode streaming
- `src/app/api/ask/[key]/voice-agent/init/route.ts` : Mode vocal init (avec initialisation automatique)
- `src/app/api/ask/[key]/voice-agent/log/route.ts` : Mode vocal log
- `src/app/api/admin/ai/agents/[id]/test/route.ts` : Mode test
- `src/components/chat/ChatComponent.tsx` : Composant chat avec gestion du focus du textarea
- `src/app/HomePage.tsx` : Page principale avec gestion de l'initialisation de la conversation



