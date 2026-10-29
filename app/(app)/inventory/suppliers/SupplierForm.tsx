"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SupplierForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: insErr } = await supabase
      .from("suppliers")
      .insert({ business_id: businessId, name: name.trim(), contact: contact.trim() || null });

    setLoading(false);
    if (insErr) {
      return setError(insErr.code === "23505" ? `You already have a supplier called "${name.trim()}".` : insErr.message);
    }

    setName("");
    setContact("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="alert err" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="sname">Supplier name</label>
        <input id="sname" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="scontact">Contact <span className="hint">(phone or email, optional)</span></label>
        <input id="scontact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={loading || !name.trim()}>
        {loading ? "Saving..." : "Add supplier"}
      </button>
    </form>
  );
}
