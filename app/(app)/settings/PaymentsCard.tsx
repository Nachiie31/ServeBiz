"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CONNECT_COUNTRIES } from "@/lib/stripe-connect";

export type PaymentsState = {
  businessId: string;
  platformReady: boolean;          // the server has a Stripe test key
  isGuest: boolean;
  account: { suffix: string; chargesEnabled: boolean; detailsSubmitted: boolean } | null;
  defaultCountry: string;
  sameBusinessBranches: { id: string; name: string }[];   // other branches you own that have a connected account
  flash: { state: string; msg: string | null } | null;
};

export default function PaymentsCard({ s }: { s: PaymentsState }) {
  const router = useRouter();
  const supabase = createClient();
  const [country, setCountry] = useState(s.defaultCountry);
  const [copyFrom, setCopyFrom] = useState(s.sameBusinessBranches[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: s.businessId, country }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) { setError(json.error ?? "Could not start the setup."); setBusy(false); return; }
      window.location.href = json.url;
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Stop using this Stripe account for this branch? Online payments will use the shared test account (or be unavailable). Your Stripe account itself is not changed.")) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.rpc("clear_stripe_account", { p_business_id: s.businessId });
    setBusy(false);
    if (err) return setError(err.message);
    router.refresh();
  }

  async function copy() {
    setBusy(true); setError(null);
    const { error: err } = await supabase.rpc("copy_stripe_account", { p_from: copyFrom, p_to: s.businessId });
    setBusy(false);
    if (err) return setError(err.message);
    router.refresh();
  }

  const acct = s.account;
  return (
    <div className="card" id="payments" style={{ maxWidth: 640, marginBottom: 20, scrollMarginTop: 16 }}>
      <h3 style={{ marginBottom: 4 }}>Online payments</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Each branch can take online payments (card, and others Stripe offers) into <strong>its own Stripe account</strong>, so the money goes to that business.
        Cash is always available.
      </p>

      {s.flash?.state === "ok" && <div className="alert">Stripe account connected. Online payments are ready for this branch.</div>}
      {s.flash?.state === "pending" && <div className="alert warn">Stripe still needs some details before this branch can take payments. Press Continue setup.</div>}
      {s.flash?.state === "error" && <div className="alert err" role="alert">{s.flash.msg ?? "Something went wrong with Stripe."}</div>}

      {!s.platformReady && (
        <div className="alert warn">This server has no Stripe test key yet (<code>STRIPE_SECRET_KEY</code>), so online payments cannot be set up. See the README.</div>
      )}

      {s.isGuest ? (
        <p className="muted">Guest demos use the shared test account. Sign up to connect your own.</p>
      ) : acct ? (
        <>
          <p style={{ margin: "8px 0" }}>
            Stripe account <code>...{acct.suffix}</code>:{" "}
            {acct.chargesEnabled
              ? <span className="chip">Ready for payments</span>
              : <span className="chip warn">{acct.detailsSubmitted ? "Under review by Stripe" : "Setup not finished"}</span>}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!acct.chargesEnabled && <button className="btn btn-primary" type="button" disabled={busy || !s.platformReady} onClick={connect}>Continue setup</button>}
            <a className="btn" href={`/api/stripe/connect/return?business=${encodeURIComponent(s.businessId)}`}>Refresh status</a>
            <button className="btn" type="button" disabled={busy} onClick={disconnect} style={{ color: "var(--danger)" }}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: "8px 0" }}>
            <span className="chip warn">Not connected</span>{" "}
            <span className="muted" style={{ fontSize: 14 }}>Online payments currently use the shared ServeBiz test account (or are off).</span>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label htmlFor="pay-country" className="muted" style={{ fontSize: 14 }}>Business country</label>
            <select id="pay-country" className="input" style={{ width: "auto" }} value={country} onChange={(e) => setCountry(e.target.value)}>
              {CONNECT_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <button className="btn btn-primary" type="button" disabled={busy || !s.platformReady} onClick={connect}>{busy ? "Opening Stripe..." : "Connect Stripe account"}</button>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>The country cannot be changed later for that Stripe account.</p>
          {s.sameBusinessBranches.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 14 }}>or use the same Stripe account as</span>
              <select className="input" style={{ width: "auto" }} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label="Branch to copy from">
                {s.sameBusinessBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="btn" type="button" disabled={busy} onClick={copy}>Use it here</button>
            </div>
          )}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
