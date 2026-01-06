/**
 * Zod validation schemas for AdminDashboard forms
 * Extracted for better maintainability and reusability
 */

import { z } from "zod";

// ===== Status Constants =====

export const projectStatuses = ["active", "paused", "completed", "archived"] as const;
export const challengeStatuses = ["open", "in_progress", "active", "closed", "archived"] as const;
export const challengePriorities = ["low", "medium", "high", "critical"] as const;
export const askStatuses = ["active", "inactive", "draft", "closed"] as const;
export const deliveryModes = ["physical", "digital"] as const;
export const conversationModes = ["individual_parallel", "collaborative", "group_reporter", "consultant"] as const;
export const userRoles = ["full_admin", "client_admin", "facilitator", "manager", "participant"] as const;

// ===== Form Schemas =====

export const clientFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  email: z.string().trim().email("Invalid email address").max(255).optional().or(z.literal("")),
  company: z.string().trim().max(255).optional().or(z.literal("")),
  industry: z.string().trim().max(100).optional().or(z.literal("")),
  status: z.enum(["active", "inactive"]).default("active")
});

export const projectFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  description: z.string().trim().max(10000).optional().or(z.literal("")),
  startDate: z.string().trim().min(1, "Start date is required"),
  endDate: z.string().trim().min(1, "End date is required"),
  status: z.enum(projectStatuses),
  createdBy: z.string().trim().optional().or(z.literal(""))
});

export const challengeFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  status: z.enum(challengeStatuses),
  priority: z.enum(challengePriorities),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  assignedTo: z.string().trim().optional().or(z.literal("")),
  dueDate: z.string().trim().optional().or(z.literal(""))
});

export const askFormSchema = z.object({
  askKey: z.string().trim().min(3, "Key is required").max(255).regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(1, "Name is required").max(255),
  question: z.string().trim().min(5, "Question is too short").max(2000),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  startDate: z.string().trim().min(1, "Start date is required"),
  endDate: z.string().trim().min(1, "End date is required"),
  status: z.enum(askStatuses),
  allowAutoRegistration: z.boolean().default(false),
  maxParticipants: z
    .preprocess(value => (value === "" || value === undefined || value === null ? undefined : Number(value)), z
      .number()
      .int()
      .positive()
      .max(10000)
      .optional()
    ),
  deliveryMode: z.enum(deliveryModes),
  conversationMode: z.enum(conversationModes),
  expectedDurationMinutes: z.number().int().min(1).max(30).default(8),
  participantIds: z.array(z.string().uuid()).default([]),
  participantEmails: z.array(z.string().email()).default([]),
  spokespersonId: z.string().uuid().optional().or(z.literal("")),
  spokespersonEmail: z.string().email().optional().or(z.literal("")),
  systemPrompt: z.string().trim().optional().or(z.literal(""))
});

export const userFormSchema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  fullName: z.string().trim().max(200).optional().or(z.literal("")),
  firstName: z.string().trim().max(100).optional().or(z.literal("")),
  lastName: z.string().trim().max(100).optional().or(z.literal("")),
  role: z.enum(userRoles).default("participant"),
  clientId: z.string().trim().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  jobTitle: z.string().trim().max(255).optional().or(z.literal(""))
});

// ===== Inferred Types =====

export type ClientFormInput = z.infer<typeof clientFormSchema>;
export type ProjectFormInput = z.infer<typeof projectFormSchema>;
export type ChallengeFormInput = z.infer<typeof challengeFormSchema>;
export type AskFormInput = z.infer<typeof askFormSchema>;
export type UserFormInput = z.infer<typeof userFormSchema>;

// ===== Default Form Values =====

export const defaultClientFormValues: ClientFormInput = {
  name: "",
  email: "",
  company: "",
  industry: "",
  status: "active"
};

export const defaultProjectFormValues: ProjectFormInput = {
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  status: "active",
  createdBy: ""
};

export const defaultAskFormValues: AskFormInput = {
  askKey: "",
  name: "",
  question: "",
  description: "",
  startDate: "",
  endDate: "",
  status: "active",
  allowAutoRegistration: false,
  maxParticipants: undefined,
  deliveryMode: "digital",
  conversationMode: "collaborative",
  expectedDurationMinutes: 8,
  participantIds: [],
  participantEmails: [],
  spokespersonId: "",
  spokespersonEmail: "",
  systemPrompt: ""
};

export const defaultUserFormValues: UserFormInput = {
  email: "",
  fullName: "",
  firstName: "",
  lastName: "",
  role: "participant",
  clientId: "",
  isActive: true,
  jobTitle: ""
};
