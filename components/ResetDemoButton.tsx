"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResetDemoButton() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!window.confirm("Reset the demo? Everything you changed will be replaced with fresh sample data.")) return;
    setLoading(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("reset_demo");
    setLoading(false);
    if (rpcErr) {
      setError(
        rpcErr.message.includes("reset_demo")
          ? "Run supabase/migrations/007_demo.sql in Supabase first."
          : rpcErr.message
      );
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <button className="btn btn-sm" type="button" onClick={reset} disabled={loading}>
        {loading ? "Resetting..." : "Reset demo"}
      </button>
      {error && <span className="error" role="alert" style={{ margin: 0 }}>{error}</span>}
    </>
  );
}
