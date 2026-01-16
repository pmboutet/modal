"use client";

import { cn } from "@/lib/utils";
import { ParticipantRow } from "./ParticipantRow";
import { ParticipantProgressBadge } from "./ParticipantProgressBadge";
import type { ParticipantProgress, ParticipantProgressData } from "./types";
import { isSharedProgressMode, getParticipantProgress } from "./types";
import type { AskConversationMode } from "@/types";

export interface ParticipantListProps {
  /** All available participants */
  participants: Array<{
    id: string;
    name: string;
    email?: string | null;
    role?: string | null;
    inviteToken?: string | null;
  }>;
  /** IDs of selected participants */
  selectedIds: string[];
  /** Toggle participant selection */
  onToggle: (id: string) => void;
  /** Ask key for generating invite links */
  askKey: string;
  /** Disable all interactions */
  disabled?: boolean;
  /** Progress data for participants */
  progressData?: ParticipantProgressData | null;
  /** Conversation mode determines progress display */
  conversationMode: AskConversationMode;
  /** Callback after copying a link */
  onCopyLink?: (participantId: string) => void;
  /** Callback for sending invite to a participant */
  onSendInvite?: (participantId: string) => void;
  /** IDs of participants who have responded (have at least one insight) */
  respondedParticipantIds?: Set<string>;
  className?: string;
}

/**
 * List of participants with unified header
 * Shows shared progress in header for collaborative modes
 * Shows individual progress per row for individual_parallel mode
 */
export function ParticipantList({
  participants,
  selectedIds,
  onToggle,
  askKey,
  disabled = false,
  progressData,
  conversationMode,
  onCopyLink,
  onSendInvite,
  respondedParticipantIds,
  className,
}: ParticipantListProps) {
  const selectedCount = selectedIds.length;
  const totalCount = participants.length;
  const isSharedMode = isSharedProgressMode(conversationMode);
  const sharedProgress = isSharedMode ? progressData?.shared : null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header with count and optional shared progress */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">
          {selectedCount}/{totalCount} sélectionnés
        </span>

        {/* Shared progress badge for collaborative modes */}
        {isSharedMode && sharedProgress && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Progression:</span>
            <ParticipantProgressBadge
              completedSteps={sharedProgress.completedSteps}
              totalSteps={sharedProgress.totalSteps}
              isCompleted={sharedProgress.isCompleted}
              isActive={sharedProgress.isActive}
              size="sm"
            />
          </div>
        )}
      </div>

      {/* Participant rows */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {participants.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">
            No collaborators available for this project yet.
          </p>
        ) : (
          participants.map((participant) => {
            const isSelected = selectedIds.includes(participant.id);
            // For individual mode, get participant-specific progress
            // For shared mode, don't show progress per row (it's in header)
            const progress = !isSharedMode
              ? getParticipantProgress(participant.id, progressData)
              : null;
            const hasResponded = respondedParticipantIds?.has(participant.id) ?? false;

            return (
              <ParticipantRow
                key={participant.id}
                participant={participant}
                selected={isSelected}
                onToggle={() => onToggle(participant.id)}
                disabled={disabled}
                progress={progress}
                showProgress={!isSharedMode}
                hasResponded={hasResponded}
                askKey={askKey}
                onCopyLink={onCopyLink}
                onSendInvite={onSendInvite}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
