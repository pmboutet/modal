/**
 * PremiumVoiceInterface - Interface vocale premium avec support multi-providers
 * 
 * Ce composant fournit une interface vocale complète avec :
 * - Support de plusieurs providers (Deepgram, Hybrid, Speechmatics)
 * - Gestion streaming temps réel (buffers interim type OpenAI)
 * - Visualisation audio avec analyseur de fréquence
 * - Contrôles de microphone (sélection, sensibilité, isolation vocale)
 * - Gestion de la déduplication des messages
 * - Animations fluides avec Framer Motion
 * 
 * Architecture :
 * - Utilise deux buffers interim (user/assistant) pour afficher les messages en cours
 * - Fusionne ces buffers avec les messages finaux provenant des props
 * - Gère la déconnexion propre des ressources audio et WebSocket
 */

"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MicOff, Volume2, Pencil, Check, Settings, ChevronDown, UserX, ExternalLink, Copy, Users, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DeepgramVoiceAgent, DeepgramMessageEvent } from '@/lib/ai/deepgram';
import { HybridVoiceAgent, HybridVoiceAgentMessage } from '@/lib/ai/hybrid-voice-agent';
import { SpeechmaticsVoiceAgent, SpeechmaticsMessageEvent } from '@/lib/ai/speechmatics';
import { cn, isInAppBrowser, getMicrophonePermissionErrorMessage, devLog, devWarn, devError } from '@/lib/utils';
import { cleanAllSignalMarkers, detectStepComplete } from '@/lib/sanitize';
import { useAuth } from '@/components/auth/AuthProvider';
import type { ConversationPlan } from '@/types';
import { ConversationProgressBar } from '@/components/conversation/ConversationProgressBar';
import { StepCompletionCard } from '@/components/conversation/StepCompletionCard';
import type { SemanticTurnTelemetryEvent } from '@/lib/ai/turn-detection';
import { useInactivityMonitor } from '@/hooks/useInactivityMonitor';
import { useScrollHideShow } from '@/hooks/useScrollHideShow';
import { SpeakerAssignmentOverlay, type ParticipantOption, type SpeakerAssignmentDecision, type SpeakerMessage } from './SpeakerAssignmentOverlay';
import { SpeakerConfirmationOverlay } from './SpeakerConfirmationOverlay';
import { VoiceModeTutorial } from './VoiceModeTutorial';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

/**
 * Props du composant PremiumVoiceInterface
 * 
 * @property askKey - Clé unique de l'ask (question) pour identifier la session
 * @property askSessionId - ID optionnel de la session
 * @property systemPrompt - Prompt système pour l'agent vocal
 * @property userPrompt - Template de prompt utilisateur (optionnel, même format que le mode texte)
 * @property modelConfig - Configuration du modèle (provider, modèles STT/TTS, LLM, etc.)
 * @property onMessage - Callback appelé lorsqu'un message est reçu (user ou assistant)
 * @property onError - Callback appelé en cas d'erreur
 * @property onClose - Callback appelé lors de la fermeture de l'interface
 * @property onEdit - Callback optionnel appelé lors du clic sur le bouton d'édition
 * @property messages - Liste des messages finaux (source de vérité depuis les props)
 */
/**
 * Speaker-to-participant mapping for consultant mode
 * Tracks which speaker ID (S1, S2, etc.) is assigned to which participant
 */
export interface SpeakerMapping {
  speaker: string;
  participantId: string | null;
  participantName: string;
  shouldTranscribe: boolean;
}

interface PremiumVoiceInterfaceProps {
  askKey: string;
  askSessionId?: string;
  systemPrompt: string;
  userPrompt?: string; // User prompt template (same as text mode)
  modelConfig?: {
    provider?: "deepgram-voice-agent" | "hybrid-voice-agent" | "speechmatics-voice-agent";
    voiceAgentProvider?: "deepgram-voice-agent" | "speechmatics-voice-agent";
    deepgramSttModel?: string;
    deepgramTtsModel?: string;
    deepgramLlmProvider?: "anthropic" | "openai";
    deepgramLlmModel?: string;
    speechmaticsSttLanguage?: string;
    speechmaticsSttOperatingPoint?: "enhanced" | "standard";
    speechmaticsSttMaxDelay?: number;
    speechmaticsSttEnablePartials?: boolean;
    speechmaticsLlmProvider?: "anthropic" | "openai";
    speechmaticsLlmModel?: string;
    speechmaticsApiKeyEnvVar?: string;
    elevenLabsVoiceId?: string;
    elevenLabsModelId?: string;
    disableElevenLabsTTS?: boolean;
  };
  onMessage: (message: DeepgramMessageEvent | HybridVoiceAgentMessage | SpeechmaticsMessageEvent) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    messageId?: string; // Added to support stable keys throughout lifecycle
    metadata?: Record<string, unknown>; // Preserve metadata to access messageId
  }>;
  conversationPlan?: ConversationPlan | null;
  // Timer props for progress bar
  elapsedMinutes?: number;
  isTimerPaused?: boolean;
  isTimerLoading?: boolean;
  onTogglePause?: () => void;
  onResetTimer?: () => void;
  expectedDurationMinutes?: number | null;
  consultantMode?: boolean; // If true, AI listens but doesn't respond (no TTS, diarization enabled)
  // Consultant mode: participants for speaker assignment
  participants?: ParticipantOption[];
  // Callback when speaker mappings are updated (for persisting to parent)
  onSpeakerMappingChange?: (mappings: SpeakerMapping[]) => void;
  // Invite token for API calls (used for guest participant creation)
  inviteToken?: string | null;
  // Current user ID for message alignment (messages from this user align right)
  currentUserId?: string | null;
  // Callback when conversation plan updates (e.g., step completed in voice mode)
  onConversationPlanUpdate?: (plan: ConversationPlan) => void;
  // If true, session initialization is in progress - skip initial message generation
  // (the init endpoint will handle it)
  isInitializing?: boolean;
}

/**
 * Type représentant un message vocal dans l'interface
 *
 * @property role - Rôle de l'émetteur (user ou assistant)
 * @property content - Contenu textuel du message
 * @property timestamp - Horodatage ISO du message
 * @property messageId - ID unique du message (pour la déduplication et le suivi)
 * @property isInterim - Indique si le message est intermédiaire (en cours de transcription) ou final
 * @property speaker - Identifiant du locuteur (diarisation) ex: S1, S2, UU
 */
type VoiceMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  messageId?: string;
  isInterim?: boolean;
  speaker?: string; // Speaker identifier from diarization (consultant mode)
  metadata?: { completedStepId?: string; [key: string]: unknown }; // FIX: Support metadata for step completion
};

/**
 * Composant principal PremiumVoiceInterface
 * 
 * Gère toute la logique de l'interface vocale :
 * - Connexion aux agents vocaux (Deepgram, Hybrid, Speechmatics)
 * - Gestion des messages streaming (buffers interim) pour l'affichage en temps réel
 * - Visualisation audio avec analyseur de fréquence
 * - Contrôles de microphone et paramètres
 * - Nettoyage propre des ressources lors de la déconnexion
 */
