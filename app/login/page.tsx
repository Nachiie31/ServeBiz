"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PASSWORD_MAX, passwordRules, isStrongPassword } from "@/lib/password";
import Turnstile, { TURNSTILE_SITE_KEY, type TurnstileHandle } from "@/components/Turnstile";

const captchaOn = !!TURNSTILE_SITE_KEY;

function explain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("captcha")) {
    return captchaOn
      ? "The CAPTCHA check did not pass. Please try again."
      : "CAPTCHA is turned on in Supabase, but this site has no CAPTCHA key. Add NEXT_PUBLIC_TURNSTILE_SITE_KEY (see the README) or turn CAPTCHA off in Supabase under Authentication > Attack Protection.";
  }
  if (m.includes("anonymous")) {
    return "Guest login is off. In Supabase, enable Authentication > Sign In / Providers > Allow anonymous sign-ins.";
  }
  return message;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const captcha = useRef<TurnstileHandle>(null);
  const autoGuest = useRef(false);

  // A CAPTCHA token works once. Take a fresh one after every attempt.
  const captchaOptions = () => (token ? { captchaToken: token } : undefined);
  const refreshCaptcha = () => captcha.current?.reset();
  const waiting = captchaOn && !token;

  async function continueAsGuest() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInAnonymously({ options: captchaOptions() });
    if (error) {
      setError(explain(error.message));
      setLoading(false);
      refreshCaptcha();
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  // "Try the guest demo" on the landing page arrives here and signs in on its own, once the
  // CAPTCHA (if any) has been solved.
  useEffect(() => {
    if (params.get("guest") !== "1" || autoGuest.current) return;
    if (captchaOn && !token) return;
    autoGuest.current = true;
    void continueAsGuest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (mode === "signup") {
      if (!isStrongPassword(password)) {
        setError("Your password does not meet all the requirements below.");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback`, ...captchaOptions() },
      });
      if (error) {
        setError(explain(error.message));
        setLoading(false);
        refreshCaptcha();
        return;
      }
      if (!data.session) {
        setNotice("Check your email to confirm your account, then log in.");
        setLoading(false);
        refreshCaptcha();
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password, options: captchaOptions() });
      if (error) {
        setError(explain(error.message));
        setLoading(false);
        refreshCaptcha();
        return;
      }
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Link href="/" className="logo" style={{ marginBottom: 18 }}>
          <span className="logo-mark" /> ServeBiz
        </Link>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="sub">
          {mode === "login" ? "Log in to manage your business." : "Start with an email and password."}
        </p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="password" className="input" type={showPw ? "text" : "password"} required value={password}
                maxLength={PASSWORD_MAX}
                onChange={(e) => setPassword(mode === "signup" ? e.target.value.replace(/\s/g, "") : e.target.value)}
                onKeyDown={(e) => { if (mode === "signup" && e.key === " ") e.preventDefault(); }}
                autoComplete={mode === "login" ? "current-password" : "new-password"} />
              <button type="button" className="btn" onClick={() => setShowPw(!showPw)} aria-pressed={showPw}>
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
            {mode === "signup" && (
              <ul className="pw-rules" aria-live="polite" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: 13 }}>
                {passwordRules(password).map((r) => (
                  <li key={r.id} style={{ color: r.ok ? "#15803d" : "#6b7280" }}>
                    {r.ok ? "✓" : "○"} {r.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Turnstile ref={captcha} onToken={setToken} />

          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="notice">{notice}</p>}

          <button className="btn btn-primary btn-block" disabled={loading || waiting || (mode === "signup" && !isStrongPassword(password))} type="submit">
            {loading ? "Please wait..." : waiting ? "Checking you are human..." : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>

        <div className="divider">or</div>

        <button className="btn btn-block" onClick={continueAsGuest} disabled={loading || waiting} type="button">
          Continue as guest (portfolio demo)
        </button>

        <p className="sub" style={{ marginTop: 18, marginBottom: 0, textAlign: "center" }}>
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button className="link-btn" type="button"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); setNotice(null); }}>
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
