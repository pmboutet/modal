"use client";

import { useEffect, useRef, useState } from "react";
import { type ClientFormValues } from "./ClientManager";
import { type UserFormValues } from "./UserManager";
import { type ProjectFormValues } from "./ProjectManager";
import { type ChallengeFormValues } from "./ChallengeEditor";
import type { AskDeliveryMode, AskConversationMode } from "@/types";

// Types moved inline after removing AskCreateForm and AskEditForm
export interface AskCreateFormValues {
  challengeId: string;
  askKey: string;
  name: string;
  question: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: string;
  allowAutoRegistration: boolean;
  maxParticipants?: number;
  deliveryMode: AskDeliveryMode;
  conversationMode: AskConversationMode;
  expectedDurationMinutes: number;
  participantIds: string[];
  spokespersonId?: string;
}

export interface AskEditFormValues {
  askId: string;
  name: string;
  question: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: string;
  allowAutoRegistration: boolean;
  maxParticipants?: number;
  deliveryMode: AskDeliveryMode;
  conversationMode: AskConversationMode;
  expectedDurationMinutes: number;
  participantIds: string[];
  spokespersonId?: string;
  systemPrompt?: string;
}
import {
  type AskSessionRecord,
  type ChallengeRecord,
  type ClientRecord,
  type ManagedUser,
  type ProjectRecord
} from "@/types";

export interface FeedbackState {
  type: "success" | "error";
  message: string;
}

export async function adminRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const errorMessage = payload.error || payload.message || `Request failed with status ${response.status}`;
    console.error("Request error:", {
      url,
      status: response.status,
      payload,
      errorMessage
    });
    throw new Error(errorMessage);
  }
  return payload.data as T;
}

