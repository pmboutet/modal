"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Mic, MicOff, Users, Pencil, AlertTriangle, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Tutorial step definition
 */
interface TutorialStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  illustration?: React.ReactNode;
  warning?: string;
}

/**
 * Props for the VoiceModeTutorial component
 */
export interface VoiceModeTutorialProps {
  /** Current step index (0-3) */
  currentStep: number;
  /** Callback to go to next step */
  onNext: () => void;
  /** Callback to go to previous step */
  onPrev: () => void;
  /** Callback when tutorial is completed */
  onComplete: () => void;
  /** Callback when tutorial is skipped */
  onSkip: () => void;
}

/**
 * Tutorial steps content
 */
const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'quiet-environment',
    title: 'Environnement calme recommandé',
    description: 'Le mode voix fonctionne mieux dans un environnement calme. Évitez les bruits de fond (musique, conversations, ventilation) pour une meilleure reconnaissance vocale.',
    icon: Volume2,
    illustration: (
      <div className="flex items-center justify-center py-4">
        <div className="relative">
          {/* Central icon */}
          <div className="w-16 h-16 rounded-full bg-green-500/20 border-2 border-green-400/40 flex items-center justify-center">
            <Volume2 className="h-7 w-7 text-green-300" />
          </div>
          {/* Sound waves animation */}
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-green-400/30"
            animate={{
              scale: [1, 1.4, 1.4],
              opacity: [0.6, 0, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-green-400/30"
            animate={{
              scale: [1, 1.4, 1.4],
              opacity: [0.6, 0, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.5,
            }}
          />
        </div>
      </div>
    ),
  },
  {
    id: 'mute-button',
    title: 'Contrôler le microphone',
    description: 'Appuyez sur le bouton central pour mettre en pause ou reprendre l\'écoute. Quand le micro est en pause, vous entendez toujours les réponses de l\'assistant.',
    icon: Mic,
    illustration: (
      <div className="flex items-center justify-center gap-6 py-4">
        {/* Active mic button */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center shadow-lg">
            <Mic className="h-6 w-6 text-white" />
          </div>
          <span className="text-white/60 text-xs">Actif</span>
        </div>

        {/* Arrow */}
        <ChevronRight className="h-5 w-5 text-white/40" />

        {/* Muted mic button */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center opacity-50">
            <MicOff className="h-6 w-6 text-white" />
          </div>
          <span className="text-white/60 text-xs">En pause</span>
        </div>
      </div>
    ),
  },
  {
    id: 'speaker-management',
    title: 'Gérer les voix détectées',
    description: 'Quand une nouvelle voix est détectée, vous pouvez choisir de l\'ignorer, de l\'ajouter à la conversation, ou de remplacer votre voix principale.',
    icon: Users,
    illustration: (
      <div className="py-4 space-y-3">
        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
          <div className="w-8 h-8 rounded-full bg-red-500/30 flex items-center justify-center">
            <X className="h-4 w-4 text-red-300" />
          </div>
          <div className="flex-1">
            <span className="text-white/80 text-sm font-medium">Ignorer</span>
            <p className="text-white/50 text-xs">Cette voix ne sera pas transcrite</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
          <div className="w-8 h-8 rounded-full bg-green-500/30 flex items-center justify-center">
            <Users className="h-4 w-4 text-green-300" />
          </div>
          <div className="flex-1">
            <span className="text-white/80 text-sm font-medium">Ajouter</span>
            <p className="text-white/50 text-xs">Cette personne participe avec vous</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
          <div className="w-8 h-8 rounded-full bg-blue-500/30 flex items-center justify-center">
            <Mic className="h-4 w-4 text-blue-300" />
          </div>
          <div className="flex-1">
            <span className="text-white/80 text-sm font-medium">Remplacer</span>
            <p className="text-white/50 text-xs">Utiliser uniquement cette voix</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'edit-transcription',
    title: 'Corriger la transcription',
    description: 'Survolez votre message et cliquez sur le crayon pour corriger une erreur de transcription. L\'agent répondra automatiquement à votre correction.',
    icon: Pencil,
    illustration: (
      <div className="py-4">
        <div className="relative p-3 rounded-xl bg-blue-500/20 border border-blue-400/30">
          <p className="text-white/80 text-sm pr-8">&quot;Bonjour, je voudrais...&quot;</p>
          {/* Edit button with pulsing animation */}
          <motion.div
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"
            animate={{
              scale: [1, 1.15, 1],
              opacity: [0.8, 1, 0.8],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-white" />
          </motion.div>
        </div>
      </div>
    ),
    warning: 'Attention : les messages suivants seront supprimés et la conversation reprendra depuis ce point.',
  },
];

/**
 * VoiceModeTutorial - Onboarding tutorial for voice mode features
 *
 * Shows a 4-step tutorial explaining:
 * 0. Quiet environment recommendation for better recognition
 * 1. How to mute/unmute the microphone
 * 2. How to manage detected voices (ignore/add/replace)
 * 3. How to edit transcriptions and the consequences
 */
export function VoiceModeTutorial({
  currentStep,
  onNext,
  onPrev,
  onComplete,
  onSkip,
}: VoiceModeTutorialProps) {
  const step = TUTORIAL_STEPS[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === TUTORIAL_STEPS.length - 1;
  const StepIcon = step.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 backdrop-blur-md bg-black/40 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 max-w-md w-full shadow-2xl"
      >
        {/* Header with skip button */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/30 flex items-center justify-center">
              <StepIcon className="h-5 w-5 text-blue-300" />
            </div>
            <div>
              <p className="text-white/50 text-xs">Étape {currentStep + 1} sur {TUTORIAL_STEPS.length}</p>
              <h2 className="text-white text-lg font-semibold">{step.title}</h2>
            </div>
          </div>
          <button
            onClick={onSkip}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            aria-label="Passer le tutoriel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Description */}
        <p className="text-white/80 text-sm leading-relaxed mb-4">
          {step.description}
        </p>

        {/* Illustration */}
        {step.illustration && (
          <div className="mb-4">
            {step.illustration}
          </div>
        )}

        {/* Warning message */}
        {step.warning && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-6">
            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-200/90 text-xs leading-relaxed">
              {step.warning}
            </p>
          </div>
        )}

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-6">
          {TUTORIAL_STEPS.map((_, index) => (
            <div
              key={index}
              className={cn(
                "w-2 h-2 rounded-full transition-colors duration-300",
                index === currentStep ? "bg-blue-400" : "bg-white/30"
              )}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={onPrev}
            disabled={isFirstStep}
            className={cn(
              "text-white/70 hover:text-white hover:bg-white/10",
              isFirstStep && "opacity-0 pointer-events-none"
            )}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Précédent
          </Button>

          {isLastStep ? (
            <Button
              onClick={onComplete}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              Commencer
            </Button>
          ) : (
            <Button
              onClick={onNext}
              className="bg-white/20 hover:bg-white/30 text-white"
            >
              Suivant
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
