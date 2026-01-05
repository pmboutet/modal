"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Sparkles, Loader2, ArrowLeft, RefreshCw, Search, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ApiResponse } from "@/types";
import { useRouter } from "next/navigation";
import { ProjectGraphVisualization } from "@/components/graph/ProjectGraphVisualization";
import { NarrativeSynthesisPanel } from "@/components/synthesis/NarrativeSynthesisPanel";

interface Synthesis {
  id: string;
  synthesized_text: string;
  source_insight_ids: string[];
  key_concepts: string[];
  created_at: string;
}

interface Challenge {
  id: string;
  name: string;
}

interface SynthesisPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default function SynthesisPage({ params }: SynthesisPageProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [syntheses, setSyntheses] = useState<Synthesis[]>([]);
  const [filteredSyntheses, setFilteredSyntheses] = useState<Synthesis[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<{ type: 'success' | 'warning'; text: string } | null>(null);
  const refreshSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const generateMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    params.then(({ projectId }) => {
      setProjectId(projectId);
    });
  }, [params]);

  // Fetch challenges for the project
  const loadChallenges = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/admin/projects/${projectId}/challenges`);
      const data: ApiResponse<Challenge[]> = await response.json();
      if (data.success && data.data) {
        setChallenges(data.data.map(c => ({ id: c.id, name: c.name })));
      }
    } catch (err) {
      console.error("Failed to load challenges:", err);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      loadChallenges();
    }
  }, [projectId, loadChallenges]);

  const loadSyntheses = useCallback(async (showSuccessIndicator = false) => {
    if (!projectId) return;

    setIsLoading(true);
    setError(null);
    setRefreshSuccess(false);

    // Clear any existing timeout
    if (refreshSuccessTimeoutRef.current) {
      clearTimeout(refreshSuccessTimeoutRef.current);
    }

    try {
      const response = await fetch(`/api/admin/graph/synthesis/${projectId}`);
      const data: ApiResponse<Synthesis[]> = await response.json();

      if (data.success && data.data) {
        setSyntheses(data.data);
        setFilteredSyntheses(data.data);

        // Show success indicator for manual refreshes
        if (showSuccessIndicator) {
          setRefreshSuccess(true);
          refreshSuccessTimeoutRef.current = setTimeout(() => {
            setRefreshSuccess(false);
          }, 2000);
        }
      } else {
        setError(data.error || "Failed to load syntheses");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load syntheses");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Filter syntheses based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredSyntheses(syntheses);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = syntheses.filter((synthesis) => {
      return (
        synthesis.synthesized_text.toLowerCase().includes(query) ||
        synthesis.key_concepts.some((concept) => concept.toLowerCase().includes(query))
      );
    });
    setFilteredSyntheses(filtered);
  }, [searchQuery, syntheses]);

  const generateSyntheses = useCallback(async () => {
    if (!projectId) return;

    setIsGenerating(true);
    setError(null);
    setGenerateMessage(null);

    // Clear any existing timeout
    if (generateMessageTimeoutRef.current) {
      clearTimeout(generateMessageTimeoutRef.current);
    }

    try {
      const response = await fetch(`/api/admin/graph/synthesis/${projectId}`, {
        method: "POST",
      });
      const data: ApiResponse<Synthesis[]> = await response.json();

      if (data.success && data.data) {
        setSyntheses(data.data);
        setFilteredSyntheses(data.data);

        // Show feedback based on results
        if (data.data.length === 0) {
          setGenerateMessage({
            type: 'warning',
            text: 'Aucune synthèse générée. Il faut au moins 3 insights liés dans le graphe de connaissances.'
          });
        } else {
          setGenerateMessage({
            type: 'success',
            text: `${data.data.length} synthèse${data.data.length > 1 ? 's' : ''} générée${data.data.length > 1 ? 's' : ''} avec succès.`
          });
        }

        // Clear message after 5 seconds
        generateMessageTimeoutRef.current = setTimeout(() => {
          setGenerateMessage(null);
        }, 5000);
      } else {
        setError(data.error || "Failed to generate syntheses");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate syntheses");
    } finally {
      setIsGenerating(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      loadSyntheses();
    }
  }, [projectId, loadSyntheses]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (refreshSuccessTimeoutRef.current) {
        clearTimeout(refreshSuccessTimeoutRef.current);
      }
      if (generateMessageTimeoutRef.current) {
        clearTimeout(generateMessageTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => {
                window.close();
                // Fallback if window.close() doesn't work
                setTimeout(() => {
                  router.push('/admin');
                }, 100);
              }}
              className="gap-2 text-slate-300 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Retour
            </Button>
            <div className="flex items-center gap-3">
              <Sparkles className="h-8 w-8 text-purple-400" />
              <h1 className="text-3xl font-bold text-white">Synthèses d'insights</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={generateSyntheses}
              disabled={isGenerating || isLoading}
              className="gap-2 bg-purple-600 hover:bg-purple-700"
            >
              <Sparkles className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
              {isGenerating ? 'Génération...' : 'Générer synthèses'}
            </Button>
            <Button
              onClick={() => loadSyntheses(true)}
              disabled={isLoading || isGenerating}
              variant="outline"
              className={`gap-2 ${refreshSuccess ? 'border-green-500 text-green-400' : ''}`}
            >
              {refreshSuccess ? (
                <Check className="h-4 w-4 text-green-400" />
              ) : (
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              )}
              {refreshSuccess ? 'Actualisé' : 'Rafraîchir'}
            </Button>
          </div>
        </div>

        {/* Generate Message */}
        {generateMessage && (
          <div className={`flex items-center gap-3 rounded-xl border p-4 ${
            generateMessage.type === 'warning'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-green-500/30 bg-green-500/10 text-green-300'
          }`}>
            {generateMessage.type === 'warning' ? (
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            ) : (
              <Check className="h-5 w-5 flex-shrink-0" />
            )}
            <p className="text-sm">{generateMessage.text}</p>
          </div>
        )}

        {/* Narrative Synthesis Panel */}
        {projectId && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <NarrativeSynthesisPanel
              projectId={projectId}
              challenges={challenges}
            />
          </div>
        )}

        {/* Graph Visualization */}
        <ProjectGraphVisualization projectId={projectId} />

        {/* Search Bar */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <Search className="h-5 w-5 text-slate-400" />
            <Input
              type="text"
              placeholder="Rechercher dans les synthèses ou les concepts clés..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 border-white/10 bg-slate-800/50 text-white placeholder:text-slate-500"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                onClick={() => setSearchQuery("")}
                className="text-slate-400 hover:text-white"
              >
                Effacer
              </Button>
            )}
          </div>
          {searchQuery && (
            <p className="mt-2 text-sm text-slate-400">
              {filteredSyntheses.length} résultat{filteredSyntheses.length !== 1 ? 's' : ''} trouvé{filteredSyntheses.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : filteredSyntheses.length > 0 ? (
            <div className="space-y-6">
              {filteredSyntheses.map((synthesis, index) => (
                <div
                  key={synthesis.id}
                  className="rounded-2xl border border-white/10 bg-slate-800/50 p-6 transition-all hover:border-purple-400/30 hover:bg-slate-800/70"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-purple-500/20 px-3 py-1 text-sm font-medium text-purple-300">
                        Synthèse {index + 1}
                      </span>
                    </div>
                    <span className="text-sm text-slate-400">
                      {new Date(synthesis.created_at).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <p className="mb-4 text-base leading-relaxed text-slate-200">
                    {synthesis.synthesized_text}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 border-t border-white/10 pt-4">
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span className="font-medium">Insights sources:</span>
                      <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-blue-300">
                        {synthesis.source_insight_ids.length}
                      </span>
                    </div>
                    {synthesis.key_concepts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-400">Concepts clés:</span>
                        {synthesis.key_concepts.map((concept, idx) => (
                          <span
                            key={idx}
                            className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300"
                          >
                            {concept}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : searchQuery && syntheses.length > 0 ? (
            <div className="py-16 text-center">
              <Search className="mx-auto mb-4 h-16 w-16 text-slate-600" />
              <p className="text-lg text-slate-400">
                Aucun résultat pour "{searchQuery}"
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Essayez avec d'autres mots-clés ou concepts.
              </p>
            </div>
          ) : (
            <div className="py-16 text-center">
              <Sparkles className="mx-auto mb-4 h-16 w-16 text-slate-600" />
              <p className="text-lg text-slate-400">
                Aucune synthèse disponible pour ce projet.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Les synthèses seront générées automatiquement à partir des insights du projet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
