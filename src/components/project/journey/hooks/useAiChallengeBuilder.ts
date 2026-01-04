/**
 * Custom hook for AI Challenge Builder functionality
 * Extracted from ProjectJourneyBoard for better maintainability
 */

import { useCallback, useEffect, useState } from "react";
import type {
  AiChallengeUpdateSuggestion,
  AiFoundationInsight,
  AiNewChallengeSuggestion,
  AiSubChallengeUpdateSuggestion,
  ProjectChallengeNode,
  ProjectJourneyBoardData,
  ProjectParticipantSummary,
} from "@/types";
import type { FeedbackState } from "../types";

// ===== Types =====

export type AiBuilderResultsData = {
  suggestions: AiChallengeUpdateSuggestion[];
  newChallenges: AiNewChallengeSuggestion[];
  errors: Array<{ challengeId: string | null; message: string }> | null;
  lastRunAt: string | null;
  runId?: string; // Unique identifier for each execution
  status?: "running" | "completed"; // Track if analysis is in progress
  startedAt?: string; // When the analysis started
};

export interface UseAiChallengeBuilderOptions {
  projectId: string;
  boardData: ProjectJourneyBoardData | null;
  challengeById: Map<string, ProjectChallengeNode>;
  loadJourneyData: (options?: { silent?: boolean }) => Promise<void>;
}

export interface UseAiChallengeBuilderReturn {
  // State
  aiSuggestions: AiChallengeUpdateSuggestion[];
  aiNewChallenges: AiNewChallengeSuggestion[];
  aiBuilderErrors: Array<{ challengeId: string | null; message: string }> | null;
  aiBuilderFeedback: FeedbackState | null;
  isAiBuilderRunning: boolean;
  isAiPanelOpen: boolean;
  aiBuilderLastRunAt: string | null;
  hasAiBuilderResults: boolean;
  applyingChallengeUpdateIds: Set<string>;
  applyingSubChallengeUpdateIds: Set<string>;
  applyingNewSubChallengeKeys: Set<string>;
  applyingNewChallengeIndices: Set<number>;

  // Setters
  setIsAiPanelOpen: (value: boolean) => void;
  setAiBuilderFeedback: (feedback: FeedbackState | null) => void;

  // Handlers
  handleLaunchAiChallengeBuilder: (scopeChallengeId?: string) => Promise<void>;
  handleDismissChallengeSuggestion: (challengeId: string) => void;
  handleDismissNewChallengeSuggestion: (index: number) => void;
  handleApplyChallengeUpdate: (
    challengeId: string,
    updates?: AiChallengeUpdateSuggestion["updates"] | null,
    foundationInsights?: AiFoundationInsight[]
  ) => Promise<void>;
  handleDismissChallengeUpdate: (challengeId: string) => void;
  handleApplySubChallengeUpdate: (
    parentChallengeId: string,
    update: AiSubChallengeUpdateSuggestion
  ) => Promise<void>;
  handleDismissSubChallengeUpdate: (parentChallengeId: string, subChallengeId: string) => void;
  handleApplySuggestedNewSubChallenge: (
    parentChallengeId: string,
    index: number,
    newChallenge: AiNewChallengeSuggestion
  ) => Promise<void>;
  handleDismissSuggestedNewSubChallenge: (parentChallengeId: string, index: number) => void;
  handleApplyNewChallengeSuggestion: (
    suggestion: AiNewChallengeSuggestion,
    index: number
  ) => Promise<void>;
}

// ===== Helper Functions =====

/**
 * Prune AI suggestion nodes that have no actual changes
 */
