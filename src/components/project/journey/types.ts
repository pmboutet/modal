/**
 * Type definitions for the ProjectJourneyBoard component
 * Extracted for better maintainability
 */

import type {
  AskConversationMode,
  AskDeliveryMode,
  ProjectChallengeNode,
  ProjectParticipantInsight,
  ProjectParticipantSummary,
} from "@/types";
import type { ChallengeStatus, AskStatus } from "./constants";
import { generateAskKey } from "./utils/formatters";

// ===== Component Props =====

export interface ProjectJourneyBoardProps {
  projectId: string;
  /** Optional callback when user clicks close button (only shown in embedded mode) */
  onClose?: () => void;
}

// ===== Insight Row Types =====

export interface ChallengeInsightRow extends ProjectParticipantInsight {
  contributors: ProjectParticipantSummary[];
  askId: string;
  askTitle: string;
}

export interface AskInsightRow extends ProjectParticipantInsight {
  contributors: ProjectParticipantSummary[];
}

// ===== Feedback State =====

export interface FeedbackState {
  type: "success" | "error";
  message: string;
}

// ===== Form States =====

export type ProjectEditState = {
  name: string;
  description: string;
  status: string;
  startDate: string;
  endDate: string;
  systemPrompt: string;
};

export type ChallengeFormState = {
  title: string;
  description: string;
  status: ChallengeStatus;
  impact: ProjectChallengeNode["impact"];
  ownerIds: string[];
  parentId: string;
};

export type AskFormState = {
  challengeId: string;
  askKey: string;
  name: string;
  question: string;
  description: string;
  status: AskStatus;
  startDate: string;
  endDate: string;
  allowAutoRegistration: boolean;
  maxParticipants: string;
  participantIds: string[];
  spokespersonId: string;
  deliveryMode: AskDeliveryMode;
  conversationMode: AskConversationMode;
  systemPrompt: string;
  expectedDurationMinutes: number;
};

// ===== Form Factory Functions =====

export function createEmptyChallengeForm(): ChallengeFormState {
  return {
    title: "",
    description: "",
    status: "open",
    impact: "medium",
    ownerIds: [],
    parentId: "",
  };
}

export function createEmptyAskForm(challengeId?: string): AskFormState {
  const now = new Date();
  const defaultStart = now.toISOString();
  const defaultEnd = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  return {
    challengeId: challengeId ?? "",
    askKey: generateAskKey("ask"),
    name: "",
    question: "",
    description: "",
    status: "active",
    startDate: defaultStart,
    endDate: defaultEnd,
    allowAutoRegistration: false,
    maxParticipants: "",
    participantIds: [],
    spokespersonId: "",
    deliveryMode: "digital",
    conversationMode: "individual_parallel",
    systemPrompt: "",
    expectedDurationMinutes: 8,
  };
}

// ===== Utility Functions =====

export function normalizeAskStatus(value?: string | null): AskStatus {
  if (!value) {
    return "active";
  }
  const normalized = value as AskStatus;
  const validStatuses: AskStatus[] = ["active", "inactive", "draft", "closed"];
  return validStatuses.includes(normalized) ? normalized : "active";
}
