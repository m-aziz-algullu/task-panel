"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_MS = 5_000;

/**
 * Re-fetches the page every few seconds while `active` (some task is queued for
 * or being worked on by the agent), so cards follow the run: queued, running,
 * then moved to their next column when the agent reports.
 */
export function useAgentRefresh(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      // A hidden tab doesn't need fresh cards; it catches up when it's shown.
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);
}
