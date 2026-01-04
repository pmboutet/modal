"use client";

import { useEffect, useState } from "react";

/**
 * Adds top padding when the developer mode switcher is visible.
 * The initial render mirrors the server output to avoid hydration mismatches,
 * then updates after mount if dev mode is enabled.
 */
export function DevUserSwitcherSpacer() {
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    const rawValue = (process.env.NEXT_PUBLIC_IS_DEV ?? "").toString().toLowerCase();

    if (rawValue === "true" || rawValue === "1") {
      setIsDev(true);
      return;
    }

    // Allow manual override via localStorage or URL flag, mirroring DevUserSwitcher logic
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (
        localStorage.getItem("dev_mode_override") === "true" ||
        urlParams.get("dev") === "true"
      ) {
        setIsDev(true);
      }
    }
  }, []);

  if (!isDev) {
    return null;
  }

  return <div className="hidden md:block pt-14" aria-hidden />;
}
