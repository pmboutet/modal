"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Check for existing session or PASSWORD_RECOVERY event
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      // If there's a session, we can proceed with password reset
      if (session) {
        setIsValidSession(true);
        return;
      }

      // No session yet, wait for the auth event
      setIsValidSession(false);
    };

    checkSession();

    // Listen for auth state changes (PASSWORD_RECOVERY event)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[ResetPassword] Auth event:", event);

      if (event === "PASSWORD_RECOVERY") {
        setIsValidSession(true);
      } else if (event === "SIGNED_IN" && session) {
        // User might have clicked the link and got signed in
        setIsValidSession(true);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setIsSuccess(true);

      // Sign out and redirect to login after a delay
      setTimeout(async () => {
        await supabase.auth.signOut();
        router.push("/auth/login?message=password_reset");
      }, 2000);
    } catch {
      setError("Une erreur inattendue s'est produite. Veuillez réessayer.");
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while checking session
  if (isValidSession === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="aurora-background" aria-hidden="true">
          <div className="aurora-layer aurora-cyan" />
          <div className="aurora-layer aurora-pink" />
        </div>
        <div className="text-slate-400 flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Vérification...
        </div>
      </div>
    );
  }

  // Invalid or expired link
  if (!isValidSession) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative">
        <div className="aurora-background" aria-hidden="true">
          <div className="aurora-layer aurora-cyan" />
          <div className="aurora-layer aurora-pink" />
        </div>

        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-8">
            <Logo className="mb-12" showTagline />
          </div>

          <div className="neon-card p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Lien invalide ou expiré</h2>
            <p className="text-slate-400 mb-6">
              Ce lien de réinitialisation est invalide ou a expiré. Veuillez demander un nouveau lien.
            </p>
            <Link
              href="/auth/forgot-password"
              className="inline-flex items-center justify-center w-full py-3.5 px-6 font-semibold text-base rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-900 transition-all duration-300 hover:shadow-[0_0_30px_hsla(185,100%,50%,0.5),0_0_60px_hsla(185,100%,50%,0.25)] hover:-translate-y-0.5 active:translate-y-0"
            >
              Demander un nouveau lien
            </Link>
          </div>
        </div>
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
          <h1 className="text-3xl font-bold text-white mb-2">Nouveau mot de passe</h1>
          <p className="text-slate-400">Choisissez un nouveau mot de passe pour votre compte.</p>
        </div>

        <div className="neon-card p-8">
          {isSuccess ? (
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Mot de passe modifié !</h2>
              <p className="text-slate-400">
                Votre mot de passe a été mis à jour avec succès. Vous allez être redirigé vers la page de connexion...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-4 py-2 pr-10 bg-dark-700/50 border border-neon-cyan/20 rounded-lg text-white placeholder:text-slate-500 focus:ring-2 focus:ring-neon-cyan/50 focus:border-neon-cyan/50 focus:outline-none transition-all"
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-neon-cyan focus:outline-none transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">Minimum 6 caractères</p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-2">
                  Confirmer le mot de passe
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2 pr-10 bg-dark-700/50 border border-neon-cyan/20 rounded-lg text-white placeholder:text-slate-500 focus:ring-2 focus:ring-neon-cyan/50 focus:border-neon-cyan/50 focus:outline-none transition-all"
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-neon-cyan focus:outline-none transition-colors"
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
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
                    Mise à jour...
                  </>
                ) : (
                  "Mettre à jour le mot de passe"
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
