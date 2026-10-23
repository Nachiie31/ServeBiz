"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function OrgNameForm({ orgId, initial }: { orgId: string; initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setMsg({ ok: false, text: "Name is required." });
    setBusy(true);
    const { error } = await createClient().from("organizations").update({ name: name.trim() }).eq("id", orgId);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <form onSubmit={save} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input className="input" style={{ flex: 1, minWidth: 200 }} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-label="Business name" />
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Saving..." : "Save"}</button>
      {msg && <span className={msg.ok ? "muted" : "error"} role="status">{msg.text}</span>}
    </form>
  );
}
