"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function VoidButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onVoid() {
    if (!window.confirm("Void this sale? The items will be returned to stock.")) return;
    setLoading(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: null });
    setLoading(false);
    if (rpcErr) {
      setError(
        rpcErr.message.includes("void_sale")
          ? "The POS functions are missing. Run supabase/migrations/003_pos.sql in Supabase first."
          : rpcErr.message
      );
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button className="btn" type="button" onClick={onVoid} disabled={loading} style={{ color: "var(--danger)" }}>
        {loading ? "Voiding..." : "Void sale"}
      </button>
      {error && <div className="alert err" role="alert" style={{ marginTop: 10, flexBasis: "100%" }}>{error}</div>}
    </>
  );
}
