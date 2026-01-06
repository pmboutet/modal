// Types for the ASK system and conversations
export type AskDeliveryMode = "physical" | "digital";

// Conversation mode determines thread isolation and visibility
export type AskConversationMode =
  | "individual_parallel"  // Multiple people respond individually, no cross-visibility
  | "collaborative"        // Multi-voice conversation, everyone sees everything
  | "group_reporter"       // Group contributes, one reporter consolidates
  | "consultant";          // AI listens and suggests questions to consultant, no TTS

export interface AskParticipant {
  id: string;
  userId?: string | null; // Profile ID of the participant (for message alignment in voice mode)
  name: string;
  email?: string | null;
  role?: string | null;
  isSpokesperson?: boolean;
  isActive: boolean;
  inviteToken?: string | null;
  /** Accumulated active session time in seconds */
  elapsedActiveSeconds?: number;
}

export interface Ask {
  id: string;
  key: string;
  name?: string | null;
  question: string;
  description?: string | null;
  status?: string | null;
  isActive: boolean;
  startDate?: string | null; // ISO string
  endDate: string; // ISO string
  createdAt: string;
  updatedAt: string;
  deliveryMode: AskDeliveryMode;
  conversationMode: AskConversationMode;
  participants: AskParticipant[];
  askSessionId?: string;
}

// Types for conversation messages
export type MessageSenderType = 'user' | 'ai' | 'system';

export interface Message {
  /**
   * Stable identifier used on the client to avoid React remounts while keeping server ids
   */
  clientId?: string;
  id: string;
  askKey: string;
  askSessionId?: string;
  conversationThreadId?: string | null;
  content: string;
  type: 'text' | 'audio' | 'image' | 'document';
  senderType: MessageSenderType;
  senderId?: string | null;
  senderName?: string | null;
  timestamp: string;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number; // for audio files
    senderName?: string;
    [key: string]: unknown;
  };
}

// Types for challenges and their components
export interface KpiEstimation {
  description: string;
  value: Record<string, any>; // Flexible JSON format for KPI data
}

export interface Pain {
  id: string;
  name: string;
  description: string;
  kpiEstimations: KpiEstimation[];
}

export interface Gain {
  id: string;
  name: string;
  description: string;
  kpiEstimations: KpiEstimation[];
}

export interface Challenge {
  id: string;
  name: string;
  pains: Pain[];
  gains: Gain[];
  updatedAt: string;
  isHighlighted?: boolean; // For visual feedback on updates
}

export interface InsightKpi {
  id: string;
  label: string;
  value?: Record<string, any>;
  description?: string | null;
}

export type InsightStatus = "new" | "reviewed" | "implemented" | "archived";
export type InsightType = "pain" | "gain" | "opportunity" | "risk" | "signal" | "idea";

export interface InsightAuthor {
  id: string;
  userId?: string | null;
  name?: string | null;
}

export interface Insight {
  id: string;
  askId: string;
  askSessionId: string;
  conversationThreadId?: string | null;
  challengeId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  authors: InsightAuthor[];
  content: string;
  summary?: string | null;
  type: InsightType;
  category?: string | null;
  status: InsightStatus;
  priority?: string | null;
  createdAt: string;
  updatedAt: string;
  relatedChallengeIds: string[];
  kpis: InsightKpi[];
  sourceMessageId?: string | null;
}

export interface ConversationThread {
  id: string;
  askSessionId: string;
  userId: string | null;
  isShared: boolean;
  createdAt: string;
}

// Types for webhook payloads
export interface WebhookAskPayload {
  askKey: string;
  question: string;
  endDate: string;
}

export interface WebhookResponsePayload {
  askKey: string;
  content: string;
  type: 'text' | 'audio' | 'image' | 'document';
  metadata?: Message['metadata'];
}

export interface WebhookChallengePayload {
  askKey: string;
  challenges: Challenge[];
  insights?: Insight[];
  action: 'update' | 'replace';
}

