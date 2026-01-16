"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { SignupForm } from "@/components/auth/SignupForm";
import { Logo } from "@/components/ui/Logo";

const ADMIN_ROLES = ["full_admin", "client_admin", "facilitator", "manager"];

export default function SignupPage() {
  const { status, profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-in") {
      // If user already has admin role, redirect to admin dashboard
      const role = profile?.role?.toLowerCase() ?? "";
      if (ADMIN_ROLES.includes(role)) {
        router.push("/admin");
      } else {
        // New users (participants) go to onboarding to create their client
        router.push("/onboarding");
      }
    }
  }, [status, profile, router]);

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
          <Logo className="mb-12" showTagline />
          <h1 className="text-3xl font-bold text-white mb-2">Create Account</h1>
          <p className="text-slate-400">Sign up to get started.</p>
        </div>

        <div className="neon-card p-8">
          <SignupForm />

          <div className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-neon-cyan hover:text-neon-cyan/80 font-medium">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

