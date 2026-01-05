"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Network, Sparkles, ChevronDown, ChevronUp, TestTube2, Settings, Pencil, Trash2, Plus, Download } from "lucide-react";
import type { AiAgentRecord, AiModelConfig, PromptVariableDefinition, ApiResponse, AskPromptTemplate, AiAgentLog } from "@/types";
import { extractTemplateVariables } from "@/lib/ai/templates";
import { AgentTestMode } from "@/components/admin/AgentTestMode";
import { agentGroupColors } from "@/lib/module-colors";

interface AgentsResponse {
  success: boolean;
  data?: {
    agents: AiAgentRecord[];
    variables: PromptVariableDefinition[];
  };
  error?: string;
}

interface ModelsResponse {
  success: boolean;
  data?: AiModelConfig[];
  error?: string;
}

type AgentDraft = AiAgentRecord & {
  systemPromptDraft: string;
  userPromptDraft: string;
  availableVariablesDraft: string[];
  modelConfigIdDraft: string | null;
  fallbackModelConfigIdDraft: string | null;
  voiceDraft: boolean;
  isSaving?: boolean;
  saveError?: string | null;
  saveSuccess?: boolean;
};

type NewAgentDraft = {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  availableVariables: string[];
  modelConfigId: string | null;
  fallbackModelConfigId: string | null;
  voice: boolean;
  slugManuallyEdited: boolean;
  isSaving: boolean;
  error: string | null;
  successMessage: string | null;
};

type NewModelDraft = {
  code: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  isDefault: boolean;
  isFallback: boolean;
  deepgramLlmModel: string;
  deepgramLlmProvider: string;
  deepgramSttModel: string;
  deepgramTtsModel: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
  enableThinking: boolean;
  thinkingBudgetTokens?: number;
  isSaving: boolean;
  error: string | null;
  successMessage: string | null;
};

