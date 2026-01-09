"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Building2, ArrowRight, CheckCircle2 } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const { status, profile, refreshProfile } = useAuth();
  const [clientName, setClientName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [checkingClient, setCheckingClient] = useState(true);
  const [hasClient, setHasClient] = useState(false);

  // Check if user has at least one client membership
  useEffect(() => {
    async function checkClientMembership() {
      if (status !== "signed-in" || !profile?.id) {
        setCheckingClient(false);
        return;
      }

      try {
        const response = await fetch("/api/admin/clients");
        if (response.ok) {
          const data = await response.json();
          setHasClient(data.data && data.data.length > 0);
        }
      } catch {
        // If we can't check, assume no client
        setHasClient(false);
      } finally {
        setCheckingClient(false);
      }
    }

    checkClientMembership();
  }, [status, profile?.id]);

  // If user is already an admin WITH a client, redirect to admin dashboard
  useEffect(() => {
    if (status === "signed-in" && profile && !checkingClient) {
      const role = profile.role?.toLowerCase() ?? "";
      const isAdminRole = ["full_admin", "client_admin", "facilitator", "manager"].includes(role);

      // Only redirect if user has admin role AND has at least one client
      if (isAdminRole && hasClient) {
        router.push("/admin");
      }
    }
  }, [status, profile, router, checkingClient, hasClient]);

  // If not signed in, redirect to login
  useEffect(() => {
    if (status === "signed-out") {
      router.push("/auth/login");
    }
  }, [status, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/onboarding/create-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clientName.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Une erreur est survenue");
        return;
      }

      setSuccess(true);

      // Refresh the profile to get the updated role
      if (refreshProfile) {
        await refreshProfile();
      }

      // Redirect to admin dashboard after a brief delay
      setTimeout(() => {
        router.push("/admin");
      }, 1500);

    } catch (err) {
      setError("Une erreur réseau est survenue. Veuillez réessayer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === "loading" || checkingClient) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-2xl border border-green-500/30 bg-green-500/10 p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
          <h2 className="mt-4 text-xl font-semibold text-white">Client créé avec succès !</h2>
          <p className="mt-2 text-sm text-slate-300">
            Vous êtes maintenant administrateur de votre organisation.
          </p>
          <p className="mt-4 text-xs text-slate-400">Redirection vers le dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-8">
          <div className="mb-6 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
              <Building2 className="h-7 w-7 text-white" />
            </div>
          </div>

          <h1 className="text-center text-2xl font-bold text-white">
            Bienvenue !
          </h1>
          <p className="mt-2 text-center text-sm text-slate-400">
            Pour commencer, créez votre organisation client.
            Vous en deviendrez l&apos;administrateur.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="clientName" className="text-slate-200">
                Nom de votre organisation
              </Label>
              <Input
                id="clientName"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: Acme Corp, Mon Entreprise..."
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                disabled={isSubmitting}
                autoFocus
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting || !clientName.trim()}
              className="w-full gap-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Création en cours...
                </>
              ) : (
                <>
                  Créer mon organisation
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            En créant votre organisation, vous acceptez nos conditions d&apos;utilisation.
          </p>
        </div>
      </div>
    </div>
  );
}