// Types for API responses
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Types for file uploads
export interface FileUpload {
  file: File;
  type: 'audio' | 'image' | 'document';
  preview?: string; // For images
}

// Types for conversation plan
export interface ConversationPlanStep {
  id: string;
  title: string;
  objective: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
}

export interface ConversationPlanData {
  title: string;
  description: string;
  steps: ConversationPlanStep[];
}

export interface ConversationPlan {
  id: string;
  conversation_thread_id: string;
  plan_data: ConversationPlanData;
  current_step_id: string;
  created_at: string;
  updated_at: string;
}

// Types for session data
export interface SessionData {
  askKey: string;
  inviteToken?: string | null; // Token for invite-based access (allows anonymous participation)
  ask: Ask | null;
  messages: Message[];
  insights: Insight[];
  challenges?: Challenge[];
  conversationPlan?: ConversationPlan | null;
  conversationThreadId?: string | null; // Thread ID for realtime subscriptions
  isLoading: boolean;
  error: string | null;
}

// AI agent configuration
export type AiModelProvider =
  | "anthropic"
  | "vertex_anthropic"
  | "mistral"
  | "openai"
  | "deepgram"
  | "deepgram-voice-agent"
  | "speechmatics-voice-agent"
  | "hybrid-voice-agent"
  | "custom";

export interface AiModelConfig {
  id: string;
  code: string;
  name: string;
  provider: AiModelProvider;
  model: string;
  baseUrl?: string | null;
  apiKeyEnvVar: string;
  additionalHeaders?: Record<string, unknown> | null;
  isDefault?: boolean;
  isFallback?: boolean;
  createdAt?: string;
  updatedAt?: string;
  // Voice agent provider selector
  voiceAgentProvider?: "deepgram-voice-agent" | "speechmatics-voice-agent"; // Selector for voice agent type
  // Deepgram-specific fields (stored in dedicated database columns)
  deepgramSttModel?: string; // e.g., "nova-2", "nova-3"
  deepgramTtsModel?: string; // e.g., "aura-2-thalia-en", "aura-2-asteria-en"
  deepgramLlmProvider?: "anthropic" | "openai"; // LLM provider for Deepgram Agent
  deepgramLlmModel?: string; // LLM model name (e.g., "claude-3-5-haiku-latest", "gpt-4o")
  // Speechmatics-specific fields (stored in dedicated database columns)
  speechmaticsSttLanguage?: string; // e.g., "fr", "en", "multi", "fr,en"
  speechmaticsSttOperatingPoint?: "enhanced" | "standard"; // Operating point for STT
  speechmaticsSttMaxDelay?: number; // Max delay between segments (default: 2.0)
  speechmaticsSttEnablePartials?: boolean; // Enable partial transcription results
  speechmaticsLlmProvider?: "anthropic" | "openai"; // LLM provider for Speechmatics Agent
  speechmaticsLlmModel?: string; // LLM model name (e.g., "claude-3-5-haiku-latest", "gpt-4o")
  speechmaticsApiKeyEnvVar?: string; // Environment variable name for Speechmatics API key
  // Speechmatics diarization configuration
  speechmaticsDiarization?: "none" | "speaker" | "channel" | "channel_and_speaker"; // Diarization mode (default: "speaker")
  speechmaticsSpeakerSensitivity?: number; // 0.0-1.0, higher = more speakers detected (default: 0.5)
  speechmaticsPreferCurrentSpeaker?: boolean; // Reduce false speaker switches (default: true)
  speechmaticsMaxSpeakers?: number; // Max speakers to detect (>=2, null = unlimited)
  // ElevenLabs-specific fields for hybrid voice agent
  elevenLabsVoiceId?: string; // ElevenLabs voice ID
  elevenLabsModelId?: string; // ElevenLabs TTS model ID (e.g., "eleven_turbo_v2_5")
  elevenLabsApiKeyEnvVar?: string; // Environment variable name for ElevenLabs API key
  disableElevenLabsTTS?: boolean; // If true, disable ElevenLabs TTS for Speechmatics (only STT will work)
  // Claude extended thinking mode
  enableThinking?: boolean; // Enable Claude extended thinking mode
  thinkingBudgetTokens?: number; // Maximum tokens for Claude internal reasoning (min: 1024, default: 10000)
}

