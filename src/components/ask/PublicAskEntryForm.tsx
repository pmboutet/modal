"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, User, CheckCircle2, XCircle, Loader2, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

type Step = "email" | "complete-profile" | "success" | "not-invited";

interface RegisterResponse {
  status: "email_sent" | "needs_completion" | "not_invited";
  missingFields?: string[];
  message?: string;
}

interface PublicAskEntryFormProps {
  askKey: string;
  askName?: string;
  askQuestion?: string;
}

export function PublicAskEntryForm({ askKey, askName, askQuestion }: PublicAskEntryFormProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [description, setDescription] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>("");

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/ask/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ askKey, email }),
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || "Une erreur est survenue");
        return;
      }

      const data = result.data as RegisterResponse;

      if (data.status === "email_sent") {
        setSuccessMessage(data.message || "Un email avec votre lien d'accès a été envoyé.");
        setStep("success");
      } else if (data.status === "needs_completion") {
        setMissingFields(data.missingFields || []);
        setStep("complete-profile");
      } else if (data.status === "not_invited") {
        setSuccessMessage(data.message || "Vous n'avez pas été invité à cette session.");
        setStep("not-invited");
      }
    } catch (err) {
      setError("Erreur de connexion. Veuillez réessayer.");
      console.error("[PublicAskEntryForm] Error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/ask/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          askKey,
          email,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || "Une erreur est survenue");
        return;
      }

      const data = result.data as RegisterResponse;

      if (data.status === "email_sent") {
        setSuccessMessage(data.message || "Un email avec votre lien d'accès a été envoyé.");
        setStep("success");
      } else if (data.status === "needs_completion") {
        setMissingFields(data.missingFields || []);
        setError("Veuillez remplir tous les champs requis.");
      }
    } catch (err) {
      setError("Erreur de connexion. Veuillez réessayer.");
      console.error("[PublicAskEntryForm] Error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setStep("email");
    setError(null);
    setMissingFields([]);
    setFirstName("");
    setLastName("");
    setDescription("");
  };

  // Step: Email entry
  if (step === "email") {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo textClassName="text-[10rem] leading-none" taglineClassName="text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]" showTagline />
        </div>
        <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-white">
              {askName || "Session ASK"}
            </CardTitle>
            {askQuestion && (
              <CardDescription className="mt-2 text-slate-400">
                {askQuestion}
              </CardDescription>
            )}
          </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-slate-300">
                Votre adresse email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="vous@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="border-white/10 bg-slate-800/50 pl-10 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading || !email.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Vérification...
                </>
              ) : (
                "Continuer"
              )}
            </Button>
          </form>
        </CardContent>
        </Card>
      </div>
    );
  }

  // Step: Complete profile
  if (step === "complete-profile") {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo textClassName="text-[10rem] leading-none" taglineClassName="text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]" showTagline />
        </div>
        <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-white">
              Complétez votre profil
            </CardTitle>
            <CardDescription className="mt-2 text-slate-400">
              Pour participer, veuillez nous donner quelques informations.
            </CardDescription>
          </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName" className="text-sm text-slate-300">
                  Prénom {missingFields.includes("firstName") && <span className="text-red-400">*</span>}
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="Jean"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required={missingFields.includes("firstName")}
                    disabled={isLoading}
                    className="border-white/10 bg-slate-800/50 pl-10 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName" className="text-sm text-slate-300">
                  Nom {missingFields.includes("lastName") && <span className="text-red-400">*</span>}
                </Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Dupont"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required={missingFields.includes("lastName")}
                  disabled={isLoading}
                  className="border-white/10 bg-slate-800/50 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm text-slate-300">
                Votre rôle / contexte (optionnel)
              </Label>
              <Textarea
                id="description"
                placeholder="Ex: Responsable marketing chez XYZ, utilisateur du produit depuis 2 ans..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isLoading}
                rows={3}
                className="border-white/10 bg-slate-800/50 text-white placeholder:text-slate-500"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isLoading}
                className="border-white/10 text-slate-300 hover:bg-slate-800"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Retour
              </Button>
              <Button
                type="submit"
                disabled={isLoading || (missingFields.includes("firstName") && !firstName.trim()) || (missingFields.includes("lastName") && !lastName.trim())}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Inscription...
                  </>
                ) : (
                  "S'inscrire"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
        </Card>
      </div>
    );
  }

  // Step: Success
  if (step === "success") {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo textClassName="text-[10rem] leading-none" taglineClassName="text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]" showTagline />
        </div>
        <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
          <CardContent className="pt-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
              <CheckCircle2 className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-white">Email envoyé !</h2>
            <p className="text-slate-400">{successMessage}</p>
            <p className="mt-4 text-sm text-slate-500">
              Vérifiez votre boîte de réception à l&apos;adresse <span className="font-medium text-slate-300">{email}</span>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step: Not invited
  if (step === "not-invited") {
    return (
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo textClassName="text-[10rem] leading-none" taglineClassName="text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]" showTagline />
        </div>
        <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
          <CardContent className="pt-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20">
              <XCircle className="h-8 w-8 text-amber-400" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-white">Accès non autorisé</h2>
          <p className="text-slate-400">{successMessage}</p>
          <Button
            onClick={handleBack}
            variant="outline"
            className="mt-6 border-white/10 text-slate-300 hover:bg-slate-800"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Réessayer avec un autre email
          </Button>
        </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
