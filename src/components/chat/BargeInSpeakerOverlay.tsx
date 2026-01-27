"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Play, Volume2, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Mode for the overlay
 * - 'echo': Transcript looks like AI speech (likely microphone picking up TTS)
 * - 'new-participant': Transcript doesn't match AI speech (likely another person)
 */
export type BargeInOverlayMode = 'echo' | 'new-participant';

/**
 * Props for the BargeInSpeakerOverlay component
 */
export interface BargeInSpeakerOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** The speaker identifier detected during interruption */
  speaker: string;
  /** Transcript captured during the interruption */
  transcript?: string;
  /** Mode determines the UI text and button labels */
  mode: BargeInOverlayMode;
  /** Callback when user confirms - accepts the speaker (echo: "it's me", new-participant: "add") */
  onConfirm: () => void;
  /** Callback when user rejects - ignores the speaker (echo: "it's echo", new-participant: "ignore") */
  onReject: () => void;
}

/**
 * Overlay component for handling unknown speakers during barge-in
 *
 * Two modes:
 * - Echo mode: When transcript matches AI speech, ask if it's echo or the user
 * - New-participant mode: When transcript is different, ask if it's a new speaker to add
 */
export function BargeInSpeakerOverlay({
  isOpen,
  speaker,
  transcript,
  mode,
  onConfirm,
  onReject,
}: BargeInSpeakerOverlayProps) {
  const isEchoMode = mode === 'echo';

  // Configure UI based on mode
  const config = isEchoMode
    ? {
        icon: Volume2,
        iconBgColor: 'bg-amber-500/30',
        iconColor: 'text-amber-300',
        title: "Ça ressemble à de l'écho",
        subtitle: "Ce texte ressemble à ce que l'IA vient de dire.",
        rejectLabel: "C'est de l'écho",
        rejectIcon: X,
        confirmLabel: "Non, c'est moi",
        confirmIcon: Check,
        confirmBgColor: 'bg-amber-500 hover:bg-amber-600',
      }
    : {
        icon: UserPlus,
        iconBgColor: 'bg-blue-500/30',
        iconColor: 'text-blue-300',
        title: 'Nouveau participant ?',
        subtitle: 'Une autre voix a été détectée.',
        rejectLabel: 'Ignorer cette voix',
        rejectIcon: X,
        confirmLabel: 'Ajouter comme participant',
        confirmIcon: UserPlus,
        confirmBgColor: 'bg-blue-500 hover:bg-blue-600',
      };

  const IconComponent = config.icon;
  const RejectIconComponent = config.rejectIcon;
  const ConfirmIconComponent = config.confirmIcon;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 max-w-md w-full shadow-2xl"
        >
          {/* Header with mode icon */}
          <div className="flex items-center justify-center mb-6">
            <div className={cn("w-16 h-16 rounded-full flex items-center justify-center", config.iconBgColor)}>
              <IconComponent className={cn("h-8 w-8", config.iconColor)} />
            </div>
          </div>

          {/* Title and subtitle */}
          <h2 className="text-white text-xl font-semibold text-center mb-2">
            {config.title}
          </h2>
          <p className="text-white/60 text-sm text-center mb-6">
            {config.subtitle}
          </p>

          {/* Transcript preview */}
          {transcript && (
            <div className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-white/50 text-xs mb-2">Ce que nous avons entendu :</p>
              <p className="text-white/90 text-sm italic">&quot;{transcript}&quot;</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-row gap-3">
            <Button
              onClick={onReject}
              variant="outline"
              className={cn(
                "flex-1 py-3 rounded-xl font-semibold transition-all whitespace-nowrap",
                "bg-white/5 hover:bg-white/10 text-white/80 border-white/20"
              )}
            >
              <RejectIconComponent className="h-4 w-4 mr-2 flex-shrink-0" />
              <span className="truncate">{config.rejectLabel}</span>
            </Button>
            <Button
              onClick={onConfirm}
              className={cn(
                "flex-1 py-3 rounded-xl font-semibold transition-all text-white whitespace-nowrap",
                config.confirmBgColor
              )}
            >
              <ConfirmIconComponent className="h-4 w-4 mr-2 flex-shrink-0" />
              <span className="truncate">{config.confirmLabel}</span>
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
