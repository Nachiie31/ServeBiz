"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BUSINESS_TYPES } from "@/lib/business-types";
import type { Business } from "@/lib/business";

const CURRENCIES = ["PHP", "USD", "SGD", "EUR", "GBP", "JPY", "AUD", "CAD", "HKD", "MYR", "THB", "IDR", "VND", "INR"];

export default function SettingsForm({ business }: { business: Business }) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(business.name);
  const [type, setType] = useState(business.business_type);
  const [location, setLocation] = useState(business.location ?? "");
  const [phone, setPhone] = useState(business.contact_phone ?? "");
  const [email, setEmail] = useState(business.contact_email ?? "");
  const [currency, setCurrency] = useState(business.currency);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (!name.trim()) return setError("Business name is required.");

    setLoading(true);
    const { error: updErr } = await supabase
      .from("businesses")
      .update({
        name: name.trim(),
        business_type: type,
        location: location.trim() || null,
        contact_phone: phone.trim() || null,
        contact_email: email.trim() || null,
        currency,
      })
      .eq("id", business.id);
    setLoading(false);

    if (updErr) return setError(updErr.message);
    setSaved(true);
    router.refresh();
  }

  const types = BUSINESS_TYPES.includes(type) ? BUSINESS_TYPES : [type, ...BUSINESS_TYPES];
  const currencies = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES];

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="alert err" role="alert">{error}</div>}
      {saved && <div className="alert">Settings saved.</div>}

      <div className="field">
        <label htmlFor="name">Business name</label>
        <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="type">Type of business</label>
          <select id="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="location">Location</label>
          <input id="location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="phone">Contact number</label>
          <input id="phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="email">Contact email</label>
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="currency">Currency</label>
          <select id="currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
