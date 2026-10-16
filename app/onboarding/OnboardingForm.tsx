"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BUSINESS_TYPES } from "@/lib/business-types";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export default function OnboardingForm() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [type, setType] = useState(BUSINESS_TYPES[0]);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_LOGO_BYTES) {
      setError("Logo must be 2 MB or smaller.");
      e.target.value = "";
      return;
    }
    setError(null);
    setLogo(file);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    let logoUrl: string | null = null;
    if (logo) {
      const ext = logo.name.split(".").pop() ?? "png";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("logos").upload(path, logo);
      if (uploadError) {
        setError(`Logo upload failed: ${uploadError.message}`);
        setLoading(false);
        return;
      }
      logoUrl = supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
    }

    const { error: rpcError } = await supabase.rpc("create_business", {
      p_name: name.trim(),
      p_type: type,
      p_logo_url: logoUrl,
      p_location: location.trim() || null,
      p_phone: phone.trim() || null,
      p_email: email.trim() || null,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ maxWidth: 520 }}>
        <h1>Set up your business</h1>
        <p className="sub">Tell us about your business. You can change these details later in settings.</p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Business name</label>
            <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="type">Type of business</label>
            <select id="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {BUSINESS_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="logo">Logo <span className="hint">(optional, PNG or JPG, up to 2 MB)</span></label>
            <input id="logo" className="input" type="file" accept="image/*" onChange={onLogoChange} />
          </div>

          <div className="field">
            <label htmlFor="location">Location</label>
            <input id="location" className="input" value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="Street, city" />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="phone">Contact number</label>
              <input id="phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="bemail">Contact email</label>
              <input id="bemail" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          <button className="btn btn-primary btn-block" disabled={loading || !name.trim()} type="submit">
            {loading ? "Saving..." : "Continue to ServeBiz"}
          </button>
        </form>
      </div>
    </div>
  );
}
