"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, Filter, Link2, MessageSquareQuote, Pencil, Check, X, Loader2, Tags, CheckCircle2, Circle, XCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { InsightPanelProps, Insight, ApiResponse, DiscoveredSubtopic, ConversationPlanStepWithSubtopics } from "@/types";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeDate, getInsightTypeLabel } from "@/lib/utils";

type PanelTab = 'insights' | 'topics';

const insightMarkdownComponents: Components = {
  p: ({ children }) => (
    <p className="mb-1 last:mb-0 text-xs text-slate-800 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-1 list-disc space-y-0.5 pl-4 text-xs text-slate-800 leading-relaxed">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-1 list-decimal space-y-0.5 pl-4 text-xs text-slate-800 leading-relaxed">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-xs text-slate-800 leading-relaxed marker:text-primary">{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-1 border-l-2 border-primary/40 bg-primary/5 px-2 py-1 text-xs italic text-slate-700">
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a
      {...props}
      className="text-xs text-primary underline decoration-primary/60 underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
};

interface InsightGroup {
  label: string;
  value: Insight["type"] | "all";
}

const INSIGHT_GROUPS: InsightGroup[] = [
  { label: "Tous", value: "all" },
  { label: "Pains", value: "pain" },
  { label: "Gains", value: "gain" },
  { label: "Opportunités", value: "opportunity" },
  { label: "Risques", value: "risk" },
  { label: "Signaux", value: "signal" },
  { label: "Idées", value: "idea" }
];

function getInsightTypeBadgeClass(type: Insight["type"]): string {
  const badgeClasses: Record<Insight["type"], string> = {
    idea: "light-badge-idea",
    pain: "light-badge-pain",
    opportunity: "light-badge-opportunity",
    risk: "light-badge-risk",
    signal: "light-badge-signal",
    gain: "light-badge-gain",
  };
  return badgeClasses[type] || "light-badge-signal";
}

function InsightCard({
  insight,
  onLink,
  onUpdate,
  isConsultantMode = false,
  isSpokesperson = false,
}: {
  insight: Insight;
  onLink?: (insightId: string) => void;
  onUpdate?: (insightId: string, newContent: string) => void;
  isConsultantMode?: boolean;
  isSpokesperson?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(insight.content);
  const [isSaving, setIsSaving] = useState(false);

  const authorNames = (insight.authors ?? [])
    .map((author) => (author?.name ?? '').trim())
    .filter((name): name is string => name.length > 0);
  const authorLabel = authorNames.length > 0 ? authorNames.join(', ') : (insight.authorName ?? undefined);
  const categoryLabel = (() => {
    const raw = (insight.category ?? '').trim();
    return raw.length > 0 ? raw : "Analyse IA";
  })();

  const handleStartEdit = () => {
    setEditContent(insight.summary || insight.content || "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditContent(insight.content);
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/insights/${insight.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent.trim() }),
      });

      const result: ApiResponse<{ id: string; content: string; updatedAt: string }> = await response.json();

      if (result.success && result.data) {
        onUpdate?.(insight.id, result.data.content);
        setIsEditing(false);
      } else {
        console.error("Failed to save insight:", result.error);
      }
    } catch (error) {
      console.error("Error saving insight:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      className="light-aurora-insight px-3 py-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getInsightTypeBadgeClass(insight.type)}`}>
              {getInsightTypeLabel(insight.type)}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
              {categoryLabel}
            </span>
            {insight.status !== "new" && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                {insight.status}
              </span>
            )}
          </div>
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[60px] w-full resize-none text-xs leading-relaxed bg-white/90 border-primary/30 focus:border-primary"
                style={{ height: "auto", overflow: "hidden" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${target.scrollHeight}px`;
                }}
                autoFocus
                disabled={isSaving}
              />
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editContent.trim()}
                  title="Enregistrer"
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3 text-emerald-600" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  title="Annuler"
                >
                  <X className="h-3 w-3 text-red-500" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/*
                Display logic:
                - Consultant mode + spokesperson: Show full content (detail)
                - Non-consultant OR consultant but not spokesperson: Show only summary (synthesis)
              */}
              {isConsultantMode && isSpokesperson ? (
                // Consultant sees full detail/description
                insight.content && insight.content.trim() ? (
                  <ReactMarkdown
                    className="space-y-2"
                    components={insightMarkdownComponents}
                  >
                    {insight.content.trim()}
                  </ReactMarkdown>
                ) : insight.summary && insight.summary.trim() ? (
                  <ReactMarkdown
                    className="space-y-2"
                    components={insightMarkdownComponents}
                  >
                    {insight.summary.trim()}
                  </ReactMarkdown>
                ) : null
              ) : (
                // Non-consultant or other participants: Show only synthesis
                insight.summary && insight.summary.trim() ? (
                  <ReactMarkdown
                    className="space-y-2"
                    components={insightMarkdownComponents}
                  >
                    {insight.summary.trim()}
                  </ReactMarkdown>
                ) : insight.content && insight.content.trim() ? (
                  // Fallback to content if no summary available
                  <ReactMarkdown
                    className="space-y-2"
                    components={insightMarkdownComponents}
                  >
                    {insight.content.trim()}
                  </ReactMarkdown>
                ) : null
              )}
            </div>
          )}
          {insight.kpis?.length ? (
            <div className="rounded-md bg-slate-50 px-2 py-1.5">
              <p className="mb-0.5 text-[10px] font-semibold text-slate-600">KPIs associés</p>
              <ul className="space-y-0.5">
                {insight.kpis.map((kpi) => (
                  <li key={kpi.id} className="text-[10px] text-slate-600">
                    <span className="font-medium text-slate-700">{kpi.label}</span>
                    {kpi.description && <span className="text-slate-500"> — {kpi.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
            {authorLabel && <span>Partagé par {authorLabel}</span>}
            <span>{formatRelativeDate(insight.createdAt)}</span>
            {insight.relatedChallengeIds?.length ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-600">
                <Lightbulb className="h-2.5 w-2.5" />
                {insight.relatedChallengeIds.length} challenge(s)
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {!isEditing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleStartEdit}
              title="Modifier l'insight"
            >
              <Pencil className="h-3 w-3 text-slate-500 hover:text-primary" />
            </Button>
          )}
          {onLink && !isEditing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onLink(insight.id)}
              title="Associer à un challenge"
            >
              <Link2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Subtopic item with status indicator
 */
function SubtopicItem({ subtopic, stepNumber, stepTitle }: {
  subtopic: DiscoveredSubtopic;
  stepNumber: number;
  stepTitle: string;
}) {
  const statusIcon = subtopic.status === 'explored'
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    : subtopic.status === 'skipped'
    ? <XCircle className="h-3.5 w-3.5 text-slate-400" />
    : <Circle className="h-3.5 w-3.5 text-amber-500" />;

  const priorityBadge = subtopic.priority === 'high'
    ? "bg-red-100 text-red-700 border-red-200"
    : subtopic.priority === 'low'
    ? "bg-slate-100 text-slate-600 border-slate-200"
    : "bg-amber-100 text-amber-700 border-amber-200";

  const statusClass = subtopic.status === 'skipped' ? "opacity-60 line-through" : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-start gap-2 px-3 py-2 rounded-lg bg-white/80 border border-slate-200", statusClass)}
    >
      <div className="mt-0.5 shrink-0">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-800 leading-relaxed">{subtopic.label}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium border", priorityBadge)}>
            {subtopic.priority === 'high' ? 'Haute' : subtopic.priority === 'low' ? 'Basse' : 'Moyenne'}
          </span>
          <span className="text-[9px] text-slate-500">
            Étape {stepNumber}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Topics tab content - displays discovered subtopics grouped by step
 */
function TopicsTab({ steps }: { steps?: ConversationPlanStepWithSubtopics[] }) {
  // Extract all subtopics with their step context
  const subtopicsByStep = useMemo(() => {
    if (!steps || steps.length === 0) return [];

    return steps
      .map((step, index) => ({
        stepNumber: index + 1,
        stepTitle: step.title,
        stepStatus: step.status,
        subtopics: step.discovered_subtopics ?? [],
      }))
      .filter(s => s.subtopics.length > 0);
  }, [steps]);

  // Count stats
  const stats = useMemo(() => {
    const all = subtopicsByStep.flatMap(s => s.subtopics);
    return {
      total: all.length,
      pending: all.filter(st => st.status === 'pending').length,
      explored: all.filter(st => st.status === 'explored').length,
      skipped: all.filter(st => st.status === 'skipped').length,
    };
  }, [subtopicsByStep]);

  if (subtopicsByStep.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 bg-white/70 py-6 text-center">
        <Tags className="h-6 w-6 text-slate-400" />
        <p className="text-xs text-slate-500">Aucun topic découvert pour le moment.</p>
        <p className="text-[10px] text-slate-400">Les topics apparaîtront au fil de la conversation.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats summary */}
      <div className="flex flex-wrap gap-2 text-[10px]">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
          Total: {stats.total}
        </span>
        {stats.pending > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            <Circle className="h-2.5 w-2.5" /> En attente: {stats.pending}
          </span>
        )}
        {stats.explored > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-2.5 w-2.5" /> Explorés: {stats.explored}
          </span>
        )}
      </div>

      {/* Subtopics grouped by step */}
      {subtopicsByStep.map(({ stepNumber, stepTitle, subtopics }) => (
        <div key={stepNumber} className="space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            Étape {stepNumber}: {stepTitle}
          </p>
          <div className="space-y-1.5">
            {subtopics.map((subtopic) => (
              <SubtopicItem
                key={subtopic.id}
                subtopic={subtopic}
                stepNumber={stepNumber}
                stepTitle={stepTitle}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InsightPanel({
  insights,
  askKey,
  onRequestChallengeLink,
  onInsightUpdate,
  isDetectingInsights = false,
  isConsultantMode = false,
  isSpokesperson = false,
  conversationPlan,
}: InsightPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('insights');
  const [activeFilter, setActiveFilter] = useState<InsightGroup["value"]>("all");

  // Count topics for tab badge
  const topicsCount = useMemo(() => {
    if (!conversationPlan?.steps) return 0;
    return conversationPlan.steps.reduce((count, step) => {
      return count + (step.discovered_subtopics?.length ?? 0);
    }, 0);
  }, [conversationPlan]);

  const filteredInsights = useMemo(() => {
    if (activeFilter === "all") {
      return insights;
    }
    return insights.filter((insight) => insight.type === activeFilter);
  }, [activeFilter, insights]);

  return (
    <Card className="h-full light-aurora-card flex flex-col overflow-hidden border-0">
      <CardHeader className="flex flex-col gap-2 pb-2 pt-3">
        {/* Tab navigation */}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('insights')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              activeTab === 'insights'
                ? "bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-sm"
                : "bg-white/80 text-slate-600 hover:bg-slate-100 border border-slate-200"
            )}
          >
            <MessageSquareQuote className="h-3.5 w-3.5" />
            Insights
            {insights.length > 0 && (
              <span className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px]",
                activeTab === 'insights' ? "bg-white/30" : "bg-teal-100 text-teal-700"
              )}>
                {insights.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('topics')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              activeTab === 'topics'
                ? "bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-sm"
                : "bg-white/80 text-slate-600 hover:bg-slate-100 border border-slate-200"
            )}
          >
            <Tags className="h-3.5 w-3.5" />
            Topics
            {topicsCount > 0 && (
              <span className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px]",
                activeTab === 'topics' ? "bg-white/30" : "bg-amber-100 text-amber-700"
              )}>
                {topicsCount}
              </span>
            )}
          </button>
        </div>

        {/* Subtitle based on active tab */}
        <p className="text-xs text-slate-500">
          {activeTab === 'insights'
            ? `${filteredInsights.length} insight(s) pour la session ${askKey}`
            : `${topicsCount} topic(s) découvert(s)`
          }
        </p>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col overflow-hidden pt-2">
        {activeTab === 'insights' ? (
          <>
            {/* Insight filters */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {INSIGHT_GROUPS.map((group) => (
                <button
                  key={group.value}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    activeFilter === group.value
                      ? "border-teal-500 bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-sm"
                      : "border-slate-200 bg-white/80 text-slate-600 hover:border-teal-400 hover:text-teal-700"
                  )}
                  onClick={() => setActiveFilter(group.value)}
                >
                  {group.label}
                </button>
              ))}
            </div>

            {/* Insights list */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <AnimatePresence initial={false}>
                {filteredInsights.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 bg-white/70 py-6 text-center"
                  >
                    <Lightbulb className="h-6 w-6 text-slate-400" />
                    <p className="text-xs text-slate-500">Aucun insight à afficher pour ce filtre.</p>
                  </motion.div>
                ) : (
                  filteredInsights.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} onLink={onRequestChallengeLink} onUpdate={onInsightUpdate} isConsultantMode={isConsultantMode} isSpokesperson={isSpokesperson} />
                  ))
                )}
              </AnimatePresence>

              {/* Indicateur de collecte d'insights en cours */}
              <AnimatePresence>
                {isDetectingInsights && (
                  <motion.div
                    key="insight-detection-indicator"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-teal-700 bg-teal-50 rounded-lg border border-teal-200"
                    aria-live="polite"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="flex h-2.5 w-2.5 items-center justify-center"
                    >
                      <Lightbulb className="h-2.5 w-2.5 text-teal-600" />
                    </motion.div>
                    <span className="italic">Collecte d'insights en cours...</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          /* Topics tab */
          <div className="flex-1 overflow-y-auto pr-1">
            <TopicsTab steps={conversationPlan?.steps} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
