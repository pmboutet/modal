"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProjectRecord } from "@/types";
import { useClientContext } from "./ClientContext";

export type ProjectSelection = string | "all"; // Project ID or "all"

interface ProjectContextValue {
  // Current selection
  selectedProjectId: ProjectSelection;
  setSelectedProjectId: (projectId: ProjectSelection) => void;

  // Available projects (filtered by selected client)
  projects: ProjectRecord[];
  allProjects: ProjectRecord[];
  isLoading: boolean;
  error: string | null;

  // Helper to get selected project object
  selectedProject: ProjectRecord | null;

  // Check if multiple projects are available
  hasMultipleProjects: boolean;

  // Refresh projects list
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "admin-selected-project";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { selectedClientId } = useClientContext();
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<ProjectSelection>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load projects from API with retry for transient failures (HMR/Turbopack)
  const fetchProjects = useCallback(async (retries = 2) => {
    setIsLoading(true);
    setError(null);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch("/api/admin/projects", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load projects");
        }
        setAllProjects(payload.data ?? []);
        setIsLoading(false);
        return;
      } catch (err) {
        if (attempt < retries) {
          // Wait before retrying (200ms, then 400ms)
          await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
        console.error("Failed to load projects", err);
        setError(err instanceof Error ? err.message : "Unable to load projects");
        setIsLoading(false);
      }
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    fetchProjects().then(() => {
      setIsInitialized(true);
    });
  }, [fetchProjects]);

  // Filter projects by selected client
  const projects = useMemo(() => {
    if (selectedClientId === "all") {
      return allProjects;
    }
    return allProjects.filter(p => p.clientId === selectedClientId);
  }, [allProjects, selectedClientId]);

  // Load saved selection from localStorage after projects are loaded
  useEffect(() => {
    if (!isInitialized || allProjects.length === 0) return;

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // Validate the saved selection still exists
      if (saved === "all" || allProjects.some(p => p.id === saved)) {
        setSelectedProjectIdState(saved);
      } else {
        // Invalid saved selection, default to "all"
        setSelectedProjectIdState("all");
      }
    } else {
      // No saved selection, default to "all"
      setSelectedProjectIdState("all");
    }
  }, [allProjects, isInitialized]);

  // Reset to "all" when client changes if the currently selected project doesn't belong to the new client
  // Auto-select if only one project is available after filtering
  useEffect(() => {
    if (!isInitialized) return;

    if (selectedProjectId !== "all") {
      const selectedProject = allProjects.find(p => p.id === selectedProjectId);
      if (selectedProject && selectedClientId !== "all" && selectedProject.clientId !== selectedClientId) {
        // The selected project doesn't belong to the selected client, reset to "all"
        setSelectedProjectIdState("all");
        localStorage.setItem(STORAGE_KEY, "all");
      }
    } else if (projects.length === 1) {
      // Auto-select the only available project
      setSelectedProjectIdState(projects[0].id);
      localStorage.setItem(STORAGE_KEY, projects[0].id);
    }
  }, [selectedClientId, selectedProjectId, allProjects, projects, isInitialized]);

  // Save selection to localStorage when it changes
  const setSelectedProjectId = useCallback((projectId: ProjectSelection) => {
    setSelectedProjectIdState(projectId);
    localStorage.setItem(STORAGE_KEY, projectId);
  }, []);

  // Get the selected project object
  const selectedProject = useMemo(() => {
    if (selectedProjectId === "all") return null;
    return allProjects.find(p => p.id === selectedProjectId) ?? null;
  }, [allProjects, selectedProjectId]);

  const hasMultipleProjects = projects.length > 1;

  const value = useMemo<ProjectContextValue>(() => ({
    selectedProjectId,
    setSelectedProjectId,
    projects,
    allProjects,
    isLoading,
    error,
    selectedProject,
    hasMultipleProjects,
    refreshProjects: fetchProjects,
  }), [selectedProjectId, setSelectedProjectId, projects, allProjects, isLoading, error, selectedProject, hasMultipleProjects, fetchProjects]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return context;
}

// Optional hook that doesn't throw if context is not available
export function useProjectContextOptional() {
  return useContext(ProjectContext);
}
