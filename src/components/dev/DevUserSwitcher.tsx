"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { Profile, ManagedUser } from "@/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

const DEV_USER_STORAGE_KEY = "dev_selected_user";

export function DevUserSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [isDev, setIsDev] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  
  // Track when component has mounted on client
  useEffect(() => {
    setHasMounted(true);
  }, []);
  
  // Check dev mode on mount and when pathname changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Check environment variable
    const envValue = (process.env.NEXT_PUBLIC_IS_DEV ?? "").toString().toLowerCase();
    if (envValue === "true" || envValue === "1") {
      setIsDev(true);
      return;
    }
    
    // Fallback: check localStorage for manual override
    const localStorageOverride = localStorage.getItem("dev_mode_override");
    if (localStorageOverride === "true") {
      setIsDev(true);
      return;
    }
    
    // Fallback: check URL parameter for quick enable
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("dev") === "true") {
      localStorage.setItem("dev_mode_override", "true");
      setIsDev(true);
      return;
    }
    
    setIsDev(false);
  }, [pathname]);
  const { user, setDevUser } = useAuth();
  const [users, setUsers] = useState<(Profile | ManagedUser)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isDev || !setDevUser) return;

    // Load selected user from localStorage
    const storedUserId = typeof window !== "undefined" ? localStorage.getItem(DEV_USER_STORAGE_KEY) : null;
    if (storedUserId) {
      setSelectedUserId(storedUserId);
    }

    // Helper to create session for a user
    const createSessionForUser = async (user: Profile | ManagedUser) => {
      try {
        const response = await fetch('/api/dev/auto-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: user.id }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            await supabase.auth.setSession({
              access_token: result.data.access_token,
              refresh_token: result.data.refresh_token,
            });
            console.log('[DevUserSwitcher] Session restored for:', user.email);
          }
        }
      } catch (error) {
        console.warn('[DevUserSwitcher] Failed to restore session:', error);
      }
    };

    // Fetch all users
    fetch("/api/dev/profiles")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(async (data: { success: boolean; data?: any[]; error?: string }) => {
        if (!data.success) {
          const errorMsg = data.error || "Erreur lors du chargement des utilisateurs";
          console.error("API error:", errorMsg);
          setError(errorMsg);
          setIsLoading(false);
          return;
        }
        setError(null);
        if (data.data && Array.isArray(data.data)) {
          // Ensure authId is set for all users (use id as fallback)
          const usersWithAuthId = data.data.map((u) => ({
            ...u,
            authId: u.authId || u.id,
          }));
          setUsers(usersWithAuthId);
          // If we have a stored user ID, validate it still exists
          if (storedUserId) {
            const storedUser = usersWithAuthId.find((u) => u.id === storedUserId);
            if (storedUser) {
              // Create session for stored user (restored from localStorage)
              await createSessionForUser(storedUser);
              setDevUser(storedUser);
            } else {
              // Clear invalid stored user ID
              if (typeof window !== "undefined") {
                localStorage.removeItem(DEV_USER_STORAGE_KEY);
              }
              setSelectedUserId(null);
            }
          }
        }
      })
      .catch((error) => {
        const errorMsg = error instanceof Error ? error.message : "Erreur inconnue";
        console.error("Error fetching users:", error);
        setError(errorMsg);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isDev, setDevUser]);

  // Always render in dev mode, or show a button to enable it
  if (!isDev) {
    // Don't render anything until mounted to avoid hydration mismatch
    if (!hasMounted) {
      return null;
    }
    
    // In production, show nothing. But if NEXT_PUBLIC_IS_DEV might be undefined,
    // we can add a way to enable it manually
    const canEnableManually = 
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    
    if (!canEnableManually) {
      return null;
    }
    
    // Show a small button to enable dev mode if on localhost
    return (
      <div className="fixed top-0 right-0 z-40 m-2">
        <button
          onClick={() => {
            localStorage.setItem("dev_mode_override", "true");
            window.location.reload();
          }}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-50 hover:opacity-100"
          title="Enable dev mode"
        >
          🛠️
        </button>
      </div>
    );
  }

  const handleUserSelect = async (selectedUser: Profile | any) => {
    if (!setDevUser) return;

    try {
      // 1. Call auto-login to create a real JWT session
      // This ensures the backend API routes can authenticate via Supabase session
      const response = await fetch('/api/dev/auto-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedUser.id }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          // 2. Set the session in Supabase client
          // This makes the session available to all subsequent API calls
          await supabase.auth.setSession({
            access_token: result.data.access_token,
            refresh_token: result.data.refresh_token,
          });
          console.log('[DevUserSwitcher] Session created for:', selectedUser.email);
        }
      } else {
        console.warn('[DevUserSwitcher] Auto-login failed, falling back to context-only mode');
      }
    } catch (error) {
      console.warn('[DevUserSwitcher] Auto-login error, falling back to context-only mode:', error);
    }

    // 3. Update local state
    setSelectedUserId(selectedUser.id);
    if (typeof window !== "undefined") {
      localStorage.setItem(DEV_USER_STORAGE_KEY, selectedUser.id);
    }
    // Ensure authId is present (use id as fallback if authId is missing)
    const profileToUse: Profile = {
      ...selectedUser,
      authId: selectedUser.authId || selectedUser.id,
    };
    setDevUser(profileToUse);
    setIsOpen(false);
    setSearchQuery(""); // Clear search after selection

    // If we're on the login page, redirect to admin after selecting user
    if (pathname?.startsWith("/auth/login")) {
      const redirectTo = new URLSearchParams(window.location.search).get("redirectTo") || "/admin";
      router.push(redirectTo);
    }
  };

  const filteredUsers = searchQuery
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.role?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : users;

  const selectedUser = selectedUserId
    ? users.find((u) => u.id === selectedUserId)
    : null;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-yellow-400 border-b-2 border-yellow-500 shadow-lg hidden md:block">
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-yellow-900">
              🛠️ MODE DÉVELOPPEMENT
            </span>
            <div className="relative">
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-md border border-yellow-600 hover:bg-yellow-50 text-sm font-medium text-gray-900 shadow-sm"
              >
                {isLoading ? (
                  <span>Chargement...</span>
                ) : error ? (
                  <span className="text-red-600">Erreur: {error}</span>
                ) : selectedUser ? (
                  <>
                    <span className="font-semibold">{selectedUser.fullName || selectedUser.email}</span>
                    <span className="text-xs text-gray-500">
                      ({selectedUser.role})
                    </span>
                  </>
                ) : (
                  <span>Sélectionner un utilisateur</span>
                )}
                <svg
                  className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsOpen(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 w-80 bg-white rounded-md shadow-lg border border-gray-200 max-h-96 overflow-y-auto z-20">
                    <div className="p-2">
                      <input
                        type="text"
                        placeholder="Rechercher un utilisateur..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 mb-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500"
                      />
                      <div className="space-y-1">
                        {filteredUsers.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">Aucun utilisateur trouvé</div>
                        ) : (
                          filteredUsers.map((userOption) => (
                          <button
                            key={userOption.id}
                            onClick={() => handleUserSelect(userOption)}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                              selectedUserId === userOption.id
                                ? "bg-yellow-100 text-yellow-900 font-medium"
                                : "hover:bg-gray-100 text-gray-900"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-medium">
                                  {userOption.fullName || userOption.email}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {userOption.email} • {userOption.role}
                                  {("clientMemberships" in userOption && userOption.clientMemberships?.[0]?.clientName) && ` • ${userOption.clientMemberships[0].clientName}`}
                                </div>
                              </div>
                              {selectedUserId === userOption.id && (
                                <span className="text-yellow-600">✓</span>
                              )}
                            </div>
                          </button>
                        ))
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="text-xs text-yellow-900">
            Utilisateur actuel:{" "}
            <span className="font-semibold">
              {user?.fullName || user?.email || "Aucun"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