export const PremiumVoiceInterface = React.memo(function PremiumVoiceInterface({
  askKey,
  askSessionId,
  systemPrompt,
  userPrompt,
  modelConfig,
  onMessage,
  onError,
  onClose,
  onEditMessage,
  messages = [],
  conversationPlan,
  elapsedMinutes = 0,
  isTimerPaused = false,
  isTimerLoading = false,
  onTogglePause,
  onResetTimer,
  expectedDurationMinutes,
  consultantMode = false,
  participants = [],
  onSpeakerMappingChange,
  inviteToken,
  currentUserId,
  onConversationPlanUpdate,
  isInitializing = false,
}: PremiumVoiceInterfaceProps) {
  // Récupération de l'utilisateur connecté pour l'affichage du profil
  const { user } = useAuth();

  // ===== ÉTATS DE CONNEXION ET MICROPHONE =====
  // État de connexion au service vocal (WebSocket établi)
  const [isConnected, setIsConnected] = useState(false);
  // In consultant mode, track the first speaker as the consultant
  const consultantSpeakerRef = useRef<string | null>(null);

  // ===== SPEAKER ASSIGNMENT STATES (CONSULTANT MODE) =====
  // Track speaker-to-participant mappings
  const [speakerMappings, setSpeakerMappings] = useState<SpeakerMapping[]>([]);
  // BUG-032 FIX: Use ref to avoid unnecessary callback recreations when speakerMappings changes
  const speakerMappingsRef = useRef<SpeakerMapping[]>([]);
  // Track which speakers we've seen (to detect new ones)
  const knownSpeakersRef = useRef<Set<string>>(new Set());
  // Queue of pending speakers for assignment (allows stacking multiple overlays)
  const [pendingSpeakers, setPendingSpeakers] = useState<string[]>([]);
  // Speaker confirmation state for individual mode (not consultant mode)
  const [speakerPendingConfirmation, setSpeakerPendingConfirmation] = useState<{
    speaker: string;
    transcript: string;
  } | null>(null);
  // Counter for speaker detection order (1st user, 2nd user, etc.)
  const speakerOrderRef = useRef<Map<string, number>>(new Map());
  // État d'activation du microphone (permission accordée et stream actif)
  const [isMicrophoneActive, setIsMicrophoneActive] = useState(false);
  // État de mute du microphone (microphone désactivé mais WebSocket toujours ouvert pour recevoir les réponses)
  const [isMuted, setIsMuted] = useState(false);
  // Message d'erreur à afficher à l'utilisateur
  const [error, setError] = useState<string | null>(null);
  // État de connexion en cours (pendant l'établissement de la connexion)
  const [isConnecting, setIsConnecting] = useState(false);
  // État indiquant si l'utilisateur est en train de parler (détecté via les messages user)
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Niveau audio actuel (0-1) pour la visualisation du waveform
  const [audioLevel, setAudioLevel] = useState(0);
  // Buffers locaux pour le streaming en cours (pattern OpenAI)
  const [interimUser, setInterimUser] = useState<VoiceMessage | null>(null);
  const [interimAssistant, setInterimAssistant] = useState<VoiceMessage | null>(null);
  // Pending final user message - shown until confirmed in props.messages to avoid "blanc" gap
  const [pendingFinalUser, setPendingFinalUser] = useState<VoiceMessage | null>(null);
  const [semanticTelemetry, setSemanticTelemetry] = useState<SemanticTurnTelemetryEvent | null>(null);
  const [showInactivityOverlay, setShowInactivityOverlay] = useState(false);
  // État de détection d'in-app browser (Gmail, Facebook, etc.)
  const [inAppBrowserInfo, setInAppBrowserInfo] = useState<{ isInApp: boolean; appName: string | null } | null>(null);

  // ===== ÉTATS D'ÉDITION DE MESSAGE =====
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  // Track if mic was muted before editing (to restore state after)
  const wasMutedBeforeEditRef = useRef(false);

  // ===== ÉTATS D'ÉDITION DE SPEAKER (CONSULTANT MODE) =====
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);

  const conversationSteps = conversationPlan?.plan_data.steps ?? [];
  const currentConversationStepId = conversationPlan?.current_step_id;
  const hasConversationSteps = conversationSteps.length > 0;

  // Check if all steps are completed (for showing completion celebration)
  const allStepsCompleted = conversationPlan && conversationPlan.plan_data.steps.length > 0
    ? conversationPlan.plan_data.steps.every(step => step.status === 'completed')
    : false;

  // Track when step summary generation is in progress
  const [isGeneratingStepSummary, setIsGeneratingStepSummary] = useState(false);

  // Track when agent is thinking (waiting for first streaming token)
  const [isAgentThinking, setIsAgentThinking] = useState(false);

  // ===== ÉTATS DES CONTRÔLES MICROPHONE =====
  // ID du microphone sélectionné (null = microphone par défaut)
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string | null>(null);
  // Sensibilité du microphone (1.5 = moins sensible, filtre les conversations de fond)
  const [microphoneSensitivity, setMicrophoneSensitivity] = useState<number>(1.5);
  // Activation de l'isolation vocale (filtre le bruit de fond)
  const [voiceIsolationEnabled, setVoiceIsolationEnabled] = useState<boolean>(true);
  // Mode texte uniquement (désactive TTS, l'agent répond en texte seulement)
  const [textOnlyMode, setTextOnlyMode] = useState<boolean>(false);
  // Liste des microphones disponibles sur le système
  const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
  // Affichage du panneau de paramètres du microphone
  const [showMicrophoneSettings, setShowMicrophoneSettings] = useState<boolean>(false);

  // ===== SPEAKER FILTERING NOTIFICATION =====
  // Notification quand une autre voix est détectée et filtrée
  const [filteredSpeakerNotification, setFilteredSpeakerNotification] = useState<{
    speaker: string;
    transcripts: string[]; // Stack of transcripts from this speaker
  } | null>(null);
  const filteredSpeakerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ===== TUTORIAL STATE =====
  // Show voice mode tutorial on first usage
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  // BUG-042: Track if close button was clicked (window.close() doesn't work for direct navigation)
  const [closeAttempted, setCloseAttempted] = useState(false);
  // Ref to track if tutorial is/was showing (to avoid race conditions with state)
  const tutorialActiveRef = useRef(false);
  // Ref to store pending initial message to speak after tutorial completes
  const pendingInitialMessageRef = useRef<string | null>(null);
  // Track speakers the user chose to ignore (don't ask again)
  const ignoredSpeakersRef = useRef<Set<string>>(new Set());

  // ===== RÉFÉRENCES POUR LA GESTION DES RESSOURCES =====
  // Référence à l'agent vocal actuel (peut être Deepgram, Hybrid ou Speechmatics)
  const agentRef = useRef<DeepgramVoiceAgent | HybridVoiceAgent | SpeechmaticsVoiceAgent | null>(null);
  // Timeout pour réinitialiser l'état "isSpeaking" après que l'utilisateur arrête de parler
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Contexte audio Web Audio API pour l'analyse du signal audio
  const audioContextRef = useRef<AudioContext | null>(null);
  // Nœud analyseur pour extraire les données de fréquence audio (waveform)
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Nœud source audio depuis le stream du microphone
  const microphoneNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // ID de la frame d'animation pour la visualisation audio (à annuler lors du cleanup)
  const animationFrameRef = useRef<number | null>(null);
  // Référence au stream média du microphone (pour le nettoyage propre)
  const streamRef = useRef<MediaStream | null>(null);
  // Flag pour empêcher les déconnexions multiples simultanées
  const isDisconnectingRef = useRef<boolean>(false);
  // Flag pour empêcher les connexions multiples simultanées
  const isConnectingRef = useRef<boolean>(false);
  // Flag pour empêcher les nettoyages audio multiples
  const isCleaningUpAudioRef = useRef<boolean>(false);
  // Référence au conteneur des messages (pour le scroll)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  // Référence à l'élément invisible en bas de la liste des messages (pour auto-scroll)
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // StrictMode detection: track if this is the first mount (skip it) or second mount (use it)
  const strictModeFirstMountRef = useRef(true);
  // Track steps being completed to prevent duplicate API calls
  const completingStepsRef = useRef<Set<string>>(new Set());

  // ===== INTERIM MESSAGE THROTTLING =====
  // PERF FIX: Throttle interim updates to 150ms to reduce re-renders (was ~50ms)
  // Store latest content in refs, only update state periodically
  const INTERIM_THROTTLE_MS = 150;
  const lastInterimUserUpdateRef = useRef<number>(0);
  const lastInterimAssistantUpdateRef = useRef<number>(0);
  const pendingInterimUserRef = useRef<VoiceMessage | null>(null);
  const pendingInterimAssistantRef = useRef<VoiceMessage | null>(null);
  const interimUserThrottleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const interimAssistantThrottleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ===== WAKE LOCK & VISIBILITY =====
  // Wake Lock to prevent screen from sleeping during voice sessions
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Track if mute was triggered by visibility change (vs manual)
  const wasMutedByVisibilityRef = useRef(false);

  // ===== AGENT RESPONSE NUDGE MECHANISM =====
  // Tracks when the last user message was sent (for detecting stuck agent)
  const lastUserMessageTimestampRef = useRef<number>(0);
  // Tracks the content of the last user message (for retry)
  const lastUserMessageContentRef = useRef<string>('');
  // Tracks whether we're currently waiting for an agent response
  const awaitingAgentResponseRef = useRef<boolean>(false);
  // Tracks whether we've already nudged for the current user message (prevent duplicate nudges)
  const hasNudgedForCurrentMessageRef = useRef<boolean>(false);
  // Tracks when the last user partial was received (to detect if user is still speaking)
  const lastUserPartialTimestampRef = useRef<number>(0);
  // Tracks when the first assistant streaming token was received (for intelligent nudge)
  const lastAssistantStreamTimestampRef = useRef<number>(0);
  // Timeout for agent response nudge - only triggers if NO streaming has started (5 seconds)
  const AGENT_RESPONSE_TIMEOUT_MS = 5000;
  // Time window to consider user as "still speaking" after last partial (3 seconds)
  const USER_SPEAKING_WINDOW_MS = 3000;

  // ===== INACTIVITY MONITOR =====
  const inactivityMonitor = useInactivityMonitor({
    timeout: 20000, // 20 seconds
    onInactive: useCallback(() => {
      // Don't show overlay if mic is already muted - user is intentionally not speaking
      if (isMutedRef.current) {
        devLog('[PremiumVoiceInterface] ⏰ User inactive but mic already muted - skipping overlay');
        return;
      }
      // Don't show overlay if ElevenLabs TTS audio is currently playing
      // The timer should be paused during playback, but this is a safety check
      if (agentRef.current instanceof SpeechmaticsVoiceAgent && agentRef.current.isAudioPlaying()) {
        devLog('[PremiumVoiceInterface] ⏰ User inactive but audio is playing - skipping overlay');
        return;
      }
      devLog('[PremiumVoiceInterface] ⏰ User inactive - showing overlay and muting');
      setShowInactivityOverlay(true);
      // Mute microphone when inactive
      if (agentRef.current) {
        setIsMuted(true);
        isMutedRef.current = true;
        // Only Speechmatics agent has setMicrophoneMuted
        if (agentRef.current instanceof SpeechmaticsVoiceAgent) {
          agentRef.current.setMicrophoneMuted(true);
        }
      }
    }, []),
    onActive: useCallback(() => {
      devLog('[PremiumVoiceInterface] ✅ User active again');
      setShowInactivityOverlay(false);
    }, []),
  });

  // ===== SCROLL HIDE/SHOW FOR MOBILE HEADER =====
  // Track last scroll position for delta calculation
  const lastScrollTopRef = useRef(0);

  // Hook for hiding/showing header on scroll
  const { isHidden: isHeaderHidden, handleScroll: handleScrollHideShow } = useScrollHideShow({
    showThreshold: 100, // Show after 100px scroll up
    minScrollDelta: 2,  // Ignore tiny changes
    topThreshold: 10,   // Always show at top
    transitionDuration: 200,
  });

  // Handle messages scroll for header hide/show
  const handleMessagesScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;

    const currentScrollTop = messagesContainerRef.current.scrollTop;
    const scrollDelta = currentScrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    handleScrollHideShow(currentScrollTop, scrollDelta);
  }, [handleScrollHideShow]);

  // ===== WAKE LOCK FUNCTIONS =====
  /**
   * Acquiert un Wake Lock pour empêcher l'écran de se mettre en veille
   * pendant une session vocale active.
   *
   * Support: Chrome Android, Safari iOS 16.4+, Chrome Desktop
   * Non supporté: Firefox
   */
  const acquireWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator && !wakeLockRef.current) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        devLog('[PremiumVoiceInterface] 🔆 Wake lock acquired');

        // Listener pour détecter la perte du wake lock (batterie faible, etc.)
        wakeLockRef.current.addEventListener('release', () => {
          devLog('[PremiumVoiceInterface] 🔆 Wake lock released by system');
          wakeLockRef.current = null;
        });
      } catch (err) {
        // Wake lock peut échouer si la page n'est pas visible ou batterie faible
        devWarn('[PremiumVoiceInterface] ⚠️ Wake lock failed:', err);
      }
    }
  }, []);

  /**
   * Libère le Wake Lock manuellement lors de la déconnexion
   */
  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        devLog('[PremiumVoiceInterface] 🔆 Wake lock released');
      } catch (err) {
        devWarn('[PremiumVoiceInterface] ⚠️ Wake lock release failed:', err);
      }
    }
  }, []);

  // ===== DÉTECTION DU TYPE D'AGENT =====
  // Détection si l'agent est de type Hybrid (Deepgram STT + LLM + ElevenLabs TTS)
  const isHybridAgent = modelConfig?.provider === "hybrid-voice-agent";
  // Détermination du provider vocal effectif (priorité à voiceAgentProvider, sinon provider)
  // Avertit si le provider n'est pas un agent vocal valide
  const voiceAgentProvider = modelConfig?.voiceAgentProvider || modelConfig?.provider;
  // Détection si l'agent est Speechmatics (Speechmatics STT + LLM + ElevenLabs TTS)
  const isSpeechmaticsAgent = voiceAgentProvider === "speechmatics-voice-agent";
  
  // ===== VALIDATION DE LA CONFIGURATION =====
  // Liste des agents vocaux valides
  const validVoiceAgents = ["deepgram-voice-agent", "hybrid-voice-agent", "speechmatics-voice-agent"];
  // Avertissement si on utilise un provider non-vocal comme fallback (probable erreur de config)
  if (!modelConfig?.voiceAgentProvider && modelConfig?.provider && 
      !validVoiceAgents.includes(modelConfig.provider)) {
    devWarn('[PremiumVoiceInterface] ⚠️ Using non-voice-agent provider as fallback:', {
      provider: modelConfig.provider,
      voiceAgentProvider: modelConfig.voiceAgentProvider,
      message: 'This is likely a configuration error. voice_agent_provider should be set in the database.',
    });
  }
  // Référence mutable pour l'état mute (utilisée dans les callbacks audio pour éviter les stale closures)
  const isMutedRef = useRef(isMuted);

  // ===== DONNÉES DE LOGGING POUR LE DEBUG =====
  // Mémorisation des données de configuration pour le logging (évite les recalculs inutiles)
  // Utilisé pour logger la sélection de l'agent vocal et détecter les changements de config
  const voiceAgentLogData = useMemo(() => {
    const promptVariables = (modelConfig as any)?.promptVariables;
    const promptVariableKeys = promptVariables ? Object.keys(promptVariables).sort() : null;
    const modelConfigKeys = modelConfig ? Object.keys(modelConfig).sort() : [];
    
    const payload = {
      provider: modelConfig?.provider,
      voiceAgentProvider,
      effectiveProvider: voiceAgentProvider,
      isSpeechmaticsAgent,
      isHybridAgent,
      modelConfigKeys,
      speechmaticsSttLanguage: modelConfig?.speechmaticsSttLanguage,
      promptVariables: promptVariableKeys,
    };
    
    return {
      payload,
      signature: JSON.stringify(payload), // Signature pour détecter les changements
    };
  }, [modelConfig, voiceAgentProvider, isSpeechmaticsAgent, isHybridAgent]);

  // Niveau audio sécurisé pour l'animation (évite NaN/undefined quand le micro est bloqué)
  const safeAudioLevel = useMemo(() => {
    const clamped = Number.isFinite(audioLevel) ? audioLevel : 0;
    return Math.min(Math.max(clamped, 0), 1);
  }, [audioLevel]);

  // ===== REGISTRE DES MESSAGES POUR DÉDUPLICATION =====
  // Registre interne pour suivre les messages et éviter les doublons
  // Clé: messageId, Valeur: { content, status: 'interim' | 'final', timestamp }
  // Utilisé pour déterminer si un message doit être mis à jour ou ignoré
  
  // ===== EFFETS DE DEBUG ET SYNCHRONISATION =====
  // Log de la sélection de l'agent vocal lors des changements de configuration
  useEffect(() => {
    devLog('[PremiumVoiceInterface] 🎤 Voice Agent Selection:', voiceAgentLogData.payload);
    
    // Avertissement si Speechmatics n'est pas sélectionné (pour debug)
    if (!isSpeechmaticsAgent) {
      devWarn('[PremiumVoiceInterface] ⚠️ Speechmatics not selected!', {
        voiceAgentProvider,
        provider: modelConfig?.provider,
        expected: 'speechmatics-voice-agent',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAgentLogData.signature]);

  // ===== DÉTECTION IN-APP BROWSER =====
  // Détecte si on est dans un in-app browser (Gmail, Facebook, etc.)
  // Ces navigateurs ne supportent souvent pas l'accès au microphone
  useEffect(() => {
    const browserInfo = isInAppBrowser();
    setInAppBrowserInfo(browserInfo);
    if (browserInfo.isInApp) {
      devWarn('[PremiumVoiceInterface] ⚠️ In-app browser detected:', browserInfo.appName);
    }
  }, []);

  // ===== TUTORIAL CHECK =====
  // Check if user has seen the voice mode tutorial on first usage
  // If not seen, show tutorial and mute the mic during tutorial
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('voiceTutorial_hasSeenOnboarding');
    if (!hasSeenTutorial) {
      setShowTutorial(true);
      tutorialActiveRef.current = true;
      // Mute the mic during tutorial - will unmute when tutorial completes
      setIsMuted(true);
      isMutedRef.current = true;
    }
  }, []);

  // Pause inactivity timer while tutorial is showing
  // Timer will be reset when tutorial completes
  useEffect(() => {
    if (showTutorial) {
      inactivityMonitor.pauseTimer();
    }
  }, [showTutorial, inactivityMonitor]);

  // Fonction pour ouvrir le lien dans Safari/Chrome
  const openInExternalBrowser = useCallback(() => {
    const currentUrl = window.location.href;

    // Sur iOS, on peut essayer plusieurs méthodes
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isIOS) {
      // Méthode 1: Utiliser x-safari-https pour forcer Safari
      const safariUrl = currentUrl.replace(/^https?:\/\//, 'x-safari-https://');
      window.location.href = safariUrl;

      // Fallback après 500ms si ça n'a pas marché
      setTimeout(() => {
        // Méthode 2: Utiliser l'API de partage native si disponible
        if (navigator.share) {
          navigator.share({
            title: 'Ouvrir dans Safari',
            url: currentUrl,
          }).catch(() => {
            // Méthode 3: Copier l'URL dans le presse-papier
            navigator.clipboard?.writeText(currentUrl);
            alert('Lien copié ! Collez-le dans Safari pour utiliser le mode vocal.');
          });
        } else {
          // Copier dans le presse-papier
          navigator.clipboard?.writeText(currentUrl);
          alert('Lien copié ! Collez-le dans Safari pour utiliser le mode vocal.');
        }
      }, 500);
    } else {
      // Sur Android, window.open peut fonctionner
      const newWindow = window.open(currentUrl, '_system');
      if (!newWindow) {
        // Fallback: copier l'URL
        navigator.clipboard?.writeText(currentUrl);
        alert('Lien copié ! Collez-le dans Chrome pour utiliser le mode vocal.');
      }
    }
  }, []);

  // Synchronisation de la référence mutable avec l'état mute
  // Permet aux callbacks audio d'accéder à la valeur actuelle sans stale closure
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // ===== PAGE VISIBILITY HANDLING =====
  // Auto-mute le microphone quand la page devient cachée (switch onglet/app)
  // Ré-acquiert le Wake Lock quand la page redevient visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.visibilityState === 'hidden';

      devLog('[PremiumVoiceInterface] 👁️ Visibility changed:', {
        isHidden,
        isConnected,
        isMuted: isMutedRef.current
      });

      if (isHidden) {
        // Page devient cachée → mute automatique si connecté et pas déjà muted
        if (isConnected && !isMutedRef.current) {
          devLog('[PremiumVoiceInterface] 👁️ Page hidden - auto-muting microphone');
          wasMutedByVisibilityRef.current = true;

          // Mute le microphone (même logique que l'inactivity monitor)
          setIsMuted(true);
          isMutedRef.current = true;

          // Pour Speechmatics, appeler setMicrophoneMuted directement
          if (agentRef.current && agentRef.current instanceof SpeechmaticsVoiceAgent) {
            agentRef.current.setMicrophoneMuted(true);
          }
        }
      } else {
        // Page redevient visible
        // 1. Ré-acquérir le wake lock si connecté
        if (isConnected) {
          acquireWakeLock();
        }
        // 2. NE PAS auto-unmute - l'utilisateur doit cliquer manuellement
        // (sécurité/vie privée - on ne veut pas que le micro se réactive sans action consciente)
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isConnected, acquireWakeLock]);

  // BUG-032 FIX: Sync speakerMappings ref with state to avoid stale closures in callbacks
  useEffect(() => {
    speakerMappingsRef.current = speakerMappings;
  }, [speakerMappings]);

  // Clear pendingFinalUser once the message appears in props.messages
  // This prevents the "blanc" gap between partial disappearing and final appearing
  useEffect(() => {
    if (!pendingFinalUser) return;

    // Check if the pending message now exists in props.messages
    const messageConfirmed = messages.some(msg =>
      msg.messageId === pendingFinalUser.messageId ||
      (msg.content === pendingFinalUser.content && msg.role === 'user')
    );

    if (messageConfirmed) {
      setPendingFinalUser(null);
    }
  }, [messages, pendingFinalUser]);

  // ===== MISE À JOUR DYNAMIQUE DES PROMPTS =====
  // Fonction réutilisable pour mettre à jour les prompts depuis l'API
  // Utilisée lors du changement de step ET périodiquement pour les variables de temps
  const updatePromptsFromApi = useCallback(async (reason: string) => {
    const agent = agentRef.current;
    if (!(agent instanceof SpeechmaticsVoiceAgent) || !agent.isConnected()) {
      return;
    }

    try {
      // BUG-039 FIX: Pass inviteToken to agent-config for proper participant filtering
      // Without token, individual_parallel mode shows ALL participants instead of current one
      const url = inviteToken
        ? `/api/ask/${askKey}/agent-config?token=${encodeURIComponent(inviteToken)}`
        : `/api/ask/${askKey}/agent-config`;
      const response = await fetch(url);
      if (!response.ok) {
        devError(`[PremiumVoiceInterface] ❌ Failed to fetch agent config (${reason}):`, response.status, response.statusText);
        return;
      }

      const result = await response.json();
      if (!result.success || !result.data) {
        devError(`[PremiumVoiceInterface] ❌ Invalid agent config response (${reason}):`, result);
        return;
      }

      const { systemPrompt: newSystemPrompt, userPrompt: newUserPrompt, promptVariables: newPromptVariables } = result.data;

      // Update the agent's prompts without reconnecting
      agent.updatePrompts({
        systemPrompt: newSystemPrompt,
        userPrompt: newUserPrompt,
        promptVariables: newPromptVariables,
      });

      devLog('[PremiumVoiceInterface] ✅ Prompts updated:', reason);
    } catch (error) {
      devError('[PremiumVoiceInterface] ❌ Error updating prompts:', reason, error);
    }
  }, [askKey, inviteToken]);

  // ===== MISE À JOUR LORS DU CHANGEMENT DE STEP =====
  const previousStepIdRef = useRef<string | null | undefined>(currentConversationStepId);

  useEffect(() => {
    // Skip if step hasn't actually changed
    if (previousStepIdRef.current === currentConversationStepId) {
      return;
    }

    // Skip initial mount (no previous step)
    if (previousStepIdRef.current === undefined && !currentConversationStepId) {
      previousStepIdRef.current = currentConversationStepId;
      return;
    }

    // Update ref for next comparison
    const prevStepId = previousStepIdRef.current;
    previousStepIdRef.current = currentConversationStepId;

    devLog('[PremiumVoiceInterface] 📋 Step changed:', {
      previousStepId: prevStepId,
      newStepId: currentConversationStepId,
    });

    updatePromptsFromApi(`step changed to ${currentConversationStepId}`);
  }, [currentConversationStepId, updatePromptsFromApi]);

  // ===== MISE À JOUR PÉRIODIQUE DES VARIABLES DE TEMPS =====
  // Rafraîchit les prompts toutes les 30 secondes pour mettre à jour step_elapsed_minutes, is_overtime, etc.
  // Ces variables sont calculées côté serveur et doivent être rechargées périodiquement
  const lastPromptUpdateMinuteRef = useRef<number>(0);

  useEffect(() => {
    // Skip if no elapsed time or timer is paused
    if (elapsedMinutes === undefined || isTimerPaused) {
      return;
    }

    // Calculate the current "update slot" (every 0.5 minute = 30 seconds)
    const currentSlot = Math.floor(elapsedMinutes * 2);

    // Skip if we're still in the same slot
    if (currentSlot === lastPromptUpdateMinuteRef.current) {
      return;
    }

    // Update the ref
    lastPromptUpdateMinuteRef.current = currentSlot;

    // Skip the very first slot (initial load)
    if (currentSlot === 0) {
      return;
    }

    devLog('[PremiumVoiceInterface] ⏱️ Periodic time update at', elapsedMinutes.toFixed(1), 'min');
    updatePromptsFromApi(`periodic time update at ${elapsedMinutes.toFixed(1)}min`);
  }, [elapsedMinutes, isTimerPaused, updatePromptsFromApi]);

  // ===== AGENT RESPONSE NUDGE - Detect stuck agent and force response =====
  // INTELLIGENT NUDGE: Only triggers if NO streaming has started within 5 seconds
  // If streaming has started (agent is responding), we don't nudge
  useEffect(() => {
    // Skip in consultant mode (no AI responses expected)
    if (consultantMode) {
      return;
    }

    // Check every 1 second for faster detection
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastUserMessageTimestampRef.current;
      const timeSinceLastPartial = now - lastUserPartialTimestampRef.current;
      const streamingStarted = lastAssistantStreamTimestampRef.current > 0;

      // Skip if not awaiting response or already nudged
      if (!awaitingAgentResponseRef.current || hasNudgedForCurrentMessageRef.current) {
        return;
      }

      // Skip if streaming has started - agent IS responding, no nudge needed
      if (streamingStarted) {
        devLog('[PremiumVoiceInterface] 🔍 Nudge check: streaming active, no nudge needed');
        return;
      }

      // Skip if not connected
      if (!isConnected || !agentRef.current) {
        return;
      }

      // Skip if user is currently speaking (received a partial recently)
      // This uses timestamp instead of checking interimUser content because
      // partials might stop coming without a final message, leaving stale content
      if (lastUserPartialTimestampRef.current > 0 && timeSinceLastPartial < USER_SPEAKING_WINDOW_MS) {
        devLog('[PremiumVoiceInterface] 🔍 Nudge check: user still speaking (partial', Math.round(timeSinceLastPartial / 1000), 's ago)');
        return;
      }

      // Log the check status (only when approaching timeout to reduce noise)
      if (elapsed >= AGENT_RESPONSE_TIMEOUT_MS - 1000) {
        devLog('[PremiumVoiceInterface] 🔍 Nudge check:', {
          elapsedSinceUserMessage: Math.round(elapsed / 1000) + 's',
          streamingStarted,
          threshold: Math.round(AGENT_RESPONSE_TIMEOUT_MS / 1000) + 's',
          willNudge: elapsed >= AGENT_RESPONSE_TIMEOUT_MS,
        });
      }

      // Check if timeout has passed AND no streaming started
      if (elapsed >= AGENT_RESPONSE_TIMEOUT_MS) {
        devLog('[PremiumVoiceInterface] ⚠️ No streaming received - nudging after', Math.round(elapsed / 1000), 'seconds');

        // Mark as nudged to prevent duplicate attempts
        hasNudgedForCurrentMessageRef.current = true;

        // BUG-041 FIX: Pause inactivity timer during nudge API call
        // The timer will resume when TTS finishes (via onPlaybackEnd callback)
        // or when we explicitly resume it on failure
        inactivityMonitor.pauseTimer();

        // Call the respond endpoint to force a response
        const nudgeAgent = async () => {
          try {
            const headers: HeadersInit = { 'Content-Type': 'application/json' };
            if (inviteToken) {
              headers['x-invite-token'] = inviteToken;
            }

            devLog('[PremiumVoiceInterface] 🔄 Sending nudge to /respond endpoint with last user message');

            // Note: Use 'message' property (not 'content') to match /respond API contract
            const response = await fetch(`/api/ask/${askKey}/respond`, {
              method: 'POST',
              headers,
              // BUG-040 FIX: Do NOT set voiceGenerated: true for nudge requests!
              // voiceGenerated: true tells /respond to persist the message content as AI response
              // (for real voice AI responses from Speechmatics). But nudge wants to TRIGGER
              // a new AI response, not persist the user's message as AI response.
              body: JSON.stringify({
                message: lastUserMessageContentRef.current,
                senderType: 'user',
                metadata: {
                  voiceGenerated: false, // Nudge should trigger AI response, not persist user message
                  nudgeRetry: true, // Mark as a nudge retry for debugging
                },
              }),
            });

            if (response.ok) {
              const result = await response.json();
              // Note: /respond returns { message: Message } not { aiResponse: string }
              const aiResponseContent = result.data?.message?.content;
              if (result.success && aiResponseContent) {
                devLog('[PremiumVoiceInterface] ✅ Nudge successful - got AI response');

                // If Speechmatics agent, speak the response via TTS
                const agent = agentRef.current;
                if (agent instanceof SpeechmaticsVoiceAgent && agent.isConnected()) {
                  await agent.speakInitialMessage(aiResponseContent);
                }

                // Clear awaiting state and thinking indicator
                awaitingAgentResponseRef.current = false;
                setIsAgentThinking(false);
                // Note: Timer will resume via onPlaybackEnd when TTS finishes
              } else {
                devWarn('[PremiumVoiceInterface] ⚠️ Nudge returned no AI response:', result);
                // Resume timer on failure - no TTS will play
                setIsAgentThinking(false);
                inactivityMonitor.resumeTimerAfterDelay(0);
              }
            } else {
              devError('[PremiumVoiceInterface] ❌ Nudge failed:', response.status, await response.text());
              // Resume timer on failure - no TTS will play
              setIsAgentThinking(false);
              inactivityMonitor.resumeTimerAfterDelay(0);
            }
          } catch (error) {
            devError('[PremiumVoiceInterface] ❌ Error nudging agent:', error);
            // Resume timer on error - no TTS will play
            setIsAgentThinking(false);
            inactivityMonitor.resumeTimerAfterDelay(0);
          }
        };

        nudgeAgent();
      }
    }, 1000); // Check every second for faster detection

    return () => {
      clearInterval(checkInterval);
    };
  }, [askKey, inviteToken, isConnected, consultantMode, inactivityMonitor]);

  // ===== FONCTIONS DE FUSION ET GESTION DES MESSAGES =====
  /**
   * Fusionne le contenu de streaming pour éviter les doublons et les fragments
   * 
   * Cette fonction gère plusieurs cas :
   * - Contenu identique : retourne l'existant
   * - Nouveau contenu contient l'ancien : retourne le nouveau (extension)
   * - Ancien contenu contient le nouveau : retourne l'ancien (le nouveau est un fragment)
   * - Contenu partiellement chevauchant : fusionne intelligemment
   * 
   * @param previous - Contenu précédent (peut être undefined pour le premier message)
   * @param incoming - Nouveau contenu reçu
   * @returns Contenu fusionné sans doublons
   */
  const mergeStreamingContent = useCallback((previous: string | undefined, incoming: string): string => {
    // Cas 1: Pas de contenu précédent, retourner le nouveau
    if (!previous) return incoming;
    // Cas 2: Pas de nouveau contenu, retourner l'ancien
    if (!incoming) return previous;
    // Cas 3: Contenu identique, pas de changement
    if (incoming === previous) return previous;
    // Cas 4: Le nouveau contenu étend l'ancien (ex: "Bonjour" -> "Bonjour comment")
    if (incoming.startsWith(previous)) return incoming;
    // Cas 5: L'ancien contenu contient le nouveau (le nouveau est un fragment)
    if (previous.startsWith(incoming)) return previous;
    // Cas 6: Le nouveau contient l'ancien quelque part (correction/refinement)
    if (incoming.includes(previous)) return incoming;
    // Cas 7: L'ancien contient le nouveau quelque part
    if (previous.includes(incoming)) return previous;
    // Cas 8: Contenu complètement différent, fusionner avec espace
    return `${previous} ${incoming}`.replace(/\s+/g, ' ').trim();
  }, []);

  // ===== FONCTIONS UTILITAIRES POUR L'INTERFACE =====
  /**
   * Récupère le prénom de l'utilisateur pour le message de bienvenue
   * 
   * @returns Le prénom de l'utilisateur ou "there" par défaut
   */
  const getUserName = () => {
    if (user?.fullName) {
      const firstName = user.fullName.split(' ')[0];
      return firstName;
    }
    return 'there';
  };


  // ===== CONFIGURATION DE L'ANALYSE AUDIO =====
  /**
   * Configure l'analyse audio pour la visualisation du waveform
   * 
   * Crée un AudioContext, un AnalyserNode et connecte le stream du microphone
   * pour extraire les données de fréquence en temps réel.
   * 
   * Le niveau audio est calculé toutes les frames d'animation et mis à jour
   * seulement si le changement est significatif (> 0.01) pour réduire les re-renders.
   * 
   * @param stream - Stream média du microphone à analyser
   */
  const setupAudioAnalysis = useCallback(async (stream: MediaStream) => {
    try {
      // Vérifier si le microphone est muet avant de configurer l'analyse
      if (isMutedRef.current) {
        devLog('[PremiumVoiceInterface] 🔇 Skipping audio analysis setup because microphone is muted');
        // Arrêter tous les tracks du stream pour libérer les ressources
        stream.getTracks().forEach(track => {
          if (track.readyState === 'live') {
            track.stop();
          }
        });
        return;
      }

      // MEMORY LEAK FIX: Clean up existing audio context before creating a new one
      if (audioContextRef.current) {
        devWarn('[PremiumVoiceInterface] ⚠️ AudioContext already exists, cleaning up before creating new one');
        await cleanupAudioAnalysis(true);
      }

      // Créer le contexte audio Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Créer un analyseur pour extraire les données de fréquence
      const analyser = audioContext.createAnalyser();
      // Créer une source audio depuis le stream du microphone
      const microphone = audioContext.createMediaStreamSource(stream);
      
      // Configuration de l'analyseur :
      // - fftSize: 256 = résolution de l'analyse (plus petit = plus rapide mais moins précis)
      // - smoothingTimeConstant: 0.8 = lissage des données (0-1, plus élevé = plus lisse)
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      // Connecter le microphone à l'analyseur
      microphone.connect(analyser);
      
      // Stocker les références pour le cleanup
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      microphoneNodeRef.current = microphone;
      streamRef.current = stream;

      // Tableau pour stocker les données de fréquence (taille = frequencyBinCount)
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let lastLevel = 0; // Dernier niveau pour détecter les changements significatifs

      /**
       * Fonction récursive pour mettre à jour le niveau audio à chaque frame
       * Utilise requestAnimationFrame pour une mise à jour fluide (~60fps)
       */
      const updateAudioLevel = () => {
        // Arrêter si l'analyseur a été nettoyé (composant démonté ou muet)
        if (!analyserRef.current) {
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          return;
        }

        // Extraire les données de fréquence dans le tableau
        analyserRef.current.getByteFrequencyData(dataArray);
        // Calculer la moyenne des fréquences pour obtenir le niveau global
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        // Normaliser entre 0 et 1 (128 = valeur médiane pour Uint8)
        const normalizedLevel = Number.isFinite(average) ? Math.min(average / 128, 1) : 0;
        const safeLevel = Number.isFinite(normalizedLevel) ? normalizedLevel : 0;

        // Mettre à jour seulement si le changement est significatif (> 0.01)
        // Cela réduit les re-renders inutiles et améliore les performances
        if (Math.abs(safeLevel - lastLevel) > 0.01) {
          lastLevel = safeLevel;
          setAudioLevel(safeLevel);
        }

        // Programmer la prochaine mise à jour
        animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
      };

      // Démarrer la boucle d'animation
      updateAudioLevel();
    } catch (err) {
      devError('Error setting up audio analysis:', err);
    }
  }, []);

  /**
   * Démarre la visualisation audio en demandant l'accès au microphone
   * 
   * Cette fonction crée un stream séparé pour la visualisation (indépendant
   * du stream utilisé par l'agent vocal). Cela permet de continuer la visualisation
   * même si l'agent vocal gère son propre stream.
   * 
   * Le stream est automatiquement arrêté si le microphone est muet.
   */
  const startAudioVisualization = useCallback(() => {
    // Demander l'accès au microphone pour la visualisation
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        // Vérifier si le microphone est muet avant de configurer l'analyse
        if (isMutedRef.current) {
          // Arrêter tous les tracks pour libérer les ressources
          stream.getTracks().forEach(track => {
            if (track.readyState === 'live') {
              track.stop();
            }
          });
          return;
        }
        // Configurer l'analyse audio avec le stream
        return setupAudioAnalysis(stream);
      })
      .catch(err => {
        // Erreur non bloquante - la visualisation est optionnelle
        devWarn('[PremiumVoiceInterface] Could not setup audio analysis:', err);
      });
  }, [setupAudioAnalysis]);

  // ===== GESTION DES MICROPHONES =====
  /**
   * Charge la liste des microphones disponibles et restaure les préférences sauvegardées
   * 
   * Cette fonction :
   * 1. Demande la permission d'accès au microphone (nécessaire pour obtenir les labels)
   * 2. Énumère tous les périphériques audio
   * 3. Filtre pour ne garder que les microphones (audioinput)
   * 4. Restaure les préférences depuis localStorage (deviceId, sensibilité, isolation)
   * 
   * Les préférences sont sauvegardées automatiquement lors des changements.
   */
  const loadMicrophoneDevices = useCallback(async () => {
    try {
      // Demander la permission d'abord pour obtenir les labels des périphériques
      // Sans permission, les labels sont vides (ex: "Microphone 1" au lieu du vrai nom)
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Énumérer tous les périphériques média disponibles
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Filtrer pour ne garder que les microphones (entrées audio)
      const microphones = devices.filter(device => device.kind === 'audioinput');
      
      // Mettre à jour la liste des microphones disponibles
      setAvailableMicrophones(microphones);
      
      // ===== RESTAURATION DES PRÉFÉRENCES DEPUIS LOCALSTORAGE =====
      // Récupérer les préférences sauvegardées
      const savedDeviceId = localStorage.getItem('voiceAgent_microphoneDeviceId');
      const savedSensitivity = localStorage.getItem('voiceAgent_microphoneSensitivity');
      const savedIsolation = localStorage.getItem('voiceAgent_voiceIsolation');
      
      // Restaurer le microphone sélectionné (si toujours disponible)
      if (savedDeviceId && microphones.some(m => m.deviceId === savedDeviceId)) {
        setSelectedMicrophoneId(savedDeviceId);
      } else if (microphones.length > 0) {
        // Sinon, utiliser le premier microphone disponible
        setSelectedMicrophoneId(microphones[0].deviceId);
      }
      
      // Restaurer la sensibilité (valeur entre 0.5 et 3.0)
      if (savedSensitivity) {
        const sensitivity = parseFloat(savedSensitivity);
        if (!isNaN(sensitivity) && sensitivity >= 0.5 && sensitivity <= 3.0) {
          setMicrophoneSensitivity(sensitivity);
        }
      }
      
      // Restaurer l'état de l'isolation vocale
      if (savedIsolation !== null) {
        setVoiceIsolationEnabled(savedIsolation === 'true');
      }
    } catch (error) {
      devError('[PremiumVoiceInterface] Error loading microphone devices:', error);
    }
  }, []);

  /**
   * Sauvegarde les préférences du microphone dans localStorage
   *
   * Les préférences sauvegardées sont :
   * - ID du microphone sélectionné
   * - Sensibilité du microphone (0.5 - 3.0)
   * - État de l'isolation vocale (true/false)
   *
   * Ces préférences sont restaurées automatiquement au chargement du composant.
   */
  const savePreferences = useCallback(() => {
    if (selectedMicrophoneId) {
      localStorage.setItem('voiceAgent_microphoneDeviceId', selectedMicrophoneId);
    }
    localStorage.setItem('voiceAgent_microphoneSensitivity', microphoneSensitivity.toString());
    localStorage.setItem('voiceAgent_voiceIsolation', voiceIsolationEnabled.toString());
  }, [selectedMicrophoneId, microphoneSensitivity, voiceIsolationEnabled]);

  // ===== NETTOYAGE DES RESSOURCES AUDIO =====
  /**
   * Nettoie les ressources d'analyse audio
   * 
   * Cette fonction gère deux cas :
   * 1. Mute : garde l'AudioContext ouvert pour la lecture TTS (closeAudioContext = false)
   * 2. Déconnexion : ferme tout y compris l'AudioContext (closeAudioContext = true)
   * 
   * IMPORTANT : L'ordre de nettoyage est critique :
   * 1. Arrêter l'animation frame
   * 2. Déconnecter tous les AudioNodes (microphone, analyser)
   * 3. Arrêter tous les tracks du MediaStream
   * 4. Fermer l'AudioContext (seulement si closeAudioContext = true)
   * 
   * @param closeAudioContext - Si true, ferme l'AudioContext complètement (déconnexion)
   *                           Si false, garde l'AudioContext ouvert (mute, pour TTS)
   */
  const cleanupAudioAnalysis = useCallback((closeAudioContext: boolean = false) => {
    // Éviter les nettoyages multiples simultanés
    if (isCleaningUpAudioRef.current && closeAudioContext) {
      devLog('[PremiumVoiceInterface] ⚠️ Audio cleanup already in progress, skipping duplicate call');
      return;
    }

    if (closeAudioContext) {
      isCleaningUpAudioRef.current = true;
    }

    devLog('[PremiumVoiceInterface] 🧹 Cleaning up audio analysis...', { closeAudioContext });

    // Étape 1: Arrêter la boucle d'animation pour éviter les mises à jour après cleanup
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // CRITIQUE: Déconnecter TOUS les AudioNodes avant de fermer l'AudioContext
    // Cela garantit qu'aucune connexion du graphe audio ne reste active
    
    // Étape 2: Déconnecter le nœud microphone (MediaStreamAudioSourceNode)
    if (microphoneNodeRef.current) {
      try {
        microphoneNodeRef.current.disconnect();
        microphoneNodeRef.current = null;
        devLog('[PremiumVoiceInterface] ✅ Microphone node disconnected');
      } catch (error) {
        devWarn('[PremiumVoiceInterface] ⚠️ Error disconnecting microphone node:', error);
      }
    }
    
    // Étape 3: Déconnecter le nœud analyseur
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
        analyserRef.current = null;
        devLog('[PremiumVoiceInterface] ✅ Analyser node disconnected');
      } catch (error) {
        devWarn('[PremiumVoiceInterface] ⚠️ Error disconnecting analyser node:', error);
      }
    }
    
    // Étape 4: Arrêter tous les tracks du MediaStream (entrée microphone)
    // CRITIQUE: Arrêter TOUS les tracks (audio + vidéo si présent) pour libérer complètement le microphone
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(track => {
          if (track.readyState === 'live') {
            track.stop();
            devLog('[PremiumVoiceInterface] ✅ Stopped track:', track.kind, track.label);
          }
        });
        streamRef.current = null;
        devLog('[PremiumVoiceInterface] ✅ Media stream cleaned up');
      } catch (error) {
        devWarn('[PremiumVoiceInterface] ⚠️ Error stopping stream tracks:', error);
      }
    }
    
    // Étape 5: Fermer l'AudioContext seulement si explicitement demandé (déconnexion complète)
    // Lors du mute, on le garde ouvert pour la lecture TTS
    // CRITIQUE: Fermer l'AudioContext APRÈS que tous les nœuds soient déconnectés
    if (closeAudioContext && audioContextRef.current) {
      try {
        // Vérifier que le contexte n'est pas déjà fermé
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close();
        }
        devLog('[PremiumVoiceInterface] ✅ Audio context closed');
      } catch (error) {
        devWarn('[PremiumVoiceInterface] ⚠️ Error closing audio context:', error);
      }
      audioContextRef.current = null;
    } else if (closeAudioContext === false) {
      devLog('[PremiumVoiceInterface] ℹ️ Audio context kept open for TTS playback');
    }
    
    // Réinitialiser le niveau audio à 0
    setAudioLevel(0);

    if (closeAudioContext) {
      isCleaningUpAudioRef.current = false;
    }

    devLog('[PremiumVoiceInterface] ✅ Audio analysis cleanup complete');
  }, []);

  // ===== HANDLERS DES ÉVÉNEMENTS DE L'AGENT =====
  /**
   * Handler appelé lorsqu'un message est reçu de l'agent vocal
   * 
   * Cette fonction :
   * 1. Détecte quand l'utilisateur parle (pour l'animation visuelle)
   * 2. Met à jour les buffers interim locaux (un par rôle) pour l'affichage streaming
   * 3. Transmet seulement les messages finaux au parent via onMessage (pour persistance)
   * 
   * @param message - Message reçu (peut être interim ou final, user ou assistant)
   */
  const handleMessage = useCallback((
    rawMessage: DeepgramMessageEvent | HybridVoiceAgentMessage | SpeechmaticsMessageEvent
  ) => {
    const isInterim = Boolean((rawMessage as any).isInterim);
    const messageId = (rawMessage as SpeechmaticsMessageEvent).messageId;
    const speaker = (rawMessage as SpeechmaticsMessageEvent).speaker;
    const role: 'user' | 'assistant' =
      rawMessage.role === 'agent' ? 'assistant' : (rawMessage.role as 'user' | 'assistant');

    // BUG-033 FIX: Track speakers from both interim and non-interim messages for faster detection
    // The first speaker identification and speaker order tracking now happens on interim messages too
    // This provides faster speaker detection without waiting for the final message
    if (consultantMode && speaker) {
      // Track the first speaker as the consultant (for display positioning)
      // BUG-033 FIX: Also detect from interim messages for faster identification
      if (!consultantSpeakerRef.current) {
        consultantSpeakerRef.current = speaker;
        devLog('[PremiumVoiceInterface] 👤 First speaker (consultant) identified:', speaker, isInterim ? '(interim)' : '(final)');
      }

      // BUG-033 FIX: Pre-assign speaker order from interim messages for faster tracking
      if (!speakerOrderRef.current.has(speaker)) {
        speakerOrderRef.current.set(speaker, speakerOrderRef.current.size + 1);
        devLog('[PremiumVoiceInterface] 📋 Speaker order assigned:', speaker, '->', speakerOrderRef.current.get(speaker), isInterim ? '(interim)' : '(final)');
      }

      // Detect new speakers and show assignment overlay
      // This includes the first speaker (consultant) - all speakers must be assigned by user
      // BUG-033 FIX: Only show overlay on non-interim messages to avoid spam,
      // but speaker is already tracked above from interim for faster detection
      if (!isInterim && !knownSpeakersRef.current.has(speaker)) {
        devLog('[PremiumVoiceInterface] 🆕 New speaker detected, showing overlay:', speaker);
        // Add to pending queue (allows stacking multiple speakers)
        setPendingSpeakers(prev => {
          if (!prev.includes(speaker)) {
            return [...prev, speaker];
          }
          return prev;
        });
      }
    }

    const baseMessage: VoiceMessage = {
      role,
      content: rawMessage.content,
      timestamp: rawMessage.timestamp || new Date().toISOString(),
      messageId,
      isInterim,
      speaker, // Include speaker for consultant mode
    };

    // Détecter quand l'utilisateur parle pour l'animation visuelle
    if (role === 'user') {
      setIsSpeaking(true);
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
      }
      speakingTimeoutRef.current = setTimeout(() => {
        setIsSpeaking(false);
      }, 2000);
      if (isInterim) {
        setSemanticTelemetry(null);
      }
      // Record user activity for inactivity monitor
      inactivityMonitor.recordUserActivity();
    } else {
      // Record assistant activity for inactivity monitor
      // Pass isFinal=true for final messages so the timer resumes after TTS delay
      inactivityMonitor.recordAssistantActivity(!isInterim);
    }

    // Cas INTERIM → mise à jour du buffer local uniquement
    // PERF FIX: Throttle interim updates to reduce re-renders from ~20/sec to ~7/sec
    if (isInterim) {
      const now = Date.now();

      if (role === 'assistant') {
        // Track when streaming started (for intelligent nudge)
        if (lastAssistantStreamTimestampRef.current === 0) {
          lastAssistantStreamTimestampRef.current = Date.now();
          devLog('[PremiumVoiceInterface] 🎯 Agent streaming started');
        }
        // Agent is now streaming - no longer "thinking"
        setIsAgentThinking(false);

        // Build the new interim message (always merge content)
        const newInterimAssistant: VoiceMessage = {
          ...(pendingInterimAssistantRef.current || baseMessage),
          content: mergeStreamingContent(pendingInterimAssistantRef.current?.content, baseMessage.content),
          isInterim: true,
        };
        pendingInterimAssistantRef.current = newInterimAssistant;

        // Throttle: only update state if enough time has passed
        const timeSinceLastUpdate = now - lastInterimAssistantUpdateRef.current;
        if (timeSinceLastUpdate >= INTERIM_THROTTLE_MS) {
          // Enough time passed - update immediately
          lastInterimAssistantUpdateRef.current = now;
          setInterimAssistant(newInterimAssistant);
        } else if (!interimAssistantThrottleTimerRef.current) {
          // Schedule an update for later
          interimAssistantThrottleTimerRef.current = setTimeout(() => {
            interimAssistantThrottleTimerRef.current = null;
            lastInterimAssistantUpdateRef.current = Date.now();
            if (pendingInterimAssistantRef.current) {
              setInterimAssistant(pendingInterimAssistantRef.current);
            }
          }, INTERIM_THROTTLE_MS - timeSinceLastUpdate);
        }
        // Else: timer already scheduled, it will pick up the latest content
      } else {
        // Pour les messages user, le SegmentStore a déjà fait la déduplication
        // par timestamps - on remplace simplement le contenu sans fusionner
        const newInterimUser: VoiceMessage = {
          ...(pendingInterimUserRef.current || baseMessage),
          content: baseMessage.content,
          isInterim: true,
        };
        pendingInterimUserRef.current = newInterimUser;

        // Throttle: only update state if enough time has passed
        const timeSinceLastUpdate = now - lastInterimUserUpdateRef.current;
        if (timeSinceLastUpdate >= INTERIM_THROTTLE_MS) {
          // Enough time passed - update immediately
          lastInterimUserUpdateRef.current = now;
          setInterimUser(newInterimUser);
        } else if (!interimUserThrottleTimerRef.current) {
          // Schedule an update for later
          interimUserThrottleTimerRef.current = setTimeout(() => {
            interimUserThrottleTimerRef.current = null;
            lastInterimUserUpdateRef.current = Date.now();
            if (pendingInterimUserRef.current) {
              setInterimUser(pendingInterimUserRef.current);
            }
          }, INTERIM_THROTTLE_MS - timeSinceLastUpdate);
        }
        // Else: timer already scheduled, it will pick up the latest content

        // Track when we received this partial (for nudge mechanism)
        lastUserPartialTimestampRef.current = now;
      }
      return;
    }

    // Cas FINAL → flush des buffers locaux
    if (role === 'assistant') {
      // PERF FIX: Clear throttle timer and pending ref on final message
      if (interimAssistantThrottleTimerRef.current) {
        clearTimeout(interimAssistantThrottleTimerRef.current);
        interimAssistantThrottleTimerRef.current = null;
      }
      pendingInterimAssistantRef.current = null;
      setInterimAssistant(null);

      // Agent responded - clear awaiting response state and reset streaming tracker
      awaitingAgentResponseRef.current = false;
      hasNudgedForCurrentMessageRef.current = false;
      lastAssistantStreamTimestampRef.current = 0; // Reset for next message
      setIsAgentThinking(false);

      // Detect STEP_COMPLETE in assistant messages and call API to complete the step
      const { hasMarker, stepId: detectedStepId } = detectStepComplete(rawMessage.content);
      if (hasMarker) {
        // Determine which step to complete
        const stepIdToComplete = detectedStepId === 'CURRENT' || !detectedStepId
          ? conversationPlan?.current_step_id
          : detectedStepId;

        // DEDUPLICATION: Skip if this step is already being completed or was completed
        if (stepIdToComplete && completingStepsRef.current.has(stepIdToComplete)) {
          devLog('[PremiumVoiceInterface] ⏭️ STEP_COMPLETE skipped (already completing):', stepIdToComplete);
        } else if (stepIdToComplete && askKey) {
          // Mark step as being completed to prevent duplicate calls
          completingStepsRef.current.add(stepIdToComplete);
          // Show loading indicator while generating step summary
          setIsGeneratingStepSummary(true);

          devLog('[PremiumVoiceInterface] 🎯 STEP_COMPLETE detected in voice response:', {
            detectedStepId,
            stepIdToComplete,
            currentStepId: conversationPlan?.current_step_id,
          });

          // BUG-026 FIX: Call step-complete API with retry logic
          const headers: HeadersInit = { 'Content-Type': 'application/json' };
          if (inviteToken) {
            headers['x-invite-token'] = inviteToken;
          }

          // Helper function to complete step with retry logic
          const completeStepWithRetry = async (maxRetries: number = 3, baseDelay: number = 1000) => {
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                const response = await fetch(`/api/ask/${askKey}/step-complete`, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ stepId: stepIdToComplete }),
                });

                // Validate response before parsing JSON
                if (!response.ok) {
                  throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
                }

                const result = await response.json();

                if (result.success) {
                  devLog('[PremiumVoiceInterface] ✅ Step completed via API:', {
                    completedStepId: stepIdToComplete,
                    nextStepId: result.data?.nextStepId,
                    attempt,
                  });
                  // Update parent's conversationPlan to sync with server
                  // This ensures the timer tracks the correct step
                  if (result.data?.conversationPlan && onConversationPlanUpdate) {
                    onConversationPlanUpdate(result.data.conversationPlan);
                  }
                  // Immediately refresh prompts with new step context
                  updatePromptsFromApi(`step completed: ${stepIdToComplete}`);
                  return true; // Success - exit retry loop
                } else {
                  // API returned success: false - this is a logical error, may be retryable
                  lastError = new Error(result.error || 'Unknown error');
                  devWarn(`[PremiumVoiceInterface] ⚠️ Step completion attempt ${attempt}/${maxRetries} failed:`, result.error);
                }
              } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                devWarn(`[PremiumVoiceInterface] ⚠️ Step completion attempt ${attempt}/${maxRetries} error:`, error);
              }

              // Don't delay after the last attempt
              if (attempt < maxRetries) {
                // Exponential backoff with jitter
                const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }

            // All retries failed
            devError('[PremiumVoiceInterface] ❌ Step completion failed after all retries:', {
              stepIdToComplete,
              error: lastError?.message,
            });
            // Remove from set on final failure so it can be retried later (e.g., on next message)
            completingStepsRef.current.delete(stepIdToComplete);
            return false;
          };

          // Execute with retry logic and hide loading indicator when done
          completeStepWithRetry().finally(() => {
            setIsGeneratingStepSummary(false);
          });
        }
      }
    } else {
      // Clear interim and store as pending final to avoid "blanc" gap
      // The message will stay visible until it appears in props.messages
      // PERF FIX: Clear throttle timer and pending ref on final message
      if (interimUserThrottleTimerRef.current) {
        clearTimeout(interimUserThrottleTimerRef.current);
        interimUserThrottleTimerRef.current = null;
      }
      pendingInterimUserRef.current = null;
      setInterimUser(null);
      // Generate ID once and reuse for both pendingFinalUser and onMessage
      // to ensure proper deduplication (fixes visual jump bug)
      const userFinalMessageId = messageId || `msg-${Date.now()}`;
      setPendingFinalUser({
        role: 'user',
        content: rawMessage.content,
        timestamp: rawMessage.timestamp || new Date().toISOString(),
        messageId: userFinalMessageId,
        isInterim: false,
        speaker,
      });

      // Track this user message as awaiting response (only in non-consultant mode)
      // The agent should respond to this message; if not, we'll nudge after timeout
      if (!consultantMode && rawMessage.content && rawMessage.content.trim()) {
        lastUserMessageTimestampRef.current = Date.now();
        lastUserMessageContentRef.current = rawMessage.content.trim();
        awaitingAgentResponseRef.current = true;
        hasNudgedForCurrentMessageRef.current = false;
        lastAssistantStreamTimestampRef.current = 0; // Reset streaming tracker
        setIsAgentThinking(true); // Show "agent is thinking" indicator
        devLog('[PremiumVoiceInterface] 👂 User message awaiting response:', rawMessage.content.substring(0, 50) + '...');
      }

      // Use the same ID for onMessage to ensure proper deduplication
      onMessage({
        ...rawMessage,
        messageId: userFinalMessageId,
        isInterim: false,
      });
      return; // Exit early for user messages
    }

    // For assistant messages only (user messages exit above)
    const finalMessageId = messageId || `msg-${Date.now()}`;
    onMessage({
      ...rawMessage,
      messageId: finalMessageId,
      isInterim: false,
    });
  }, [mergeStreamingContent, onMessage, conversationPlan, askKey, inviteToken, updatePromptsFromApi, consultantMode, onConversationPlanUpdate]);

  /**
   * Handler appelé en cas d'erreur de l'agent vocal
   * 
   * Affiche l'erreur dans l'interface et la transmet au parent.
   * 
   * @param error - Erreur à gérer
   */
  const handleError = useCallback((error: Error) => {
    setError(error.message);
    onError(error);
  }, [onError]);

  /**
   * Handler appelé lors des changements d'état de connexion
   *
   * Gère la mise à jour de l'état de connexion et nettoie les ressources
   * si la connexion est fermée.
   *
   * IMPORTANT: Ne nettoie PAS l'audio si une déconnexion est déjà en cours,
   * car disconnect() gère déjà le nettoyage complet.
   *
   * @param connected - État de connexion (true = connecté, false = déconnecté)
   */
  const handleConnectionChange = useCallback((connected: boolean) => {
    devLog('[PremiumVoiceInterface] 🔌 handleConnectionChange:', {
      connected,
      hasAgent: !!agentRef.current,
      isDisconnecting: isDisconnectingRef.current,
      willCleanup: !connected && agentRef.current && !isDisconnectingRef.current
    });

    // IMPORTANT: Ignorer les callbacks de connexion si l'agent n'existe plus
    // Cela arrive quand l'agent se connecte en arrière-plan après un unmount
    if (connected && !agentRef.current) {
      devLog('[PremiumVoiceInterface] ⚠️ Received connection callback but agent is null - ignoring (likely from unmounted component)');
      return;
    }

    setIsConnected(connected);
    // Si déconnecté, nettoyer toutes les ressources
    // MAIS seulement si on n'est pas déjà en train de se déconnecter
    // (pour éviter le double nettoyage)
    if (!connected && agentRef.current && !isDisconnectingRef.current) {
      setIsMicrophoneActive(false);
      setIsSpeaking(false);
      setSemanticTelemetry(null);
      cleanupAudioAnalysis(true); // Fermer l'AudioContext lors de la déconnexion
    }
  }, [cleanupAudioAnalysis]);

  const handleSemanticTelemetry = useCallback((event: SemanticTurnTelemetryEvent) => {
    if (event.decision === 'skipped') {
      setSemanticTelemetry(null);
      return;
    }
    setSemanticTelemetry(event);
  }, []);

  // ===== SPEAKER ASSIGNMENT HANDLER (CONSULTANT MODE) =====
  /**
   * Handle the speaker assignment decision from the overlay
   * Creates a guest participant if needed, or assigns to an existing one
   */
  const handleSpeakerAssignmentConfirm = useCallback(async (decision: SpeakerAssignmentDecision) => {
    devLog('[PremiumVoiceInterface] 📋 Speaker assignment decision:', decision);

    // Add speaker to known speakers
    knownSpeakersRef.current.add(decision.speaker);

    if (!decision.shouldTranscribe) {
      // User chose to ignore this speaker
      setSpeakerMappings(prev => [...prev, {
        speaker: decision.speaker,
        participantId: null,
        participantName: 'Ignored',
        shouldTranscribe: false,
      }]);
    } else if (decision.newGuest) {
      // Create a new guest participant
      try {
        const response = await fetch(`/api/ask/${askKey}/participants/guest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(inviteToken ? { 'X-Invite-Token': inviteToken } : {}),
          },
          body: JSON.stringify({
            firstName: decision.newGuest.firstName,
            lastName: decision.newGuest.lastName,
            speaker: decision.speaker,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          devError('[PremiumVoiceInterface] ❌ Failed to create guest participant:', errorData);
          // Still add the mapping locally even if API fails
        }

        const result = await response.json();
        const fullName = `${decision.newGuest.firstName} ${decision.newGuest.lastName}`;

        setSpeakerMappings(prev => [...prev, {
          speaker: decision.speaker,
          participantId: result.success ? result.data.id : null,
          participantName: fullName,
          shouldTranscribe: true,
        }]);

        devLog('[PremiumVoiceInterface] ✅ Guest participant created:', fullName);
      } catch (error) {
        devError('[PremiumVoiceInterface] ❌ Error creating guest participant:', error);
        // Add mapping with unknown name
        setSpeakerMappings(prev => [...prev, {
          speaker: decision.speaker,
          participantId: null,
          participantName: `${decision.newGuest!.firstName} ${decision.newGuest!.lastName}`,
          shouldTranscribe: true,
        }]);
      }
    } else if (decision.selectedParticipant) {
      // Assign to existing participant
      setSpeakerMappings(prev => [...prev, {
        speaker: decision.speaker,
        participantId: decision.selectedParticipant!.id,
        participantName: decision.selectedParticipant!.name,
        shouldTranscribe: true,
      }]);
    }

    // Remove the processed speaker from the queue (not all - just this one)
    setPendingSpeakers(prev => prev.filter(s => s !== decision.speaker));

    // BUG-010 FIX: Notify parent of mapping change using setSpeakerMappings callback
    // to get the updated state instead of relying on stale closure
    if (onSpeakerMappingChange) {
      // Use a functional update to capture the current state
      setSpeakerMappings(currentMappings => {
        // Call the parent with the updated mappings
        setTimeout(() => onSpeakerMappingChange(currentMappings), 0);
        return currentMappings; // Return unchanged
      });
    }
  }, [askKey, inviteToken, onSpeakerMappingChange]);

  /**
   * Handle closing the speaker assignment overlay without making a decision
   * Processes the current (first) speaker in the queue
   */
  const handleSpeakerAssignmentClose = useCallback((speaker: string) => {
    // If closed without decision, add speaker as "Unknown" but transcribe
    knownSpeakersRef.current.add(speaker);
    const speakerOrder = speakerOrderRef.current.get(speaker) || 1;
    setSpeakerMappings(prev => [...prev, {
      speaker,
      participantId: null,
      participantName: `User ${speakerOrder}`,
      shouldTranscribe: true,
    }]);
    // Remove this speaker from the queue
    setPendingSpeakers(prev => prev.filter(s => s !== speaker));
  }, []);

  /**
   * Handle speaker confirmation (user said "Yes, it's me")
   * Confirms the candidate speaker as the primary speaker
   */
  const handleSpeakerConfirm = useCallback(() => {
    devLog('[PremiumVoiceInterface] 🎤 User confirmed speaker');
    const agent = agentRef.current;
    if (agent && 'confirmCandidateSpeaker' in agent) {
      (agent as SpeechmaticsVoiceAgent).confirmCandidateSpeaker();
    }
    setSpeakerPendingConfirmation(null);
  }, []);

  /**
   * Handle speaker rejection (user said "Not me")
   * Rejects the candidate speaker and waits for the next one
   */
  const handleSpeakerReject = useCallback(() => {
    devLog('[PremiumVoiceInterface] 🔇 User rejected speaker');
    const agent = agentRef.current;
    if (agent && 'rejectCandidateSpeaker' in agent) {
      (agent as SpeechmaticsVoiceAgent).rejectCandidateSpeaker();
    }
    setSpeakerPendingConfirmation(null);
  }, []);

  /**
   * Handle speaker reassignment from the inline edit dropdown
   * Updates the mapping for the specified speaker to a new participant
   * If no mapping exists for this speaker, creates a new one
   */
  const handleSpeakerReassign = useCallback((
    speaker: string,
    newAssignment: { participantId: string | null; participantName: string; shouldTranscribe: boolean }
  ) => {
    setSpeakerMappings(prev => {
      const existingIndex = prev.findIndex(m => m.speaker === speaker);
      if (existingIndex >= 0) {
        // Update existing mapping
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], ...newAssignment };
        return updated;
      } else {
        // Create new mapping
        return [...prev, { speaker, ...newAssignment }];
      }
    });
    setEditingSpeaker(null);

    // Notify parent of mapping change
    if (onSpeakerMappingChange) {
      setTimeout(() => {
        setSpeakerMappings(current => {
          onSpeakerMappingChange(current);
          return current;
        });
      }, 0);
    }
  }, [onSpeakerMappingChange]);

  // ===== GESTION DE LA CONNEXION =====
  /**
   * Établit la connexion à l'agent vocal
   * 
   * Cette fonction :
   * 1. Empêche les connexions multiples simultanées
   * 2. Attend la fin d'une déconnexion en cours si nécessaire
   * 3. Crée l'agent approprié selon la configuration (Hybrid, Speechmatics, ou Deepgram)
   * 4. Configure les callbacks et établit la connexion WebSocket
   * 5. Démarre le microphone avec les paramètres sélectionnés
   * 6. Configure la visualisation audio
   * 
   * CRITIQUE : L'ordre des opérations est important pour éviter les conditions de course.
   */
  const connect = useCallback(async () => {
    // CRITIQUE: Empêcher les connexions multiples simultanées
    if (isConnectingRef.current) {
      devWarn('[PremiumVoiceInterface] ⚠️ Connection already in progress, ignoring duplicate call');
      return;
    }

    // CRITIQUE: Attendre la fin d'une déconnexion en cours avant de connecter
    // Cela évite les conflits de ressources (microphone, WebSocket)
    if (isDisconnectingRef.current) {
      devLog('[PremiumVoiceInterface] ⏳ Waiting for previous disconnect to complete...');
      // Attendre jusqu'à 5 secondes pour que la déconnexion se termine
      let waitCount = 0;
      while (isDisconnectingRef.current && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
      if (isDisconnectingRef.current) {
        devWarn('[PremiumVoiceInterface] ⚠️ Previous disconnect still in progress after 5s, aborting new connection');
        setError('Previous disconnect still in progress. Please wait a moment and try again.');
        return;
      }
    }

    // Vérifier si déjà connecté (évite les connexions inutiles)
    if (agentRef.current && isConnected) {
      devLog('[PremiumVoiceInterface] ℹ️ Already connected, skipping new connection');
      return;
    }

    try {
      isConnectingRef.current = true;
      devLog('[PremiumVoiceInterface] 🔌 Starting connection...');
      setError(null);
      setIsConnecting(true);

      // ===== CRÉATION ET CONFIGURATION DE L'AGENT VOCAL =====

      // CRITICAL: Disconnect any existing agent before creating a new one
      // This prevents orphaned agents from React StrictMode double-mounting
      if (agentRef.current) {
        devLog('[PremiumVoiceInterface] 🧹 Disconnecting existing agent before creating new one');
        try {
          await agentRef.current.disconnect();
        } catch (err) {
          devError('[PremiumVoiceInterface] ❌ Error disconnecting existing agent:', err);
        }
        agentRef.current = null;
      }

      // Sélection de l'agent selon la configuration

      if (isHybridAgent) {
        // Agent Hybrid : Deepgram STT + LLM (Anthropic/OpenAI) + ElevenLabs TTS
        const agent = new HybridVoiceAgent();
        agentRef.current = agent;
        devLog('[PremiumVoiceInterface] ✅ HybridVoiceAgent created and stored in agentRef');

        // Configuration des callbacks pour recevoir les événements
        agent.setCallbacks({
          onMessage: handleMessage,
          onError: handleError,
          onConnection: handleConnectionChange,
        });

        // Configuration de l'agent Hybrid
        const config: any = {
          systemPrompt,
          sttModel: modelConfig?.deepgramSttModel || "nova-3",
          llmProvider: (modelConfig?.deepgramLlmProvider as "anthropic" | "openai") || "anthropic",
          llmModel: modelConfig?.deepgramLlmModel,
          elevenLabsVoiceId: modelConfig?.elevenLabsVoiceId,
          elevenLabsModelId: modelConfig?.elevenLabsModelId || "eleven_turbo_v2_5",
          // Disable LLM in consultant mode (transcription only)
          disableLLM: consultantMode,
          disableElevenLabsTTS: consultantMode,
        };

        // Établir la connexion WebSocket et démarrer le microphone
        await agent.connect(config);
        await agent.startMicrophone(selectedMicrophoneId || undefined, voiceIsolationEnabled);

        // BUG FIX: If tutorial is active, immediately mute the microphone after starting it
        if (tutorialActiveRef.current && 'setMicrophoneMuted' in agent) {
          devLog('[PremiumVoiceInterface] 🔇 Tutorial active - muting Hybrid agent microphone after start');
          (agent as any).setMicrophoneMuted(true);
        }

        // Configurer la visualisation audio après le démarrage du microphone
        // On crée un stream séparé pour la visualisation (indépendant de l'agent)
        startAudioVisualization();
      } else if (isSpeechmaticsAgent || consultantMode) {
        // Agent Speechmatics : Speechmatics STT + LLM (Anthropic/OpenAI) + ElevenLabs TTS
        // NOTE: Le mode consultant nécessite Speechmatics (seul agent supportant diarization + disableLLM)
        if (consultantMode && !isSpeechmaticsAgent) {
          devLog('[PremiumVoiceInterface] 🎧 Mode consultant - Speechmatics requis pour la diarisation');
        }
        const agent = new SpeechmaticsVoiceAgent();
        agentRef.current = agent;
        devLog('[PremiumVoiceInterface] ✅ SpeechmaticsVoiceAgent created and stored in agentRef', {
          consultantMode,
          disableTTS: consultantMode || modelConfig?.disableElevenLabsTTS,
        });

        // Configuration des callbacks
        agent.setCallbacks({
          onMessage: handleMessage,
          onError: handleError,
          onConnection: handleConnectionChange,
          onSemanticTurn: handleSemanticTelemetry,
          onAudioPlaybackEnd: () => {
            // Resume inactivity timer after TTS audio finishes playing
            const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
            devLog(`[${timestamp}] [PremiumVoiceInterface] 🔊 TTS audio playback ended - resuming inactivity timer`);
            inactivityMonitor.resumeTimerAfterDelay(0);
          },
        });

        // Configuration de l'agent Speechmatics (plus de paramètres que Hybrid)
        // Convert existing messages to conversation history format
        const initialConversationHistory = messages
          .filter(m => m.content && m.content.trim())
          .map(m => ({
            role: m.role === 'assistant' ? 'agent' as const : 'user' as const,
            content: m.content,
          }));

        const config: any = {
          systemPrompt,
          userPrompt, // Template de prompt utilisateur (optionnel)
          promptVariables: (modelConfig as any)?.promptVariables, // Variables pour le rendu du template
          initialConversationHistory, // Pass existing messages for context continuity
          sttLanguage: modelConfig?.speechmaticsSttLanguage || "fr",
          sttOperatingPoint: modelConfig?.speechmaticsSttOperatingPoint || "enhanced",
          sttMaxDelay: modelConfig?.speechmaticsSttMaxDelay || 2.0,
          sttEnablePartials: modelConfig?.speechmaticsSttEnablePartials !== false,
          llmProvider: (modelConfig?.speechmaticsLlmProvider as "anthropic" | "openai") || "anthropic",
          llmModel: modelConfig?.speechmaticsLlmModel,
          elevenLabsVoiceId: modelConfig?.elevenLabsVoiceId,
          elevenLabsModelId: modelConfig?.elevenLabsModelId || "eleven_turbo_v2_5",
          // TTS disabled in consultant mode (AI listens only) or text-only mode (dictation)
          disableElevenLabsTTS: consultantMode || textOnlyMode || modelConfig?.disableElevenLabsTTS || false,
          // LLM responses disabled in consultant mode (transcription only, AI suggests questions separately)
          disableLLM: consultantMode,
          microphoneSensitivity, // Sensibilité du microphone (1.5 par défaut)
          microphoneDeviceId: selectedMicrophoneId || undefined,
          voiceIsolation: voiceIsolationEnabled,
          // Always enable diarization for speaker identification
          sttDiarization: "speaker",
          // In individual mode, filter out non-primary speakers (TV, background conversations)
          enableSpeakerFiltering: !consultantMode,
          // Require user confirmation before establishing primary speaker (prevents locking onto TV/background voices)
          requireSpeakerConfirmation: !consultantMode,
          onSpeakerEstablished: (speaker: string) => {
            devLog(`[PremiumVoiceInterface] 🎤 Primary speaker established: ${speaker}`);
            // Clear confirmation overlay when speaker is established
            setSpeakerPendingConfirmation(null);
          },
          onSpeakerPendingConfirmation: (speaker: string, transcript: string) => {
            devLog(`[PremiumVoiceInterface] 🎤 Speaker ${speaker} pending confirmation: "${transcript}"`);
            setSpeakerPendingConfirmation({ speaker, transcript });
          },
          onSpeakerFiltered: (speaker: string, transcript: string) => {
            devLog(`[PremiumVoiceInterface] 🔇 Filtered speaker ${speaker}: "${transcript}"`);

            // Don't show notification for speakers the user chose to ignore
            if (ignoredSpeakersRef.current.has(speaker)) {
              devLog(`[PremiumVoiceInterface] Speaker ${speaker} was ignored, skipping notification`);
              return;
            }

            // Clear any existing timeout
            if (filteredSpeakerTimeoutRef.current) {
              clearTimeout(filteredSpeakerTimeoutRef.current);
            }

            // Stack transcripts if same speaker, otherwise replace
            setFilteredSpeakerNotification(prev => {
              if (prev && prev.speaker === speaker) {
                // Same speaker - add to stack (max 3 transcripts)
                const newTranscripts = [...prev.transcripts, transcript].slice(-3);
                return { speaker, transcripts: newTranscripts };
              }
              // New speaker - replace
              return { speaker, transcripts: [transcript] };
            });

            // Auto-dismiss after 10 seconds
            // MEMORY LEAK FIX: Clear existing timeout before setting new one
            if (filteredSpeakerTimeoutRef.current) {
              clearTimeout(filteredSpeakerTimeoutRef.current);
            }
            filteredSpeakerTimeoutRef.current = setTimeout(() => {
              setFilteredSpeakerNotification(null);
            }, 10000);
          },
        };

        // Log config for debugging consultant mode
        devLog('[PremiumVoiceInterface] 🔧 Speechmatics config:', {
          disableLLM: config.disableLLM,
          disableElevenLabsTTS: config.disableElevenLabsTTS,
          sttDiarization: config.sttDiarization,
          enableSpeakerFiltering: config.enableSpeakerFiltering,
          consultantMode,
        });

        // Établir la connexion WebSocket et démarrer le microphone
        await agent.connect(config);
        await agent.startMicrophone(selectedMicrophoneId || undefined, voiceIsolationEnabled);

        // BUG FIX: If tutorial is active, immediately mute the microphone after starting it
        // The React state (isMuted) is already true from the tutorial useEffect,
        // but we need to actually mute the Speechmatics agent
        if (tutorialActiveRef.current) {
          devLog('[PremiumVoiceInterface] 🔇 Tutorial active - muting microphone after start');
          agent.setMicrophoneMuted(true);
        }

        // Configurer la visualisation audio
        startAudioVisualization();

        // If no messages exist, generate and speak initial welcome message (DRY with text mode)
        // Also speak existing initial message if it's the only one (created by text mode but never spoken)
        // Skip if isInitializing=true because the /init endpoint will handle initial message generation
        if (!consultantMode && askKey && !isInitializing) {
          if (messages.length === 0) {
            // No messages at all - generate and speak initial message via /respond endpoint
            devLog('[PremiumVoiceInterface] 🎤 No messages - generating initial welcome message');
            try {
              const headers: HeadersInit = { 'Content-Type': 'application/json' };
              if (inviteToken) {
                headers['x-invite-token'] = inviteToken;
              }

              // Use respond endpoint to generate initial AI message (same as text mode)
              // Note: Use 'message' property (not 'content') to match /respond API contract
              const response = await fetch(`/api/ask/${askKey}/respond`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  message: '', // Empty message triggers initial greeting
                  senderType: 'system', // System-triggered initial message
                }),
              });

              if (response.ok) {
                const result = await response.json();
                // Note: /respond returns { message: Message } not { aiResponse: string }
                const aiResponseContent = result.data?.message?.content;
                if (result.success && aiResponseContent) {
                  // If tutorial is showing, store the message to speak later
                  if (tutorialActiveRef.current) {
                    devLog('[PremiumVoiceInterface] 📝 Tutorial active - storing initial message for later');
                    pendingInitialMessageRef.current = aiResponseContent;
                  } else {
                    // Speak the initial message via TTS
                    await agent.speakInitialMessage(aiResponseContent);
                    devLog('[PremiumVoiceInterface] ✅ Initial message spoken');
                  }
                }
              } else {
                devWarn('[PremiumVoiceInterface] Failed to generate initial message:', await response.text());
              }
            } catch (error) {
              devError('[PremiumVoiceInterface] Error generating initial message:', error);
              // Don't fail - voice session can still work without initial message
            }
          } else if (messages.length === 1 && messages[0].role === 'assistant') {
            // Initial message already exists (created by GET /api/ask/[key]) but never spoken
            // This happens when user enters voice mode after page load in individual_parallel mode
            devLog('[PremiumVoiceInterface] 🎤 Initial message exists - speaking via TTS');
            try {
              // If tutorial is showing, store the message to speak later
              if (tutorialActiveRef.current) {
                devLog('[PremiumVoiceInterface] 📝 Tutorial active - storing existing message for later');
                pendingInitialMessageRef.current = messages[0].content;
              } else {
                await agent.speakInitialMessage(messages[0].content);
                devLog('[PremiumVoiceInterface] ✅ Existing initial message spoken');
              }
            } catch (error) {
              devError('[PremiumVoiceInterface] Error speaking existing initial message:', error);
              // Don't fail - voice session can still work without initial message
            }
          }
        }
      } else {
        // Agent Deepgram par défaut : Deepgram STT + LLM + Deepgram TTS (tout-en-un)
        const agent = new DeepgramVoiceAgent();
        agentRef.current = agent;
        devLog('[PremiumVoiceInterface] ✅ DeepgramVoiceAgent created and stored in agentRef');

        // Configuration des callbacks
        agent.setCallbacks({
          onMessage: handleMessage,
          onError: handleError,
          onConnection: handleConnectionChange,
        });

        // Configuration de l'agent Deepgram
        const config: any = {
          systemPrompt,
          sttModel: modelConfig?.deepgramSttModel || "nova-3",
          ttsModel: modelConfig?.deepgramTtsModel || "aura-2-thalia-en",
          llmProvider: (modelConfig?.deepgramLlmProvider as "anthropic" | "openai") || "anthropic",
          llmModel: modelConfig?.deepgramLlmModel,
        };

        // Établir la connexion WebSocket et démarrer le microphone
        await agent.connect(config);
        await agent.startMicrophone(selectedMicrophoneId || undefined, voiceIsolationEnabled);
        
        // Configurer la visualisation audio
        startAudioVisualization();
      }

      setIsMicrophoneActive(true);
      setIsConnecting(false);
      isConnectingRef.current = false;

      // Acquérir le wake lock pour empêcher l'écran de se mettre en veille
      acquireWakeLock();
    } catch (err) {
      devError('[PremiumVoiceInterface] ❌ Connection error:', err);
      setIsConnecting(false);
      isConnectingRef.current = false;
      cleanupAudioAnalysis(true); // Close audio context on connection error

      // Utiliser le message d'erreur amélioré pour les erreurs de permission micro
      const errorMessage = err instanceof Error
        ? getMicrophonePermissionErrorMessage(err)
        : 'Impossible de se connecter au mode vocal.';
      setError(errorMessage);
      handleError(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [systemPrompt, modelConfig, isHybridAgent, isSpeechmaticsAgent, isConnected, handleMessage, handleError, handleConnectionChange, setupAudioAnalysis, cleanupAudioAnalysis, startAudioVisualization, acquireWakeLock]);

  /**
   * Recharge la page après une déconnexion complète
   * 
   * NOTE: window.location.reload() a été supprimé car le cleanup propre est maintenant suffisant.
   * Le reload causait des problèmes quand la connexion WebSocket se fermait de manière inattendue.
   */

  // ===== GESTION DE LA DÉCONNEXION =====
  /**
   * Déconnecte complètement l'agent vocal et nettoie toutes les ressources
   * 
   * Cette fonction effectue un nettoyage complet dans l'ordre suivant :
   * 1. Arrête le timeout de détection de parole
   * 2. Nettoie l'analyse audio (ferme l'AudioContext)
   * 3. Déconnecte l'agent (arrête le microphone et ferme le WebSocket)
   * 4. Attend un délai pour que le navigateur libère les ressources
   * 5. Réinitialise tous les états
   * 6. Vide les buffers de streaming interim
   * 
   * CRITIQUE : L'ordre des opérations est important pour éviter les fuites de ressources.
   */
  const disconnect = useCallback(async () => {
    // CRITIQUE: Empêcher les déconnexions multiples simultanées
    if (isDisconnectingRef.current) {
      devWarn('[PremiumVoiceInterface] ⚠️ Disconnect already in progress, ignoring duplicate call');
      return;
    }

    isDisconnectingRef.current = true;
    devLog('[PremiumVoiceInterface] 🔌 Disconnecting completely...');
    
    try {
      // Étape 1: Arrêter le timeout de détection de parole
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = null;
      }
      
      // Étape 2: Nettoyer l'analyse audio EN PREMIER (arrête le stream séparé de visualisation)
      // Cela garantit que le stream de visualisation est arrêté avant le stream de l'agent
      cleanupAudioAnalysis(true); // Fermer l'AudioContext lors de la déconnexion

      // Étape 2b: Libérer le wake lock
      releaseWakeLock();
      wasMutedByVisibilityRef.current = false;

      // Étape 3: Déconnecter l'agent (arrête le stream microphone de l'agent ET le WebSocket)
      // CRITIQUE: Attendre que la déconnexion de l'agent soit terminée pour garantir la libération des ressources
      if (agentRef.current) {
        try {
          // La déconnexion de l'agent va :
          // - Arrêter le microphone
          // - Fermer le WebSocket
          // - Vider toutes les queues
          // - Arrêter la lecture audio
          // - Appeler enumerateDevices() pour forcer le nettoyage du navigateur
          await agentRef.current.disconnect();
          devLog('[PremiumVoiceInterface] ✅ Agent disconnected (microphone + websocket)');
        } catch (error) {
          devWarn('[PremiumVoiceInterface] Error disconnecting agent:', error);
        }
        agentRef.current = null;
        devLog('[PremiumVoiceInterface] 🗑️ agentRef.current set to null');
      }

      // Étape 4: Délai supplémentaire pour que le navigateur libère toutes les ressources microphone
      // Cela aide à éviter que l'indicateur rouge du microphone reste actif
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Étape 5: Réinitialiser tous les états
      setIsConnected(false);
      setIsMicrophoneActive(false);
      setIsMuted(false);
      setIsSpeaking(false);
      setError(null);

      // Étape 6: Réinitialiser les buffers de streaming
      // PERF FIX: Clear throttle timers on disconnect
      if (interimUserThrottleTimerRef.current) {
        clearTimeout(interimUserThrottleTimerRef.current);
        interimUserThrottleTimerRef.current = null;
      }
      if (interimAssistantThrottleTimerRef.current) {
        clearTimeout(interimAssistantThrottleTimerRef.current);
        interimAssistantThrottleTimerRef.current = null;
      }
      pendingInterimUserRef.current = null;
      pendingInterimAssistantRef.current = null;
      setInterimUser(null);
      setInterimAssistant(null);
      setPendingFinalUser(null);

      // Étape 7: MEMORY LEAK FIX - Clear unbounded refs to prevent memory accumulation
      // These refs grow during the session and must be cleared on disconnect
      knownSpeakersRef.current.clear();
      speakerOrderRef.current.clear();
      completingStepsRef.current.clear();
      ignoredSpeakersRef.current.clear();
      // Reset consultant speaker ref for fresh detection on next connect
      consultantSpeakerRef.current = null;

      devLog('[PremiumVoiceInterface] ✅ Complete disconnection finished - websocket and microphone are OFF');
    } finally {
      // Toujours réinitialiser le flag de déconnexion, même en cas d'erreur
      isDisconnectingRef.current = false;
    }
  }, [cleanupAudioAnalysis, releaseWakeLock]);

  // ===== HANDLERS D'ÉDITION DE MESSAGE =====
  const handleStartEdit = useCallback((messageId: string, currentContent: string) => {
    devLog('[PremiumVoiceInterface] ✏️ Starting edit for message:', messageId);
    // Save current mute state and mute the mic
    wasMutedBeforeEditRef.current = isMuted;
    if (!isMuted) {
      // Mute the mic while editing
      const agent = agentRef.current;
      if (agent && isConnected) {
        if (agent instanceof SpeechmaticsVoiceAgent) {
          agent.setMicrophoneMuted(true);
        }
        setIsMuted(true);
        isMutedRef.current = true;
      }
    }
    setEditingMessageId(messageId);
    setEditContent(currentContent);
  }, [isMuted, isConnected]);

  const handleCancelEdit = useCallback(() => {
    devLog('[PremiumVoiceInterface] ❌ Cancelling edit');
    setEditingMessageId(null);
    setEditContent("");
    // Restore mic state if it wasn't muted before
    if (!wasMutedBeforeEditRef.current) {
      const agent = agentRef.current;
      if (agent && isConnected) {
        if (agent instanceof SpeechmaticsVoiceAgent) {
          agent.setMicrophoneMuted(false);
        }
        setIsMuted(false);
        isMutedRef.current = false;
      }
    }
  }, [isConnected]);

  const handleSubmitEdit = useCallback(async () => {
    if (!editingMessageId || !editContent.trim() || !onEditMessage) return;

    devLog('[PremiumVoiceInterface] 💾 Submitting edit for message:', editingMessageId);
    setIsSubmittingEdit(true);

    const trimmedContent = editContent.trim();

    try {
      await onEditMessage(editingMessageId, trimmedContent);
      setEditingMessageId(null);
      setEditContent("");

      // Trigger AI response for the edited message in voice mode
      // The agent will generate a response and speak it via TTS
      const agent = agentRef.current;
      if (agent && 'injectUserMessageAndRespond' in agent) {
        devLog('[PremiumVoiceInterface] 🎯 Triggering agent response for edited message');
        try {
          await (agent as SpeechmaticsVoiceAgent | HybridVoiceAgent).injectUserMessageAndRespond(trimmedContent);
        } catch (agentError) {
          devError('[PremiumVoiceInterface] ❌ Error triggering agent response:', agentError);
        }
      }

      // Keep mic muted - the AI will respond and we want to let the user hear it
      // The mic will stay muted, user can unmute when ready
    } catch (error) {
      devError('[PremiumVoiceInterface] ❌ Error submitting edit:', error);
    } finally {
      setIsSubmittingEdit(false);
    }
  }, [editingMessageId, editContent, onEditMessage]);

  // ===== TUTORIAL HANDLERS =====
  const handleTutorialComplete = useCallback(async () => {
    localStorage.setItem('voiceTutorial_hasSeenOnboarding', 'true');
    tutorialActiveRef.current = false;
    setShowTutorial(false);
    setTutorialStep(0);

    const agent = agentRef.current;

    // Speak the pending initial message FIRST (before unmuting)
    const pendingMessage = pendingInitialMessageRef.current;
    if (pendingMessage && agent instanceof SpeechmaticsVoiceAgent && agent.isConnected()) {
      devLog('[PremiumVoiceInterface] 🎤 Tutorial complete - speaking pending initial message');
      try {
        await agent.speakInitialMessage(pendingMessage);
        devLog('[PremiumVoiceInterface] ✅ Pending initial message spoken');
      } catch (error) {
        devError('[PremiumVoiceInterface] Error speaking pending message:', error);
      }
      pendingInitialMessageRef.current = null;
    }

    // Unmute the mic AFTER the initial message is spoken
    setIsMuted(false);
    isMutedRef.current = false;
    if (agent instanceof SpeechmaticsVoiceAgent) {
      agent.setMicrophoneMuted(false);
    }

    // Start the inactivity timer now that the tutorial is complete
    // This ensures the timer only starts counting after the user has finished the tutorial
    inactivityMonitor.resetTimer();
  }, [inactivityMonitor]);

  const handleTutorialNext = useCallback(() => {
    setTutorialStep(prev => Math.min(prev + 1, 3));
  }, []);

  const handleTutorialPrev = useCallback(() => {
    setTutorialStep(prev => Math.max(prev - 1, 0));
  }, []);

  const handleCloseClick = useCallback(async () => {
    devLog('[PremiumVoiceInterface] ❌ Close button clicked - disconnecting everything');
    try {
      await disconnect();
    } catch (error) {
      devWarn('[PremiumVoiceInterface] ⚠️ Close disconnect failed, forcing close anyway:', error);
    }
    // NOTE: No more window.location.reload() - proper cleanup is sufficient
    onClose();
  }, [disconnect, onClose]);

  const toggleMute = useCallback(async () => {
    devLog('[PremiumVoiceInterface] 🎤 toggleMute called', {
      isMuted,
      isConnected,
      isMicrophoneActive,
      hasAgent: !!agentRef.current
    });

    const agent = agentRef.current;
    if (!agent) {
      devLog('[PremiumVoiceInterface] ⚠️ No agent available, cannot toggle mute');
      return;
    }

    if (isMuted) {
      // User wants to unmute - need to reconnect WebSocket and restart microphone
      devLog('[PremiumVoiceInterface] 🔊 Unmuting - reconnecting WebSocket and restarting microphone...');
      isMutedRef.current = false;
      setIsMuted(false);
      setIsConnecting(true);

      try {
        // Reconnect WebSocket first (since stopMicrophone() closed it)
        if (agent instanceof SpeechmaticsVoiceAgent) {
          agent.setMicrophoneMuted(false);
          setIsMicrophoneActive(true);
          setIsConnecting(false);
          startAudioVisualization();
          devLog('[PremiumVoiceInterface] ✅ Speechmatics unmuted - stream resumed');
          return;
        } else if (isHybridAgent && agent instanceof HybridVoiceAgent) {
          const config: any = {
            systemPrompt,
            sttModel: modelConfig?.deepgramSttModel || "nova-3",
            llmProvider: (modelConfig?.deepgramLlmProvider as "anthropic" | "openai") || "anthropic",
            llmModel: modelConfig?.deepgramLlmModel,
            elevenLabsVoiceId: modelConfig?.elevenLabsVoiceId,
            elevenLabsModelId: modelConfig?.elevenLabsModelId || "eleven_turbo_v2_5",
          };
          await agent.connect(config);
          await agent.startMicrophone(selectedMicrophoneId || undefined, voiceIsolationEnabled);
        } else if (agent instanceof DeepgramVoiceAgent) {
          const config: any = {
            systemPrompt,
            sttModel: modelConfig?.deepgramSttModel || "nova-3",
            ttsModel: modelConfig?.deepgramTtsModel || "aura-2-thalia-en",
            llmProvider: (modelConfig?.deepgramLlmProvider as "anthropic" | "openai") || "anthropic",
            llmModel: modelConfig?.deepgramLlmModel,
          };
          await agent.connect(config);
          await agent.startMicrophone(selectedMicrophoneId || undefined, voiceIsolationEnabled);
        }

        // If the user re-muted while we were reconnecting, stop immediately
        if (isMutedRef.current) {
          if (agent instanceof HybridVoiceAgent || agent instanceof DeepgramVoiceAgent) {
            agent.stopMicrophone();
          }
          return;
        }

        setIsMicrophoneActive(true);
        setIsConnecting(false);
        startAudioVisualization();
        devLog('[PremiumVoiceInterface] ✅ Unmuted successfully - WebSocket reconnected and microphone active');
      } catch (err) {
        devError('[PremiumVoiceInterface] ❌ Error reconnecting on unmute:', err);
        isMutedRef.current = true;
        setIsMuted(true);
        setIsMicrophoneActive(false);
        setIsConnecting(false);
        handleError(err instanceof Error ? err : new Error(String(err)));
      }
    } else {
      // User wants to mute - stop sending audio chunks but keep WebSocket open for TTS
      devLog('[PremiumVoiceInterface] 🔇 Muting - stopping microphone input but keeping WebSocket open for responses...');
      isMutedRef.current = true;
      setIsMuted(true);
      setIsMicrophoneActive(false);
      setIsSpeaking(false);

      // FIX: Resume inactivity timer when user manually mutes
      // This prevents the timer from staying paused indefinitely if user mutes while assistant is speaking
      inactivityMonitor.resumeTimerAfterDelay(0);

      try {
        if (agent instanceof SpeechmaticsVoiceAgent) {
          // Just mute the microphone - WebSocket stays open for receiving agent responses
          agent.setMicrophoneMuted(true);
          // Stop audio visualization but keep audio context for TTS playback
          cleanupAudioAnalysis(false); // false = don't close audio context
        } else {
          // For other agents, stop microphone but keep connection for responses
          await Promise.all([
            // Stop visualization stream
            Promise.resolve(cleanupAudioAnalysis(false)), // Keep audio context for TTS
            // Stop agent microphone stream (but keep connection for TTS)
            (async () => {
              if (agent instanceof HybridVoiceAgent || agent instanceof DeepgramVoiceAgent) {
                agent.stopMicrophone();
              }
            })()
          ]);
        }
        devLog('[PremiumVoiceInterface] ✅ Microphone muted - WebSocket remains open for agent responses');
      } catch (error) {
        devError('[PremiumVoiceInterface] ❌ Error muting microphone:', error);
      }
    }
  }, [isMuted, isConnected, isMicrophoneActive, isHybridAgent, isSpeechmaticsAgent, systemPrompt, modelConfig, selectedMicrophoneId, voiceIsolationEnabled, cleanupAudioAnalysis, startAudioVisualization, handleError, inactivityMonitor]);

  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnectRef = useRef(disconnect);
  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const cleanupAudioAnalysisRef = useRef(cleanupAudioAnalysis);
  useEffect(() => {
    cleanupAudioAnalysisRef.current = cleanupAudioAnalysis;
  }, [cleanupAudioAnalysis]);

  // Load microphone devices on mount
  useEffect(() => {
    loadMicrophoneDevices();
  }, [loadMicrophoneDevices]);

  // Close microphone settings when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showMicrophoneSettings && !target.closest('.microphone-settings-container')) {
        setShowMicrophoneSettings(false);
      }
    };

    if (showMicrophoneSettings) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMicrophoneSettings]);

  // Auto-connect on mount
  useEffect(() => {
    // Flag pour détecter si le composant se démonte pendant l'opération async
    let isMounted = true;

    const doConnect = async () => {
      if (!isMounted) {
        devLog('[PremiumVoiceInterface] ⚠️ Component unmounted before connect started, aborting');
        return;
      }

      // Si une connexion/déconnexion est en cours, attendre qu'elle se termine puis réessayer
      if (isConnectingRef.current || isDisconnectingRef.current) {
        devLog('[PremiumVoiceInterface] ⏱️ Connection or disconnect in progress, waiting 1s then retrying...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!isMounted) {
          devLog('[PremiumVoiceInterface] ⚠️ Component unmounted while waiting, aborting');
          return;
        }

        // Réessayer après avoir attendu
        return doConnect();
      }

      devLog('[PremiumVoiceInterface] ⏱️ Starting connection immediately...');
      await connectRef.current?.();

      if (!isMounted) {
        devLog('[PremiumVoiceInterface] ⚠️ Component unmounted during connect, cleaning up orphaned agent');
        // Si le composant s'est démonté pendant connect, nettoyer l'agent orphelin
        if (agentRef.current) {
          try {
            await agentRef.current.disconnect();
            agentRef.current = null;
          } catch (err) {
            devError('[PremiumVoiceInterface] Error cleaning up orphaned agent:', err);
          }
        }
      }
    };

    // CRITICAL: Skip first mount in StrictMode (development only)
    // StrictMode deliberately double-mounts components to catch bugs
    // We only want to connect on the second mount to avoid orphaned agents
    // In production (no StrictMode), connect immediately on first mount
    if (strictModeFirstMountRef.current) {
      devLog('[PremiumVoiceInterface] 🔄 First mount detected, setting timeout to detect StrictMode...');
      strictModeFirstMountRef.current = false;

      // Use a small timeout to detect if we're in StrictMode
      // If StrictMode is active, the component will unmount/remount immediately
      // If not (production), the timeout will fire and we'll connect
      const timeoutId = setTimeout(() => {
        devLog('[PremiumVoiceInterface] 🚀 No second mount detected (production mode), auto-connecting now...', {
          hasAgent: !!agentRef.current,
          isConnected,
          isConnecting: isConnectingRef.current,
          isDisconnecting: isDisconnectingRef.current
        });
        doConnect();
      }, 50);

      return () => {
        isMounted = false;
        clearTimeout(timeoutId);
      };
    }

    devLog('[PremiumVoiceInterface] 🚀 Component mounted (second mount from StrictMode), auto-connecting...', {
      hasAgent: !!agentRef.current,
      isConnected,
      isConnecting: isConnectingRef.current,
      isDisconnecting: isDisconnectingRef.current
    });

    doConnect();

    return () => {
      isMounted = false;
      devLog('[PremiumVoiceInterface] 🧹 Component unmounting, cleaning up all streams...', {
        hadAgent: !!agentRef.current,
        wasConnected: isConnected
      });
      void disconnectRef.current?.();
      cleanupAudioAnalysisRef.current?.(true); // Close audio context on unmount
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
      }
      if (filteredSpeakerTimeoutRef.current) {
        clearTimeout(filteredSpeakerTimeoutRef.current);
      }
      // PERF FIX: Clear throttle timers on unmount
      if (interimUserThrottleTimerRef.current) {
        clearTimeout(interimUserThrottleTimerRef.current);
      }
      if (interimAssistantThrottleTimerRef.current) {
        clearTimeout(interimAssistantThrottleTimerRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when component mounts (voice mode activated)
  useEffect(() => {
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      // Use scrollTop instead of scrollIntoView to avoid iOS Safari viewport lifting bug
      // scrollIntoView can affect the window scroll position when inside a fixed container
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 100);
  }, []);

  /**
   * Affichage des messages : timeline finale + bulle de streaming
   * - props.messages = source de vérité (messages finaux)
   * - interimAssistant (et optionnellement interimUser) = bulle en cours
   * - Tous les messages sont triés par timestamp pour garantir l'ordre chronologique
   */
  const displayMessages: VoiceMessage[] = useMemo(() => {
    // Deduplicate base messages by messageId (race condition between optimistic updates and realtime)
    const seenIds = new Set<string>();
    const base: VoiceMessage[] = [];

    for (const msg of messages || []) {
      const messageId = msg.messageId;
      // Skip duplicates - keep the first occurrence
      if (messageId && seenIds.has(messageId)) {
        continue;
      }
      if (messageId) {
        seenIds.add(messageId);
      }

      base.push({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || new Date().toISOString(),
        messageId,
        isInterim: false,
        speaker: (msg.metadata as { speaker?: string })?.speaker, // Speaker from diarization
      });
    }

    // Note: interimUser is now displayed in the bottom status area, not in the message list
    // This prevents the "jump" effect when interim messages become final

    // Add pendingFinalUser to avoid "blanc" gap between partial disappearing and final appearing
    // This shows the final user message immediately while waiting for DB confirmation
    if (pendingFinalUser) {
      const pendingId = pendingFinalUser.messageId || `pending-user-${Date.now()}`;
      // Only add if not already in base messages (from props)
      if (!seenIds.has(pendingId)) {
        base.push({
          ...pendingFinalUser,
          timestamp: pendingFinalUser.timestamp || new Date().toISOString(),
          messageId: pendingId,
          isInterim: false, // Show as final, not streaming
        });
        seenIds.add(pendingId);
      }
    }

    if (interimAssistant) {
      const interimAssistantId = interimAssistant.messageId || `interim-assistant-${Date.now()}`;
      // Only add if not already finalized in base messages
      if (!seenIds.has(interimAssistantId)) {
        base.push({
          ...interimAssistant,
          timestamp: interimAssistant.timestamp || new Date().toISOString(),
          messageId: interimAssistantId,
          isInterim: true,
        });
      }
    }

    // Tri par timestamp pour garantir l'ordre chronologique
    return base.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
  }, [messages, interimAssistant, pendingFinalUser]);

  const semanticStatusText = useMemo(() => {
    if (!semanticTelemetry) {
      return null;
    }
    const probability =
      typeof semanticTelemetry.probability === 'number'
        ? `${(semanticTelemetry.probability * 100).toFixed(1)}%`
        : '—';
    const threshold =
      typeof semanticTelemetry.threshold === 'number'
        ? `${(semanticTelemetry.threshold * 100).toFixed(1)}%`
        : null;
    const reason = semanticTelemetry.reason ? semanticTelemetry.reason.replace(/-/g, ' ') : null;

    switch (semanticTelemetry.decision) {
      case 'hold':
        return `Semantic hold ${probability}${threshold ? ` < ${threshold}` : ''}${
          reason ? ` – ${reason}` : ''
        }`;
      case 'dispatch':
        return `Semantic release ${probability}`;
      case 'fallback':
        return `Semantic fallback${reason ? ` – ${reason}` : ''}`;
      default:
        return null;
    }
  }, [semanticTelemetry]);

  // Auto-scroll when new messages arrive OR when last message content changes (interim updates)
  const previousLengthRef = useRef(0);
  const previousLastContentRef = useRef<string>('');
  useEffect(() => {
    const lastMessage = displayMessages[displayMessages.length - 1];
    const lastContent = lastMessage?.content || '';

    const hasNewMessages = displayMessages.length > previousLengthRef.current;
    const lastMessageChanged = lastContent !== previousLastContentRef.current;

    previousLengthRef.current = displayMessages.length;
    previousLastContentRef.current = lastContent;

    if ((hasNewMessages || lastMessageChanged) && messagesContainerRef.current) {
      // Use scrollTop directly instead of scrollIntoView to avoid iOS Safari viewport lifting bug
      // scrollIntoView can affect the window scroll position when inside a fixed container
      const previousScrollTop = messagesContainerRef.current.scrollTop;
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;

      // Get the new scroll position and notify hide/show hook
      // Use requestAnimationFrame to ensure the scroll has completed
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          const newScrollTop = messagesContainerRef.current.scrollTop;
          // Programmatic scroll doesn't trigger DOM scroll events, so manually notify
          // the hide/show hook that we scrolled down (positive delta = hide header)
          if (newScrollTop > previousScrollTop) {
            handleScrollHideShow(newScrollTop, newScrollTop - previousScrollTop);
            // Update lastScrollTopRef so manual scrolls calculate correct delta
            lastScrollTopRef.current = newScrollTop;
          }
        }
      });
    }
  }, [displayMessages, handleScrollHideShow]);

  /**
   * NEW PURE REACT TEXT COMPONENT
   * Uses Framer Motion for smooth animations without DOM manipulation
   * For interim messages: plain text to avoid flickering
   * For final messages: ReactMarkdown with GFM and syntax highlighting
   */
  function AnimatedText({
    content,
    isInterim = false
  }: {
    content: string;
    isInterim?: boolean;
  }) {
    // For interim messages: use plain text to avoid flickering during streaming
    if (isInterim) {
      return (
        <motion.p
          key={content.substring(0, 50)}
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="text-sm leading-relaxed whitespace-pre-wrap font-normal tracking-wide opacity-70 italic text-white/60"
          style={{ minHeight: "1em" }}
        >
          {content}
        </motion.p>
      );
    }

    // For final messages: use ReactMarkdown for proper formatting
    return (
      <motion.div
        key={content.substring(0, 50)}
        initial={{ opacity: 0.8 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="text-sm leading-relaxed font-normal tracking-wide prose prose-sm prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 [&>*]:text-white [&_p]:text-white [&_li]:text-white [&_strong]:text-white [&_em]:text-white"
        style={{ minHeight: "1em" }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            a: ({ node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 underline" />
            ),
            code: ({ node, className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || '');
              return match ? (
                <code className={className} {...props}>
                  {children}
                </code>
              ) : (
                <code className="px-1 py-0.5 rounded bg-white/20 text-white" {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </motion.div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/* In-app browser warning overlay */}
      {inAppBrowserInfo?.isInApp && (
        <div className="absolute inset-0 z-[100] bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 flex items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-500/20 flex items-center justify-center">
              <ExternalLink className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-3">
              Navigateur non compatible
            </h2>
            <p className="text-white/70 text-sm mb-6">
              {inAppBrowserInfo.appName
                ? `Le navigateur intégré de ${inAppBrowserInfo.appName} ne supporte pas le microphone.`
                : "Ce navigateur intégré ne supporte pas le microphone."}
              {' '}Ouvrez ce lien dans Safari ou Chrome pour utiliser le mode vocal.
            </p>
            <div className="space-y-3">
              <Button
                onClick={openInExternalBrowser}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Ouvrir dans Safari
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href);
                  alert('Lien copié !');
                }}
                className="w-full border-white/20 text-white hover:bg-white/10"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copier le lien
              </Button>
              <Button
                variant="ghost"
                onClick={() => setInAppBrowserInfo({ isInApp: false, appName: null })}
                className="w-full text-white/50 hover:text-white hover:bg-white/5"
              >
                Essayer quand même
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deep blue gradient background */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950"
        style={{ zIndex: 0 }}
      />

      {/* Light blue glow effects */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(circle at 20% 30%, rgba(96, 165, 250, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 70%, rgba(59, 130, 246, 0.12) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, rgba(147, 197, 253, 0.1) 0%, transparent 60%),
            radial-gradient(circle at 10% 80%, rgba(96, 165, 250, 0.08) 0%, transparent 40%)
          `,
          zIndex: 1,
        }}
      />

      {/* Animated gradient overlay that responds to voice */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(circle at 50% 50%, rgba(147, 197, 253, 0.25) 0%, transparent 60%)
          `,
          zIndex: 2,
        }}
        animate={{
          opacity: isSpeaking ? 0.8 : 0,
          scale: isSpeaking ? 1.2 : 1,
        }}
        transition={{
          duration: 0.3,
          ease: "easeOut",
        }}
      />

      {/* Content */}
      <div className="relative z-20 h-full flex flex-col">
        {/* Compact top bar - hides on scroll down, shows on scroll up */}
        <motion.div
          className="flex items-center justify-between px-3 py-2 pt-3"
          initial={false}
          animate={{
            opacity: isHeaderHidden ? 0 : 1,
            y: isHeaderHidden ? -20 : 0,
            height: isHeaderHidden ? 0 : 'auto',
            paddingTop: isHeaderHidden ? 0 : '0.75rem',
            paddingBottom: isHeaderHidden ? 0 : '0.5rem',
          }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
        >
          <div className="flex items-center gap-2">
            {user?.fullName && (
              <div className="h-7 w-7 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white font-medium text-xs">
                {user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="text-white/80 text-sm font-medium">{getUserName()}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative microphone-settings-container">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowMicrophoneSettings(!showMicrophoneSettings)}
                className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/15 rounded-full"
                title="Paramètres"
              >
                <Settings className="h-4 w-4" />
              </Button>
              {showMicrophoneSettings && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-slate-900/95 backdrop-blur-xl border border-blue-400/20 rounded-lg shadow-2xl p-4 z-50 microphone-settings-container">
                  <h4 className="text-white text-sm font-semibold mb-3">Paramètres audio</h4>

                  {/* Microphone selection */}
                  <div className="mb-3">
                    <label className="text-white/70 text-xs block mb-1">Microphone</label>
                    <select
                      value={selectedMicrophoneId || ''}
                      onChange={(e) => {
                        setSelectedMicrophoneId(e.target.value || null);
                        savePreferences();
                      }}
                      disabled={isConnected}
                      className="w-full bg-white/10 text-white text-xs rounded px-2 py-1.5 border border-white/20 disabled:opacity-50"
                    >
                      <option value="">Par défaut</option>
                      {availableMicrophones.map((mic) => (
                        <option key={mic.deviceId} value={mic.deviceId}>
                          {mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Sensitivity slider */}
                  <div className="mb-3">
                    <label className="text-white/70 text-xs block mb-1">
                      Sensibilité: {microphoneSensitivity.toFixed(1)}x
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="3"
                      step="0.1"
                      value={microphoneSensitivity}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        setMicrophoneSensitivity(value);
                        savePreferences();
                        if (isConnected && agentRef.current instanceof SpeechmaticsVoiceAgent) {
                          agentRef.current.setMicrophoneSensitivity?.(value);
                        }
                      }}
                      className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Voice isolation toggle */}
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-white/70 text-xs">Isolation vocale</span>
                    <button
                      onClick={() => {
                        setVoiceIsolationEnabled(!voiceIsolationEnabled);
                        savePreferences();
                      }}
                      disabled={isConnected}
                      className={cn(
                        "w-10 h-5 rounded-full transition-colors",
                        voiceIsolationEnabled ? "bg-blue-500" : "bg-white/20",
                        isConnected && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 bg-white rounded-full transition-transform mx-0.5",
                        voiceIsolationEnabled && "translate-x-5"
                      )} />
                    </button>
                  </div>

                  {/* Text only mode toggle */}
                  {isSpeechmaticsAgent && !modelConfig?.disableElevenLabsTTS && (
                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                      <span className="text-white/70 text-xs">Réponses écrites</span>
                      <button
                        onClick={() => {
                          const newValue = !textOnlyMode;
                          setTextOnlyMode(newValue);
                          if (agentRef.current instanceof SpeechmaticsVoiceAgent) {
                            agentRef.current.setTextOnlyMode(newValue);
                          }
                        }}
                        className={cn(
                          "w-10 h-5 rounded-full transition-colors",
                          textOnlyMode ? "bg-blue-500" : "bg-white/20"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 bg-white rounded-full transition-transform mx-0.5",
                          textOnlyMode && "translate-x-5"
                        )} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCloseClick}
              className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/15 rounded-full"
              title="Fermer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>

        {/* Progress bar - also hides on scroll down */}
        {hasConversationSteps && (
          <motion.div
            className="px-3 pb-1"
            initial={false}
            animate={{
              opacity: isHeaderHidden ? 0 : 1,
              height: isHeaderHidden ? 0 : 'auto',
              paddingBottom: isHeaderHidden ? 0 : '0.25rem',
            }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <ConversationProgressBar
              steps={conversationSteps}
              currentStepId={currentConversationStepId ?? ''}
              elapsedMinutes={elapsedMinutes}
              isTimerPaused={isTimerPaused}
              isTimerLoading={isTimerLoading}
              onTogglePause={onTogglePause}
              onResetTimer={onResetTimer}
              expectedDurationMinutes={expectedDurationMinutes}
              variant="dark"
            />
          </motion.div>
        )}

        {/* Messages area with floating bubbles */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
        >
          {displayMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full space-y-4">
              <p className="text-white/60 text-sm mb-4">Try asking...</p>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="w-full max-w-md space-y-3"
              >
                {[
                  "What are the risks and potential benefits of using electric vehicles in urban areas?",
                  "Is there a connection between social media and the quality of sleep?",
                  "Is there a connection between sleep deprivation and increased risk for heart disease or other chronic conditions?",
                ].map((suggestion, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + idx * 0.1 }}
                    className="rounded-2xl px-4 py-3 backdrop-blur-xl bg-white/10 text-white/90 shadow-lg"
                    style={{
                      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                    }}
                  >
                    <p className="text-sm leading-relaxed">{suggestion}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}
          <AnimatePresence mode="sync" initial={false}>
            {displayMessages.map((message, idx) => {
              const messageKey = message.messageId || `${message.role}-${idx}-${message.timestamp}`;
              const isStreamingAssistant = message.isInterim && message.role === "assistant";
              const isUser = message.role === "user";
              const isEditing = editingMessageId === message.messageId;
              // Only allow editing if message has a real database ID (not a temp-xxx ID that hasn't been persisted yet)
              const hasRealId = message.messageId && !message.messageId.startsWith('temp-');
              const canEdit = isUser && !message.isInterim && hasRealId && onEditMessage;

              // Detect step completion marker (handles markdown formatting like **STEP_COMPLETE:**)
              // Also check metadata for completedStepId (set when message is persisted after streaming)
              const { hasMarker: hasMarkerInContent, stepId: stepIdFromContent } = detectStepComplete(message.content);

              // FIX: Check metadata for completedStepId (persisted messages have marker cleaned but metadata preserved)
              const stepIdFromMetadata = message.metadata?.completedStepId as string | null;

              // Use marker from content (during streaming) or metadata (after persistence)
              const hasStepComplete = hasMarkerInContent || !!stepIdFromMetadata;
              const completedStepId = stepIdFromContent || stepIdFromMetadata;

              // Find the completed step in conversation plan
              const completedStep = hasStepComplete && conversationPlan
                ? completedStepId
                  ? conversationPlan.plan_data.steps.find(step => step.id === completedStepId)
                  : conversationPlan.plan_data.steps.find(step => step.status === 'active')
                : undefined;

              // Find step number (1-based index)
              const stepNumber = completedStep && conversationPlan
                ? conversationPlan.plan_data.steps.findIndex(step => step.id === completedStep.id) + 1
                : undefined;

              // Consultant mode: determine if this message is from the current user (for alignment)
              // Check if the speaker is mapped to a participant whose userId matches currentUserId
              const isCurrentUserMessage = (() => {
                if (!consultantMode || !message.speaker || !currentUserId) return false;
                const mapping = speakerMappings.find(m => m.speaker === message.speaker);
                if (!mapping || !mapping.participantId) return false;
                const participant = participants.find(p => p.id === mapping.participantId);
                return participant?.userId === currentUserId;
              })();
              // Get a human-readable speaker label from the mapping
              const getSpeakerLabel = (speaker: string | undefined): string => {
                if (!speaker) return '';
                // Look up the speaker in the mappings first (includes consultant)
                const mapping = speakerMappings.find(m => m.speaker === speaker);
                if (mapping) {
                  if (!mapping.shouldTranscribe) return 'Ignored';
                  return mapping.participantName;
                }
                if (speaker === 'UU') return 'Inconnu';
                // Fallback: Convert S1, S2, etc. to "Speaker 1", "Speaker 2" (pending assignment)
                const match = speaker.match(/^S(\d+)$/);
                if (match) return `Speaker ${match[1]}`;
                return speaker;
              };

              return (
                <motion.div
                  key={messageKey}
                  initial={false}
                  animate={{ opacity: 1 }}
                  transition={{
                    duration: 0.1,
                    ease: "easeOut",
                  }}
                  className={cn(
                    "flex flex-col",
                    // In consultant mode, current user's messages on right, others on left
                    consultantMode
                      ? (isCurrentUserMessage ? "items-end" : "items-start")
                      : (isUser ? "items-end" : "items-start")
                  )}
                >
                  {/* Speaker label in consultant mode with edit capability */}
                  {consultantMode && message.speaker && !message.isInterim && (
                    <div className={cn(
                      "text-xs mb-1 px-2 flex items-center gap-1 group/speaker",
                      isCurrentUserMessage ? "justify-end" : "justify-start"
                    )}>
                      {editingSpeaker === message.speaker ? (
                        // Dropdown for reassigning speaker
                        <div className="relative">
                          <div className="flex flex-col gap-1 bg-slate-900/95 backdrop-blur-xl rounded-lg border border-blue-400/20 shadow-xl p-1 min-w-[160px]">
                            {/* Existing participants */}
                            {participants?.filter(p => {
                              // Filter out participants already assigned to other speakers
                              const assignedToOther = speakerMappings.some(
                                m => m.participantId === p.id && m.speaker !== message.speaker
                              );
                              return !assignedToOther;
                            }).map(p => (
                              <button
                                key={p.id}
                                onClick={() => handleSpeakerReassign(message.speaker!, {
                                  participantId: p.id,
                                  participantName: p.name,
                                  shouldTranscribe: true,
                                })}
                                className="flex items-center gap-2 px-2 py-1.5 text-left text-white/90 hover:bg-white/10 rounded transition-colors text-xs"
                              >
                                <span className="truncate">{p.name}</span>
                              </button>
                            ))}
                            {/* Separator */}
                            {participants && participants.length > 0 && (
                              <div className="border-t border-white/10 my-1" />
                            )}
                            {/* Ignore option */}
                            <button
                              onClick={() => handleSpeakerReassign(message.speaker!, {
                                participantId: null,
                                participantName: 'Ignored',
                                shouldTranscribe: false,
                              })}
                              className="flex items-center gap-2 px-2 py-1.5 text-left text-red-400 hover:bg-red-500/10 rounded transition-colors text-xs"
                            >
                              <UserX className="h-3 w-3" />
                              <span>Ignorer ce speaker</span>
                            </button>
                            {/* Cancel */}
                            <button
                              onClick={() => setEditingSpeaker(null)}
                              className="flex items-center gap-2 px-2 py-1.5 text-left text-white/60 hover:bg-white/10 rounded transition-colors text-xs"
                            >
                              <X className="h-3 w-3" />
                              <span>Annuler</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Speaker label with edit button - entire area clickable
                        <button
                          onClick={() => setEditingSpeaker(message.speaker!)}
                          className={cn(
                            "flex items-center gap-1 px-1.5 py-0.5 -mx-1.5 rounded hover:bg-white/10 transition-colors cursor-pointer",
                            isCurrentUserMessage ? "text-blue-300" : "text-white/60"
                          )}
                          title="Changer l'utilisateur"
                        >
                          <span>{getSpeakerLabel(message.speaker)}</span>
                          <ChevronDown className="h-3 w-3 opacity-0 group-hover/speaker:opacity-100 transition-opacity" />
                        </button>
                      )}
                    </div>
                  )}
                  {/* Step completion indicator - shown BEFORE the message */}
                  {hasStepComplete && !isUser && completedStep && stepNumber !== undefined && (
                    <StepCompletionCard
                      stepNumber={stepNumber}
                      stepTitle={completedStep.title}
                      stepObjective={completedStep.objective}
                      variant="dark"
                      className="mb-3 max-w-[75%]"
                    />
                  )}
                  <div className="relative group max-w-[75%]">
                    {/* Edit button for user messages */}
                    {canEdit && !isEditing && (
                      <button
                        onClick={() => handleStartEdit(message.messageId!, message.content)}
                        className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-white/20 text-white/60 hover:text-white z-10"
                        title="Modifier ce message"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3 backdrop-blur-xl shadow-lg",
                        // In consultant mode, use blue for consultant, different color for others
                        consultantMode
                          ? (isCurrentUserMessage
                              ? "bg-blue-500/30 text-white border border-blue-400/30"
                              : "bg-slate-700/40 text-white/90 border border-slate-500/30")
                          : (isUser
                              ? "bg-white/20 text-white"
                              : "bg-white/10 text-white/90")
                      )}
                      style={{
                        boxShadow: "0 8px 32px 0 rgba(0,0,0,0.2)",
                        willChange: "opacity, transform",
                      }}
                    >
                      {isEditing ? (
                        <div className="flex flex-col gap-2 min-w-[200px]">
                          <textarea
                            ref={(el) => {
                              if (el) {
                                el.style.height = 'auto';
                                el.style.height = el.scrollHeight + 'px';
                              }
                            }}
                            value={editContent}
                            onChange={(e) => {
                              setEditContent(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            className="w-full min-h-[60px] p-2 rounded border border-white/30 bg-black/30 text-white resize-none focus:outline-none focus:ring-2 focus:ring-white/50 overflow-hidden"
                            autoFocus
                            disabled={isSubmittingEdit}
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEdit}
                              disabled={isSubmittingEdit}
                              className="text-white/80 hover:text-white hover:bg-white/10"
                            >
                              <X className="h-4 w-4 mr-1" />
                              Annuler
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleSubmitEdit}
                              disabled={isSubmittingEdit || !editContent.trim()}
                              className="bg-white/20 hover:bg-white/30 text-white"
                            >
                              {isSubmittingEdit ? (
                                <>Sauvegarde...</>
                              ) : (
                                <>
                                  <Check className="h-4 w-4 mr-1" />
                                  Sauvegarder
                                </>
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-white/60">
                            Les messages suivants seront supprimés et la conversation reprendra depuis ce point.
                          </p>
                        </div>
                      ) : (
                        <>
                          <AnimatedText
                            content={cleanAllSignalMarkers(message.content)}
                            isInterim={message.isInterim}
                          />
                          {isStreamingAssistant && (
                            <span className="inline-block mt-1 text-xs text-white/60">
                              …
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {/* Agent thinking indicator - shown when awaiting first streaming token */}
          {isAgentThinking && !consultantMode && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-start gap-3 py-2 px-4"
            >
              <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 backdrop-blur-sm px-4 py-2">
                {/* Animated thinking dots */}
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-white/70"
                      animate={{
                        scale: [1, 1.4, 1],
                        opacity: [0.4, 1, 0.4],
                      }}
                      transition={{
                        duration: 0.8,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: "easeInOut",
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm text-white/70">
                  L&apos;agent réfléchit...
                </span>
              </div>
            </motion.div>
          )}
          {/* Step summary generation loading indicator */}
          {isGeneratingStepSummary && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center justify-center gap-3 py-4 px-4"
            >
              <div className="flex items-center gap-3 rounded-xl border border-cyan-500/30 bg-cyan-900/20 backdrop-blur-sm px-5 py-3">
                {/* Animated loading dots */}
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="h-2 w-2 rounded-full bg-cyan-400"
                      animate={{
                        scale: [1, 1.3, 1],
                        opacity: [0.5, 1, 0.5],
                      }}
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: "easeInOut",
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm text-cyan-300">
                  Génération des synthèses en cours, veuillez patienter...
                </span>
              </div>
            </motion.div>
          )}
          {/* Interview completion celebration - inline */}
          {allStepsCompleted && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.7, type: "spring", bounce: 0.4 }}
              className="mx-auto my-6 max-w-md px-4"
            >
              <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/10 backdrop-blur-xl p-6 shadow-2xl">
                {/* Confetti animation background */}
                <div className="absolute inset-0 opacity-30">
                  {[...Array(15)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute h-2 w-2 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500"
                      initial={{
                        x: Math.random() * 100 + '%',
                        y: -20,
                        rotate: 0,
                        scale: 0
                      }}
                      animate={{
                        y: '120%',
                        rotate: Math.random() * 360,
                        scale: [0, 1, 1, 0.8]
                      }}
                      transition={{
                        duration: 2 + Math.random() * 2,
                        delay: i * 0.1,
                        repeat: Infinity,
                        repeatDelay: 3
                      }}
                    />
                  ))}
                </div>

                <div className="relative z-10 text-center">
                  <motion.div
                    animate={{
                      rotate: [0, 10, -10, 10, 0],
                      scale: [1, 1.1, 1]
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      repeatDelay: 2
                    }}
                    className="mb-4 text-6xl"
                  >
                    🎉
                  </motion.div>

                  <h3 className="mb-2 text-2xl font-bold text-white">
                    Entretien terminé !
                  </h3>

                  <p className="mb-4 text-sm text-white/80">
                    Merci pour votre participation et vos réponses détaillées.
                    Toutes les étapes ont été complétées avec succès !
                  </p>

                  <motion.div
                    animate={{
                      boxShadow: [
                        '0 0 0 0 rgba(6, 182, 212, 0.4)',
                        '0 0 0 10px rgba(6, 182, 212, 0)',
                      ]
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg mb-4"
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>Toutes les étapes complétées</span>
                  </motion.div>

                  {/* Close tab button - BUG-042: window.close() only works for JS-opened windows */}
                  {closeAttempted ? (
                    <p className="mt-2 text-sm text-white/70 text-center">
                      Vous pouvez fermer cet onglet.
                    </p>
                  ) : (
                    <button
                      onClick={() => {
                        window.close();
                        // If window.close() didn't work, show fallback message after a short delay
                        setTimeout(() => setCloseAttempted(true), 100);
                      }}
                      className="mt-2 flex items-center justify-center gap-2 mx-auto px-6 py-2.5 rounded-full bg-white/20 hover:bg-white/30 border border-white/30 text-white text-sm font-medium transition-colors"
                    >
                      <X className="h-4 w-4" />
                      <span>Fermer</span>
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Invisible element at the bottom to scroll to */}
          <div ref={messagesEndRef} />
        </div>

        {/* Voice control bar - mic button left, status/partials right */}
        <div
          className="flex items-center gap-4 px-4"
          style={{ paddingBottom: 'max(80px, calc(env(safe-area-inset-bottom, 0px) + 60px))' }}
        >
          {/* Mic button - left, smaller */}
          <div className="flex-shrink-0 relative">
            {/* Subtle glow when active */}
            {!isMuted && isConnected && (
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: [0.2, 0.4, 0.2],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                style={{
                  background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
                  filter: 'blur(12px)',
                }}
              />
            )}

            {/* Main mic button */}
            <motion.button
              onClick={toggleMute}
              disabled={!isConnected && !isMuted}
              className={cn(
                "relative w-16 h-16 rounded-full flex items-center justify-center",
                "bg-white/20 backdrop-blur-xl border-2 border-white/30",
                "shadow-xl transition-all duration-300",
                isMuted && "opacity-50",
                !isConnected && !isMuted && "opacity-30 cursor-not-allowed"
              )}
              style={{
                boxShadow: '0 4px 20px 0 rgba(0, 0, 0, 0.25), inset 0 0 12px rgba(255, 255, 255, 0.1)',
              }}
              animate={{
                scale: isSpeaking ? [1, 1.08, 1] : 1,
              }}
              transition={{
                duration: 0.5,
                repeat: isSpeaking ? Infinity : 0,
                ease: "easeInOut",
              }}
            >
              {/* Waveform visualization - smaller, 8 bars */}
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                className="absolute"
                style={{
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {Array.from({ length: 8 }).map((_, i) => {
                  const angle = (i * 360) / 8;
                  const baseRadius = 18;
                  const radius = baseRadius + safeAudioLevel * 5;
                  const barWidth = 2.5;
                  const barHeight = 3 + safeAudioLevel * 8;
                  const centerX = 32;
                  const centerY = 32;
                  const x1 = centerX + Math.cos((angle * Math.PI) / 180) * radius;
                  const y1 = centerY + Math.sin((angle * Math.PI) / 180) * radius;
                  const x2 = centerX + Math.cos((angle * Math.PI) / 180) * (radius + barHeight);
                  const y2 = centerY + Math.sin((angle * Math.PI) / 180) * (radius + barHeight);

                  return (
                    <motion.line
                      key={i}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="white"
                      strokeWidth={barWidth}
                      strokeLinecap="round"
                      opacity={0.9}
                      animate={{
                        x2: isSpeaking
                          ? centerX + Math.cos((angle * Math.PI) / 180) * (radius + barHeight * (1.4 + safeAudioLevel))
                          : x2,
                        y2: isSpeaking
                          ? centerY + Math.sin((angle * Math.PI) / 180) * (radius + barHeight * (1.4 + safeAudioLevel))
                          : y2,
                        opacity: isSpeaking ? [0.9, 1, 0.9] : 0.6,
                      }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.04,
                        repeat: isSpeaking ? Infinity : 0,
                        ease: "easeInOut",
                      }}
                    />
                  );
                })}
              </svg>

              {/* Center icon */}
              {isMuted ? (
                <MicOff className="h-6 w-6 text-white relative z-10" />
              ) : (
                <Volume2 className="h-6 w-6 text-white relative z-10" />
              )}
            </motion.button>
          </div>

          {/* Status area - right, shows mic state + partials */}
          <div className="flex-1 min-w-0">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl px-4 py-3 border border-white/10">
              {/* Mic state label */}
              <p className="text-white/60 text-xs mb-1">
                {isConnecting && "Connexion..."}
                {isConnected && !isMuted && "Ecoute en cours..."}
                {isMuted && "Micro en pause"}
                {!isConnected && !isConnecting && !isMuted && "Non connecte"}
              </p>

              {/* Partial transcript or placeholder */}
              <div className="min-h-[1rem] max-h-[4.5rem] overflow-hidden">
                {error ? (
                  <div className="space-y-1">
                    <p className="text-red-300 text-xs">{error}</p>
                    {error.includes('Safari') || error.includes('Chrome') || error.includes('navigateur') ? (
                      <button
                        onClick={openInExternalBrowser}
                        className="text-blue-400 text-xs underline hover:text-blue-300"
                      >
                        Ouvrir dans Safari →
                      </button>
                    ) : null}
                  </div>
                ) : interimUser?.content ? (
                  // Display single partial transcript that scrolls/updates
                  <p
                    className="text-white/70 text-xs italic truncate"
                    style={{ direction: 'rtl', textAlign: 'left' }}
                  >
                    <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>
                      {interimUser.content}
                    </span>
                  </p>
                ) : (
                  <p className="text-white/40 text-xs italic">
                    {isMuted ? "Cliquez sur le micro pour reprendre" : "Parlez naturellement..."}
                  </p>
                )}
              </div>

              {/* Semantic telemetry (debug info) */}
              {semanticStatusText && (
                <p className="text-white/40 text-xs mt-1 truncate">
                  {semanticStatusText}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Inactivity overlay with blur and resume confirmation */}
      <AnimatePresence>
        {showInactivityOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-50 backdrop-blur-md bg-black/40 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8 max-w-md mx-4 shadow-2xl"
            >
              <h2 className="text-white text-2xl font-semibold mb-4 text-center">
                Still there?
              </h2>
              <p className="text-white/80 text-sm mb-6 text-center">
                We noticed you've been inactive for a while. Your microphone has been muted.
              </p>
              <p className="text-white/70 text-xs mb-6 text-center">
                {inactivityMonitor.lastSpeaker === 'user'
                  ? "You were the last to speak. When you resume, I'll respond to your message."
                  : "I was the last to speak. When you resume, I'll wait for your next message."}
              </p>
              <Button
                onClick={() => {
                  devLog('[PremiumVoiceInterface] 🔊 User resumed - unmuting microphone');
                  setShowInactivityOverlay(false);

                  // Unmute microphone
                  if (isMuted && agentRef.current) {
                    toggleMute();
                  }

                  // Reset inactivity timer
                  inactivityMonitor.resetTimer();
                }}
                className="w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl py-3 font-semibold transition-colors"
                autoFocus
              >
                Resume Conversation
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filtered Speaker Notification (Individual Mode) - Tutorial-style horizontal layout */}
      <AnimatePresence>
        {filteredSpeakerNotification && !consultantMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-50 backdrop-blur-md bg-black/40 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 max-w-md mx-4 shadow-2xl"
            >
              <h2 className="text-white text-xl font-semibold mb-3 text-center">
                Autre voix detectee
              </h2>
              <div className="text-white/80 text-sm mb-5 space-y-2">
                {filteredSpeakerNotification.transcripts.map((transcript, index) => (
                  <p key={index} className="bg-white/5 rounded-lg px-3 py-2 italic">
                    &quot;{transcript}&quot;
                  </p>
                ))}
              </div>
              <div className="space-y-3">
                {/* Ignorer button - horizontal layout with icon */}
                <button
                  onClick={() => {
                    if (filteredSpeakerTimeoutRef.current) {
                      clearTimeout(filteredSpeakerTimeoutRef.current);
                    }
                    ignoredSpeakersRef.current.add(filteredSpeakerNotification.speaker);
                    devLog(`[PremiumVoiceInterface] Speaker ${filteredSpeakerNotification.speaker} added to ignore list`);
                    setFilteredSpeakerNotification(null);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-red-500/30 flex items-center justify-center flex-shrink-0">
                    <X className="h-5 w-5 text-red-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-white/90 text-sm font-medium block">Ignorer</span>
                    <span className="text-white/50 text-xs">Ne pas transcrire cette voix</span>
                  </div>
                </button>

                {/* Ajouter button - horizontal layout with icon */}
                <button
                  onClick={() => {
                    if (filteredSpeakerTimeoutRef.current) {
                      clearTimeout(filteredSpeakerTimeoutRef.current);
                    }
                    if (agentRef.current instanceof SpeechmaticsVoiceAgent) {
                      agentRef.current.addAllowedSpeaker(filteredSpeakerNotification.speaker);
                    }
                    setFilteredSpeakerNotification(null);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-green-500/30 flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-green-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-white/90 text-sm font-medium block">Ajouter</span>
                    <span className="text-white/50 text-xs">Cette personne participe avec moi</span>
                  </div>
                </button>

                {/* Remplacer button - horizontal layout with icon */}
                <button
                  onClick={() => {
                    if (filteredSpeakerTimeoutRef.current) {
                      clearTimeout(filteredSpeakerTimeoutRef.current);
                    }
                    if (agentRef.current instanceof SpeechmaticsVoiceAgent) {
                      agentRef.current.setPrimarySpeaker(filteredSpeakerNotification.speaker);
                    }
                    setFilteredSpeakerNotification(null);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-500/30 flex items-center justify-center flex-shrink-0">
                    <Mic className="h-5 w-5 text-blue-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-white/90 text-sm font-medium block">Remplacer</span>
                    <span className="text-white/50 text-xs">Utiliser uniquement cette voix</span>
                  </div>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Speaker Assignment Overlays (Consultant Mode) - Stacked vertically */}
      {consultantMode && pendingSpeakers.length > 0 && (
        <div className="absolute inset-0 z-50 backdrop-blur-md bg-black/40 flex flex-col items-center justify-center gap-4 p-4 overflow-y-auto">
          {pendingSpeakers.map((speaker) => {
            // Get last 5 messages from this speaker to help identify who is speaking
            const recentMessages: SpeakerMessage[] = messages
              .filter(msg => (msg.metadata as { speaker?: string })?.speaker === speaker)
              .slice(-5)
              .map(msg => ({
                content: msg.content,
                timestamp: msg.timestamp || '',
              }));

            return (
              <SpeakerAssignmentOverlay
                key={speaker}
                isOpen={true}
                speaker={speaker}
                speakerOrder={speakerOrderRef.current.get(speaker) || 1}
                participants={participants}
                assignedSpeakers={speakerMappings.map(m => m.speaker)}
                recentMessages={recentMessages}
                onConfirm={handleSpeakerAssignmentConfirm}
                onClose={handleSpeakerAssignmentClose}
              />
            );
          })}
        </div>
      )}

      {/* Speaker Confirmation Overlay (Individual Mode) - Appears when first speaker is detected */}
      {!consultantMode && speakerPendingConfirmation && (
        <div className="absolute inset-0 z-50 backdrop-blur-md bg-black/40 flex items-center justify-center p-4">
          <SpeakerConfirmationOverlay
            isOpen={true}
            speaker={speakerPendingConfirmation.speaker}
            recentTranscript={speakerPendingConfirmation.transcript}
            onConfirm={handleSpeakerConfirm}
            onReject={handleSpeakerReject}
          />
        </div>
      )}

      {/* Voice Mode Tutorial Overlay */}
      <AnimatePresence>
        {showTutorial && (
          <VoiceModeTutorial
            currentStep={tutorialStep}
            onNext={handleTutorialNext}
            onPrev={handleTutorialPrev}
            onComplete={handleTutorialComplete}
            onSkip={handleTutorialComplete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function pour React.memo
  // Return true si les props sont égales (pas de re-render)
  // Return false si les props ont changé (re-render)

  const propsToCompare: (keyof PremiumVoiceInterfaceProps)[] = [
    'askKey',
    'askSessionId',
    'systemPrompt',
    'userPrompt',
    'modelConfig',
    'conversationPlan',
    // Timer props - must trigger re-render when changed
    'elapsedMinutes',
    'isTimerPaused',
    'isTimerLoading',
  ];

  for (const key of propsToCompare) {
    if (prevProps[key] !== nextProps[key]) {
      return false; // Props changed, re-render
    }
  }

  // Messages comparison - shallow compare the array
  if (prevProps.messages?.length !== nextProps.messages?.length) {
    return false;
  }

  return true; // Props are equal, skip re-render
});

