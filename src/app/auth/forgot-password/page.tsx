"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabaseClient";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const supabase = createClient();
      const redirectUrl = `${window.location.origin}/auth/reset-password`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setIsSuccess(true);
    } catch {
      setError("Une erreur inattendue s'est produite. Veuillez réessayer.");
    } finally {
      setIsLoading(false);
    }
  };

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
          <h1 className="text-3xl font-bold text-white mb-2">Mot de passe oublié</h1>
          <p className="text-slate-400">
            Entrez votre email et nous vous enverrons un lien pour réinitialiser votre mot de passe.
          </p>
        </div>

        <div className="neon-card p-8">
          {isSuccess ? (
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Email envoyé !</h2>
              <p className="text-slate-400 mb-6">
                Si un compte existe avec l&apos;adresse <span className="text-neon-cyan">{email}</span>, vous recevrez un
                email avec les instructions pour réinitialiser votre mot de passe.
              </p>
              <Link
                href="/auth/login"
                className="inline-flex items-center gap-2 text-neon-cyan hover:text-neon-cyan/80 font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                Retour à la connexion
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  Email
                </label>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2 pl-10 bg-dark-700/50 border border-neon-cyan/20 rounded-lg text-white placeholder:text-slate-500 focus:ring-2 focus:ring-neon-cyan/50 focus:border-neon-cyan/50 focus:outline-none transition-all"
                    placeholder="votre@email.com"
                    disabled={isLoading}
                  />
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </div>
              </div>

              {error && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg font-medium">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-6 font-semibold text-base rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-300 hover:shadow-[0_0_30px_hsla(185,100%,50%,0.5),0_0_60px_hsla(185,100%,50%,0.25)] hover:-translate-y-0.5 active:translate-y-0 relative overflow-hidden group"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"></span>
                {isLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  "Envoyer le lien"
                )}
              </button>

              <div className="text-center">
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-neon-cyan transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retour à la connexion
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
