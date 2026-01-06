"use client";

import React, { createContext, useContext, useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Session, User, AuthChangeEvent } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { Profile } from "@/types";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role?: string | null;
  profile?: Profile | null;
};

type AuthStatus = "loading" | "signed-out" | "signed-in";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  session: Session | null;
  profile: Profile | null;
  isProcessing: boolean;
  /** User has full_admin role */
  isFullAdmin: boolean;
  /** User has full_admin or client_admin role */
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, metadata?: { fullName?: string; firstName?: string; lastName?: string }) => Promise<{ error?: string }>;
  signInWithGoogle: (redirectTo?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setDevUser?: (profile: Profile) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const DEV_BYPASS_PROFILE: Profile = {
  id: "dev-bypass-profile",
  authId: "dev-bypass-user",
  email: "dev@example.com",
  firstName: "Dev",
  lastName: "User",
  fullName: "Dev User",
  role: "full_admin",
  avatarUrl: null,
  isActive: true,
  lastLogin: null,
  jobTitle: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DEV_BYPASS_USER: AuthUser = {
  id: "dev-bypass-user",
  email: "dev@example.com",
  fullName: "Dev User",
  role: "full_admin",
  avatarUrl: null,
  profile: DEV_BYPASS_PROFILE,
};

/**
 * AuthProvider with Supabase Auth integration.
 * - Manages authentication state and session
 * - Debounces auth state changes to prevent rapid updates
 * - Redirects after sign out
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const isDevBypass = useMemo(() => {
    const rawValue = (process.env.NEXT_PUBLIC_IS_DEV ?? "").toString().toLowerCase();
    return rawValue === "true" || rawValue === "1";
  }, []);

  const [status, setStatus] = useState<AuthStatus>(isDevBypass ? "signed-in" : "loading");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(isDevBypass ? DEV_BYPASS_USER : null);
  const [profile, setProfile] = useState<Profile | null>(isDevBypass ? DEV_BYPASS_PROFILE : null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Refs to prevent duplicate processing
  const initRef = useRef(false);
  const lastProcessedSessionId = useRef<string | null>(null);
  const lastEventRef = useRef<{ event: AuthChangeEvent; timestamp: number } | null>(null);
  const isSigningOutRef = useRef(false);
  const authHandledRef = useRef(false); // Track if auth was already handled by onAuthStateChange

  // Best-effort session parser from Supabase auth cookies when getSession hangs
  const parseSessionFromCookies = useCallback((): Session | null => {
    if (typeof document === "undefined") return null;

    const cookieStr = document.cookie;
    if (!cookieStr) return null;

    const cookies = cookieStr.split(";").map(c => c.trim());
    const authCookies = cookies.filter(c => c.startsWith("sb-") && c.includes("auth-token"));
    if (authCookies.length === 0) return null;

    // Group chunks by base name (without .0/.1 suffix)
    const chunkMap = new Map<string, { base?: string; chunks: Record<number, string> }>();

    authCookies.forEach(cookie => {
      const [name, ...valueParts] = cookie.split("=");
      const value = valueParts.join("=") ?? "";
      const baseMatch = name.match(/^(.*?)(?:\.(\d+))?$/);
      if (!baseMatch) return;
      const baseName = baseMatch[1];
      const chunkIndex = baseMatch[2] ? Number(baseMatch[2]) : null;
      if (!chunkMap.has(baseName)) {
        chunkMap.set(baseName, { chunks: {} });
      }
      const entry = chunkMap.get(baseName)!;
      if (chunkIndex === null) {
        entry.base = value;
      } else {
        entry.chunks[chunkIndex] = value;
      }
    });

    for (const [baseName, { base, chunks }] of chunkMap.entries()) {
      // Prefer explicit base value, else combine chunks in order
      let rawValue = base ?? "";
      if (!rawValue) {
        const orderedChunks = Object.keys(chunks)
          .map(k => Number(k))
          .sort((a, b) => a - b)
          .map(idx => chunks[idx]);
        rawValue = orderedChunks.join("");
      }

      if (!rawValue) continue;

      let decoded = rawValue;
      const BASE64_PREFIX = "base64-";
      if (decoded.startsWith(BASE64_PREFIX)) {
        try {
          const b64 = decoded.slice(BASE64_PREFIX.length)
            .replace(/-/g, "+")
            .replace(/_/g, "/");
          decoded = atob(b64);
        } catch (error) {
          console.warn("[Auth] Failed to decode base64 auth cookie", error);
          continue;
        }
      }

      try {
        const parsed = JSON.parse(decoded) as any;
        const sessionLike = parsed.currentSession || parsed.session || parsed;
        if (sessionLike?.access_token && sessionLike?.user) {
          console.log(`[Auth] Parsed session from cookies (${baseName})`);
          return sessionLike as Session;
        }
      } catch (error) {
        console.warn("[Auth] Failed to parse auth cookie JSON", error);
      }
    }

    return null;
  }, []);

  // Simple profile fetch
  const fetchProfile = useCallback(async (authUser: User): Promise<Profile | null> => {
    if (isDevBypass) return null;

    console.log("[Auth] Fetching profile for:", authUser.email);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("auth_id", authUser.id)
        .single();

      if (error) {
        console.warn("[Auth] Profile fetch error:", error.message);
        return null;
      }

      if (!data) {
        console.warn("[Auth] No profile found");
        return null;
      }

      const profileData: Profile = {
        id: data.id,
        authId: data.auth_id,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        fullName: data.full_name,
        role: data.role,
        avatarUrl: data.avatar_url,
        isActive: data.is_active,
        lastLogin: data.last_login,
        jobTitle: data.job_title ?? null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };

      console.log("[Auth] Profile loaded:", profileData.role);
      return profileData;
    } catch (error) {
      console.error("[Auth] Profile fetch exception:", error);
      return null;
    }
  }, [isDevBypass]);

  // Process session - with deduplication
  const processSession = useCallback(async (newSession: Session | null, event?: AuthChangeEvent) => {
    // Skip if signing out
    if (isSigningOutRef.current) {
      console.log("[Auth] Skipping processSession - signing out");
      return;
    }

    if (isDevBypass) {
      setUser(DEV_BYPASS_USER);
      setProfile(DEV_BYPASS_PROFILE);
      setStatus("signed-in");
      return;
    }

    const sessionId = newSession?.access_token ?? null;

    // Skip if same session (for TOKEN_REFRESHED events)
    if (event === "TOKEN_REFRESHED" && sessionId === lastProcessedSessionId.current) {
      console.log("[Auth] Skipping TOKEN_REFRESHED - same session");
      return;
    }

    // Debounce rapid events (within 1 second)
    const now = Date.now();
    if (lastEventRef.current && event) {
      const timeSinceLastEvent = now - lastEventRef.current.timestamp;
      if (timeSinceLastEvent < 1000 && lastEventRef.current.event === event) {
        console.log("[Auth] Debouncing rapid event:", event);
        return;
      }
    }

    if (event) {
      lastEventRef.current = { event, timestamp: now };
    }

    lastProcessedSessionId.current = sessionId;

    if (!newSession?.user) {
      console.log("[Auth] No session, setting signed-out");
      setUser(null);
      setProfile(null);
      setStatus("signed-out");
      return;
    }

    const authUser = newSession.user;
    const existingProfile = profile;

    // Immediately mark the user as signed-in using the cached profile/metadata
    setUser({
      id: authUser.id,
      email: authUser.email ?? "",
      fullName: existingProfile?.fullName ?? authUser.user_metadata?.fullName ?? authUser.email ?? "Unknown",
      avatarUrl: existingProfile?.avatarUrl ?? authUser.user_metadata?.avatarUrl ?? null,
      role: existingProfile?.role ?? authUser.user_metadata?.role ?? null,
      profile: existingProfile,
    });
    authHandledRef.current = true; // Mark that auth was handled
    setStatus("signed-in");
    console.log("[Auth] Session processed, status: signed-in (base user ready)");

    // Only fetch profile for SIGNED_IN or INITIAL_SESSION events, not TOKEN_REFRESHED
    const shouldFetchProfile = !event || event === "SIGNED_IN" || event === "INITIAL_SESSION";

    if (shouldFetchProfile) {
      // Fetch profile in the background to avoid blocking UI
      fetchProfile(authUser)
        .then(userProfile => {
          setProfile(userProfile);
          if (userProfile) {
            setUser(current => {
              if (!current) return current;
              return {
                ...current,
                fullName: userProfile.fullName ?? current.fullName,
                avatarUrl: userProfile.avatarUrl ?? current.avatarUrl,
                role: userProfile.role ?? current.role,
                profile: userProfile,
              };
            });
          }
          console.log("[Auth] Profile fetch complete (background)");
        })
        .catch(error => {
          console.error("[Auth] Background profile fetch error:", error);
        });
    }
  }, [fetchProfile, isDevBypass, profile]);

  // Dev user setter
  const setDevUser = useCallback((devProfile: Profile) => {
    if (!isDevBypass) return;

    setProfile(devProfile);
    setUser({
      id: devProfile.authId || devProfile.id,
      email: devProfile.email,
      fullName: devProfile.fullName || `${devProfile.firstName || ""} ${devProfile.lastName || ""}`.trim() || devProfile.email,
      avatarUrl: devProfile.avatarUrl,
      role: devProfile.role,
      profile: devProfile,
    });
    setStatus("signed-in");
  }, [isDevBypass]);

  // Initialize auth state - runs once
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    if (isDevBypass) {
      console.log("[Auth] Dev mode enabled");
      setStatus("signed-in");
      setUser(DEV_BYPASS_USER);
      return;
    }

    // Verify Supabase configuration
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error("[Auth] Supabase configuration missing");
      setStatus("signed-out");
      return;
    }

    let isMounted = true;

    // Get initial session - use getUser() to validate JWT (same as middleware)
    // This ensures client and server have synchronized auth state
    console.log("[Auth] ========== AuthProvider Init ==========");

    // Log cookies visible to client - detailed logging for debugging
    if (typeof document !== "undefined") {
      const cookieStr = document.cookie;
      const cookies = cookieStr ? cookieStr.split(';').map(c => c.trim()) : [];
      console.log("[Auth] Document cookies:", cookies.length + ' cookies');
      // Log cookie names (not values for security)
      cookies.forEach(c => {
        const name = c.split('=')[0];
        const valueLen = c.split('=')[1]?.length || 0;
        console.log(`[Auth] Cookie: "${name}" (${valueLen} chars)`);
      });
      // Check for Supabase cookies specifically
      const sbCookies = cookies.filter(c => c.startsWith('sb-'));
      console.log(`[Auth] Supabase cookies found: ${sbCookies.length}`);
    }

    // Check if Supabase client is available
    if (!supabase) {
      console.error("[Auth] Supabase client is not available");
      setStatus("signed-out");
      return;
    }

    const initAuth = async () => {
      try {
        // First, try to hydrate from cookies to avoid waiting on getSession when network hangs
        const cookieSession = parseSessionFromCookies();
        if (cookieSession) {
          console.log("[Auth] Cookie session found, processing immediately...");
          authHandledRef.current = true;
          setSession(cookieSession);
          await processSession(cookieSession, "INITIAL_SESSION");
          return;
        }

        // Use getSession() first - it reads from cookies/storage without network call
        console.log("[Auth] Calling getSession() to read local session...");
        const { data: { session: localSession }, error: sessionError } = await supabase.auth.getSession();

        if (!isMounted) return;

        // Handle refresh token errors gracefully - user needs to re-login
        if (sessionError) {
          const errorMessage = sessionError.message?.toLowerCase() || '';
          if (errorMessage.includes('refresh token') || errorMessage.includes('invalid') || errorMessage.includes('expired')) {
            console.log("[Auth] Refresh token invalid/expired - signing out silently");
            // Clear any stale cookies
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
            setStatus("signed-out");
            setSession(null);
            setUser(null);
            setProfile(null);
            return;
          }
        }

        console.log(`[Auth] getSession result: session=${localSession ? 'exists' : 'null'}, user=${localSession?.user?.email || 'none'}, error=${sessionError?.message || 'none'}`);

        if (localSession?.user) {
          // We have a local session - trust it and process
          console.log("[Auth] Local session found, processing...");
          authHandledRef.current = true;
          setSession(localSession);
          await processSession(localSession, "INITIAL_SESSION");
          return;
        }

        // No local session - set signed out
        console.log("[Auth] No local session found - setting signed-out");
        setStatus("signed-out");
        setSession(null);
        setUser(null);
        setProfile(null);
      } catch (error) {
        console.error("[Auth] Init auth exception:", error);
        // Only set signed-out if onAuthStateChange hasn't already handled auth
        // This handles the race condition where onAuthStateChange fires before getUser completes
        if (isMounted && !authHandledRef.current) {
          console.log("[Auth] Setting signed-out after timeout (auth not yet handled)");
          setStatus("signed-out");
        } else {
          console.log("[Auth] Ignoring timeout - auth already handled by onAuthStateChange");
        }
      }
    };

    // Safety timeout: if getSession hangs, avoid stuck "loading"
    const loadingTimeout = setTimeout(async () => {
      if (isMounted && !authHandledRef.current) {
        console.warn("[Auth] getSession timeout fallback - attempting cookie parse");
        const cookieSession = parseSessionFromCookies();
        if (cookieSession) {
          authHandledRef.current = true;
          setSession(cookieSession);
          await processSession(cookieSession, "INITIAL_SESSION");
          return;
        }
        console.warn("[Auth] Cookie parse failed - forcing signed-out");
        setStatus("signed-out");
      }
    }, 8000);

    // IMPORTANT: Set up auth state listener FIRST before calling initAuth
    // This ensures we catch the INITIAL_SESSION event that fires synchronously on subscription
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMounted) return;

      try {
        console.log("[Auth] Auth state changed:", event, "session:", newSession ? "exists" : "null");

        // Handle SIGNED_OUT immediately
        if (event === "SIGNED_OUT") {
          setSession(null);
          setUser(null);
          setProfile(null);
          setStatus("signed-out");
          lastProcessedSessionId.current = null;
          authHandledRef.current = false; // Reset on sign out
          return;
        }

        // Mark auth as handled IMMEDIATELY when we get a session
        // This prevents the getUser() timeout from incorrectly setting signed-out
        if (newSession) {
          console.log("[Auth] Marking auth as handled for event:", event);
          authHandledRef.current = true;
          setSession(newSession);
          await processSession(newSession, event);
        } else if (event === "INITIAL_SESSION") {
          // No session on initial load - set signed out
          console.log("[Auth] No session on initial load");
          setStatus("signed-out");
        }
      } catch (error) {
        // Handle refresh token errors gracefully
        const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
        if (errorMessage.includes('refresh token') || errorMessage.includes('invalid') || errorMessage.includes('already used')) {
          console.log("[Auth] Token error in auth state change - signing out silently");
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          setSession(null);
          setUser(null);
          setProfile(null);
          setStatus("signed-out");
        } else {
          console.error("[Auth] Auth state change error:", error);
        }
      }
    });

    // Now call initAuth as a backup validation
    initAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      clearTimeout(loadingTimeout);
    };
  }, [isDevBypass, processSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (isDevBypass) {
      setStatus("signed-in");
      setUser(DEV_BYPASS_USER);
      return {};
    }

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };

      if (data.session) {
        setSession(data.session);
        await processSession(data.session, "SIGNED_IN");
      }
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Sign in failed" };
    } finally {
      setIsProcessing(false);
    }
  }, [isDevBypass, processSession]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    metadata?: { fullName?: string; firstName?: string; lastName?: string }
  ) => {
    if (isDevBypass) {
      setStatus("signed-in");
      setUser(DEV_BYPASS_USER);
      return {};
    }

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: metadata?.fullName,
            fullName: metadata?.fullName,
            first_name: metadata?.firstName,
            firstName: metadata?.firstName,
            last_name: metadata?.lastName,
            lastName: metadata?.lastName,
          },
        },
      });

      if (error) return { error: error.message };

      if (data.session) {
        setSession(data.session);
        await processSession(data.session, "SIGNED_IN");
      }
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Sign up failed" };
    } finally {
      setIsProcessing(false);
    }
  }, [isDevBypass, processSession]);

  const signInWithGoogle = useCallback(async (redirectTo?: string) => {
    if (isDevBypass) {
      setStatus("signed-in");
      setUser(DEV_BYPASS_USER);
      return {};
    }

    setIsProcessing(true);
    try {
      if (typeof window === "undefined") {
        return { error: "Google sign in is only available in the browser" };
      }

      const currentUrl = new URL(window.location.href);
      // New users go to onboarding; the onboarding page redirects admins to /admin
      const nextParam = redirectTo || currentUrl.searchParams.get("next") || "/onboarding";

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam)}`,
          skipBrowserRedirect: false,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          }
        }
      });

      if (error) {
        setIsProcessing(false);
        return { error: error.message };
      }
      return {};
    } catch (error) {
      setIsProcessing(false);
      return { error: error instanceof Error ? error.message : "Google sign in failed" };
    }
  }, [isDevBypass]);

  const signOut = useCallback(async () => {
    if (isDevBypass) {
      console.log("[Auth] Dev mode: skipping sign out");
      return;
    }

    console.log("[Auth] Signing out...");
    isSigningOutRef.current = true;
    setIsProcessing(true);

    try {
      // Clear state immediately
      setSession(null);
      setUser(null);
      setProfile(null);
      setStatus("signed-out");
      lastProcessedSessionId.current = null;

      // Call Supabase signOut
      await supabase.auth.signOut();
      console.log("[Auth] Signed out successfully");

      // Redirect to login page
      if (typeof window !== "undefined") {
        window.location.href = "/auth/login";
      }
    } catch (error) {
      console.error("[Auth] Sign out error:", error);
      // Still redirect even if there's an error
      if (typeof window !== "undefined") {
        window.location.href = "/auth/login";
      }
    } finally {
      isSigningOutRef.current = false;
      setIsProcessing(false);
    }
  }, [isDevBypass]);

  const refreshProfile = useCallback(async () => {
    if (isDevBypass || !session?.user) return;

    const userProfile = await fetchProfile(session.user);
    setProfile(userProfile);
    if (user) {
      setUser({
        ...user,
        fullName: userProfile?.fullName ?? user.fullName,
        avatarUrl: userProfile?.avatarUrl ?? user.avatarUrl,
        role: userProfile?.role ?? user.role,
        profile: userProfile,
      });
    }
  }, [fetchProfile, isDevBypass, session, user]);

  // Compute role-based flags
  const role = profile?.role?.toLowerCase() ?? "";
  const isFullAdmin = role === "full_admin";
  const isAdmin = role === "full_admin" || role === "client_admin";

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    session,
    profile,
    isProcessing,
    isFullAdmin,
    isAdmin,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    refreshProfile,
    setDevUser: isDevBypass ? setDevUser : undefined,
  }), [status, user, session, profile, isProcessing, isFullAdmin, isAdmin, signIn, signUp, signInWithGoogle, signOut, refreshProfile, isDevBypass, setDevUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
