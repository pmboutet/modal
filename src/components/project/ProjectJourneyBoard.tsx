"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Lightbulb,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { DurationSlider } from "@/components/ui/duration-slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { getMockProjectJourneyData } from "@/lib/mockProjectJourney";
import { clearAllTimersFromLocalStorage } from "@/hooks/useSessionTimer";
import {
  type AiAskGeneratorResponse,
  type AiAskSuggestion,
  type AiChallengeBuilderResponse,
  type AiChallengeUpdateSuggestion,
  type AiFoundationInsight,
  type AiNewChallengeSuggestion,
  type AiSubChallengeUpdateSuggestion,
  type AskConversationMode,
  type AskDeliveryMode,
  type AskSessionRecord,
  type ChallengeRecord,
  type ProjectAskOverview,
  type ProjectChallengeNode,
  type ProjectJourneyBoardData,
  type ProjectParticipantInsight,
  type ProjectParticipantSummary,
} from "@/types";
import { AiChallengeBuilderModal } from "@/components/project/AiChallengeBuilderModal";
import { ParticipantSectionPanel, type ParticipantProgressData } from "@/components/project/participants";
import { AiChallengeBuilderContent } from "@/components/project/AiChallengeBuilderPanel";
import { AiAskGeneratorPanel } from "@/components/project/AiAskGeneratorPanel";
import { ManageProjectParticipantsDialog } from "@/components/project/ManageProjectParticipantsDialog";
import { ClientEditDialog } from "@/components/project/ClientEditDialog";
import { AskPromptTemplateSelector } from "@/components/admin/AskPromptTemplateSelector";
import { GraphRAGPanel } from "@/components/admin/GraphRAGPanel";
import { useAuth } from "@/components/auth/AuthProvider";

// Import extracted modules
import {
  type ProjectJourneyBoardProps,
  type ChallengeInsightRow,
  type AskInsightRow,
  type FeedbackState,
  type ProjectEditState,
  type ChallengeFormState,
  type AskFormState,
  createEmptyChallengeForm,
  createEmptyAskForm,
  normalizeAskStatus,
} from "./journey/types";
import {
  type ChallengeStatus,
  impactLabels,
  impactClasses,
  insightTypeClasses,
  challengeStatusOptions,
  askStatusOptions,
  askDeliveryModes,
  askConversationModes,
  challengeMarkdownComponents,
  USE_MOCK_JOURNEY,
} from "./journey/constants";
import {
  normalizeChallengeNodes,
  flattenChallenges,
  insertChallengeNode,
  countSubChallenges,
  buildChallengeParentMap,
  buildChallengeDescendantsMap,
  removeChallengeNode,
  mergeContributors,
  formatDate,
  formatFullDate,
  formatTimeframe,
  toInputDate,
  generateAskKey,
} from "./journey/utils";

