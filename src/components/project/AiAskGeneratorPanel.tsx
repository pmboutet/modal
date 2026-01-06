"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Lightbulb,
  Loader2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AiAskSuggestion } from "@/types";
import { cn } from "@/lib/utils";

interface PanelFeedback {
  type: "success" | "error";
  message: string;
}

interface AiAskGeneratorPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  challengeTitle: string;
  isRunning: boolean;
  onRunAgain: () => void;
  suggestions: AiAskSuggestion[];
  feedback: PanelFeedback | null;
  errors?: string[] | null;
  onApplySuggestion: (suggestion: AiAskSuggestion, index: number) => void;
  onDismissSuggestion: (index: number) => void;
}

function formatParticipantList(suggestion: AiAskSuggestion): string {
  if (!suggestion.recommendedParticipants?.length) {
    return "";
  }

  return suggestion.recommendedParticipants
    .map(participant => {
      const base = participant.name;
      if (participant.role && participant.role.trim().length > 0) {
        return `${base} (${participant.role})`;
      }
      return base;
    })
    .join(", ");
}

function buildDescriptionPreview(suggestion: AiAskSuggestion): string {
  const parts: string[] = [];
  if (suggestion.summary) {
    parts.push(suggestion.summary);
  }
  if (suggestion.objective && suggestion.objective !== suggestion.summary) {
    parts.push(suggestion.objective);
  }
  if (suggestion.description) {
    parts.push(suggestion.description);
  }
  return parts.join("\n\n");
}

function AskSuggestionCard({
  suggestion,
  index,
  onApply,
  onDismiss,
}: {
  suggestion: AiAskSuggestion;
  index: number;
  onApply: (suggestion: AiAskSuggestion, index: number) => void;
  onDismiss: (index: number) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }
      await navigator.clipboard.writeText(suggestion.question);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Unable to copy question", error);
    }
  }, [suggestion.question]);

  const descriptionPreview = useMemo(() => buildDescriptionPreview(suggestion), [suggestion]);
  const participantList = useMemo(() => formatParticipantList(suggestion), [suggestion]);

  return (
    <div className="space-y-4 rounded-lg border border-white/10 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-white">{suggestion.title}</h3>
          {suggestion.urgency ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                suggestion.urgency === "critical"
                  ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
                  : suggestion.urgency === "high"
                    ? "border-orange-400/40 bg-orange-500/10 text-orange-200"
                    : suggestion.urgency === "medium"
                      ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                      : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Urgency: {suggestion.urgency}
            </span>
          ) : null}
          {suggestion.confidence ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-xs font-medium text-slate-100">
              <Check className="h-3.5 w-3.5" /> Confidence: {suggestion.confidence}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="glassDark" onClick={handleCopy} className="gap-1">
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy question"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDismiss(index)} className="gap-1 text-slate-300">
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">ASK question</p>
          <Textarea readOnly value={suggestion.question} className="mt-2 h-24 resize-none bg-slate-950/60 text-white" />
        </div>

        {descriptionPreview ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Context</p>
            <p className="whitespace-pre-line text-sm text-slate-200">{descriptionPreview}</p>
          </div>
        ) : null}

        {participantList ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-200">
              <Users className="h-3.5 w-3.5" /> Participants suggérés
            </span>
            <span>{participantList}</span>
          </div>
        ) : null}

        {suggestion.relatedInsights?.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Insights mobilisés</p>
            <div className="space-y-2">
              {suggestion.relatedInsights.map(reference => (
                <div
                  key={reference.insightId}
                  className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Lightbulb className="h-3.5 w-3.5" /> Insight {reference.insightId}
                    </span>
                    {reference.priority ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                        <Clock className="h-3 w-3" /> Priority: {reference.priority}
                      </span>
                    ) : null}
                  </div>
                  {reference.title ? (
                    <p className="mt-1 text-sm font-medium text-white">{reference.title}</p>
                  ) : null}
                  {reference.reason ? (
                    <p className="mt-1 text-sm text-slate-300">{reference.reason}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {suggestion.followUpActions?.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actions recommandées</p>
            <ul className="space-y-1 text-sm text-slate-200">
              {suggestion.followUpActions.map((action, actionIndex) => (
                <li key={`${suggestion.referenceId ?? suggestion.title}-action-${actionIndex}`} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          {suggestion.maxParticipants ? <div>Capacité recommandée: {suggestion.maxParticipants} participants</div> : null}
          {typeof suggestion.allowAutoRegistration === "boolean" ? (
            <div>Auto-inscription: {suggestion.allowAutoRegistration ? "oui" : "non"}</div>
          ) : null}
          {suggestion.deliveryMode ? <div>Livraison: {suggestion.deliveryMode}</div> : null}
          {suggestion.conversationMode ? (
            <div>
              Mode: {
                suggestion.conversationMode === "individual_parallel" ? "Réponses individuelles" :
                suggestion.conversationMode === "collaborative" ? "Conversation collaborative" :
                "Groupe avec rapporteur"
              }
            </div>
          ) : null}
        </div>
        <Button onClick={() => onApply(suggestion, index)} className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
          <Sparkles className="h-4 w-4" /> Utiliser cette suggestion
        </Button>
      </div>
    </div>
  );
}

export function AiAskGeneratorPanel({
  open,
  onOpenChange,
  challengeTitle,
  isRunning,
  onRunAgain,
  suggestions,
  feedback,
  errors,
  onApplySuggestion,
  onDismissSuggestion,
}: AiAskGeneratorPanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-950/70 backdrop-blur" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-white/10 bg-slate-950/95 shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-white/5 p-6">
            <div>
              <Dialog.Title className="text-xl font-semibold text-white">
                AI-generated ASKs for "{challengeTitle}"
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-slate-300">
                Explore the proposed ASK sessions to investigate or resolve this challenge. Apply a suggestion to pre-fill the creation form and refine it before publishing.
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-slate-300 hover:text-white"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Sparkles className="h-4 w-4 text-indigo-300" />
                {isRunning ? "Analyzing challenge context with AI..." : "Review the AI proposals and apply the ones that fit."}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={onRunAgain}
                className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400"
                disabled={isRunning}
              >
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isRunning ? "Generating" : "Run again"}
              </Button>
            </div>

            {feedback ? (
              <Alert variant={feedback.type === "success" ? "default" : "destructive"} className="mb-6">
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            ) : null}

            {errors?.length ? (
              <div className="mb-6 space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
                <p className="font-semibold">Agent warnings</p>
                <ul className="list-inside list-disc space-y-1">
                  {errors.map((message, index) => (
                    <li key={`ask-generator-error-${index}`}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {isRunning ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-white/10 bg-slate-900/60">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-300" />
              </div>
            ) : suggestions.length === 0 ? (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-white/10 bg-slate-900/60 text-center text-sm text-slate-300">
                <Sparkles className="h-6 w-6 text-indigo-300" />
                No AI suggestions are available yet. Launch the generator to receive tailored ASK proposals.
              </div>
            ) : (
              <div className="space-y-4">
                {suggestions.map((suggestion, index) => (
                  <AskSuggestionCard
                    key={suggestion.referenceId ?? `${suggestion.title}-${index}`}
                    suggestion={suggestion}
                    index={index}
                    onApply={onApplySuggestion}
                    onDismiss={onDismissSuggestion}
                  />
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
