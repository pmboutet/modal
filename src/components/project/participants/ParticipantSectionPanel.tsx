"use client";

import { cn } from "@/lib/utils";
import { Users, ChevronRight, Loader2, Save, UserPlus, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ParticipantList } from "./ParticipantList";
import { SpokespersonSelector } from "./SpokespersonSelector";
import type { ParticipantProgressData } from "./types";
import type { AskConversationMode, AskParticipant } from "@/types";

export interface ParticipantSectionPanelProps {
  /** ASK ID for this session */
  askId: string;
  /** ASK key for generating invite links */
  askKey: string;
  /** Conversation mode determines UI behavior */
  conversationMode: AskConversationMode;
  /** Existing participants with their data */
  participants: AskParticipant[];
  /** All available users that can be added */
  availableUsers: Array<{
    id: string;
    name: string;
    role?: string;
  }>;
  /** Currently selected participant IDs (from edit state) */
  selectedIds: string[];
  /** Initial participant count (before edit state is loaded) */
  initialParticipantCount?: number;
  /** Selected spokesperson ID (for group modes) */
  spokespersonId: string;
  /** Toggle participant selection */
  onParticipantToggle: (userId: string) => void;
  /** Change spokesperson selection */
  onSpokespersonChange: (id: string) => void;
  /** Save participants */
  onSave: () => void;
  /** Send invites to all selected participants */
  onSendAllInvites: () => void;
  /** Open dialog to add new participant */
  onAddParticipant: () => void;
  /** Close/collapse the panel */
  onClose: () => void;
  /** Whether the panel is expanded */
  isExpanded: boolean;
  /** Toggle expand/collapse */
  onToggleExpand: () => void;
  /** Loading state for initial data */
  isLoading?: boolean;
  /** Saving participants in progress */
  isSaving?: boolean;
  /** Sending invites in progress */
  isSendingInvites?: boolean;
  /** Progress data for participants */
  progressData?: ParticipantProgressData | null;
  /** IDs of participants who have responded (have at least one insight) */
  respondedParticipantIds?: Set<string>;
  className?: string;
}

/**
 * Main expandable panel for participant management
 * Composes: ParticipantList + SpokespersonSelector + action buttons
 */
export function ParticipantSectionPanel({
  askId,
  askKey,
  conversationMode,
  participants,
  availableUsers,
  selectedIds,
  initialParticipantCount,
  spokespersonId,
  onParticipantToggle,
  onSpokespersonChange,
  onSave,
  onSendAllInvites,
  onAddParticipant,
  onClose,
  isExpanded,
  onToggleExpand,
  isLoading = false,
  isSaving = false,
  isSendingInvites = false,
  progressData,
  respondedParticipantIds,
  className,
}: ParticipantSectionPanelProps) {
  // Use selectedIds if available, otherwise fall back to initial count or participants
  const selectedCount = selectedIds.length > 0
    ? selectedIds.length
    : (initialParticipantCount ?? participants.length);
  const showSpokespersonSelector =
    (conversationMode === "group_reporter" || conversationMode === "consultant") &&
    selectedCount > 0;

  // Merge available users with participant data (for invite tokens, emails)
  const participantsWithData = availableUsers.map((user) => {
    const participantData = participants.find((p) => p.id === user.id || p.userId === user.id);
    return {
      id: user.id,
      name: user.name,
      email: participantData?.email ?? null,
      role: user.role ?? participantData?.role ?? null,
      inviteToken: participantData?.inviteToken ?? null,
    };
  });

  // Get selected participants for spokesperson dropdown
  const selectedParticipants = participantsWithData.filter((p) =>
    selectedIds.includes(p.id)
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden",
        className
      )}
    >
      {/* Expandable Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-indigo-500/10 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
      >
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-indigo-300" />
          <span className="text-sm font-semibold text-indigo-200">
            Participants ({selectedCount})
          </span>
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 text-indigo-300 transition-transform",
            isExpanded && "rotate-90"
          )}
        />
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div
          className="border-t border-indigo-500/20 p-4 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
              Loading participants...
            </div>
          ) : (
            <>
              {/* Participant List */}
              <ParticipantList
                participants={participantsWithData}
                selectedIds={selectedIds}
                onToggle={onParticipantToggle}
                askKey={askKey}
                disabled={isSaving}
                progressData={progressData}
                conversationMode={conversationMode}
                respondedParticipantIds={respondedParticipantIds}
              />

              {/* Add Participant Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAddParticipant}
                disabled={isSaving}
                className="gap-1.5 border-indigo-400/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20"
              >
                <UserPlus className="h-4 w-4" />
                Ajouter un participant
              </Button>

              {/* Spokesperson Selector (for group modes) */}
              {showSpokespersonSelector && (
                <SpokespersonSelector
                  label={
                    conversationMode === "consultant"
                      ? "Facilitator (voit les questions suggérées)"
                      : "Spokesperson (rapporteur)"
                  }
                  participants={selectedParticipants}
                  selectedId={spokespersonId}
                  onSelect={onSpokespersonChange}
                  disabled={isSaving}
                  id={`spokesperson-${askId}`}
                />
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                <Button
                  type="button"
                  size="sm"
                  onClick={onSave}
                  disabled={isSaving}
                  className="gap-1"
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Enregistrer
                </Button>

                {selectedCount > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onSendAllInvites}
                    disabled={isSendingInvites || isSaving}
                    className="gap-1 border-indigo-400/40 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30"
                  >
                    {isSendingInvites ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Mail className="h-3 w-3" />
                    )}
                    Envoyer les invites
                  </Button>
                )}

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  disabled={isSaving}
                  className="text-slate-400 hover:text-white"
                >
                  Fermer
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