export function ProjectJourneyBoard({ projectId, onClose }: ProjectJourneyBoardProps) {
  const [boardData, setBoardData] = useState<ProjectJourneyBoardData | null>(
    USE_MOCK_JOURNEY ? getMockProjectJourneyData(projectId) : null,
  );
  const [isLoading, setIsLoading] = useState(!USE_MOCK_JOURNEY);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [showAddParticipantsDialog, setShowAddParticipantsDialog] = useState(false);
  const [showClientEditDialog, setShowClientEditDialog] = useState(false);
  const [clientEditMode, setClientEditMode] = useState<"create" | "edit">("edit");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isGeneratingSyntheses, setIsGeneratingSyntheses] = useState(false);
  const [synthesisRefreshKey, setSynthesisRefreshKey] = useState(0);
  const [isChallengeFormVisible, setIsChallengeFormVisible] = useState(false);
  const [challengeFormMode, setChallengeFormMode] = useState<"create" | "edit">("create");
  const [isSavingChallenge, setIsSavingChallenge] = useState(false);
  const [challengeFeedback, setChallengeFeedback] = useState<FeedbackState | null>(null);
  const [challengeFormValues, setChallengeFormValues] = useState<ChallengeFormState>(() => createEmptyChallengeForm());
  const [editingChallengeId, setEditingChallengeId] = useState<string | null>(null);
  const isEditingChallenge = challengeFormMode === "edit" && Boolean(editingChallengeId);
  const [isAskFormOpen, setIsAskFormOpen] = useState(false);
  const [isEditingAsk, setIsEditingAsk] = useState(false);
  const [editingAskId, setEditingAskId] = useState<string | null>(null);
  const [askFeedback, setAskFeedback] = useState<FeedbackState | null>(null);
  const [askFormValues, setAskFormValues] = useState<AskFormState>(() => createEmptyAskForm());
  const [isSavingAsk, setIsSavingAsk] = useState(false);
  const [hasManualAskKey, setHasManualAskKey] = useState(false);
  const [askDetails, setAskDetails] = useState<Record<string, AskSessionRecord>>({});
  const [isLoadingAskDetails, setIsLoadingAskDetails] = useState(false);
  const [isSendingAskInvites, setIsSendingAskInvites] = useState(false);
  const [copiedInviteLinks, setCopiedInviteLinks] = useState<Set<string>>(new Set());
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const rightColumnRef = useRef<HTMLDivElement | null>(null);
  const [expandedAsks, setExpandedAsks] = useState<Set<string>>(new Set());
  const [expandedAskParticipants, setExpandedAskParticipants] = useState<Set<string>>(new Set());
  const [isFoundationalInsightsExpanded, setIsFoundationalInsightsExpanded] = useState(true);
  const [expandedCollectedInsightsAskIds, setExpandedCollectedInsightsAskIds] = useState<Set<string>>(new Set());
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isInsightsModalOpen, setIsInsightsModalOpen] = useState(false);
  const [modalActiveTab, setModalActiveTab] = useState<"insights" | "asks" | "ai">("insights");
  const [askParticipantEdits, setAskParticipantEdits] = useState<Record<string, { participantIds: string[]; spokespersonId: string }>>({});
  const [savingAskParticipants, setSavingAskParticipants] = useState<Set<string>>(new Set());
  const [addParticipantDialogAskId, setAddParticipantDialogAskId] = useState<string | null>(null);
  const [hoveredAskMenu, setHoveredAskMenu] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [editValues, setEditValues] = useState<ProjectEditState>({
    name: "",
    description: "",
    status: "active",
    startDate: "",
    endDate: "",
    systemPrompt: "",
  });
  const [aiSuggestions, setAiSuggestions] = useState<AiChallengeUpdateSuggestion[]>([]);
  const [aiNewChallenges, setAiNewChallenges] = useState<AiNewChallengeSuggestion[]>([]);
  const [aiBuilderErrors, setAiBuilderErrors] = useState<Array<{ challengeId: string | null; message: string }> | null>(null);
  const [aiBuilderFeedback, setAiBuilderFeedback] = useState<FeedbackState | null>(null);
  const [isAiBuilderRunning, setIsAiBuilderRunning] = useState(false);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [aiBuilderLastRunAt, setAiBuilderLastRunAt] = useState<string | null>(null);
  const [aiBuilderStartTime, setAiBuilderStartTime] = useState<Date | null>(null);
  const [hasAiBuilderResults, setHasAiBuilderResults] = useState(false);
  const [applyingChallengeUpdateIds, setApplyingChallengeUpdateIds] = useState<Set<string>>(() => new Set());
  const [applyingSubChallengeUpdateIds, setApplyingSubChallengeUpdateIds] = useState<Set<string>>(() => new Set());
  const [applyingNewSubChallengeKeys, setApplyingNewSubChallengeKeys] = useState<Set<string>>(() => new Set());
  const [applyingNewChallengeIndices, setApplyingNewChallengeIndices] = useState<Set<number>>(() => new Set());
  const [isAskAiPanelOpen, setIsAskAiPanelOpen] = useState(false);
  const [isAskAiRunning, setIsAskAiRunning] = useState(false);
  const [askAiSuggestions, setAskAiSuggestions] = useState<AiAskSuggestion[]>([]);
  const [askAiFeedback, setAskAiFeedback] = useState<FeedbackState | null>(null);
  const [askAiErrors, setAskAiErrors] = useState<string[] | null>(null);
  const [isPurgeDialogOpen, setIsPurgeDialogOpen] = useState(false);
  const [purgeConfirmationWord, setPurgeConfirmationWord] = useState("");
  const [isPurging, setIsPurging] = useState(false);
  const [purgeFeedback, setPurgeFeedback] = useState<FeedbackState | null>(null);
  const { profile, isFullAdmin, isAdmin } = useAuth();
  const currentProfileId = profile?.id ?? null;

  // isAdmin means user can manage clients (client_admin or higher)
  const canManageClients = isAdmin;

  const isProdEnvironment = useMemo(() => {
    const devFlag = (process.env.NEXT_PUBLIC_IS_DEV ?? "").toString().toLowerCase();
    const isDevFlag = devFlag === "true" || devFlag === "1";
    return process.env.NODE_ENV === "production" && !isDevFlag;
  }, []);

  // Type for AI builder results data
  type AiBuilderResultsData = {
    suggestions: AiChallengeUpdateSuggestion[];
    newChallenges: AiNewChallengeSuggestion[];
    errors: Array<{ challengeId: string | null; message: string }> | null;
    lastRunAt: string;
  };

  // Load AI builder results from the API
  const loadAiBuilderResults = useCallback(async (): Promise<AiBuilderResultsData | null> => {
    try {
      const response = await fetch(`/api/admin/projects/${projectId}/ai/challenge-builder/results`, {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json();

      if (response.ok && payload.success && payload.data) {
        const data = payload.data as AiBuilderResultsData;
        setAiSuggestions(data.suggestions || []);
        setAiNewChallenges(data.newChallenges || []);
        setAiBuilderErrors(data.errors);
        setAiBuilderLastRunAt(data.lastRunAt);
        setHasAiBuilderResults(true);
        return data;
      }
      return null;
    } catch (error) {
      console.error("Failed to load AI builder results:", error);
      return null;
    }
  }, [projectId]);

  // Load AI results on mount and when modal opens with AI tab
  useEffect(() => {
    loadAiBuilderResults();
  }, [loadAiBuilderResults]);

  useEffect(() => {
    if (isInsightsModalOpen && modalActiveTab === "ai") {
      loadAiBuilderResults();
    }
  }, [isInsightsModalOpen, modalActiveTab, loadAiBuilderResults]);

  // Poll for AI results when builder is running
  useEffect(() => {
    if (!isAiBuilderRunning || !aiBuilderStartTime) return;

    const pollInterval = setInterval(async () => {
      const data = await loadAiBuilderResults();
      if (data) {
        // Check if results are from the current run (lastRunAt >= startTime)
        const lastRunDate = new Date(data.lastRunAt);
        if (lastRunDate >= aiBuilderStartTime) {
          setIsAiBuilderRunning(false);
          setAiBuilderStartTime(null);

          const hasResults = data.suggestions.length > 0 || data.newChallenges.length > 0;
          const hasErrors = data.errors && data.errors.length > 0;

          if (hasResults) {
            setAiBuilderFeedback({
              type: "success",
              message: "Analyse IA terminée. Cliquez sur l'onglet Sub-challenges IA pour voir les résultats.",
            });
          } else if (hasErrors) {
            setAiBuilderFeedback({
              type: "error",
              message: "L'analyse IA a rencontré des erreurs. Vérifiez les détails.",
            });
          } else {
            setAiBuilderFeedback({
              type: "success",
              message: "Analyse IA terminée. Tous les challenges sont à jour.",
            });
          }
        }
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [isAiBuilderRunning, aiBuilderStartTime, loadAiBuilderResults]);

  const pruneAiSuggestionNodes = (suggestion: AiChallengeUpdateSuggestion): AiChallengeUpdateSuggestion | null => {
    const hasChallengeUpdates = Boolean(
      suggestion.updates &&
        (suggestion.updates.title ||
          suggestion.updates.description ||
          suggestion.updates.status ||
          suggestion.updates.impact ||
          suggestion.updates.owners?.length),
    );
    const hasSubChallengeUpdates = Boolean(suggestion.subChallengeUpdates?.length);
    const hasNewSubChallenges = Boolean(suggestion.newSubChallenges?.length);

    const cleaned: AiChallengeUpdateSuggestion = { ...suggestion };

    if (!hasChallengeUpdates) {
      delete (cleaned as Partial<AiChallengeUpdateSuggestion>).updates;
      delete (cleaned as Partial<AiChallengeUpdateSuggestion>).foundationInsights;
      if (!hasSubChallengeUpdates && !hasNewSubChallenges && !cleaned.summary) {
        delete (cleaned as Partial<AiChallengeUpdateSuggestion>).summary;
      }
    }
    if (!hasSubChallengeUpdates) {
      delete (cleaned as Partial<AiChallengeUpdateSuggestion>).subChallengeUpdates;
    }
    if (!hasNewSubChallenges) {
      delete (cleaned as Partial<AiChallengeUpdateSuggestion>).newSubChallenges;
    }

    if (!hasChallengeUpdates && !hasSubChallengeUpdates && !hasNewSubChallenges) {
      return null;
    }

    return cleaned;
  };

  useEffect(() => {
    if (challengeFeedback?.type !== "success") {
      return;
    }

    const timeoutId = window.setTimeout(() => setChallengeFeedback(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [challengeFeedback]);

  useEffect(() => {
    if (!aiBuilderFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => setAiBuilderFeedback(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [aiBuilderFeedback]);

  useEffect(() => {
    if (!askAiFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => setAskAiFeedback(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [askAiFeedback]);

  // Collapse header when scrolling down
  useEffect(() => {
    // Find the nearest scrollable ancestor (the main element with overflow-y-auto)
    const findScrollableParent = (element: HTMLElement | null): HTMLElement | null => {
      if (!element) return null;
      let current = element.parentElement;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    };

    // Use requestAnimationFrame to ensure DOM is fully rendered
    const rafId = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const scrollParent = findScrollableParent(container);

      if (!scrollParent) {
        return;
      }

      const handleScroll = () => {
        const scrollTop = scrollParent.scrollTop;
        // Collapse header when scrolled past 50px
        setIsHeaderCollapsed(scrollTop > 50);
      };

      scrollParent.addEventListener("scroll", handleScroll, { passive: true });

      // Store cleanup function
      (container as HTMLElement & { _scrollCleanup?: () => void })._scrollCleanup = () => {
        scrollParent.removeEventListener("scroll", handleScroll);
      };
    });

    return () => {
      cancelAnimationFrame(rafId);
      const container = scrollContainerRef.current;
      if (container) {
        const cleanup = (container as HTMLElement & { _scrollCleanup?: () => void })._scrollCleanup;
        if (cleanup) cleanup();
      }
    };
  }, []);

  // Poll for AI challenge builder results when running
  useEffect(() => {
    if (!isAiBuilderRunning) {
      return;
    }

    const pollResults = async () => {
      try {
        const response = await fetch(`/api/admin/projects/${projectId}/ai/challenge-builder/results`, {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json();

        if (response.ok && payload.success && payload.data) {
          const results = payload.data as {
            suggestions: AiChallengeUpdateSuggestion[];
            newChallenges: AiNewChallengeSuggestion[];
            errors: Array<{ challengeId: string | null; message: string }> | null;
            lastRunAt: string;
          };

          // Check if results are new (within last 30 seconds means still running)
          const lastRunAt = new Date(results.lastRunAt);
          const now = new Date();
          const secondsSinceRun = (now.getTime() - lastRunAt.getTime()) / 1000;

          // Results are ready when we have suggestions/newChallenges/errors, or it's been > 30 seconds
          const hasContent = results.suggestions.length > 0 || results.newChallenges.length > 0 || results.errors;
          if (hasContent || secondsSinceRun >= 30) {
            setIsAiBuilderRunning(false);
            setAiBuilderLastRunAt(results.lastRunAt);
            setHasAiBuilderResults(results.suggestions.length > 0 || results.newChallenges.length > 0);

            if (hasContent) {
              setAiBuilderFeedback({
                type: "success",
                message: "Analyse IA terminée. Cliquez sur 'Voir les propositions' pour consulter les résultats.",
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to poll challenge builder results:", error);
      }
    };

    const interval = setInterval(pollResults, 2000);
    return () => clearInterval(interval);
  }, [isAiBuilderRunning, projectId]);

  // Load AI builder results on mount
  useEffect(() => {
    const loadInitialResults = async () => {
      try {
        const response = await fetch(`/api/admin/projects/${projectId}/ai/challenge-builder/results`, {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json();

        if (response.ok && payload.success && payload.data) {
          const results = payload.data as {
            suggestions: AiChallengeUpdateSuggestion[];
            newChallenges: AiNewChallengeSuggestion[];
            lastRunAt: string;
          };
          setAiBuilderLastRunAt(results.lastRunAt);
          setHasAiBuilderResults(results.suggestions.length > 0 || results.newChallenges.length > 0);
        }
      } catch (error) {
        console.error("Failed to load initial challenge builder results:", error);
      }
    };

    loadInitialResults();
  }, [projectId]);

  const loadJourneyData = useCallback(
    async (options?: { signal?: AbortSignal; silent?: boolean }) => {
      if (USE_MOCK_JOURNEY) {
        setBoardData(getMockProjectJourneyData(projectId));
        setError(null);
        setIsLoading(false);
        return;
      }

      if (!options?.silent) {
        setIsLoading(true);
        if (!USE_MOCK_JOURNEY) {
          setBoardData(null);
        }
      }
      setError(null);

      try {
        console.log('🔄 Frontend: Reloading journey data for project:', projectId);
        const response = await fetch(`/api/admin/projects/${projectId}/journey`, {
          cache: "no-store",
          credentials: "include",
          signal: options?.signal,
        });
        const payload = await response.json();

        console.log('📡 Frontend: Journey data response:', { status: response.status, success: payload.success });

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load project data");
        }

        console.log('✅ Frontend: Journey data loaded successfully:', payload.data);

        if (!payload.data || typeof payload.data !== 'object') {
          throw new Error('Invalid project journey payload received from the server');
        }

        const rawData = payload.data as ProjectJourneyBoardData;
        const normalizedData: ProjectJourneyBoardData = {
          ...rawData,
          asks: Array.isArray(rawData.asks) ? rawData.asks : [],
          challenges: normalizeChallengeNodes(rawData.challenges),
          availableUsers: Array.isArray(rawData.availableUsers) ? rawData.availableUsers : [],
        };

        console.log('🔍 Frontend: Normalised data structure check:', {
          challengesLength: normalizedData.challenges.length,
          asksLength: normalizedData.asks.length,
          availableUsersLength: normalizedData.availableUsers.length,
        });

        setBoardData(normalizedData);
      } catch (err) {
        if (options?.signal?.aborted) {
          return;
        }
        if ((err as { name?: string }).name === "AbortError") {
          return;
        }
        console.error("❌ Frontend: Failed to load project journey data", { projectId, error: err });
        if (USE_MOCK_JOURNEY) {
          setBoardData(getMockProjectJourneyData(projectId));
        } else if (!options?.silent) {
          setBoardData(null);
        }
        setError(err instanceof Error ? err.message : "Unable to load project data");
      } finally {
        if (!options?.silent) {
          setIsLoading(false);
        }
      }
    },
    [projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadJourneyData({ signal: controller.signal });

    return () => {
      controller.abort();
    };
  }, [loadJourneyData]);

  // Nettoyer le timeout au démontage
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!boardData) {
      console.log('🧭 Frontend: Board data cleared');
      return;
    }

    console.log('🧭 Frontend: Board data ready', {
      projectId: boardData.projectId,
      challenges: boardData.challenges.length,
      asks: boardData.asks.length,
      availableUsers: boardData.availableUsers.length,
    });
  }, [boardData]);

  const ensureAskDetails = useCallback(
    async (askId: string, forceRefresh = false): Promise<AskSessionRecord> => {
      const existing = askDetails[askId];
      // Return cached data only if it has progressData (to ensure fresh progress)
      // or if forceRefresh is not requested
      if (existing && !forceRefresh && existing.progressData !== undefined) {
        return existing;
      }

      // Include progress data for participant progress display
      const response = await fetch(`/api/admin/asks/${askId}?includeProgress=true`, {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load ASK details");
      }

      const record = payload.data as AskSessionRecord;
      setAskDetails(current => ({ ...current, [record.id]: record }));
      return record;
    },
    [askDetails],
  );

  const allChallenges = useMemo(() => flattenChallenges(boardData?.challenges), [boardData]);
  const editingAskRecord = useMemo(
    () => (editingAskId ? askDetails[editingAskId] ?? null : null),
    [askDetails, editingAskId],
  );

  const challengeById = useMemo(() => {
    const map = new Map<string, ProjectChallengeNode>();
    allChallenges.forEach(challenge => {
      map.set(challenge.id, challenge);
    });
    return map;
  }, [allChallenges]);

  const resolveOwnerId = useCallback(
    (owners?: ProjectParticipantSummary[] | null) => {
      if (!boardData || !owners?.length) {
        return "";
      }

      const availableUsers = boardData.availableUsers ?? [];

      for (const owner of owners) {
        if (owner.id && availableUsers.some(user => user.id === owner.id)) {
          return owner.id;
        }

        const normalizedName = owner.name?.toLowerCase();
        if (normalizedName) {
          const match = availableUsers.find(user => user.name.toLowerCase() === normalizedName);
          if (match) {
            return match.id;
          }
        }
      }

      return "";
    },
    [boardData],
  );

  const handleLaunchAiChallengeBuilder = useCallback(async (scopeChallengeId?: string) => {
    if (isAiBuilderRunning) {
      return;
    }

    // Start the builder in background (don't open modal)
    setIsAiBuilderRunning(true);
    setAiBuilderStartTime(new Date());
    setAiBuilderFeedback({
      type: "success",
      message: "Génération IA lancée. Vous pouvez continuer à naviguer.",
    });

    // Fire-and-forget: launch the builder without waiting
    fetch(`/api/admin/projects/${projectId}/ai/challenge-builder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scopeChallengeId ? { scopeChallengeId } : {}),
    }).catch((error) => {
      console.error("Failed to start challenge builder:", error);
      setIsAiBuilderRunning(false);
      setAiBuilderStartTime(null);
      setAiBuilderFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Erreur inattendue lors du lancement de l'analyse IA.",
      });
    });
  }, [projectId, isAiBuilderRunning]);

  const handleLaunchAskAiGenerator = useCallback(async () => {
    if (isAskAiRunning) {
      return;
    }

    if (!activeChallengeId) {
      setAskAiFeedback({
        type: "error",
        message: "Select a challenge before generating ASKs with AI.",
      });
      return;
    }

    setIsAskAiPanelOpen(true);
    setAskAiFeedback(null);
    setAskAiErrors(null);
    setAskAiSuggestions([]);
    setIsAskAiRunning(true);

    try {
      const response = await fetch(`/api/admin/challenges/${activeChallengeId}/ai/ask-generator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to generate ASKs with AI.");
      }

      const data = (payload.data ?? null) as AiAskGeneratorResponse | null;
      const suggestions = data?.suggestions ?? [];

      setAskAiSuggestions(suggestions);
      setAskAiErrors(data?.errors ?? null);

      if (suggestions.length === 0) {
        setAskAiFeedback({
          type: "error",
          message: "L'agent n'a proposé aucune nouvelle ASK pour ce challenge.",
        });
      } else {
        setAskAiFeedback({
          type: "success",
          message: "ASKs générées. Passez en revue les propositions et appliquez celles qui conviennent.",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inattendue lors de la génération des ASKs.";
      setAskAiFeedback({ type: "error", message });
      setAskAiErrors([message]);
    } finally {
      setIsAskAiRunning(false);
    }
  }, [activeChallengeId, isAskAiRunning]);

  // Handler to open ASK suggestions panel - uses pre-loaded or triggers generation
  const handleOpenAskSuggestionsPanel = useCallback(() => {
    // If we have pre-loaded suggestions, just open the panel
    if (askAiSuggestions.length > 0) {
      setIsAskAiPanelOpen(true);
      return;
    }

    // Otherwise trigger generation
    handleLaunchAskAiGenerator();
  }, [askAiSuggestions.length, handleLaunchAskAiGenerator]);

  const handleDismissChallengeSuggestion = useCallback((challengeId: string) => {
    setAiSuggestions(current => current.filter(item => item.challengeId !== challengeId));
  }, []);

  const handleDismissNewChallengeSuggestion = useCallback((index: number) => {
    setAiNewChallenges(current => current.filter((_, candidateIndex) => candidateIndex !== index));
  }, []);

  const handleDismissAskSuggestion = useCallback((index: number) => {
    setAskAiSuggestions(current => current.filter((_, candidateIndex) => candidateIndex !== index));
  }, []);

  const handleApplyChallengeUpdate = useCallback(
    async (
      challengeId: string,
      updates?: AiChallengeUpdateSuggestion["updates"] | null,
      _foundationInsights?: AiFoundationInsight[],
    ) => {
      if (!boardData) {
        return;
      }

      setApplyingChallengeUpdateIds(current => {
        const next = new Set(current);
        next.add(challengeId);
        return next;
      });
      setAiBuilderFeedback(null);

      try {
        const baseChallenge = challengeById.get(challengeId);
        const payload: Record<string, unknown> = {};

        if (updates?.title && updates.title !== baseChallenge?.title) {
          payload.name = updates.title;
        }
        if (updates?.description && updates.description !== baseChallenge?.description) {
          payload.description = updates.description;
        }
        if (updates?.status && updates.status !== baseChallenge?.status) {
          payload.status = updates.status;
        }
        if (updates?.impact && updates.impact !== baseChallenge?.impact) {
          payload.priority = updates.impact;
        }
        const ownerId = resolveOwnerId(updates?.owners ?? null);
        if (ownerId) {
          payload.assignedTo = ownerId;
        }

        if (Object.keys(payload).length > 0) {
          await fetch(`/api/admin/challenges/${challengeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then(async response => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
              throw new Error(
                result.error || `Échec de la mise à jour du challenge ${baseChallenge?.title ?? challengeId}.`,
              );
            }
          });
          await loadJourneyData({ silent: true });
        }

        setAiSuggestions(current =>
          current
            .map(suggestion => {
              if (suggestion.challengeId !== challengeId) {
                return suggestion;
              }
              const next: AiChallengeUpdateSuggestion = { ...suggestion };
              delete (next as Partial<AiChallengeUpdateSuggestion>).updates;
              delete (next as Partial<AiChallengeUpdateSuggestion>).foundationInsights;
              return pruneAiSuggestionNodes(next);
            })
            .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value)),
        );

        setAiBuilderFeedback({
          type: "success",
          message: `Mise à jour appliquée au challenge « ${baseChallenge?.title ?? challengeId} ».`,
        });
      } catch (error) {
        setAiBuilderFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Impossible d'appliquer la mise à jour du challenge.",
        });
      } finally {
        setApplyingChallengeUpdateIds(current => {
          const next = new Set(current);
          next.delete(challengeId);
          return next;
        });
      }
    },
    [boardData, challengeById, loadJourneyData, pruneAiSuggestionNodes, resolveOwnerId],
  );

  const handleDismissChallengeUpdate = useCallback(
    (challengeId: string) => {
      setAiSuggestions(current =>
        current
          .map(suggestion => {
            if (suggestion.challengeId !== challengeId) {
              return suggestion;
            }
            const next: AiChallengeUpdateSuggestion = { ...suggestion };
            delete (next as Partial<AiChallengeUpdateSuggestion>).updates;
            delete (next as Partial<AiChallengeUpdateSuggestion>).foundationInsights;
            return pruneAiSuggestionNodes(next);
          })
          .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value)),
      );
    },
    [pruneAiSuggestionNodes],
  );

  const handleApplySubChallengeUpdate = useCallback(
    async (parentChallengeId: string, update: AiSubChallengeUpdateSuggestion) => {
      if (!boardData) {
        return;
      }

      setApplyingSubChallengeUpdateIds(current => {
        const next = new Set(current);
        next.add(update.id);
        return next;
      });
      setAiBuilderFeedback(null);

      try {
        const currentChallenge = challengeById.get(update.id);
        const payload: Record<string, unknown> = {};

        if (currentChallenge) {
          if (update.title && update.title !== currentChallenge.title) {
            payload.name = update.title;
          }
          if (update.description && update.description !== currentChallenge.description) {
            payload.description = update.description;
          }
          if (update.status && update.status !== currentChallenge.status) {
            payload.status = update.status;
          }
          if (update.impact && update.impact !== currentChallenge.impact) {
            payload.priority = update.impact;
          }
        }

        if (currentChallenge && Object.keys(payload).length > 0) {
          await fetch(`/api/admin/challenges/${update.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then(async response => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
              throw new Error(
                result.error || `Échec de la mise à jour du sous-challenge ${currentChallenge.title}.`,
              );
            }
          });
          await loadJourneyData({ silent: true });
        }

        setAiSuggestions(current =>
          current
            .map(suggestion => {
              if (suggestion.challengeId !== parentChallengeId) {
                return suggestion;
              }
              const remaining = (suggestion.subChallengeUpdates ?? []).filter(item => item.id !== update.id);
              const next: AiChallengeUpdateSuggestion = {
                ...suggestion,
                subChallengeUpdates: remaining.length ? remaining : undefined,
              };
              return pruneAiSuggestionNodes(next);
            })
            .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value)),
        );

        const label = currentChallenge?.title ?? update.title ?? update.id;
        setAiBuilderFeedback({
          type: "success",
          message: `Mise à jour appliquée au sous-challenge « ${label} ».`,
        });
      } catch (error) {
        setAiBuilderFeedback({
          type: "error",
          message:
            error instanceof Error ? error.message : "Impossible d'appliquer la mise à jour du sous-challenge.",
        });
      } finally {
        setApplyingSubChallengeUpdateIds(current => {
          const next = new Set(current);
          next.delete(update.id);
          return next;
        });
      }
    },
    [boardData, challengeById, loadJourneyData, pruneAiSuggestionNodes],
  );

  const handleDismissSubChallengeUpdate = useCallback(
    (parentChallengeId: string, subChallengeId: string) => {
      setAiSuggestions(current =>
        current
          .map(suggestion => {
            if (suggestion.challengeId !== parentChallengeId) {
              return suggestion;
            }
            const remaining = (suggestion.subChallengeUpdates ?? []).filter(item => item.id !== subChallengeId);
            const next: AiChallengeUpdateSuggestion = {
              ...suggestion,
              subChallengeUpdates: remaining.length ? remaining : undefined,
            };
            return pruneAiSuggestionNodes(next);
          })
          .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value)),
      );
    },
    [pruneAiSuggestionNodes],
  );

  const handleApplySuggestedNewSubChallenge = useCallback(
    async (parentChallengeId: string, index: number, newChallenge: AiNewChallengeSuggestion) => {
      if (!boardData) {
        return;
      }

      const key = `${parentChallengeId}:${newChallenge.referenceId ?? index}`;

      // Prevent double submission (race condition protection)
      if (applyingNewSubChallengeKeys.has(key)) {
        console.log('⚠️ Ignoring duplicate new sub-challenge suggestion submission for key:', key);
        return;
      }

      setApplyingNewSubChallengeKeys(current => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
      setAiBuilderFeedback(null);

      try {
        const resolvedParentId = newChallenge.parentId ?? parentChallengeId;
        const parent = challengeById.get(resolvedParentId) ?? challengeById.get(parentChallengeId) ?? null;
        const payload: Record<string, unknown> = {
          name: newChallenge.title,
          description: newChallenge.description ?? "",
          status: newChallenge.status ?? parent?.status ?? "open",
          priority: newChallenge.impact ?? parent?.impact ?? "medium",
          projectId: boardData.projectId,
          parentChallengeId: resolvedParentId,
        };
        const ownerId = resolveOwnerId(newChallenge.owners ?? null);
        if (ownerId) {
          payload.assignedTo = ownerId;
        }

        const response = await fetch("/api/admin/challenges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          throw new Error(result.error || `Échec de la création du sous-challenge ${newChallenge.title}.`);
        }

        const createdChallengeId = result.data?.id as string | undefined;

        if (createdChallengeId && newChallenge.foundationInsights?.length) {
          await fetch(`/api/admin/projects/${boardData.projectId}/ai/challenge-builder/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challengeId: createdChallengeId,
              foundationInsights: newChallenge.foundationInsights,
            }),
          }).then(async applyResponse => {
            if (!applyResponse.ok) {
              const applyResult = await applyResponse.json().catch(() => ({}));
              throw new Error(
                (applyResult as { error?: string }).error ||
                  `Sous-challenge créé mais les foundation insights n'ont pas pu être liés.`,
              );
            }
          });
        }

        await loadJourneyData({ silent: true });

        // Remove from local state
        setAiSuggestions(current =>
          current
            .map(suggestion => {
              if (suggestion.challengeId !== parentChallengeId) {
                return suggestion;
              }
              const remaining = (suggestion.newSubChallenges ?? []).filter(
                (_, candidateIndex) => candidateIndex !== index,
              );
              const next: AiChallengeUpdateSuggestion = {
                ...suggestion,
                newSubChallenges: remaining.length ? remaining : undefined,
              };
              return pruneAiSuggestionNodes(next);
            })
            .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value)),
        );

        // Persist removal to database (fire-and-forget)
        fetch(`/api/admin/projects/${boardData.projectId}/ai/challenge-builder/results`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "newSubChallenge",
            parentChallengeId,
            title: newChallenge.title,
          }),
        }).catch(err => console.error("Failed to persist sub-challenge suggestion removal:", err));

        setAiBuilderFeedback({
          type: "success",
          message: `Sous-challenge « ${newChallenge.title} » créé.`,
        });
      } catch (error) {
        setAiBuilderFeedback({
          type: "error",
          message:
            error instanceof Error ? error.message : "Impossible de créer le nouveau sous-challenge suggéré.",
        });
      } finally {
        setApplyingNewSubChallengeKeys(current => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [boardData, challengeById, loadJourneyData, pruneAiSuggestionNodes, resolveOwnerId],
  );

  const handleDismissSuggestedNewSubChallenge = useCallback(
    (parentChallengeId: string, index: number) => {
      setAiSuggestions(current =>
        current
          .map(suggestion => {
            if (suggestion.challengeId !== parentChallengeId) {
              return suggestion;
            }
            const remaining = (suggestion.newSubChallenges ?? []).filter((_, candidateIndex) => candidateIndex !== index);
            const next: AiChallengeUpdateSuggestion = {
              ...suggestion,
              newSubChallenges: remaining.length ? remaining : undefined,
            };
            return pruneAiSuggestionNodes(next);
          })
          .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value)),
      );
    },
    [applyingNewSubChallengeKeys, boardData, challengeById, pruneAiSuggestionNodes, resolveOwnerId],
  );

  const handleApplyNewChallengeSuggestion = useCallback(
    async (suggestion: AiNewChallengeSuggestion, index: number) => {
      if (!boardData) {
        return;
      }

      // Prevent double submission (race condition protection)
      if (applyingNewChallengeIndices.has(index)) {
        console.log('⚠️ Ignoring duplicate new challenge suggestion submission for index:', index);
        return;
      }

      setApplyingNewChallengeIndices(current => {
        const next = new Set(current);
        next.add(index);
        return next;
      });
      setAiBuilderFeedback(null);

      try {
        const parentId = suggestion.parentId ?? "";
        const parent = parentId ? challengeById.get(parentId) ?? null : null;
        const payload: Record<string, unknown> = {
          name: suggestion.title,
          description: suggestion.description ?? "",
          status: suggestion.status ?? parent?.status ?? "open",
          priority: suggestion.impact ?? parent?.impact ?? "medium",
          projectId: boardData.projectId,
          parentChallengeId: parentId,
        };
        const ownerId = resolveOwnerId(suggestion.owners ?? null);
        if (ownerId) {
          payload.assignedTo = ownerId;
        }

        // 1️⃣ Créer le challenge
        const response = await fetch("/api/admin/challenges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          throw new Error(result.error || `Échec de la création du challenge ${suggestion.title}.`);
        }

        const newChallengeId = result.data?.id;

        // 2️⃣ Créer les foundation insights si présents
        if (newChallengeId && suggestion.foundationInsights?.length) {
          console.log('🔍 Creating foundation insights for challenge:', {
            challengeId: newChallengeId,
            insightCount: suggestion.foundationInsights.length,
            insights: suggestion.foundationInsights,
          });
          
          try {
            const applyResponse = await fetch(`/api/admin/projects/${boardData.projectId}/ai/challenge-builder/apply`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                challengeId: newChallengeId,
                foundationInsights: suggestion.foundationInsights,
              }),
            });
            
            console.log('📡 Foundation insights API response:', {
              status: applyResponse.status,
              ok: applyResponse.ok,
            });
            
            if (!applyResponse.ok) {
              const errorText = await applyResponse.text();
              console.error("❌ Failed to create foundation insights:", errorText);
              // Note: on continue quand même car le challenge est créé
            } else {
              const applyResult = await applyResponse.json();
              console.log('✅ Foundation insights created successfully:', applyResult);
            }
          } catch (insightError) {
            console.error("❌ Error creating foundation insights:", insightError);
            // On continue même si les insights échouent
          }
        } else {
          console.log('⚠️ No foundation insights to create:', {
            hasNewChallengeId: !!newChallengeId,
            hasFoundationInsights: !!suggestion.foundationInsights,
            foundationInsightsLength: suggestion.foundationInsights?.length,
          });
        }

        await loadJourneyData({ silent: true });

        // NOTE: On ne change PAS le activeChallengeId ici pour permettre à l'utilisateur
        // de continuer à voir et appliquer les autres suggestions AI dans la même vue.
        // L'utilisateur peut cliquer sur le nouveau challenge manuellement s'il le souhaite.

        // Remove from local state
        setAiNewChallenges(current => current.filter((_, candidateIndex) => candidateIndex !== index));

        // Persist removal to database (fire-and-forget)
        fetch(`/api/admin/projects/${boardData.projectId}/ai/challenge-builder/results`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "newChallenge", title: suggestion.title }),
        }).catch(err => console.error("Failed to persist challenge suggestion removal:", err));

        const insightCount = suggestion.foundationInsights?.length || 0;
        const insightMessage = insightCount > 0 ? ` avec ${insightCount} foundation insight${insightCount > 1 ? 's' : ''}` : '';
        
        setAiBuilderFeedback({
          type: "success",
          message: `Challenge « ${suggestion.title} » créé${insightMessage}. Cliquez dessus pour voir les foundation insights.`,
        });
      } catch (error) {
        setAiBuilderFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Impossible de créer le challenge proposé.",
        });
      } finally {
        setApplyingNewChallengeIndices(current => {
          const next = new Set(current);
          next.delete(index);
          return next;
        });
      }
    },
    [applyingNewChallengeIndices, boardData, challengeById, loadJourneyData, resolveOwnerId],
  );

  useEffect(() => {
    if (!boardData) {
      return;
    }
    setEditValues({
      name: boardData.projectName,
      description: boardData.projectDescription ?? boardData.projectGoal ?? "",
      status: boardData.projectStatus ?? "active",
      startDate: toInputDate(boardData.projectStartDate),
      endDate: toInputDate(boardData.projectEndDate),
      systemPrompt: boardData.projectSystemPrompt ?? "",
    });
  }, [boardData]);


  useEffect(() => {
    if (!boardData) {
      if (activeChallengeId !== null) {
        console.log('🧭 Frontend: Clearing active challenge because board data is unavailable');
      }
      setActiveChallengeId(null);
      return;
    }

    if (activeChallengeId && allChallenges.some(challenge => challenge.id === activeChallengeId)) {
      return;
    }

    const fallbackId = boardData.challenges[0]?.id ?? null;

    if (!activeChallengeId) {
      console.log('🧭 Frontend: Setting initial active challenge', { fallbackId });
    } else {
      console.log('🧭 Frontend: Active challenge missing, selecting fallback', {
        missingId: activeChallengeId,
        fallbackId,
      });
    }

    setActiveChallengeId(fallbackId);
  }, [boardData, activeChallengeId, allChallenges]);

  const challengeParentMap = useMemo(
    () => buildChallengeParentMap(boardData?.challenges),
    [boardData],
  );

  const challengeDescendantsMap = useMemo(
    () => buildChallengeDescendantsMap(boardData?.challenges),
    [boardData],
  );

  const invalidParentIds = useMemo(() => {
    if (!isEditingChallenge || !editingChallengeId) {
      return new Set<string>();
    }

    const ids = new Set<string>([editingChallengeId]);
    const descendants = challengeDescendantsMap.get(editingChallengeId);
    descendants?.forEach(id => ids.add(id));
    return ids;
  }, [isEditingChallenge, editingChallengeId, challengeDescendantsMap]);

  const parentChallengeOptions = useMemo(() => {
    if (!boardData) {
      return [] as { id: string; label: string }[];
    }

    const options: { id: string; label: string }[] = [];

    const traverse = (nodes: ProjectChallengeNode[], depth: number) => {
      nodes.forEach(node => {
        const indent = depth > 0 ? `${"\u00A0".repeat(depth * 2)}↳ ` : "";
        options.push({
          id: node.id,
          label: `${indent}${node.title}`,
        });

        if (node.children?.length) {
          traverse(node.children, depth + 1);
        }
      });
    };

    traverse(boardData.challenges, 0);
    return options;
  }, [boardData]);

  const selectedParentChallenge = useMemo(() => {
    if (!challengeFormValues.parentId) {
      return null;
    }

    return allChallenges.find(challenge => challenge.id === challengeFormValues.parentId) ?? null;
  }, [allChallenges, challengeFormValues.parentId]);

  const challengeInsightMap = useMemo(() => {
    if (!boardData) {
      return new Map<string, ChallengeInsightRow[]>();
    }
    
    console.log('🔍 Frontend: Building insight map from asks:', {
      askCount: boardData.asks.length,
      asks: boardData.asks.map(ask => ({
        id: ask.id,
        title: ask.title,
        participantCount: ask.participants.length,
        participants: ask.participants.map(p => ({
          id: p.id,
          name: p.name,
          insightCount: p.insights.length,
          insights: p.insights.map(i => ({
            id: i.id,
            title: i.title.substring(0, 50),
            relatedChallengeIds: i.relatedChallengeIds,
          })),
        })),
      })),
    });
    
    const map = new Map<string, ChallengeInsightRow[]>();
    boardData.asks.forEach(ask => {
      // Case 1: insights attached to participants (standard flow)
      ask.participants.forEach(participant => {
        participant.insights.forEach(insight => {
          const baseContributors =
            insight.contributors?.length
              ? insight.contributors
              : [{ id: participant.id, name: participant.name, role: participant.role }];

          insight.relatedChallengeIds.forEach(challengeId => {
            const rows = map.get(challengeId) ?? [];
            const existingIndex = rows.findIndex(row => row.id === insight.id && row.askId === ask.id);

            if (existingIndex >= 0) {
              rows[existingIndex] = {
                ...rows[existingIndex],
                contributors: mergeContributors(rows[existingIndex].contributors, baseContributors),
              };
            } else {
              rows.push({
                ...insight,
                contributors: baseContributors,
                askId: ask.id,
                askTitle: ask.title,
              });
            }

            map.set(challengeId, rows);
          });
        });
      });

      // Case 2: no participants provided but ask.insights exists (synthetic/orphan insights)
      // Some loaders may place insights directly on the ask when there are no participants
      // Ensure those are also mapped to challenges for display
      const askLevelInsights: typeof ask.participants[number]["insights"] | undefined = (ask as any).insights;
      if ((!ask.participants || ask.participants.length === 0) && Array.isArray(askLevelInsights) && askLevelInsights.length) {
        askLevelInsights.forEach(insight => {
          const baseContributors = insight.contributors?.length ? insight.contributors : [];

          insight.relatedChallengeIds.forEach((challengeId: string) => {
            const rows = map.get(challengeId) ?? [];
            const existingIndex = rows.findIndex(row => row.id === insight.id && row.askId === ask.id);

            if (existingIndex >= 0) {
              rows[existingIndex] = {
                ...rows[existingIndex],
                contributors: mergeContributors(rows[existingIndex].contributors, baseContributors),
              };
            } else {
              rows.push({
                ...insight,
                contributors: baseContributors,
                askId: ask.id,
                askTitle: ask.title,
              });
            }

            map.set(challengeId, rows);
          });
        });
      }
    });
    
    console.log('🗺️ Frontend: Challenge insight map built:', {
      totalChallenges: map.size,
      challengesWithInsights: Array.from(map.entries()).map(([id, insights]) => ({
        challengeId: id,
        insightCount: insights.length,
      })),
    });
    
    return map;
  }, [boardData]);

  const asksByChallenge = useMemo(() => {
    if (!boardData) {
      return new Map<string, ProjectAskOverview[]>();
    }

    const map = new Map<string, ProjectAskOverview[]>();

    boardData.asks.forEach(ask => {
      const directIds = new Set<string>();
      const relatedIds = new Set<string>();

      if (ask.primaryChallengeId) {
        directIds.add(ask.primaryChallengeId);
      }

      ask.originatingChallengeIds?.forEach(id => {
        if (id) {
          directIds.add(id);
        }
      });

      ask.relatedChallengeIds?.forEach(id => {
        if (id) {
          relatedIds.add(id);
        }
      });

      const targetIds = directIds.size > 0 ? directIds : relatedIds;

      targetIds.forEach(challengeId => {
        const list = map.get(challengeId) ?? [];
        list.push(ask);
        map.set(challengeId, list);
      });
    });

    return map;
  }, [boardData]);

  const activeChallenge = useMemo(
    () => (activeChallengeId ? allChallenges.find(challenge => challenge.id === activeChallengeId) ?? null : null),
    [activeChallengeId, allChallenges],
  );

  const activeChallengeInsights = useMemo(() => {
    if (!activeChallengeId) return [];
    
    const insights = challengeInsightMap.get(activeChallengeId) ?? [];
    
    console.log('🔍 Frontend: Active challenge insights:', {
      challengeId: activeChallengeId,
      insightCount: insights.length,
      insights: insights.map(i => ({ id: i.id, title: i.title })),
    });
    
    return insights;
  }, [challengeInsightMap, activeChallengeId]);

  const activeChallengeAsks = useMemo(
    () => (activeChallengeId ? asksByChallenge.get(activeChallengeId) ?? [] : []),
    [asksByChallenge, activeChallengeId],
  );

  useEffect(() => {
    if (activeChallengeId && rightColumnRef.current) {
      rightColumnRef.current.scrollTo({ top: 0, behavior: "smooth" });
      // Reset expanded ASKs when changing challenge
      setExpandedAsks(new Set());
    }
  }, [activeChallengeId]);

  // Load pre-generated AI ASK suggestions when active challenge changes
  useEffect(() => {
    if (!activeChallenge) {
      return;
    }

    const persistedSuggestions = activeChallenge.aiAskSuggestions;

    // If status is "generating", show the running state
    if (persistedSuggestions?.status === "generating") {
      setIsAskAiRunning(true);
      setAskAiSuggestions([]);
      setAskAiFeedback({ type: "success", message: "Génération des ASKs en cours..." });
      return;
    }

    // If status is "completed" with suggestions, pre-load them
    if (persistedSuggestions?.status === "completed" && persistedSuggestions.suggestions.length > 0) {
      setAskAiSuggestions(persistedSuggestions.suggestions);
      setIsAskAiRunning(false);
      setAskAiFeedback({
        type: "success",
        message: `${persistedSuggestions.suggestions.length} ASK(s) suggérée(s) disponible(s).`,
      });
      return;
    }

    // If status is "error", show the error
    if (persistedSuggestions?.status === "error") {
      setIsAskAiRunning(false);
      setAskAiSuggestions([]);
      setAskAiFeedback({
        type: "error",
        message: persistedSuggestions.error ?? "Erreur lors de la génération des ASKs.",
      });
      return;
    }

    // No persisted suggestions, reset state
    setIsAskAiRunning(false);
    setAskAiSuggestions([]);
    setAskAiFeedback(null);
    setAskAiErrors(null);
  }, [activeChallenge]);

  const handleApplyAiAskSuggestion = useCallback(
    (suggestion: AiAskSuggestion) => {
      if (!boardData) {
        return;
      }

      const challengeId = activeChallengeId ?? allChallenges[0]?.id ?? "";
      if (!challengeId) {
        setAskAiFeedback({ type: "error", message: "Sélectionnez un challenge pour appliquer la suggestion IA." });
        return;
      }

      const trimmedQuestion = suggestion.question?.trim();
      if (!trimmedQuestion) {
        setAskAiFeedback({ type: "error", message: "La suggestion sélectionnée ne contient pas de question valide." });
        return;
      }

      const trimmedTitle = suggestion.title?.trim() || trimmedQuestion.slice(0, 80) || "ASK";
      const candidateKey = suggestion.askKey?.trim();
      const isValidAskKey = Boolean(candidateKey && /^[a-zA-Z0-9._-]{3,255}$/.test(candidateKey));
      const askKey = isValidAskKey ? (candidateKey as string) : generateAskKey(trimmedTitle || trimmedQuestion);

      const matchedParticipants: string[] = [];
      let spokespersonId = "";

      const availableUsers = boardData.availableUsers ?? [];

      if (suggestion.recommendedParticipants?.length) {
        suggestion.recommendedParticipants.forEach(participant => {
          const normalizedName = participant.name?.trim().toLowerCase();
          const matched = participant.id
            ? availableUsers.find(user => user.id === participant.id)
            : normalizedName
              ? availableUsers.find(user => user.name.toLowerCase() === normalizedName)
              : undefined;

          if (matched && !matchedParticipants.includes(matched.id)) {
            matchedParticipants.push(matched.id);
            if (participant.isSpokesperson) {
              spokespersonId = matched.id;
            }
          }
        });
      }

      const descriptionParts: string[] = [];
      const registerDescription = (value?: string | null) => {
        if (!value) {
          return;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return;
        }
        if (!descriptionParts.includes(trimmed)) {
          descriptionParts.push(trimmed);
        }
      };

      registerDescription(suggestion.summary);
      if (suggestion.objective && suggestion.objective !== suggestion.summary) {
        registerDescription(suggestion.objective);
      }
      registerDescription(suggestion.description);

      if (suggestion.followUpActions?.length) {
        const actions = suggestion.followUpActions.map(action => `- ${action}`).join("\n");
        registerDescription(`Actions recommandées :\n${actions}`);
      }

      if (suggestion.relatedInsights?.length) {
        const insightsSummary = suggestion.relatedInsights
          .map(reference => {
            const labelParts = [`Insight ${reference.insightId}`];
            if (reference.title) {
              labelParts.push(reference.title);
            }
            const base = labelParts.join(" – ");
            return reference.reason ? `${base} : ${reference.reason}` : base;
          })
          .join("\n");
        registerDescription(`Insights mobilisés :\n${insightsSummary}`);
      }

      const normaliseDateInput = (value?: string | null): string | null => {
        if (!value) {
          return null;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return null;
        }
        return parsed.toISOString();
      };

      const baseForm = createEmptyAskForm(challengeId);
      const startDate = normaliseDateInput(suggestion.startDate) ?? baseForm.startDate;
      const endDate = normaliseDateInput(suggestion.endDate) ?? baseForm.endDate;
      const maxParticipants = suggestion.maxParticipants ? String(suggestion.maxParticipants) : baseForm.maxParticipants;

      setAskFormValues({
        ...baseForm,
        challengeId,
        askKey,
        name: trimmedTitle,
        question: trimmedQuestion,
        description: descriptionParts.length ? descriptionParts.join("\n\n") : baseForm.description,
        participantIds: matchedParticipants.length ? matchedParticipants : baseForm.participantIds,
        spokespersonId: spokespersonId || baseForm.spokespersonId,
        maxParticipants,
        allowAutoRegistration:
          typeof suggestion.allowAutoRegistration === "boolean" ? suggestion.allowAutoRegistration : baseForm.allowAutoRegistration,
        deliveryMode: suggestion.deliveryMode ?? baseForm.deliveryMode,
        conversationMode: suggestion.conversationMode ?? baseForm.conversationMode,
        startDate,
        endDate,
      });

      setHasManualAskKey(isValidAskKey);
      setIsAskFormOpen(true);
      setIsEditingAsk(false);
      setEditingAskId(null);
      setAskFeedback(null);
      setAskAiFeedback({
        type: "success",
        message: "La suggestion IA a été appliquée au formulaire ASK. Vérifiez et complétez avant de sauvegarder.",
      });
    },
    [activeChallengeId, allChallenges, boardData],
  );

  const renderChallengeList = (nodes: ProjectChallengeNode[], depth = 0) => {
    return (
      <div className={cn("space-y-3", depth === 0 && "mt-2", depth > 0 && "border-l border-white/10 pl-4 mt-3")}
        data-depth={depth}
      >
        {nodes.map(node => {
          const isActive = activeChallengeId === node.id;
          const insightCount = challengeInsightMap.get(node.id)?.length ?? 0;
          const subChallengeCount = countSubChallenges(node);
          const owners = node.owners ?? [];
          const ownerCount = owners.length;
          const description = (node.description ?? "").trim();

          return (
            <Card
              key={node.id}
              className={cn(
                "border border-white/10 bg-slate-900/60 transition hover:border-indigo-400/70",
                isActive && "border-indigo-400 bg-indigo-500/15 shadow-lg",
              )}
            >
              <div className={cn("flex flex-col", !isActive && "sm:flex-row sm:items-stretch")}>
                <button type="button" className="flex-1 text-left" onClick={() => { setActiveChallengeId(node.id); }}>
                  <div className={cn("flex flex-col gap-2", isActive ? "p-4" : "p-3")}
                    data-active={isActive}
                  >
                  {isActive ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg font-semibold text-white">{node.title}</CardTitle>
                        <ChevronRight
                          className={cn(
                            "h-5 w-5 text-slate-500 transition-transform",
                            isActive && "rotate-90 text-indigo-300",
                          )}
                        />
                      </div>
                      {description ? (
                        <ReactMarkdown className="space-y-1.5" components={challengeMarkdownComponents}>
                          {description}
                        </ReactMarkdown>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-200">
                        <span className={cn("rounded-full border px-2.5 py-1", impactClasses[node.impact])}>
                          {impactLabels[node.impact]}
                        </span>
                        {subChallengeCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-slate-200">
                            <ChevronRight className="h-3.5 w-3.5" />
                            {subChallengeCount} sub-challenge{subChallengeCount > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </div>
                      {ownerCount > 0 ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          {owners.map(owner => (
                            <span
                              key={owner.id || owner.name}
                              className="rounded-full bg-white/10 px-2.5 py-1 font-medium text-white"
                            >
                              {owner.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="flex w-full items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-100">{node.title}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] font-medium text-slate-400">
                        <span className={cn("rounded-full border px-2 py-0.5", impactClasses[node.impact])}>
                          {impactLabels[node.impact]}
                        </span>
                        {ownerCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-slate-200">
                            <Users className="h-3 w-3" />
                            {ownerCount > 1 ? `${ownerCount} people` : owners[0]?.name}
                          </span>
                        ) : null}
                        {subChallengeCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-slate-200">
                            <ChevronRight className="h-3 w-3" />
                            {subChallengeCount}
                          </span>
                        ) : null}
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    </div>
                  )}
                  </div>
                </button>
                <div className={cn("flex flex-wrap items-center gap-1", isActive ? "px-4 pb-4 pt-0" : "shrink-0 items-start p-3")}>
                  {insightCount > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="gap-1.5 text-yellow-400 hover:bg-yellow-500/20 hover:text-yellow-300"
                      onClick={event => {
                        event.stopPropagation();
                        event.preventDefault();
                        setActiveChallengeId(node.id);
                        setModalActiveTab("insights");
                        setIsInsightsModalOpen(true);
                      }}
                      title="Voir les insights"
                    >
                      <Lightbulb className="h-4 w-4" />
                      <span className="text-xs">Insights ({insightCount})</span>
                    </Button>
                  ) : null}
                  {(() => {
                    const askCount = asksByChallenge.get(node.id)?.length ?? 0;
                    return (
                      <Button
                        type="button"
                        variant="ghost"
                        className="gap-1.5 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
                        onClick={event => {
                          event.stopPropagation();
                          event.preventDefault();
                          setActiveChallengeId(node.id);
                          setModalActiveTab("asks");
                          setIsInsightsModalOpen(true);
                        }}
                        title={askCount > 0 ? "Voir les asks" : "Créer une ask"}
                      >
                        <MessageSquare className="h-4 w-4" />
                        <span className="text-xs">Gérer les ASKs ({askCount})</span>
                      </Button>
                    );
                  })()}
                  <Button
                    type="button"
                    variant="ghost"
                    className="gap-1.5 text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-100"
                    onClick={event => {
                      event.stopPropagation();
                      event.preventDefault();
                      setActiveChallengeId(node.id);
                      setModalActiveTab("ai");
                      setIsInsightsModalOpen(true);
                    }}
                    title="Suggestions IA pour ce challenge"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span className="text-xs">Créer des challenges</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="gap-1.5 text-slate-200 hover:bg-white/10 hover:text-white"
                    disabled={isSavingChallenge}
                    onClick={event => {
                      event.stopPropagation();
                      event.preventDefault();
                      handleChallengeEditStart(node.id);
                    }}
                    title="Modifier ce challenge"
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="text-xs">Modifier</span>
                  </Button>
                </div>
              </div>
              {node.children?.length ? (
                <CardContent className="border-t border-white/5 bg-slate-900/70">
                  {renderChallengeList(node.children, depth + 1)}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    );
  };

  const getAskInsightsCount = (ask: ProjectAskOverview): number => {
    const uniqueIds = new Set<string>();
    ask.insights.forEach(insight => uniqueIds.add(insight.id));
    ask.participants.forEach(participant => {
      participant.insights.forEach(insight => uniqueIds.add(insight.id));
    });
    return uniqueIds.size;
  };

  const renderAskInsights = (ask: ProjectAskOverview) => {
    const insightMap = new Map<string, AskInsightRow>();

    const registerInsight = (insight: ProjectParticipantInsight, fallback?: ProjectParticipantSummary) => {
      const fallbackContributors = fallback ? [fallback] : [];
      const contributors = insight.contributors?.length ? insight.contributors : fallbackContributors;
      const existing = insightMap.get(insight.id);

      if (existing) {
        insightMap.set(insight.id, {
          ...existing,
          contributors: mergeContributors(existing.contributors, contributors),
        });
      } else {
        insightMap.set(insight.id, {
          ...insight,
          contributors,
        });
      }
    };

    ask.insights.forEach(insight => {
      registerInsight(insight);
    });

    ask.participants.forEach(participant => {
      const fallbackContributor: ProjectParticipantSummary = {
        id: participant.id,
        name: participant.name,
        role: participant.role,
      };
      participant.insights.forEach(insight => {
        registerInsight(insight, fallbackContributor);
      });
    });

    const rows = Array.from(insightMap.values());

    if (rows.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
          No insights have been published for this ASK yet.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {rows.map(row => (
          <div key={row.id} className="rounded-lg border border-yellow-400/30 bg-yellow-500/10 p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
              <span className={cn("rounded-full border px-2 py-0.5", insightTypeClasses[row.type])}>
                {row.type.toUpperCase()}
              </span>
              <span className="inline-flex items-center gap-1 text-slate-300">
                <Users className="h-3.5 w-3.5 text-slate-400" />
                <span className="flex flex-wrap items-center gap-1">
                  {row.contributors.map(contributor => (
                    <span
                      key={contributor.id || contributor.name}
                      className="rounded-full bg-white/10 px-2 py-0.5 font-medium text-white"
                    >
                      {contributor.name}
                    </span>
                  ))}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(row.updatedAt)}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-white">{row.title}</p>
            <p className="mt-1 text-sm text-slate-300">{row.description}</p>
            {row.relatedChallengeIds.length ? (
              <div className="mt-2 text-xs text-slate-400">
                Linked to {row.relatedChallengeIds.length} challenge{row.relatedChallengeIds.length > 1 ? "s" : ""}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  // Hooks must be called before any early returns
  const getAnswerLinkForAsk = useCallback(
    (ask: ProjectAskOverview) => {
      if (!ask?.askKey) {
        return { href: null, canAnswer: false };
      }

      if (!currentProfileId) {
        return { href: null, canAnswer: false };
      }

      const participant = ask.participants.find(
        item => item.userId === currentProfileId || item.id === currentProfileId,
      );
      if (!participant) {
        return { href: null, canAnswer: false };
      }

      // Use ask key for public entry flow
      return { href: `/?ask=${encodeURIComponent(ask.askKey)}`, canAnswer: true };
    },
    [currentProfileId],
  );

  const availableUsers = boardData?.availableUsers ?? [];
  const inviteLinkConfig = useMemo(() => {
    const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
    const origin =
      typeof window !== "undefined" && window?.location?.origin
        ? window.location.origin.replace(/\/+$/, "")
        : "";
    const baseUrl = envBase || origin;
    if (!baseUrl) {
      return null;
    }
    const askKey = askFormValues.askKey?.trim();
    return {
      baseUrl,
      askKey: askKey && askKey.length > 0 ? askKey : null,
    };
  }, [askFormValues.askKey]);

  const inviteParticipants = useMemo(() => {
    if (!isEditingAsk || !editingAskId) {
      return [];
    }

    const participants = editingAskRecord?.participants ?? [];
    return askFormValues.participantIds.map(participantId => {
      const user = availableUsers.find(u => u.id === participantId);
      const recordParticipant = participants.find(item => item.id === participantId);
      // Use availableUsers as primary source for name (same as Participants section above)
      // Fallback to recordParticipant name if user not found in availableUsers
      const name = user?.name ?? recordParticipant?.name ?? participantId;
      return {
        id: participantId,
        name,
        email: recordParticipant?.email ?? null,
        inviteToken: recordParticipant?.inviteToken ?? null,
      };
    });
  }, [askFormValues.participantIds, availableUsers, editingAskRecord, editingAskId, isEditingAsk]);

  useEffect(() => {
    setCopiedInviteLinks(new Set());
  }, [editingAskId, askFormValues.participantIds, askFormValues.askKey]);

  const handleSendAskInvites = useCallback(async () => {
    if (!editingAskId) {
      return;
    }

    setIsSendingAskInvites(true);
    try {
      const response = await fetch(`/api/admin/asks/${editingAskId}/send-invites`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to send invites.");
      }

      const sent = payload.data?.sent ?? 0;
      const failed = payload.data?.failed ?? 0;
      const suffix = failed > 0 ? `, ${failed} failed` : "";
      setAskFeedback({
        type: "success",
        message: `Sent ${sent} invite${sent === 1 ? "" : "s"}${suffix}`,
      });
    } catch (error) {
      console.error("Failed to send ASK invites", error);
      setAskFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to send invites.",
      });
    } finally {
      setIsSendingAskInvites(false);
    }
  }, [editingAskId]);

  const handleToggleAskParticipants = useCallback(async (askId: string) => {
    const isCurrentlyExpanded = expandedAskParticipants.has(askId);

    if (isCurrentlyExpanded) {
      setExpandedAskParticipants(prev => {
        const next = new Set(prev);
        next.delete(askId);
        return next;
      });
      setAskParticipantEdits(prev => {
        const next = { ...prev };
        delete next[askId];
        return next;
      });
      return;
    }

    // Expand the participants section
    setExpandedAskParticipants(prev => {
      const next = new Set(prev);
      next.add(askId);
      return next;
    });

    // Load ASK details if not already loaded, or if missing progress data
    const existingRecord = askDetails[askId];
    const needsProgressData = existingRecord && existingRecord.progressData === undefined;

    if (!existingRecord || needsProgressData) {
      setIsLoadingAskDetails(true);
      try {
        const record = await ensureAskDetails(askId);
        const participantIds = record.participants?.map(p => p.id) ?? [];
        const spokespersonId = record.participants?.find(p => p.isSpokesperson)?.id ?? "";
        setAskParticipantEdits(prev => ({
          ...prev,
          [askId]: { participantIds, spokespersonId }
        }));
      } catch (error) {
        console.error("Failed to load ASK details for participants", error);
      } finally {
        setIsLoadingAskDetails(false);
      }
    } else {
      const participantIds = existingRecord.participants?.map(p => p.id) ?? [];
      const spokespersonId = existingRecord.participants?.find(p => p.isSpokesperson)?.id ?? "";
      setAskParticipantEdits(prev => ({
        ...prev,
        [askId]: { participantIds, spokespersonId }
      }));
    }
  }, [askDetails, ensureAskDetails, expandedAskParticipants]);

  const handleAskParticipantToggleInCard = useCallback((askId: string, userId: string) => {
    setAskParticipantEdits(prev => {
      const current = prev[askId] ?? { participantIds: [], spokespersonId: "" };
      const isSelected = current.participantIds.includes(userId);
      const newParticipantIds = isSelected
        ? current.participantIds.filter(id => id !== userId)
        : [...current.participantIds, userId];

      // Clear spokesperson if removed from participants
      const newSpokespersonId = newParticipantIds.includes(current.spokespersonId)
        ? current.spokespersonId
        : "";

      return {
        ...prev,
        [askId]: { participantIds: newParticipantIds, spokespersonId: newSpokespersonId }
      };
    });
  }, []);

  const handleAskSpokespersonChangeInCard = useCallback((askId: string, spokespersonId: string) => {
    setAskParticipantEdits(prev => {
      const current = prev[askId] ?? { participantIds: [], spokespersonId: "" };
      return {
        ...prev,
        [askId]: { ...current, spokespersonId }
      };
    });
  }, []);

  const handleSaveAskParticipantsInCard = useCallback(async (askId: string) => {
    const edits = askParticipantEdits[askId];
    if (!edits) return;

    setSavingAskParticipants(prev => {
      const next = new Set(prev);
      next.add(askId);
      return next;
    });

    try {
      const response = await fetch(`/api/admin/asks/${askId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantIds: edits.participantIds,
          spokespersonId: edits.spokespersonId || undefined
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to update participants");
      }

      // Update the askDetails cache
      if (result.data) {
        setAskDetails(prev => ({
          ...prev,
          [askId]: result.data
        }));
      }

      // Refresh board data
      const refreshResponse = await fetch(`/api/admin/projects/${projectId}/journey`);
      const refreshResult = await refreshResponse.json();
      if (refreshResult.success && refreshResult.data) {
        setBoardData(refreshResult.data);
      }

      setAskFeedback({ type: "success", message: "Participants updated successfully" });
    } catch (error) {
      console.error("Failed to save participants", error);
      setAskFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update participants"
      });
    } finally {
      setSavingAskParticipants(prev => {
        const next = new Set(prev);
        next.delete(askId);
        return next;
      });
    }
  }, [askParticipantEdits, projectId]);

  const handleSendAskInvitesInCard = useCallback(async (askId: string) => {
    setIsSendingAskInvites(true);
    try {
      const response = await fetch(`/api/admin/asks/${askId}/send-invites`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to send invites.");
      }

      const sent = payload.data?.sent ?? 0;
      const failed = payload.data?.failed ?? 0;
      const suffix = failed > 0 ? `, ${failed} failed` : "";
      setAskFeedback({
        type: "success",
        message: `Sent ${sent} invite${sent === 1 ? "" : "s"}${suffix}`,
      });
    } catch (error) {
      console.error("Failed to send ASK invites", error);
      setAskFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to send invites.",
      });
    } finally {
      setIsSendingAskInvites(false);
    }
  }, []);

  const getInviteLinkForAsk = useCallback((askKey: string, inviteToken?: string | null) => {
    const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
    const origin = typeof window !== "undefined" && window?.location?.origin
      ? window.location.origin.replace(/\/+$/, "")
      : "";
    const baseUrl = envBase || origin;
    if (!baseUrl) return null;

    const params = new URLSearchParams();
    if (inviteToken) {
      params.set("token", inviteToken);
    } else if (askKey) {
      params.set("key", askKey);
    }
    const query = params.toString();
    return query ? `${baseUrl}/?${query}` : null;
  }, []);

  if (!boardData && isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-300">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-300" />
        <p>Loading project journey…</p>
      </div>
    );
  }

  if (!boardData) {
    return (
      <div className="space-y-3 rounded-xl border border-white/10 bg-slate-900/70 p-6 text-center text-slate-200">
        <p>Unable to display project data.</p>
        {error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : (
          <p className="text-sm text-slate-400">Please refresh the page or verify the project configuration.</p>
        )}
      </div>
    );
  }

  const projectStart = formatFullDate(boardData.projectStartDate);
  const projectEnd = formatFullDate(boardData.projectEndDate);

  const handleEditToggle = () => {
    setIsEditingProject(current => !current);
    setFeedback(null);
  };

  const handleInputChange = (field: keyof ProjectEditState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value } = event.target;
    setEditValues(current => ({ ...current, [field]: value }));
  };

  const handleProjectDateChange = (field: "startDate" | "endDate") => (value: string) => {
    setEditValues(current => ({ ...current, [field]: value }));
  };

  const resetChallengeFormValues = (overrides?: Partial<ChallengeFormState>) => {
    setChallengeFormValues({
      ...createEmptyChallengeForm(),
      ...overrides,
    });
  };

  const handleChallengeStart = (parent?: ProjectChallengeNode | null) => {
    setChallengeFormMode("create");
    setEditingChallengeId(null);
    setIsChallengeFormVisible(true);
    setChallengeFeedback(null);
    resetChallengeFormValues({
      parentId: parent?.id ?? "",
      impact: parent?.impact ?? "medium",
    });
  };

  const handleChallengeCancel = () => {
    setIsChallengeFormVisible(false);
    setChallengeFormMode("create");
    setEditingChallengeId(null);
    setIsSavingChallenge(false);
    setChallengeFeedback(null);
    resetChallengeFormValues();
  };

  const handleChallengeFieldChange = (
    field: Extract<keyof ChallengeFormState, "title" | "description" | "status" | "impact">,
  ) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { value } = event.target;
      setChallengeFormValues(current => ({
        ...current,
        [field]:
          field === "impact"
            ? (value as ChallengeFormState["impact"])
            : field === "status"
              ? (value as ChallengeFormState["status"])
              : value,
      }));
    };

  const handleChallengeParentChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    setChallengeFormValues(current => ({
      ...current,
      parentId: value,
    }));
  };

  const handleChallengeOwnerToggle = (ownerId: string) => {
    setChallengeFormValues(current => {
      const hasOwner = current.ownerIds.includes(ownerId);
      return {
        ...current,
        ownerIds: hasOwner ? current.ownerIds.filter(id => id !== ownerId) : [...current.ownerIds, ownerId],
      };
    });
  };

  const handleChallengeEditStart = (challengeId: string) => {
    if (!boardData) {
      return;
    }

    const node = allChallenges.find(challenge => challenge.id === challengeId);
    if (!node) {
      return;
    }

    const statusValues = challengeStatusOptions.map(option => option.value);
    const normalizedStatus = statusValues.includes(node.status as ChallengeStatus)
      ? (node.status as ChallengeStatus)
      : "open";

    const ownerIds = (node.owners ?? [])
      .map(owner => owner.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const parentId = challengeParentMap.get(challengeId);

    setChallengeFormMode("edit");
    setEditingChallengeId(challengeId);
    setIsChallengeFormVisible(true);
    setChallengeFeedback(null);
    setIsSavingChallenge(false);
    setChallengeFormValues({
      title: node.title,
      description: node.description ?? "",
      status: normalizedStatus,
      impact: node.impact,
      ownerIds,
      parentId: parentId ?? "",
    });
  };

  const handleChallengeSave = async () => {
    if (!boardData) {
      return;
    }

    const trimmedTitle = challengeFormValues.title.trim();
    if (!trimmedTitle) {
      setChallengeFeedback({ type: "error", message: "Please provide a challenge title." });
      return;
    }

    const trimmedDescription = challengeFormValues.description.trim();
    const normalizedStatus = challengeFormValues.status;
    const owners = availableUsers
      .filter(user => challengeFormValues.ownerIds.includes(user.id))
      .map(user => ({ id: user.id, name: user.name, role: user.role }));
    const fallbackId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `challenge-${Date.now()}`;
    const validImpacts = Object.keys(impactLabels) as ProjectChallengeNode["impact"][];
    const validStatuses = challengeStatusOptions.map(option => option.value) as ChallengeStatus[];
    const normalizedParentId = challengeFormValues.parentId.trim();
    const parentChallenge = normalizedParentId
      ? allChallenges.find(challenge => challenge.id === normalizedParentId) ?? null
      : null;

    if (isEditingChallenge && editingChallengeId) {
      const invalidParentIds = new Set<string>([editingChallengeId]);
      const descendants = challengeDescendantsMap.get(editingChallengeId);
      descendants?.forEach(id => invalidParentIds.add(id));

      if (normalizedParentId && invalidParentIds.has(normalizedParentId)) {
        setChallengeFeedback({
          type: "error",
          message: "A challenge cannot be nested under one of its own sub-challenges.",
        });
        return;
      }
    }

    const resolvedParentId = normalizedParentId || "";

    const buildChallengeNode = (id: string, overrides?: Partial<ProjectChallengeNode>): ProjectChallengeNode => ({
      id,
      title: overrides?.title ?? trimmedTitle,
      description: overrides?.description ?? trimmedDescription,
      status: overrides?.status ?? normalizedStatus,
      impact: overrides?.impact ?? challengeFormValues.impact,
      owners,
      relatedInsightIds: overrides?.relatedInsightIds ?? [],
      children: [],
    });

    setIsSavingChallenge(true);
    setChallengeFeedback(null);

    try {
      if (USE_MOCK_JOURNEY) {
        if (isEditingChallenge && editingChallengeId) {
          setBoardData(current => {
            if (!current) {
              return current;
            }

            const [remaining, extracted] = removeChallengeNode(current.challenges, editingChallengeId);
            if (!extracted) {
              return current;
            }

            const updatedChallenge: ProjectChallengeNode = {
              ...extracted,
              title: trimmedTitle,
              description: trimmedDescription,
              status: normalizedStatus,
              impact: challengeFormValues.impact,
              owners,
            };

            const nextChallenges = insertChallengeNode(remaining, updatedChallenge, resolvedParentId || null);

            return {
              ...current,
              challenges: nextChallenges,
            };
          });
          setActiveChallengeId(editingChallengeId);
          setChallengeFeedback({ type: "success", message: "Challenge updated successfully." });
        } else {
          const localChallenge = buildChallengeNode(fallbackId);
          setBoardData(current =>
            current
              ? {
                  ...current,
                  challenges: insertChallengeNode(current.challenges, localChallenge, resolvedParentId || null),
                }
              : current,
          );
          setActiveChallengeId(localChallenge.id);
          setChallengeFeedback({
            type: "success",
            message: parentChallenge
              ? `Sub-challenge added under "${parentChallenge.title}".`
              : "Challenge added to the journey.",
          });
        }

        setIsChallengeFormVisible(false);
        setChallengeFormMode("create");
        setEditingChallengeId(null);
        resetChallengeFormValues();
        return;
      }

      if (isEditingChallenge && editingChallengeId) {
        const payload = {
          name: trimmedTitle,
          description: trimmedDescription,
          status: normalizedStatus,
          priority: challengeFormValues.impact,
          assignedTo: owners[0]?.id ?? "",
          parentChallengeId: resolvedParentId,
        };

        console.log('🔧 Frontend: Updating challenge with payload:', payload);

        const response = await fetch(`/api/admin/challenges/${editingChallengeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        console.log('📡 Frontend: API response:', { status: response.status, result });
        
        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to update challenge.");
        }

        console.log('✅ Frontend: Challenge updated, reloading data...');
        await loadJourneyData({ silent: true });
        setActiveChallengeId(editingChallengeId);
        setChallengeFeedback({ type: "success", message: "Challenge updated successfully." });
      } else {
        const payload = {
          name: trimmedTitle,
          description: trimmedDescription,
          status: normalizedStatus,
          priority: challengeFormValues.impact,
          projectId: boardData.projectId,
          assignedTo: owners[0]?.id ?? "",
          parentChallengeId: resolvedParentId,
        };

        const response = await fetch("/api/admin/challenges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to create challenge.");
        }

        const created = result.data as ChallengeRecord;
        const challengeId = created?.id ?? fallbackId;
        const serverImpact = created?.priority && validImpacts.includes(created.priority as ProjectChallengeNode["impact"])
          ? (created.priority as ProjectChallengeNode["impact"])
          : challengeFormValues.impact;
        const serverStatus = created?.status && validStatuses.includes(created.status as ChallengeStatus)
          ? (created.status as ChallengeStatus)
          : normalizedStatus;

        const challengeNode = buildChallengeNode(challengeId, {
          title: created?.name ?? trimmedTitle,
          description: created?.description ?? trimmedDescription,
          status: serverStatus,
          impact: serverImpact,
        });

        setBoardData(current =>
          current
            ? {
                ...current,
                challenges: insertChallengeNode(current.challenges, challengeNode, resolvedParentId || null),
              }
            : current,
        );
        setActiveChallengeId(challengeNode.id);
        setChallengeFeedback({
          type: "success",
          message: parentChallenge
            ? `Sub-challenge created under "${parentChallenge.title}".`
            : "Challenge created successfully.",
        });
      }

      setIsChallengeFormVisible(false);
      setChallengeFormMode("create");
      setEditingChallengeId(null);
      resetChallengeFormValues();
    } catch (error) {
      console.error(isEditingChallenge ? "Failed to update challenge" : "Failed to create challenge", error);
      setChallengeFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : isEditingChallenge
              ? "Unable to update challenge."
              : "Unable to create challenge.",
      });
    } finally {
      setIsSavingChallenge(false);
    }
  };

  const getDefaultChallengeId = () => activeChallengeId ?? allChallenges[0]?.id ?? "";

  const handleAskCreateStart = () => {
    const defaultChallengeId = getDefaultChallengeId();
    setAskFormValues(createEmptyAskForm(defaultChallengeId));
    setHasManualAskKey(false);
    setIsAskFormOpen(true);
    setIsEditingAsk(false);
    setEditingAskId(null);
    setAskFeedback(null);
    setIsLoadingAskDetails(false);
  };

  const handleAskCancel = () => {
    setIsAskFormOpen(false);
    setIsEditingAsk(false);
    setEditingAskId(null);
    setAskFeedback(null);
    setIsSavingAsk(false);
    setHasManualAskKey(false);
    setAskFormValues(createEmptyAskForm(getDefaultChallengeId()));
  };

  const handleAskNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setAskFormValues(current => {
      const next: AskFormState = { ...current, name: value };
      if (!isEditingAsk && !hasManualAskKey) {
        next.askKey = generateAskKey(value || "ask");
      }
      return next;
    });
  };

  const handleAskKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, askKey: value }));
    setHasManualAskKey(true);
  };

  const handleAskKeyRegenerate = () => {
    if (isEditingAsk) {
      return;
    }
    const base = askFormValues.name || "ask";
    const nextKey = generateAskKey(base);
    setAskFormValues(current => ({ ...current, askKey: nextKey }));
    setHasManualAskKey(false);
  };

  const handleAskQuestionChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, question: value }));
  };

  const handleAskDescriptionChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, description: value }));
  };

  const handleAskSystemPromptChange = (value: string) => {
    setAskFormValues(current => ({ ...current, systemPrompt: value }));
  };

  const handleAskStartChange = (value: string) => {
    setAskFormValues(current => ({ ...current, startDate: value }));
  };

  const handleAskEndChange = (value: string) => {
    setAskFormValues(current => ({ ...current, endDate: value }));
  };

  const handleAskStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, status: value as AskFormState["status"] }));
  };

  const handleAskDeliveryModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, deliveryMode: value as AskDeliveryMode }));
  };

  const handleAskConversationModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, conversationMode: value as AskConversationMode }));
  };

  const handleAskExpectedDurationChange = (value: number) => {
    setAskFormValues(current => ({ ...current, expectedDurationMinutes: value }));
  };

  const handleAskChallengeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, challengeId: value }));
  };

  const handleAskMaxParticipantsChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    if (value === "" || /^[0-9]+$/.test(value)) {
      setAskFormValues(current => ({ ...current, maxParticipants: value }));
    }
  };

  const handleAskAnonymousToggle = (event: ChangeEvent<HTMLInputElement>) => {
    setAskFormValues(current => ({ ...current, allowAutoRegistration: event.target.checked }));
  };

  const handleAskParticipantToggle = (userId: string) => {
    setAskFormValues(current => {
      const hasParticipant = current.participantIds.includes(userId);
      const participantIds = hasParticipant
        ? current.participantIds.filter(id => id !== userId)
        : [...current.participantIds, userId];
      const spokespersonId = participantIds.includes(current.spokespersonId)
        ? current.spokespersonId
        : "";
      return {
        ...current,
        participantIds,
        spokespersonId,
      };
    });
  };

  const handleAskSpokespersonChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    setAskFormValues(current => ({ ...current, spokespersonId: value }));
  };

  const handleAskFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Prevent double submission (race condition protection)
    if (isSavingAsk) {
      console.log('⚠️ Ignoring duplicate ASK form submission');
      return;
    }

    if (!boardData) {
      return;
    }

    const challengeId = askFormValues.challengeId;
    const trimmedName = askFormValues.name.trim();
    const trimmedQuestion = askFormValues.question.trim();
    const trimmedDescription = askFormValues.description.trim();
    const startDate = askFormValues.startDate;
    const endDate = askFormValues.endDate;
    const maxParticipantsValue = askFormValues.maxParticipants.trim();
    const numericMaxParticipants = maxParticipantsValue ? Number(maxParticipantsValue) : undefined;

    if (!challengeId) {
      setAskFeedback({ type: "error", message: "Select a challenge to attach this ASK to." });
      return;
    }
    if (!trimmedName) {
      setAskFeedback({ type: "error", message: "Provide a name for this ASK." });
      return;
    }
    if (trimmedQuestion.length < 5) {
      setAskFeedback({ type: "error", message: "The question is too short." });
      return;
    }
    if (!startDate) {
      setAskFeedback({ type: "error", message: "Set a start date for the session." });
      return;
    }
    if (!endDate) {
      setAskFeedback({ type: "error", message: "Set an end date for the session." });
      return;
    }
    if (maxParticipantsValue && Number.isNaN(numericMaxParticipants)) {
      setAskFeedback({ type: "error", message: "Maximum participants must be a number." });
      return;
    }

    // Validate UUID format for challengeId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (challengeId && !uuidRegex.test(challengeId)) {
      setAskFeedback({ type: "error", message: "Invalid challenge ID format." });
      return;
    }

    // Validate dates
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    if (isNaN(startDateObj.getTime())) {
      setAskFeedback({ type: "error", message: "Invalid start date format." });
      return;
    }
    if (isNaN(endDateObj.getTime())) {
      setAskFeedback({ type: "error", message: "Invalid end date format." });
      return;
    }
    if (endDateObj <= startDateObj) {
      setAskFeedback({ type: "error", message: "End date must be after start date." });
      return;
    }

    const participantIds = askFormValues.participantIds;
    
    // Validate participantIds are valid UUIDs
    for (const id of participantIds) {
      if (id && !uuidRegex.test(id)) {
        setAskFeedback({ type: "error", message: `Invalid participant ID format: ${id}` });
        return;
      }
    }
    
    const spokespersonId =
      askFormValues.spokespersonId && participantIds.includes(askFormValues.spokespersonId)
        ? askFormValues.spokespersonId
        : "";
    
    // Validate spokespersonId is a valid UUID if provided
    if (spokespersonId && !uuidRegex.test(spokespersonId)) {
      setAskFeedback({ type: "error", message: "Invalid spokesperson ID format." });
      return;
    }

    const basePayload = {
      name: trimmedName,
      question: trimmedQuestion,
      description: trimmedDescription,
      startDate,
      endDate,
      status: askFormValues.status,
      allowAutoRegistration: askFormValues.allowAutoRegistration,
      maxParticipants: numericMaxParticipants,
      deliveryMode: askFormValues.deliveryMode,
      conversationMode: askFormValues.conversationMode,
      expectedDurationMinutes: askFormValues.expectedDurationMinutes,
      participantIds,
      spokespersonId,
      challengeId,
      systemPrompt: askFormValues.systemPrompt || null,
    };

    setIsSavingAsk(true);
    setAskFeedback(null);

    try {
      if (isEditingAsk && editingAskId) {
        const response = await fetch(`/api/admin/asks/${editingAskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to update ASK");
        }
        const record = payload.data as AskSessionRecord;
        setAskDetails(current => ({ ...current, [record.id]: record }));
        setAskFeedback({ type: "success", message: "ASK updated successfully." });
        await loadJourneyData({ silent: true });
        setIsAskFormOpen(false);
        setIsEditingAsk(false);
        setEditingAskId(null);
        setHasManualAskKey(false);
        setAskFormValues(createEmptyAskForm(getDefaultChallengeId()));
      } else {
        // Validate projectId UUID format
        if (!uuidRegex.test(boardData.projectId)) {
          setAskFeedback({ type: "error", message: "Invalid project ID format." });
          setIsSavingAsk(false);
          return;
        }

        let askKey = (askFormValues.askKey || "").trim() || generateAskKey(trimmedName || "ask");
        
        // Validate askKey format: must match /^[a-zA-Z0-9._-]+$/
        const askKeyRegex = /^[a-zA-Z0-9._-]+$/;
        if (!askKeyRegex.test(askKey)) {
          // Regenerate if invalid
          askKey = generateAskKey(trimmedName || "ask");
          if (!askKeyRegex.test(askKey)) {
            setAskFeedback({ type: "error", message: "Unable to generate a valid ASK key. Please provide a valid key (letters, numbers, dots, underscores, and hyphens only)." });
            setIsSavingAsk(false);
            return;
          }
        }

        // Validate askKey length
        if (askKey.length < 3 || askKey.length > 255) {
          setAskFeedback({ type: "error", message: "ASK key must be between 3 and 255 characters." });
          setIsSavingAsk(false);
          return;
        }

        const payload = { ...basePayload, askKey, projectId: boardData.projectId };
        
        console.log('🔧 Frontend: Creating ASK with payload:', payload);

        const response = await fetch("/api/admin/asks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        
        const result = await response.json();
        console.log('📡 Frontend: ASK creation response:', { status: response.status, result });
        
        if (!response.ok || !result.success) {
          // Display more detailed error message
          const errorMsg = result.error || "Unable to create ASK";
          console.error('❌ ASK creation failed:', errorMsg);
          throw new Error(errorMsg);
        }
        
        const record = result.data as AskSessionRecord;
        console.log('✅ Frontend: ASK created successfully:', record);

        setAskDetails(current => ({ ...current, [record.id]: record }));
        setAskFeedback({ type: "success", message: "ASK created successfully." });
        setFeedback({ type: "success", message: "ASK created successfully." });

        // Remove the used suggestion from local state and persist to database
        const createdAskKey = record.askKey;
        const challengeIdForSuggestion = askFormValues.challengeId;

        // Update local state
        setAskAiSuggestions(current =>
          current.filter(suggestion => {
            const suggestionKey = suggestion.askKey?.trim();
            if (!suggestionKey) return true;
            return !createdAskKey.startsWith(suggestionKey);
          })
        );

        // Persist removal to database (fire-and-forget)
        if (challengeIdForSuggestion) {
          fetch(`/api/admin/challenges/${challengeIdForSuggestion}/ai/ask-suggestions`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ askKey: createdAskKey }),
          }).catch(err => console.error("Failed to persist suggestion removal:", err));
        }

        console.log('✅ Frontend: ASK created, reloading data...');
        await loadJourneyData({ silent: true });
        handleAskCancel();
      }
    } catch (error) {
      console.error("Failed to save ASK", error);
      setAskFeedback({ type: "error", message: error instanceof Error ? error.message : "Unable to save ASK" });
    } finally {
      setIsSavingAsk(false);
    }
  };

  const handleAskEditStart = async (askId: string) => {
    setIsAskFormOpen(true);
    setIsEditingAsk(true);
    setEditingAskId(askId);
    setHasManualAskKey(true);
    setAskFeedback(null);
    setIsLoadingAskDetails(true);

    try {
      const record = await ensureAskDetails(askId);
      const participants = record.participants?.map(participant => participant.id) ?? [];
      const spokesperson = record.participants?.find(participant => participant.isSpokesperson)?.id ?? "";

      setAskFormValues({
        challengeId: record.challengeId ?? getDefaultChallengeId(),
        askKey: record.askKey,
        name: record.name ?? "",
        question: record.question ?? "",
        description: record.description ?? "",
        status: normalizeAskStatus(record.status),
        startDate: toInputDate(record.startDate),
        endDate: toInputDate(record.endDate),
        allowAutoRegistration: Boolean(record.allowAutoRegistration),
        maxParticipants: record.maxParticipants ? String(record.maxParticipants) : "",
        participantIds: participants,
        spokespersonId: spokesperson && participants.includes(spokesperson) ? spokesperson : "",
        deliveryMode: record.deliveryMode ?? "digital",
        conversationMode: record.conversationMode ?? "collaborative",
        systemPrompt: record.systemPrompt ?? "",
        expectedDurationMinutes: record.expectedDurationMinutes ?? 8,
      });
    } catch (error) {
      console.error("Failed to load ASK details", error);
      setAskFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to load ASK details.",
      });
      setIsAskFormOpen(false);
      setIsEditingAsk(false);
      setEditingAskId(null);
    } finally {
      setIsLoadingAskDetails(false);
    }
  };

  const handleProjectSave = async () => {
    if (!boardData) {
      return;
    }
    const payload: Record<string, unknown> = {};
    const trimmedName = editValues.name.trim();
    if (trimmedName.length > 0 && trimmedName !== boardData.projectName) {
      payload.name = trimmedName;
    }

    if (editValues.description.trim() !== (boardData.projectDescription ?? boardData.projectGoal ?? "").trim()) {
      payload.description = editValues.description;
    }

    if (editValues.status !== (boardData.projectStatus ?? "")) {
      payload.status = editValues.status;
    }

    if (editValues.startDate && editValues.startDate !== toInputDate(boardData.projectStartDate)) {
      const startDate = new Date(editValues.startDate);
      if (Number.isNaN(startDate.getTime())) {
        setFeedback({ type: "error", message: "Please provide a valid project start date." });
        return;
      }
      payload.startDate = startDate.toISOString();
    }

    if (editValues.endDate && editValues.endDate !== toInputDate(boardData.projectEndDate)) {
      const endDate = new Date(editValues.endDate);
      if (Number.isNaN(endDate.getTime())) {
        setFeedback({ type: "error", message: "Please provide a valid project end date." });
        return;
      }
      payload.endDate = endDate.toISOString();
    }

    if (editValues.systemPrompt !== (boardData.projectSystemPrompt ?? "")) {
      payload.systemPrompt = editValues.systemPrompt;
    }

    if (Object.keys(payload).length === 0) {
      setFeedback({ type: "error", message: "No changes detected." });
      return;
    }

    try {
      setIsSavingProject(true);
      setFeedback(null);
      const response = await fetch(`/api/admin/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to update project");
      }
      const updated = result.data as {
        name: string;
        description?: string | null;
        status: string;
        startDate: string;
        endDate: string;
        systemPrompt?: string | null;
      };

      setBoardData(current =>
        current
          ? {
              ...current,
              projectName: updated.name,
              projectDescription: updated.description ?? null,
              projectGoal: updated.description ?? null,
              projectStatus: updated.status,
              projectStartDate: updated.startDate,
              projectEndDate: updated.endDate,
              projectSystemPrompt: updated.systemPrompt ?? null,
              timeframe: formatTimeframe(updated.startDate, updated.endDate),
            }
          : current,
      );

      setFeedback({ type: "success", message: "Project updated successfully." });
      setIsEditingProject(false);
    } catch (err) {
      console.error("Failed to update project", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Unable to update project.",
      });
    } finally {
      setIsSavingProject(false);
    }
  };

  /**
   * Handles purging all conversation data from the project.
   * This is a dangerous, irreversible operation restricted to full_admin only.
   */
  const handleProjectPurge = async () => {
    if (!isFullAdmin) {
      setPurgeFeedback({ type: "error", message: "Cette action est réservée aux administrateurs complets." });
      return;
    }

    try {
      setIsPurging(true);
      setPurgeFeedback(null);

      const response = await fetch(`/api/admin/projects/${projectId}/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationWord: purgeConfirmationWord }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Impossible de purger les données du projet.");
      }

      const data = result.data as {
        deletedMessages: number;
        deletedInsights: number;
        deletedConversationThreads: number;
        deletedInsightSyntheses: number;
        deletedGraphEdges: number;
        aiBuilderResultsCleared: boolean;
        timersReset: number;
      };

      setPurgeFeedback({
        type: "success",
        message: `Données purgées : ${data.deletedMessages} message(s), ${data.deletedInsights} insight(s), ${data.deletedInsightSyntheses} synthèse(s), ${data.deletedGraphEdges} lien(s) de graphe, ${data.timersReset} timer(s) remis à zéro.`,
      });

      // Reset confirmation word and close dialog
      setPurgeConfirmationWord("");
      setIsPurgeDialogOpen(false);

      // Reload project data to reflect changes
      await loadJourneyData();

      // Clear AI builder results state
      setAiSuggestions([]);
      setAiNewChallenges([]);
      setAiBuilderErrors(null);
      setAiBuilderLastRunAt(null);
      setHasAiBuilderResults(false);

      // Clear all timer data from localStorage to prevent stale values
      clearAllTimersFromLocalStorage();

    } catch (err) {
      console.error("Failed to purge project data", err);
      setPurgeFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Impossible de purger les données.",
      });
    } finally {
      setIsPurging(false);
    }
  };

  const handleGenerateSyntheses = async () => {
    setIsGeneratingSyntheses(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/graph/synthesis/${projectId}`, {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        setFeedback({
          type: "success",
          message: `Généré ${data.data?.length || 0} synthèse(s) d'insights.`,
        });
        // Force refresh of GraphRAGPanel
        setSynthesisRefreshKey(prev => prev + 1);
      } else {
        setFeedback({
          type: "error",
          message: data.error || "Échec de la génération des synthèses.",
        });
      }
    } catch (err) {
      console.error("Failed to generate syntheses", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Impossible de générer les synthèses.",
      });
    } finally {
      setIsGeneratingSyntheses(false);
    }
  };

  const handleChallengeDelete = async () => {
    if (!editingChallengeId) {
      return;
    }

    if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce challenge ? Cette action est irréversible.")) {
      return;
    }

    try {
      setIsSavingChallenge(true);
      setFeedback(null);
      
      const response = await fetch(`/api/admin/challenges/${editingChallengeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Impossible de supprimer le challenge");
      }

      // Recharger les données du projet
      await loadJourneyData();
      
      setFeedback({ type: "success", message: "Challenge supprimé avec succès." });
      setIsChallengeFormVisible(false);
      setEditingChallengeId(null);
      setChallengeFormMode("create");
    } catch (err) {
      console.error("Erreur lors de la suppression du challenge", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Impossible de supprimer le challenge.",
      });
    } finally {
      setIsSavingChallenge(false);
    }
  };

  const handleAskDelete = async () => {
    if (!editingAskId) {
      return;
    }

    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette session ASK ? Cette action est irréversible.")) {
      return;
    }

    try {
      setIsSavingAsk(true);
      setFeedback(null);
      
      const response = await fetch(`/api/admin/asks/${editingAskId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Impossible de supprimer la session ASK");
      }

      // Recharger les données du projet
      await loadJourneyData();
      
      setFeedback({ type: "success", message: "Session ASK supprimée avec succès." });
      setIsAskFormOpen(false);
      setEditingAskId(null);
      setIsEditingAsk(false);
    } catch (err) {
      console.error("Erreur lors de la suppression de la session ASK", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Impossible de supprimer la session ASK.",
      });
    } finally {
      setIsSavingAsk(false);
    }
  };

  return (
    <>
      {boardData ? (
        <AiChallengeBuilderModal
          open={isAiPanelOpen}
          onOpenChange={setIsAiPanelOpen}
          projectId={projectId}
          projectName={boardData.projectName}
          boardData={boardData}
          onChallengeCreated={() => loadJourneyData({ silent: true })}
        />
      ) : null}

      {boardData ? (
        <AiAskGeneratorPanel
          open={isAskAiPanelOpen}
          onOpenChange={setIsAskAiPanelOpen}
          challengeTitle={activeChallenge?.title ?? "Current challenge"}
          isRunning={isAskAiRunning}
          onRunAgain={handleLaunchAskAiGenerator}
          suggestions={askAiSuggestions}
          feedback={askAiFeedback}
          errors={askAiErrors}
          onApplySuggestion={(suggestion, index) => {
            handleApplyAiAskSuggestion(suggestion);
            handleDismissAskSuggestion(index);
          }}
          onDismissSuggestion={handleDismissAskSuggestion}
        />
      ) : null}

      <div ref={scrollContainerRef} className="space-y-8 text-slate-100">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Live data unavailable</AlertTitle>
          <AlertDescription>
            {error}.
            {USE_MOCK_JOURNEY
              ? " Showing mock data so you can continue designing the experience."
              : " Please refresh or verify the project configuration."}
          </AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert variant={feedback.type === "success" ? "default" : "destructive"}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      {boardData ? (
      <header className={cn(
        "rounded-xl border border-white/10 bg-slate-900/70 shadow-sm transition-all duration-300",
        isHeaderCollapsed ? "p-4" : "p-6"
      )}>
        <div className={cn(
          "flex flex-wrap justify-between gap-4",
          isHeaderCollapsed ? "items-center" : "items-start"
        )}>
          <div className="flex-1">
            <div className={cn(
              "flex items-center gap-3",
              isHeaderCollapsed ? "flex-row" : "flex-col items-start"
            )}>
              <div>
                <p className={cn(
                  "text-xs uppercase tracking-wide text-indigo-200",
                  isHeaderCollapsed && "sr-only"
                )}>Exploration projet</p>
                <h1 className={cn(
                  "font-semibold text-white transition-all duration-300",
                  isHeaderCollapsed ? "text-lg" : "text-2xl"
                )}>{boardData.projectName}</h1>
              </div>
              {!isHeaderCollapsed && (
                <div className="flex items-center gap-2">
                  {boardData.clientName ? (
                    <>
                      <p className="text-sm text-slate-300">Client: {boardData.clientName}</p>
                      {canManageClients && boardData.clientId && (
                        <button
                          type="button"
                          onClick={() => {
                            setClientEditMode("edit");
                            setShowClientEditDialog(true);
                          }}
                          className="rounded px-2 py-0.5 text-xs text-indigo-300 transition hover:bg-white/10 hover:text-indigo-200"
                          title="Edit client"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  ) : canManageClients ? (
                    <button
                      type="button"
                      onClick={() => {
                        setClientEditMode("create");
                        setShowClientEditDialog(true);
                      }}
                      className="text-sm text-indigo-300 transition hover:text-indigo-200"
                    >
                      + Add client
                    </button>
                  ) : (
                    <p className="text-sm text-slate-400">No client assigned</p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="glassDark"
              onClick={() => setShowAddParticipantsDialog(true)}
              className="gap-2"
            >
              <Users className="h-4 w-4" />
              Gérer les participants
            </Button>
            <Button
              type="button"
              variant="glassDark"
              onClick={handleEditToggle}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              Éditer
            </Button>
            <Button
              type="button"
              variant="glassDark"
              onClick={() => window.location.href = `/admin/projects/${projectId}/synthesis`}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Synthèse
            </Button>
            {onClose && (
              <Button
                type="button"
                variant="glassDark"
                onClick={onClose}
              >
                Fermer
              </Button>
            )}
          </div>
        </div>

        {!isHeaderCollapsed && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
                <p className="mt-1 text-sm font-medium text-slate-100 capitalize">
                  {boardData.projectStatus ?? "unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Timeline</p>
                <p className="mt-1 text-sm font-medium text-slate-100">
                  {boardData.timeframe ?? "Not specified"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Start date</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{projectStart ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">End date</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{projectEnd ?? "—"}</p>
              </div>
            </div>

            {boardData.projectDescription ? (
              <div className="mt-4 max-h-[30vh] overflow-y-auto rounded-lg border border-white/10 bg-slate-900/40 p-4">
                <ReactMarkdown className="prose prose-sm prose-invert max-w-none space-y-3" components={challengeMarkdownComponents}>
                  {boardData.projectDescription}
                </ReactMarkdown>
              </div>
            ) : null}
          </>
        )}

        {boardData.projectSystemPrompt && !isEditingProject && !isHeaderCollapsed ? (
          <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-200">
            <p className="mb-2 font-semibold text-slate-100">Project system prompt</p>
            <pre className="whitespace-pre-wrap leading-relaxed text-slate-200">{boardData.projectSystemPrompt}</pre>
          </div>
        ) : null}
      </header>
      ) : null}

      {/* Manage Project Participants Dialog */}
      {boardData && (
        <ManageProjectParticipantsDialog
          open={showAddParticipantsDialog}
          onOpenChange={setShowAddParticipantsDialog}
          projectId={projectId}
          projectMembers={boardData.projectMembers}
          onMembersChanged={() => loadJourneyData({ silent: true })}
        />
      )}

      {/* Add Participant to ASK Dialog */}
      {addParticipantDialogAskId && (
        <ManageProjectParticipantsDialog
          open={!!addParticipantDialogAskId}
          onOpenChange={(open) => !open && setAddParticipantDialogAskId(null)}
          projectId={projectId}
          askId={addParticipantDialogAskId}
          onMembersChanged={() => loadJourneyData({ silent: true })}
        />
      )}

      {/* Client Edit Dialog */}
      {boardData && (
        <ClientEditDialog
          open={showClientEditDialog}
          onOpenChange={setShowClientEditDialog}
          clientId={boardData.clientId}
          clientName={boardData.clientName}
          mode={clientEditMode}
          onClientChange={() => loadJourneyData({ silent: true })}
        />
      )}

      {/* Edit Project Dialog */}
      <Dialog.Root open={isEditingProject} onOpenChange={(open) => { if (!open) handleEditToggle(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900/95 shadow-2xl backdrop-blur-xl data-[state=closed]:opacity-0 data-[state=open]:opacity-100">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <Dialog.Title className="text-lg font-semibold text-white">Edit project details</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-slate-300">
                  Adjust the information below, including the system prompt used by the AI.
                </Dialog.Description>
              </div>
              <Dialog.Close className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="project-name" className="text-slate-200">Name</Label>
                    <Input
                      id="project-name"
                      value={editValues.name}
                      onChange={handleInputChange("name")}
                      placeholder="Project name"
                      className="border-white/20 bg-slate-800/80 text-white placeholder:text-slate-500 focus-visible:ring-indigo-400"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="project-status" className="text-slate-200">Status</Label>
                    <Input
                      id="project-status"
                      value={editValues.status}
                      onChange={handleInputChange("status")}
                      placeholder="active"
                      className="border-white/20 bg-slate-800/80 text-white placeholder:text-slate-500 focus-visible:ring-indigo-400"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="project-start" className="text-slate-200">Start date</Label>
                    <DateTimePicker
                      id="project-start"
                      value={editValues.startDate}
                      onChange={handleProjectDateChange("startDate")}
                      placeholder="Select start date"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="project-end" className="text-slate-200">End date</Label>
                    <DateTimePicker
                      id="project-end"
                      value={editValues.endDate}
                      onChange={handleProjectDateChange("endDate")}
                      placeholder="Select end date"
                    />
                  </div>
                  <div className="md:col-span-2 flex flex-col gap-2">
                    <Label htmlFor="project-description" className="text-slate-200">Description</Label>
                    <AutoResizeTextarea
                      id="project-description"
                      value={editValues.description}
                      onChange={handleInputChange("description")}
                      placeholder="What is the goal of this project?"
                      className="min-h-[80px] border-white/20 bg-slate-800/80 text-white placeholder:text-slate-500 focus-visible:ring-indigo-400"
                    />
                  </div>
                  <div className="md:col-span-2 flex flex-col gap-2">
                    <Label htmlFor="project-prompt" className="text-slate-200">System prompt</Label>
                    <AutoResizeTextarea
                      id="project-prompt"
                      value={editValues.systemPrompt}
                      onChange={handleInputChange("systemPrompt")}
                      placeholder="Provide the system prompt used by the AI for this project"
                      className="min-h-[80px] border-white/20 bg-slate-800/80 text-white placeholder:text-slate-500 focus-visible:ring-indigo-400"
                    />
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {'Tip: keep the system prompt concise and use placeholders such as {{project_name}} or {{client_name}} to reuse across projects.'}
                </div>

                {/* Danger Zone - Only visible to full_admin */}
                {isFullAdmin && (
                  <div className="mt-8 rounded-lg border border-red-500/30 bg-red-950/20 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="h-5 w-5 text-red-400" />
                      <h3 className="text-sm font-semibold text-red-300">Zone de danger</h3>
                    </div>
                    <p className="text-xs text-red-200/70 mb-4">
                      Les actions ci-dessous sont irréversibles et peuvent entraîner une perte de données permanente.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsPurgeDialogOpen(true)}
                      className="gap-2 border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-red-100"
                    >
                      <Trash2 className="h-4 w-4" />
                      Supprimer toutes les conversations
                    </Button>
                    {purgeFeedback && (
                      <div className={cn(
                        "mt-3 rounded-md px-3 py-2 text-sm",
                        purgeFeedback.type === "success"
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-red-500/20 text-red-200"
                      )}>
                        {purgeFeedback.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
              <Button
                type="button"
                variant="glassDark"
                onClick={handleEditToggle}
                disabled={isSavingProject}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Annuler
              </Button>
              <Button
                type="button"
                variant="glassDark"
                onClick={handleProjectSave}
                disabled={isSavingProject}
                className="gap-2 border-indigo-400/30 bg-indigo-500/20 hover:bg-indigo-500/30"
              >
                {isSavingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Purge Confirmation Dialog */}
      <Dialog.Root open={isPurgeDialogOpen} onOpenChange={(open) => {
        setIsPurgeDialogOpen(open);
        if (!open) {
          setPurgeConfirmationWord("");
          setPurgeFeedback(null);
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] flex max-h-[85vh] w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-red-500/30 bg-slate-900/95 shadow-2xl backdrop-blur-xl data-[state=closed]:opacity-0 data-[state=open]:opacity-100">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-red-500/20 bg-red-950/30 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <Dialog.Title className="text-lg font-semibold text-red-200">Suppression des données</Dialog.Title>
                  <Dialog.Description className="text-sm text-red-300/70">
                    Cette action est irréversible
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close className="rounded-full p-1.5 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-200">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-4">
                <div className="rounded-lg border border-red-500/20 bg-red-950/20 p-4">
                  <p className="text-sm text-red-200 leading-relaxed">
                    Vous êtes sur le point de <strong>supprimer définitivement</strong> toutes les données de conversation de ce projet :
                  </p>
                  <ul className="mt-3 space-y-1.5 text-sm text-red-200/80">
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      Tous les messages de conversation
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      Tous les insights collectés
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      Toutes les synthèses et données du graphe de connaissances
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      Les résultats de l&apos;AI Challenge Builder
                    </li>
                  </ul>
                  <p className="mt-3 text-xs text-emerald-300/80">
                    Les sessions ASK et leurs participants seront conservés.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purge-confirmation" className="text-sm text-slate-200">
                    Pour confirmer, tapez <code className="mx-1 rounded bg-red-500/20 px-2 py-0.5 font-mono text-red-300">SUPPRIMER-TOUT</code> ci-dessous :
                  </Label>
                  <Input
                    id="purge-confirmation"
                    type="text"
                    value={purgeConfirmationWord}
                    onChange={(e) => setPurgeConfirmationWord(e.target.value)}
                    placeholder="Entrez le mot de confirmation"
                    className="border-red-500/30 bg-slate-800/80 text-white placeholder:text-slate-500 focus-visible:ring-red-400"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                {purgeFeedback && purgeFeedback.type === "error" && (
                  <div className="rounded-md bg-red-500/20 px-3 py-2 text-sm text-red-200">
                    {purgeFeedback.message}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-red-500/20 bg-red-950/20 px-6 py-4">
              <Button
                type="button"
                variant="glassDark"
                onClick={() => {
                  setIsPurgeDialogOpen(false);
                  setPurgeConfirmationWord("");
                  setPurgeFeedback(null);
                }}
                disabled={isPurging}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Annuler
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleProjectPurge}
                disabled={isPurging || purgeConfirmationWord !== "SUPPRIMER-TOUT"}
                className="gap-2 border-red-500/40 bg-red-500/20 text-red-200 hover:bg-red-500/30 hover:text-red-100 disabled:opacity-50"
              >
                {isPurging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Supprimer définitivement
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="space-y-6">
        <div>
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Project challenges</h2>
                <p className="text-sm text-slate-300">
                  Select a challenge to explore the insights that shaped it and the ASKs linked to its resolution.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasAiBuilderResults && !isAiBuilderRunning ? (
                  <div className="inline-flex rounded-md shadow-sm">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2 rounded-r-none border-r-0 border-indigo-300/40 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20"
                      onClick={() => setIsAiPanelOpen(true)}
                      title="Voir et appliquer les suggestions générées par l'IA"
                    >
                      <Sparkles className="h-4 w-4" />
                      Edit & create challenges
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-l-none border-indigo-300/40 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20"
                      onClick={() => handleLaunchAiChallengeBuilder()}
                      disabled={isAiBuilderRunning}
                      title="Relancer l'analyse IA"
                    >
                      {isAiBuilderRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="sr-only">Refresh</span>
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 border-indigo-300/40 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20"
                    onClick={() => handleLaunchAiChallengeBuilder()}
                    disabled={isAiBuilderRunning}
                    title="Analyser les insights et générer des suggestions de challenges via l'IA"
                  >
                    {isAiBuilderRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isAiBuilderRunning ? "Generating..." : "Generate challenges with AI"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2 bg-gradient-to-r from-indigo-600/75 via-indigo-500/70 to-violet-500/75 text-white shadow-lg hover:shadow-xl hover:from-indigo-500/85 hover:via-indigo-400/80 hover:to-violet-400/85 hover:bg-transparent h-10 px-4 py-2"
                  onClick={() => handleChallengeStart()}
                  disabled={isSavingChallenge}
                  title="Créer un nouveau challenge manuellement"
                >
                  <Plus className="h-4 w-4" />
                  New challenge
                </Button>
              </div>
            </div>
            {aiBuilderLastRunAt && !isAiBuilderRunning ? (
              <div className="text-xs text-slate-400">
                Dernière analyse IA : {new Intl.DateTimeFormat("fr-FR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(aiBuilderLastRunAt))}
              </div>
            ) : null}
            {aiBuilderFeedback ? (
              <Alert
                variant={aiBuilderFeedback.type === "success" ? "default" : "destructive"}
                className={cn(
                  aiBuilderFeedback.type === "success" &&
                    "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 backdrop-blur-sm"
                )}
              >
                <AlertDescription
                  className={cn(aiBuilderFeedback.type === "success" && "text-emerald-50/80")}
                >
                  {aiBuilderFeedback.message}
                </AlertDescription>
              </Alert>
            ) : null}

            {challengeFeedback ? (
              <Alert
                variant={challengeFeedback.type === "success" ? "default" : "destructive"}
                className={cn(
                  challengeFeedback.type === "success" &&
                    "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 backdrop-blur-sm"
                )}
              >
                <AlertDescription
                  className={cn(challengeFeedback.type === "success" && "text-emerald-50/80")}
                >
                  {challengeFeedback.message}
                </AlertDescription>
              </Alert>
            ) : null}

            {boardData.challenges?.length ? (
              renderChallengeList(boardData.challenges)
            ) : (
              <Card className="border-dashed border-white/10 bg-slate-900/60">
                <CardContent className="py-10 text-center text-sm text-slate-300">
                  No challenges have been defined for this project yet.
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </div>

      {/* Insights & ASKs Modal */}
      <Dialog.Root open={isInsightsModalOpen} onOpenChange={(open) => { setIsInsightsModalOpen(open); if (!open) setModalActiveTab("insights"); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" onClick={() => { setIsInsightsModalOpen(false); setModalActiveTab("insights"); }} />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900/80 shadow-2xl backdrop-blur-xl data-[state=closed]:opacity-0 data-[state=open]:opacity-100">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-lg font-semibold text-white truncate">
                  {activeChallenge?.title ?? "Challenge Details"}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-slate-400">
                  Insights et sessions ASK pour ce challenge
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="ml-3 rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* Tab Navigation */}
            {activeChallenge && (
              <div className="border-b border-white/10 px-5">
                <nav className="flex gap-1 -mb-px">
                  <button
                    type="button"
                    onClick={() => setModalActiveTab("insights")}
                    className={cn(
                      "group flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2",
                      modalActiveTab === "insights"
                        ? "border-yellow-400 text-yellow-300"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
                    )}
                  >
                    <Lightbulb className={cn(
                      "h-4 w-4 transition-colors",
                      modalActiveTab === "insights" ? "text-yellow-400" : "text-slate-500 group-hover:text-slate-400"
                    )} />
                    Insights
                    {activeChallengeInsights?.length ? (
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        modalActiveTab === "insights"
                          ? "bg-yellow-400/20 text-yellow-300"
                          : "bg-slate-700 text-slate-400"
                      )}>
                        {activeChallengeInsights.length}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalActiveTab("asks")}
                    className={cn(
                      "group flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2",
                      modalActiveTab === "asks"
                        ? "border-emerald-400 text-emerald-300"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
                    )}
                  >
                    <MessageSquare className={cn(
                      "h-4 w-4 transition-colors",
                      modalActiveTab === "asks" ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-400"
                    )} />
                    ASKs
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      modalActiveTab === "asks"
                        ? "bg-emerald-400/20 text-emerald-300"
                        : "bg-slate-700 text-slate-400"
                    )}>
                      {activeChallengeAsks?.length ?? 0}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalActiveTab("ai")}
                    className={cn(
                      "group flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2",
                      modalActiveTab === "ai"
                        ? "border-indigo-400 text-indigo-300"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
                    )}
                  >
                    <Sparkles className={cn(
                      "h-4 w-4 transition-colors",
                      modalActiveTab === "ai" ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-400"
                    )} />
                    Sub-challenges IA
                    {(() => {
                      // Count suggestions for active challenge and all its descendants
                      const getDescendantIds = (node: ProjectChallengeNode): string[] => {
                        const ids: string[] = [node.id];
                        if (node.children) {
                          for (const child of node.children) {
                            ids.push(...getDescendantIds(child));
                          }
                        }
                        return ids;
                      };
                      const relevantIds = new Set<string>();
                      if (activeChallengeId) {
                        relevantIds.add(activeChallengeId);
                        const activeNode = allChallenges.find(c => c.id === activeChallengeId);
                        if (activeNode?.children) {
                          for (const child of activeNode.children) {
                            getDescendantIds(child).forEach(id => relevantIds.add(id));
                          }
                        }
                      }
                      const count = aiSuggestions.filter(s => relevantIds.has(s.challengeId)).length;
                      return count > 0 ? (
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          modalActiveTab === "ai"
                            ? "bg-indigo-400/20 text-indigo-300"
                            : "bg-slate-700 text-slate-400"
                        )}>
                          {count}
                        </span>
                      ) : null;
                    })()}
                  </button>
                </nav>
              </div>
            )}

            {/* Tab Content with slide animation */}
            <div ref={rightColumnRef} className="flex-1 overflow-x-hidden overflow-y-auto relative">
              <div
                className="flex transition-transform duration-300 ease-out h-full"
                style={{
                  transform: modalActiveTab === "insights"
                    ? "translateX(0)"
                    : modalActiveTab === "asks"
                      ? "translateX(-100%)"
                      : "translateX(-200%)"
                }}
              >
                {/* Insights Tab */}
                <div className="w-full flex-shrink-0 overflow-y-auto p-5 custom-scrollbar">
                  {!activeChallenge ? (
                    <Card className="border-dashed border-white/10 bg-slate-900/60">
                      <CardContent className="py-10 text-center text-sm text-slate-300">
                        Choose a challenge from the list to see its details.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      <Card className="border border-yellow-400/40 bg-yellow-500/10">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                            <Lightbulb className="h-4 w-4 text-yellow-400" />
                            Foundational Insights
                            {activeChallengeInsights?.length ? (
                              <span className="text-sm font-normal text-yellow-300">
                                ({activeChallengeInsights.length})
                              </span>
                            ) : null}
                          </CardTitle>
                          <p className="text-xs text-slate-400">
                            Insights qui ont contribué à définir le challenge "{activeChallenge.title}".
                          </p>
                        </CardHeader>
                        <CardContent>
                          {activeChallengeInsights?.length ? (
                            <div className="space-y-2">
                              {activeChallengeInsights.map(insight => (
                                <div
                                  key={`${insight.id}-${insight.askId}`}
                                  className="rounded-lg border border-yellow-400/30 bg-yellow-500/5 p-3"
                                >
                                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-300">
                                    <span className={cn("rounded-full border px-2 py-0.5", insightTypeClasses[insight.type])}>
                                      {insight.type.toUpperCase()}
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-slate-400">
                                      <Users className="h-3 w-3" />
                                      {insight.contributors.map(c => c.name).join(", ")}
                                    </span>
                                  </div>
                                  <p className="mt-1.5 text-sm font-medium text-white">{insight.title}</p>
                                  <p className="mt-1 text-xs text-slate-400 line-clamp-2">{insight.description}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed border-white/10 bg-slate-900/40 px-3 py-4 text-center text-sm text-slate-400">
                              Aucun insight lié à ce challenge.
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>

                {/* ASKs Tab */}
                <div className="w-full flex-shrink-0 overflow-y-auto p-5 custom-scrollbar">
                  {!activeChallenge ? (
                    <Card className="border-dashed border-white/10 bg-slate-900/60">
                      <CardContent className="py-10 text-center text-sm text-slate-300">
                        Choose a challenge from the list to see its details.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {/* ASKs Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-emerald-400" />
                            ASKs liées à "{activeChallenge.title}"
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Sessions ASK planifiées pour ce challenge.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1.5 bg-emerald-500 text-white hover:bg-emerald-400 h-8 text-xs"
                            onClick={() => {
                              if (isAskFormOpen) {
                                handleAskCancel();
                              } else {
                                handleAskCreateStart();
                              }
                            }}
                            disabled={isSavingAsk || isLoadingAskDetails}
                          >
                            {isAskFormOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            {isAskFormOpen ? "Fermer" : "Créer ASK"}
                          </Button>
                          <Button
                            size="sm"
                            variant={askAiSuggestions.length > 0 ? "default" : "glassDark"}
                            className={cn(
                              "gap-1.5 h-8 text-xs",
                              askAiSuggestions.length > 0 && "bg-purple-600 hover:bg-purple-700"
                            )}
                            onClick={handleOpenAskSuggestionsPanel}
                            disabled={isAskAiRunning || !activeChallenge}
                          >
                            {isAskAiRunning ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            {isAskAiRunning
                              ? "Génération..."
                              : askAiSuggestions.length > 0
                                ? `Voir ${askAiSuggestions.length} suggestion${askAiSuggestions.length > 1 ? "s" : ""}`
                                : "Générer avec IA"}
                          </Button>
                        </div>
                      </div>

                      {/* ASK Cards List */}
                      <div className="space-y-3">
                  {activeChallengeAsks?.length ? (
                    activeChallengeAsks.map(ask => {
                      const isExpanded = expandedAsks.has(ask.id);
                      const isParticipantsExpanded = expandedAskParticipants.has(ask.id);
                      const participantEdits = askParticipantEdits[ask.id];
                      const isSavingThisAsk = savingAskParticipants.has(ask.id);
                      const askRecord = askDetails[ask.id];
                      const { href: answerHref, canAnswer } = getAnswerLinkForAsk(ask);

                      return (
                        <Card key={ask.id} id={`ask-${ask.id}`} className="border border-blue-400/30 bg-blue-500/5 shadow-sm">
                          <CardHeader
                            className="space-y-2 pb-2 cursor-pointer"
                            onClick={() => {
                              setExpandedAsks(prev => {
                                const next = new Set(prev);
                                if (next.has(ask.id)) {
                                  next.delete(ask.id);
                                } else {
                                  next.add(ask.id);
                                }
                                return next;
                              });
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2 flex-1">
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 text-blue-400 transition-transform shrink-0 mt-0.5",
                                    isExpanded && "rotate-90"
                                  )}
                                />
                                <div className="flex-1 min-w-0">
                                  <CardTitle className="text-sm font-semibold text-blue-100">{ask.title}</CardTitle>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-200">
                                      <Calendar className="h-3 w-3" /> {formatDate(ask.dueDate)}
                                    </span>
                                    <span className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                      ask.status === "active" ? "bg-blue-500/20 text-blue-300" :
                                      ask.status === "closed" ? "bg-slate-500/20 text-slate-300" :
                                      "bg-amber-500/20 text-amber-300"
                                    )}>
                                      {ask.status}
                                    </span>
                                    {(() => {
                                      // Calculate response progress for individual mode
                                      const totalParticipants = ask.participants?.length ?? 0;
                                      const respondedCount = ask.participants?.filter(p => p.insights.length > 0).length ?? 0;
                                      const allResponded = totalParticipants > 0 && respondedCount === totalParticipants;
                                      const someResponded = respondedCount > 0 && !allResponded;
                                      const isIndividualMode = ask.conversationMode === "individual_parallel";

                                      return (
                                        <span
                                          className={cn(
                                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
                                            ask.conversationMode === "collaborative" ? "bg-purple-500/20 text-purple-200" :
                                            ask.conversationMode === "group_reporter" ? "bg-amber-500/20 text-amber-200" :
                                            ask.conversationMode === "consultant" ? "bg-teal-500/20 text-teal-200" :
                                            // Individual mode: green if all responded, blue otherwise
                                            allResponded ? "bg-emerald-500/20 text-emerald-200" :
                                            someResponded ? "bg-blue-500/20 text-blue-200" :
                                            "bg-blue-500/10 text-blue-200"
                                          )}
                                          title={
                                            ask.conversationMode === "collaborative" ? "Mode collaboratif" :
                                            ask.conversationMode === "group_reporter" ? "Mode rapporteur" :
                                            ask.conversationMode === "consultant" ? "Mode consultant" :
                                            allResponded ? `Mode individuel - Tous ont répondu (${respondedCount}/${totalParticipants})` :
                                            `Mode individuel - ${respondedCount}/${totalParticipants} ont répondu`
                                          }
                                        >
                                          {ask.conversationMode === "collaborative" ? (
                                            <UsersRound className="h-2.5 w-2.5" />
                                          ) : ask.conversationMode === "group_reporter" ? (
                                            <Megaphone className="h-2.5 w-2.5" />
                                          ) : ask.conversationMode === "consultant" ? (
                                            <MessageSquareText className="h-2.5 w-2.5" />
                                          ) : allResponded ? (
                                            <CheckCircle2 className="h-2.5 w-2.5" />
                                          ) : (
                                            <Users className="h-2.5 w-2.5" />
                                          )}
                                          {isIndividualMode ? (
                                            <span>{respondedCount}/{totalParticipants}</span>
                                          ) : (
                                            <span>{totalParticipants}</span>
                                          )}
                                          <span className="ml-0.5">
                                            {ask.conversationMode === "collaborative" ? "collab" :
                                             ask.conversationMode === "group_reporter" ? "report" :
                                             ask.conversationMode === "consultant" ? "consult" :
                                             "indiv"}
                                          </span>
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                {canAnswer && answerHref && (
                                  <Button
                                    asChild
                                    size="sm"
                                    className="gap-1 bg-blue-500 text-white hover:bg-blue-400 h-8"
                                  >
                                    <Link href={answerHref} target="_blank" rel="noopener noreferrer">
                                      <MessageSquare className="h-3.5 w-3.5" />
                                      Answer
                                    </Link>
                                  </Button>
                                )}
                                {ask.allowAutoRegistration && ask.askKey && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="gap-1 h-8 bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 hover:bg-indigo-500/30 hover:text-indigo-200"
                                    onClick={() => {
                                      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/?ask=${ask.askKey}`;
                                      navigator.clipboard.writeText(url);
                                    }}
                                    title="Copier le lien public d'inscription"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    Lien
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="sm"
                                  className="gap-1 h-8 bg-blue-500/20 text-blue-300 border border-blue-400/30 hover:bg-blue-500/30 hover:text-blue-200"
                                  onClick={() => void handleAskEditStart(ask.id)}
                                  disabled={isSavingAsk || isLoadingAskDetails}
                                >
                                  {isLoadingAskDetails && editingAskId === ask.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Pencil className="h-3.5 w-3.5" />
                                  )}
                                  Edit
                                </Button>
                              </div>
                            </div>
                            {isExpanded && (
                              <p className="text-sm text-slate-300 pl-6">{ask.summary}</p>
                            )}
                        </CardHeader>
                        {isExpanded && (
                          <CardContent className="space-y-4 pt-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-slate-200">
                                <Target className="h-3.5 w-3.5 text-indigo-300" /> {ask.theme || "General theme"}
                              </span>
                              {ask.relatedProjects?.length ? (
                                ask.relatedProjects.map(project => (
                                  <span
                                    key={project.id}
                                    className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-slate-100"
                                  >
                                    {project.name}
                                  </span>
                                ))
                              ) : null}
                            </div>

                            {/* Expandable Participants Section */}
                            <ParticipantSectionPanel
                              askId={ask.id}
                              askKey={ask.askKey}
                              conversationMode={askRecord?.conversationMode ?? "collaborative"}
                              participants={askRecord?.participants ?? []}
                              availableUsers={availableUsers}
                              selectedIds={participantEdits?.participantIds ?? []}
                              initialParticipantCount={ask.participants?.length}
                              spokespersonId={participantEdits?.spokespersonId ?? ""}
                              onParticipantToggle={(userId) => handleAskParticipantToggleInCard(ask.id, userId)}
                              onSpokespersonChange={(id) => handleAskSpokespersonChangeInCard(ask.id, id)}
                              onSave={() => void handleSaveAskParticipantsInCard(ask.id)}
                              onSendAllInvites={() => void handleSendAskInvitesInCard(ask.id)}
                              onAddParticipant={() => setAddParticipantDialogAskId(ask.id)}
                              onClose={() => void handleToggleAskParticipants(ask.id)}
                              isExpanded={isParticipantsExpanded}
                              onToggleExpand={() => void handleToggleAskParticipants(ask.id)}
                              isLoading={isLoadingAskDetails && !participantEdits}
                              isSaving={isSavingThisAsk}
                              isSendingInvites={isSendingAskInvites}
                              progressData={askRecord?.progressData as ParticipantProgressData | null | undefined}
                              respondedParticipantIds={new Set(
                                ask.participants
                                  ?.filter(p => p.insights && p.insights.length > 0)
                                  .flatMap(p => [p.id, p.userId].filter((id): id is string => Boolean(id)))
                              )}
                            />

                            {/* Collected Insights */}
                            <div>
                              <button
                                type="button"
                                className="w-full flex items-center justify-between text-left mb-2"
                                onClick={() => setExpandedCollectedInsightsAskIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(ask.id)) {
                                    next.delete(ask.id);
                                  } else {
                                    next.add(ask.id);
                                  }
                                  return next;
                                })}
                              >
                                <h3 className="text-sm font-semibold text-slate-200">
                                  Collected insights
                                  {(() => {
                                    const count = getAskInsightsCount(ask);
                                    return count > 0 ? (
                                      <span className="ml-2 text-xs font-normal text-slate-400">({count})</span>
                                    ) : null;
                                  })()}
                                </h3>
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 text-slate-400 transition-transform duration-200",
                                    expandedCollectedInsightsAskIds.has(ask.id) && "rotate-90"
                                  )}
                                />
                              </button>
                              {expandedCollectedInsightsAskIds.has(ask.id) && renderAskInsights(ask)}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                    })
                  ) : (
                    <Card className="border-dashed border-blue-400/20 bg-slate-900/40">
                      <CardContent className="py-8 text-center text-sm text-slate-400">
                        Aucune session ASK liée à ce challenge.
                      </CardContent>
                    </Card>
                  )}
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Suggestions Tab */}
                <div className="w-full flex-shrink-0 overflow-y-auto p-5 custom-scrollbar">
                  {!activeChallenge ? (
                    <Card className="border-dashed border-white/10 bg-slate-900/60">
                      <CardContent className="py-10 text-center text-sm text-slate-300">
                        Choose a challenge from the list to see AI suggestions.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {/* AI Suggestions Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-4 py-3">
                        <div>
                          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-indigo-400" />
                            Suggestions IA pour "{activeChallenge.title}"
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Modifications et sous-challenges suggérés par l'analyse IA.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1.5 bg-indigo-500 text-white hover:bg-indigo-400 h-8 text-xs"
                          onClick={() => handleLaunchAiChallengeBuilder(activeChallengeId ?? undefined)}
                          disabled={isAiBuilderRunning}
                        >
                          {isAiBuilderRunning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          {isAiBuilderRunning ? "Analyse en cours..." : "Relancer l'analyse"}
                        </Button>
                      </div>

                      {/* AI Suggestions Content - Using shared component filtered by current challenge */}
                      {(() => {
                        // Get all descendant IDs of the active challenge
                        const getDescendantIds = (node: ProjectChallengeNode): string[] => {
                          const ids: string[] = [node.id];
                          if (node.children) {
                            for (const child of node.children) {
                              ids.push(...getDescendantIds(child));
                            }
                          }
                          return ids;
                        };

                        const relevantIds = new Set<string>();
                        if (activeChallengeId) {
                          relevantIds.add(activeChallengeId);
                          const activeNode = allChallenges.find(c => c.id === activeChallengeId);
                          if (activeNode?.children) {
                            for (const child of activeNode.children) {
                              getDescendantIds(child).forEach(id => relevantIds.add(id));
                            }
                          }
                        }

                        // Filter suggestions for this challenge and its descendants
                        const filteredSuggestions = aiSuggestions.filter(s => relevantIds.has(s.challengeId));

                        // Filter new challenges that would be children of this challenge or its descendants
                        const filteredNewChallenges = aiNewChallenges.filter(c => c.parentId && relevantIds.has(c.parentId));

                        if (filteredSuggestions.length === 0 && filteredNewChallenges.length === 0 && !hasAiBuilderResults) {
                          return (
                            <Card className="border-dashed border-indigo-400/20 bg-slate-900/40">
                              <CardContent className="py-8 text-center">
                                <Sparkles className="h-8 w-8 text-indigo-400/50 mx-auto mb-3" />
                                <p className="text-sm text-slate-400">
                                  Aucune analyse IA n'a encore été effectuée.
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                  Cliquez sur "Relancer l'analyse" pour générer des suggestions.
                                </p>
                              </CardContent>
                            </Card>
                          );
                        }

                        if (filteredSuggestions.length === 0 && filteredNewChallenges.length === 0) {
                          return (
                            <Card className="border-dashed border-emerald-400/20 bg-emerald-500/5">
                              <CardContent className="py-8 text-center">
                                <Check className="h-8 w-8 text-emerald-400/50 mx-auto mb-3" />
                                <p className="text-sm text-slate-300">
                                  Aucune suggestion en attente pour ce challenge.
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                  Toutes les suggestions ont été appliquées ou ignorées.
                                </p>
                              </CardContent>
                            </Card>
                          );
                        }

                        // Use the shared AiChallengeBuilderContent component
                        return (
                          <AiChallengeBuilderContent
                            isRunning={isAiBuilderRunning}
                            suggestions={filteredSuggestions}
                            newChallenges={filteredNewChallenges}
                            challengeLookup={challengeById}
                            onApplyChallengeUpdates={handleApplyChallengeUpdate}
                            onDismissChallengeUpdates={handleDismissChallengeUpdate}
                            onDismissSuggestion={handleDismissChallengeUpdate}
                            applyingChallengeUpdateIds={applyingChallengeUpdateIds}
                            onApplySubChallengeUpdate={handleApplySubChallengeUpdate}
                            onDismissSubChallengeUpdate={handleDismissSubChallengeUpdate}
                            applyingSubChallengeUpdateIds={applyingSubChallengeUpdateIds}
                            onApplySuggestedNewSubChallenge={handleApplySuggestedNewSubChallenge}
                            onDismissSuggestedNewSubChallenge={handleDismissSuggestedNewSubChallenge}
                            applyingNewSubChallengeKeys={applyingNewSubChallengeKeys}
                            onApplyNewChallenge={handleApplyNewChallengeSuggestion}
                            onDismissNewChallenge={handleDismissNewChallengeSuggestion}
                            applyingNewChallengeIndices={applyingNewChallengeIndices}
                            showLoader={false}
                          />
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={isChallengeFormVisible}
        onOpenChange={open => {
          if (open) {
            setIsChallengeFormVisible(true);
          } else {
            handleChallengeCancel();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
          <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={handleChallengeCancel}>
            <Card className="relative w-full max-w-3xl border border-indigo-400/50 bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-indigo-950/80 shadow-xl shadow-indigo-500/10 my-4 backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
              <Dialog.Close asChild>
                <button
                  type="button"
                  onClick={handleChallengeCancel}
                  className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/10 p-1 text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                  aria-label="Close challenge form"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
              <CardHeader className="pr-10">
                <Dialog.Title asChild>
                  <CardTitle>{isEditingChallenge ? "Edit challenge" : "Create a new challenge"}</CardTitle>
                </Dialog.Title>
                <Dialog.Description className="text-sm text-slate-300">
                  {isEditingChallenge
                    ? "Update the challenge status, impact or context without leaving the admin board."
                    : "Provide a clear title, status and description so collaborators can respond effectively."}
                </Dialog.Description>
              </CardHeader>
              <CardContent className="space-y-4">
                {challengeFeedback?.type === "error" ? (
                  <Alert variant="destructive">
                    <AlertTitle>Something went wrong</AlertTitle>
                    <AlertDescription>{challengeFeedback.message}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="challenge-title" className="text-indigo-300">Title</Label>
                    <Input
                      id="challenge-title"
                      value={challengeFormValues.title}
                      onChange={handleChallengeFieldChange("title")}
                      placeholder="What problem are you addressing?"
                      className="border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-indigo-400/20"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="challenge-status" className="text-indigo-300">Status</Label>
                    <select
                      id="challenge-status"
                      value={challengeFormValues.status}
                      onChange={handleChallengeFieldChange("status")}
                      className="rounded-md border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                    >
                      {challengeStatusOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="challenge-impact" className="text-indigo-300">Impact</Label>
                    <select
                      id="challenge-impact"
                      value={challengeFormValues.impact}
                      onChange={handleChallengeFieldChange("impact")}
                      className="rounded-md border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                    >
                      {(Object.entries(impactLabels) as [ProjectChallengeNode["impact"], string][]).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(parentChallengeOptions.length > 0 || challengeFormValues.parentId) ? (
                    <div className="md:col-span-2 flex flex-col gap-2">
                      <Label htmlFor="challenge-parent" className="text-indigo-300">Parent challenge</Label>
                      <select
                        id="challenge-parent"
                        value={challengeFormValues.parentId}
                        onChange={handleChallengeParentChange}
                        className="rounded-md border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                      >
                        <option value="">No parent (top-level)</option>
                        {parentChallengeOptions
                          .filter(option => !invalidParentIds.has(option.id))
                          .map(option => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                      </select>
                      <p className="text-xs text-slate-400">
                        {challengeFormValues.parentId
                          ? selectedParentChallenge
                            ? `This challenge will be nested under "${selectedParentChallenge.title}".`
                            : "This challenge will be nested under the selected parent."
                          : "Leave empty to create a top-level challenge."}
                      </p>
                    </div>
                  ) : null}
                  <div className="md:col-span-2 flex flex-col gap-2">
                    <Label htmlFor="challenge-description" className="text-indigo-300">Description</Label>
                    <Textarea
                      id="challenge-description"
                      rows={3}
                      value={challengeFormValues.description}
                      onChange={handleChallengeFieldChange("description")}
                      placeholder="Provide useful context so the team understands the challenge."
                      className="border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-indigo-400/20"
                    />
                  </div>
                </div>
                {availableUsers.length ? (
                  <div className="flex flex-col gap-2">
                    <Label className="text-indigo-300">Owners</Label>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {availableUsers.map(user => {
                        const isSelected = challengeFormValues.ownerIds.includes(user.id);
                        return (
                          <label
                            key={user.id}
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-slate-950/60 px-3 py-2 text-sm transition",
                              isSelected
                                ? "border-indigo-400/70 bg-indigo-500/10 text-indigo-100"
                                : "border-white/10 text-slate-200 hover:border-indigo-300/50",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleChallengeOwnerToggle(user.id)}
                              className="h-4 w-4 rounded border-white/30 bg-slate-900 text-indigo-500 focus:ring-indigo-400"
                            />
                            <span className="flex flex-col leading-tight">
                              <span className="font-medium text-white">{user.name}</span>
                              {user.role ? <span className="text-xs text-slate-400">{user.role}</span> : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="gap-2 bg-gradient-to-r from-indigo-600/75 via-indigo-500/70 to-violet-500/75 text-white shadow-lg hover:shadow-xl hover:from-indigo-500/85 hover:via-indigo-400/80 hover:to-violet-400/85 hover:bg-transparent"
                    onClick={handleChallengeSave}
                    disabled={isSavingChallenge || !challengeFormValues.title.trim()}
                  >
                    {isSavingChallenge ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isSavingChallenge ? "Saving" : isEditingChallenge ? "Update challenge" : "Save challenge"}
                  </Button>
                  {isEditingChallenge && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleChallengeDelete}
                      disabled={isSavingChallenge}
                      className="gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="glassDark"
                    onClick={handleChallengeCancel}
                    disabled={isSavingChallenge}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={isAskFormOpen}
        onOpenChange={open => {
          if (open) {
            setIsAskFormOpen(true);
          } else {
            handleAskCancel();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" onClick={handleAskCancel} />
          <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-slate-900/80 shadow-2xl backdrop-blur-xl data-[state=closed]:opacity-0 data-[state=open]:opacity-100", isEditingAsk ? "border-blue-400/30" : "border-emerald-400/30")}>
            {/* Header */}
            <div className={cn("flex items-center justify-between border-b px-5 py-3", isEditingAsk ? "border-blue-400/20" : "border-emerald-400/20")}>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-lg font-semibold text-white truncate">
                  {isEditingAsk ? "Edit ASK session" : "Create ASK session"}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-slate-400">
                  {isEditingAsk
                    ? "Adjust the ASK details, participants and schedule without leaving the journey board."
                    : "Define the ASK session so collaborators know how to facilitate it and capture insights."}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  onClick={handleAskCancel}
                  className="ml-3 rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close ASK form"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5">
                <form onSubmit={handleAskFormSubmit} className="space-y-4">
                  {askFeedback ? (
                    <Alert
                      className={cn(
                        "border px-3 py-3",
                        askFeedback.type === "error"
                          ? "border-destructive/40 bg-destructive/10 text-destructive-foreground"
                          : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
                      )}
                    >
                      <AlertTitle className="text-sm font-semibold">
                        {askFeedback.type === "error" ? "Something went wrong" : "Success"}
                      </AlertTitle>
                      <AlertDescription className="text-sm">{askFeedback.message}</AlertDescription>
                    </Alert>
                  ) : null}

                  {isLoadingAskDetails ? (
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
                      Loading ASK details…
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-challenge">Challenge</Label>
                      <select
                        id="ask-challenge"
                        value={askFormValues.challengeId}
                        onChange={handleAskChallengeChange}
                        className="h-10 rounded-md border border-white/10 bg-slate-900/70 px-3 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                        disabled={isSavingAsk || isLoadingAskDetails}
                      >
                        <option value="">Select a challenge</option>
                        {allChallenges.map(challenge => (
                          <option key={challenge.id} value={challenge.id}>
                            {challenge.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-key">ASK key</Label>
                      <div className="flex gap-2">
                        <Input
                          id="ask-key"
                          value={askFormValues.askKey}
                          onChange={handleAskKeyChange}
                          placeholder="session-team-001"
                          disabled={isSavingAsk || isLoadingAskDetails || isEditingAsk}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                          onClick={handleAskKeyRegenerate}
                          disabled={isSavingAsk || isLoadingAskDetails || isEditingAsk}
                        >
                          Refresh
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-name">Name</Label>
                      <Input
                        id="ask-name"
                        value={askFormValues.name}
                        onChange={handleAskNameChange}
                        placeholder="Session name"
                        disabled={isSavingAsk || isLoadingAskDetails}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-status">Status</Label>
                      <select
                        id="ask-status"
                        value={askFormValues.status}
                        onChange={handleAskStatusChange}
                        className="h-10 rounded-md border border-white/10 bg-slate-900/70 px-3 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                        disabled={isSavingAsk || isLoadingAskDetails}
                      >
                        {askStatusOptions.map(status => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="ask-question">Question</Label>
                    <Textarea
                      id="ask-question"
                      rows={3}
                      value={askFormValues.question}
                      onChange={handleAskQuestionChange}
                      placeholder="What do you want participants to reflect on?"
                      disabled={isSavingAsk || isLoadingAskDetails}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="ask-description">Description</Label>
                    <Textarea
                      id="ask-description"
                      rows={2}
                      value={askFormValues.description}
                      onChange={handleAskDescriptionChange}
                      placeholder="Share additional context"
                      disabled={isSavingAsk || isLoadingAskDetails}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <AskPromptTemplateSelector
                      value={askFormValues.systemPrompt}
                      onChange={handleAskSystemPromptChange}
                      disabled={isSavingAsk || isLoadingAskDetails}
                    />
                    <Label htmlFor="ask-system-prompt">System prompt</Label>
                    <Textarea
                      id="ask-system-prompt"
                      rows={6}
                      value={askFormValues.systemPrompt}
                      onChange={(e) => handleAskSystemPromptChange(e.target.value)}
                      placeholder="Provide the system prompt used by the AI for this ask"
                      disabled={isSavingAsk || isLoadingAskDetails}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-start">Start</Label>
                      <DateTimePicker
                        id="ask-start"
                        value={askFormValues.startDate}
                        onChange={handleAskStartChange}
                        disabled={isSavingAsk || isLoadingAskDetails}
                        placeholder="Select start date"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-end">End</Label>
                      <DateTimePicker
                        id="ask-end"
                        value={askFormValues.endDate}
                        onChange={handleAskEndChange}
                        disabled={isSavingAsk || isLoadingAskDetails}
                        placeholder="Select end date"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-delivery">Delivery mode</Label>
                      <select
                        id="ask-delivery"
                        value={askFormValues.deliveryMode}
                        onChange={handleAskDeliveryModeChange}
                        className="h-10 rounded-md border border-white/10 bg-slate-900/70 px-3 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                        disabled={isSavingAsk || isLoadingAskDetails}
                      >
                        {askDeliveryModes.map(mode => (
                          <option key={mode} value={mode}>
                            {mode === "physical" ? "In-person" : "Digital"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-conversation-mode">Mode de conversation</Label>
                      <select
                        id="ask-conversation-mode"
                        value={askFormValues.conversationMode}
                        onChange={handleAskConversationModeChange}
                        className="h-10 rounded-md border border-white/10 bg-slate-900/70 px-3 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                        disabled={isSavingAsk || isLoadingAskDetails}
                      >
                        {askConversationModes.map(mode => (
                          <option key={mode} value={mode}>
                            {mode === "individual_parallel" ? "Réponses individuelles en parallèle" :
                             mode === "collaborative" ? "Conversation multi-voix" :
                             mode === "group_reporter" ? "Groupe avec rapporteur" :
                             "Consultant (écoute passive)"}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        {askFormValues.conversationMode === "individual_parallel" && "Chacun répond séparément, sans voir les autres"}
                        {askFormValues.conversationMode === "collaborative" && "Tout le monde voit et peut rebondir sur les messages des autres"}
                        {askFormValues.conversationMode === "group_reporter" && "Tout le monde voit tout, un rapporteur consolide"}
                        {askFormValues.conversationMode === "consultant" && "L'IA écoute et suggère des questions au consultant, sans TTS"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label>Durée attendue de la conversation</Label>
                    <DurationSlider
                      value={askFormValues.expectedDurationMinutes}
                      onChange={handleAskExpectedDurationChange}
                      disabled={isSavingAsk || isLoadingAskDetails}
                    />
                    <p className="text-xs text-muted-foreground">
                      Cette durée sera divisée par le nombre d'étapes du plan de conversation pour adapter le rythme de l'agent IA.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ask-max-participants">Maximum participants</Label>
                      <Input
                        id="ask-max-participants"
                        value={askFormValues.maxParticipants}
                        onChange={handleAskMaxParticipantsChange}
                        placeholder="Optional limit"
                        disabled={isSavingAsk || isLoadingAskDetails}
                      />
                    </div>
                    <label className="flex items-center gap-2 self-end text-sm text-slate-300">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/20 bg-slate-900"
                        checked={askFormValues.allowAutoRegistration}
                        onChange={handleAskAnonymousToggle}
                        disabled={isSavingAsk || isLoadingAskDetails}
                      />
                      Autoriser l&apos;auto-inscription
                    </label>
                  </div>

                  {/* Public registration link - only shown when editing and auto-registration is enabled */}
                  {isEditingAsk && askFormValues.allowAutoRegistration && askFormValues.askKey && (
                    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                      <p className="text-xs uppercase tracking-wide text-indigo-300">Lien public d&apos;inscription</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Partagez ce lien pour permettre aux participants de s&apos;inscrire eux-mêmes
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={`${typeof window !== "undefined" ? window.location.origin : ""}/?ask=${askFormValues.askKey}`}
                          className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 font-mono"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/?ask=${askFormValues.askKey}`;
                            navigator.clipboard.writeText(url);
                          }}
                          className="rounded-lg border border-white/10 bg-slate-900/60 p-1.5 text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors"
                          title="Copier le lien"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {isEditingAsk ? (
                    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                      <div className="flex items-center gap-2 text-sm text-indigo-200">
                        <Users className="h-4 w-4" />
                        <span className="font-medium">Participants: {askFormValues.participantIds.length}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Manage participants and invite links directly from the ASK card in the journey view.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Label>Participants</Label>
                      {availableUsers.length ? (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {availableUsers.map(user => {
                            const isSelected = askFormValues.participantIds.includes(user.id);
                            return (
                              <label
                                key={user.id}
                                className={cn(
                                  "inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-slate-950/60 px-3 py-2 text-sm transition",
                                  isSelected
                                    ? "border-indigo-400/70 bg-indigo-500/10 text-indigo-100"
                                    : "border-white/10 text-slate-200 hover:border-indigo-300/50",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-white/30 bg-slate-900 text-indigo-500 focus:ring-indigo-400"
                                  checked={isSelected}
                                  onChange={() => handleAskParticipantToggle(user.id)}
                                  disabled={isSavingAsk || isLoadingAskDetails}
                                />
                                <span className="flex flex-col leading-tight">
                                  <span className="font-medium text-white">{user.name}</span>
                                  {user.role ? <span className="text-xs text-slate-400">{user.role}</span> : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">No collaborators are available for this project yet.</p>
                      )}

                      {askFormValues.participantIds?.length && (askFormValues.conversationMode === "group_reporter" || askFormValues.conversationMode === "consultant") ? (
                        <div className="flex flex-col gap-2 mt-2">
                          <Label htmlFor="ask-spokesperson">
                            {askFormValues.conversationMode === "consultant" ? "Facilitator (voit les questions suggérées)" : "Spokesperson (rapporteur)"}
                          </Label>
                          <select
                            id="ask-spokesperson"
                            value={askFormValues.spokespersonId}
                            onChange={handleAskSpokespersonChange}
                            className="h-10 rounded-md border border-white/10 bg-slate-900/70 px-3 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring focus:ring-indigo-400/20"
                            disabled={isSavingAsk || isLoadingAskDetails}
                          >
                            <option value="">
                              {askFormValues.conversationMode === "consultant" ? "No facilitator" : "No spokesperson"}
                            </option>
                            {askFormValues.participantIds
                              .map(participantId => availableUsers.find(user => user.id === participantId))
                              .filter((user): user is NonNullable<typeof user> => Boolean(user))
                              .map(user => (
                                <option key={user.id} value={user.id}>
                                  {user.name}
                                </option>
                              ))}
                          </select>
                          <p className="text-xs text-muted-foreground">
                            {askFormValues.conversationMode === "consultant"
                              ? "Le facilitator voit les questions suggérées par l'IA"
                              : "Le rapporteur consolide les contributions du groupe"}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="submit"
                      className={cn("gap-2", isEditingAsk ? "bg-blue-500 hover:bg-blue-600" : "bg-emerald-500 hover:bg-emerald-600")}
                      disabled={isSavingAsk || isLoadingAskDetails}
                    >
                      {isSavingAsk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {isEditingAsk ? "Update ASK" : "Save ASK"}
                    </Button>
                    {isEditingAsk && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={handleAskDelete}
                        disabled={isSavingAsk}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="glassDark"
                      onClick={handleAskCancel}
                      disabled={isSavingAsk}
                      className="gap-2"
                    >
                      Close
                    </Button>
                  </div>
                </form>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      </div>
    </>
  );
}
