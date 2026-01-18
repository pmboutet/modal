"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Clock, Sparkles, ChevronDown, ChevronUp, MessageCircle, Lightbulb, RefreshCw, Info, Mic, MessageSquareText, Lock } from "lucide-react";
import { ChatComponent } from "@/components/chat/ChatComponent";
import { InsightPanel } from "@/components/insight/InsightPanel";
import { SuggestedQuestionsPanel } from "@/components/consultant/SuggestedQuestionsPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionData, Ask, Message, Insight, Challenge, ApiResponse, ConversationPlan, SuggestedQuestion } from "@/types";
import { ConversationProgressBar } from "@/components/conversation/ConversationProgressBar";
import { useSessionTimer } from "@/hooks/useSessionTimer";
import { useConsultantAnalysis } from "@/hooks/useConsultantAnalysis";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import {
  cn,
  validateAskKey,
  parseErrorMessage,
  formatTimeRemaining,
  getConversationModeDescription,
  getDeliveryModeLabel,
} from "@/lib/utils";
import { UserProfileMenu } from "@/components/auth/UserProfileMenu";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { PublicAskEntryForm } from "@/components/ask/PublicAskEntryForm";
import { Logo } from "@/components/ui/Logo";

type TokenSessionPayload = {
  ask: Ask;
  messages: Message[];
  insights: Insight[];
  challenges?: Challenge[];
  conversationPlan?: import('@/types').ConversationPlan | null;
  conversationThreadId?: string | null;
  isInitializing?: boolean; // True when plan/message generation is in progress (async)
  viewer?: {
    participantId?: string | null;
    profileId?: string | null;
    name?: string | null;
    email?: string | null;
    role?: string | null;
    isSpokesperson?: boolean;
  } | null;
};

interface MobileLayoutProps {
  sessionData: SessionData;
  currentParticipantName: string | null;
  awaitingAiResponse: boolean;
  voiceModeConfig: {
    systemPrompt: string | null;
    userPrompt: string | null;
    promptVariables: Record<string, string | null | undefined> | null;
    modelConfig: {
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
      promptVariables?: Record<string, string | null | undefined>; // Variables for userPrompt template rendering
    } | null;
  };
  isDetectingInsights: boolean;
  onSendMessage: (content: string, type?: Message['type'], metadata?: Message['metadata']) => void;
  onVoiceMessage: (role: 'user' | 'agent', content: string, metadata?: { isInterim?: boolean; messageId?: string; timestamp?: string }) => void;
  setIsReplyBoxFocused: (focused: boolean) => void;
  setIsVoiceModeActive: (active: boolean) => void;
  isVoiceModeActive: boolean;
  reloadMessagesAfterVoiceMode: () => void;
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
  mobileActivePanel: 'chat' | 'insights';
  setMobileActivePanel: (panel: 'chat' | 'insights') => void;
  isMobileHeaderExpanded: boolean;
  setIsMobileHeaderExpanded: (expanded: boolean) => void;
  askDetails: Ask | null;
  sessionDataAskKey: string;
  participants: Array<{ id: string; name: string; isSpokesperson?: boolean }>;
  statusLabel: string;
  timelineLabel: string | null;
  timeRemaining: string | null;
  onInsightUpdate: (insightId: string, newContent: string) => void;
  /** Session timer elapsed minutes */
  sessionElapsedMinutes: number;
  /** Whether the session timer is paused */
  isSessionTimerPaused: boolean;
  /** Toggle the session timer pause state */
  onToggleTimerPause: () => void;
  /** Notify session timer of user typing */
  onUserTyping: (isTyping: boolean) => void;
  /** Consultant mode - AI-assisted question suggestions */
  isConsultantMode?: boolean;
  /** Whether current participant is the spokesperson (sees suggested questions in consultant mode) */
  isSpokesperson?: boolean;
  /** Suggested questions from consultant analysis */
  consultantQuestions?: SuggestedQuestion[];
  /** Whether consultant is analyzing */
  isConsultantAnalyzing?: boolean;
  /** Current user's profile ID for message alignment */
  currentUserId?: string | null;
  /** Whether the header is hidden due to scroll */
  isHeaderHidden: boolean;
  /** Handler for chat scroll events */
  onChatScroll: (scrollTop: number, scrollDelta: number) => void;
  /** Callback when speaker changes (consultant mode diarization) */
  onSpeakerChange?: (speaker: string) => void;
}

/**
 * Mobile layout component with collapsible header and swipeable panels
 */