export interface AiAgentRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  modelConfigId?: string | null;
  fallbackModelConfigId?: string | null;
  systemPrompt: string;
  userPrompt: string;
  availableVariables: string[];
  metadata?: Record<string, unknown> | null;
  voice?: boolean;
  createdAt?: string;
  updatedAt?: string;
  modelConfig?: AiModelConfig | null;
  fallbackModelConfig?: AiModelConfig | null;
}

export type AiAgentInteractionStatus = "pending" | "processing" | "completed" | "failed";

export interface AiAgentLog {
  id: string;
  agentId?: string | null;
  modelConfigId?: string | null;
  askSessionId?: string | null;
  messageId?: string | null;
  interactionType: string;
  requestPayload: Record<string, unknown>;
  responsePayload?: Record<string, unknown> | null;
  status: AiAgentInteractionStatus;
  errorMessage?: string | null;
  latencyMs?: number | null;
  createdAt: string;
}

export type AiInsightJobStatus = "pending" | "processing" | "completed" | "failed";

export interface AiInsightJob {
  id: string;
  askSessionId: string;
  messageId?: string | null;
  agentId?: string | null;
  modelConfigId?: string | null;
  status: AiInsightJobStatus;
  attempts: number;
  lastError?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface PromptVariableDefinition {
  key: string;
  label: string;
  description: string;
  example?: string;
  type?: string; // Type de la variable: string, array, object, etc.
  category?: string; // Catégorie: session, conversation, participants, insights, etc.
}

// Types for component props
export interface ChatComponentProps {
  askKey: string;
  ask: Ask | null;
  messages: Message[];
  conversationPlan?: ConversationPlan | null;
  onSendMessage: (content: string, type?: Message['type'], metadata?: Message['metadata']) => void;
  isLoading: boolean;
  onHumanTyping?: (isTyping: boolean) => void;
  currentParticipantName?: string | null;
  currentUserId?: string | null;
  isMultiUser?: boolean;
  showAgentTyping?: boolean;
  // Voice mode props
  voiceModeEnabled?: boolean;
  initialVoiceMode?: boolean; // Start in voice mode immediately
  voiceModeSystemPrompt?: string;
  voiceModeUserPrompt?: string; // User prompt template (same as text mode)
  voiceModePromptVariables?: Record<string, string | null | undefined>; // Variables for userPrompt template rendering
  voiceModeModelConfig?: {
    deepgramSttModel?: string;
    deepgramTtsModel?: string;
    deepgramLlmProvider?: "anthropic" | "openai";
    deepgramLlmModel?: string;
  };
  onVoiceMessage?: (role: 'user' | 'agent', content: string, metadata?: { isInterim?: boolean; messageId?: string; timestamp?: string; speaker?: string }) => void;
  onReplyBoxFocusChange?: (isFocused: boolean) => void;
  onVoiceModeChange?: (isActive: boolean) => void;
  // Message editing props
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  // Consultant mode props
  consultantMode?: boolean; // If true, AI listens but doesn't respond (no TTS)
  onSpeakerChange?: (speaker: string) => void; // Callback when speaker changes (diarization)
  // Timer props for voice mode progress bar
  elapsedMinutes?: number;
  isTimerPaused?: boolean;
  onTogglePause?: () => void;
  expectedDurationMinutes?: number | null;
  // Scroll callback for mobile header hide/show
  onChatScroll?: (scrollTop: number, scrollDelta: number) => void;
}

export interface ChallengeComponentProps {
  challenges: Challenge[];
  onUpdateChallenge: (challenge: Challenge) => void;
  onDeleteChallenge?: (challengeId: string) => void;
  askKey: string;
}

export interface InsightPanelProps {
  insights: Insight[];
  onRequestChallengeLink?: (insightId: string) => void;
  onInsightUpdate?: (insightId: string, newContent: string) => void;
  askKey: string;
  isDetectingInsights?: boolean;
  /** When true, display logic changes for consultant mode */
  isConsultantMode?: boolean;
  /** When true (and isConsultantMode), shows full content instead of summary */
  isSpokesperson?: boolean;
}

// Consultant mode - suggested questions
export interface SuggestedQuestion {
  id: string;
  text: string;
  timestamp: string;
}

export interface SuggestedQuestionsPanelProps {
  questions: SuggestedQuestion[];
  isAnalyzing?: boolean;
  onQuestionCopy?: (questionId: string) => void;
}

// Admin backoffice data
export interface ClientRecord {
  id: string;
  name: string;
  status: string;
  email?: string | null;
  company?: string | null;
  industry?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Client-specific role for users within a client organization
export type ClientRole = 'client_admin' | 'facilitator' | 'manager' | 'participant';

// Global profile roles (matches Role System table)
// - full_admin: All access across all clients/projects
// - client_admin: Manages all projects/users for assigned clients
// - facilitator: Manages projects, creates/updates contacts
// - manager: Manages clients, creates/updates contacts
// - participant: Basic user access
export type ProfileRole = 'full_admin' | 'client_admin' | 'facilitator' | 'manager' | 'participant';

export interface ClientMember {
  id: string;
  clientId: string;
  userId: string;
  role: ClientRole; // Role within this specific client
  jobTitle?: string | null; // Client-specific job title
  createdAt: string;
  updatedAt: string;
  // Optional profile info (populated when joined with profiles table)
  userEmail?: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
  userFullName?: string | null;
}

// Extended client membership with client details (for UI display)
export interface ClientMembership extends ClientMember {
  clientName: string;
  clientStatus?: string;
}

// Project membership with project details
export interface ProjectMembership {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus?: string;
  clientId: string;
  clientName?: string;
  role: string;
  jobTitle?: string | null;
  description?: string | null; // Project-specific description for AI context
  createdAt: string;
}

// Auth types - Supabase Auth integration
export interface AuthUser {
  id: string; // auth.users.id from Supabase Auth
  email: string;
  emailConfirmed?: boolean;
  profile?: Profile | null; // Linked profile from public.profiles
}

export interface Profile {
  id: string; // public.profiles.id (UUID)
  authId: string; // References auth.users.id
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  role: string;
  // Client associations are managed via client_members table
  // Use clientMemberships in ManagedUser for client relationships
  avatarUrl?: string | null;
  isActive: boolean;
  lastLogin?: string | null;
  jobTitle?: string | null; // Global job title from profiles table
  description?: string | null; // User bio/description
  createdAt: string;
  updatedAt: string;
}

// Managed user for admin backoffice (extends Profile with additional info)
export interface ManagedUser extends Profile {
  projectIds?: string[];
  clientMemberships?: ClientMembership[]; // All client associations with roles
  projectMemberships?: ProjectMembership[]; // All project associations
}

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  clientId: string;
  clientName?: string | null;
  startDate: string;
  endDate: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  systemPrompt?: string | null;
  graphRagScope?: "project" | "client";
  aiChallengeBuilderResults?: {
    suggestions: AiChallengeUpdateSuggestion[];
    newChallenges: AiNewChallengeSuggestion[];
    errors: Array<{ challengeId: string | null; message: string }> | null;
    lastRunAt: string;
    projectId: string;
  } | null;
}

/** Status of AI ASK suggestions generation */
export type AiAskSuggestionsStatus = "pending" | "generating" | "completed" | "error";

/** Persisted AI ASK suggestions stored on a challenge */
export interface PersistedAskSuggestions {
  suggestions: AiAskSuggestion[];
  status: AiAskSuggestionsStatus;
  lastRunAt: string;
  error?: string | null;
}

export interface ChallengeRecord {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  category?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  parentChallengeId?: string | null;
  assignedTo?: string | null;
  dueDate?: string | null;
  updatedAt: string;
  systemPrompt?: string | null;
  /** AI-generated ASK suggestions for this challenge */
  aiAskSuggestions?: PersistedAskSuggestions | null;
}

/**
 * Progress data for a participant's conversation plan
 */
export interface ParticipantProgressInfo {
  completedSteps: number;
  totalSteps: number;
  currentStepTitle: string | null;
  planStatus: "active" | "completed" | "abandoned" | null;
  isCompleted: boolean;
  isActive: boolean;
  threadId: string | null;
}

/**
 * Progress data container for all participants in an ask session
 */
export interface AskProgressData {
  /** For individual_parallel mode: progress keyed by participant user_id */
  byParticipant: Record<string, ParticipantProgressInfo>;
  /** For shared modes: single shared progress */
  shared: ParticipantProgressInfo | null;
  /** Conversation mode determines which progress to display */
  mode: AskConversationMode;
}

export interface AskSessionRecord {
  id: string;
  askKey: string;
  name: string;
  question: string;
  description?: string | null;
  status: string;
  projectId: string;
  projectName?: string | null;
  challengeId?: string | null;
  startDate: string;
  endDate: string;
  allowAutoRegistration: boolean;
  maxParticipants?: number | null;
  deliveryMode: AskDeliveryMode;
  conversationMode: AskConversationMode;
  expectedDurationMinutes?: number | null; // 1-30 minutes for conversation pacing
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  participants?: AskParticipant[];
  systemPrompt?: string | null;
  /** Progress data for participants (only present when fetched with includeProgress) */
  progressData?: AskProgressData | null;
}

export interface AskPromptTemplate {
  id: string;
  name: string;
  description?: string | null;
  systemPrompt: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AskContact {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
  isSpokesperson?: boolean;
}

export interface AskRecord {
  id: string;
  askSessionId: string;
  askKey: string;
  name: string;
  question: string;
  status: string;
  deliveryMode: AskDeliveryMode;
  conversationMode: AskConversationMode;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

// Types for the project journey board view
export type InsightCategory = "pain" | "gain" | "signal" | "idea";

export interface ProjectInsightKpi {
  id: string;
  label: string;
  current?: string;
  target?: string;
  delta?: string;
  unit?: string;
  comment?: string;
}

export interface ProjectParticipantSummary {
  id: string;
  name: string;
  role?: string;
  jobTitle?: string | null; // Global, client-specific, or project-specific job title
  description?: string | null; // Project-specific description for AI context
}

export interface ProjectParticipantInsight {
  id: string;
  title: string;
  type: InsightCategory;
  description: string;
  updatedAt: string;
  isCompleted: boolean;
  relatedChallengeIds: string[];
  kpis: ProjectInsightKpi[];
  contributors?: ProjectParticipantSummary[];
}

export interface ProjectAskParticipant {
  id: string;
  userId?: string | null;
  name: string;
  role: string;
  avatarInitials: string;
  avatarColor?: string;
  inviteToken?: string | null;
  insights: ProjectParticipantInsight[];
}

export interface ProjectAskOverview {
  id: string;
  askKey: string;
  title: string;
  summary: string;
  status: string;
  theme: string;
  dueDate: string;
  conversationMode?: AskConversationMode | null;
  participants: ProjectAskParticipant[];
  originatingChallengeIds: string[];
  primaryChallengeId?: string | null;
  relatedChallengeIds?: string[];
  relatedProjects: { id: string; name: string }[];
  insights: ProjectParticipantInsight[];
}

export interface ProjectParticipantOption {
  id: string;
  name: string;
  role: string;
  avatarInitials: string;
  avatarColor?: string;
}

export interface ProjectChallengeNode {
  id: string;
  title: string;
  description: string;
  status: string;
  impact: "low" | "medium" | "high" | "critical";
  owners?: ProjectParticipantSummary[];
  relatedInsightIds: string[];
  children?: ProjectChallengeNode[];
  /** AI-generated ASK suggestions for this challenge */
  aiAskSuggestions?: PersistedAskSuggestions | null;
}

export interface ProjectMember {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  role: string | null;
  jobTitle: string | null;
  description: string | null; // Project-specific description for AI context
}

export interface ProjectJourneyBoardData {
  projectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  projectGoal?: string | null;
  timeframe?: string | null;
  projectDescription?: string | null;
  projectStatus?: string | null;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  projectSystemPrompt?: string | null;
  asks: ProjectAskOverview[];
  challenges: ProjectChallengeNode[];
  availableUsers: ProjectParticipantOption[];
  projectMembers: ProjectMember[];
}

export interface AiChallengeAgentMetadata {
  logId: string;
  agentId?: string | null;
  modelConfigId?: string | null;
}

export interface AiSubChallengeUpdateSuggestion {
  id: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  impact?: ProjectChallengeNode["impact"] | null;
  summary?: string | null;
}

export interface AiFoundationInsight {
  insightId: string;
  title?: string; // Optional: will be fetched from DB if not provided (smart optimization)
  reason: string;
  priority: "low" | "medium" | "high" | "critical";
}

export interface AiNewChallengeSuggestion {
  referenceId?: string | null;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  impact?: ProjectChallengeNode["impact"] | null;
  owners?: ProjectParticipantSummary[];
  summary?: string | null;
  foundationInsights?: AiFoundationInsight[];
}

export interface AiChallengeUpdateSuggestion {
  challengeId: string;
  challengeTitle: string;
  summary?: string | null;
  foundationInsights?: AiFoundationInsight[];
  updates?: {
    title?: string | null;
    description?: string | null;
    status?: string | null;
    impact?: ProjectChallengeNode["impact"] | null;
    owners?: ProjectParticipantSummary[];
  } | null;
  subChallengeUpdates?: AiSubChallengeUpdateSuggestion[];
  newSubChallenges?: AiNewChallengeSuggestion[];
  agentMetadata?: AiChallengeAgentMetadata;
  rawResponse?: string | null;
  errors?: string[];
}

export interface AiChallengeBuilderResponse {
  challengeSuggestions: AiChallengeUpdateSuggestion[];
  newChallengeSuggestions: AiNewChallengeSuggestion[];
  errors?: Array<{ challengeId: string | null; message: string }>;
}

export interface AiAskParticipantSuggestion {
  id?: string | null;
  name: string;
  role?: string | null;
  isSpokesperson?: boolean | null;
}

export interface AiAskInsightReference {
  insightId: string;
  title?: string | null;
  reason?: string | null;
  priority?: ProjectChallengeNode["impact"] | null;
}

export interface AiAskSuggestion {
  referenceId?: string | null;
  title: string;
  askKey?: string | null;
  question: string;
  summary?: string | null;
  description?: string | null;
  objective?: string | null;
  recommendedParticipants?: AiAskParticipantSuggestion[];
  relatedInsights?: AiAskInsightReference[];
  followUpActions?: string[];
  confidence?: "low" | "medium" | "high" | null;
  urgency?: ProjectChallengeNode["impact"] | null;
  maxParticipants?: number | null;
  allowAutoRegistration?: boolean | null;
  deliveryMode?: AskDeliveryMode | null;
  conversationMode?: AskConversationMode | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AiAskGeneratorResponse {
  suggestions: AiAskSuggestion[];
  errors?: string[];
  rawResponse?: string | null;
}

// Security types
export type SecurityDetectionType = 'injection' | 'xss' | 'spam' | 'length' | 'command_injection';
export type SecurityDetectionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SecurityDetectionStatus = 'pending' | 'reviewed' | 'resolved' | 'false_positive';

export interface SecurityDetection {
  id: string;
  messageId: string;
  profileId: string | null;
  detectionType: SecurityDetectionType;
  severity: SecurityDetectionSeverity;
  matchedPatterns: Record<string, unknown>;
  status: SecurityDetectionStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface QuarantinedProfile {
  id: string;
  email: string;
  fullName?: string | null;
  isQuarantined: boolean;
  quarantinedAt?: string | null;
  quarantinedReason?: string | null;
}

// Conversation pacing types
export type PacingLevel = 'intensive' | 'standard' | 'deep';
export type PacingAlertLevel = 'none' | 'warning' | 'critical';

export interface PacingConfig {
  expectedDurationMinutes: number;
  totalSteps: number;
  durationPerStep: number;
  pacingLevel: PacingLevel;
  optimalQuestionsMin: number;
  optimalQuestionsMax: number;
  alertLevel: PacingAlertLevel;
  alertMessage?: string;
}

// Time tracking statistics for real-time pacing
export interface TimeTrackingStats {
  conversationElapsedMinutes: number;
  stepElapsedMinutes: number;
  questionsAskedTotal: number;
  questionsAskedInStep: number;
  timeRemainingMinutes: number;
  isOvertime: boolean;
  overtimeMinutes: number;
  stepIsOvertime: boolean;
  stepOvertimeMinutes: number;
}

// ============================================================================
// Claims System Types (Graph RAG)
// ============================================================================

export type ClaimType = 'finding' | 'hypothesis' | 'recommendation' | 'observation';

export interface Claim {
  id: string;
  projectId: string;
  challengeId: string | null;
  statement: string;
  claimType: ClaimType;
  evidenceStrength: number | null;
  confidence: number | null;
  sourceInsightIds: string[];
  embedding?: number[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimEntity {
  id: string;
  claimId: string;
  entityId: string;
  relevanceScore: number;
  createdAt: string;
}

// Types for claim extraction from insights
export interface ExtractedClaim {
  statement: string;
  type: ClaimType;
  evidenceStrength: number;
  addressesObjective?: string;
  keyEntities: string[];
}

export interface ClaimRelation {
  fromClaimIndex: number;
  toClaimIndex: number;
  relation: 'supports' | 'contradicts' | 'refines';
}

export interface ClaimExtractionResult {
  claims: ExtractedClaim[];
  relations: ClaimRelation[];
}

// Graph edge types including new claim-related types
export type GraphRelationshipType =
  | 'SIMILAR_TO'
  | 'RELATED_TO'
  | 'CONTAINS'
  | 'SYNTHESIZES'
  | 'MENTIONS'
  | 'HAS_TYPE'
  | 'CO_OCCURS'
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'ADDRESSES'
  | 'EVIDENCE_FOR';

// === PROJECT SYNTHESIS (Narrative Reports) ===

export interface ProjectSynthesis {
  id: string;
  projectId: string;
  challengeId: string | null;
  markdownContent: string;
  metadata: SynthesisMetadata;
  version: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SynthesisMetadata {
  stats: {
    totalClaims: number;
    totalInsights: number;
    totalParticipants: number;
    communitiesDetected: number;
    consensusRate: number;    // 0-1
    tensionRate: number;      // 0-1
  };
  sections: {
    problemSpace: number;     // count of items
    findings: number;
    solutions: number;
    tensions: number;
    risks: number;
  };
  thematicGroups: Array<{
    id: string;
    name: string;
    claimCount: number;
  }>;
}

export interface SynthesisGenerationInput {
  projectId: string;
  challengeId?: string;
}

export interface SynthesisSection {
  title: string;
  overview: string;
  items: SynthesisItem[];
}

export interface SynthesisItem {
  id: string;
  type: 'pain' | 'risk' | 'finding' | 'recommendation' | 'tension';
  content: string;
  evidenceStrength?: number;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  sources: string[];
  relatedIds?: string[];
}

export interface ThematicGroup {
  id: string;
  name: string;
  description: string;
  claimIds: string[];
  communityId?: number;
  importanceScore: number;
  dominantClaimType: ClaimType;
}