export function useAdminResources() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [challenges, setChallenges] = useState<ChallengeRecord[]>([]);
  const [asks, setAsks] = useState<AskSessionRecord[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    // Prevent multiple simultaneous loads
    if (isLoadingRef.current) {
      return;
    }
    isLoadingRef.current = true;

    const loadInitial = async () => {
      try {
        const results = await Promise.allSettled([
          adminRequest<ClientRecord[]>("/api/admin/clients"),
          adminRequest<ManagedUser[]>("/api/admin/profiles"),
          adminRequest<ProjectRecord[]>("/api/admin/projects"),
          adminRequest<ChallengeRecord[]>("/api/admin/challenges"),
          adminRequest<AskSessionRecord[]>("/api/admin/asks")
        ]);

        const [clientResult, userResult, projectResult, challengeResult, askResult] = results;
        const errors: string[] = [];

        if (clientResult.status === "fulfilled") {
          setClients(clientResult.value ?? []);
        } else {
          errors.push(
            clientResult.reason instanceof Error
              ? clientResult.reason.message
              : typeof clientResult.reason === "string"
                ? clientResult.reason
                : "Unable to load clients"
          );
        }

        if (userResult.status === "fulfilled") {
          setUsers(userResult.value ?? []);
        } else {
          errors.push(
            userResult.reason instanceof Error
              ? userResult.reason.message
              : typeof userResult.reason === "string"
                ? userResult.reason
                : "Unable to load users"
          );
        }

        if (projectResult.status === "fulfilled") {
          setProjects(projectResult.value ?? []);
        } else {
          errors.push(
            projectResult.reason instanceof Error
              ? projectResult.reason.message
              : typeof projectResult.reason === "string"
                ? projectResult.reason
                : "Unable to load projects"
          );
        }

        if (challengeResult.status === "fulfilled") {
          setChallenges(challengeResult.value ?? []);
        } else {
          errors.push(
            challengeResult.reason instanceof Error
              ? challengeResult.reason.message
              : typeof challengeResult.reason === "string"
                ? challengeResult.reason
                : "Unable to load challenges"
          );
        }

        if (askResult.status === "fulfilled") {
          setAsks(askResult.value ?? []);
        } else {
          errors.push(
            askResult.reason instanceof Error
              ? askResult.reason.message
              : typeof askResult.reason === "string"
                ? askResult.reason
                : "Unable to load ASK sessions"
          );
        }

        if (errors.length > 0) {
          setFeedback({
            type: "error",
            message: `Some data could not be loaded: ${Array.from(new Set(errors)).join(", ")}`
          });
        }
      } catch (error) {
        setFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Unable to load admin resources"
        });
      } finally {
        setIsLoading(false);
        isLoadingRef.current = false;
      }
    };

    void loadInitial();
  }, []);

  const handleAction = async (action: () => Promise<void>, successMessage: string) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ type: "success", message: successMessage });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "An error occurred"
      });
    } finally {
      setIsBusy(false);
    }
  };

  const refreshChallenges = async () => {
    const data = await adminRequest<ChallengeRecord[]>("/api/admin/challenges");
    setChallenges(data ?? []);
  };

  const refreshAsks = async () => {
    const data = await adminRequest<AskSessionRecord[]>("/api/admin/asks");
    setAsks(data ?? []);
  };

  const refreshProjects = async () => {
    const data = await adminRequest<ProjectRecord[]>("/api/admin/projects");
    setProjects(data ?? []);
  };

  const refreshUsers = async () => {
    const data = await adminRequest<ManagedUser[]>("/api/admin/profiles");
    setUsers(data ?? []);
  };

  const refreshClients = async () => {
    const data = await adminRequest<ClientRecord[]>("/api/admin/clients");
    setClients(data ?? []);
  };

  const createClient = (values: ClientFormValues) =>
    handleAction(async () => {
      await adminRequest("/api/admin/clients", { method: "POST", body: JSON.stringify(values) });
      const data = await adminRequest<ClientRecord[]>("/api/admin/clients");
      setClients(data ?? []);
    }, "Client created successfully");

  const updateClient = (clientId: string, values: ClientFormValues) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/clients/${clientId}`, { method: "PATCH", body: JSON.stringify(values) });
      await refreshClients();
    }, "Client updated");

  const createUser = (values: UserFormValues) =>
    handleAction(async () => {
      await adminRequest("/api/admin/profiles", { method: "POST", body: JSON.stringify(values) });
      await refreshUsers();
    }, "User created");

  const updateUser = (userId: string, values: Partial<UserFormValues>) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/profiles/${userId}`, { method: "PATCH", body: JSON.stringify(values) });
      await refreshUsers();
    }, "User updated");

  const deleteUser = (userId: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/profiles/${userId}`, { method: "DELETE" });
      await refreshUsers();
    }, "User removed");

  const findUserByEmail = async (email: string): Promise<ManagedUser | null> => {
    try {
      const data = await adminRequest<ManagedUser | null>(`/api/admin/profiles?email=${encodeURIComponent(email)}`);
      return data;
    } catch (error) {
      // If user not found, return null instead of throwing
      if (error instanceof Error && error.message.includes("not found")) {
        return null;
      }
      throw error;
    }
  };

  const addUserToProject = (userId: string, projectId: string, jobTitle?: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId, jobTitle })
      });
      await refreshUsers();
    }, "User added to project");

  const createUserAndAddToProject = async (
    email: string,
    projectId: string,
    clientId?: string,
    jobTitle?: string
  ): Promise<ManagedUser | null> => {
    setIsBusy(true);
    setFeedback(null);
    try {
      console.log("Creating user with:", { email, projectId, clientId, jobTitle });
      
      // Create user with minimal data
      const payload: {
        email: string;
        role: string;
        isActive: boolean;
        clientId?: string;
        jobTitle?: string;
      } = {
        email,
        role: "participant", // Default role that matches the database enum
        isActive: true
      };
      
      if (clientId) {
        payload.clientId = clientId;
      }
      
      if (jobTitle && jobTitle.trim()) {
        payload.jobTitle = jobTitle.trim();
      }
      
      console.log("Payload:", payload);
      
      const newUser = await adminRequest<ManagedUser>("/api/admin/profiles", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      console.log("User created:", newUser);

      // Add to project
      await adminRequest(`/api/admin/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: newUser.id, jobTitle: jobTitle || "" })
      });

      console.log("User added to project");

      // Refresh both users and projects to ensure the relationship is visible
      await Promise.all([refreshUsers(), refreshProjects()]);
      
      console.log("Data refreshed");
      
      // Update projectIds on the returned user to reflect the new membership
      const updatedUser: ManagedUser = {
        ...newUser,
        projectIds: [...(newUser.projectIds || []), projectId].sort()
      };
      
      setFeedback({ type: "success", message: "User created and added to project" });
      return updatedUser;
    } catch (error) {
      console.error("Error creating user:", error);
      let errorMessage = "An error occurred";
      
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      } else if (error && typeof error === "object" && "message" in error) {
        errorMessage = String(error.message);
      }
      
      console.error("Error message:", errorMessage);
      console.error("Full error object:", JSON.stringify(error, null, 2));
      
      setFeedback({
        type: "error",
        message: errorMessage || "Failed to create user. Please check the console for details."
      });
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const addUserToClient = (userId: string, clientId: string, jobTitle?: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/clients/${clientId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId, jobTitle })
      });
      await refreshUsers();
    }, "User added to client");

  const removeUserFromClient = (userId: string, clientId: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/clients/${clientId}/members/${userId}`, {
        method: "DELETE"
      });
      await refreshUsers();
    }, "User removed from client");

  const updateClientMemberJob = (userId: string, clientId: string, jobTitle: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/clients/${clientId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ jobTitle })
      });
      await refreshUsers();
    }, "Client member job title updated");

  const removeUserFromProject = (userId: string, projectId: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/projects/${projectId}/members/${userId}`, {
        method: "DELETE"
      });
      await refreshUsers();
    }, "User removed from project");

  const createProject = (values: ProjectFormValues) =>
    handleAction(async () => {
      await adminRequest("/api/admin/projects", { method: "POST", body: JSON.stringify(values) });
      const data = await adminRequest<ProjectRecord[]>("/api/admin/projects");
      setProjects(data ?? []);
    }, "Project saved");

  const updateProject = (projectId: string, values: ProjectFormValues | Partial<ProjectFormValues>) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(values) });
      await refreshProjects();
    }, "Project updated");

  const updateChallenge = (challengeId: string, values: ChallengeFormValues) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/challenges/${challengeId}`, { method: "PATCH", body: JSON.stringify(values) });
      await refreshChallenges();
    }, "Challenge updated");

  const createAsk = (values: AskCreateFormValues & { projectId: string }) =>
    handleAction(async () => {
      await adminRequest("/api/admin/asks", { method: "POST", body: JSON.stringify(values) });
      await refreshAsks();
    }, "ASK session created");

  const updateAsk = (askId: string, values: Omit<AskEditFormValues, "askId">) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/asks/${askId}`, { method: "PATCH", body: JSON.stringify(values) });
      await refreshAsks();
    }, "ASK session updated");

  const deleteClient = (clientId: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/clients/${clientId}`, { method: "DELETE" });
      await Promise.all([refreshClients(), refreshProjects(), refreshChallenges(), refreshAsks()]);
    }, "Client removed");

  const deleteProject = (projectId: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/projects/${projectId}`, { method: "DELETE" });
      await Promise.all([refreshProjects(), refreshChallenges(), refreshAsks()]);
    }, "Project removed");

  const deleteChallenge = (challengeId: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/challenges/${challengeId}`, { method: "DELETE" });
      await Promise.all([refreshChallenges(), refreshAsks()]);
    }, "Challenge removed");

  const deleteAsk = (askId: string) =>
    handleAction(async () => {
      await adminRequest(`/api/admin/asks/${askId}`, { method: "DELETE" });
      await refreshAsks();
    }, "ASK session removed");

  return {
    clients,
    users,
    projects,
    challenges,
    asks,
    feedback,
    setFeedback,
    isLoading,
    isBusy,
    createClient,
    updateClient,
    createUser,
    updateUser,
    createProject,
    updateProject,
    updateChallenge,
    createAsk,
    updateAsk,
    deleteUser,
    deleteClient,
    deleteProject,
    deleteChallenge,
    deleteAsk,
    findUserByEmail,
    addUserToProject,
    removeUserFromProject,
    createUserAndAddToProject,
    addUserToClient,
    removeUserFromClient,
    updateClientMemberJob,
    refreshAsks,
    refreshUsers
  };
}