function MobileLayout({
  sessionData,
  currentParticipantName,
  awaitingAiResponse,
  voiceModeConfig,
  isDetectingInsights,
  onSendMessage,
  onVoiceMessage,
  setIsReplyBoxFocused,
  setIsVoiceModeActive,
  isVoiceModeActive,
  reloadMessagesAfterVoiceMode,
  onEditMessage,
  mobileActivePanel,
  setMobileActivePanel,
  isMobileHeaderExpanded,
  setIsMobileHeaderExpanded,
  askDetails,
  sessionDataAskKey,
  participants,
  statusLabel,
  timelineLabel,
  timeRemaining,
  onInsightUpdate,
  sessionElapsedMinutes,
  isSessionTimerPaused,
  onToggleTimerPause,
  onUserTyping,
  isConsultantMode,
  isSpokesperson,
  consultantQuestions,
  isConsultantAnalyzing,
  currentUserId,
  isHeaderHidden,
  onChatScroll,
  onSpeakerChange,
}: MobileLayoutProps) {
  const [panelWidth, setPanelWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setPanelWidth(containerRef.current.offsetWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  return (
    <div className={`flex flex-col overflow-hidden min-w-0 w-full max-w-full overflow-x-hidden touch-pan-y transition-[height] duration-200 ${isHeaderHidden ? 'h-[100dvh]' : 'h-[calc(100dvh-44px)]'}`}>
      {/* Collapsible Header - Compact - hides on scroll down */}
      {askDetails && (
        <motion.div
          initial={false}
          animate={{
            height: isHeaderHidden ? 0 : (isMobileHeaderExpanded ? 'auto' : '48px'),
            opacity: isHeaderHidden ? 0 : 1,
          }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden border-b border-slate-200/60 bg-white/90 backdrop-blur-lg flex-shrink-0"
        >
          <div className="px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-xs leading-tight text-foreground line-clamp-2">
                  {askDetails.question}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMobileHeaderExpanded(!isMobileHeaderExpanded)}
                className="flex-shrink-0 h-7 w-7 p-0"
              >
                {isMobileHeaderExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <AnimatePresence>
            {isMobileHeaderExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden px-4 pb-4"
              >
                {askDetails.description && (
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    {askDetails.description}
                  </p>
                )}
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 mb-2">
                      Session
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {sessionDataAskKey && (
                        <span className="inline-flex items-center rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-foreground shadow-sm">
                          {sessionDataAskKey}
                        </span>
                      )}
                      {sessionData.ask && (
                        <span className={sessionData.ask.isActive ? 'light-status-active' : 'light-status-closed'}>
                          {sessionData.ask.isActive ? 'Active' : 'Closed'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 mb-2">
                      Statut
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {statusLabel}
                      </span>
                      {timelineLabel && <span className="text-xs text-muted-foreground">{timelineLabel}</span>}
                      {timeRemaining && (
                        <span className="inline-flex items-center gap-1 text-primary text-xs">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{timeRemaining}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 mb-2">
                      Participants ({participants.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {participants.length > 0 ? (
                        participants.map(participant => (
                          <span
                            key={participant.id}
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary"
                          >
                            <span className="font-medium text-primary/90">{participant.name}</span>
                            {participant.isSpokesperson && (
                              <span className="text-[10px] uppercase tracking-wide text-primary/70">porte-parole</span>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">Aucun participant</span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Panels Container - navigation via buttons only, no swipe */}
      {/* h-0 is required with flex-1 to ensure h-full works correctly on children */}
      <div className="flex-1 h-0 relative overflow-hidden min-w-0 max-w-full overflow-x-hidden" ref={containerRef}>
        <motion.div
          className="flex h-full min-w-0 max-w-full"
          animate={{
            x: mobileActivePanel === 'chat' ? 0 : panelWidth > 0 ? -panelWidth : 0,
          }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
          }}
        >
          {/* Chat Panel */}
          <motion.div
            className="w-full flex-shrink-0 h-full min-w-0 max-w-full overflow-x-hidden"
            animate={{
              opacity: mobileActivePanel === 'chat' ? 1 : 0.5,
            }}
            transition={{ duration: 0.2 }}
          >
            <div className="h-full flex flex-col min-w-0 max-w-full">
              {/* Conversation plan - hides on scroll down */}
              {sessionData.conversationPlan && (
                <motion.div
                  initial={false}
                  animate={{
                    height: isHeaderHidden ? 0 : 'auto',
                    opacity: isHeaderHidden ? 0 : 1,
                  }}
                  transition={{ duration: 0.2 }}
                  className="flex-shrink-0 overflow-hidden"
                >
                  <ConversationProgressBar
                    steps={sessionData.conversationPlan.plan_data.steps}
                    currentStepId={sessionData.conversationPlan.current_step_id}
                    elapsedMinutes={sessionElapsedMinutes}
                    isTimerPaused={isSessionTimerPaused}
                    onTogglePause={onToggleTimerPause}
                  />
                </motion.div>
              )}
              <div className="flex-1 p-1.5 min-w-0 max-w-full overflow-x-hidden">
                <ChatComponent
                  key={`chat-${sessionDataAskKey}`}
                  askKey={sessionDataAskKey}
                  ask={sessionData.ask}
                  messages={sessionData.messages}
                  conversationPlan={sessionData.conversationPlan}
                  onSendMessage={onSendMessage}
                  isLoading={sessionData.isLoading}
                  isInitializing={sessionData.isInitializing}
                  onHumanTyping={onUserTyping}
                  currentParticipantName={currentParticipantName}
                  currentUserId={currentUserId}
                  isMultiUser={Boolean(sessionData.ask && sessionData.ask.participants.length > 1)}
                  showAgentTyping={awaitingAiResponse && !isDetectingInsights}
                  voiceModeEnabled={!!voiceModeConfig?.systemPrompt}
                  initialVoiceMode={isVoiceModeActive}
                  voiceModeSystemPrompt={voiceModeConfig?.systemPrompt || undefined}
                  voiceModeUserPrompt={voiceModeConfig?.userPrompt || undefined}
                  voiceModePromptVariables={voiceModeConfig?.promptVariables || undefined}
                  voiceModeModelConfig={voiceModeConfig?.modelConfig || undefined}
                  onVoiceMessage={onVoiceMessage}
                  onReplyBoxFocusChange={setIsReplyBoxFocused}
                  onVoiceModeChange={setIsVoiceModeActive}
                  onEditMessage={onEditMessage}
                  consultantMode={sessionData.ask?.conversationMode === 'consultant'}
                  onSpeakerChange={onSpeakerChange}
                  elapsedMinutes={sessionElapsedMinutes}
                  isTimerPaused={isSessionTimerPaused}
                  onTogglePause={onToggleTimerPause}
                  onChatScroll={onChatScroll}
                />
              </div>
            </div>
          </motion.div>

          {/* Insights Panel */}
          <motion.div
            className="w-full flex-shrink-0 h-full"
            animate={{
              opacity: mobileActivePanel === 'insights' ? 1 : 0.5,
            }}
            transition={{ duration: 0.2 }}
          >
            <div className="h-full p-2 md:p-4 overflow-y-auto space-y-4">
              {/* Suggested Questions Panel - Consultant mode, spokesperson only */}
              {isConsultantMode && isSpokesperson && consultantQuestions && (
                <SuggestedQuestionsPanel
                  questions={consultantQuestions}
                  isAnalyzing={isConsultantAnalyzing}
                />
              )}
              <InsightPanel
                insights={sessionData.insights}
                askKey={sessionDataAskKey}
                isDetectingInsights={isDetectingInsights}
                onInsightUpdate={onInsightUpdate}
                isConsultantMode={isConsultantMode}
                isSpokesperson={isSpokesperson}
              />
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Panel Indicator - with safe area for mobile browsers, hides on scroll down */}
      <motion.div
        initial={false}
        animate={{
          height: isHeaderHidden ? 0 : 'auto',
          opacity: isHeaderHidden ? 0 : 1,
        }}
        transition={{ duration: 0.2 }}
        className="flex items-center justify-center gap-2 bg-white/80 backdrop-blur-lg border-t border-slate-200/60 overflow-hidden"
        style={{
          paddingTop: isHeaderHidden ? 0 : 8,
          paddingBottom: isHeaderHidden ? 0 : 'max(8px, env(safe-area-inset-bottom))',
        }}
      >
        <button
          onClick={() => setMobileActivePanel('chat')}
          className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${
            mobileActivePanel === 'chat'
              ? 'light-tab-active'
              : 'light-tab-inactive'
          }`}
        >
          <MessageCircle className="h-4 w-4" />
          <span className="text-sm font-medium">Chat</span>
        </button>
        <button
          onClick={() => setMobileActivePanel('insights')}
          className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${
            mobileActivePanel === 'insights'
              ? 'light-tab-active'
              : 'light-tab-inactive'
          }`}
        >
          <Lightbulb className="h-4 w-4" />
          <span className="text-sm font-medium">Insights</span>
        </button>
      </motion.div>
    </div>
  );
}

/**
 * Main application page with beautiful glassmorphic design
 * Displays chat on 1/3 of screen and challenges on 2/3
 * All data comes from external backend via webhooks
 */
export default function HomePage() {
  const searchParams = useSearchParams();

  // Get authenticated user info as fallback for participant name
  const { user: authUser } = useAuth();
  const authUserName = authUser?.fullName || authUser?.email || null;

  const [sessionData, setSessionData] = useState<SessionData>({
    askKey: '',
    ask: null,
    messages: [],
    insights: [],
    challenges: [],
    conversationPlan: null,
    isLoading: false,
    error: null
  });
  const responseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const insightDetectionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasPostedMessageSinceRefreshRef = useRef(false);
  const [awaitingAiResponse, setAwaitingAiResponse] = useState(false);
  const activeAiResponsesRef = useRef(0);
  const [isDetectingInsights, setIsDetectingInsights] = useState(false);
  const participantFromUrl = searchParams.get('participant') || searchParams.get('participantName');
  const derivedParticipantName = participantFromUrl?.trim() ? participantFromUrl.trim() : null;
  const [currentParticipantName, setCurrentParticipantName] = useState<string | null>(derivedParticipantName);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isCurrentParticipantSpokesperson, setIsCurrentParticipantSpokesperson] = useState(false);
  const isTestMode = searchParams.get('mode') === 'test';
  const isDevMode = process.env.NEXT_PUBLIC_IS_DEV === 'true';
  const [isDetailsCollapsed, setIsDetailsCollapsed] = useState(false);
  const [isReplyBoxFocused, setIsReplyBoxFocused] = useState(false);
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false);
  // Mode selection state - null means not yet selected, 'voice' or 'text' means selected
  const [selectedInputMode, setSelectedInputMode] = useState<'voice' | 'text' | null>(null);
  // Track if voice config is loading
  const [isVoiceConfigLoading, setIsVoiceConfigLoading] = useState(false);

  // Public ASK entry mode state (for ?ask=<key> flow)
  const [publicAskEntry, setPublicAskEntry] = useState<{
    askKey: string;
    askName: string | null;
    askQuestion: string | null;
    isLoading: boolean;
    error: string | null;
  } | null>(null);

  // Get current step ID for timer tracking
  // The timer endpoint uses step_identifier (e.g., "step_1"), which is what current_step_id contains
  const currentStepId = sessionData.conversationPlan?.current_step_id ?? null;

  // Session timer with intelligent pause/resume logic and persistence
  const sessionTimer = useSessionTimer({
    inactivityTimeout: 30000, // 30 seconds before pause
    askKey: sessionData.askKey || undefined, // Enable persistence when askKey is available
    inviteToken: sessionData.inviteToken,
    currentStepId, // Track time per step (uses step_identifier directly)
  });

  // Toggle timer pause - switches between pause and start
  const handleToggleTimerPause = useCallback(() => {
    if (sessionTimer.isPaused) {
      sessionTimer.start();
    } else {
      sessionTimer.pause();
    }
  }, [sessionTimer]);

  // Handle scroll events from ChatComponent to hide/show header and toggle compact mode
  const handleMobileChatScroll = useCallback((scrollTop: number, scrollDelta: number) => {
    // Ignore tiny scroll changes (less than 2px) to avoid jitter
    if (Math.abs(scrollDelta) < 2 && scrollDelta !== 0) {
      return;
    }

    // Initial load: compact header if already scrolled down
    if (scrollDelta === 0 && scrollTop > 50) {
      setIsMobileHeaderHidden(true);
      setIsHeaderCompact(true);
      return;
    }

    if (scrollDelta > 0) {
      // Scrolling down - hide mobile header and compact desktop header immediately
      setIsMobileHeaderHidden(true);
      setIsHeaderCompact(true);
      mobileScrollUpAccumulator.current = 0;
      scrollUpAccumulator.current = 0;
    } else if (scrollDelta < 0) {
      // Scrolling up - accumulate scroll distance
      mobileScrollUpAccumulator.current += Math.abs(scrollDelta);
      scrollUpAccumulator.current += Math.abs(scrollDelta);

      // Show mobile header only after scrolling up significantly
      if (mobileScrollUpAccumulator.current >= MOBILE_SCROLL_UP_THRESHOLD) {
        setIsMobileHeaderHidden(false);
      }
      // Expand header after scrolling up
      if (scrollUpAccumulator.current >= SCROLL_UP_THRESHOLD) {
        setIsHeaderCompact(false);
      }
    }

    // If at the very top, always show full header
    if (scrollTop <= 10) {
      setIsMobileHeaderHidden(false);
      setIsHeaderCompact(false);
      mobileScrollUpAccumulator.current = 0;
      scrollUpAccumulator.current = 0;
    }
  }, []);

  // Consultant analysis for AI-assisted question suggestions
  const isConsultantMode = sessionData.ask?.conversationMode === 'consultant';
  const isSpokesperson = isCurrentParticipantSpokesperson;

  const consultantAnalysis = useConsultantAnalysis({
    askKey: sessionData.askKey || '',
    enabled: isConsultantMode && !!sessionData.askKey,
    messageCount: sessionData.messages.length, // Only analyze when new messages arrive
    inviteToken: sessionData.inviteToken,
    onStepCompleted: () => {
      // The step completion is handled by the API
      // UI will be updated on next data refresh
    },
  });

  // Real-time message subscription for shared threads
  // Enables multi-participant chat where everyone sees messages in real-time
  const isSharedThread = sessionData.ask?.conversationMode !== 'individual_parallel';
  const handleRealtimeMessage = useCallback((newMessage: Message) => {
    setSessionData(prev => {
      // Check if message already exists by id OR clientId (avoid duplicates from own messages)
      const existsById = prev.messages.some(m => m.id === newMessage.id);
      const existsByClientId = newMessage.clientId && prev.messages.some(m => m.clientId === newMessage.clientId);

      // Also check by metadata.messageId for voice messages (race condition between optimistic update and realtime)
      // Voice messages store their messageId in metadata for deduplication
      const newMetadataMessageId = (newMessage.metadata as { messageId?: string })?.messageId;
      const existsByMetadataMessageId = newMetadataMessageId && prev.messages.some(
        m => (m.metadata as { messageId?: string })?.messageId === newMetadataMessageId
      );

      if (existsById || existsByClientId || existsByMetadataMessageId) {
        return prev;
      }

      return {
        ...prev,
        messages: [...prev.messages, newMessage],
      };
    });
  }, []);

  const { isSubscribed, subscriptionStatus, lastError: realtimeError, isPolling, isTokenExpired } = useRealtimeMessages({
    conversationThreadId: sessionData.conversationThreadId ?? null,
    askKey: sessionData.askKey || '',
    enabled: isSharedThread && !!sessionData.conversationThreadId,
    onNewMessage: handleRealtimeMessage,
    inviteToken: sessionData.inviteToken ?? null,
  });

  // Pause timer when token expires to prevent accumulating time while user is away
  useEffect(() => {
    if (isTokenExpired) {
      sessionTimer.pause();
    }
  }, [isTokenExpired, sessionTimer]);

  const autoCollapseTriggeredRef = useRef(false);
  const previousMessageCountRef = useRef(0);
  // Mobile view states
  const [mobileActivePanel, setMobileActivePanel] = useState<'chat' | 'insights'>('chat');
  const [isMobileHeaderExpanded, setIsMobileHeaderExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileHeaderHidden, setIsMobileHeaderHidden] = useState(false);
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const mobileScrollUpAccumulator = useRef(0);
  const scrollUpAccumulator = useRef(0);
  const MOBILE_SCROLL_UP_THRESHOLD = 100;
  const SCROLL_UP_THRESHOLD = 80;
  // Desktop compact mode states (tabbed layout when content is minimal)
  const [desktopRightPanelTab, setDesktopRightPanelTab] = useState<'questions' | 'details' | 'insights'>('insights');
  const [useCompactMode, setUseCompactMode] = useState(false);
  const insightsPanelRef = useRef<HTMLDivElement>(null);
  // DEBUG: Afficher auth ID temporairement
  const [debugAuthId, setDebugAuthId] = useState<string | null>(null);
  // Voice mode configuration
  // Voice mode configuration - combined into a single state to avoid multiple re-renders
  const [voiceModeConfig, setVoiceModeConfig] = useState<{
    systemPrompt: string | null;
    userPrompt: string | null;
    promptVariables: Record<string, string | null | undefined> | null;
    modelConfig: {
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
      promptVariables?: Record<string, string | null | undefined>; // Variables for userPrompt template rendering
    } | null;
  }>({
    systemPrompt: null,
    userPrompt: null,
    promptVariables: null,
    modelConfig: null,
  });
  // Store logId for voice agent exchanges (user message -> agent response)
  const voiceAgentLogIdRef = useRef<string | null>(null);
  const inviteTokenRef = useRef<string | null>(null);

  const startAwaitingAiResponse = useCallback(() => {
    activeAiResponsesRef.current += 1;
    setAwaitingAiResponse(true);
  }, [setAwaitingAiResponse]);

  const stopAwaitingAiResponse = useCallback(() => {
    activeAiResponsesRef.current = Math.max(0, activeAiResponsesRef.current - 1);
    setAwaitingAiResponse(activeAiResponsesRef.current > 0);
  }, [setAwaitingAiResponse]);

  // Extract stable functions from sessionTimer to avoid re-running effects on every tick
  // (sessionTimer is a new object every second due to elapsedSeconds changing)
  const { notifyAiStreaming, notifyVoiceActive, start: startTimer } = sessionTimer;

  // Connect AI streaming state to session timer
  useEffect(() => {
    notifyAiStreaming(awaitingAiResponse);
  }, [awaitingAiResponse, notifyAiStreaming]);

  // Connect voice mode state to session timer
  // When voice mode is activated, explicitly start the timer in addition to notifying activity
  useEffect(() => {
    notifyVoiceActive(isVoiceModeActive);
    // Explicitly start the timer when entering voice mode to ensure it runs
    if (isVoiceModeActive) {
      startTimer();
    }
  }, [isVoiceModeActive, notifyVoiceActive, startTimer]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id) {
        setDebugAuthId(data.user.id);
      }
    });
  }, []);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Detect compact mode: switch to tabs when details collapsed AND insights panel is minimal
  useEffect(() => {
    if (!insightsPanelRef.current || isMobile) {
      setUseCompactMode(false);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const insightsHeight = entry.contentRect.height;
      const viewportHeight = window.innerHeight;
      // Switch to compact mode when details are collapsed and insights panel is less than 30% of viewport
      const shouldUseCompact = isDetailsCollapsed && insightsHeight < viewportHeight * 0.3;

      setUseCompactMode(shouldUseCompact);
    });

    observer.observe(insightsPanelRef.current);
    return () => observer.disconnect();
  }, [isDetailsCollapsed, isMobile]);

  const askDetails = sessionData.ask;
  useEffect(() => {
    if (sessionData.inviteToken) {
      inviteTokenRef.current = sessionData.inviteToken;
    }
  }, [sessionData.inviteToken]);
  const participants = askDetails?.participants ?? [];
  const statusLabel = askDetails?.status
    ? askDetails.status.charAt(0).toUpperCase() + askDetails.status.slice(1)
    : askDetails?.isActive
      ? 'Active'
      : 'Inactive';
  const startDate = askDetails?.startDate ? new Date(askDetails.startDate) : null;
  const endDate = askDetails?.endDate ? new Date(askDetails.endDate) : null;
  const now = new Date();
  let timelineLabel: string | null = null;

  if (startDate && now < startDate) {
    timelineLabel = `Commence le ${startDate.toLocaleString()}`;
  } else if (endDate && now > endDate) {
    timelineLabel = `Terminé le ${endDate.toLocaleString()}`;
  } else if (startDate && endDate) {
    timelineLabel = `En cours jusqu'au ${endDate.toLocaleString()}`;
  } else if (endDate) {
    timelineLabel = `Clôture le ${endDate.toLocaleString()}`;
  }

  const timeRemaining = askDetails?.endDate ? formatTimeRemaining(askDetails.endDate) : null;

  const cancelResponseTimer = useCallback(() => {
    if (responseTimerRef.current) {
      clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
  }, []);

  const cancelInsightDetectionTimer = useCallback(() => {
    if (insightDetectionTimerRef.current) {
      clearTimeout(insightDetectionTimerRef.current);
      insightDetectionTimerRef.current = null;
      setIsDetectingInsights(false);
    }
  }, []);

  const markMessagePosted = useCallback(() => {
    hasPostedMessageSinceRefreshRef.current = true;
  }, []);

  const triggerAiResponse = useCallback(async () => {
    if (!sessionData.askKey) {
      return;
    }

    try {
      cancelInsightDetectionTimer();
      setIsDetectingInsights(true);
      setSessionData(prev => ({
        ...prev,
        isLoading: true,
      }));

      if (isTestMode) {
        const simulatedId = `ai-${Date.now()}`;
        const simulatedAiMessage: Message = {
          clientId: simulatedId,
          id: simulatedId,
          askKey: sessionData.askKey,
          askSessionId: sessionData.ask?.askSessionId,
          content: "Message de test : voici une réponse simulée de l'agent.",
          type: 'text',
          senderType: 'ai',
          senderId: null,
          senderName: 'Agent',
          timestamp: new Date().toISOString(),
          metadata: { senderName: 'Agent' },
        };

        markMessagePosted();
        setSessionData(prev => ({
          ...prev,
          messages: [...prev.messages, simulatedAiMessage],
          isLoading: false,
        }));
        return;
      }

      const insightHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (sessionData.inviteToken) {
        insightHeaders['X-Invite-Token'] = sessionData.inviteToken;
      }

      const response = await fetch(`/api/ask/${sessionData.askKey}/respond`, {
        method: 'POST',
        headers: insightHeaders,
        body: JSON.stringify({ mode: 'insights-only' }),
      });

      const data: ApiResponse<{ message?: Message; insights?: Insight[] }> = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Unable to trigger insight detection (status ${response.status})`);
      }

      const payload = data.data;
      const message = payload?.message;
      const insights = payload?.insights;

      if (message) {
        markMessagePosted();
        setSessionData(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              ...message,
              clientId: message.clientId ?? message.id,
            },
          ],
          insights: insights ?? prev.insights,
          isLoading: false,
        }));
      } else if (insights) {
        setSessionData(prev => ({
          ...prev,
          insights: insights ?? prev.insights,
          isLoading: false,
        }));
      } else {
        setSessionData(prev => ({
          ...prev,
          isLoading: false,
        }));
      }
    } catch (error) {
      console.error('Unable to trigger insight detection', error);
      setSessionData(prev => ({
        ...prev,
        isLoading: false,
        error: parseErrorMessage(error)
      }));
    } finally {
      setIsDetectingInsights(false);
    }
  }, [cancelInsightDetectionTimer, cancelResponseTimer, sessionData.ask?.askSessionId, sessionData.askKey, sessionData.inviteToken, isTestMode]);

  const scheduleResponseTimer = useCallback(() => {
    cancelResponseTimer();
    // Spec: 5 secondes total après arrêt de frappe
    // ChatComponent détecte l'arrêt de frappe après 1500ms, donc on attend 3500ms ici
    // Total: 1500ms + 3500ms = 5000ms
    responseTimerRef.current = setTimeout(() => {
      triggerAiResponse();
    }, 3500);
  }, [cancelResponseTimer, triggerAiResponse]);

  const triggerInsightDetection = useCallback(async () => {
    if (!sessionData.askKey || !sessionData.ask?.askSessionId) {
      setIsDetectingInsights(false);
      return;
    }

    if (!hasPostedMessageSinceRefreshRef.current) {
      setIsDetectingInsights(false);
      return;
    }

    try {
      setIsDetectingInsights(true);
      
      const detectionHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (sessionData.inviteToken) {
        detectionHeaders['X-Invite-Token'] = sessionData.inviteToken;
      }

      const response = await fetch(`/api/ask/${sessionData.askKey}/respond`, {
        method: 'POST',
        headers: detectionHeaders,
        body: JSON.stringify({
          detectInsights: true,
          askSessionId: sessionData.ask.askSessionId,
        }),
      });

      const data: ApiResponse<{ insights: Insight[] }> = await response.json();

      if (data.success && data.data?.insights) {
        setSessionData(prev => ({
          ...prev,
          insights: data.data!.insights,
        }));
      }
    } catch (error) {
      console.error('Error detecting insights:', error);
    } finally {
      setIsDetectingInsights(false);
    }
  }, [sessionData.askKey, sessionData.ask?.askSessionId, sessionData.inviteToken]);

  const scheduleInsightDetection = useCallback(() => {
    if (
      !hasPostedMessageSinceRefreshRef.current ||
      !sessionData.askKey ||
      !sessionData.ask?.askSessionId
    ) {
      return;
    }

    cancelInsightDetectionTimer();
    insightDetectionTimerRef.current = setTimeout(() => {
      setIsDetectingInsights(true);
      triggerInsightDetection();
    }, 2500); // 2.5 secondes après le dernier message
  }, [
    cancelInsightDetectionTimer,
    triggerInsightDetection,
    sessionData.ask?.askSessionId,
    sessionData.askKey,
  ]);

  useEffect(() => {
    return () => {
      cancelResponseTimer();
      cancelInsightDetectionTimer();
    };
  }, [cancelResponseTimer, cancelInsightDetectionTimer]);

  useEffect(() => {
    setIsDetailsCollapsed(false);
    autoCollapseTriggeredRef.current = false;
    previousMessageCountRef.current = sessionData.messages.length;
  }, [sessionData.ask?.askSessionId]);

  useEffect(() => {
    if (autoCollapseTriggeredRef.current) {
      previousMessageCountRef.current = sessionData.messages.length;
      return;
    }

    if (sessionData.messages.length > previousMessageCountRef.current) {
      const newMessages = sessionData.messages.slice(previousMessageCountRef.current);
      const hasUserMessage = newMessages.some(message => message.senderType === 'user');

      if (hasUserMessage) {
        setIsDetailsCollapsed(true);
        autoCollapseTriggeredRef.current = true;
      }
    }

    previousMessageCountRef.current = sessionData.messages.length;
  }, [sessionData.messages]);

  // Auto-collapse details when reply box gets focus
  useEffect(() => {
    if (isReplyBoxFocused && !isDetailsCollapsed) {
      setIsDetailsCollapsed(true);
      autoCollapseTriggeredRef.current = true;
    }
  }, [isReplyBoxFocused, isDetailsCollapsed]);

  // Initialize session from URL parameters
  useEffect(() => {
    // Get token or ask param from URL
    const tokenFromSearchParams = searchParams.get('token');
    const askFromSearchParams = searchParams.get('ask');
    const tokenFromURL = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null;
    const askFromURL = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ask') : null;

    const token = tokenFromSearchParams || tokenFromURL;
    const askKey = askFromSearchParams || askFromURL;

    // If we have an 'ask' param (public entry flow), show the registration form
    if (askKey && !token) {
      setPublicAskEntry({
        askKey,
        askName: null,
        askQuestion: null,
        isLoading: true,
        error: null,
      });
      // Fetch public ASK info
      fetch(`/api/ask/${encodeURIComponent(askKey)}/public-info`)
        .then(res => res.json())
        .then(result => {
          if (result.success && result.data) {
            setPublicAskEntry({
              askKey,
              askName: result.data.name,
              askQuestion: result.data.question,
              isLoading: false,
              error: null,
            });
          } else {
            setPublicAskEntry({
              askKey,
              askName: null,
              askQuestion: null,
              isLoading: false,
              error: result.error || 'Session ASK non trouvée',
            });
          }
        })
        .catch(err => {
          console.error('[HomePage] Error fetching public ASK info:', err);
          setPublicAskEntry({
            askKey,
            askName: null,
            askQuestion: null,
            isLoading: false,
            error: 'Erreur de connexion',
          });
        });
      return;
    }

    // Token-based link (unique per participant) - this is the only supported access mode
    if (token) {
      setSessionData(prev => ({
        ...prev,
        askKey: '', // Will be set after loading
        inviteToken: token, // Store the invite token for authentication
        ask: null,
        messages: [],
        insights: [],
        challenges: [],
        isLoading: true,
        error: null
      }));
      hasPostedMessageSinceRefreshRef.current = false;
      // Load session data using token endpoint
      loadSessionDataByToken(token);
      return;
    }

    // No valid access parameter provided
    setSessionData(prev => ({
      ...prev,
      error: 'No ASK token provided in URL. Please use a valid ASK link.'
    }));
  }, [searchParams]);

  const handleHumanTyping = useCallback((isTyping: boolean) => {
    if (isTyping) {
      cancelResponseTimer();
      cancelInsightDetectionTimer();
    } else {
      if (awaitingAiResponse) {
        scheduleResponseTimer();
      } else {
        // Si l'utilisateur arrête de taper et qu'aucune réponse AI n'est en cours,
        // programmer la détection d'insights
        if (hasPostedMessageSinceRefreshRef.current) {
          scheduleInsightDetection();
        }
      }
    }
  }, [awaitingAiResponse, cancelResponseTimer, scheduleResponseTimer, cancelInsightDetectionTimer, scheduleInsightDetection]);

  // Load session data from external backend via API
  const loadSessionDataByToken = async (token: string) => {
    try {
      setSessionData(prev => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      // Create a Supabase auth session for Realtime to work
      try {
        const authResponse = await fetch(`/api/ask/token/${encodeURIComponent(token)}/auth`, {
          method: 'POST',
        });

        if (authResponse.ok) {
          const authData = await authResponse.json();
          if (authData.success && authData.data && supabase) {
            const { access_token, refresh_token } = authData.data;
            await supabase.auth.setSession({ access_token, refresh_token });
            // Set the Realtime auth token explicitly for WebSocket connection
            await supabase.realtime.setAuth(access_token).catch(() => {});
          }
        }
      } catch {
        // Non-blocking - polling fallback will still work
      }

      const response = await fetch(`/api/ask/token/${encodeURIComponent(token)}`);
      const data: ApiResponse<TokenSessionPayload> = await response.json();

      if (!response.ok || !data.success) {
        // If authentication is required, redirect to login with token preserved
        if (response.status === 401) {
          const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
          const loginUrl = `/auth/login?redirectTo=${encodeURIComponent(currentUrl)}`;
          if (typeof window !== 'undefined') {
            window.location.href = loginUrl;
            return;
          }
        }
        throw new Error(data.error || 'Failed to load session data from token');
      }

      const hasPersistedMessages = (data.data?.messages ?? []).length > 0;
      hasPostedMessageSinceRefreshRef.current = hasPersistedMessages;

      // Check if async initialization is in progress
      const isInitializing = data.data?.isInitializing === true;

      setSessionData(prev => {
        const messagesFromApi = (data.data?.messages ?? []).map(message => {
          const existing = prev.messages.find(prevMessage => prevMessage.id === message.id);
          return {
            ...message,
            clientId: existing?.clientId ?? message.clientId ?? message.id,
          };
        });

        // Merge: keep messages that aren't yet in API response
        // This prevents messages from disappearing during reload race conditions
        const apiMessageIds = new Set(messagesFromApi.map(m => m.id));
        const now = Date.now();
        const ONE_MINUTE = 60 * 1000;

        // Keep messages not in API response if they're recent (within 1 minute)
        const pendingMessages = prev.messages.filter(m => {
          if (apiMessageIds.has(m.id)) return false;
          if (m.id?.startsWith('temp-') || m.clientId?.startsWith('ai-stream-')) return true;
          const msgTime = m.timestamp ? new Date(m.timestamp).getTime() : 0;
          return (now - msgTime) < ONE_MINUTE;
        });

        const mergedMessages = [...messagesFromApi, ...pendingMessages];

        // Update askKey to the actual ask key from the response
        const actualAskKey = data.data?.ask?.key || token;

        return {
          ...prev,
          askKey: actualAskKey,
          inviteToken: token, // Keep the token for subsequent API calls
          ask: data.data!.ask,
          messages: mergedMessages,
          insights: data.data?.insights ?? [],
          challenges: data.data?.challenges ?? [],
          conversationPlan: data.data?.conversationPlan ?? null,
          conversationThreadId: data.data?.conversationThreadId ?? null,
          isLoading: false,
          isInitializing, // Track async initialization state
          error: null,
        };
      });

      // If async initialization is in progress, poll until complete
      if (isInitializing) {
        console.log('[HomePage] Async initialization in progress, starting polling...');
        const pollForInitialization = async () => {
          const POLL_INTERVAL = 2000; // 2 seconds
          const MAX_POLLS = 15; // Max 30 seconds
          let pollCount = 0;

          const poll = async () => {
            pollCount++;
            if (pollCount > MAX_POLLS) {
              console.warn('[HomePage] Initialization polling timeout');
              setSessionData(prev => ({ ...prev, isInitializing: false }));
              return;
            }

            try {
              const pollResponse = await fetch(`/api/ask/token/${encodeURIComponent(token)}`);
              const pollData: ApiResponse<TokenSessionPayload> = await pollResponse.json();

              if (pollData.success && !pollData.data?.isInitializing) {
                // Initialization complete - update state with new data
                console.log('[HomePage] Initialization complete, updating state');
                setSessionData(prev => ({
                  ...prev,
                  messages: pollData.data?.messages ?? prev.messages,
                  conversationPlan: pollData.data?.conversationPlan ?? prev.conversationPlan,
                  isInitializing: false,
                }));
                return;
              }

              // Still initializing, poll again
              setTimeout(poll, POLL_INTERVAL);
            } catch {
              // Error polling, retry
              setTimeout(poll, POLL_INTERVAL);
            }
          };

          setTimeout(poll, POLL_INTERVAL);
        };

        pollForInitialization();
      }

      // Fallback chain: viewer name > viewer email > URL param > auth user name
      const viewerName = data.data?.viewer?.name ?? data.data?.viewer?.email ?? derivedParticipantName ?? authUserName ?? null;
      setCurrentParticipantName(viewerName);
      setCurrentUserId(data.data?.viewer?.profileId ?? null);
      setIsCurrentParticipantSpokesperson(data.data?.viewer?.isSpokesperson === true);

      // Mark voice config as loading - will be loaded by useEffect
      // This prevents the auto-select effect from running too early
      setIsVoiceConfigLoading(true);

    } catch (error) {
      console.error('Error loading session data by token:', error);
      setSessionData(prev => ({
        ...prev,
        isLoading: false,
        error: parseErrorMessage(error)
      }));
    }
  };

  const loadSessionData = async (key: string) => {
    try {
      // Use test endpoint if in test mode, otherwise use real API
      const endpoint = isTestMode ? `/api/test/${key}` : `/api/ask/${key}`;

      const headers: Record<string, string> = {};
      if (inviteTokenRef.current) {
        headers['X-Invite-Token'] = inviteTokenRef.current;
      }
      
      const response = await fetch(endpoint, {
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      const data: ApiResponse<{
        ask: Ask;
        messages: Message[];
        insights?: Insight[];
        challenges?: any[];
        conversationPlan?: ConversationPlan | null;
        conversationThreadId?: string | null;
        viewer?: {
          participantId: string | null;
          profileId: string | null;
          isSpokesperson: boolean;
          name: string | null;
          email: string | null;
          role: string | null;
        } | null;
      }> = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load session data from backend');
      }

      const hasPersistedMessages = (data.data?.messages ?? []).length > 0;
      hasPostedMessageSinceRefreshRef.current = hasPersistedMessages;

      setSessionData(prev => {
        const messagesFromApi = (data.data?.messages ?? []).map(message => {
          const existing = prev.messages.find(prevMessage => prevMessage.id === message.id);
          return {
            ...message,
            clientId: existing?.clientId ?? message.clientId ?? message.id,
          };
        });

        // Merge: keep messages that aren't yet in API response
        // This prevents messages from disappearing during reload race conditions
        const apiMessageIds = new Set(messagesFromApi.map(m => m.id));
        const now = Date.now();
        const ONE_MINUTE = 60 * 1000;

        // Keep messages not in API response if they're recent (within 1 minute)
        const pendingMessages = prev.messages.filter(m => {
          if (apiMessageIds.has(m.id)) return false;
          if (m.id?.startsWith('temp-') || m.clientId?.startsWith('ai-stream-')) return true;
          const msgTime = m.timestamp ? new Date(m.timestamp).getTime() : 0;
          return (now - msgTime) < ONE_MINUTE;
        });

        const mergedMessages = [...messagesFromApi, ...pendingMessages];

        return {
          ...prev,
          ask: data.data!.ask,
          messages: mergedMessages,
          insights: data.data?.insights ?? [],
          challenges: data.data?.challenges ?? [],
          conversationPlan: data.data?.conversationPlan ?? null,
          conversationThreadId: data.data?.conversationThreadId ?? null,
          isLoading: false,
          error: null,
        };
      });

      // Fallback chain: viewer name > viewer email > URL param > auth user name
      const viewerName = data.data?.viewer?.name ?? data.data?.viewer?.email ?? derivedParticipantName ?? authUserName ?? null;
      setCurrentParticipantName(viewerName);
      setCurrentUserId(data.data?.viewer?.profileId ?? null);

      // Set spokesperson status from viewer info (for key-based access)
      if (data.data?.viewer) {
        setIsCurrentParticipantSpokesperson(data.data.viewer.isSpokesperson === true);
      }

      // Mark voice config as loading - will be loaded by useEffect
      // This prevents the auto-select effect from running too early
      setIsVoiceConfigLoading(true);

    } catch (error) {
      console.error('Error loading session data:', error);
      setSessionData(prev => ({
        ...prev,
        isLoading: false,
        error: parseErrorMessage(error)
      }));
    }
  };

  // Handle voice mode messages
  // Track current streaming message ID to update the same message
  const currentStreamingMessageIdRef = useRef<string | null>(null);
  const currentStreamingMessageClientIdRef = useRef<string | null>(null);

  const handleVoiceMessage = useCallback(async (
    role: 'user' | 'agent',
    content: string,
    metadata?: { isInterim?: boolean; messageId?: string; timestamp?: string; speaker?: string }
  ) => {
    if (!sessionData.askKey || !content.trim()) return;

    const isInterim = metadata?.isInterim || false;
    const messageId = metadata?.messageId;
    const timestamp = metadata?.timestamp || new Date().toISOString();
    const speaker = metadata?.speaker; // Speaker from diarization (S1, S2, etc.)
    const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    if (role === 'user') {
      // IMPORTANT: Never use fallback like 'Vous' - participant name is required
      if (!currentParticipantName) {
        console.error('[handleVoiceMessage] Cannot send user message without participant name');
        return;
      }
      const senderName = currentParticipantName;
      
      // If this is an interim message with messageId, update the existing message
      // Logic: add to the same message until we get an agent response
      if (isInterim && messageId) {
        // Check if we have a current streaming message
        if (currentStreamingMessageIdRef.current === messageId && currentStreamingMessageClientIdRef.current) {
          // Update existing message
          setSessionData(prev => {
            const messageIndex = prev.messages.findIndex(
              msg => msg.clientId === currentStreamingMessageClientIdRef.current
            );
            
            if (messageIndex >= 0) {
              const updated = [...prev.messages];
              updated[messageIndex] = {
                ...updated[messageIndex],
                content, // Update content
                timestamp, // Update timestamp
              };
              return { ...prev, messages: updated };
            }
            
            // Message not found, create new one
            const optimisticMessage: Message = {
              clientId: optimisticId,
              id: optimisticId,
              askKey: sessionData.askKey,
              askSessionId: sessionData.ask?.askSessionId,
              content,
              type: 'text',
              senderType: 'user',
              senderId: null,
              senderName,
              timestamp,
              metadata: {
                voiceTranscribed: true,
                senderName,
                messageId, // Store messageId in metadata
                isInterim: true, // Mark as interim for typewriter effect
              },
            };
            currentStreamingMessageClientIdRef.current = optimisticId;
            return { ...prev, messages: [...prev.messages, optimisticMessage] };
          });
          return; // Don't persist interim messages
        } else {
          // New streaming message, create it
          currentStreamingMessageIdRef.current = messageId;
          const optimisticMessage: Message = {
            clientId: optimisticId,
            id: optimisticId,
            askKey: sessionData.askKey,
            askSessionId: sessionData.ask?.askSessionId,
            content,
            type: 'text',
            senderType: 'user',
            senderId: null,
            senderName,
            timestamp,
            metadata: {
              voiceTranscribed: true,
              senderName,
              messageId, // Store messageId in metadata
            },
          };
          currentStreamingMessageClientIdRef.current = optimisticId;

          setSessionData(prev => ({
            ...prev,
            messages: [...prev.messages, optimisticMessage],
          }));
          return; // Don't persist interim messages
        }
      }
      
      // Final message (not interim) - update existing if it exists, otherwise create new
      if (!isInterim && messageId && currentStreamingMessageIdRef.current === messageId) {
        // Update the existing streaming message to final
        setSessionData(prev => {
          const messageIndex = prev.messages.findIndex(
            msg => msg.clientId === currentStreamingMessageClientIdRef.current
          );
          
          if (messageIndex >= 0) {
            const updated = [...prev.messages];
            updated[messageIndex] = {
              ...updated[messageIndex],
              content, // Final content
              timestamp, // Final timestamp
              metadata: {
                ...updated[messageIndex].metadata,
                messageId, // Preserve messageId in metadata
                isInterim: false, // Mark as final for instant display
              },
            };
            return { ...prev, messages: updated };
          }
          
          // Message not found, create new one
          const optimisticMessage: Message = {
            clientId: optimisticId,
            id: optimisticId,
            askKey: sessionData.askKey,
            askSessionId: sessionData.ask?.askSessionId,
            content,
            type: 'text',
            senderType: 'user',
            senderId: null,
            senderName,
            timestamp,
            metadata: {
              voiceTranscribed: true,
              senderName,
              messageId, // Store messageId in metadata
            },
          };
          return { ...prev, messages: [...prev.messages, optimisticMessage] };
        });
      } else if (!isInterim) {
        // Final message without messageId or different messageId - create new
        const optimisticMessage: Message = {
          clientId: optimisticId,
          id: optimisticId,
          askKey: sessionData.askKey,
          askSessionId: sessionData.ask?.askSessionId,
          content,
          type: 'text',
          senderType: 'user',
          senderId: null,
          senderName,
          timestamp,
          metadata: {
            voiceTranscribed: true,
            senderName,
            messageId, // Store messageId in metadata if available
            isInterim: false, // Final message
          },
        };

        setSessionData(prev => ({
          ...prev,
          messages: [...prev.messages, optimisticMessage],
        }));
      } else {
        // Interim without messageId - skip (shouldn't happen but handle gracefully)
        return;
      }
      
      // Clear streaming message refs if this is a final message
      if (!isInterim) {
        currentStreamingMessageIdRef.current = null;
        currentStreamingMessageClientIdRef.current = null;
      }

      // Persist the message to database (without triggering AI response)
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        const inviteToken = inviteTokenRef.current || sessionData.inviteToken || null;
        if (inviteToken) {
          headers['X-Invite-Token'] = inviteToken;
        }

        const endpoint = isTestMode ? `/api/test/${sessionData.askKey}` : `/api/ask/${sessionData.askKey}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content,
            type: 'text',
            metadata: {
              voiceTranscribed: true,
              messageId, // Preserve messageId in metadata for deduplication
              ...(speaker && { speaker }), // Include speaker from diarization
            },
            senderName,
            timestamp,
          }),
        });

        let data: ApiResponse<{ message: Message }>;
        try {
          data = await response.json();
        } catch {
          throw new Error(`Erreur ${response.status}: ${response.statusText}`);
        }

        if (!response.ok) {
          const errorMessage = data.error || `Erreur ${response.status}: ${response.statusText}`;

          // Show user-friendly error message
          setSessionData(prev => ({
            ...prev,
            error: errorMessage,
            messages: prev.messages.filter(msg => msg.clientId !== optimisticId)
          }));
          
          return;
        }

        if (response.ok && data.success && data.data?.message) {
          markMessagePosted();
          const persistedMessage = data.data.message;
          
          // Create log for user message
          try {
            const logResponse = await fetch(`/api/ask/${sessionData.askKey}/voice-agent/log`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(sessionData.inviteToken ? { 'X-Invite-Token': sessionData.inviteToken } : {}),
              },
              body: JSON.stringify({
                role: 'user',
                content,
                messageId: persistedMessage.id,
              }),
            });

            const logData: ApiResponse<{ logId: string }> = await logResponse.json();
            if (logResponse.ok && logData.success && logData.data?.logId) {
              voiceAgentLogIdRef.current = logData.data.logId;
            }
          } catch (error) {
            console.error('Error creating voice agent log:', error);
          }

          setSessionData(prev => ({
            ...prev,
            messages: prev.messages.map(msg =>
              msg.clientId === optimisticId
                ? { ...persistedMessage, clientId: msg.clientId ?? optimisticId }
                : msg
            ),
          }));

          // Schedule insight detection after voice user message is persisted
          scheduleInsightDetection();
        }
      } catch {
        // Voice message persistence error - silent fail
      }
    } else {
      // Agent response - clear streaming message refs to allow new user message

      currentStreamingMessageIdRef.current = null;
      currentStreamingMessageClientIdRef.current = null;

      // Create AI message from agent response
      const optimisticMessage: Message = {
        clientId: optimisticId,
        id: optimisticId,
        askKey: sessionData.askKey,
        askSessionId: sessionData.ask?.askSessionId,
        content: content,
        type: 'text',
        senderType: 'ai',
        senderId: null,
        senderName: 'Agent',
        timestamp: timestamp,
        metadata: {
          voiceGenerated: true,
        },
      };

      markMessagePosted();
      setSessionData(prev => ({
        ...prev,
        messages: [...prev.messages, optimisticMessage],
      }));

      // Persist the message to database
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (sessionData.inviteToken) {
          headers['X-Invite-Token'] = sessionData.inviteToken;
        }

        const response = await fetch(`/api/ask/${sessionData.askKey}/respond`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: content,
            type: 'text',
            metadata: { voiceGenerated: true },
          }),
        });

        const data: ApiResponse<{ message?: Message; insights?: Insight[]; conversationPlan?: ConversationPlan }> = await response.json();

        if (response.ok && data.success && data.data?.message) {
          // Complete log for agent response
          if (voiceAgentLogIdRef.current) {
            try {
              const logCompleteResponse = await fetch(`/api/ask/${sessionData.askKey}/voice-agent/log`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(sessionData.inviteToken ? { 'X-Invite-Token': sessionData.inviteToken } : {}),
                },
                body: JSON.stringify({
                  role: 'agent',
                  content,
                  logId: voiceAgentLogIdRef.current,
                }),
              });
              voiceAgentLogIdRef.current = null; // Reset after completing
            } catch {
              // Voice agent log completion error - silent fail
            }
          }

          setSessionData(prev => ({
            ...prev,
            messages: prev.messages.map(msg =>
              msg.clientId === optimisticId
                ? { ...data.data!.message!, clientId: msg.clientId ?? optimisticId }
                : msg
            ),
            insights: data.data?.insights ?? prev.insights,
            // Update conversation plan if a step was completed
            conversationPlan: data.data?.conversationPlan ?? prev.conversationPlan,
          }));
        }
      } catch {
        // Voice message persistence error - silent fail
      }
    }
  }, [sessionData.askKey, sessionData.ask?.askSessionId, sessionData.inviteToken, markMessagePosted, currentParticipantName, isTestMode, scheduleInsightDetection]);


  // Load voice mode configuration
  const loadVoiceModeConfig = useCallback(async () => {
    if (!sessionData.ask?.askSessionId) {
      return;
    }

    setIsVoiceConfigLoading(true);
    try {
      // Build API URL with token if available
      const apiUrl = new URL(`/api/ask/${sessionData.askKey}/agent-config`, window.location.origin);
      if (sessionData.inviteToken) {
        apiUrl.searchParams.set('token', sessionData.inviteToken);
      }

      const response = await fetch(apiUrl.toString());

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.data) {
          // CRITICAL: Set all voice config in ONE setState to avoid multiple re-renders
          const modelConfig = data.data.modelConfig;
          if (modelConfig) {
            setVoiceModeConfig({
              systemPrompt: data.data.systemPrompt || null,
              userPrompt: data.data.userPrompt || null,
              promptVariables: data.data.promptVariables || null,
              modelConfig: {
                provider: modelConfig.provider,
                voiceAgentProvider: modelConfig.voiceAgentProvider,
                deepgramSttModel: modelConfig.deepgramSttModel,
                deepgramTtsModel: modelConfig.deepgramTtsModel,
                deepgramLlmProvider: modelConfig.deepgramLlmProvider,
                deepgramLlmModel: modelConfig.deepgramLlmModel,
                speechmaticsSttLanguage: modelConfig.speechmaticsSttLanguage,
                speechmaticsSttOperatingPoint: modelConfig.speechmaticsSttOperatingPoint,
                speechmaticsSttMaxDelay: modelConfig.speechmaticsSttMaxDelay,
                speechmaticsSttEnablePartials: modelConfig.speechmaticsSttEnablePartials,
                speechmaticsLlmProvider: modelConfig.speechmaticsLlmProvider,
                speechmaticsLlmModel: modelConfig.speechmaticsLlmModel,
                speechmaticsApiKeyEnvVar: modelConfig.speechmaticsApiKeyEnvVar,
                elevenLabsVoiceId: modelConfig.elevenLabsVoiceId,
                elevenLabsModelId: modelConfig.elevenLabsModelId,
                promptVariables: data.data.promptVariables || undefined,
              } as any,
            });
          } else {
            // Use default config when no model config is available
            setVoiceModeConfig({
              systemPrompt: data.data.systemPrompt || null,
              userPrompt: data.data.userPrompt || null,
              promptVariables: data.data.promptVariables || null,
              modelConfig: {
                deepgramSttModel: 'nova-3',
                deepgramTtsModel: 'aura-2-thalia-en',
                deepgramLlmProvider: 'anthropic',
                deepgramLlmModel: undefined,
              },
            });
          }
        }
      }
    } catch {
      // Voice config loading error - silent fail, will use defaults
    } finally {
      setIsVoiceConfigLoading(false);
    }
  }, [sessionData.askKey, sessionData.ask?.askSessionId]);

  // Load voice mode config when session loads
  useEffect(() => {
    if (sessionData.ask?.askSessionId) {
      loadVoiceModeConfig();
    }
  }, [sessionData.ask?.askSessionId, loadVoiceModeConfig]);

  // Auto-select text mode when voice mode is not available
  useEffect(() => {
    // Only run when:
    // - Session is loaded
    // - Voice config finished loading
    // - No mode selected yet
    // - Voice mode is NOT available
    if (
      sessionData.ask &&
      !isVoiceConfigLoading &&
      selectedInputMode === null &&
      !voiceModeConfig?.systemPrompt
    ) {
      setSelectedInputMode('text');
    }
  }, [sessionData.ask, isVoiceConfigLoading, selectedInputMode, voiceModeConfig?.systemPrompt]);

  // Handle streaming AI response
  const handleStreamingResponse = useCallback(async (latestUserMessageContent?: string): Promise<boolean> => {
    if (!sessionData.askKey) return false;

    // Annuler la détection d'insights pendant le streaming
    cancelInsightDetectionTimer();

    try {
      const currentAskKey = sessionData.askKey;
      const currentAskSessionId = sessionData.ask?.askSessionId || '';

      const streamHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (sessionData.inviteToken) {
        streamHeaders['X-Invite-Token'] = sessionData.inviteToken;
      }

      // Use functional form to get latest messages without adding to dependencies
      let bodyMessage = latestUserMessageContent && latestUserMessageContent.trim().length > 0
        ? latestUserMessageContent
        : '';

      if (!bodyMessage) {
        // Get last message from state using functional update
        const lastMessage = await new Promise<string>((resolve) => {
          setSessionData(prev => {
            const lastMsg = prev.messages[prev.messages.length - 1]?.content || '';
            resolve(lastMsg);
            return prev; // Don't modify state
          });
        });
        bodyMessage = lastMessage;
      }

      const response = await fetch(`/api/ask/${currentAskKey}/stream`, {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify({
          message: bodyMessage,
          model: 'anthropic', // Par défaut Anthropic, peut être changé
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let streamingMessage = '';
      let insightsUpdatedDuringStream = false;

      // Add a temporary streaming message
      const streamingId = `streaming-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const streamingMessageObj: Message = {
        clientId: streamingId,
        id: streamingId,
        askKey: currentAskKey,
        askSessionId: currentAskSessionId,
        content: '',
        type: 'text',
        senderType: 'ai',
        senderId: null,
        senderName: 'Agent',
        timestamp: new Date().toISOString(),
        metadata: {},
      };

      setSessionData(prev => ({
        ...prev,
        messages: [...prev.messages, streamingMessageObj],
      }));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim()) {
              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'chunk' && parsed.content) {
                  streamingMessage += parsed.content;
                  setSessionData(prev => ({
                    ...prev,
                    messages: prev.messages.map(msg =>
                      msg.clientId === streamingId
                        ? { ...msg, content: streamingMessage }
                        : msg
                    ),
                  }));
                } else if (parsed.type === 'message' && parsed.message) {
                  // Replace the streaming message with the final one
                  // Stop showing "Generating response..." since AI message is complete
                  stopAwaitingAiResponse();
                  markMessagePosted();
                  setSessionData(prev => ({
                    ...prev,
                    messages: prev.messages.map(msg =>
                      msg.clientId === streamingId
                        ? { ...parsed.message, clientId: msg.clientId ?? streamingId }
                        : msg
                    ),
                  }));
                } else if (parsed.type === 'insights') {
                  insightsUpdatedDuringStream = true;
                  const insights = Array.isArray(parsed.insights) ? parsed.insights : [];
                  cancelInsightDetectionTimer();
                  setSessionData(prev => ({
                    ...prev,
                    insights,
                  }));
                } else if (parsed.type === 'step_completed') {
                  // Update conversation plan when a step is completed
                  if (parsed.conversationPlan) {
                    setSessionData(prev => ({
                      ...prev,
                      conversationPlan: parsed.conversationPlan,
                    }));
                  }
                } else if (parsed.type === 'done') {
                  stopAwaitingAiResponse();
                  // Recharger les messages pour afficher le message persisté
                  if (sessionData.inviteToken) {
                    await loadSessionDataByToken(sessionData.inviteToken);
                  } else if (sessionData.askKey) {
                    await loadSessionData(sessionData.askKey);
                  }
                  if (insightsUpdatedDuringStream) {
                    cancelInsightDetectionTimer();
                    setIsDetectingInsights(false);
                  }
                  return insightsUpdatedDuringStream;
                } else if (parsed.type === 'error') {
                  stopAwaitingAiResponse();
                  return false;
                }
              } catch {
                // Ignore parsing errors for incomplete chunks
              }
            }
          }
        }
      }

      return insightsUpdatedDuringStream;
    } catch (streamingError) {
      console.error('[handleStreamingResponse] Error during AI streaming:', streamingError);
      // Report to Sentry for production debugging
      if (typeof window !== 'undefined' && (window as any).Sentry) {
        (window as any).Sentry.captureException(streamingError, {
          tags: { component: 'handleStreamingResponse' },
          extra: { askKey: sessionData.askKey },
        });
      }
      stopAwaitingAiResponse();
      return false;
    }
  }, [
    sessionData.askKey,
    sessionData.ask?.askSessionId,
    sessionData.inviteToken,
    cancelInsightDetectionTimer,
    markMessagePosted,
    stopAwaitingAiResponse,
    loadSessionDataByToken,
    loadSessionData,
  ]);

  // Handle sending messages to database and schedule AI response
  const handleSendMessage = useCallback(async (
    content: string,
    type: Message['type'] = 'text',
    metadata?: Message['metadata']
  ) => {
    if (!sessionData.askKey || sessionData.isLoading) {
      return;
    }

    // IMPORTANT: Never use fallback like 'Vous' - participant name is required
    if (!currentParticipantName) {
      console.error('[handleSendMessage] Cannot send user message without participant name');
      return;
    }

    const timestamp = new Date().toISOString();
    const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const senderName = currentParticipantName;
    const optimisticMetadata = {
      ...(metadata ?? {}),
      senderName,
    } as Message['metadata'];

    const optimisticMessage: Message = {
      clientId: optimisticId,
      id: optimisticId,
      askKey: sessionData.askKey,
      askSessionId: sessionData.ask?.askSessionId,
      content,
      type,
      senderType: 'user',
      senderId: null,
      senderName,
      timestamp,
      metadata: optimisticMetadata,
    };

    setSessionData(prev => ({
      ...prev,
      messages: [...prev.messages, optimisticMessage],
      isLoading: true,
    }));

    // Sync timer to server BEFORE sending message
    // This ensures step elapsed time is up-to-date for the agent's response
    await sessionTimer.syncToServer();

    try {
      // First, save the user message
      const endpoint = isTestMode ? `/api/test/${sessionData.askKey}` : `/api/ask/${sessionData.askKey}`;

      // Include invite token in headers if available (for anonymous/invite-based access)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (sessionData.inviteToken) {
        headers['X-Invite-Token'] = sessionData.inviteToken;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content,
          type,
          metadata,
          senderName,
          timestamp,
        })
      });

      const data: ApiResponse<{ message: Message }> = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to send message');
      }

      // Update the optimistic message with the real one
      if (data.data?.message) {
        markMessagePosted();
        setSessionData(prev => ({
          ...prev,
          messages: prev.messages.map(message =>
            message.clientId === optimisticId
              ? { ...data.data!.message, clientId: message.clientId ?? optimisticId }
              : message
          ),
          isLoading: false,
        }));
      } else {
        setSessionData(prev => ({
          ...prev,
          isLoading: false,
        }));
      }

      // Now trigger the streaming AI response
      if (isTestMode) {
        stopAwaitingAiResponse();
        return;
      }

      // In consultant mode, the AI does NOT respond automatically
      // The spokesperson asks questions manually using the suggested questions panel
      const currentConversationMode = sessionData.ask?.conversationMode;
      if (currentConversationMode === 'consultant') {
        stopAwaitingAiResponse();
        return;
      }

      startAwaitingAiResponse();
      // Spec: 2 secondes de délai après POST message avant de déclencher la réponse AI
      await new Promise(resolve => setTimeout(resolve, 2000));
      const insightsCapturedDuringStream = await handleStreamingResponse(content);

      // Programmer la détection d'insights seulement si aucune donnée n'a été envoyée pendant le streaming
      if (!insightsCapturedDuringStream) {
        scheduleInsightDetection();
      }

    } catch (error) {
      console.error('[handleSendMessage] Error sending message:', error);
      // Report to Sentry for production debugging
      if (typeof window !== 'undefined' && (window as any).Sentry) {
        (window as any).Sentry.captureException(error, {
          tags: { component: 'handleSendMessage' },
          extra: { askKey: sessionData.askKey, content },
        });
      }
      stopAwaitingAiResponse();
      setSessionData(prev => ({
        ...prev,
        isLoading: false,
        messages: prev.messages.filter(message => message.clientId !== optimisticId),
        error: parseErrorMessage(error)
      }));
    }
  }, [
    sessionData.askKey,
    sessionData.isLoading,
    sessionData.ask?.askSessionId,
    sessionData.inviteToken,
    awaitingAiResponse,
    isDetectingInsights,
    isTestMode,
    currentParticipantName,
    markMessagePosted,
    stopAwaitingAiResponse,
    startAwaitingAiResponse,
    handleStreamingResponse,
    scheduleInsightDetection,
  ]);

  // Handle editing a message (for correcting transcription errors)
  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    if (!sessionData.askKey) {
      throw new Error('No ask key available');
    }

    // Validate that the message has been persisted to the database (not a temp ID)
    if (messageId.startsWith('temp-')) {
      throw new Error('Message is still being saved. Please wait a moment and try again.');
    }

    // Build the endpoint
    const endpoint = `/api/ask/${sessionData.askKey}/message/${messageId}`;

    // Include invite token in headers if available
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (sessionData.inviteToken) {
      headers['X-Invite-Token'] = sessionData.inviteToken;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          content: newContent,
          deleteSubsequent: true, // Delete all messages after this one
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to edit message');
      }

      // Update local state: update the edited message and remove subsequent messages
      setSessionData(prev => {
        const messageIndex = prev.messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) {
          return prev;
        }

        // Keep messages up to and including the edited one
        const messagesBeforeEdit = prev.messages.slice(0, messageIndex);
        const editedMessage = {
          ...prev.messages[messageIndex],
          content: newContent,
          metadata: {
            ...prev.messages[messageIndex].metadata,
            isEdited: true,
            editedAt: new Date().toISOString(),
          },
        };

        return {
          ...prev,
          messages: [...messagesBeforeEdit, editedMessage],
        };
      });

      // Trigger AI response for the edited message - but NOT in voice mode
      // In voice mode, the voice agent should handle the response naturally
      if (!isVoiceModeActive) {
        // Schedule streaming response just like handleSendMessage does
        setTimeout(async () => {
          try {
            await handleStreamingResponse(newContent);
          } catch {
            // Streaming error handled silently
          }
        }, 100);
      }
    } catch (error) {
      throw error;
    }
  }, [sessionData.askKey, sessionData.inviteToken, handleStreamingResponse, isVoiceModeActive]);

  // Retry loading session data
  const retryLoad = () => {
    if (sessionData.inviteToken) {
      loadSessionDataByToken(sessionData.inviteToken);
    } else if (sessionData.askKey) {
      loadSessionData(sessionData.askKey);
    }
  };

  // Reload messages after voice mode closes
  const reloadMessagesAfterVoiceMode = useCallback(async () => {
    // Use a function that reads current state
    setSessionData(prev => {
      if (prev.inviteToken) {
        loadSessionDataByToken(prev.inviteToken).catch(() => {});
      } else if (prev.askKey) {
        loadSessionData(prev.askKey).catch(() => {});
      }
      return prev; // Don't modify state, just trigger reload
    });
  }, [loadSessionDataByToken, loadSessionData]);

  // Handle voice mode toggle (mémorisé pour éviter les re-renders de ChatComponent)
  const handleVoiceModeChange = useCallback((active: boolean) => {
    const wasActive = isVoiceModeActive;
    setIsVoiceModeActive(active);
    // Reload messages when voice mode is closed to ensure voice messages appear in text mode
    if (wasActive && !active) {
      setTimeout(() => {
        reloadMessagesAfterVoiceMode();
      }, 1000);
    }
  }, [isVoiceModeActive, reloadMessagesAfterVoiceMode]);

  // Handle insight content update
  const handleInsightUpdate = useCallback((insightId: string, newContent: string) => {
    setSessionData(prev => ({
      ...prev,
      insights: prev.insights.map(insight =>
        insight.id === insightId
          ? { ...insight, content: newContent, summary: null }
          : insight
      ),
    }));
  }, []);

  // Clear error
  const clearError = () => {
    setSessionData(prev => ({ ...prev, error: null }));
  };

  // Render public ASK entry form (for ?ask=<key> flow)
  if (publicAskEntry) {
    // Loading state
    if (publicAskEntry.isLoading) {
      return (
        <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-lg"
          >
            <div className="text-center space-y-8">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="mx-auto w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center shadow-lg"
              >
                <Sparkles className="h-8 w-8 text-white" />
              </motion.div>
              <p className="text-slate-400">Chargement...</p>
            </div>
          </motion.div>
        </div>
      );
    }

    // Error state for public ASK
    if (publicAskEntry.error) {
      return (
        <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md"
          >
            <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
              <CardHeader className="text-center">
                <motion.div
                  initial={{ rotate: 0 }}
                  animate={{ rotate: [0, -10, 10, -10, 0] }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className="mx-auto w-16 h-16 bg-gradient-to-br from-red-400 to-red-600 rounded-full flex items-center justify-center mb-4"
                >
                  <AlertCircle className="h-8 w-8 text-white" />
                </motion.div>
                <CardTitle className="text-xl text-white">Session introuvable</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-400 text-center">{publicAskEntry.error}</p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      );
    }

    // Render the public entry form
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-center justify-center p-4">
        <PublicAskEntryForm
          askKey={publicAskEntry.askKey}
          askName={publicAskEntry.askName ?? undefined}
          askQuestion={publicAskEntry.askQuestion ?? undefined}
        />
      </div>
    );
  }

  // Render error state with beautiful UI
  if (sessionData.error) {
    const isAccessDenied = sessionData.error.toLowerCase().includes('non autorisé') ||
                           sessionData.error.toLowerCase().includes('unauthorized') ||
                           sessionData.error.toLowerCase().includes('permission');

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full"
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <Logo textClassName="text-[10rem] leading-none" taglineClassName="text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]" showTagline />
          </div>

          <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
            <CardHeader className="text-center">
              <motion.div
                initial={{ rotate: 0 }}
                animate={{ rotate: [0, -10, 10, -10, 0] }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
                  isAccessDenied
                    ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                    : 'bg-gradient-to-br from-red-400 to-red-600'
                }`}
              >
                {isAccessDenied ? (
                  <Lock className="h-8 w-8 text-white" />
                ) : (
                  <AlertCircle className="h-8 w-8 text-white" />
                )}
              </motion.div>
              <CardTitle className={`text-xl ${isAccessDenied ? 'text-amber-400' : 'text-red-400'}`}>
                {isAccessDenied ? 'Accès restreint' : 'Session Error'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isAccessDenied ? (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-slate-300 text-center mb-3">
                    Vous n&apos;êtes pas encore participant à cette session ASK.
                  </p>
                  <p className="text-sm text-slate-400 text-center">
                    Contactez l&apos;organisateur pour recevoir une invitation, ou vérifiez que vous utilisez le bon lien.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-slate-300 text-center">{sessionData.error}</p>
                </div>
              )}

              {/* Show format example for ASK key errors */}
              {sessionData.error.includes('ASK key') && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20"
                >
                  <p className="text-sm font-medium mb-2 text-indigo-400">Expected URL format:</p>
                  <code className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-300 block">
                    https://your-domain.com/?token=your-invite-token
                  </code>
                  <p className="text-xs text-slate-400 mt-2 text-center">
                    Use the link provided in your invitation email.
                  </p>
                </motion.div>
              )}

              <div className="flex gap-3 pt-2">
                {sessionData.askKey && (
                  <Button
                    onClick={retryLoad}
                    variant="outline"
                    className="flex-1 border-white/10 text-slate-300 hover:bg-slate-800"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                )}
                <Button
                  onClick={clearError}
                  variant="ghost"
                  className="flex-1 text-slate-300 hover:bg-slate-800"
                >
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Render loading state with beautiful animations
  // Show when: initial session loading OR voice config loading (before mode selection)
  const showLoadingScreen = (sessionData.isLoading && !sessionData.ask) ||
    (sessionData.ask && isVoiceConfigLoading && selectedInputMode === null);

  if (showLoadingScreen) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-lg"
        >
          <div className="text-center space-y-8">
            {/* Logo */}
            <div className="mb-4">
              <Logo textClassName="text-[10rem] leading-none" taglineClassName="text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]" showTagline />
            </div>

            {/* Animated loading spinner */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="mx-auto w-16 h-16 bg-gradient-to-br from-pink-500 to-rose-400 rounded-full flex items-center justify-center shadow-lg"
            >
              <Sparkles className="h-8 w-8 text-white" />
            </motion.div>

            <div className="space-y-4">
              <motion.h2
                animate={{ opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-xl font-semibold text-white"
              >
                {isTestMode ? 'Chargement du test...' : 'Préparation de votre entretien...'}
              </motion.h2>

              {/* Progress bar */}
              <div className="max-w-xs mx-auto">
                <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ x: '-100%' }}
                    animate={{ x: '200%' }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    className="h-full w-1/3 bg-gradient-to-r from-pink-500 to-rose-400 rounded-full"
                  />
                </div>
              </div>
            </div>

            {/* Question preview card */}
            {sessionData.ask && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="mt-8 bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
              >
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-3">
                  Question de l&apos;entretien
                </p>
                <h3 className="text-lg font-medium text-white leading-relaxed">
                  {sessionData.ask.question}
                </h3>
                {sessionData.ask.description && (
                  <p className="mt-4 text-slate-300 text-sm leading-relaxed">
                    {sessionData.ask.description}
                  </p>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  // Check if voice mode is available (has system prompt configured)
  const isVoiceModeAvailable = !!voiceModeConfig?.systemPrompt;

  // Show mode selection screen when:
  // - Session is loaded
  // - Voice mode is available
  // - User hasn't selected a mode yet
  // - Voice config has finished loading
  if (sessionData.ask && isVoiceModeAvailable && selectedInputMode === null && !isVoiceConfigLoading) {
    const userName = currentParticipantName?.split(' ')[0] || currentParticipantName || 'vous';

    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-start sm:items-center justify-center p-4 pt-8 pb-24 sm:py-8 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-lg sm:my-auto"
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <Logo textClassName="text-[10rem] leading-none" taglineClassName="text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]" showTagline />
          </div>

          {/* Welcome message */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center mb-6"
          >
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              Bienvenue {userName} !
            </h1>
          </motion.div>

          {/* Question preview card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/10 mb-8"
          >
            <p className="text-slate-400 text-xs uppercase tracking-wider mb-3">
              Question de l&apos;entretien
            </p>
            <h3 className="text-lg font-medium text-white leading-relaxed">
              {sessionData.ask.question}
            </h3>
            {sessionData.ask.description && (
              <p className="mt-4 text-slate-300 text-sm leading-relaxed">
                {sessionData.ask.description}
              </p>
            )}
          </motion.div>

          {/* Mode selection prompt */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-center text-slate-300 mb-4"
          >
            Comment voulez-vous répondre ?
          </motion.p>

          {/* Mode selection buttons */}
          <div className="space-y-3">
            {/* Voice mode button */}
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setSelectedInputMode('voice');
                setIsVoiceModeActive(true);
              }}
              className="w-full bg-white hover:bg-gray-50 rounded-2xl p-5 flex items-center gap-4 shadow-lg hover:shadow-xl transition-all duration-200 group"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-pink-100 to-rose-100 rounded-xl flex items-center justify-center group-hover:from-pink-200 group-hover:to-rose-200 transition-colors">
                <Mic className="h-6 w-6 text-pink-600" />
              </div>
              <span className="text-lg font-semibold text-slate-700">Voix</span>
            </motion.button>

            {/* Text mode button */}
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setSelectedInputMode('text');
              }}
              className="w-full bg-white hover:bg-gray-50 rounded-2xl p-5 flex items-center gap-4 shadow-lg hover:shadow-xl transition-all duration-200 group"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-pink-100 to-rose-100 rounded-xl flex items-center justify-center group-hover:from-pink-200 group-hover:to-rose-200 transition-colors">
                <MessageSquareText className="h-6 w-6 text-pink-600" />
              </div>
              <span className="text-lg font-semibold text-slate-700">Texte</span>
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="conversation-layout min-h-[100dvh] overflow-x-hidden w-full max-w-full">
      {/* Session Expired Overlay */}
      <AnimatePresence>
        {isTokenExpired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="mx-4 max-w-md w-full"
            >
              <Card className="overflow-hidden shadow-2xl border-0">
                <div className="h-2 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500" />
                <CardHeader className="text-center pb-2">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="mx-auto w-16 h-16 bg-gradient-to-br from-amber-100 to-orange-100 rounded-full flex items-center justify-center mb-4 shadow-inner"
                  >
                    <Clock className="h-8 w-8 text-amber-600" />
                  </motion.div>
                  <CardTitle className="text-xl font-bold text-gray-800">
                    Session expirée
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-4 pb-6">
                  <p className="text-gray-600">
                    Votre session a expiré après une longue période d&apos;inactivité.
                    Actualisez la page pour continuer.
                  </p>
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button
                      onClick={() => window.location.reload()}
                      className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Actualiser la page
                    </Button>
                  </motion.div>
                  <p className="text-xs text-gray-400">
                    Vos messages précédents seront conservés
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Beautiful Header - Compact on scroll, hides on mobile scroll down */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{
          opacity: isMobile && isMobileHeaderHidden ? 0 : 1,
          y: 0,
          height: isMobile && isMobileHeaderHidden ? 0 : 'auto',
        }}
        transition={{ duration: 0.2 }}
        className="conversation-layout-header sticky top-0 z-50 overflow-hidden"
      >
        <motion.div
          className="px-2 sm:px-4"
          animate={{
            paddingTop: isHeaderCompact ? 2 : 0,
            paddingBottom: isHeaderCompact ? 2 : 0,
          }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex items-center justify-between gap-2">
            <motion.div
              className="flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 400 }}
            >
              <div className="flex flex-col">
                <Logo
                  animated
                  showTagline={!isHeaderCompact}
                  align="start"
                  textClassName={isHeaderCompact ? "text-[1.8rem] leading-none" : "text-[3.9rem] leading-none"}
                  taglineClassName="text-[0.5rem] tracking-[0.25em] -mt-1"
                />
                <motion.div
                  className="flex gap-1 mt-1"
                  animate={{
                    opacity: isHeaderCompact ? 0 : 1,
                    height: isHeaderCompact ? 0 : 'auto',
                  }}
                  transition={{ duration: 0.15 }}
                >
                  {isTestMode && (
                    <span className="test-mode-badge text-[10px]">TEST</span>
                  )}
                  {isDevMode && isSharedThread && !isSubscribed && !isPolling && (
                    <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded border border-orange-300" title="En mode dev, la synchronisation temps réel ne fonctionne pas. Utilisez ?token= pour activer le realtime.">
                      ⚠️ Realtime off
                    </span>
                  )}
                </motion.div>
              </div>
            </motion.div>
            {currentParticipantName && !isMobile && (
              <span className="text-xs text-slate-400">{currentParticipantName}</span>
            )}
          </div>
        </motion.div>
      </motion.header>

      {/* Main Content with Beautiful Layout */}
      {isMobile ? (
        <MobileLayout
          sessionData={sessionData}
          currentParticipantName={currentParticipantName}
          awaitingAiResponse={awaitingAiResponse}
          voiceModeConfig={voiceModeConfig}
          isDetectingInsights={isDetectingInsights}
          onSendMessage={handleSendMessage}
          onVoiceMessage={handleVoiceMessage}
          setIsReplyBoxFocused={setIsReplyBoxFocused}
          setIsVoiceModeActive={setIsVoiceModeActive}
          isVoiceModeActive={isVoiceModeActive}
          reloadMessagesAfterVoiceMode={reloadMessagesAfterVoiceMode}
          onEditMessage={handleEditMessage}
          mobileActivePanel={mobileActivePanel}
          setMobileActivePanel={setMobileActivePanel}
          isMobileHeaderExpanded={isMobileHeaderExpanded}
          setIsMobileHeaderExpanded={setIsMobileHeaderExpanded}
          askDetails={askDetails}
          sessionDataAskKey={sessionData.askKey}
          participants={participants}
          statusLabel={statusLabel}
          timelineLabel={timelineLabel}
          timeRemaining={timeRemaining}
          onInsightUpdate={handleInsightUpdate}
          sessionElapsedMinutes={sessionTimer.elapsedMinutes}
          isSessionTimerPaused={sessionTimer.isPaused}
          onToggleTimerPause={handleToggleTimerPause}
          onUserTyping={sessionTimer.notifyUserTyping}
          isConsultantMode={isConsultantMode}
          isSpokesperson={isSpokesperson}
          consultantQuestions={consultantAnalysis.questions}
          isConsultantAnalyzing={consultantAnalysis.isAnalyzing}
          currentUserId={currentUserId}
          isHeaderHidden={isMobileHeaderHidden}
          onChatScroll={handleMobileChatScroll}
          onSpeakerChange={consultantAnalysis.notifySpeakerChange}
        />
      ) : (
        <main className={`flex overflow-hidden gap-6 p-6 min-w-0 transition-all duration-200 ${isHeaderCompact ? 'h-[calc(100dvh-48px)]' : 'h-[calc(100dvh-88px)]'}`}>
          {/* Chat Section - 1/3 of screen with glass effect */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="w-1/3 min-w-0"
          >
            <div className="chat-container h-full flex flex-col">
              {sessionData.conversationPlan && (
                <ConversationProgressBar
                  steps={sessionData.conversationPlan.plan_data.steps}
                  currentStepId={sessionData.conversationPlan.current_step_id}
                  elapsedMinutes={sessionTimer.elapsedMinutes}
                  isTimerPaused={sessionTimer.isPaused}
                  onTogglePause={handleToggleTimerPause}
                />
              )}
              <div className="flex-1 overflow-hidden">
                <ChatComponent
                  key={`chat-desktop-${sessionData.askKey}`}
                  askKey={sessionData.askKey}
                  ask={sessionData.ask}
                  messages={sessionData.messages}
                  conversationPlan={sessionData.conversationPlan}
                  onSendMessage={handleSendMessage}
                  isLoading={sessionData.isLoading}
                  isInitializing={sessionData.isInitializing}
                  onHumanTyping={sessionTimer.notifyUserTyping}
                  currentParticipantName={currentParticipantName}
                  currentUserId={currentUserId}
                  isMultiUser={Boolean(sessionData.ask && sessionData.ask.participants.length > 1)}
                  showAgentTyping={awaitingAiResponse && !isDetectingInsights}
                  voiceModeEnabled={!!voiceModeConfig?.systemPrompt}
                  initialVoiceMode={selectedInputMode === 'voice'}
                  voiceModeSystemPrompt={voiceModeConfig?.systemPrompt || undefined}
                  voiceModeUserPrompt={voiceModeConfig?.userPrompt || undefined}
                  voiceModePromptVariables={voiceModeConfig?.promptVariables || undefined}
                  voiceModeModelConfig={voiceModeConfig?.modelConfig || undefined}
                  onVoiceMessage={handleVoiceMessage}
                  onReplyBoxFocusChange={setIsReplyBoxFocused}
                  onVoiceModeChange={handleVoiceModeChange}
                  onEditMessage={handleEditMessage}
                  consultantMode={sessionData.ask?.conversationMode === 'consultant'}
                  onSpeakerChange={consultantAnalysis.notifySpeakerChange}
                  elapsedMinutes={sessionTimer.elapsedMinutes}
                  isTimerPaused={sessionTimer.isPaused}
                  onTogglePause={handleToggleTimerPause}
                  onChatScroll={handleMobileChatScroll}
                />
              </div>
            </div>
          </motion.div>

          {/* Insight Section - 2/3 of screen with enhanced styling */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-1 min-w-0"
          >
            <div className="h-full flex flex-col overflow-hidden gap-4">
              {useCompactMode ? (
                /* Compact tabbed mode - when details collapsed and minimal content */
                <div className="h-full flex flex-col light-aurora-card p-4">
                  {/* Tab buttons */}
                  <div className="flex items-center gap-2 pb-3 border-b border-slate-200/60 mb-3">
                    {isConsultantMode && isSpokesperson && (
                      <button
                        onClick={() => setDesktopRightPanelTab('questions')}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all text-sm font-medium",
                          desktopRightPanelTab === 'questions'
                            ? 'light-tab-active'
                            : 'light-tab-inactive'
                        )}
                      >
                        <Sparkles className="h-4 w-4" />
                        Questions
                      </button>
                    )}
                    <button
                      onClick={() => setDesktopRightPanelTab('details')}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all text-sm font-medium",
                        desktopRightPanelTab === 'details'
                          ? 'light-tab-active'
                          : 'light-tab-inactive'
                      )}
                    >
                      <Info className="h-4 w-4" />
                      Détails
                    </button>
                    <button
                      onClick={() => setDesktopRightPanelTab('insights')}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all text-sm font-medium",
                        desktopRightPanelTab === 'insights'
                          ? 'light-tab-active'
                          : 'light-tab-inactive'
                      )}
                    >
                      <Lightbulb className="h-4 w-4" />
                      Insights
                    </button>
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 min-h-0 overflow-auto">
                    <AnimatePresence mode="wait">
                      {desktopRightPanelTab === 'questions' && isConsultantMode && isSpokesperson && (
                        <motion.div
                          key="questions-tab"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <SuggestedQuestionsPanel
                            questions={consultantAnalysis.questions}
                            isAnalyzing={consultantAnalysis.isAnalyzing}
                          />
                        </motion.div>
                      )}
                      {desktopRightPanelTab === 'details' && askDetails && (
                        <motion.div
                          key="details-tab"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-4"
                        >
                          <div>
                            <h3 className="font-semibold tracking-tight text-sm leading-snug text-foreground mb-2">
                              {askDetails.question}
                            </h3>
                            {askDetails.description && (
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {askDetails.description}
                              </p>
                            )}
                          </div>
                          <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                            <div className="space-y-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">Session</p>
                              <div className="flex flex-wrap items-center gap-1">
                                {sessionData.askKey && (
                                  <span className="inline-flex items-center rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
                                    <span className="font-mono">{sessionData.askKey}</span>
                                  </span>
                                )}
                                {sessionData.ask && (
                                  <span className={sessionData.ask.isActive ? 'light-status-active' : 'light-status-closed'}>
                                    {sessionData.ask.isActive ? 'Active' : 'Closed'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">Statut</p>
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                  {statusLabel}
                                </span>
                                {timeRemaining && (
                                  <span className="inline-flex items-center gap-1 text-primary text-[10px]">
                                    <Clock className="h-3 w-3" />
                                    <span>{timeRemaining}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">Cadre</p>
                              <div className="space-y-0.5 text-foreground">
                                <p className="font-medium text-[10px]">
                                  {getDeliveryModeLabel(askDetails.deliveryMode)}
                                </p>
                                <p className="text-muted-foreground text-[10px]">
                                  {getConversationModeDescription(askDetails.conversationMode)}
                                </p>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                                Participants ({participants.length})
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {participants.length > 0 ? (
                                  participants.map(participant => (
                                    <span
                                      key={participant.id}
                                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                                    >
                                      <span className="font-medium text-primary/90">{participant.name}</span>
                                      {participant.isSpokesperson && (
                                        <span className="text-[9px] uppercase tracking-wide text-primary/70">PP</span>
                                      )}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-muted-foreground text-[10px]">Aucun participant</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                      {desktopRightPanelTab === 'insights' && (
                        <motion.div
                          key="insights-tab"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className="h-full"
                        >
                          <InsightPanel
                            insights={sessionData.insights}
                            askKey={sessionData.askKey}
                            isDetectingInsights={isDetectingInsights}
                            onInsightUpdate={handleInsightUpdate}
                            isConsultantMode={isConsultantMode}
                            isSpokesperson={isSpokesperson}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              ) : (
                /* Normal stacked mode */
                <>
                  {/* Ask Details Card */}
                  {askDetails && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{
                        opacity: 1,
                        y: 0
                      }}
                      className="light-aurora-card px-4 py-3 transition-all duration-300"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1 sm:pr-4">
                            <h3 className="font-semibold tracking-tight text-xs sm:text-sm leading-snug text-foreground">
                              {askDetails.question}
                            </h3>
                            {askDetails.description && !isDetailsCollapsed && (
                              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                                {askDetails.description}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsDetailsCollapsed(prev => !prev)}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-start"
                            aria-expanded={!isDetailsCollapsed}
                          >
                            {isDetailsCollapsed ? (
                              <>
                                <ChevronDown className="h-4 w-4" />
                                Infos
                              </>
                            ) : (
                              <>
                                <ChevronUp className="h-4 w-4" />
                                Masquer
                              </>
                            )}
                          </Button>
                        </div>

                        <AnimatePresence initial={false}>
                          {!isDetailsCollapsed && (
                            <motion.div
                              key="ask-details"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">Session</p>
                                  <div className="flex flex-wrap items-center gap-1">
                                    {sessionData.askKey && (
                                      <span className="inline-flex items-center rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
                                        Session:
                                        <span className="font-mono text-foreground ml-1">{sessionData.askKey}</span>
                                      </span>
                                    )}
                                    {sessionData.ask && (
                                      <span className={sessionData.ask.isActive ? 'light-status-active' : 'light-status-closed'}>
                                        {sessionData.ask.isActive ? 'Active' : 'Closed'}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">Statut</p>
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                      {statusLabel}
                                    </span>
                                    {timeRemaining && (
                                      <span className="inline-flex items-center gap-1 text-primary text-[10px]">
                                        <Clock className="h-3 w-3" />
                                        <span>{timeRemaining}</span>
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">Cadre</p>
                                  <div className="space-y-0.5 text-foreground">
                                    <p className="font-medium text-[10px]">
                                      {getDeliveryModeLabel(askDetails.deliveryMode)}
                                    </p>
                                    <p className="text-muted-foreground text-[10px]">
                                      {getConversationModeDescription(askDetails.conversationMode)}
                                    </p>
                                  </div>
                                </div>

                                <div className="space-y-1 sm:col-span-3">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                                    Participants ({participants.length})
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {participants.length > 0 ? (
                                      participants.map(participant => (
                                        <span
                                          key={participant.id}
                                          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                                        >
                                          <span className="font-medium text-primary/90">{participant.name}</span>
                                          {participant.isSpokesperson && (
                                            <span className="text-[9px] uppercase tracking-wide text-primary/70">porte-parole</span>
                                          )}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-muted-foreground text-[10px]">Aucun participant pour le moment</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}

                  {/* Suggested Questions Panel - Consultant mode, spokesperson only */}
                  {isConsultantMode && isSpokesperson && (
                    <SuggestedQuestionsPanel
                      questions={consultantAnalysis.questions}
                      isAnalyzing={consultantAnalysis.isAnalyzing}
                    />
                  )}

                  {/* Insights Panel - with reduced height */}
                  <div ref={insightsPanelRef} className="flex-1 min-h-0 overflow-hidden">
                    <InsightPanel
                      insights={sessionData.insights}
                      askKey={sessionData.askKey}
                      isDetectingInsights={isDetectingInsights}
                      onInsightUpdate={handleInsightUpdate}
                      isConsultantMode={isConsultantMode}
                      isSpokesperson={isSpokesperson}
                    />
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </main>
      )}

      {/* Floating Error Toast */}
      {sessionData.error && (
        <motion.div
          initial={{ opacity: 0, y: 100, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 100, scale: 0.8 }}
          className="fixed bottom-6 right-6 max-w-md z-50"
        >
          <div className="error-toast p-4 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-red-400 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-sm text-muted-foreground mt-1">{sessionData.error}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearError}
                className="h-8 w-8 p-0 hover:bg-white/20 rounded-full"
              >
                ×
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
