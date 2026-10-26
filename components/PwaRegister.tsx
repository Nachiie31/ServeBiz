"use client";

import { useEffect } from "react";

/** Registers the service worker (production only) and shares the loaded script files so they work offline. */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (cancelled || !reg.active) return;
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.includes("/_next/static/"));
        reg.active.postMessage({ type: "precache", urls });
      })
      .catch(() => {
        // Not critical: the app works normally without offline support.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

/** Call on log out: forget the cached POS page. */
export function clearCachedPages() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-pages" });
    void caches?.delete("servebiz-pages");
  } catch {
    // ignore
  }
}
