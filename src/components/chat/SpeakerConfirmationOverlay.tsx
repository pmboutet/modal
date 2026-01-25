"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Props for the SpeakerConfirmationOverlay component
 */
export interface SpeakerConfirmationOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** The speaker identifier detected */
  speaker: string;
  /** Recent transcript from this speaker to help identify */
  recentTranscript?: string;
  /** Callback when user confirms "Yes, it's me" */
  onConfirm: () => void;
  /** Callback when user rejects "Not me" */
  onReject: () => void;
}

/**
 * Overlay component for confirming speaker identity in individual voice mode
 *
 * This component appears when a new speaker is detected, asking the user
 * to confirm if they are the one speaking. This prevents the system from
 * locking onto background voices (TV, other people) when voice mode starts.
 */
export function SpeakerConfirmationOverlay({
  isOpen,
  speaker,
  recentTranscript,
  onConfirm,
  onReject,
}: SpeakerConfirmationOverlayProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 max-w-md w-full shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 rounded-full bg-blue-500/30 flex items-center justify-center mb-4">
              <Mic className="h-8 w-8 text-blue-300" />
            </div>
          </div>

          {/* Question */}
          <h2 className="text-white text-xl font-semibold text-center mb-2">
            C&apos;est vous qui parlez ?
          </h2>
          <p className="text-white/60 text-sm text-center mb-6">
            Nous avons dtect une voix. Confirmez que c&apos;est bien vous pour commencer.
          </p>

          {/* Recent transcript preview */}
          {recentTranscript && (
            <div className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-white/50 text-xs mb-2">Ce que nous avons entendu :</p>
              <p className="text-white/90 text-sm italic">&quot;{recentTranscript}&quot;</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              onClick={onReject}
              variant="outline"
              className={cn(
                "flex-1 py-3 rounded-xl font-semibold transition-all",
                "bg-white/5 hover:bg-white/10 text-white/80 border-white/20"
              )}
            >
              <X className="h-4 w-4 mr-2" />
              Non, ce n&apos;est pas moi
            </Button>
            <Button
              onClick={onConfirm}
              className={cn(
                "flex-1 py-3 rounded-xl font-semibold transition-all",
                "bg-blue-500 hover:bg-blue-600 text-white"
              )}
            >
              <Check className="h-4 w-4 mr-2" />
              Oui, c&apos;est moi
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
