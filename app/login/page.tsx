"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const autoGuest = useRef(false);

  async function continueAsGuest() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setError(
        error.message.toLowerCase().includes("anonymous")
          ? "Guest login is off. In Supabase, enable Authentication > Sign In / Providers > Allow anonymous sign-ins."
          : error.message
      );
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  useEffect(() => {
    if (params.get("guest") === "1" && !autoGuest.current) {
      autoGuest.current = true;
      void continueAsGuest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      if (!data.session) {
        setNotice("Check your email to confirm your account, then log in.");
        setLoading(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
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
            <input id="password" className="input" type="password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>

          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="notice">{notice}</p>}

          <button className="btn btn-primary btn-block" disabled={loading} type="submit">
            {loading ? "Please wait..." : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>

        <div className="divider">or</div>

        <button className="btn btn-block" onClick={continueAsGuest} disabled={loading} type="button">
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