interface CreateAgentResponse {
  success: boolean;
  data?: AiAgentRecord;
  error?: string;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractFilenameFromDisposition(disposition?: string | null): string | null {
  if (!disposition) {
    return null;
  }

  const extended = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (extended?.[1]) {
    const value = extended[1].trim().replace(/^"+|"+$/g, "");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  const basic = disposition.match(/filename="?([^\";]+)"?/i);
  if (basic?.[1]) {
    const value = basic[1].trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

// Group agents by category
type AgentGroup = {
  key: string;
  title: string;
  description: string;
  agents: AgentDraft[];
  color: {
    border: string;
    bg: string;
    text: string;
    badge: string;
  };
};

// Use shared module colors with additional "other" category
const groupColors: Record<string, AgentGroup["color"]> = {
  ...agentGroupColors,
  other: {
    border: "border-gray-400/40",
    bg: "bg-gray-500/10",
    text: "text-gray-700 dark:text-gray-200",
    badge: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  },
};

function groupAgents(agents: AgentDraft[]): AgentGroup[] {
  const groups: AgentGroup[] = [
    {
      key: "conversation",
      title: "Conversation",
      description: "Agents de conversation et de réponse dans les sessions ASK",
      agents: [],
      color: groupColors.conversation,
    },
    {
      key: "insight-detection",
      title: "Détection d'Insights",
      description: "Agents de détection et d'analyse d'insights dans les conversations",
      agents: [],
      color: groupColors["insight-detection"],
    },
    {
      key: "ask-generator",
      title: "Générateur de Sessions ASK",
      description: "Agents de génération de nouvelles sessions ASK",
      agents: [],
      color: groupColors["ask-generator"],
    },
    {
      key: "challenge-builder",
      title: "Constructeur de Challenges",
      description: "Agents de construction et de révision de challenges",
      agents: [],
      color: groupColors["challenge-builder"],
    },
    {
      key: "rapport",
      title: "Rapport & Synthèse",
      description: "Agents de génération de rapports, synthèses et comparaisons",
      agents: [],
      color: groupColors.rapport,
    },
    {
      key: "security",
      title: "Sécurité",
      description: "Agents de surveillance et de sécurité des messages",
      agents: [],
      color: {
        border: "border-red-400/40",
        bg: "bg-red-500/10",
        text: "text-red-700 dark:text-red-200",
        badge: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      },
    },
    {
      key: "other",
      title: "Autres Agents",
      description: "Autres agents du système",
      agents: [],
      color: groupColors.other,
    },
  ];

  agents.forEach(agent => {
    const slug = agent.slug.toLowerCase();
    if (slug.includes("conversation") || slug.includes("chat")) {
      groups[0].agents.push(agent);
    } else if (slug.includes("rapport") || slug.includes("synthesis") || slug.includes("comparison")) {
      // Rapport & Synthesis agents (before insight-detection to catch rapport-claim-* agents)
      groups[4].agents.push(agent);
    } else if (slug.includes("insight-detection") || slug.includes("insight") || slug.includes("detection")) {
      groups[1].agents.push(agent);
    } else if (slug.includes("ask-generator") || slug.includes("generator")) {
      groups[2].agents.push(agent);
    } else if (slug.includes("challenge") || slug.includes("builder")) {
      groups[3].agents.push(agent);
    } else if (slug.includes("security") || slug.includes("monitoring") || slug.includes("surveillance")) {
      groups[5].agents.push(agent);
    } else {
      groups[6].agents.push(agent);
    }
  });

  // Filter out empty groups
  return groups.filter(group => group.agents.length > 0);
}

// Filter variables by agent type
function getVariablesForAgent(
  agentSlug: string,
  allVariables: PromptVariableDefinition[]
): PromptVariableDefinition[] {
  const slug = agentSlug.toLowerCase();
  
  // Variables pour agents ASK/conversation
  const askVariables = [
    "ask_key",
    "ask_question",
    "ask_description",
    "message_history",
    "latest_user_message",
    "latest_ai_response",
    "participant_name",
    "participants",
    "existing_insights_json",
    "system_prompt_ask",
    "system_prompt_challenge",
    "system_prompt_project",
    "conversation_plan",
    "current_step",
    "current_step_id",
  ];

  // Variables pour agents challenge-builder et ask-generator
  const challengeVariables = [
    "project_name",
    "project_goal",
    "project_status",
    "challenge_id",
    "challenge_title",
    "challenge_description",
    "challenge_status",
    "challenge_impact",
    "challenge_context_json",
    "insights_json",
    "existing_asks_json",
    "system_prompt_project",
    "system_prompt_challenge",
  ];

  if (slug.includes("conversation") || slug.includes("chat") || slug.includes("ask-conversation")) {
    return allVariables.filter(v => askVariables.includes(v.key));
  }
  
  if (slug.includes("challenge") || slug.includes("builder")) {
    return allVariables.filter(v => challengeVariables.includes(v.key));
  }
  
  if (slug.includes("ask-generator") || slug.includes("generator")) {
    return allVariables.filter(v => challengeVariables.includes(v.key));
  }

  if (slug.includes("insight-detection") || slug.includes("insight")) {
    // Variables pour détection d'insights
    return allVariables.filter(v => 
      askVariables.includes(v.key) || 
      v.key === "existing_insights_json" ||
      v.key === "insight_types"
    );
  }

  // Par défaut, toutes les variables
  return allVariables;
}

function createEmptyNewAgentDraft(): NewAgentDraft {
  return {
    slug: "",
    name: "",
    description: "",
    systemPrompt: "",
    userPrompt: "",
    availableVariables: [],
    modelConfigId: null,
    fallbackModelConfigId: null,
    voice: false,
    slugManuallyEdited: false,
    isSaving: false,
    error: null,
    successMessage: null,
  };
}

function mergeAgentWithDraft(agent: AiAgentRecord): AgentDraft {
  return {
    ...agent,
    systemPromptDraft: agent.systemPrompt,
    userPromptDraft: agent.userPrompt,
    availableVariablesDraft: [...agent.availableVariables],
    modelConfigIdDraft: agent.modelConfigId ?? null,
    fallbackModelConfigIdDraft: agent.fallbackModelConfigId ?? null,
    voiceDraft: agent.voice ?? false,
    isSaving: false,
    saveError: null,
    saveSuccess: false,
  };
}

type ModelDraft = AiModelConfig & {
  voiceAgentProviderDraft?: "deepgram-voice-agent" | "speechmatics-voice-agent";
  deepgramLlmModelDraft?: string;
  deepgramLlmProviderDraft?: "anthropic" | "openai";
  deepgramSttModelDraft?: string;
  deepgramTtsModelDraft?: string;
  speechmaticsSttLanguageDraft?: string;
  speechmaticsSttOperatingPointDraft?: "enhanced" | "standard";
  speechmaticsSttMaxDelayDraft?: number;
  speechmaticsSttEnablePartialsDraft?: boolean;
  speechmaticsLlmProviderDraft?: "anthropic" | "openai";
  speechmaticsLlmModelDraft?: string;
  speechmaticsApiKeyEnvVarDraft?: string;
  elevenLabsVoiceIdDraft?: string;
  elevenLabsModelIdDraft?: string;
  enableThinkingDraft?: boolean;
  thinkingBudgetTokensDraft?: number;
  isSaving?: boolean;
  saveError?: string | null;
  saveSuccess?: boolean;
};

export default function AiConfigurationPage() {
  const [agents, setAgents] = useState<AgentDraft[]>([]);
  const [models, setModels] = useState<ModelDraft[]>([]);
  const [variables, setVariables] = useState<PromptVariableDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newAgent, setNewAgent] = useState<NewAgentDraft>(() => createEmptyNewAgentDraft());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const [collapsedModels, setCollapsedModels] = useState<Set<string>>(new Set());
  // Sections collapsibles pour chaque modèle : agent principal, STT, TTS
  const [collapsedModelSections, setCollapsedModelSections] = useState<Map<string, Set<string>>>(new Map());
  // Provider sélectionné pour STT et TTS par modèle
  const [sttProvider, setSttProvider] = useState<Map<string, "deepgram" | "speechmatics" | "none">>(new Map());
  const [ttsProvider, setTtsProvider] = useState<Map<string, "deepgram" | "elevenlabs" | "none">>(new Map());
  const [isCreatingModel, setIsCreatingModel] = useState(false);
  const [newModel, setNewModel] = useState<NewModelDraft>(() => ({
    code: '',
    name: '',
    provider: 'anthropic',
    model: '',
    baseUrl: '',
    apiKeyEnvVar: '',
    isDefault: false,
    isFallback: false,
    deepgramLlmModel: '',
    deepgramLlmProvider: '',
    deepgramSttModel: '',
    deepgramTtsModel: '',
    elevenLabsVoiceId: '',
    elevenLabsModelId: '',
    enableThinking: false,
    thinkingBudgetTokens: 10000,
    isSaving: false,
    error: null,
    successMessage: null,
  }));
  const [testModeAgentId, setTestModeAgentId] = useState<string | null>(null);
  const [isExportingPrompts, setIsExportingPrompts] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
  // Ask prompt templates state
  const [templates, setTemplates] = useState<AskPromptTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState<{ name: string; description: string; systemPrompt: string }>({
    name: "",
    description: "",
    systemPrompt: "",
  });
  const [templateDrafts, setTemplateDrafts] = useState<Map<string, { name: string; description: string; systemPrompt: string }>>(new Map());
  
  // Graph RAG state
  const [graphStats, setGraphStats] = useState<{
    totalInsights: number;
    insightsWithEmbeddings: number;
    insightsWithEntities: number;
    graphEdges: number;
  } | null>(null);
  const [isLoadingGraphStats, setIsLoadingGraphStats] = useState(false);
  const [isBuildingGraph, setIsBuildingGraph] = useState(false);
  const [graphBuildResult, setGraphBuildResult] = useState<string | null>(null);
  const [graphBuildError, setGraphBuildError] = useState<string | null>(null);
  
  // AI Logs state
  const [logs, setLogs] = useState<AiAgentLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLimit, setLogsLimit] = useState(50);
  const [logsTotal, setLogsTotal] = useState(0);

  const fetchConfiguration = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [agentsResponse, modelsResponse] = await Promise.all([
        fetch("/api/admin/ai/agents", { credentials: "include" }),
        fetch("/api/admin/ai/models", { credentials: "include" }),
      ]);

      if (!agentsResponse.ok) {
        throw new Error("Impossible de charger les agents");
      }
      if (!modelsResponse.ok) {
        throw new Error("Impossible de charger les modèles");
      }

      const agentsJson: AgentsResponse = await agentsResponse.json();
      const modelsJson: ModelsResponse = await modelsResponse.json();

      if (!agentsJson.success) {
        throw new Error(agentsJson.error || "Impossible de charger les agents");
      }
      if (!modelsJson.success) {
        throw new Error(modelsJson.error || "Impossible de charger les modèles");
      }

      const loadedAgents = agentsJson.data?.agents.map(mergeAgentWithDraft) ?? [];
      setAgents(loadedAgents);
      setVariables(agentsJson.data?.variables ?? []);
      
      // Initialize models with drafts matching current values
      const loadedModels = (modelsJson.data ?? []).map(model => ({
        ...model,
        voiceAgentProviderDraft: model.voiceAgentProvider,
        deepgramLlmModelDraft: model.deepgramLlmModel,
        deepgramLlmProviderDraft: model.deepgramLlmProvider,
        deepgramSttModelDraft: model.deepgramSttModel,
        deepgramTtsModelDraft: model.deepgramTtsModel,
        speechmaticsSttLanguageDraft: model.speechmaticsSttLanguage,
        speechmaticsSttOperatingPointDraft: model.speechmaticsSttOperatingPoint,
        speechmaticsSttMaxDelayDraft: model.speechmaticsSttMaxDelay,
        speechmaticsSttEnablePartialsDraft: model.speechmaticsSttEnablePartials,
        speechmaticsLlmProviderDraft: model.speechmaticsLlmProvider,
        speechmaticsLlmModelDraft: model.speechmaticsLlmModel,
        speechmaticsApiKeyEnvVarDraft: model.speechmaticsApiKeyEnvVar,
        elevenLabsVoiceIdDraft: model.elevenLabsVoiceId,
        elevenLabsModelIdDraft: model.elevenLabsModelId,
        enableThinkingDraft: model.enableThinking ?? false,
        thinkingBudgetTokensDraft: model.thinkingBudgetTokens ?? undefined,
        isSaving: false,
        saveError: null,
        saveSuccess: false,
      }));
      setModels(loadedModels);
      
      // Initialize collapsed sections for each model (all collapsed by default)
      const sectionsMap = new Map<string, Set<string>>();
      const sttProviderMap = new Map<string, "deepgram" | "speechmatics" | "none">();
      const ttsProviderMap = new Map<string, "deepgram" | "elevenlabs" | "none">();
      
      loadedModels.forEach(model => {
        // Open "agent" section by default, keep "stt" and "tts" collapsed
        sectionsMap.set(model.id, new Set(["stt", "tts"])); // Only STT and TTS collapsed by default
        
        // Determine STT provider based on existing config
        // Priority: if both exist, prefer the one that's actually set
        if (model.deepgramSttModel) {
          sttProviderMap.set(model.id, "deepgram");
        } else if (model.speechmaticsSttLanguage) {
          sttProviderMap.set(model.id, "speechmatics");
        } else {
          sttProviderMap.set(model.id, "none");
        }
        
        // Determine TTS provider based on existing config
        // Priority: if both exist, prefer the one that's actually set
        if (model.deepgramTtsModel) {
          ttsProviderMap.set(model.id, "deepgram");
        } else if (model.elevenLabsVoiceId) {
          ttsProviderMap.set(model.id, "elevenlabs");
        } else {
          ttsProviderMap.set(model.id, "none");
        }
      });
      
      setCollapsedModelSections(sectionsMap);
      setSttProvider(sttProviderMap);
      setTtsProvider(ttsProviderMap);
      
      // Collapse all groups and models by default
      const groupedAgents = groupAgents(loadedAgents);
      setCollapsedGroups(new Set(groupedAgents.map(g => g.key)));
      setCollapsedModels(new Set(loadedModels.map(m => m.id)));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Erreur inattendue lors du chargement");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const response = await fetch("/api/admin/ask-prompt-templates", { credentials: "include" });
      const data: ApiResponse<AskPromptTemplate[]> = await response.json();
      
      if (data.success && data.data) {
        setTemplates(data.data);
      } else {
        console.error("Failed to load templates:", data.error);
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    setLogsError(null);
    try {
      const offset = (logsPage - 1) * logsLimit;
      const response = await fetch(
        `/api/admin/ai/logs?limit=${logsLimit}&offset=${offset}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Impossible de charger les logs");
      }
      const data: ApiResponse<{ logs: AiAgentLog[]; total: number }> = await response.json();
      if (!data.success || !data.data) {
        throw new Error(data.error || "Impossible de charger les logs");
      }
      setLogs(data.data.logs);
      setLogsTotal(data.data.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors du chargement des logs";
      setLogsError(message);
      console.error("Error fetching logs:", err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchConfiguration();
    loadGraphStats();
    fetchTemplates();
    fetchLogs();
  }, []);

  // Fermer tous les agents par défaut quand ils sont chargés pour la première fois
  const agentsInitializedRef = useRef(false);
  useEffect(() => {
    if (agents.length > 0 && !agentsInitializedRef.current) {
      setCollapsedAgents(new Set(agents.map(agent => agent.id)));
      agentsInitializedRef.current = true;
    }
  }, [agents]);

  useEffect(() => {
    fetchLogs();
  }, [logsPage, logsLimit]);

  const loadGraphStats = async () => {
    setIsLoadingGraphStats(true);
    try {
      const response = await fetch("/api/admin/graph/build", { credentials: "include" });
      const data: ApiResponse<{
        totalInsights: number;
        insightsWithEmbeddings: number;
        insightsWithEntities: number;
        graphEdges: number;
      }> = await response.json();

      if (data.success && data.data) {
        setGraphStats(data.data);
      }
    } catch (err) {
      console.error("Error loading graph stats:", err);
    } finally {
      setIsLoadingGraphStats(false);
    }
  };

  const handleBuildGraph = async () => {
    setIsBuildingGraph(true);
    setGraphBuildResult(null);
    setGraphBuildError(null);

    try {
      const response = await fetch("/api/admin/graph/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          limit: 100,
          skipExisting: false, // Process all insights, even if they have embeddings
        }),
      });

      const data: ApiResponse<{
        processed: number;
        skipped: number;
        errors: number;
        total: number;
        message: string;
      }> = await response.json();

      if (data.success && data.data) {
        setGraphBuildResult(
          `Traité ${data.data.processed} insights, ${data.data.errors} erreurs. ${data.data.message}`
        );
        // Reload stats
        await loadGraphStats();
      } else {
        setGraphBuildError(data.error || "Erreur lors de la construction du graphe");
      }
    } catch (err) {
      setGraphBuildError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setIsBuildingGraph(false);
    }
  };

  const handleToggleCreateForm = () => {
    setIsCreating(prev => {
      const next = !prev;
      if (!next) {
        setNewAgent(createEmptyNewAgentDraft());
      }
      return next;
    });
  };

  const handleExportPrompts = async () => {
    setIsExportingPrompts(true);
    setExportStatus(null);
    try {
      const response = await fetch("/api/admin/ai/prompts/export", {
        credentials: "include",
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let message = "Impossible d'exporter les prompts.";

        if (errorBody) {
          try {
            const parsed = JSON.parse(errorBody);
            if (typeof parsed?.error === "string") {
              message = parsed.error;
            } else if (typeof parsed?.message === "string") {
              message = parsed.message;
            } else {
              message = errorBody;
            }
          } catch {
            message = errorBody;
          }
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const filename =
        extractFilenameFromDisposition(response.headers.get("Content-Disposition")) ??
        `ai-prompts-${new Date().toISOString().split("T")[0]}.md`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setExportStatus({
        type: "success",
        message: `Fichier "${filename}" téléchargé.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inattendue lors de l'export des prompts.";
      setExportStatus({
        type: "error",
        message,
      });
    } finally {
      setIsExportingPrompts(false);
    }
  };

  const handleNewAgentNameChange = (value: string) => {
    setNewAgent(prev => {
      const shouldUpdateSlug = !prev.slugManuallyEdited;
      return {
        ...prev,
        name: value,
        slug: shouldUpdateSlug ? slugify(value) : prev.slug,
        error: null,
        successMessage: null,
      };
    });
  };

  const handleNewAgentSlugChange = (value: string) => {
    setNewAgent(prev => ({
      ...prev,
      slug: value,
      slugManuallyEdited: true,
      error: null,
      successMessage: null,
    }));
  };

  const handleNewAgentDescriptionChange = (value: string) => {
    setNewAgent(prev => ({
      ...prev,
      description: value,
      error: null,
      successMessage: null,
    }));
  };

  const handleNewAgentPromptChange = (field: "system" | "user", value: string) => {
    setNewAgent(prev => {
      const newSystemPrompt = field === "system" ? value : prev.systemPrompt;
      const newUserPrompt = field === "user" ? value : prev.userPrompt;
      
      // Auto-sync variables from prompts
      const systemVars = extractTemplateVariables(newSystemPrompt);
      const userVars = extractTemplateVariables(newUserPrompt);
      const allDetectedVars = new Set([...systemVars, ...userVars]);
      const merged = new Set([...prev.availableVariables, ...Array.from(allDetectedVars)]);
      const syncedVariables = Array.from(merged);
      
      return {
        ...prev,
        systemPrompt: newSystemPrompt,
        userPrompt: newUserPrompt,
        availableVariables: syncedVariables,
        error: null,
        successMessage: null,
      };
    });
  };

  const handleNewAgentModelChange = (field: "primary" | "fallback", value: string) => {
    setNewAgent(prev => ({
      ...prev,
      modelConfigId: field === "primary" ? (value || null) : prev.modelConfigId,
      fallbackModelConfigId: field === "fallback" ? (value || null) : prev.fallbackModelConfigId,
      error: null,
      successMessage: null,
    }));
  };

  const handleNewAgentToggleVariable = (variable: string) => {
    setNewAgent(prev => {
      const exists = prev.availableVariables.includes(variable);
      const updated = exists
        ? prev.availableVariables.filter(item => item !== variable)
        : [...prev.availableVariables, variable];

      return {
        ...prev,
        availableVariables: updated,
        error: null,
        successMessage: null,
      };
    });
  };

  const handleResetNewAgentForm = () => {
    setNewAgent(createEmptyNewAgentDraft());
  };

  const handleCreateAgent = async () => {
    setNewAgent(prev => ({ ...prev, isSaving: true, error: null, successMessage: null }));

    try {
      const slugValue = newAgent.slug.trim();
      const response = await fetch("/api/admin/ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          slug: slugValue.length > 0 ? slugValue : undefined,
          name: newAgent.name,
          description: newAgent.description.trim().length > 0 ? newAgent.description : null,
          systemPrompt: newAgent.systemPrompt,
          userPrompt: newAgent.userPrompt,
          availableVariables: newAgent.availableVariables,
          modelConfigId: newAgent.modelConfigId,
          fallbackModelConfigId: newAgent.fallbackModelConfigId,
          voice: newAgent.voice,
        }),
      });

      const result: CreateAgentResponse = await response.json();

      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || "Impossible de créer l'agent");
      }

