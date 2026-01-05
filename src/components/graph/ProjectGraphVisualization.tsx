"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { forceCollide } from "d3-force";
import {
  AlertTriangle,
  ChevronDown,
  Filter,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

type GraphNodeType = "insight" | "entity" | "challenge" | "synthesis" | "insight_type" | "claim";

interface GraphNodeResponse {
  id: string;
  type: GraphNodeType;
  label: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
  // Analytics fields (from Graphology)
  community?: number;
  betweenness?: number;
  pageRank?: number;
  degree?: number;
}

interface GraphEdgeResponse {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  label?: string;
  weight?: number;
  confidence?: number | null;
}

interface GraphStats {
  insights: number;
  entities: number;
  challenges: number;
  syntheses: number;
  claims: number;
  insightTypes: number;
  edges: number;
}

interface GraphPayload {
  nodes: GraphNodeResponse[];
  edges: GraphEdgeResponse[];
  stats: GraphStats;
}

interface FilterOption {
  id: string;
  name: string;
  parentId?: string | null;
  children?: FilterOption[];
}

interface FiltersPayload {
  clients: FilterOption[];
  projects: FilterOption[];
  challenges: FilterOption[];
}

interface ForceGraphNode {
  id: string;
  name: string;
  type: GraphNodeType;
  label: string;
  subtitle?: string;
  color: string;
  size: number;
  x?: number;
  y?: number;
  degree?: number;
  frequency?: number; // For entity nodes in concepts mode
  // Analytics fields (from Graphology)
  community?: number;
  communityColor?: string;
  betweenness?: number;
  pageRank?: number;
}

interface ForceGraphLink {
  source: string | ForceGraphNode;
  target: string | ForceGraphNode;
  label: string;
  color: string;
  width: number;
  relationshipType: string;
}

interface ForceGraphData {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
}

// ============================================================================
// COLOR SCHEME - Based on module-colors.ts
// ============================================================================

// Pre-computed color cache to avoid regex parsing on every frame
// Key format: "baseColor:alpha" -> computed RGBA string
const colorAlphaCache = new Map<string, string>();

function getColorWithAlpha(baseColor: string, alpha: number): string {
  if (alpha >= 1) return baseColor;

  const cacheKey = `${baseColor}:${alpha.toFixed(2)}`;
  const cached = colorAlphaCache.get(cacheKey);
  if (cached) return cached;

  // Parse and apply alpha (only on cache miss)
  const result = baseColor.replace(/[\d.]+\)$/, `${alpha * 0.6})`);
  colorAlphaCache.set(cacheKey, result);
  return result;
}

// Text measurement cache to avoid expensive ctx.measureText() calls
// Key format: "label:maxWidth" -> { lines, maxTextWidth }
interface TextMeasurement {
  lines: string[];
  maxTextWidth: number;
}
const textMeasureCache = new Map<string, TextMeasurement>();

function measureTextWithCache(
  ctx: CanvasRenderingContext2D,
  label: string,
  maxWidth: number
): TextMeasurement {
  // Round maxWidth to reduce cache misses during zoom
  const roundedMaxWidth = Math.round(maxWidth / 20) * 20;
  const cacheKey = `${label}:${roundedMaxWidth}`;

  const cached = textMeasureCache.get(cacheKey);
  if (cached) return cached;

  // Word wrap calculation
  const words = label.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const maxTextWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));

  const result = { lines, maxTextWidth };

  // Limit cache size to prevent memory leaks
  if (textMeasureCache.size > 500) {
    const firstKey = textMeasureCache.keys().next().value;
    if (firstKey) textMeasureCache.delete(firstKey);
  }

  textMeasureCache.set(cacheKey, result);
  return result;
}

// Node colors by type (RGBA for transparency support)
const NODE_COLORS: Record<GraphNodeType | "default", { fill: string; solid: string }> = {
  // Insight: Yellow/Gold (like insight-detection module)
  insight: {
    fill: "rgba(234, 179, 8, 0.9)",    // yellow-500
    solid: "#EAB308",
  },
  // Entity: Cyan/Sky blue (distinctive for concepts/keywords)
  entity: {
    fill: "rgba(14, 165, 233, 0.9)",   // sky-500
    solid: "#0EA5E9",
  },
  // Challenge: Indigo (like challenge-builder module)
  challenge: {
    fill: "rgba(99, 102, 241, 0.9)",   // indigo-500
    solid: "#6366F1",
  },
  // Synthesis: Purple (like models-config module for AI-generated content)
  synthesis: {
    fill: "rgba(168, 85, 247, 0.9)",   // purple-500
    solid: "#A855F7",
  },
  // Insight Type: Rose/Pink (category nodes for insight types)
  insight_type: {
    fill: "rgba(244, 63, 94, 0.9)",    // rose-500
    solid: "#F43F5E",
  },
  // Claim: Emerald/Green (actionable findings and hypotheses)
  claim: {
    fill: "rgba(16, 185, 129, 0.9)",   // emerald-500
    solid: "#10B981",
  },
  default: {
    fill: "rgba(148, 163, 184, 0.9)",  // slate-400
    solid: "#94A3B8",
  },
};

// Edge colors by relationship type
const EDGE_COLORS: Record<string, string> = {
  SIMILAR_TO: "rgba(234, 179, 8, 0.5)",    // yellow - insight similarity
  RELATED_TO: "rgba(99, 102, 241, 0.5)",   // indigo - challenge relations
  MENTIONS: "rgba(14, 165, 233, 0.5)",     // cyan - entity mentions
  SYNTHESIZES: "rgba(168, 85, 247, 0.5)",  // purple - synthesis connections
  CONTAINS: "rgba(16, 185, 129, 0.5)",     // emerald - containment
  HAS_TYPE: "rgba(244, 63, 94, 0.5)",      // rose - insight type classification
  INDIRECT: "rgba(148, 163, 184, 0.35)",   // slate - virtual/indirect links (dashed visually)
  CO_OCCURS: "rgba(14, 165, 233, 0.8)",    // cyan - entity co-occurrence in concepts mode (more visible)
  // Claim-related edges
  SUPPORTS: "rgba(16, 185, 129, 0.6)",     // emerald - claim supports claim
  CONTRADICTS: "rgba(239, 68, 68, 0.6)",   // red - claim contradicts claim
  ADDRESSES: "rgba(245, 158, 11, 0.6)",    // amber - claim addresses challenge
  EVIDENCE_FOR: "rgba(99, 102, 241, 0.5)", // indigo - insight proves claim
  default: "rgba(148, 163, 184, 0.4)",     // slate default
};