function pruneAiSuggestionNodes(
  suggestion: AiChallengeUpdateSuggestion
): AiChallengeUpdateSuggestion | null {
  const hasChallengeUpdates = Boolean(
    suggestion.updates &&
      (suggestion.updates.title ||
        suggestion.updates.description ||
        suggestion.updates.status ||
        suggestion.updates.impact ||
        suggestion.updates.owners?.length)
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
}

/**
 * Resolve owner ID from list of owners
 */
function resolveOwnerId(
  owners: ProjectParticipantSummary[] | null | undefined,
  availableUsers: ProjectParticipantSummary[]
): string {
  if (!owners?.length) {
    return "";
  }

  for (const owner of owners) {
    if (owner.id && availableUsers.some((user) => user.id === owner.id)) {
      return owner.id;
    }

    const normalizedName = owner.name?.toLowerCase();
    if (normalizedName) {
      const match = availableUsers.find((user) => user.name.toLowerCase() === normalizedName);
      if (match) {
        return match.id;
      }
    }
  }

  return "";
}

// ===== Hook Implementation =====

export function useAiChallengeBuilder({
  projectId,
  boardData,
  challengeById,
  loadJourneyData,
}: UseAiChallengeBuilderOptions): UseAiChallengeBuilderReturn {
  // State
  const [aiSuggestions, setAiSuggestions] = useState<AiChallengeUpdateSuggestion[]>([]);
  const [aiNewChallenges, setAiNewChallenges] = useState<AiNewChallengeSuggestion[]>([]);
  const [aiBuilderErrors, setAiBuilderErrors] = useState<Array<{
    challengeId: string | null;
    message: string;
  }> | null>(null);
  const [aiBuilderFeedback, setAiBuilderFeedback] = useState<FeedbackState | null>(null);
  const [isAiBuilderRunning, setIsAiBuilderRunning] = useState(false);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [aiBuilderLastRunAt, setAiBuilderLastRunAt] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [hasAiBuilderResults, setHasAiBuilderResults] = useState(false);
  const [applyingChallengeUpdateIds, setApplyingChallengeUpdateIds] = useState<Set<string>>(
    () => new Set()
  );
  const [applyingSubChallengeUpdateIds, setApplyingSubChallengeUpdateIds] = useState<Set<string>>(
    () => new Set()
  );
  const [applyingNewSubChallengeKeys, setApplyingNewSubChallengeKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [applyingNewChallengeIndices, setApplyingNewChallengeIndices] = useState<Set<number>>(
    () => new Set()
  );

  // Load AI builder results from API
  const loadAiBuilderResults = useCallback(async (options?: { restoreRunningState?: boolean }): Promise<AiBuilderResultsData | null> => {
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

        // Restore running state if analysis is in progress (e.g., after page reload)
        if (options?.restoreRunningState && data.status === "running" && data.runId) {
          setIsAiBuilderRunning(true);
          setCurrentRunId(data.runId);
        }

        return data;
      }
      return null;
    } catch (error) {
      console.error("Failed to load AI builder results:", error);
      return null;
    }
  }, [projectId]);

  // Load AI results on mount (restore running state if analysis is in progress)
  useEffect(() => {
    loadAiBuilderResults({ restoreRunningState: true });
  }, [loadAiBuilderResults]);

  // Poll for AI results when builder is running
  useEffect(() => {
    if (!isAiBuilderRunning || !currentRunId) return;

    const pollInterval = setInterval(async () => {
      const data = await loadAiBuilderResults();
      if (data) {
        // Check if the analysis has completed (status changed from "running" to "completed")
        // Also verify runId matches to ensure we're checking the same run
        if (data.status === "completed" && data.runId === currentRunId) {
          setIsAiBuilderRunning(false);
          setCurrentRunId(null);

          const hasResults = data.suggestions.length > 0 || data.newChallenges.length > 0;
          const hasErrors = data.errors && data.errors.length > 0;

          if (hasResults) {
            setAiBuilderFeedback({
              type: "success",
              message: "Analyse IA terminée. Cliquez sur l'onglet AI Suggestions pour voir les résultats.",
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
  }, [isAiBuilderRunning, currentRunId, loadAiBuilderResults]);

  // Auto-clear feedback after timeout
  useEffect(() => {
    if (!aiBuilderFeedback) return;
    const timeoutId = window.setTimeout(() => setAiBuilderFeedback(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [aiBuilderFeedback]);

  // Handlers
  const handleLaunchAiChallengeBuilder = useCallback(
    async (scopeChallengeId?: string) => {
      if (isAiBuilderRunning) return;

      // Generate a unique runId for this execution
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      setIsAiBuilderRunning(true);
      setCurrentRunId(runId);
      setAiBuilderFeedback({
        type: "success",
        message: "Génération IA lancée. Vous pouvez continuer à naviguer.",
      });

      fetch(`/api/admin/projects/${projectId}/ai/challenge-builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(scopeChallengeId ? { scopeChallengeId } : {}),
          runId, // Pass runId to API
        }),
      }).catch((error) => {
        console.error("Failed to start challenge builder:", error);
        setIsAiBuilderRunning(false);
        setCurrentRunId(null);
        setAiBuilderFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Erreur inattendue lors du lancement de l'analyse IA.",
        });
      });
    },
    [projectId, isAiBuilderRunning]
  );

  const handleDismissChallengeSuggestion = useCallback((challengeId: string) => {
    setAiSuggestions((current) => current.filter((item) => item.challengeId !== challengeId));
  }, []);

  const handleDismissNewChallengeSuggestion = useCallback((index: number) => {
    setAiNewChallenges((current) =>
      current.filter((_, candidateIndex) => candidateIndex !== index)
    );
  }, []);

  const handleApplyChallengeUpdate = useCallback(
    async (
      challengeId: string,
      updates?: AiChallengeUpdateSuggestion["updates"] | null,
      _foundationInsights?: AiFoundationInsight[]
    ) => {
      if (!boardData) return;

      setApplyingChallengeUpdateIds((current) => {
        const next = new Set(current);
        next.add(challengeId);
        return next;
      });
      setAiBuilderFeedback(null);

      try {
        const baseChallenge = challengeById.get(challengeId);
        const availableUsers = boardData.availableUsers ?? [];
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
        const ownerId = resolveOwnerId(updates?.owners ?? null, availableUsers);
        if (ownerId) {
          payload.assignedTo = ownerId;
        }

        if (Object.keys(payload).length > 0) {
          await fetch(`/api/admin/challenges/${challengeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then(async (response) => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
              throw new Error(
                result.error ||
                  `Échec de la mise à jour du challenge ${baseChallenge?.title ?? challengeId}.`
              );
            }
          });
          await loadJourneyData({ silent: true });
        }

        setAiSuggestions((current) =>
          current
            .map((suggestion) => {
              if (suggestion.challengeId !== challengeId) {
                return suggestion;
              }
              const next: AiChallengeUpdateSuggestion = { ...suggestion };
              delete (next as Partial<AiChallengeUpdateSuggestion>).updates;
              delete (next as Partial<AiChallengeUpdateSuggestion>).foundationInsights;
              return pruneAiSuggestionNodes(next);
            })
            .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value))
        );

        setAiBuilderFeedback({
          type: "success",
          message: `Mise à jour appliquée au challenge « ${baseChallenge?.title ?? challengeId} ».`,
        });
      } catch (error) {
        setAiBuilderFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible d'appliquer la mise à jour du challenge.",
        });
      } finally {
        setApplyingChallengeUpdateIds((current) => {
          const next = new Set(current);
          next.delete(challengeId);
          return next;
        });
      }
    },
    [boardData, challengeById, loadJourneyData]
  );

  const handleDismissChallengeUpdate = useCallback((challengeId: string) => {
    setAiSuggestions((current) =>
      current
        .map((suggestion) => {
          if (suggestion.challengeId !== challengeId) {
            return suggestion;
          }
          const next: AiChallengeUpdateSuggestion = { ...suggestion };
          delete (next as Partial<AiChallengeUpdateSuggestion>).updates;
          delete (next as Partial<AiChallengeUpdateSuggestion>).foundationInsights;
          return pruneAiSuggestionNodes(next);
        })
        .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value))
    );
  }, []);

  const handleApplySubChallengeUpdate = useCallback(
    async (parentChallengeId: string, update: AiSubChallengeUpdateSuggestion) => {
      if (!boardData) return;

      setApplyingSubChallengeUpdateIds((current) => {
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
          }).then(async (response) => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
              throw new Error(
                result.error ||
                  `Échec de la mise à jour du sous-challenge ${currentChallenge.title}.`
              );
            }
          });
          await loadJourneyData({ silent: true });
        }

        setAiSuggestions((current) =>
          current
            .map((suggestion) => {
              if (suggestion.challengeId !== parentChallengeId) {
                return suggestion;
              }
              const remaining = (suggestion.subChallengeUpdates ?? []).filter(
                (item) => item.id !== update.id
              );
              const next: AiChallengeUpdateSuggestion = {
                ...suggestion,
                subChallengeUpdates: remaining.length ? remaining : undefined,
              };
              return pruneAiSuggestionNodes(next);
            })
            .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value))
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
            error instanceof Error
              ? error.message
              : "Impossible d'appliquer la mise à jour du sous-challenge.",
        });
      } finally {
        setApplyingSubChallengeUpdateIds((current) => {
          const next = new Set(current);
          next.delete(update.id);
          return next;
        });
      }
    },
    [boardData, challengeById, loadJourneyData]
  );

  const handleDismissSubChallengeUpdate = useCallback(
    (parentChallengeId: string, subChallengeId: string) => {
      setAiSuggestions((current) =>
        current
          .map((suggestion) => {
            if (suggestion.challengeId !== parentChallengeId) {
              return suggestion;
            }
            const remaining = (suggestion.subChallengeUpdates ?? []).filter(
              (item) => item.id !== subChallengeId
            );
            const next: AiChallengeUpdateSuggestion = {
              ...suggestion,
              subChallengeUpdates: remaining.length ? remaining : undefined,
            };
            return pruneAiSuggestionNodes(next);
          })
          .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value))
      );
    },
    []
  );

  const handleApplySuggestedNewSubChallenge = useCallback(
    async (
      parentChallengeId: string,
      index: number,
      newChallenge: AiNewChallengeSuggestion
    ) => {
      if (!boardData) return;

      const key = `${parentChallengeId}:${newChallenge.referenceId ?? index}`;
      setApplyingNewSubChallengeKeys((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
      setAiBuilderFeedback(null);

      try {
        const availableUsers = boardData.availableUsers ?? [];
        const resolvedParentId = newChallenge.parentId ?? parentChallengeId;
        const parent =
          challengeById.get(resolvedParentId) ?? challengeById.get(parentChallengeId) ?? null;
        const payload: Record<string, unknown> = {
          name: newChallenge.title,
          description: newChallenge.description ?? "",
          status: newChallenge.status ?? parent?.status ?? "open",
          priority: newChallenge.impact ?? parent?.impact ?? "medium",
          projectId: boardData.projectId,
          parentChallengeId: resolvedParentId,
        };
        const ownerId = resolveOwnerId(newChallenge.owners ?? null, availableUsers);
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
          throw new Error(
            result.error || `Échec de la création du sous-challenge ${newChallenge.title}.`
          );
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
          }).then(async (applyResponse) => {
            if (!applyResponse.ok) {
              const applyResult = await applyResponse.json().catch(() => ({}));
              throw new Error(
                (applyResult as { error?: string }).error ||
                  `Sous-challenge créé mais les foundation insights n'ont pas pu être liés.`
              );
            }
          });
        }

        await loadJourneyData({ silent: true });

        setAiSuggestions((current) =>
          current
            .map((suggestion) => {
              if (suggestion.challengeId !== parentChallengeId) {
                return suggestion;
              }
              const remaining = (suggestion.newSubChallenges ?? []).filter(
                (_, candidateIndex) => candidateIndex !== index
              );
              const next: AiChallengeUpdateSuggestion = {
                ...suggestion,
                newSubChallenges: remaining.length ? remaining : undefined,
              };
              return pruneAiSuggestionNodes(next);
            })
            .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value))
        );

        setAiBuilderFeedback({
          type: "success",
          message: `Sous-challenge « ${newChallenge.title} » créé.`,
        });
      } catch (error) {
        setAiBuilderFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de créer le nouveau sous-challenge suggéré.",
        });
      } finally {
        setApplyingNewSubChallengeKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [boardData, challengeById, loadJourneyData]
  );

  const handleDismissSuggestedNewSubChallenge = useCallback(
    (parentChallengeId: string, index: number) => {
      setAiSuggestions((current) =>
        current
          .map((suggestion) => {
            if (suggestion.challengeId !== parentChallengeId) {
              return suggestion;
            }
            const remaining = (suggestion.newSubChallenges ?? []).filter(
              (_, candidateIndex) => candidateIndex !== index
            );
            const next: AiChallengeUpdateSuggestion = {
              ...suggestion,
              newSubChallenges: remaining.length ? remaining : undefined,
            };
            return pruneAiSuggestionNodes(next);
          })
          .filter((value): value is AiChallengeUpdateSuggestion => Boolean(value))
      );
    },
    []
  );

  const handleApplyNewChallengeSuggestion = useCallback(
    async (suggestion: AiNewChallengeSuggestion, index: number) => {
      if (!boardData) return;

      setApplyingNewChallengeIndices((current) => {
        const next = new Set(current);
        next.add(index);
        return next;
      });
      setAiBuilderFeedback(null);

      try {
        const availableUsers = boardData.availableUsers ?? [];
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
        const ownerId = resolveOwnerId(suggestion.owners ?? null, availableUsers);
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
          throw new Error(result.error || `Échec de la création du challenge ${suggestion.title}.`);
        }

        const newChallengeId = result.data?.id;

        if (newChallengeId && suggestion.foundationInsights?.length) {
          try {
            const applyResponse = await fetch(
              `/api/admin/projects/${boardData.projectId}/ai/challenge-builder/apply`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  challengeId: newChallengeId,
                  foundationInsights: suggestion.foundationInsights,
                }),
              }
            );

            if (!applyResponse.ok) {
              const errorText = await applyResponse.text();
              console.error("Failed to create foundation insights:", errorText);
            }
          } catch (insightError) {
            console.error("Error creating foundation insights:", insightError);
          }
        }

        await loadJourneyData({ silent: true });

        setAiNewChallenges((current) =>
          current.filter((_, candidateIndex) => candidateIndex !== index)
        );

        const insightCount = suggestion.foundationInsights?.length || 0;
        const insightMessage =
          insightCount > 0
            ? ` avec ${insightCount} foundation insight${insightCount > 1 ? "s" : ""}`
            : "";

        setAiBuilderFeedback({
          type: "success",
          message: `Challenge « ${suggestion.title} » créé${insightMessage}.`,
        });
      } catch (error) {
        setAiBuilderFeedback({
          type: "error",
          message:
            error instanceof Error ? error.message : "Impossible de créer le challenge proposé.",
        });
      } finally {
        setApplyingNewChallengeIndices((current) => {
          const next = new Set(current);
          next.delete(index);
          return next;
        });
      }
    },
    [boardData, challengeById, loadJourneyData]
  );

  return {
    // State
    aiSuggestions,
    aiNewChallenges,
    aiBuilderErrors,
    aiBuilderFeedback,
    isAiBuilderRunning,
    isAiPanelOpen,
    aiBuilderLastRunAt,
    hasAiBuilderResults,
    applyingChallengeUpdateIds,
    applyingSubChallengeUpdateIds,
    applyingNewSubChallengeKeys,
    applyingNewChallengeIndices,

    // Setters
    setIsAiPanelOpen,
    setAiBuilderFeedback,

    // Handlers
    handleLaunchAiChallengeBuilder,
    handleDismissChallengeSuggestion,
    handleDismissNewChallengeSuggestion,
    handleApplyChallengeUpdate,
    handleDismissChallengeUpdate,
    handleApplySubChallengeUpdate,
    handleDismissSubChallengeUpdate,
    handleApplySuggestedNewSubChallenge,
    handleDismissSuggestedNewSubChallenge,
    handleApplyNewChallengeSuggestion,
  };
}