      const createdAgent = result.data;

      setAgents(prev => [...prev, mergeAgentWithDraft(createdAgent)]);
      setNewAgent({
        ...createEmptyNewAgentDraft(),
        successMessage: `Agent "${createdAgent.name}" créé avec succès.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de la création de l'agent";
      setNewAgent(prev => ({ ...prev, isSaving: false, error: message }));
    }
  };

  const handleToggleVariable = (agentId: string, variable: string) => {
    setAgents(prev => prev.map(agent => {
      if (agent.id !== agentId) {
        return agent;
      }
      const exists = agent.availableVariablesDraft.includes(variable);
      const updatedVariables = exists
        ? agent.availableVariablesDraft.filter(item => item !== variable)
        : [...agent.availableVariablesDraft, variable];
      return { ...agent, availableVariablesDraft: updatedVariables, saveSuccess: false };
    }));
  };

  // Function to synchronize variables from prompts
  const syncVariablesFromPrompts = (systemPrompt: string, userPrompt: string, existingVariables: string[]): string[] => {
    const systemVars = extractTemplateVariables(systemPrompt);
    const userVars = extractTemplateVariables(userPrompt);
    const allDetectedVars = new Set([...systemVars, ...userVars]);
    
    // Merge with existing variables, avoiding duplicates
    const merged = new Set([...existingVariables, ...Array.from(allDetectedVars)]);
    return Array.from(merged);
  };

  const handlePromptChange = (agentId: string, field: "system" | "user", value: string) => {
    setAgents(prev => prev.map(agent => {
      if (agent.id !== agentId) {
        return agent;
      }
      const newSystemPrompt = field === "system" ? value : agent.systemPromptDraft;
      const newUserPrompt = field === "user" ? value : agent.userPromptDraft;
      
      // Auto-sync variables from prompts
      const syncedVariables = syncVariablesFromPrompts(
        newSystemPrompt,
        newUserPrompt,
        agent.availableVariablesDraft
      );
      
      if (field === "system") {
        return { ...agent, systemPromptDraft: value, availableVariablesDraft: syncedVariables, saveSuccess: false };
      }
      return { ...agent, userPromptDraft: value, availableVariablesDraft: syncedVariables, saveSuccess: false };
    }));
  };

  const handleModelChange = (agentId: string, field: "primary" | "fallback", value: string) => {
    setAgents(prev => prev.map(agent => {
      if (agent.id !== agentId) {
        return agent;
      }
      if (field === "primary") {
        return { ...agent, modelConfigIdDraft: value || null, saveSuccess: false };
      }
      return { ...agent, fallbackModelConfigIdDraft: value || null, saveSuccess: false };
    }));
  };

  const handleVoiceChange = (agentId: string, value: boolean) => {
    setAgents(prev => prev.map(agent => {
      if (agent.id !== agentId) {
        return agent;
      }
      return { ...agent, voiceDraft: value, saveSuccess: false };
    }));
  };

  const handleSaveAgent = async (agentId: string) => {
    setAgents(prev => prev.map(agent => agent.id === agentId ? { ...agent, isSaving: true, saveError: null, saveSuccess: false } : agent));

    const agent = agents.find(item => item.id === agentId);
    if (!agent) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/ai/agents/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          systemPrompt: agent.systemPromptDraft,
          userPrompt: agent.userPromptDraft,
          availableVariables: agent.availableVariablesDraft,
          modelConfigId: agent.modelConfigIdDraft,
          fallbackModelConfigId: agent.fallbackModelConfigIdDraft,
          voice: agent.voiceDraft,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Impossible d'enregistrer l'agent");
      }

      setAgents(prev => prev.map(item => {
        if (item.id !== agentId) {
          return item;
        }
        return {
          ...item,
          systemPrompt: item.systemPromptDraft,
          userPrompt: item.userPromptDraft,
          availableVariables: [...item.availableVariablesDraft],
          modelConfigId: item.modelConfigIdDraft,
          fallbackModelConfigId: item.fallbackModelConfigIdDraft,
          voice: item.voiceDraft,
          isSaving: false,
          saveSuccess: true,
        };
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'enregistrement";
      setAgents(prev => prev.map(item => item.id === agentId ? { ...item, isSaving: false, saveError: message } : item));
    }
  };

  const sortedVariables = useMemo(() => {
    return [...variables].sort((a, b) => a.key.localeCompare(b.key));
  }, [variables]);

  const groupedAgents = useMemo(() => {
    return groupAgents(agents);
  }, [agents]);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const toggleAgent = (agentId: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const toggleModelSection = (modelId: string, section: "agent" | "stt" | "tts") => {
    console.log('[toggleModelSection] Toggling section:', { modelId, section });
    setCollapsedModelSections(prev => {
      const next = new Map(prev);
      const currentSections = next.get(modelId) || new Set(["stt", "tts"]);
      const wasCollapsed = currentSections.has(section);
      console.log('[toggleModelSection] Before toggle:', { modelId, section, wasCollapsed, sections: Array.from(currentSections) });
      
      // Create a new Set to ensure React detects the change
      const newSections = new Set(currentSections);
      if (wasCollapsed) {
        newSections.delete(section);
      } else {
        newSections.add(section);
      }
      
      next.set(modelId, newSections);
      console.log('[toggleModelSection] After toggle:', { modelId, section, isNowCollapsed: newSections.has(section), sections: Array.from(newSections) });
      return next;
    });
  };

  const isModelSectionCollapsed = (modelId: string, section: "agent" | "stt" | "tts"): boolean => {
    return (collapsedModelSections.get(modelId) || new Set(["stt", "tts"])).has(section);
  };

  const isCreateDisabled =
    newAgent.isSaving ||
    newAgent.name.trim().length === 0 ||
    newAgent.systemPrompt.trim().length === 0 ||
    newAgent.userPrompt.trim().length === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuration des agents IA</h1>
          <p className="text-slate-400">Gérez les prompts et l'association aux modèles.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleToggleCreateForm} disabled={newAgent.isSaving}>
            {isCreating ? "Fermer" : "Nouvel agent"}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleExportPrompts}
            disabled={isExportingPrompts}
          >
            {isExportingPrompts ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Export en cours...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Exporter les prompts
              </>
            )}
          </Button>
          <Button onClick={fetchConfiguration} disabled={isLoading}>
            Rafraîchir
          </Button>
        </div>
      </div>

      {exportStatus && (
        <p className={`text-sm ${exportStatus.type === "error" ? "text-destructive" : "text-emerald-600"}`}>
          {exportStatus.message}
        </p>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Erreur de chargement</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
          </CardContent>
        </Card>
      )}

      {isCreating && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle>Nouvel agent IA</CardTitle>
            <CardDescription>Définissez le prompt, les variables et le modèle associé.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-agent-name">Nom</Label>
                <Input
                  id="new-agent-name"
                  placeholder="Agent conversationnel"
                  value={newAgent.name}
                  onChange={event => handleNewAgentNameChange(event.target.value)}
                  disabled={newAgent.isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-agent-slug">Identifiant (slug)</Label>
                <Input
                  id="new-agent-slug"
                  placeholder="agent-conversationnel"
                  value={newAgent.slug}
                  onChange={event => handleNewAgentSlugChange(event.target.value)}
                  disabled={newAgent.isSaving}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-agent-description">Description</Label>
              <AutoResizeTextarea
                id="new-agent-description"
                value={newAgent.description}
                onChange={event => handleNewAgentDescriptionChange(event.target.value)}
                placeholder="Résumé de l'utilisation de cet agent."
                disabled={newAgent.isSaving}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-slate-300">Modèle principal</Label>
                <select
                  className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                  value={newAgent.modelConfigId ?? ''}
                  onChange={event => handleNewAgentModelChange("primary", event.target.value)}
                  disabled={newAgent.isSaving}
                >
                  <option value="">Aucun</option>
                  {models.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.name} — {model.model}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Modèle de secours</Label>
                <select
                  className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                  value={newAgent.fallbackModelConfigId ?? ''}
                  onChange={event => handleNewAgentModelChange("fallback", event.target.value)}
                  disabled={newAgent.isSaving}
                >
                  <option value="">Aucun</option>
                  {models.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.name} — {model.model}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="new-agent-voice"
                  checked={newAgent.voice}
                  onChange={event => setNewAgent(prev => ({ ...prev, voice: event.target.checked }))}
                  disabled={newAgent.isSaving}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-700"
                />
                <Label htmlFor="new-agent-voice" className="cursor-pointer text-slate-200">
                  Agent vocal (utilise voiceAgentProvider du modèle)
                </Label>
              </div>
              <p className="text-xs text-slate-400">
                Si activé, l'agent utilisera le voiceAgentProvider du modèle configuré. Sinon, il utilisera le provider normal (texte/JSON).
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-agent-system" className="text-slate-300">System prompt</Label>
                <AutoResizeTextarea
                  id="new-agent-system"
                  value={newAgent.systemPrompt}
                  onChange={event => handleNewAgentPromptChange("system", event.target.value)}
                  disabled={newAgent.isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-agent-user" className="text-slate-300">User prompt</Label>
                <AutoResizeTextarea
                  id="new-agent-user"
                  value={newAgent.userPrompt}
                  onChange={event => handleNewAgentPromptChange("user", event.target.value)}
                  disabled={newAgent.isSaving}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Variables détectées dans les prompts</Label>
              <CardDescription className="text-xs mb-2">
                Variables automatiquement détectées dans vos templates
              </CardDescription>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const systemVars = extractTemplateVariables(newAgent.systemPrompt);
                  const userVars = extractTemplateVariables(newAgent.userPrompt);
                  const detectedVars = Array.from(new Set([...systemVars, ...userVars]));
                  
                  if (detectedVars.length === 0) {
                    return (
                      <p className="text-xs text-slate-400">
                        Aucune variable détectée. Utilisez {"{{variable}}"} dans vos prompts.
                      </p>
                    );
                  }
                  
                  return detectedVars.map(varKey => (
                    <span
                      key={varKey}
                      className="px-3 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700"
                    >
                      {varKey}
                    </span>
                  ));
                })()}
              </div>
            </div>

            {newAgent.error && (
              <p className="text-sm text-destructive">{newAgent.error}</p>
            )}
            {newAgent.successMessage && (
              <p className="text-sm text-emerald-600">{newAgent.successMessage}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCreateAgent} disabled={isCreateDisabled}>
                {newAgent.isSaving ? "Création en cours..." : "Créer l'agent"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleResetNewAgentForm}
                disabled={newAgent.isSaving}
              >
                Réinitialiser
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Services Section */}
      <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-6 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2">
          <Settings className="h-5 w-5 text-red-400" />
          <h3 className="text-lg font-semibold text-red-400">Services Système</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Workers et services système pour le monitoring et la sécurité.
        </p>
        <div className="space-y-4">
          <div className="rounded-lg border border-red-400/30 p-4 bg-slate-800/50">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-slate-100">Worker de Surveillance Sécurité</h4>
              <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300 border border-red-400/30">
                Worker
              </span>
            </div>
            <p className="text-sm text-slate-400 mb-3">
              Traite la queue de monitoring asynchrone pour analyser les messages et détecter les contenus malveillants.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-red-400/40 bg-red-500/20 text-red-300 hover:bg-red-500/30"
                onClick={async () => {
                  try {
                    const response = await fetch('/api/admin/security/process-queue', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ batchSize: 10 }),
                    });
                    const data = await response.json();
                    if (data.success) {
                      alert(`Queue traitée: ${data.data?.processed || 0} items, ${data.data?.quarantined || 0} profils mis en quarantaine`);
                    } else {
                      alert(`Erreur: ${data.error}`);
                    }
                  } catch (err) {
                    alert(`Erreur: ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
                  }
                }}
              >
                Traiter la queue maintenant
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-500/40 bg-slate-800/50 text-slate-200 hover:bg-slate-700/50"
                onClick={() => window.open('/admin', '_blank')}
              >
                Voir Security Panel
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Graph RAG Section */}
      <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-6 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2">
          <Network className="h-5 w-5 text-cyan-400" />
          <h3 className="text-lg font-semibold text-cyan-400">Graph RAG - Construction du graphe</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Construire le graphe de connaissances pour les insights existants (embeddings, entités, relations).
        </p>
        <div className="space-y-4">
          {isLoadingGraphStats ? (
            <p className="text-sm text-slate-400">Chargement des statistiques...</p>
          ) : graphStats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-slate-600/40 p-3 bg-slate-800/50">
                <p className="text-xs text-slate-400">Total insights</p>
                <p className="text-lg font-semibold text-slate-100">{graphStats.totalInsights}</p>
              </div>
              <div className="rounded-lg border border-slate-600/40 p-3 bg-slate-800/50">
                <p className="text-xs text-slate-400">Avec embeddings</p>
                <p className="text-lg font-semibold text-slate-100">{graphStats.insightsWithEmbeddings}</p>
              </div>
              <div className="rounded-lg border border-slate-600/40 p-3 bg-slate-800/50">
                <p className="text-xs text-slate-400">Avec entités</p>
                <p className="text-lg font-semibold text-slate-100">{graphStats.insightsWithEntities}</p>
              </div>
              <div className="rounded-lg border border-slate-600/40 p-3 bg-slate-800/50">
                <p className="text-xs text-slate-400">Arêtes du graphe</p>
                <p className="text-lg font-semibold text-slate-100">{graphStats.graphEdges}</p>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleBuildGraph}
              disabled={isBuildingGraph}
              className="gap-2 border-cyan-400/40 bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
            >
              {isBuildingGraph ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Construction en cours...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Construire le graphe
                </>
              )}
            </Button>
            <Button
              onClick={loadGraphStats}
              variant="outline"
              disabled={isLoadingGraphStats}
              className="gap-2 border-slate-500/40 bg-slate-800/50 text-slate-200 hover:bg-slate-700/50"
            >
              {isLoadingGraphStats ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Actualiser"
              )}
            </Button>
          </div>

          {graphBuildResult && (
            <p className="text-sm text-emerald-400">{graphBuildResult}</p>
          )}
          {graphBuildError && (
            <p className="text-sm text-red-400">{graphBuildError}</p>
          )}

          <div className="rounded-lg border border-slate-600/40 p-4 bg-slate-800/30">
            <p className="text-xs text-slate-400">
              <strong className="text-slate-300">Note :</strong> Cette opération traite les insights sans embeddings par lots de 100.
              Pour chaque insight, elle génère les embeddings, extrait les entités (mots-clés, concepts, thèmes),
              et construit les arêtes du graphe (similarités, relations conceptuelles, liens aux challenges).
            </p>
          </div>
        </div>
      </div>

      {/* Models Configuration Section */}
      <div className="rounded-xl border border-purple-400/40 bg-purple-500/10 p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-purple-400">Configurations des modèles IA</h3>
            <p className="text-sm text-slate-400">
              Gérez les configurations des modèles, y compris les paramètres Deepgram Voice Agent.
            </p>
          </div>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreatingModel(prev => {
                  if (!prev) {
                    setNewModel({
                      code: '',
                      name: '',
                      provider: 'anthropic',
                      model: '',
                      baseUrl: '',
                      apiKeyEnvVar: '',
                      isDefault: false,
                      isFallback: false,
                      deepgramLlmModel: '',
                      deepgramLlmProvider: '',
                      deepgramSttModel: '',
                      deepgramTtsModel: '',
                      elevenLabsVoiceId: '',
                      elevenLabsModelId: '',
                      enableThinking: false,
                      thinkingBudgetTokens: 10000,
                      isSaving: false,
                      error: null,
                      successMessage: null,
                    });
                  }
                  return !prev;
                });
              }}
              disabled={newModel.isSaving}
            >
              {isCreatingModel ? "Fermer" : "Nouveau"}
            </Button>
          </div>

          {isCreatingModel && (
            <div className="rounded-lg border border-purple-400/30 border-dashed p-4 mb-4 bg-slate-800/50">
              <h4 className="text-md font-semibold text-slate-100 mb-4">Nouveau modèle IA</h4>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-model-code">Code *</Label>
                    <Input
                      id="new-model-code"
                      placeholder="ex: anthropic-claude-sonnet-4-5"
                      value={newModel.code}
                      onChange={(e) => setNewModel(prev => ({ ...prev, code: e.target.value.trim(), error: null }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-model-name">Nom *</Label>
                    <Input
                      id="new-model-name"
                      placeholder="ex: Claude Sonnet 4.5"
                      value={newModel.name}
                      onChange={(e) => setNewModel(prev => ({ ...prev, name: e.target.value.trim(), error: null }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-model-provider">Provider *</Label>
                    <select
                      id="new-model-provider"
                      className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                      value={newModel.provider}
                      onChange={(e) => setNewModel(prev => ({ ...prev, provider: e.target.value, error: null }))}
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="mistral">Mistral</option>
                      <option value="deepgram-voice-agent">Deepgram Voice Agent</option>
                      <option value="speechmatics-voice-agent">Speechmatics Voice Agent</option>
                      <option value="hybrid-voice-agent">Hybrid Voice Agent</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-model-model">Modèle *</Label>
                    <Input
                      id="new-model-model"
                      placeholder="ex: claude-sonnet-4-5"
                      value={newModel.model}
                      onChange={(e) => setNewModel(prev => ({ ...prev, model: e.target.value.trim(), error: null }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-model-base-url">Base URL</Label>
                    <Input
                      id="new-model-base-url"
                      placeholder="ex: https://api.anthropic.com/v1"
                      value={newModel.baseUrl}
                      onChange={(e) => setNewModel(prev => ({ ...prev, baseUrl: e.target.value.trim(), error: null }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-model-api-key-env-var">Variable d'environnement API Key *</Label>
                    <Input
                      id="new-model-api-key-env-var"
                      placeholder="ex: ANTHROPIC_API_KEY"
                      value={newModel.apiKeyEnvVar}
                      onChange={(e) => setNewModel(prev => ({ ...prev, apiKeyEnvVar: e.target.value.trim(), error: null }))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="new-model-is-default"
                      checked={newModel.isDefault}
                      onChange={(e) => setNewModel(prev => ({ ...prev, isDefault: e.target.checked, error: null }))}
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="new-model-is-default" className="cursor-pointer">Modèle par défaut</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="new-model-is-fallback"
                      checked={newModel.isFallback}
                      onChange={(e) => setNewModel(prev => ({ ...prev, isFallback: e.target.checked, error: null }))}
                      className="rounded border-gray-300"
                    />
                    <Label htmlFor="new-model-is-fallback" className="cursor-pointer">Modèle de secours</Label>
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="new-model-enable-thinking"
                      checked={newModel.enableThinking}
                      onChange={(e) =>
                        setNewModel(prev => ({
                          ...prev,
                          enableThinking: e.target.checked,
                          thinkingBudgetTokens: e.target.checked
                            ? prev.thinkingBudgetTokens ?? 10000
                            : prev.thinkingBudgetTokens,
                          error: null,
                        }))
                      }
                      className="rounded border-gray-300"
                    />
                    <div>
                      <Label htmlFor="new-model-enable-thinking" className="cursor-pointer">
                        Activer Claude Extended Thinking
                      </Label>
                      <p className="text-xs text-slate-400">
                        Autorise Claude à raisonner plus longtemps avant de répondre (min 1024 tokens dédiés).
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 md:w-1/2">
                    <Label htmlFor="new-model-thinking-budget">Budget Thinking (tokens)</Label>
                    <Input
                      id="new-model-thinking-budget"
                      type="number"
                      min={1024}
                      step={512}
                      disabled={!newModel.enableThinking}
                      value={newModel.thinkingBudgetTokens ?? 10000}
                      onChange={(e) => {
                        const parsed = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        setNewModel(prev => ({
                          ...prev,
                          thinkingBudgetTokens: Number.isFinite(parsed as number) ? parsed : undefined,
                          error: null,
                        }));
                      }}
                    />
                    <p className="text-xs text-slate-400">
                      Budget disponible pour le raisonnement interne (par défaut 10k tokens).
                    </p>
                  </div>
                </div>
                {newModel.error && (
                  <p className="text-sm text-destructive">{newModel.error}</p>
                )}
                {newModel.successMessage && (
                  <p className="text-sm text-emerald-600">{newModel.successMessage}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      if (!newModel.code || !newModel.name || !newModel.provider || !newModel.model || !newModel.apiKeyEnvVar) {
                        setNewModel(prev => ({ ...prev, error: 'Tous les champs marqués * sont requis' }));
                        return;
                      }
                      
                      setNewModel(prev => ({ ...prev, isSaving: true, error: null, successMessage: null }));
                      
                      try {
                        const response = await fetch('/api/admin/ai/models', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({
                            code: newModel.code,
                            name: newModel.name,
                            provider: newModel.provider,
                            model: newModel.model,
                            baseUrl: newModel.baseUrl || null,
                            apiKeyEnvVar: newModel.apiKeyEnvVar,
                            isDefault: newModel.isDefault,
                            isFallback: newModel.isFallback,
                            deepgramVoiceAgentModel: newModel.deepgramLlmModel || null,
                            deepgramLlmProvider: newModel.deepgramLlmProvider || null,
                            deepgramSttModel: newModel.deepgramSttModel || null,
                            deepgramTtsModel: newModel.deepgramTtsModel || null,
                            elevenLabsVoiceId: newModel.elevenLabsVoiceId || null,
                            elevenLabsModelId: newModel.elevenLabsModelId || null,
                            enableThinking: newModel.enableThinking,
                            thinkingBudgetTokens: newModel.enableThinking
                              ? (newModel.thinkingBudgetTokens ?? 10000)
                              : null,
                          }),
                        });
                        
                        const result = await response.json();
                        
                        if (!response.ok || !result.success) {
                          throw new Error(result.error || 'Impossible de créer le modèle');
                        }
                        
                        // Refresh the models list
                        await fetchConfiguration();
                        
                        setNewModel({
                          code: '',
                          name: '',
                          provider: 'anthropic',
                          model: '',
                          baseUrl: '',
                          apiKeyEnvVar: '',
                          isDefault: false,
                          isFallback: false,
                          deepgramLlmModel: '',
                          deepgramLlmProvider: '',
                          deepgramSttModel: '',
                          deepgramTtsModel: '',
                          elevenLabsVoiceId: '',
                          elevenLabsModelId: '',
                          enableThinking: false,
                          thinkingBudgetTokens: 10000,
                          isSaving: false,
                          error: null,
                          successMessage: `Modèle "${result.data?.name || newModel.name}" créé avec succès.`,
                        });
                        
                        setIsCreatingModel(false);
                      } catch (err) {
                        const message = err instanceof Error ? err.message : 'Erreur lors de la création du modèle';
                        setNewModel(prev => ({ ...prev, isSaving: false, error: message }));
                      }
                    }}
                    disabled={newModel.isSaving || !newModel.code || !newModel.name || !newModel.provider || !newModel.model || !newModel.apiKeyEnvVar}
                  >
                    {newModel.isSaving ? 'Création en cours...' : 'Créer le modèle'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCreatingModel(false);
                      setNewModel({
                        code: '',
                        name: '',
                        provider: 'anthropic',
                        model: '',
                        baseUrl: '',
                        apiKeyEnvVar: '',
                        isDefault: false,
                        isFallback: false,
                        deepgramLlmModel: '',
                        deepgramLlmProvider: '',
                        deepgramSttModel: '',
                        deepgramTtsModel: '',
                        elevenLabsVoiceId: '',
                        elevenLabsModelId: '',
                        enableThinking: false,
                        thinkingBudgetTokens: 10000,
                        isSaving: false,
                        error: null,
                        successMessage: null,
                      });
                    }}
                    disabled={newModel.isSaving}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            </div>
          )}
          {models.length === 0 ? (
            <p className="text-slate-400">Aucun modèle configuré.</p>
          ) : (
            <div className="space-y-4">
              {models.map(model => {
                const isCollapsed = collapsedModels.has(model.id);
                return (
                <div key={model.id} className="rounded-lg border border-purple-400/30 p-4 bg-slate-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-100">{model.name}</h4>
                      <p className="text-sm text-slate-400">
                        {model.code} • {model.provider} • {model.model}
                        {model.isDefault && <span className="ml-2 text-purple-400">(Par défaut)</span>}
                        {model.isFallback && <span className="ml-2 text-slate-500">(Secours)</span>}
                      </p>
                    </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCollapsedModels(prev => {
                            const next = new Set(prev);
                            if (next.has(model.id)) {
                              next.delete(model.id);
                            } else {
                              next.add(model.id);
                            }
                            return next;
                          });
                        }}
                        className="shrink-0"
                      >
                        {isCollapsed ? (
                          <>
                            <ChevronDown className="h-4 w-4 mr-1" />
                            Développer
                          </>
                        ) : (
                          <>
                            <ChevronUp className="h-4 w-4 mr-1" />
                            Réduire
                          </>
                        )}
                      </Button>
                    </div>
                  {!isCollapsed && (
                  <div className="space-y-4 mt-4">
                    {/* Section 1: Agent Principal */}
                    <div className="border border-slate-600/40 rounded-lg overflow-hidden bg-slate-800/30">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleModelSection(model.id, "agent");
                        }}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400/20"
                      >
                        <h4 className="text-sm font-semibold text-slate-100">1. Agent Principal</h4>
                        {isModelSectionCollapsed(model.id, "agent") ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-slate-400" />
                        )}
                      </button>
                      {!isModelSectionCollapsed(model.id, "agent") && (
                        <div className="p-4 pt-0 space-y-4 border-t border-slate-600/40">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label className="text-slate-300">Provider</Label>
                              <Input value={model.provider} disabled className="bg-slate-800/60 border-slate-600/50 text-slate-100" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-slate-300">Modèle</Label>
                              <Input value={model.model} disabled className="bg-slate-800/60 border-slate-600/50 text-slate-100" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-slate-300">Base URL</Label>
                              <Input value={model.baseUrl || ''} disabled className="bg-slate-800/60 border-slate-600/50 text-slate-100" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-slate-300">Variable d'environnement API Key</Label>
                              <Input value={model.apiKeyEnvVar} disabled className="bg-slate-800/60 border-slate-600/50 text-slate-100" />
                            </div>
                          </div>

                          {/* Claude Extended Thinking */}
                          <div className="space-y-3 rounded-lg border border-slate-600/40 p-4 bg-slate-800/30">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`enable-thinking-${model.id}`}
                                checked={model.enableThinkingDraft ?? false}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setModels(prev => prev.map(m =>
                                    m.id === model.id
                                      ? {
                                          ...m,
                                          enableThinkingDraft: checked,
                                          thinkingBudgetTokensDraft: checked
                                            ? (m.thinkingBudgetTokensDraft ?? 10000)
                                            : m.thinkingBudgetTokensDraft,
                                          saveSuccess: false,
                                        }
                                      : m
                                  ));
                                }}
                                className="rounded border-slate-600 bg-slate-700"
                              />
                              <div>
                                <Label htmlFor={`enable-thinking-${model.id}`} className="cursor-pointer text-slate-200">
                                  Activer Claude Extended Thinking
                                </Label>
                                <p className="text-xs text-slate-400">
                                  Permet à Claude de raisonner plus longtemps avant de répondre.
                                </p>
                              </div>
                            </div>
                            <div className="space-y-2 md:w-1/2">
                              <Label htmlFor={`thinking-budget-${model.id}`} className="text-slate-300">Budget Thinking (tokens)</Label>
                              <Input
                                id={`thinking-budget-${model.id}`}
                                type="number"
                                min={1024}
                                step={512}
                                disabled={!model.enableThinkingDraft}
                                className="bg-slate-800/60 border-slate-600/50 text-slate-100"
                                value={
                                  model.enableThinkingDraft
                                    ? (model.thinkingBudgetTokensDraft ?? 10000)
                                    : (model.thinkingBudgetTokensDraft ?? 10000)
                                }
                                onChange={(e) => {
                                  const parsed = e.target.value ? parseInt(e.target.value, 10) : undefined;
                                  setModels(prev => prev.map(m =>
                                    m.id === model.id
                                      ? {
                                          ...m,
                                          thinkingBudgetTokensDraft: Number.isFinite(parsed as number) ? parsed : undefined,
                                          saveSuccess: false,
                                        }
                                      : m
                                  ));
                                }}
                              />
                              <p className="text-xs text-slate-400">
                                Minimum 1024 tokens, valeur recommandée : 10k.
                              </p>
                            </div>
                          </div>

                          {/* Sélecteur Voice Agent Provider */}
                          {/* Afficher pour tous les modèles qui peuvent être utilisés avec un voice agent */}
                          <div className="space-y-2 border-t border-slate-600/40 pt-4">
                            <Label htmlFor={`voice-agent-provider-${model.id}`} className="text-slate-300">
                              Voice Agent Provider
                            </Label>
                            <select
                              id={`voice-agent-provider-${model.id}`}
                              className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                              value={model.voiceAgentProviderDraft || ''}
                              onChange={(e) => {
                                const value = e.target.value as "deepgram-voice-agent" | "speechmatics-voice-agent" | undefined;
                                setModels(prev => prev.map(m => 
                                  m.id === model.id 
                                    ? { ...m, voiceAgentProviderDraft: value, saveSuccess: false }
                                    : m
                                ));
                              }}
                            >
                              <option value="">Aucun</option>
                              <option value="deepgram-voice-agent">Deepgram Voice Agent</option>
                              <option value="speechmatics-voice-agent">Speechmatics Voice Agent</option>
                            </select>
                            <p className="text-xs text-slate-400">
                              Sélectionnez le provider pour le voice agent (Deepgram ou Speechmatics). Utilisé pour déterminer quel agent voice utiliser avec ce modèle.
                            </p>
                          </div>

                          {/* Configuration Deepgram Voice Agent */}
                          {model.voiceAgentProviderDraft === "deepgram-voice-agent" && (
                            <div className="space-y-4 border-t border-slate-600/40 pt-4">
                              <h5 className="text-sm font-semibold text-slate-200">Configuration Deepgram Voice Agent</h5>
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`deepgram-llm-model-${model.id}`} className="text-slate-300">
                                    Modèle LLM Deepgram
                                  </Label>
                                  <Input
                                    id={`deepgram-llm-model-${model.id}`}
                                    placeholder="ex: claude-3-5-haiku-latest, gpt-4o"
                                    className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                    value={model.deepgramLlmModelDraft || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.trim() || undefined;
                                      setModels(prev => prev.map(m =>
                                        m.id === model.id
                                          ? { ...m, deepgramLlmModelDraft: value, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                  />
                                  <p className="text-xs text-slate-400">
                                    Modèle LLM pour Deepgram Voice Agent
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`deepgram-llm-provider-${model.id}`} className="text-slate-300">
                                    Provider LLM Deepgram
                                  </Label>
                                  <select
                                    id={`deepgram-llm-provider-${model.id}`}
                                    className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                                    value={model.deepgramLlmProviderDraft || ''}
                                    onChange={(e) => {
                                      const value = e.target.value || undefined;
                                      setModels(prev => prev.map(m =>
                                        m.id === model.id
                                          ? { ...m, deepgramLlmProviderDraft: (value as "anthropic" | "openai") || undefined, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                  >
                                    <option value="">Aucun</option>
                                    <option value="anthropic">Anthropic</option>
                                    <option value="openai">OpenAI</option>
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`deepgram-stt-model-agent-${model.id}`} className="text-slate-300">
                                    Modèle STT Deepgram
                                  </Label>
                                  <Input
                                    id={`deepgram-stt-model-agent-${model.id}`}
                                    placeholder="ex: nova-2, nova-3"
                                    className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                    value={model.deepgramSttModelDraft || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.trim() || undefined;
                                      setModels(prev => prev.map(m =>
                                        m.id === model.id
                                          ? { ...m, deepgramSttModelDraft: value, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                  />
                                  <p className="text-xs text-slate-400">
                                    Modèle Speech-to-Text Deepgram (ex: nova-2, nova-3)
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`deepgram-tts-model-agent-${model.id}`} className="text-slate-300">
                                    Modèle TTS Deepgram
                                  </Label>
                                  <Input
                                    id={`deepgram-tts-model-agent-${model.id}`}
                                    placeholder="ex: aura-2-thalia-en, aura-2-asteria-en"
                                    className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                    value={model.deepgramTtsModelDraft || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.trim() || undefined;
                                      setModels(prev => prev.map(m =>
                                        m.id === model.id
                                          ? { ...m, deepgramTtsModelDraft: value, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                  />
                                  <p className="text-xs text-slate-400">
                                    Modèle Text-to-Speech Deepgram (ex: aura-2-thalia-en)
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Configuration Speechmatics Voice Agent */}
                          {model.voiceAgentProviderDraft === "speechmatics-voice-agent" && (
                            <div className="space-y-4 border-t border-slate-600/40 pt-4">
                              <h5 className="text-sm font-semibold text-slate-200">Configuration Speechmatics Voice Agent</h5>
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`speechmatics-llm-model-agent-${model.id}`} className="text-slate-300">
                                    Modèle LLM Speechmatics
                                  </Label>
                                  <Input
                                    id={`speechmatics-llm-model-agent-${model.id}`}
                                    placeholder="ex: claude-3-5-haiku-latest, gpt-4o"
                                    className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                    value={model.speechmaticsLlmModelDraft || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.trim() || undefined;
                                      setModels(prev => prev.map(m =>
                                        m.id === model.id
                                          ? { ...m, speechmaticsLlmModelDraft: value, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                  />
                                  <p className="text-xs text-slate-400">
                                    Modèle LLM pour Speechmatics Voice Agent
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`speechmatics-llm-provider-agent-${model.id}`} className="text-slate-300">
                                    Provider LLM Speechmatics
                                  </Label>
                                  <select
                                    id={`speechmatics-llm-provider-agent-${model.id}`}
                                    className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                                    value={model.speechmaticsLlmProviderDraft || ''}
                                    onChange={(e) => {
                                      const value = e.target.value || undefined;
                                      setModels(prev => prev.map(m => 
                                        m.id === model.id 
                                          ? { ...m, speechmaticsLlmProviderDraft: (value as "anthropic" | "openai") || undefined, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                  >
                                    <option value="">Aucun</option>
                                    <option value="anthropic">Anthropic</option>
                                    <option value="openai">OpenAI</option>
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`speechmatics-api-key-env-${model.id}`} className="text-slate-300">
                                    Variable d'environnement API Key Speechmatics
                                  </Label>
                                  <Input
                                    id={`speechmatics-api-key-env-${model.id}`}
                                    placeholder="SPEECHMATICS_API_KEY"
                                    className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                    value={model.speechmaticsApiKeyEnvVarDraft || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.trim() || undefined;
                                      setModels(prev => prev.map(m =>
                                        m.id === model.id
                                          ? { ...m, speechmaticsApiKeyEnvVarDraft: value, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                  />
                                  <p className="text-xs text-slate-400">
                                    Nom de la variable d'environnement pour la clé API Speechmatics
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Section 2: Agent STT Associé */}
                    <div className="border border-slate-600/40 rounded-lg overflow-hidden bg-slate-800/30">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('[STT Button] Clicked for model:', model.id);
                          toggleModelSection(model.id, "stt");
                        }}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400/20"
                      >
                        <h4 className="text-sm font-semibold text-slate-100">2. Agent STT Associé</h4>
                        {isModelSectionCollapsed(model.id, "stt") ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-slate-400" />
                        )}
                      </button>
                      {!isModelSectionCollapsed(model.id, "stt") && (
                        <div className="p-4 pt-0 space-y-4 border-t border-slate-600/40">
                          <div className="space-y-2">
                            <Label htmlFor={`stt-provider-${model.id}`} className="text-slate-300">Provider STT</Label>
                            <select
                              id={`stt-provider-${model.id}`}
                              className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                              value={sttProvider.get(model.id) || "none"}
                              onChange={(e) => {
                                const value = e.target.value as "deepgram" | "speechmatics" | "none";
                                setSttProvider(prev => {
                                  const next = new Map(prev);
                                  next.set(model.id, value);
                                  return next;
                                });
                              }}
                            >
                              <option value="none">Aucun</option>
                              <option value="deepgram">Deepgram</option>
                              <option value="speechmatics">Speechmatics</option>
                            </select>
                          </div>

                          {sttProvider.get(model.id) === "deepgram" && (
                            <div className="space-y-2">
                              <Label htmlFor={`deepgram-stt-${model.id}`} className="text-slate-300">
                                Modèle Speech-to-Text Deepgram
                              </Label>
                              <Input
                                id={`deepgram-stt-${model.id}`}
                                placeholder="ex: nova-2, nova-3"
                                className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                value={model.deepgramSttModelDraft || ''}
                                onChange={(e) => {
                                  const value = e.target.value.trim() || undefined;
                                  setModels(prev => prev.map(m =>
                                    m.id === model.id
                                      ? { ...m, deepgramSttModelDraft: value, saveSuccess: false }
                                      : m
                                  ));
                                }}
                              />
                              <p className="text-xs text-slate-400">
                                Modèles Deepgram STT : nova-2, nova-3 (multilingue)
                              </p>
                            </div>
                          )}

                          {sttProvider.get(model.id) === "speechmatics" && (
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label htmlFor={`speechmatics-stt-language-${model.id}`} className="text-slate-300">
                                  Langue
                                </Label>
                                <Input
                                  id={`speechmatics-stt-language-${model.id}`}
                                  placeholder="ex: fr, en, multi, fr,en"
                                  className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                  value={model.speechmaticsSttLanguageDraft || ''}
                                  onChange={(e) => {
                                    const value = e.target.value.trim() || undefined;
                                    setModels(prev => prev.map(m =>
                                      m.id === model.id
                                        ? { ...m, speechmaticsSttLanguageDraft: value, saveSuccess: false }
                                        : m
                                    ));
                                  }}
                                />
                                <p className="text-xs text-slate-400">
                                  Langue(s) : fr, en, multi, ou fr,en pour code-switching
                                </p>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`speechmatics-stt-operating-point-${model.id}`} className="text-slate-300">
                                  Operating Point
                                </Label>
                                <select
                                  id={`speechmatics-stt-operating-point-${model.id}`}
                                  className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                                  value={model.speechmaticsSttOperatingPointDraft || "enhanced"}
                                  onChange={(e) => {
                                    const value = e.target.value as "enhanced" | "standard" || undefined;
                                    setModels(prev => prev.map(m =>
                                      m.id === model.id
                                        ? { ...m, speechmaticsSttOperatingPointDraft: value, saveSuccess: false }
                                        : m
                                    ));
                                  }}
                                >
                                  <option value="enhanced">Enhanced (plus précis)</option>
                                  <option value="standard">Standard (plus rapide)</option>
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`speechmatics-stt-max-delay-${model.id}`} className="text-slate-300">
                                  Max Delay (secondes)
                                </Label>
                                <Input
                                  id={`speechmatics-stt-max-delay-${model.id}`}
                                  type="number"
                                  step="0.1"
                                  placeholder="2.0"
                                  className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                  value={model.speechmaticsSttMaxDelayDraft || 2.0}
                                  onChange={(e) => {
                                    const value = e.target.value ? parseFloat(e.target.value) : undefined;
                                    setModels(prev => prev.map(m =>
                                      m.id === model.id
                                        ? { ...m, speechmaticsSttMaxDelayDraft: value, saveSuccess: false }
                                        : m
                                    ));
                                  }}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`speechmatics-stt-enable-partials-${model.id}`} className="text-slate-300">
                                  Activer résultats partiels
                                </Label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`speechmatics-stt-enable-partials-${model.id}`}
                                    checked={model.speechmaticsSttEnablePartialsDraft !== false}
                                    onChange={(e) => {
                                      setModels(prev => prev.map(m =>
                                        m.id === model.id
                                          ? { ...m, speechmaticsSttEnablePartialsDraft: e.target.checked, saveSuccess: false }
                                          : m
                                      ));
                                    }}
                                    className="rounded border-slate-600 bg-slate-700"
                                  />
                                  <Label htmlFor={`speechmatics-stt-enable-partials-${model.id}`} className="cursor-pointer text-sm text-slate-300">
                                    Activer les transcriptions intermédiaires
                                  </Label>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Section 3: Agent TTS Associé */}
                    <div className="border border-slate-600/40 rounded-lg overflow-hidden bg-slate-800/30">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('[TTS Button] Clicked for model:', model.id);
                          toggleModelSection(model.id, "tts");
                        }}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400/20"
                      >
                        <h4 className="text-sm font-semibold text-slate-100">3. Agent TTS Associé</h4>
                        {isModelSectionCollapsed(model.id, "tts") ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-slate-400" />
                        )}
                      </button>
                      {!isModelSectionCollapsed(model.id, "tts") && (
                        <div className="p-4 pt-0 space-y-4 border-t border-slate-600/40">
                          <div className="space-y-2">
                            <Label htmlFor={`tts-provider-${model.id}`} className="text-slate-300">Provider TTS</Label>
                            <select
                              id={`tts-provider-${model.id}`}
                              className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                              value={ttsProvider.get(model.id) || "none"}
                              onChange={(e) => {
                                const value = e.target.value as "deepgram" | "elevenlabs" | "none";
                                setTtsProvider(prev => {
                                  const next = new Map(prev);
                                  next.set(model.id, value);
                                  return next;
                                });
                              }}
                            >
                              <option value="none">Aucun</option>
                              <option value="deepgram">Deepgram</option>
                              <option value="elevenlabs">ElevenLabs</option>
                            </select>
                          </div>

                          {ttsProvider.get(model.id) === "deepgram" && (
                            <div className="space-y-2">
                              <Label htmlFor={`deepgram-tts-${model.id}`} className="text-slate-300">
                                Modèle Text-to-Speech Deepgram
                              </Label>
                              <Input
                                id={`deepgram-tts-${model.id}`}
                                placeholder="ex: aura-2-thalia-en, aura-2-asteria-en"
                                className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                value={model.deepgramTtsModelDraft || ''}
                                onChange={(e) => {
                                  const value = e.target.value.trim() || undefined;
                                  setModels(prev => prev.map(m =>
                                    m.id === model.id
                                      ? { ...m, deepgramTtsModelDraft: value, saveSuccess: false }
                                      : m
                                  ));
                                }}
                              />
                              <p className="text-xs text-slate-400">
                                Modèles Deepgram TTS : aura-2-thalia-en, aura-2-asteria-en, etc.
                              </p>
                            </div>
                          )}

                          {ttsProvider.get(model.id) === "elevenlabs" && (
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label htmlFor={`elevenlabs-voice-id-${model.id}`} className="text-slate-300">
                                  Voice ID
                                </Label>
                                <Input
                                  id={`elevenlabs-voice-id-${model.id}`}
                                  placeholder="ex: 21m00Tcm4TlvDq8ikWAM (Rachel)"
                                  className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                                  value={model.elevenLabsVoiceIdDraft || ''}
                                  onChange={(e) => {
                                    const value = e.target.value.trim() || undefined;
                                    setModels(prev => prev.map(m =>
                                      m.id === model.id
                                        ? { ...m, elevenLabsVoiceIdDraft: value, saveSuccess: false }
                                        : m
                                    ));
                                  }}
                                />
                                <p className="text-xs text-slate-400">
                                  ID de la voix ElevenLabs. Consultez le dashboard ElevenLabs pour obtenir les IDs disponibles.
                                </p>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`elevenlabs-model-id-${model.id}`} className="text-slate-300">
                                  Modèle TTS
                                </Label>
                                <select
                                  id={`elevenlabs-model-id-${model.id}`}
                                  className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                                  value={model.elevenLabsModelIdDraft || ''}
                                  onChange={(e) => {
                                    const value = e.target.value || undefined;
                                    setModels(prev => prev.map(m =>
                                      m.id === model.id
                                        ? { ...m, elevenLabsModelIdDraft: value, saveSuccess: false }
                                        : m
                                    ));
                                  }}
                                >
                                  <option value="">Aucun</option>
                                  <option value="eleven_turbo_v2_5">eleven_turbo_v2_5 (Rapide, par défaut)</option>
                                  <option value="eleven_multilingual_v2">eleven_multilingual_v2 (Multilingue)</option>
                                  <option value="eleven_monolingual_v1">eleven_monolingual_v1 (Anglais uniquement)</option>
                                </select>
                                <p className="text-xs text-slate-400">
                                  Modèle de synthèse vocale ElevenLabs.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Bouton Enregistrer */}
                    <div className="flex items-center gap-2 pt-4 border-t border-slate-600/40">
                      <Button
                        onClick={async () => {
                          setModels(prev => prev.map(m => 
                            m.id === model.id 
                              ? { ...m, isSaving: true, saveError: null, saveSuccess: false }
                              : m
                          ));

                          try {
                            const response = await fetch(`/api/admin/ai/models/${model.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({
                                voiceAgentProvider: model.voiceAgentProviderDraft || null,
                                deepgramVoiceAgentModel: model.deepgramLlmModelDraft || null,
                                deepgramLlmProvider: model.deepgramLlmProviderDraft || null,
                                deepgramSttModel: sttProvider.get(model.id) === "deepgram" ? (model.deepgramSttModelDraft || null) : null,
                                deepgramTtsModel: ttsProvider.get(model.id) === "deepgram" ? (model.deepgramTtsModelDraft || null) : null,
                                speechmaticsSttLanguage: sttProvider.get(model.id) === "speechmatics" ? (model.speechmaticsSttLanguageDraft || null) : null,
                                speechmaticsSttOperatingPoint: sttProvider.get(model.id) === "speechmatics" ? (model.speechmaticsSttOperatingPointDraft || null) : null,
                                speechmaticsSttMaxDelay: sttProvider.get(model.id) === "speechmatics" ? (model.speechmaticsSttMaxDelayDraft || null) : null,
                                speechmaticsSttEnablePartials: sttProvider.get(model.id) === "speechmatics" ? (model.speechmaticsSttEnablePartialsDraft !== false) : null,
                                speechmaticsLlmProvider: model.speechmaticsLlmProviderDraft || null,
                                speechmaticsLlmModel: model.speechmaticsLlmModelDraft || null,
                                speechmaticsApiKeyEnvVar: model.speechmaticsApiKeyEnvVarDraft || null,
                                elevenLabsVoiceId: ttsProvider.get(model.id) === "elevenlabs" ? (model.elevenLabsVoiceIdDraft || null) : null,
                                elevenLabsModelId: ttsProvider.get(model.id) === "elevenlabs" ? (model.elevenLabsModelIdDraft || null) : null,
                                enableThinking: model.enableThinkingDraft ?? false,
                                thinkingBudgetTokens: model.enableThinkingDraft
                                  ? (model.thinkingBudgetTokensDraft ?? 10000)
                                  : null,
                              }),
                            });

                            const result = await response.json();
                            
                            if (!response.ok || !result.success) {
                              throw new Error(result.error || 'Failed to save');
                            }

                            // Update saved values
                            setModels(prev => prev.map(m => 
                              m.id === model.id 
                                ? {
                                    ...m,
                                    voiceAgentProvider: m.voiceAgentProviderDraft,
                                    deepgramLlmModel: m.deepgramLlmModelDraft,
                                    deepgramLlmProvider: m.deepgramLlmProviderDraft,
                                    deepgramSttModel: m.deepgramSttModelDraft,
                                    deepgramTtsModel: m.deepgramTtsModelDraft,
                                    speechmaticsSttLanguage: m.speechmaticsSttLanguageDraft,
                                    speechmaticsSttOperatingPoint: m.speechmaticsSttOperatingPointDraft,
                                    speechmaticsSttMaxDelay: m.speechmaticsSttMaxDelayDraft,
                                    speechmaticsSttEnablePartials: m.speechmaticsSttEnablePartialsDraft,
                                    speechmaticsLlmProvider: m.speechmaticsLlmProviderDraft,
                                    speechmaticsLlmModel: m.speechmaticsLlmModelDraft,
                                    speechmaticsApiKeyEnvVar: m.speechmaticsApiKeyEnvVarDraft,
                                    elevenLabsVoiceId: m.elevenLabsVoiceIdDraft,
                                    elevenLabsModelId: m.elevenLabsModelIdDraft,
                                    enableThinking: m.enableThinkingDraft,
                                    thinkingBudgetTokens: m.enableThinkingDraft ? m.thinkingBudgetTokensDraft : undefined,
                                    isSaving: false,
                                    saveSuccess: true,
                                    saveError: null,
                                  }
                                : m
                            ));
                          } catch (err) {
                            const message = err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement';
                            setModels(prev => prev.map(m => 
                              m.id === model.id 
                                ? { ...m, isSaving: false, saveError: message }
                                : m
                            ));
                          }
                        }}
                        disabled={model.isSaving}
                      >
                        {model.isSaving ? 'Enregistrement...' : 'Enregistrer'}
                      </Button>
                      {model.saveError && (
                        <p className="text-sm text-destructive">{model.saveError}</p>
                      )}
                      {model.saveSuccess && (
                        <p className="text-sm text-emerald-400">Modifications enregistrées.</p>
                      )}
                    </div>
                  </div>
                  )}
                </div>
              );
              })}
            </div>
          )}
      </div>

      <div className="space-y-6">
        {isLoading && agents.length === 0 ? (
          <p className="text-slate-400">Chargement des agents...</p>
        ) : agents.length === 0 ? (
          <p className="text-slate-400">Aucun agent configuré pour le moment.</p>
        ) : (
          groupedAgents.map(group => {
            const isCollapsed = collapsedGroups.has(group.key);
            return (
              <Card key={group.key} className={`${group.color.border} ${group.color.bg} border`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <CardTitle className={`flex items-center gap-3 ${group.color.text}`}>
                        {group.title}
                        <span className="text-sm font-normal opacity-70">
                          ({group.agents.length})
                        </span>
                      </CardTitle>
                      <CardDescription className="mt-1">{group.description}</CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleGroup(group.key)}
                      className="shrink-0"
                    >
                      {isCollapsed ? (
                        <>
                          <ChevronDown className="h-4 w-4 mr-1" />
                          Développer
                        </>
                      ) : (
                        <>
                          <ChevronUp className="h-4 w-4 mr-1" />
                          Réduire
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                {!isCollapsed && (
                  <CardContent className="space-y-6">
                    {group.agents.map(agent => {
                      const isAgentCollapsed = collapsedAgents.has(agent.id);
                      return (
                        <Card key={agent.id} className="border-slate-600/40 bg-slate-800/30">
                          <CardHeader>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <CardTitle className="text-lg">{agent.name}</CardTitle>
                                {!isAgentCollapsed && agent.description && (
                                  <CardDescription className="mt-1">{agent.description}</CardDescription>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${group.color.badge} border`}>
                                  {agent.slug}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleAgent(agent.id)}
                                  className="shrink-0"
                                >
                                  {isAgentCollapsed ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronUp className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          {!isAgentCollapsed && (
                            <CardContent className="space-y-6">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Modèle principal</Label>
                              <select
                                className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                                value={agent.modelConfigIdDraft ?? ''}
                                onChange={event => handleModelChange(agent.id, "primary", event.target.value)}
                              >
                                <option value="">Aucun</option>
                                {models.map(model => (
                                  <option key={model.id} value={model.id}>
                                    {model.name} — {model.model}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label>Modèle de secours</Label>
                              <select
                                className="w-full rounded border border-slate-600/50 bg-slate-800/60 px-3 py-2 text-sm text-slate-100"
                                value={agent.fallbackModelConfigIdDraft ?? ''}
                                onChange={event => handleModelChange(agent.id, "fallback", event.target.value)}
                              >
                                <option value="">Aucun</option>
                                {models.map(model => (
                                  <option key={model.id} value={model.id}>
                                    {model.name} — {model.model}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`voice-${agent.id}`}
                                checked={agent.voiceDraft}
                                onChange={event => handleVoiceChange(agent.id, event.target.checked)}
                                className="h-4 w-4 rounded border-slate-600 bg-slate-700"
                              />
                              <Label htmlFor={`voice-${agent.id}`} className="cursor-pointer">
                                Agent vocal (utilise voiceAgentProvider du modèle)
                              </Label>
                            </div>
                            <p className="text-xs text-slate-400">
                              Si activé, l'agent utilisera le voiceAgentProvider du modèle configuré. Sinon, il utilisera le provider normal (texte/JSON).
                            </p>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`system-${agent.id}`} className="text-slate-300">System prompt</Label>
                              <AutoResizeTextarea
                                id={`system-${agent.id}`}
                                value={agent.systemPromptDraft}
                                onChange={event => handlePromptChange(agent.id, "system", event.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`user-${agent.id}`} className="text-slate-300">User prompt</Label>
                              <AutoResizeTextarea
                                id={`user-${agent.id}`}
                                value={agent.userPromptDraft}
                                onChange={event => handlePromptChange(agent.id, "user", event.target.value)}
                              />
                            </div>
                          </div>

                          <div className="space-y-3">
                            <Label>Variables détectées dans les prompts</Label>
                            <CardDescription className="text-xs mb-2">
                              Variables automatiquement détectées dans vos templates system et user prompts
                            </CardDescription>
                            <div className="flex flex-wrap gap-2">
                              {(() => {
                                const systemVars = extractTemplateVariables(agent.systemPromptDraft);
                                const userVars = extractTemplateVariables(agent.userPromptDraft);
                                const detectedVars = Array.from(new Set([...systemVars, ...userVars]));
                                
                                if (detectedVars.length === 0) {
                                  return (
                                    <p className="text-xs text-slate-400">
                                      Aucune variable détectée. Utilisez {"{{variable}}"} dans vos prompts.
                                    </p>
                                  );
                                }
                                
                                return detectedVars.map(varKey => (
                                  <span
                                    key={varKey}
                                    className="px-3 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700"
                                  >
                                    {varKey}
                                  </span>
                                ));
                              })()}
                            </div>
                          </div>

                          <details className="space-y-3">
                            <summary className="cursor-pointer font-medium text-sm">
                              Variables disponibles (toutes)
                            </summary>
                            <CardDescription className="text-xs mb-2">
                              Toutes les variables disponibles dans le système. Insérez-les via {"{{variable}}"}.
                            </CardDescription>
                            <div className="grid gap-3 md:grid-cols-2">
                              {sortedVariables.map(variable => (
                                <div key={variable.key} className="rounded-lg border p-3 bg-slate-800/30">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="font-mono text-sm font-semibold">{variable.key}</p>
                                    {variable.type && (
                                      <span className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-slate-400">
                                        {variable.type}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-400 mt-1">{variable.description}</p>
                                  {variable.example && (
                                    <p className="text-xs text-slate-400/70 mt-1 italic">Ex: {variable.example}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>

                          {agent.saveError && (
                            <p className="text-sm text-destructive">{agent.saveError}</p>
                          )}
                          {agent.saveSuccess && (
                            <p className="text-sm text-emerald-600">Modifications enregistrées.</p>
                          )}

                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleSaveAgent(agent.id)}
                              disabled={agent.isSaving}
                            >
                              {agent.isSaving ? 'Enregistrement...' : 'Enregistrer'}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setTestModeAgentId(agent.id === testModeAgentId ? null : agent.id)}
                            >
                              <TestTube2 className="h-4 w-4 mr-2" />
                              {testModeAgentId === agent.id ? 'Masquer' : 'Mode test'}
                            </Button>
                          </div>

                          {testModeAgentId === agent.id && (
                            <AgentTestMode
                              agentId={agent.id}
                              agentSlug={agent.slug}
                              onClose={() => setTestModeAgentId(null)}
                              colorScheme={group.color}
                            />
                          )}
                            </CardContent>
                          )}
                        </Card>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Ask Prompt Templates Section */}
      <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-6 backdrop-blur-sm mt-8">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-5 w-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-emerald-400">Templates de prompts ASK</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Gérez les templates de prompts système pour les sessions ASK. Les templates peuvent être sélectionnés lors de la création ou modification d'une ASK.
        </p>
        <div className="space-y-4">
          {isLoadingTemplates ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Chargement des templates...</span>
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setIsCreatingTemplate(true);
                    setNewTemplate({ name: "", description: "", systemPrompt: "" });
                  }}
                  disabled={isCreatingTemplate}
                  className="border-emerald-400/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouveau template
                </Button>
              </div>

              {isCreatingTemplate && (
                <div className="rounded-lg border border-emerald-400/30 p-4 bg-slate-800/50">
                  <h4 className="text-md font-semibold text-slate-100 mb-4">Créer un nouveau template</h4>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-template-name" className="text-slate-300">Nom</Label>
                      <Input
                        id="new-template-name"
                        value={newTemplate.name}
                        onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                        placeholder="Nom du template"
                        className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-template-description" className="text-slate-300">Description</Label>
                      <Textarea
                        id="new-template-description"
                        value={newTemplate.description}
                        onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                        placeholder="Description du template (optionnel)"
                        rows={2}
                        className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-template-prompt" className="text-slate-300">System prompt</Label>
                      <Textarea
                        id="new-template-prompt"
                        value={newTemplate.systemPrompt}
                        onChange={(e) => setNewTemplate({ ...newTemplate, systemPrompt: e.target.value })}
                        placeholder="Contenu du prompt système"
                        rows={8}
                        className="bg-slate-800/60 border-slate-600/50 text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={async () => {
                          if (!newTemplate.name || !newTemplate.systemPrompt) {
                            alert("Le nom et le prompt système sont requis");
                            return;
                          }
                          try {
                            const response = await fetch("/api/admin/ask-prompt-templates", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({
                                name: newTemplate.name,
                                description: newTemplate.description || null,
                                systemPrompt: newTemplate.systemPrompt,
                              }),
                            });
                            const data: ApiResponse<AskPromptTemplate> = await response.json();
                            if (data.success) {
                              await fetchTemplates();
                              setIsCreatingTemplate(false);
                              setNewTemplate({ name: "", description: "", systemPrompt: "" });
                            } else {
                              alert(data.error || "Erreur lors de la création");
                            }
                          } catch (err) {
                            alert("Erreur lors de la création du template");
                            console.error(err);
                          }
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Créer
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsCreatingTemplate(false);
                          setNewTemplate({ name: "", description: "", systemPrompt: "" });
                        }}
                        className="border-slate-500/40 bg-slate-800/50 text-slate-200 hover:bg-slate-700/50"
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {templates.length === 0 ? (
                <p className="text-slate-400">Aucun template créé pour le moment.</p>
              ) : (
                <div className="space-y-4">
                  {templates.map((template) => {
                    const draft = templateDrafts.get(template.id) || {
                      name: template.name,
                      description: template.description || "",
                      systemPrompt: template.systemPrompt,
                    };
                    const isEditing = editingTemplateId === template.id;

                    return (
                      <div key={template.id} className="rounded-lg border border-emerald-400/30 p-4 bg-slate-800/50">
                        <div className="space-y-4">
                          {isEditing ? (
                            <>
                              <div className="space-y-2">
                                <Label htmlFor={`template-name-${template.id}`} className="text-slate-300">Nom</Label>
                                <Input
                                  id={`template-name-${template.id}`}
                                  value={draft.name}
                                  onChange={(e) =>
                                    setTemplateDrafts(
                                      new Map(templateDrafts.set(template.id, { ...draft, name: e.target.value }))
                                    )
                                  }
                                  className="bg-slate-800/60 border-slate-600/50 text-slate-100"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`template-description-${template.id}`} className="text-slate-300">Description</Label>
                                <Textarea
                                  id={`template-description-${template.id}`}
                                  value={draft.description}
                                  onChange={(e) =>
                                    setTemplateDrafts(
                                      new Map(templateDrafts.set(template.id, { ...draft, description: e.target.value }))
                                    )
                                  }
                                  rows={2}
                                  className="bg-slate-800/60 border-slate-600/50 text-slate-100"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`template-prompt-${template.id}`} className="text-slate-300">System prompt</Label>
                                <Textarea
                                  id={`template-prompt-${template.id}`}
                                  value={draft.systemPrompt}
                                  onChange={(e) =>
                                    setTemplateDrafts(
                                      new Map(templateDrafts.set(template.id, { ...draft, systemPrompt: e.target.value }))
                                    )
                                  }
                                  rows={8}
                                  className="bg-slate-800/60 border-slate-600/50 text-slate-100"
                                />
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  onClick={async () => {
                                    // Validate before sending
                                    if (!draft.name || !draft.name.trim()) {
                                      alert("Le nom est requis");
                                      return;
                                    }
                                    if (!draft.systemPrompt || !draft.systemPrompt.trim()) {
                                      alert("Le prompt système est requis");
                                      return;
                                    }
                                    
                                    try {
                                      const payload = {
                                        name: draft.name.trim(),
                                        description: draft.description?.trim() || null,
                                        systemPrompt: draft.systemPrompt.trim(),
                                      };
                                      
                                      console.log("Updating template:", template.id, payload);
                                      
                                      const response = await fetch(`/api/admin/ask-prompt-templates/${template.id}`, {
                                        method: "PUT",
                                        headers: { "Content-Type": "application/json" },
                                        credentials: "include",
                                        body: JSON.stringify(payload),
                                      });
                                      
                                      const data: ApiResponse<AskPromptTemplate> = await response.json();
                                      
                                      console.log("Update response:", {
                                        status: response.status,
                                        ok: response.ok,
                                        data,
                                      });
                                      
                                      if (!response.ok) {
                                        console.error("Update failed:", response.status, data);
                                        alert(data.error || `Erreur lors de la mise à jour (${response.status})`);
                                        return;
                                      }
                                      
                                      if (data.success && data.data) {
                                        console.log("Template updated successfully, refreshing list...");
                                        // Update the template in the list immediately
                                        setTemplates(prev => prev.map(t => 
                                          t.id === template.id ? data.data! : t
                                        ));
                                        // Then refresh from server to ensure consistency
                                        await fetchTemplates();
                                        setEditingTemplateId(null);
                                        setTemplateDrafts(new Map());
                                      } else {
                                        console.error("Update failed:", data);
                                        alert(data.error || "Erreur lors de la mise à jour");
                                      }
                                    } catch (err) {
                                      console.error("Error updating template:", err);
                                      alert(`Erreur lors de la mise à jour du template: ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
                                    }
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                  Enregistrer
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setEditingTemplateId(null);
                                    setTemplateDrafts(new Map());
                                  }}
                                  className="border-slate-500/40 bg-slate-800/50 text-slate-200 hover:bg-slate-700/50"
                                >
                                  Annuler
                                </Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h3 className="font-semibold text-lg text-slate-100">{template.name}</h3>
                                  {template.description && (
                                    <p className="text-sm text-slate-400 mt-1">{template.description}</p>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setEditingTemplateId(template.id);
                                      setTemplateDrafts(
                                        new Map([
                                          [
                                            template.id,
                                            {
                                              name: template.name,
                                              description: template.description || "",
                                              systemPrompt: template.systemPrompt,
                                            },
                                          ],
                                        ])
                                      );
                                    }}
                                    className="border-emerald-400/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                  >
                                    <Pencil className="h-4 w-4 mr-1" />
                                    Modifier
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                      if (!confirm(`Êtes-vous sûr de vouloir supprimer le template "${template.name}" ?`)) {
                                        return;
                                      }
                                      try {
                                        const response = await fetch(`/api/admin/ask-prompt-templates/${template.id}`, {
                                          method: "DELETE",
                                          credentials: "include",
                                        });
                                        const data: ApiResponse = await response.json();
                                        if (data.success) {
                                          await fetchTemplates();
                                        } else {
                                          alert(data.error || "Erreur lors de la suppression");
                                        }
                                      } catch (err) {
                                        alert("Erreur lors de la suppression du template");
                                        console.error(err);
                                      }
                                    }}
                                    className="border-slate-500/40 bg-slate-800/50 text-slate-200 hover:bg-slate-700/50"
                                  >
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    Supprimer
                                  </Button>
                                </div>
                              </div>
                              <div className="rounded-lg border border-slate-600/40 bg-slate-900/50 p-3">
                                <Label className="text-xs text-slate-400">System prompt</Label>
                                <pre className="mt-2 text-sm whitespace-pre-wrap font-mono text-slate-300">{template.systemPrompt}</pre>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>
  );
}