// Node labels in French
const NODE_LABELS: Record<GraphNodeType, string> = {
  insight: "Insights",
  entity: "Entités",
  challenge: "Challenges",
  synthesis: "Synthèses",
  insight_type: "Types d'insight",
  claim: "Claims",
};

// Edge type labels in French
const EDGE_LABELS: Record<string, string> = {
  SIMILAR_TO: "similaire",
  RELATED_TO: "lié à",
  MENTIONS: "mentionne",
  SYNTHESIZES: "synthétise",
  CONTAINS: "contient",
  HAS_TYPE: "type",
  INDIRECT: "indirect",
  CO_OCCURS: "co-occurrence",
  // Claim-related labels
  SUPPORTS: "soutient",
  CONTRADICTS: "contredit",
  ADDRESSES: "adresse",
  EVIDENCE_FOR: "preuve",
};

// Base node sizes by type
const NODE_SIZES: Record<GraphNodeType | "default", number> = {
  insight: 5,
  challenge: 7,
  synthesis: 6,
  entity: 4,
  insight_type: 8,  // Larger for category nodes
  claim: 6,         // Medium size for claims
  default: 4,
};

// Community colors for Louvain clustering visualization
// 12 distinct colors that work well together
const COMMUNITY_COLORS: Array<{ fill: string; solid: string }> = [
  { fill: "rgba(239, 68, 68, 0.9)", solid: "#EF4444" },   // red-500
  { fill: "rgba(34, 197, 94, 0.9)", solid: "#22C55E" },   // green-500
  { fill: "rgba(59, 130, 246, 0.9)", solid: "#3B82F6" },  // blue-500
  { fill: "rgba(249, 115, 22, 0.9)", solid: "#F97316" },  // orange-500
  { fill: "rgba(168, 85, 247, 0.9)", solid: "#A855F7" },  // purple-500
  { fill: "rgba(236, 72, 153, 0.9)", solid: "#EC4899" },  // pink-500
  { fill: "rgba(20, 184, 166, 0.9)", solid: "#14B8A6" },  // teal-500
  { fill: "rgba(234, 179, 8, 0.9)", solid: "#EAB308" },   // yellow-500
  { fill: "rgba(99, 102, 241, 0.9)", solid: "#6366F1" },  // indigo-500
  { fill: "rgba(14, 165, 233, 0.9)", solid: "#0EA5E9" },  // sky-500
  { fill: "rgba(244, 63, 94, 0.9)", solid: "#F43F5E" },   // rose-500
  { fill: "rgba(132, 204, 22, 0.9)", solid: "#84CC16" },  // lime-500
];

// ============================================================================
// COMPONENT PROPS
// ============================================================================

