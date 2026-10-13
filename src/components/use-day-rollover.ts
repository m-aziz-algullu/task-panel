"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Re-renders the page from the server once the day ends, so tasks finished
 * "yesterday" leave the board without a manual reload. Also catches up when a
 * sleeping laptop or a background tab missed the timer.
 */
export function useDayRollover(nextDayAt: number) {
  const router = useRouter();

  useEffect(() => {
    const check = () => {
      if (Date.now() >= nextDayAt) router.refresh();
    };
    const timer = setTimeout(check, Math.min(Math.max(nextDayAt - Date.now() + 1000, 1000), MAX_TIMEOUT));
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [nextDayAt, router]);
}
