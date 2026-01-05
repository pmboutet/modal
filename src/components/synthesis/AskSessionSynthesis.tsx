"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ConsensusClaim {
  statement: string;
  claimIds: string[];
  supportedBy: string[];
  strength: number;
}

interface Tension {
  claim1: {
    id: string;
    statement: string;
    author: string;
  };
  claim2: {
    id: string;
    statement: string;
    author: string;
  };
  type: "CONTRADICTS";
  confidence: number;
}

interface TopRecommendation {
  id: string;
  statement: string;
  evidenceStrength: number;
  sourceCount: number;
}

interface KeyConcept {
  name: string;
  frequency: number;
}

interface SessionSynthesis {
  askSessionId: string;
  consensus: ConsensusClaim[];
  tensions: Tension[];
  topRecommendations: TopRecommendation[];
  keyConcepts: KeyConcept[];
  totalClaims: number;
  totalParticipants: number;
}

interface AskSessionSynthesisProps {
  askKey: string;
  className?: string;
}

export function AskSessionSynthesis({ askKey, className }: AskSessionSynthesisProps) {
  const [synthesis, setSynthesis] = useState<SessionSynthesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSynthesis() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/ask/${encodeURIComponent(askKey)}/synthesis`);
        const json = await response.json();

        if (!json.success) {
          throw new Error(json.error || "Failed to fetch synthesis");
        }

        setSynthesis(json.data.synthesis);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load synthesis");
      } finally {
        setLoading(false);
      }
    }

    fetchSynthesis();
  }, [askKey]);

  if (loading) {
    return <SynthesisSkeleton className={className} />;
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!synthesis) {
    return null;
  }

  const hasData = synthesis.consensus.length > 0 ||
    synthesis.tensions.length > 0 ||
    synthesis.topRecommendations.length > 0;

  if (!hasData) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">
            Pas encore de données de synthèse. Les claims seront extraits à la fin des entretiens.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Stats Header */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{synthesis.totalClaims} claims</span>
        <span>{synthesis.totalParticipants} participants</span>
      </div>

      {/* Consensus Section */}
      {synthesis.consensus.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="text-lg">🎯</span>
              Consensus
              <Badge variant="secondary" className="ml-auto">
                {synthesis.consensus.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {synthesis.consensus.map((item, index) => (
              <div
                key={index}
                className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-800"
              >
                <p className="font-medium text-emerald-900 dark:text-emerald-100">
                  "{item.statement}"
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.supportedBy.map((name, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Force: {Math.round(item.strength * 100)}%
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tensions Section */}
      {synthesis.tensions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="text-lg">⚡</span>
              Tensions
              <Badge variant="destructive" className="ml-auto">
                {synthesis.tensions.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {synthesis.tensions.map((tension, index) => (
              <div
                key={index}
                className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800"
              >
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {tension.claim1.author}
                    </Badge>
                    <p className="text-sm">"{tension.claim1.statement}"</p>
                  </div>
                  <div className="flex justify-center">
                    <span className="text-red-500 font-bold text-xs">VS</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {tension.claim2.author}
                    </Badge>
                    <p className="text-sm">"{tension.claim2.statement}"</p>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Confiance: {Math.round(tension.confidence * 100)}%
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Top Recommendations Section */}
      {synthesis.topRecommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="text-lg">💡</span>
              Recommandations
              <Badge variant="secondary" className="ml-auto">
                {synthesis.topRecommendations.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {synthesis.topRecommendations.map((rec, index) => (
              <div
                key={rec.id}
                className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800"
              >
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  "{rec.statement}"
                </p>
                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                  <span>Force: {Math.round(rec.evidenceStrength * 100)}%</span>
                  <span>{rec.sourceCount} source{rec.sourceCount > 1 ? "s" : ""}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Key Concepts Section */}
      {synthesis.keyConcepts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="text-lg">📊</span>
              Concepts clés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <div className="flex flex-wrap gap-2">
                {synthesis.keyConcepts.map((concept, index) => (
                  <Tooltip key={index}>
                    <TooltipTrigger>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "cursor-default",
                          concept.frequency >= 5 && "bg-primary text-primary-foreground"
                        )}
                      >
                        #{concept.name}
                        {concept.frequency > 1 && (
                          <span className="ml-1 opacity-70">({concept.frequency})</span>
                        )}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      Mentionné {concept.frequency} fois
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SynthesisSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex gap-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export default AskSessionSynthesis;
