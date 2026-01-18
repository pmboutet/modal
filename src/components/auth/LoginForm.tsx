"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";

interface LoginFormProps {
  redirectTo?: string;
}

export function LoginForm({ redirectTo = "/admin" }: LoginFormProps) {
  const { signIn, signInWithGoogle, isProcessing } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Note: redirectTo is used by signInWithGoogle for OAuth flow
  // For email/password login, the parent component (LoginPageContent) handles redirect via useEffect

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = await signIn(email, password);

    if (result.error) {
      setError(result.error);
      return;
    }

    // Don't navigate here - let the parent LoginPageContent handle redirect
    // when auth status changes to "signed-in" via its useEffect
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const result = await signInWithGoogle(redirectTo);

    if (result.error) {
      setError(result.error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 w-full max-w-md">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-2 bg-dark-700/50 border border-neon-cyan/20 rounded-lg text-white placeholder:text-slate-500 focus:ring-2 focus:ring-neon-cyan/50 focus:border-neon-cyan/50 focus:outline-none transition-all"
          placeholder="your@email.com"
          disabled={isProcessing}
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-2 pr-10 bg-dark-700/50 border border-neon-cyan/20 rounded-lg text-white placeholder:text-slate-500 focus:ring-2 focus:ring-neon-cyan/50 focus:border-neon-cyan/50 focus:outline-none transition-all"
            placeholder="••••••••"
            disabled={isProcessing}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-neon-cyan focus:outline-none transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        <div className="mt-2 text-right">
          <Link
            href="/auth/forgot-password"
            className="text-sm text-slate-400 hover:text-neon-cyan transition-colors"
          >
            Mot de passe oublié ?
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg font-medium">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isProcessing}
        className="w-full py-3.5 px-6 font-semibold text-base rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-300 hover:shadow-[0_0_30px_hsla(185,100%,50%,0.5),0_0_60px_hsla(185,100%,50%,0.25)] hover:-translate-y-0.5 active:translate-y-0 relative overflow-hidden group"
      >
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"></span>
        {isProcessing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Signing in...
          </>
        ) : (
          "Sign In"
        )}
      </button>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-slate-900/80 text-slate-400">Or continue with</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isProcessing}
        className="w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-xl bg-slate-800/60 border border-cyan-500/20 text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 hover:bg-slate-800/80 hover:border-cyan-500/40 hover:text-white hover:shadow-[0_0_20px_hsla(185,100%,50%,0.15)]"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Continue with Google
      </button>
    </form>
  );
}

