"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Loader2, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AskSessionRecord } from "@/types";
import { formatDateTime, formatDisplayValue } from "../utils";

export interface AskDetailDialogProps {
  ask: AskSessionRecord | null;
  projectName?: string | null;
  challengeName?: string | null;
  onClose: () => void;
}

export function AskDetailDialog({ ask, projectName, challengeName, onClose }: AskDetailDialogProps) {
  const [isSendingInvites, setIsSendingInvites] = useState(false);
  const [sendInvitesResult, setSendInvitesResult] = useState<{ sent: number; failed: number } | null>(null);
  const [copiedLinks, setCopiedLinks] = useState<Set<string>>(new Set());
  const [copiedPublicLink, setCopiedPublicLink] = useState(false);

  // Generate the public registration link for auto-registration
  const generatePublicRegistrationUrl = (askKey: string): string => {
    const baseUrl = typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin)
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return `${baseUrl}/?ask=${askKey}`;
  };

  // Generate participant link URL with token (direct access)
  const generateMagicLinkUrl = (participantToken?: string | null): string | null => {
    if (!participantToken) return null;

    const baseUrl = typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin)
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    return `${baseUrl}/?token=${participantToken}`;
  };

  const handleSendInvites = async () => {
    if (!ask) return;

    setIsSendingInvites(true);
    setSendInvitesResult(null);

    try {
      const response = await fetch(`/api/admin/asks/${ask.id}/send-invites`, {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        setSendInvitesResult({
          sent: data.data.sent,
          failed: data.data.failed,
        });
      } else {
        setSendInvitesResult({
          sent: 0,
          failed: ask.participants?.length || 0,
        });
      }
    } catch (error) {
      console.error("Failed to send invites:", error);
      setSendInvitesResult({
        sent: 0,
        failed: ask.participants?.length || 0,
      });
    } finally {
      setIsSendingInvites(false);
    }
  };

  const copyToClipboard = async (text: string, participantId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLinks(prev => new Set([...prev, participantId]));
      setTimeout(() => {
        setCopiedLinks(prev => {
          const next = new Set(prev);
          next.delete(participantId);
          return next;
        });
      }, 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const copyPublicLink = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPublicLink(true);
      setTimeout(() => setCopiedPublicLink(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <Dialog.Root open={Boolean(ask)} onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          {ask && (
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl my-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Dialog.Title className="text-lg font-semibold text-white">{ask.name}</Dialog.Title>
                  <Dialog.Description className="text-sm text-slate-300">
                    ASK rattaché au challenge {formatDisplayValue(challengeName)} ({formatDisplayValue(projectName)})
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/10 p-1.5 text-slate-200 transition hover:bg-white/20"
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>

              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Question</p>
                  <p className="mt-2 text-sm font-medium text-white">{ask.question}</p>
                </div>
                {ask.description && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Description</p>
                    <p className="mt-2 leading-relaxed text-slate-200">{ask.description}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Statut</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDisplayValue(ask.status)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Clé ASK</p>
                  <p className="mt-1 text-sm font-medium text-white">{ask.askKey}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Projet</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDisplayValue(projectName)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Challenge</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDisplayValue(challengeName)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Delivery mode</p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {ask.deliveryMode === "physical" ? "In-person" : "Digital"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Mode de conversation</p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {ask.conversationMode === "individual_parallel" ? "Individuel parallèle" :
                     ask.conversationMode === "group_reporter" ? "Groupe avec rapporteur" :
                     ask.conversationMode === "consultant" ? "Consultant (écoute passive)" :
                     "Collaboratif"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Début</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDisplayValue(formatDateTime(ask.startDate))}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Fin</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDisplayValue(formatDateTime(ask.endDate))}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Auto-inscription</p>
                  <p className="mt-1 text-sm font-medium text-white">{ask.allowAutoRegistration ? "Oui" : "Non"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Participants max.</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDisplayValue(ask.maxParticipants)}</p>
                </div>
              </div>

              {/* Public registration link - only shown when auto-registration is enabled */}
              {ask.allowAutoRegistration && (
                <div className="mt-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                  <p className="text-xs uppercase tracking-wide text-indigo-300">Lien public d&apos;inscription</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Partagez ce lien pour permettre aux participants de s&apos;inscrire eux-mêmes
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatePublicRegistrationUrl(ask.askKey)}
                      className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 font-mono"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      onClick={() => copyPublicLink(generatePublicRegistrationUrl(ask.askKey))}
                      className="rounded-lg border border-white/10 bg-slate-900/60 p-2 text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors"
                      title="Copier le lien"
                    >
                      {copiedPublicLink ? (
                        <Check className="h-4 w-4 text-green-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Créée le</p>
                  <p className="mt-1 font-medium text-white">{formatDisplayValue(formatDateTime(ask.createdAt))}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Mise à jour</p>
                  <p className="mt-1 font-medium text-white">{formatDisplayValue(formatDateTime(ask.updatedAt))}</p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Participants</p>
                  {ask.participants && ask.participants.length > 0 && (
                    <Button
                      type="button"
                      variant="glassDark"
                      size="sm"
                      onClick={handleSendInvites}
                      disabled={isSendingInvites}
                      className="h-8 px-3 text-xs"
                    >
                      {isSendingInvites ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="h-3 w-3 mr-2" />
                          Send Invites
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {sendInvitesResult && (
                  <div className={`mb-3 rounded-lg p-2 text-xs ${
                    sendInvitesResult.failed === 0
                      ? "bg-green-500/20 text-green-200"
                      : "bg-amber-500/20 text-amber-200"
                  }`}>
                    {sendInvitesResult.sent > 0 && (
                      <p>✓ Sent {sendInvitesResult.sent} invite{sendInvitesResult.sent !== 1 ? "s" : ""}</p>
                    )}
                    {sendInvitesResult.failed > 0 && (
                      <p>⚠ Failed to send {sendInvitesResult.failed} invite{sendInvitesResult.failed !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                )}
                {ask.participants && ask.participants.length > 0 ? (
                  <div className="mt-2 space-y-3">
                    {ask.participants.map(participant => {
                      const participantEmail = participant.email;
                      // Generate link using participant token (direct access)
                      const magicLink = generateMagicLinkUrl(participant.inviteToken);
                      const isCopied = copiedLinks.has(participant.id);

                      return (
                        <div key={participant.id} className="rounded-lg border border-white/10 bg-slate-900/40 p-3">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div>
                              <p className="font-medium text-white">{participant.name}</p>
                              {participantEmail && (
                                <p className="text-xs text-slate-400">{participantEmail}</p>
                              )}
                            </div>
                            <span className="text-xs text-slate-400">
                              {participant.isSpokesperson ? "Spokesperson" : participant.role || "Participant"}
                            </span>
                          </div>
                          {magicLink && (
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                type="text"
                                readOnly
                                value={magicLink}
                                className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 font-mono"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                              />
                              <button
                                type="button"
                                onClick={() => copyToClipboard(magicLink, participant.id)}
                                className="rounded-lg border border-white/10 bg-slate-900/60 p-1.5 text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors"
                                title="Copy link"
                              >
                                {isCopied ? (
                                  <Check className="h-4 w-4 text-green-400" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">No participants assigned yet.</p>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
