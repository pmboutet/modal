# Vibe Coding Codex — Architecture & Pattern Playbook

Document the reusable building blocks that power the PremiumVoiceInterface and the rest of the Vibe Coding ecosystem. Use the blocks below as a running plan so any new agentic surface can remix the same primitives.

## Bloc 1 — Architecture & Patterns

- **Concept & principe** — Un seul pattern pour gérer le streaming texte/voix quel que soit le provider : le backend envoie `messageChunk`, `messageFinal`, `error`, `status`; le frontend maintient deux buffers (`interimUser`, `interimAssistant`) et ne persiste que les finals via `onMessage`. Timeline = source de vérité + bulle “en cours”.
- **Core Concepts** — Modèle de message standard (`role`, `content`, `timestamp`, `messageId`, `isInterim`) et distinction claire entre état UI (buffers, flags de streaming) et persistance (store React/Zustand, DB).
- **Streaming Patterns** — Décrire “Stable + Draft buffer” (pattern OpenAI), “Full diff” (deltas temps réel) et “Multi-turn latency hiding” (préparation de la réponse suivante).
- **Event Normalization** — Contrat unique `onMessage/onError/onConnection`; les adapters Deepgram/Speechmatics/OpenAI convertissent leurs payloads pour coller aux types Codex.
- **Provider Mapping** — Matrice des différences (ID, timestamps, enum des rôles) avec règles de normalisation (`'agent' → 'assistant'`, timestamps ISO, etc.).

## Bloc 2 — React Hooks & UI Library

- **Hooks** —  
  - `useStreamingBuffer({ mergeFn })` retourne `{ interimUser, interimAssistant, handleCodexMessage, resetBuffers }`. `handleCodexMessage` accepte des `CodexMessageEvent` et applique `mergeStreamingContent(prev, incoming)` pour n’avoir qu’un interim par rôle.  
  - `useAudioViz()` encapsule `audioLevel`, `startVisualization(constraints)` et `cleanup(closeContext?)`.  
  - `useVoiceAgentConnection({ providerConfig })` expose `connect`, `disconnect`, `toggleMute`, `isConnecting`, `isConnected`, `isMuted`.
- **UI Components** — `<VoiceChatLayout>`, `<StreamingBubble>` avec indicateur `…`, `<TranscriptPanel>`, `<MicController>`; chaque composant importe les hooks plutôt que de gérer sa logique.
- **Provider Adapters** — `mapDeepgramEventToStandard`, `mapSpeechmaticsEventToStandard`, `mapOpenAIEventToStandard` traduisent les événements bruts en `CodexMessageEvent`/`CodexErrorEvent`.
- **State Machines** — Diagrammes connect → stream → flush → idle (et mute/unmute) pour garder un comportement prévisible entre surfaces texte/voix.

## Bloc 3 — Contrat d'événements Codex

- **Types standards** —  
  ```ts
  type CodexRole = 'user' | 'assistant' | 'system' | 'agent';
  type CodexMessageEvent = {
    role: CodexRole;
    content: string;
    timestamp?: string;
    messageId?: string;
    isInterim?: boolean;
    meta?: Record<string, any>;
  };
  type CodexErrorEvent = {
    type: 'error';
    code?: string | number;
    message: string;
    provider?: string;
    raw?: unknown;
  };
  ```
  Tous les providers doivent sortir ce contrat pour simplifier les hooks.
- **Pattern UI standard** —  
  - `messages: CodexMessageEvent[]` = finals (source de vérité).  
  - Buffers streaming : `interimUser?`, `interimAssistant`.  
  - `mergeStreamingContent(prev, incoming)` encapsule la logique anti-doublons (`startsWith`, `includes`, trim).  
  - `displayMessages = sort(messages) + interim(s)` pour l’affichage (assistant à gauche, user à droite, bulle streaming en bas).
- **Gestion des erreurs & reconnection** — Liste des codes WS : 1000, 1005, 4005 (quota), 4006 (`timelimit_exceeded`).  
  - `4005` → message “Quota reached” + pas de retry auto.  
  - `4006` → “Session time limit reached” + CTA “Restart session”.  
  - Toujours nettoyer micro, fermer l’`AudioContext` sur déconnexion complète, et remonter un `CodexErrorEvent` au parent.

## Bloc 4 — Parent Orchestrator

- **Responsabilités parent** — stocker les messages (React state, Zustand, Redux), dédupliquer par `messageId`, enrichir avec `askKey`, `askSessionId`, etc.
- **Contrat minimal** —  
  ```ts
  const handleMessage = (msg: CodexMessageEvent) => {
    setMessages(prev => upsertByMessageId(prev, msg));
  };
  <PremiumVoiceInterface messages={messages} onMessage={handleMessage} />
  ```
  Les enfants (UI) ne mutent jamais directement le store partagé.

## Bloc 5 — Vibe Coding: Prompts & System Design

- **Prompt Templates** — “Senior consultant interview”, “Agent vocal empathique”, “Diagnostic tool” avec garde-fous sur le ton, le rythme et les relances.
- **Streaming Rules** — Pas de résumé entre deux tours, phrases courtes en streaming, ne jamais renvoyer tout l’historique; enforce via system prompt/tooling.
- **Handlebars & Variables** — Convention (`{{ask_question}}`, `{{messages_json}}`, etc.), ordre de merge du contexte, helpers pour gérer langue/locale.
- **LLM Session Design** — Comment combiner transcript STT + contexte business avant l’appel LLM, stratégies de budget (tokens, latence max) par provider.

## Bloc 6 — Playbook & Snippets

- **TypeScript Snippets** — Exemples : Speechmatics STT + Anthropic LLM + ElevenLabs TTS, chat texte utilisant le même hook de streaming, fallback queue.
- **Use Cases** — “Interview commercial” (Codex ASK), “Démo produit guidée”, “Agent de support vocal” avec checklists dédiées.
- **Checklists** — Pré-prod : précision STT FR, timeout silence, pas de persistance des interims. Debug : logging des chunks, détection de doublons, intégrité timeline.
- **Operational Notes** — Hooks de monitoring, format de log pour événements streaming, toggles pour mode debug provider.

## Bloc 7 — Guides UX “OpenAI-style”

- **Layout** — Timeline centrée, bulles 70–75% max width, assistant à gauche, user à droite; garder une bulle unique pour le streaming en bas.
- **Streaming** — Texte qui apparaît progressivement + `…` discret pendant les chunks; états affichés (“Listening”, “Thinking”, “Speaking”, “Muted”).
- **Accessibilité** — Boutons avec `aria-label`, contraste suffisant, respect de `prefers-reduced-motion` (fallback sans animations, pas de flashes).
