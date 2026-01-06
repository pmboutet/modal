import { redirect } from "next/navigation";
import { Suspense } from "react";
import HomePage from "./HomePage";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; token?: string; ask?: string }>;
}) {
  // Dans Next.js 16, searchParams est toujours une Promise
  const params = await searchParams;

  // Si un paramètre 'key', 'token', ou 'ask' est présent, afficher la HomePage
  // (HomePage utilisera useSearchParams() côté client pour lire les params)
  // - key: Direct ASK access (deprecated, prefer token)
  // - token: Token-based participant access
  // - ask: Public entry form for self-registration
  if (params?.key || params?.token || params?.ask) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-white to-indigo-200 flex items-center justify-center">
          <div className="text-gray-600">Loading...</div>
        </div>
      }>
        <HomePage />
      </Suspense>
    );
  }

  // Sinon, rediriger vers /admin
  redirect("/admin");
}
