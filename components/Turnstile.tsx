"use client";

import Script from "next/script";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Empty when CAPTCHA is not configured. Then the login page behaves exactly as before. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export type TurnstileHandle = { reset: () => void };

type Props = { onToken: (token: string | null) => void };

/**
 * Cloudflare Turnstile widget. Tokens work once, so call reset() after every sign-in attempt.
 * Renders nothing when no site key is configured.
 */
const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile({ onToken }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !scriptReady || !box.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(box.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token: string) => onTokenRef.current(token),
      "expired-callback": () => onTokenRef.current(null),
      "error-callback": () => onTokenRef.current(null),
    });
    return () => {
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [scriptReady]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={box} style={{ margin: "4px 0 14px", minHeight: 65 }} />
    </>
  );
});

export default Turnstile;
