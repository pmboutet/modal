/**
 * Centralized module color definitions for the admin interface.
 * Use these colors consistently across all admin pages.
 *
 * Module Color Mapping:
 * - Conversation (chat): Blue
 * - Insight Detection: Yellow/Gold
 * - ASK Generator: Emerald
 * - Challenge Builder: Indigo
 * - Models Config: Purple
 * - Rapport & Synthesis: Violet
 * - Security: Red
 */

export interface ModuleColorScheme {
  border: string;
  bg: string;
  text: string;
  badge: string;
  icon?: string;
}

// Agent group colors (used in admin/ai page for agent sections)
export const agentGroupColors: Record<string, ModuleColorScheme> = {
  conversation: {
    border: "border-blue-400/40",
    bg: "bg-blue-500/10",
    text: "text-blue-700 dark:text-blue-200",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    icon: "text-blue-400",
  },
  "insight-detection": {
    border: "border-yellow-400/40",
    bg: "bg-yellow-500/10",
    text: "text-yellow-700 dark:text-yellow-200",
    badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    icon: "text-yellow-400",
  },
  "ask-generator": {
    border: "border-emerald-400/40",
    bg: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-200",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    icon: "text-emerald-400",
  },
  "challenge-builder": {
    border: "border-indigo-400/40",
    bg: "bg-indigo-500/10",
    text: "text-indigo-700 dark:text-indigo-200",
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    icon: "text-indigo-400",
  },
  "models-config": {
    border: "border-purple-400/40",
    bg: "bg-purple-500/10",
    text: "text-purple-700 dark:text-purple-200",
    badge: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    icon: "text-purple-400",
  },
  rapport: {
    border: "border-violet-400/40",
    bg: "bg-violet-500/10",
    text: "text-violet-700 dark:text-violet-200",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
    icon: "text-violet-400",
  },
};

// Simple color scheme for logs (without dark mode variants)
export interface LogModuleColor {
  border: string;
  bg: string;
  text: string;
  icon: string;
}

/**
 * Get module color based on interaction type (for logs page)
 */
export function getModuleColorByInteractionType(interactionType: string): LogModuleColor {
  // Conversation (chat): Blue
  if (interactionType.startsWith("ask.chat")) {
    return {
      border: "border-blue-400/40",
      bg: "bg-blue-500/10",
      text: "text-blue-400",
      icon: "text-blue-400",
    };
  }

  // Insight Detection: Yellow/Gold
  if (interactionType.includes("insight") || interactionType.includes("entity")) {
    return {
      border: "border-yellow-400/40",
      bg: "bg-yellow-500/10",
      text: "text-yellow-400",
      icon: "text-yellow-400",
    };
  }

  // ASK Generator: Emerald
  if (interactionType.includes("challenge.ask.generator")) {
    return {
      border: "border-emerald-400/40",
      bg: "bg-emerald-500/10",
      text: "text-emerald-400",
      icon: "text-emerald-400",
    };
  }

  // Challenge Builder: Indigo
  if (interactionType.startsWith("project_challenge")) {
    return {
      border: "border-indigo-400/40",
      bg: "bg-indigo-500/10",
      text: "text-indigo-400",
      icon: "text-indigo-400",
    };
  }

  // Security: Red
  if (interactionType.startsWith("security")) {
    return {
      border: "border-red-400/40",
      bg: "bg-red-500/10",
      text: "text-red-400",
      icon: "text-red-400",
    };
  }

  // Rapport & Synthesis: Violet
  if (interactionType.includes("rapport") || interactionType.includes("synthesis") || interactionType.includes("comparison")) {
    return {
      border: "border-violet-400/40",
      bg: "bg-violet-500/10",
      text: "text-violet-400",
      icon: "text-violet-400",
    };
  }

  // Default: Slate
  return {
    border: "border-slate-400/40",
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    icon: "text-slate-400",
  };
}

// Status colors (for logs)
export const statusColors = {
  pending: "bg-yellow-500/20 text-yellow-300 border border-yellow-400/30",
  processing: "bg-blue-500/20 text-blue-300 border border-blue-400/30",
  completed: "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30",
  failed: "bg-red-500/20 text-red-300 border border-red-400/30",
} as const;
