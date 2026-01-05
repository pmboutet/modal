"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { forceCollide } from "d3-force";
import {
  Loader2,
  Maximize2,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";

// Dynamically import ForceGraph2D to avoid SSR issues
const ForceGraph2D = dynamic(
  async () => {
    const THREE = await import("three");
    if (typeof window !== "undefined") {
      if (!(window as any).THREE) {
        (window as any).THREE = Object.assign({}, THREE);
        Object.setPrototypeOf((window as any).THREE, THREE);
      }
      if (!(window as any).AFRAME) {
        (window as any).AFRAME = {
          registerComponent: () => {},
          registerSystem: () => {},
          registerGeometry: () => {},
          registerPrimitive: () => {},
          registerShader: () => {},
          components: {},
          systems: {},
          geometries: {},
          primitives: {},
          shaders: {},
          utils: { device: {}, coordinates: {} },
        };
      }
    }
    return import("react-force-graph").then((mod) => mod.ForceGraph2D);
  },
  { ssr: false }
);

// ============================================================================
// TYPES
// ============================================================================

interface ClaimNode {
  id: string;
  name: string;
  label: string;
  subtitle?: string;
  claimType: string;
  evidenceStrength: number;
  sourceCount: number;
  color: string;
  size: number;
  x?: number;
  y?: number;
  community?: number;
}

interface ClaimLink {
  source: string | ClaimNode;
  target: string | ClaimNode;
  type: "SUPPORTS" | "CONTRADICTS";
  confidence: number;
  color: string;
  width: number;
}

interface ClaimsGraphData {
  nodes: ClaimNode[];
  links: ClaimLink[];
}

// ============================================================================
// COLORS
// ============================================================================

const CLAIM_TYPE_COLORS: Record<string, { fill: string; solid: string }> = {
  finding: { fill: "rgba(59, 130, 246, 0.9)", solid: "#3B82F6" },      // blue
  hypothesis: { fill: "rgba(168, 85, 247, 0.9)", solid: "#A855F7" },   // purple
  recommendation: { fill: "rgba(245, 158, 11, 0.9)", solid: "#F59E0B" }, // amber
  observation: { fill: "rgba(107, 114, 128, 0.9)", solid: "#6B7280" }, // gray
  default: { fill: "rgba(16, 185, 129, 0.9)", solid: "#10B981" },      // emerald
};

const EDGE_COLORS = {
  SUPPORTS: "rgba(16, 185, 129, 0.7)",     // green
  CONTRADICTS: "rgba(239, 68, 68, 0.7)",   // red
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  finding: "Constat",
  hypothesis: "Hypothèse",
  recommendation: "Recommandation",
  observation: "Observation",
};

// ============================================================================
// COMPONENT
// ============================================================================

interface ClaimsGraphViewProps {
  projectId: string;
  className?: string;
  height?: number;
  onClaimSelect?: (claimId: string) => void;
}

export function ClaimsGraphView({
  projectId,
  className,
  height = 400,
  onClaimSelect,
}: ClaimsGraphViewProps) {
  const [graphData, setGraphData] = useState<ClaimsGraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<ClaimNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<ClaimNode | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Track container width
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    resizeObserver.observe(containerRef.current);
    setContainerWidth(containerRef.current.offsetWidth || 600);
    return () => resizeObserver.disconnect();
  }, []);

  // Load graph data
  useEffect(() => {
    async function loadData() {
      if (!projectId) return;

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/admin/graph/visualization?projectId=${projectId}&mode=claims&includeAnalytics=true`
        );
        const data: ApiResponse<{
          nodes: Array<{
            id: string;
            label: string;
            subtitle?: string;
            meta?: { claimType?: string; evidenceStrength?: number; sourceCount?: number };
            community?: number;
          }>;
          edges: Array<{
            source: string;
            target: string;
            relationshipType: string;
            confidence?: number;
          }>;
        }> = await response.json();

        if (!data.success || !data.data) {
          throw new Error(data.error || "Failed to load claims graph");
        }

        // Transform to internal format
        const nodes: ClaimNode[] = data.data.nodes.map((node) => {
          const claimType = node.meta?.claimType || "observation";
          const colors = CLAIM_TYPE_COLORS[claimType] || CLAIM_TYPE_COLORS.default;
          const evidenceStrength = node.meta?.evidenceStrength || 0.5;

          return {
            id: node.id,
            name: node.label,
            label: node.label,
            subtitle: node.subtitle,
            claimType,
            evidenceStrength,
            sourceCount: node.meta?.sourceCount || 0,
            color: colors.fill,
            size: 5 + evidenceStrength * 5, // Size based on evidence strength
            community: node.community,
          };
        });

        const links: ClaimLink[] = data.data.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          type: edge.relationshipType as "SUPPORTS" | "CONTRADICTS",
          confidence: edge.confidence || 0.7,
          color: EDGE_COLORS[edge.relationshipType as keyof typeof EDGE_COLORS] || EDGE_COLORS.SUPPORTS,
          width: 1 + (edge.confidence || 0.7) * 2,
        }));

        setGraphData({ nodes, links });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [projectId]);

  // Configure forces
  useEffect(() => {
    if (fgRef.current && graphData) {
      fgRef.current.d3Force("charge")?.strength(-300);
      fgRef.current.d3Force("link")?.distance(100);
      fgRef.current.d3Force("center")?.strength(0.1);
      fgRef.current.d3Force(
        "collide",
        forceCollide<ClaimNode>().radius((node) => node.size + 30).strength(0.7)
      );
    }
  }, [graphData]);

  // Get connected nodes for highlighting
  const connectedNodeIds = useMemo(() => {
    if (!selectedNode || !graphData) return new Set<string>();
    const connected = new Set<string>([selectedNode.id]);
    graphData.links.forEach((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      if (sourceId === selectedNode.id) connected.add(targetId);
      if (targetId === selectedNode.id) connected.add(sourceId);
    });
    return connected;
  }, [selectedNode, graphData]);

  // Event handlers
  const handleNodeClick = useCallback((node: any) => {
    const n = node as ClaimNode;
    setSelectedNode((prev) => (prev?.id === n.id ? null : n));
    onClaimSelect?.(n.id);
  }, [onClaimSelect]);

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node as ClaimNode | null);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? "pointer" : "default";
    }
  }, []);

  const handleZoom = useCallback((transform: { k: number }) => {
    requestAnimationFrame(() => setZoomLevel(transform.k));
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Canvas rendering
  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as ClaimNode;
      const isSelected = selectedNode?.id === n.id;
      const isHovered = hoveredNode?.id === n.id;
      const isConnected = selectedNode ? connectedNodeIds.has(n.id) : true;

      let alpha = 1;
      if (selectedNode && !isConnected) alpha = 0.2;

      // Draw node
      ctx.beginPath();
      ctx.arc(node.x, node.y, n.size, 0, 2 * Math.PI);
      ctx.fillStyle = n.color.replace(/[\d.]+\)$/, `${alpha * 0.9})`);
      ctx.fill();

      // Selection ring
      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.6)";
        ctx.lineWidth = isSelected ? 2 / globalScale : 1 / globalScale;
        ctx.stroke();
      }

      // Label
      const showLabel = isSelected || isHovered || globalScale >= 0.8 || n.evidenceStrength >= 0.7;
      if (!showLabel || alpha < 0.3) return;

      const fontSize = Math.min(12, Math.max(8, 10 / globalScale));
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;

      const label = n.label.length > 50 ? `${n.label.slice(0, 47)}...` : n.label;
      const textWidth = ctx.measureText(label).width;
      const padding = 4;

      // Background
      ctx.fillStyle = `rgba(15, 23, 42, ${alpha * 0.85})`;
      ctx.beginPath();
      ctx.roundRect(
        node.x - textWidth / 2 - padding,
        node.y + n.size + 2,
        textWidth + padding * 2,
        fontSize + padding,
        3
      );
      ctx.fill();

      // Text
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
      ctx.fillText(label, node.x, node.y + n.size + 2 + (fontSize + padding) / 2);
    },
    [selectedNode, hoveredNode, connectedNodeIds]
  );

  const linkColor = useCallback(
    (link: any) => {
      if (!selectedNode) return link.color;
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      if (connectedNodeIds.has(sourceId) && connectedNodeIds.has(targetId)) {
        return link.color;
      }
      return "rgba(148, 163, 184, 0.1)";
    },
    [selectedNode, connectedNodeIds]
  );

  const dimensions = useMemo(() => {
    if (isFullscreen) {
      return {
        width: typeof window !== "undefined" ? window.innerWidth : 800,
        height: typeof window !== "undefined" ? window.innerHeight : 600,
      };
    }
    return { width: containerWidth, height };
  }, [isFullscreen, containerWidth, height]);

  // Count stats
  const stats = useMemo(() => {
    if (!graphData) return { claims: 0, supports: 0, contradicts: 0 };
    const supports = graphData.links.filter((l) => l.type === "SUPPORTS").length;
    const contradicts = graphData.links.filter((l) => l.type === "CONTRADICTS").length;
    return { claims: graphData.nodes.length, supports, contradicts };
  }, [graphData]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center bg-slate-900 rounded-lg", className)} style={{ height }}>
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex items-center justify-center bg-slate-900 rounded-lg text-red-400 text-sm", className)} style={{ height }}>
        {error}
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className={cn("flex items-center justify-center bg-slate-900 rounded-lg text-slate-400 text-sm", className)} style={{ height }}>
        Aucun claim à afficher
      </div>
    );
  }

  const graphContent = (
    <div className="relative h-full w-full">
      {/* Header */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <Badge variant="secondary" className="bg-slate-800/80 text-slate-300">
          {stats.claims} claims
        </Badge>
        {stats.supports > 0 && (
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
            {stats.supports} consensus
          </Badge>
        )}
        {stats.contradicts > 0 && (
          <Badge className="bg-red-500/20 text-red-300 border-red-500/30">
            {stats.contradicts} tensions
          </Badge>
        )}
      </div>

      {/* Controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 border-slate-600/50 bg-slate-800/80"
          onClick={() => fgRef.current?.zoom(zoomLevel * 1.3, 300)}
        >
          <ZoomIn className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 border-slate-600/50 bg-slate-800/80"
          onClick={() => fgRef.current?.zoom(zoomLevel / 1.3, 300)}
        >
          <ZoomOut className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 border-slate-600/50 bg-slate-800/80"
          onClick={() => setIsFullscreen(!isFullscreen)}
        >
          {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </Button>
      </div>

      {/* Selected node info */}
      {selectedNode && (
        <div className="absolute bottom-3 left-3 right-3 z-10 rounded-lg border border-slate-700/50 bg-slate-900/95 p-3 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge
                  variant="outline"
                  style={{
                    backgroundColor: `${CLAIM_TYPE_COLORS[selectedNode.claimType]?.solid || CLAIM_TYPE_COLORS.default.solid}20`,
                    borderColor: `${CLAIM_TYPE_COLORS[selectedNode.claimType]?.solid || CLAIM_TYPE_COLORS.default.solid}40`,
                    color: CLAIM_TYPE_COLORS[selectedNode.claimType]?.solid || CLAIM_TYPE_COLORS.default.solid,
                  }}
                >
                  {CLAIM_TYPE_LABELS[selectedNode.claimType] || selectedNode.claimType}
                </Badge>
                <span className="text-xs text-slate-400">
                  Force: {Math.round(selectedNode.evidenceStrength * 100)}%
                </span>
              </div>
              <p className="text-sm text-white line-clamp-2">{selectedNode.label}</p>
              <p className="text-xs text-slate-500 mt-1">
                {connectedNodeIds.size - 1} connexion{connectedNodeIds.size - 1 !== 1 ? "s" : ""}
                {selectedNode.sourceCount > 0 && ` • ${selectedNode.sourceCount} source${selectedNode.sourceCount > 1 ? "s" : ""}`}
              </p>
            </div>
            <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1 text-[10px]">
        <div className="flex items-center gap-1.5 text-emerald-400">
          <span className="h-0.5 w-3 bg-emerald-500 rounded-full" />
          Soutient
        </div>
        <div className="flex items-center gap-1.5 text-red-400">
          <span className="h-0.5 w-3 bg-red-500 rounded-full" />
          Contredit
        </div>
      </div>

      {/* Graph */}
      {isMounted && typeof window !== "undefined" && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          nodeLabel=""
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={handleBackgroundClick}
          onZoom={handleZoom}
          linkColor={linkColor}
          linkWidth={(link: any) => link.width}
          backgroundColor="transparent"
          cooldownTicks={60}
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.3}
          warmupTicks={20}
          minZoom={0.3}
          maxZoom={5}
        />
      )}
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900" ref={containerRef}>
        {graphContent}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900", className)}
      style={{ height }}
    >
      {graphContent}
    </div>
  );
}

export default ClaimsGraphView;
