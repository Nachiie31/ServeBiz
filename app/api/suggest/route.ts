import { NextResponse } from "next/server";
import { getMembership } from "@/lib/business";
import { canManage } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/** Search suggestions for the current branch's products (name, code or barcode). */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  const membership = await getMembership();
  if (!membership || !canManage(membership.role)) return NextResponse.json({ items: [] }, { status: 401 });
  if (q.length < 1) return NextResponse.json({ items: [] });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_products", {
    p_business_id: membership.business.id,
    p_q: q,
    p_filter: "all",
    p_limit: 8,
    p_offset: 0,
  });
  if (error) return NextResponse.json({ items: [] });
  const items = ((data ?? []) as { name: string; code: string }[]).map((p) => ({ label: p.name, hint: p.code }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
