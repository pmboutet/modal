"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Download, Loader2, FileText, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectSynthesis } from "@/types";

interface NarrativeSynthesisPanelProps {
  projectId: string;
  challenges?: Array<{ id: string; name: string }>;
  className?: string;
}

export function NarrativeSynthesisPanel({
  projectId,
  challenges = [],
  className,
}: NarrativeSynthesisPanelProps) {
  const [synthesis, setSynthesis] = useState<ProjectSynthesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string>("");

  const fetchSynthesis = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const url = selectedChallengeId
        ? `/api/project/${projectId}/synthesis?challengeId=${selectedChallengeId}`
        : `/api/project/${projectId}/synthesis`;

      const response = await fetch(url);
      const json = await response.json();

      if (!json.success) {
        throw new Error(json.error || "Failed to fetch synthesis");
      }

      setSynthesis(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedChallengeId]);

  useEffect(() => {
    fetchSynthesis();
  }, [fetchSynthesis]);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setError(null);

      const response = await fetch(`/api/project/${projectId}/synthesis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: selectedChallengeId || null,
        }),
      });

      const json = await response.json();

      if (!json.success) {
        throw new Error(json.error || "Failed to generate synthesis");
      }

      setSynthesis(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la génération");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    const url = selectedChallengeId
      ? `/api/project/${projectId}/synthesis/download?challengeId=${selectedChallengeId}`
      : `/api/project/${projectId}/synthesis/download`;
    window.open(url, "_blank");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return <SynthesisSkeleton className={className} />;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-violet-500" />
            Synthèse Narrative
          </h2>
          {synthesis && (
            <p className="text-sm text-muted-foreground mt-1">
              Générée le {formatDate(synthesis.generatedAt)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Challenge selector */}
          {challenges.length > 0 && (
            <select
              value={selectedChallengeId}
              onChange={(e) => setSelectedChallengeId(e.target.value)}
              className="h-10 px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">Projet entier</option>
              {challenges.map((challenge) => (
                <option key={challenge.id} value={challenge.id}>
                  {challenge.name}
                </option>
              ))}
            </select>
          )}

          {/* Actions */}
          <Button
            onClick={handleGenerate}
            disabled={generating}
            variant={synthesis ? "outline" : "default"}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Génération...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {synthesis ? "Régénérer" : "Générer"}
              </>
            )}
          </Button>

          {synthesis && (
            <Button variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Markdown
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats badges */}
      {synthesis && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {synthesis.metadata.stats.totalClaims} claims
          </Badge>
          <Badge variant="secondary">
            {synthesis.metadata.stats.totalParticipants} participants
          </Badge>
          <Badge variant="secondary">
            {synthesis.metadata.stats.communitiesDetected} thèmes
          </Badge>
          <Badge variant="outline" className="text-emerald-600">
            {Math.round(synthesis.metadata.stats.consensusRate * 100)}% consensus
          </Badge>
          {synthesis.metadata.stats.tensionRate > 0 && (
            <Badge variant="outline" className="text-red-600">
              {Math.round(synthesis.metadata.stats.tensionRate * 100)}% tensions
            </Badge>
          )}
        </div>
      )}

      {/* Content */}
      {synthesis ? (
        <Card>
          <CardContent className="pt-6">
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-table:text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {synthesis.markdownContent}
              </ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState onGenerate={handleGenerate} generating={generating} />
      )}
    </div>
  );
}

function EmptyState({
  onGenerate,
  generating,
}: {
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center py-12">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">Aucune synthèse générée</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Générez une synthèse narrative pour obtenir une vue d&apos;ensemble
            structurée de votre projet : problèmes, découvertes, solutions et
            tensions.
          </p>
          <Button onClick={onGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Générer la synthèse
              </>
            )}
          </Button>
          {generating && (
            <p className="text-sm text-muted-foreground mt-4">
              La génération peut prendre 10 à 30 secondes...
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SynthesisSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex justify-between items-center">
        <div>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32 mt-2" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-6 w-1/2 mt-6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export default NarrativeSynthesisPanel;
