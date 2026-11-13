"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const EVERY_MS = 30_000;

// Reloads the page's data every 30 seconds and when the tab is brought back, so orders placed on the
// website or by other staff appear on open admin screens without a manual reload. Forms keep what was typed.
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (navigator.onLine && document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, EVERY_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [router]);
  return null;
}
