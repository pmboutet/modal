"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check, Copy, Mail } from "lucide-react";
import { ParticipantProgressBadge } from "./ParticipantProgressBadge";
import type { ParticipantProgress } from "./types";

export interface ParticipantRowProps {
  participant: {
    id: string;
    name: string;
    email?: string | null;
    role?: string | null;
    inviteToken?: string | null;
  };
  /** Whether this participant is selected */
  selected: boolean;
  /** Toggle selection callback */
  onToggle: () => void;
  /** Disable interactions */
  disabled?: boolean;
  /** Progress data (null if no plan yet or shared mode) */
  progress?: ParticipantProgress | null;
  /** Show progress badge (false for shared modes where progress is in header) */
  showProgress?: boolean;
  /** Whether the participant has responded (has at least one insight) */
  hasResponded?: boolean;
  /** Ask key for generating invite link */
  askKey?: string;
  /** Callback after copying link */
  onCopyLink?: (participantId: string) => void;
  /** Callback for sending invite email */
  onSendInvite?: (participantId: string) => void;
  className?: string;
}

/**
 * Generate invite link for a participant
 */
function getInviteLink(askKey: string, inviteToken?: string | null): string | null {
  const envBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const origin = typeof window !== "undefined" && window?.location?.origin
    ? window.location.origin.replace(/\/+$/, "")
    : "";
  const baseUrl = envBase || origin;
  if (!baseUrl) return null;

  const params = new URLSearchParams();
  if (inviteToken) {
    params.set("token", inviteToken);
  } else if (askKey) {
    params.set("key", askKey);
  }
  const query = params.toString();
  return query ? `${baseUrl}/?${query}` : null;
}

/**
 * Unified participant row component
 * Displays: checkbox + name + role + progress + actions (copy/send invite)
 * Actions are only visible when participant is selected
 */
export function ParticipantRow({
  participant,
  selected,
  onToggle,
  disabled = false,
  progress,
  showProgress = true,
  hasResponded = false,
  askKey,
  onCopyLink,
  onSendInvite,
  className,
}: ParticipantRowProps) {
  const [isCopied, setIsCopied] = useState(false);

  const inviteLink = askKey ? getInviteLink(askKey, participant.inviteToken) : null;

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setIsCopied(true);
      onCopyLink?.(participant.id);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Silently fail if clipboard not available
    }
  }, [inviteLink, participant.id, onCopyLink]);

  const handleSendInvite = useCallback(() => {
    onSendInvite?.(participant.id);
  }, [participant.id, onSendInvite]);

  // Display name: prefer name, fallback to email
  const displayName = participant.name || participant.email || participant.id;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
        selected
          ? "border-indigo-400/50 bg-indigo-500/10"
          : "border-white/10 bg-slate-950/40 hover:border-white/20",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {/* Checkbox */}
      <label className="flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={disabled}
          className="h-4 w-4 rounded border-white/30 bg-slate-900 text-indigo-500 focus:ring-indigo-400 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      {/* Name & Role */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm font-medium truncate",
          selected ? "text-white" : "text-slate-200"
        )}>
          {displayName}
        </p>
        {participant.role && (
          <p className="text-xs text-slate-400 truncate">
            {participant.role}
          </p>
        )}
      </div>

      {/* Progress/Response indicator */}
      {showProgress && (
        (() => {
          // Show plan progress if we have meaningful progress data (active or completed plan)
          const hasMeaningfulProgress = progress && (progress.isActive || progress.isCompleted || progress.completedSteps > 0);

          if (hasMeaningfulProgress) {
            return (
              <ParticipantProgressBadge
                completedSteps={progress!.completedSteps}
                totalSteps={progress!.totalSteps}
                isCompleted={progress!.isCompleted}
                isActive={progress!.isActive}
                size="sm"
                className="shrink-0"
              />
            );
          }

          // Show responded checkmark if participant has submitted insights
          if (hasResponded) {
            return (
              <span
                className="inline-flex items-center gap-1 rounded text-xs px-1.5 py-0.5 font-medium text-emerald-400 shrink-0"
                title="A répondu"
              >
                <Check className="h-3 w-3" />
              </span>
            );
          }

          // Show not started indicator
          return (
            <span className="inline-flex items-center rounded text-xs px-1.5 py-0.5 font-medium text-slate-500 shrink-0">
              --
            </span>
          );
        })()
      )}

      {/* Actions (only visible when selected) */}
      {selected && (
        <div className="flex items-center gap-1 shrink-0">
          {/* Copy invite link */}
          {inviteLink && (
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={disabled}
              className="rounded p-1.5 text-slate-400 transition hover:bg-slate-800/60 hover:text-white disabled:opacity-50"
              title="Copy invite link"
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {/* Send invite email */}
          {onSendInvite && participant.email && (
            <button
              type="button"
              onClick={handleSendInvite}
              disabled={disabled}
              className="rounded p-1.5 text-slate-400 transition hover:bg-slate-800/60 hover:text-white disabled:opacity-50"
              title="Send invite email"
            >
              <Mail className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
