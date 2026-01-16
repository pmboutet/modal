"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { LoginForm } from "@/components/auth/LoginForm";
import { Logo } from "@/components/ui/Logo";

function LoginPageContent() {
  const { status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRedirect = searchParams?.get("redirectTo") ?? null;

  // Track if we've already attempted a redirect to prevent loops
  const hasAttemptedRedirect = useRef(false);
  const [isStable, setIsStable] = useState(false);
  const renderCount = useRef(0);
  renderCount.current++;

  console.log(`[Login] ========== Render #${renderCount.current} ==========`);
  console.log(`[Login] status=${status}, isStable=${isStable}, hasAttemptedRedirect=${hasAttemptedRedirect.current}`);
  console.log(`[Login] requestedRedirect=${requestedRedirect}`);

  // Default to /onboarding which will redirect admins to /admin automatically
  const redirectTo = useMemo(() => {
    if (!requestedRedirect) {
      return "/onboarding";
    }

    if (!requestedRedirect.startsWith("/")) {
      return "/onboarding";
    }

    if (requestedRedirect.startsWith("//")) {
      return "/onboarding";
    }

    return requestedRedirect;
  }, [requestedRedirect]);

  // Check if we're in dev mode
  const isDevMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    const rawValue = (process.env.NEXT_PUBLIC_IS_DEV ?? "").toString().toLowerCase();
    return rawValue === "true" || rawValue === "1";
  }, []);

  // Wait for auth state to stabilize before allowing redirects
  // This prevents redirect loops when middleware and client disagree
  useEffect(() => {
    console.log(`[Login] Stability effect: status=${status}`);
    if (status !== "loading") {
      console.log("[Login] Status not loading, setting stability timeout (500ms)");
      // Give a small delay to ensure auth state is truly stable
      const timeout = setTimeout(() => {
        console.log("[Login] Stability timeout fired, setting isStable=true");
        setIsStable(true);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [status]);

  useEffect(() => {
    console.log(`[Login] Redirect effect: status=${status}, isDevMode=${isDevMode}, isStable=${isStable}, hasAttemptedRedirect=${hasAttemptedRedirect.current}`);

    // In dev mode, don't auto-redirect - let user choose via DevUserSwitcher
    if (isDevMode) {
      console.log("[Login] Dev mode - skipping redirect");
      return;
    }

    // Don't redirect until auth state is stable
    if (!isStable) {
      console.log("[Login] Not stable yet - skipping redirect");
      return;
    }

    // Only redirect once to prevent loops
    if (hasAttemptedRedirect.current) {
      console.log("[Login] Already attempted redirect - skipping");
      return;
    }

    if (status === "signed-in") {
      hasAttemptedRedirect.current = true;
      console.log("[Login] Auth stable and signed-in, redirecting to:", redirectTo);
      router.push(redirectTo);
    } else {
      console.log(`[Login] Status is ${status}, not redirecting`);
    }
  }, [status, router, redirectTo, isDevMode, isStable]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="aurora-background" aria-hidden="true">
          <div className="aurora-layer aurora-cyan" />
          <div className="aurora-layer aurora-pink" />
        </div>
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative">
      {/* Aurora background */}
      <div className="aurora-background" aria-hidden="true">
        <div className="aurora-layer aurora-cyan" />
        <div className="aurora-layer aurora-pink" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Logo className="text-[10rem] leading-none mb-4" showTagline />
          <h1 className="text-3xl font-bold text-white mb-2">Sign In</h1>
          <p className="text-slate-400">Welcome back! Please sign in to continue.</p>
          {isDevMode && (
            <div className="mt-4 rounded-lg bg-neon-yellow/10 border border-neon-yellow/30 p-3 text-sm text-neon-yellow">
              <p className="font-medium">🛠️ Mode développement activé</p>
              <p className="mt-1 text-slate-300">Utilisez le bandeau en haut de la page pour choisir un utilisateur sans vous connecter.</p>
            </div>
          )}
        </div>

        <div className="neon-card p-8">
          <LoginForm redirectTo={redirectTo} />

          <div className="mt-6 text-center text-sm text-slate-400">
            Don't have an account?{" "}
            <Link href="/auth/signup" className="text-neon-cyan hover:text-neon-cyan/80 font-medium">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="aurora-background" aria-hidden="true">
            <div className="aurora-layer aurora-cyan" />
            <div className="aurora-layer aurora-pink" />
          </div>
          <div className="text-slate-400">Loading...</div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