interface ProjectGraphVisualizationProps {
  projectId?: string | null;
  clientId?: string | null;
  refreshKey?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(l'|la |le |les |un |une |des |du |de la |de l')/i, "")
    .replace(/ (de la |de l'|du |des |d')/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildForceGraphData(payload: GraphPayload): ForceGraphData {
  // Deduplicate entity nodes by normalized label
  const seenLabels = new Map<string, string>();
  const nodeIdMapping = new Map<string, string>();

  for (const node of payload.nodes) {
    if (node.type === "entity") {
      const normalizedLabel = normalizeLabel(node.label);
      const key = `${normalizedLabel}:${node.subtitle || ""}`;
      if (seenLabels.has(key)) {
        nodeIdMapping.set(node.id, seenLabels.get(key)!);
      } else {
        seenLabels.set(key, node.id);
        nodeIdMapping.set(node.id, node.id);
      }
    } else {
      nodeIdMapping.set(node.id, node.id);
    }
  }

  // Calculate node degrees for sizing
  const nodeDegrees = new Map<string, number>();
  for (const edge of payload.edges) {
    const sourceId = nodeIdMapping.get(edge.source) || edge.source;
    const targetId = nodeIdMapping.get(edge.target) || edge.target;
    nodeDegrees.set(sourceId, (nodeDegrees.get(sourceId) || 0) + 1);
    nodeDegrees.set(targetId, (nodeDegrees.get(targetId) || 0) + 1);
  }

  // Build nodes with dynamic sizing based on degree, frequency, and centrality
  const uniqueNodeIds = new Set(nodeIdMapping.values());
  const maxDegree = Math.max(...Array.from(nodeDegrees.values()), 1);

  // Calculate max frequency for normalization (for entity nodes)
  const maxFrequency = Math.max(
    ...payload.nodes
      .filter(n => n.type === "entity" && n.meta?.frequency)
      .map(n => (n.meta?.frequency as number) || 1),
    1
  );

  const nodes: ForceGraphNode[] = payload.nodes
    .filter((node) => uniqueNodeIds.has(node.id) && nodeIdMapping.get(node.id) === node.id)
    .map((node) => {
      const colors = NODE_COLORS[node.type as GraphNodeType] || NODE_COLORS.default;
      const baseSize = NODE_SIZES[node.type as GraphNodeType] || NODE_SIZES.default;
      const degree = nodeDegrees.get(node.id) || 0;

      let size: number;

      if (node.type === "entity") {
        // For entities: combine frequency and centrality
        const frequency = (node.meta?.frequency as number) || 1;
        const centrality = node.betweenness || node.pageRank || 0;

        // Normalize and combine: frequency (log scale) + centrality boost
        const freqScore = Math.log1p(frequency) / Math.log1p(maxFrequency);
        const centralityScore = centrality * 5; // centrality is typically 0-1

        // Size: base + frequency contribution + centrality contribution
        size = baseSize * (1 + freqScore * 1.5 + centralityScore);
      } else {
        // For other nodes: use degree-based sizing
        const degreeScale = 1 + (degree / maxDegree) * 1.5;
        size = baseSize * degreeScale;
      }

      // Get community color if available
      const communityColor = node.community !== undefined
        ? COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]
        : undefined;

      return {
        id: node.id,
        name: node.label,
        type: node.type as GraphNodeType,
        label: node.label,
        subtitle: node.subtitle,
        color: colors.fill,
        size,
        degree,
        frequency: (node.meta?.frequency as number) || undefined,
        // Analytics fields
        community: node.community,
        communityColor: communityColor?.fill,
        betweenness: node.betweenness,
        pageRank: node.pageRank,
      };
    });

  // Build deduplicated links
  const seenLinkKeys = new Set<string>();
  const links: ForceGraphLink[] = [];

  for (const edge of payload.edges) {
    const remappedSource = nodeIdMapping.get(edge.source) || edge.source;
    const remappedTarget = nodeIdMapping.get(edge.target) || edge.target;

    if (remappedSource === remappedTarget) continue;

    const linkKey = `${remappedSource}-${remappedTarget}-${edge.relationshipType}`;
    if (seenLinkKeys.has(linkKey)) continue;
    seenLinkKeys.add(linkKey);

    const color = EDGE_COLORS[edge.relationshipType] || EDGE_COLORS.default;
    // Use confidence if available, otherwise fall back to weight
    const effectiveWeight = edge.confidence ?? edge.weight ?? 0.5;
    // Stronger visual weight for SUPPORTS/CONTRADICTS relationships
    const isKeyRelation = edge.relationshipType === "SUPPORTS" || edge.relationshipType === "CONTRADICTS";
    const widthMultiplier = isKeyRelation ? 3 : 2;

    links.push({
      source: remappedSource,
      target: remappedTarget,
      label: edge.label || edge.relationshipType,
      color,
      width: Math.max(0.5, effectiveWeight * widthMultiplier),
      relationshipType: edge.relationshipType,
    });
  }

  return { nodes, links };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ProjectGraphVisualization({ projectId, clientId, refreshKey }: ProjectGraphVisualizationProps) {
  // State
  const [graphData, setGraphData] = useState<ForceGraphData | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Interaction state
  const [selectedNode, setSelectedNode] = useState<ForceGraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<ForceGraphNode | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Filter state
  const [visibleTypes, setVisibleTypes] = useState<Record<GraphNodeType, boolean>>({
    insight: true,
    entity: true,
    challenge: true,
    synthesis: true,
    insight_type: true,
    claim: true,
  });
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    clientId === "all" ? null : (clientId ?? null)
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Semantic search state
  const [isSemanticSearch, setIsSemanticSearch] = useState(false);
  const [semanticResults, setSemanticResults] = useState<Map<string, number> | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Color mode state (type-based or community-based)
  type ColorMode = "type" | "community";
  const [colorMode, setColorMode] = useState<ColorMode>("type");

  // View mode state (full graph or concepts-only)
  type ViewMode = "full" | "concepts" | "claims";
  const [viewMode, setViewMode] = useState<ViewMode>("full");

  // Edge type visibility filters
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Record<string, boolean>>({
    SIMILAR_TO: true,
    RELATED_TO: true,
    MENTIONS: true,
    SYNTHESIZES: true,
    CONTAINS: true,
    HAS_TYPE: true,
    INDIRECT: true,
    CO_OCCURS: true,
    SUPPORTS: true,
    CONTRADICTS: true,
    ADDRESSES: true,
    EVIDENCE_FOR: true,
  });
  const [showEdgeLegend, setShowEdgeLegend] = useState(false);

  // Refs
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Container dimensions for responsive sizing
  const [containerWidth, setContainerWidth] = useState(900);

  // Mount effect
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Track container width with ResizeObserver
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
    // Initial measurement
    setContainerWidth(containerRef.current.offsetWidth || 900);

    return () => resizeObserver.disconnect();
  }, []);

  // Sync selectedProjectId when prop changes
  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
    }
  }, [projectId]);

  // Sync selectedClientId when prop changes
  useEffect(() => {
    // Handle "all" case: clientId prop can be "all" which means no filter
    setSelectedClientId(clientId === "all" ? null : (clientId ?? null));
  }, [clientId]);

  // Semantic search effect with debounce
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Clear results if search is empty or semantic mode is off
    if (!isSemanticSearch || !searchQuery.trim()) {
      setSemanticResults(null);
      setIsSearching(false);
      return;
    }

    // Debounce search - wait 500ms after user stops typing
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/graph/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchQuery,
            searchType: "semantic",
            projectId: projectId,
            limit: 50,
            threshold: 0.6, // Lower threshold to get more results
          }),
        });

        const data = await response.json();

        if (data.success && data.data) {
          // Build map of insight ID -> similarity score
          const resultsMap = new Map<string, number>();
          for (const result of data.data) {
            resultsMap.set(result.id, result.score ?? 0.7);
          }
          setSemanticResults(resultsMap);
        } else {
          setSemanticResults(null);
        }
      } catch (error) {
        console.error("Semantic search error:", error);
        setSemanticResults(null);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, isSemanticSearch, projectId]);

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================

  // Get connected node IDs for selection highlighting
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

  // Get connected node IDs for hover highlighting (same focus effect as selection)
  const hoveredConnectedNodeIds = useMemo(() => {
    if (!hoveredNode || !graphData || selectedNode) return new Set<string>();
    const connected = new Set<string>([hoveredNode.id]);

    graphData.links.forEach((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;

      if (sourceId === hoveredNode.id) connected.add(targetId);
      if (targetId === hoveredNode.id) connected.add(sourceId);
    });

    return connected;
  }, [hoveredNode, graphData, selectedNode]);

  // Hub detection (nodes with many connections)
  const hubNodeIds = useMemo(() => {
    if (!graphData) return new Set<string>();

    const degrees = new Map<string, number>();
    graphData.links.forEach((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      degrees.set(sourceId, (degrees.get(sourceId) || 0) + 1);
      degrees.set(targetId, (degrees.get(targetId) || 0) + 1);
    });

    const threshold = 5;
    const hubs = new Set<string>();
    degrees.forEach((degree, nodeId) => {
      if (degree >= threshold) hubs.add(nodeId);
    });

    return hubs;
  }, [graphData]);

  // Search filter - supports both text and semantic search
  const searchMatchIds = useMemo(() => {
    if (!searchQuery.trim() || !graphData) return null;

    // If semantic search is enabled, use the semantic results
    if (isSemanticSearch && semanticResults) {
      // For semantic search, also include connected entities/challenges via graph links
      const matchedIds = new Set<string>(semanticResults.keys());

      // Expand matches to include directly connected nodes (entities, challenges)
      for (const link of graphData.links) {
        const sourceId = typeof link.source === "string" ? link.source : link.source.id;
        const targetId = typeof link.target === "string" ? link.target : link.target.id;

        if (matchedIds.has(sourceId)) {
          matchedIds.add(targetId);
        }
        if (matchedIds.has(targetId)) {
          matchedIds.add(sourceId);
        }
      }

      return matchedIds;
    }

    // Fallback to text search
    const query = searchQuery.toLowerCase();
    return new Set(
      graphData.nodes
        .filter((n) => n.label.toLowerCase().includes(query) || n.subtitle?.toLowerCase().includes(query))
        .map((n) => n.id)
    );
  }, [searchQuery, graphData, isSemanticSearch, semanticResults]);

  // Filter graph data with virtual links for hidden intermediary nodes
  const filteredGraphData = useMemo(() => {
    if (!graphData) return null;

    // Build node type map for O(1) lookups (instead of O(n) .find() calls)
    const nodeTypeMap = new Map<string, GraphNodeType>();
    for (const node of graphData.nodes) {
      nodeTypeMap.set(node.id, node.type);
    }

    // Filter nodes by type visibility and search
    const visibleNodes = graphData.nodes.filter((node) => {
      if (!visibleTypes[node.type]) return false;
      if (searchMatchIds && !searchMatchIds.has(node.id)) return false;
      return true;
    });

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const hiddenNodeIds = new Set(
      graphData.nodes.filter((n) => !visibleNodeIds.has(n.id)).map((n) => n.id)
    );

    // Build adjacency map for hidden nodes to create virtual links
    // When insights are hidden, we want to show direct links between challenges and entities
    const hiddenNodeConnections = new Map<string, Set<string>>();

    // First pass: collect all connections through hidden nodes
    for (const link of graphData.links) {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;

      // If one end is hidden and the other is visible, track the connection
      if (hiddenNodeIds.has(sourceId) && visibleNodeIds.has(targetId)) {
        if (!hiddenNodeConnections.has(sourceId)) {
          hiddenNodeConnections.set(sourceId, new Set());
        }
        hiddenNodeConnections.get(sourceId)!.add(targetId);
      }
      if (hiddenNodeIds.has(targetId) && visibleNodeIds.has(sourceId)) {
        if (!hiddenNodeConnections.has(targetId)) {
          hiddenNodeConnections.set(targetId, new Set());
        }
        hiddenNodeConnections.get(targetId)!.add(sourceId);
      }
    }

    // Create virtual links: connect visible nodes that share a hidden intermediary
    const virtualLinks: ForceGraphLink[] = [];
    const seenVirtualLinks = new Set<string>();

    for (const [_hiddenId, connectedVisibleIds] of hiddenNodeConnections) {
      const visibleArray = Array.from(connectedVisibleIds);
      // Create links between all pairs of visible nodes connected through this hidden node
      for (let i = 0; i < visibleArray.length; i++) {
        for (let j = i + 1; j < visibleArray.length; j++) {
          const nodeA = visibleArray[i];
          const nodeB = visibleArray[j];

          // Create a consistent key regardless of order
          const linkKey = nodeA < nodeB ? `${nodeA}-${nodeB}` : `${nodeB}-${nodeA}`;

          if (!seenVirtualLinks.has(linkKey)) {
            seenVirtualLinks.add(linkKey);

            // Determine link color based on connected node types (O(1) lookup)
            const nodeAType = nodeTypeMap.get(nodeA);
            const nodeBType = nodeTypeMap.get(nodeB);

            let color = EDGE_COLORS.default;
            if (nodeAType === "challenge" || nodeBType === "challenge") {
              color = EDGE_COLORS.RELATED_TO;
            } else if (nodeAType === "entity" || nodeBType === "entity") {
              color = EDGE_COLORS.MENTIONS;
            }

            virtualLinks.push({
              source: nodeA,
              target: nodeB,
              label: "Lien indirect",
              color,
              width: 0.8,
              relationshipType: "INDIRECT",
            });
          }
        }
      }
    }

    // Filter original links (only between visible nodes)
    // Build a Set for O(1) duplicate checking instead of O(n) .some() calls
    const directLinkKeys = new Set<string>();
    const directLinks = graphData.links.filter((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      if (visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId)) {
        // Store both directions for bidirectional lookup
        directLinkKeys.add(`${sourceId}-${targetId}`);
        directLinkKeys.add(`${targetId}-${sourceId}`);
        return true;
      }
      return false;
    });

    // Combine direct and virtual links, avoiding duplicates with O(1) Set lookup
    const allLinks = [...directLinks];
    for (const vLink of virtualLinks) {
      const sourceId = typeof vLink.source === "string" ? vLink.source : vLink.source.id;
      const targetId = typeof vLink.target === "string" ? vLink.target : vLink.target.id;

      // O(1) lookup instead of O(n) .some()
      if (!directLinkKeys.has(`${sourceId}-${targetId}`)) {
        allLinks.push(vLink);
      }
    }

    // Filter links by edge type visibility
    const filteredLinks = allLinks.filter(link => {
      return visibleEdgeTypes[link.relationshipType] !== false;
    });

    return { nodes: visibleNodes, links: filteredLinks };
  }, [graphData, visibleTypes, searchMatchIds, visibleEdgeTypes]);

  // Dimensions - responsive to container width
  const dimensions = useMemo(() => {
    if (isFullscreen) {
      return {
        width: typeof window !== "undefined" ? window.innerWidth : 1200,
        height: typeof window !== "undefined" ? window.innerHeight : 800,
      };
    }
    // Use container width, with a reasonable height ratio
    return { width: containerWidth, height: 500 };
  }, [isFullscreen, containerWidth]);

  // ========================================================================
  // DATA LOADING
  // ========================================================================

  const loadGraph = useCallback(async () => {
    // projectId prop takes priority (when on a specific project page like synthesis)
    // Fall back to selectedProjectId for cases where user can select via dropdown
    const effectiveProjectId = projectId || selectedProjectId;
    // Use selectedClientId (which can be set from prop or user selection)
    const effectiveClientId = selectedClientId;

    // Need at least a project or client to filter by
    if (!effectiveProjectId && !effectiveClientId) {
      setError("Sélectionnez un projet ou un client pour afficher le graphe.");
      setGraphData(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Build URL with filters
      const params = new URLSearchParams({ limit: "500" });
      if (effectiveProjectId) params.set("projectId", effectiveProjectId);
      if (effectiveClientId) params.set("clientId", effectiveClientId);
      if (selectedChallengeId) params.set("challengeId", selectedChallengeId);
      // Include analytics for community detection and centrality
      if (effectiveProjectId) params.set("includeAnalytics", "true");
      // Include view mode for concepts-only view or claims-only view
      if (viewMode === "concepts") params.set("mode", "concepts");
      if (viewMode === "claims") params.set("mode", "claims");

      const response = await fetch(`/api/admin/graph/visualization?${params}`, {
        cache: "no-store",
      });
      const payload: ApiResponse<GraphPayload> = await response.json();

      if (payload.success && payload.data) {
        setGraphData(buildForceGraphData(payload.data));
        setStats(payload.data.stats);
      } else {
        setError(payload.error || "Impossible de charger le graphe");
        setGraphData(null);
        setStats(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setGraphData(null);
      setStats(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, selectedProjectId, selectedClientId, selectedChallengeId, viewMode]);

  const loadFilters = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/graph/filters");
      const payload: ApiResponse<FiltersPayload> = await response.json();
      if (payload.success && payload.data) {
        setFilters(payload.data);
      }
    } catch (err) {
      console.error("Error loading filters:", err);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph, refreshKey]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  // ========================================================================
  // FORCE GRAPH CONFIGURATION
  // ========================================================================

  useEffect(() => {
    if (fgRef.current && filteredGraphData) {
      // Configure forces based on view mode
      // In concepts mode, use gentler forces to keep clusters closer
      if (viewMode === "concepts") {
        // Gentler charge for concepts - clusters stay closer
        fgRef.current.d3Force("charge")?.strength(-400);
        // Shorter link distance for tighter clusters
        fgRef.current.d3Force("link")?.distance(80);
        // Stronger center pull to keep everything together
        fgRef.current.d3Force("center")?.strength(0.15);
      } else {
        // Full mode: stronger forces for larger graph
        fgRef.current.d3Force("charge")?.strength(-1500);
        fgRef.current.d3Force("link")?.distance(180);
        fgRef.current.d3Force("center")?.strength(0.03);
      }

      // Add collision force to prevent node/label overlap
      // Radius accounts for node size + label box below the node
      const collideRadius = viewMode === "concepts" ? 0.6 : 1.0; // Smaller collision in concepts mode
      fgRef.current.d3Force(
        "collide",
        forceCollide<ForceGraphNode>()
          .radius((node) => {
            // Estimate label dimensions
            // Font is ~11-18px, average char width ~10px, max 280px width
            const labelLength = node.name?.length || 10;
            const estimatedTextWidth = Math.min(labelLength * 10, 280);
            // Estimate number of lines (280px max width, ~28 chars per line)
            const estimatedLines = Math.ceil(labelLength / 28);
            const estimatedLabelHeight = estimatedLines * 20; // ~20px per line
            // Collision radius = half text width + label height + generous padding
            const baseRadius = Math.max(estimatedTextWidth / 2, 60) + estimatedLabelHeight + 35;
            return baseRadius * collideRadius;
          })
          .strength(0.8)
          .iterations(3)
      );
    }
  }, [filteredGraphData, viewMode]);

  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : (node as ForceGraphNode)));
  }, []);

  // Fix node position after drag so it stays in place
  const handleNodeDragEnd = useCallback((node: any) => {
    // Pin the node to its current position
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  // Double-click to unpin a node
  const handleNodeRightClick = useCallback((node: any) => {
    // Unpin the node so it can move freely again
    node.fx = undefined;
    node.fy = undefined;
  }, []);

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node as ForceGraphNode | null);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? "pointer" : "default";
    }
  }, []);

  const handleZoom = useCallback((transform: { k: number }) => {
    // Defer state update to avoid React warning about setState during render
    requestAnimationFrame(() => {
      setZoomLevel(transform.k);
    });
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
    setSelectedNode(null);
  }, []);

  const toggleNodeType = useCallback((type: GraphNodeType) => {
    setVisibleTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const zoomIn = useCallback(() => {
    fgRef.current?.zoom(zoomLevel * 1.3, 300);
  }, [zoomLevel]);

  const zoomOut = useCallback(() => {
    fgRef.current?.zoom(zoomLevel / 1.3, 300);
  }, [zoomLevel]);

  const resetZoom = useCallback(() => {
    fgRef.current?.zoomToFit(400, 50);
  }, []);

  // Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedNode) {
          setSelectedNode(null);
        } else if (isFullscreen) {
          setIsFullscreen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, selectedNode]);

  // ========================================================================
  // CANVAS RENDERING
  // ========================================================================

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as ForceGraphNode;
      const isSelected = selectedNode?.id === n.id;
      const isHovered = hoveredNode?.id === n.id;
      const isConnected = selectedNode ? connectedNodeIds.has(n.id) : true;
      const isHoverConnected = hoveredNode && !selectedNode ? hoveredConnectedNodeIds.has(n.id) : true;
      const isHub = hubNodeIds.has(n.id);
      const isSearchMatch = searchMatchIds ? searchMatchIds.has(n.id) : true;

      // Determine opacity - apply focus effect on both selection and hover
      let alpha = 1;
      if (selectedNode && !isConnected) alpha = 0.15;
      else if (hoveredNode && !selectedNode && !isHoverConnected) alpha = 0.15;
      if (searchMatchIds && !isSearchMatch) alpha = 0.1;

      // Determine base color based on color mode
      const baseColor = colorMode === "community" && n.communityColor
        ? n.communityColor
        : n.color;

      // Get color with alpha from cache (avoids regex on every frame)
      const fillColor = getColorWithAlpha(baseColor, alpha);

      // Draw node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, n.size, 0, 2 * Math.PI, false);
      ctx.fillStyle = fillColor;
      ctx.fill();

      // Selection/hover ring
      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.6)";
        ctx.lineWidth = isSelected ? 2.5 / globalScale : 1.5 / globalScale;
        ctx.stroke();
      }

      // Search highlight ring - purple for semantic, yellow for text search
      if (searchMatchIds && isSearchMatch && !isSelected && !isHovered) {
        const semanticScore = semanticResults?.get(n.id);
        if (isSemanticSearch && semanticScore !== undefined) {
          // Purple ring for semantic matches, intensity based on score
          ctx.strokeStyle = `rgba(168, 85, 247, ${0.5 + semanticScore * 0.5})`;
          ctx.lineWidth = (1.5 + semanticScore * 1.5) / globalScale;
        } else {
          ctx.strokeStyle = "rgba(251, 191, 36, 0.8)";
          ctx.lineWidth = 2 / globalScale;
        }
        ctx.stroke();
      }

      // Label visibility: Show labels ONLY for selected node and its direct neighbors
      // When no node is selected, show labels based on zoom level for hubs/challenges
      const isSelectedOrNeighbor = selectedNode && (isSelected || isConnected);
      const isHoveredOrNeighbor = hoveredNode && !selectedNode && (isHovered || isHoverConnected);

      let showLabel = false;
      if (isSelected || isHovered) {
        showLabel = true;
      } else if (isSelectedOrNeighbor) {
        // Show label for selected node's direct neighbors
        showLabel = true;
      } else if (isHoveredOrNeighbor) {
        // Show label for hovered node's direct neighbors
        showLabel = true;
      } else if (!selectedNode && !hoveredNode) {
        // In concepts mode, show labels for high-frequency entities
        if (viewMode === "concepts" && n.type === "entity") {
          const frequency = n.frequency || 0;
          // Show label if frequency >= 3 or at high zoom
          showLabel = frequency >= 3 || globalScale >= 0.6;
        } else {
          // Key nodes (hubs and challenges) are always visible
          // Other nodes only visible at high zoom
          const isKeyNode = isHub || n.type === "challenge";
          if (isKeyNode) {
            showLabel = true;
          } else {
            const ZOOM_THRESHOLD = 0.8;
            showLabel = globalScale >= ZOOM_THRESHOLD;
          }
        }
      }

      if (!showLabel || alpha < 0.3) return;

      // Draw label - Larger text size for better readability
      // Key nodes (hubs/challenges) get much bigger text when zoomed out
      const label = n.name;
      const isKeyNode = isHub || n.type === "challenge";
      const baseFontSize = isKeyNode
        ? Math.min(44, Math.max(22, 32 / globalScale))  // Much larger for key nodes
        : Math.min(18, Math.max(11, 15 / globalScale)); // Normal for others
      const fontSize = baseFontSize;
      const fontWeight = isKeyNode ? "700" : "600";
      ctx.font = `${fontWeight} ${fontSize}px Inter, system-ui, sans-serif`;

      // Word wrap with wider max width (much wider for key nodes)
      const maxWidth = (isKeyNode ? 500 : 280) / globalScale;

      // Use cached text measurement to avoid expensive ctx.measureText() calls
      const { lines: displayLines, maxTextWidth } = measureTextWithCache(ctx, label, maxWidth);

      const lineHeight = fontSize * 1.3;
      const boxPadding = fontSize * 0.4;
      const boxWidth = maxTextWidth + boxPadding * 2;
      const boxHeight = displayLines.length * lineHeight + boxPadding;
      const boxX = node.x - boxWidth / 2;
      const boxY = node.y + n.size + 2;
      const borderRadius = fontSize * 0.3;

      // Background
      ctx.fillStyle = `rgba(15, 23, 42, ${alpha * 0.9})`;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, borderRadius);
      ctx.fill();

      // Text
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
      displayLines.forEach((line, i) => {
        const lineY = boxY + boxPadding / 2 + (i + 0.5) * lineHeight;
        ctx.fillText(line, node.x, lineY);
      });
    },
    [selectedNode, hoveredNode, connectedNodeIds, hoveredConnectedNodeIds, hubNodeIds, searchMatchIds, semanticResults, isSemanticSearch, colorMode, viewMode]
  );

  const linkColor = useCallback(
    (link: any) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;

      // Selection takes priority
      if (selectedNode) {
        if (connectedNodeIds.has(sourceId) && connectedNodeIds.has(targetId)) {
          return link.color;
        }
        return "rgba(148, 163, 184, 0.08)";
      }

      // Hover effect - same focus behavior as selection
      if (hoveredNode) {
        if (hoveredConnectedNodeIds.has(sourceId) && hoveredConnectedNodeIds.has(targetId)) {
          return link.color;
        }
        return "rgba(148, 163, 184, 0.08)";
      }

      return link.color;
    },
    [selectedNode, connectedNodeIds, hoveredNode, hoveredConnectedNodeIds]
  );

  // Link canvas object for drawing relationship type labels
  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;

      // Only show link labels when connected to selected or hovered node
      const isConnectedToSelected = selectedNode && (connectedNodeIds.has(sourceId) && connectedNodeIds.has(targetId));
      const isConnectedToHovered = hoveredNode && !selectedNode && (hoveredConnectedNodeIds.has(sourceId) && hoveredConnectedNodeIds.has(targetId));

      if (!isConnectedToSelected && !isConnectedToHovered) return;

      // Get source and target positions
      const source = link.source;
      const target = link.target;
      if (typeof source === "string" || typeof target === "string") return;

      // Calculate midpoint for label
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;

      // Get the relationship type label
      const relationshipType = link.relationshipType || "default";
      const labelText = EDGE_LABELS[relationshipType] || relationshipType.toLowerCase().replace(/_/g, " ");

      // Draw label
      const fontSize = Math.min(8, Math.max(4, 6 / globalScale));
      ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;

      const padding = fontSize * 0.3;
      const textWidth = ctx.measureText(labelText).width;
      const boxWidth = textWidth + padding * 2;
      const boxHeight = fontSize + padding;

      // Background
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.beginPath();
      ctx.roundRect(midX - boxWidth / 2, midY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.2);
      ctx.fill();

      // Border with link color
      ctx.strokeStyle = link.color.replace(/[\d.]+\)$/, "0.6)");
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      // Text
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
      ctx.fillText(labelText, midX, midY);
    },
    [selectedNode, connectedNodeIds, hoveredNode, hoveredConnectedNodeIds]
  );

  // ========================================================================
  // RENDER
  // ========================================================================

  const graphContent = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 pb-2">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-yellow-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">Graphe de connaissances</h3>
            <p className="text-xs text-slate-400">
              Visualisation des relations entre insights, entités et challenges
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats && (
            <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
              <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-yellow-300">
                {stats.insights} insights
              </span>
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-300">
                {stats.entities} entités
              </span>
              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-indigo-300">
                {stats.challenges} challenges
              </span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                {stats.claims} claims
              </span>
              <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-purple-300">
                {stats.syntheses} synthèses
              </span>
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-300">
                {stats.insightTypes} types
              </span>
              <span className="text-slate-500">•</span>
              <span>{stats.edges} liens</span>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-slate-600/50 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60"
            onClick={loadGraph}
            disabled={isLoading || !projectId}
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600/50 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Toolbar: Search + Filters + Legend */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/50 px-4 py-2">
        {/* Search with semantic toggle */}
        <div className="flex items-center gap-1">
          <div className="relative">
            {isSearching ? (
              <Loader2 className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-purple-400" />
            ) : isSemanticSearch ? (
              <Sparkles className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-purple-400" />
            ) : (
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            )}
            <input
              type="text"
              placeholder={isSemanticSearch ? "Recherche sémantique..." : "Rechercher..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`h-8 w-48 rounded-md border bg-slate-800/60 pl-8 pr-8 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 ${
                isSemanticSearch
                  ? "border-purple-500/50 focus:border-purple-500/70 focus:ring-purple-500/30"
                  : "border-slate-600/50 focus:border-yellow-500/50 focus:ring-yellow-500/30"
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Semantic search toggle */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsSemanticSearch(!isSemanticSearch)}
            title={isSemanticSearch ? "Recherche sémantique (IA)" : "Recherche textuelle"}
            className={`h-8 w-8 p-0 ${
              isSemanticSearch
                ? "border-purple-500/50 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
                : "border-slate-600/50 bg-slate-800/60 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Semantic search results count */}
        {isSemanticSearch && semanticResults && searchQuery && (
          <span className="text-xs text-purple-300">
            {semanticResults.size} résultat{semanticResults.size !== 1 ? "s" : ""} sémantique{semanticResults.size !== 1 ? "s" : ""}
          </span>
        )}

        {/* Filter toggle */}
        <Button
          size="sm"
          variant="outline"
          className={`gap-1.5 border-slate-600/50 text-xs ${
            showFilters || selectedClientId || selectedChallengeId
              ? "bg-yellow-500/20 text-yellow-300"
              : "bg-slate-800/60 text-slate-300"
          }`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-3 w-3" />
          Filtres
          {(selectedClientId || selectedChallengeId) && (
            <span className="ml-1 h-1.5 w-1.5 rounded-full bg-yellow-400" />
          )}
        </Button>

        {/* View mode toggle (full vs concepts vs claims) */}
        <div className="flex items-center gap-1 rounded-md border border-slate-600/50 bg-slate-800/60 p-0.5">
          <button
            onClick={() => setViewMode("full")}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              viewMode === "full"
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Complet
          </button>
          <button
            onClick={() => setViewMode("concepts")}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              viewMode === "concepts"
                ? "bg-sky-500/30 text-sky-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Concepts
          </button>
          <button
            onClick={() => setViewMode("claims")}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              viewMode === "claims"
                ? "bg-emerald-500/30 text-emerald-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Claims
          </button>
        </div>

        {/* Color mode toggle (type vs community) */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setColorMode(colorMode === "type" ? "community" : "type")}
          title={colorMode === "type" ? "Colorer par type" : "Colorer par communauté (Louvain)"}
          className={`gap-1.5 border-slate-600/50 text-xs ${
            colorMode === "community"
              ? "bg-green-500/20 text-green-300 border-green-500/50"
              : "bg-slate-800/60 text-slate-300"
          }`}
        >
          <Palette className="h-3 w-3" />
          {colorMode === "type" ? "Type" : "Communauté"}
        </Button>

        {/* Divider */}
        <div className="h-4 w-px bg-slate-600/50" />

        {/* Node Legend */}
        {Object.entries(NODE_LABELS).map(([type, label]) => (
          <button
            key={type}
            onClick={() => toggleNodeType(type as GraphNodeType)}
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-all ${
              visibleTypes[type as GraphNodeType] ? "opacity-100" : "opacity-40 line-through"
            }`}
            style={{
              backgroundColor: `${NODE_COLORS[type as GraphNodeType].solid}20`,
              color: NODE_COLORS[type as GraphNodeType].solid,
              border: `1px solid ${NODE_COLORS[type as GraphNodeType].solid}40`,
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: NODE_COLORS[type as GraphNodeType].solid }}
            />
            {label}
          </button>
        ))}

        {/* Edge Legend Toggle */}
        <Button
          size="sm"
          variant="outline"
          className={`gap-1.5 border-slate-600/50 text-xs ${
            showEdgeLegend
              ? "bg-amber-500/20 text-amber-300"
              : "bg-slate-800/60 text-slate-300"
          }`}
          onClick={() => setShowEdgeLegend(!showEdgeLegend)}
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${showEdgeLegend ? "rotate-180" : ""}`} />
          Liens
        </Button>
      </div>

      {/* Edge type filters panel */}
      {showEdgeLegend && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-800/30 px-4 py-2">
          <span className="text-xs text-slate-400 mr-2">Types de liens:</span>
          {Object.entries(EDGE_LABELS).map(([edgeType, label]) => {
            const color = EDGE_COLORS[edgeType] || EDGE_COLORS.default;
            const isVisible = visibleEdgeTypes[edgeType] !== false;
            // Highlight SUPPORTS and CONTRADICTS as key relationship types
            const isKeyType = edgeType === "SUPPORTS" || edgeType === "CONTRADICTS";
            return (
              <button
                key={edgeType}
                onClick={() => setVisibleEdgeTypes(prev => ({
                  ...prev,
                  [edgeType]: !prev[edgeType]
                }))}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-all ${
                  isVisible ? "opacity-100" : "opacity-40 line-through"
                } ${isKeyType ? "ring-1 ring-white/20" : ""}`}
                style={{
                  backgroundColor: `${color.replace(/[\d.]+\)$/, "0.15)")}`,
                  color: color.replace(/[\d.]+\)$/, "1)"),
                  border: `1px solid ${color.replace(/[\d.]+\)$/, "0.4)")}`,
                }}
              >
                <span
                  className="h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: color.replace(/[\d.]+\)$/, "1)") }}
                />
                {label}
              </button>
            );
          })}
          {/* Quick filters */}
          <div className="h-4 w-px bg-slate-600/50 mx-1" />
          <button
            onClick={() => {
              // Show only consensus/conflict edges
              setVisibleEdgeTypes({
                SIMILAR_TO: false,
                RELATED_TO: false,
                MENTIONS: false,
                SYNTHESIZES: false,
                CONTAINS: false,
                HAS_TYPE: false,
                INDIRECT: false,
                CO_OCCURS: false,
                SUPPORTS: true,
                CONTRADICTS: true,
                ADDRESSES: false,
                EVIDENCE_FOR: false,
              });
            }}
            className="rounded-full bg-slate-700/50 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600/50"
          >
            Consensus/Tensions
          </button>
          <button
            onClick={() => {
              // Show all edges
              setVisibleEdgeTypes({
                SIMILAR_TO: true,
                RELATED_TO: true,
                MENTIONS: true,
                SYNTHESIZES: true,
                CONTAINS: true,
                HAS_TYPE: true,
                INDIRECT: true,
                CO_OCCURS: true,
                SUPPORTS: true,
                CONTRADICTS: true,
                ADDRESSES: true,
                EVIDENCE_FOR: true,
              });
            }}
            className="rounded-full bg-slate-700/50 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600/50"
          >
            Tous
          </button>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && filters && (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-700/50 bg-slate-800/30 px-4 py-3">
          {/* Client filter - disabled when projectId prop is provided (project already determines client) */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Client:</label>
            <select
              value={selectedClientId || ""}
              onChange={(e) => {
                setSelectedClientId(e.target.value || null);
                setSelectedProjectId(null);
                setSelectedChallengeId(null);
              }}
              disabled={!!projectId}
              className={`h-7 rounded border border-slate-600/50 bg-slate-800 px-2 text-xs text-white focus:border-yellow-500/50 focus:outline-none ${projectId ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <option value="">Tous</option>
              {filters.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Project filter - disabled when projectId prop is provided */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Projet:</label>
            <select
              value={projectId || selectedProjectId || ""}
              onChange={(e) => {
                setSelectedProjectId(e.target.value || null);
                setSelectedChallengeId(null);
              }}
              disabled={!!projectId}
              className={`h-7 rounded border border-slate-600/50 bg-slate-800 px-2 text-xs text-white focus:border-yellow-500/50 focus:outline-none ${projectId ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <option value="">Tous</option>
              {filters.projects
                .filter((p) => !selectedClientId || p.parentId === selectedClientId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Challenge filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Challenge:</label>
            <select
              value={selectedChallengeId || ""}
              onChange={(e) => setSelectedChallengeId(e.target.value || null)}
              className="h-7 rounded border border-slate-600/50 bg-slate-800 px-2 text-xs text-white focus:border-yellow-500/50 focus:outline-none"
            >
              <option value="">Tous</option>
              {filters.challenges
                .filter((c) => {
                  // Use projectId prop OR selectedProjectId to filter challenges
                  const effectiveProjectId = projectId || selectedProjectId;
                  return !effectiveProjectId || c.parentId === effectiveProjectId;
                })
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Clear filters */}
          {(selectedClientId || selectedProjectId || selectedChallengeId) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs text-slate-400 hover:text-white"
              onClick={() => {
                setSelectedClientId(null);
                setSelectedProjectId(null);
                setSelectedChallengeId(null);
              }}
            >
              <X className="h-3 w-3" />
              Effacer
            </Button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="mx-4 mt-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Graph area */}
      <div className="relative flex-1" ref={containerRef}>
        {!projectId && !clientId && !selectedProjectId && !selectedClientId && (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border border-dashed border-slate-600/50 bg-slate-800/40 px-8 py-12 text-center">
              <Layers className="mx-auto mb-3 h-10 w-10 text-slate-500" />
              <p className="text-sm text-slate-400">Sélectionnez un client ou un projet pour afficher le graphe de connaissances</p>
            </div>
          </div>
        )}

        {(projectId || clientId || selectedProjectId || selectedClientId) && isLoading && !graphData && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-yellow-500/50" />
          </div>
        )}

        {(projectId || clientId || selectedProjectId || selectedClientId) && filteredGraphData && isMounted && (
          <>
            {/* Selected node info */}
            {selectedNode && (
              <div className="absolute left-4 top-4 z-10 max-w-xs rounded-lg border border-white/20 bg-slate-900/95 p-3 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: NODE_COLORS[selectedNode.type]?.solid || NODE_COLORS.default.solid }}
                      />
                      <span className="text-xs font-medium text-slate-400">
                        {NODE_LABELS[selectedNode.type] || selectedNode.type}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-white">{selectedNode.name}</p>
                    {selectedNode.subtitle && <p className="mt-1 text-xs text-slate-400">{selectedNode.subtitle}</p>}
                    <p className="mt-2 text-xs text-slate-500">
                      {connectedNodeIds.size - 1} connexion{connectedNodeIds.size - 1 !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white flex items-center gap-1 text-xs">
                    <X className="h-4 w-4" />
                    <span>Fermer</span>
                  </button>
                </div>
              </div>
            )}

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-slate-600/50 bg-slate-800/80 px-2 text-slate-300 hover:bg-slate-700/80"
                onClick={zoomIn}
              >
                <Plus className="h-4 w-4 mr-1" />
                <span className="text-xs">Zoom +</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-slate-600/50 bg-slate-800/80 px-2 text-slate-300 hover:bg-slate-700/80"
                onClick={zoomOut}
              >
                <Minus className="h-4 w-4 mr-1" />
                <span className="text-xs">Zoom -</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-slate-600/50 bg-slate-800/80 px-2 text-xs text-slate-300 hover:bg-slate-700/80"
                onClick={resetZoom}
                title="Réinitialiser le zoom"
              >
                <ZoomOut className="h-4 w-4 mr-1" />
                <span className="text-xs">Reset</span>
              </Button>
              <div className="mt-1 rounded bg-slate-800/80 px-1.5 py-0.5 text-center text-[10px] text-slate-400">
                {Math.round(zoomLevel * 100)}%
              </div>
            </div>

            {/* Graph */}
            <div
              className="h-full w-full"
              style={{
                background: "radial-gradient(ellipse at 30% 20%, rgba(234, 179, 8, 0.05) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(99, 102, 241, 0.05) 0%, transparent 50%), #0f172a",
              }}
            >
              {typeof window !== "undefined" && (
                <ForceGraph2D
                  ref={fgRef}
                  graphData={filteredGraphData}
                  width={dimensions.width}
                  height={dimensions.height}
                  nodeLabel=""
                  nodeCanvasObject={nodeCanvasObject}
                  nodeCanvasObjectMode={() => "replace"}
                  onNodeClick={handleNodeClick}
                  onNodeHover={handleNodeHover}
                  onNodeDragEnd={handleNodeDragEnd}
                  onNodeRightClick={handleNodeRightClick}
                  onBackgroundClick={handleBackgroundClick}
                  onZoom={handleZoom}
                  linkColor={linkColor}
                  linkWidth={(link: any) => link.width}
                  linkCanvasObject={linkCanvasObject}
                  linkCanvasObjectMode={() => "after"}
                  linkDirectionalParticles={selectedNode ? 0 : 1}
                  linkDirectionalParticleWidth={1.5}
                  linkDirectionalParticleSpeed={0.003}
                  backgroundColor="transparent"
                  cooldownTicks={80}
                  d3AlphaDecay={0.04}
                  d3VelocityDecay={0.3}
                  warmupTicks={30}
                  minZoom={0.1}
                  maxZoom={8}
                />
              )}
            </div>
          </>
        )}

        {projectId && !isLoading && (!filteredGraphData || filteredGraphData.nodes.length === 0) && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Layers className="mx-auto mb-3 h-10 w-10 text-slate-500" />
              <p className="text-sm text-slate-400">Aucune donnée à afficher</p>
              <p className="text-xs text-slate-500">Le graphe est vide ou filtré</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Fullscreen mode
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900" ref={containerRef}>
        {graphContent}
      </div>
    );
  }

  // Normal mode
  return (
    <div
      ref={containerRef}
      className="h-[600px] overflow-hidden rounded-xl border border-slate-700/50 bg-slate-900"
    >
      {graphContent}
    </div>
  );
}
