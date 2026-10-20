import { NextResponse } from "next/server";
import { getMembership } from "@/lib/business";
import { canManage } from "@/lib/permissions";
import { csvResponse, toCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";

const MAX_ROWS = 5000;
const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", ewallet: "E-wallet", stripe: "Online" };

type Params = { params: Promise<{ kind: string }> };

// Downloads: /api/export/products, /api/export/stock, /api/export/sales[?days=30]
// Everything is read through the logged-in user's own session, so the database's role rules apply:
// a cashier cannot export anything but their own sales.
export async function GET(request: Request, { params }: Params) {
  const { kind } = await params;
  const membership = await getMembership();
  if (!membership) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const { business, role } = membership;

  const supabase = await createClient();
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === "sales") {
    const days = Number(new URL(request.url).searchParams.get("days"));
    let query = supabase
      .from("sales")
      .select("receipt_no,created_at,status,subtotal,discount,tax,total,payments(method,reference)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (Number.isFinite(days) && days >= 1 && days <= 3650) {
      query = query.gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
    }
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = ((data ?? []) as unknown as {
      receipt_no: string | null; created_at: string; status: string;
      subtotal: number; discount: number; tax: number; total: number;
      payments: { method: string; reference: string | null }[];
    }[]).map((s) => [
      s.receipt_no,
      s.created_at,
      s.status,
      METHOD_LABEL[s.payments[0]?.method] ?? s.payments[0]?.method ?? "",
      s.payments[0]?.reference ?? "",
      s.subtotal,
      s.discount,
      s.tax,
      s.total,
    ]);
    return csvResponse(
      `sales-${stamp}.csv`,
      toCsv(["Receipt", "Date (UTC)", "Status", "Payment", "Payment reference", "Subtotal", "Discount", "Tax", "Total"], rows)
    );
  }

  // Inventory exports contain costs, so they are for owners and managers only.
  if (!canManage(role)) return NextResponse.json({ error: "Only an owner or manager can export inventory." }, { status: 403 });

  if (kind === "products") {
    const [productsRes, stockRes, catRes, costRes] = await Promise.all([
      supabase
        .from("products")
        .select("id,code,barcode,name,category_id,unit,selling_price,reorder_level,is_active")
        .eq("business_id", business.id)
        .order("name")
        .limit(MAX_ROWS),
      supabase.from("product_stock").select("product_id,total_quantity,sellable_quantity,nearest_expiry").eq("business_id", business.id),
      supabase.from("categories").select("id,name").eq("business_id", business.id),
      supabase
        .from("stock_batches")
        .select("product_id,base_price")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false }),
    ]);
    if (productsRes.error) return NextResponse.json({ error: productsRes.error.message }, { status: 500 });

    const stock = new Map(
      ((stockRes.data ?? []) as { product_id: string; total_quantity: number; sellable_quantity: number; nearest_expiry: string | null }[]).map((s) => [s.product_id, s])
    );
    const cats = new Map(((catRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    const cost = new Map<string, number>();
    for (const b of (costRes.data ?? []) as { product_id: string; base_price: number }[]) {
      if (!cost.has(b.product_id)) cost.set(b.product_id, b.base_price); // newest first
    }

    const rows = ((productsRes.data ?? []) as {
      id: string; code: string; barcode: string | null; name: string; category_id: string | null;
      unit: string; selling_price: number; reorder_level: number; is_active: boolean;
    }[]).map((p) => {
      const s = stock.get(p.id);
      return [
        p.code, p.barcode, p.name, p.category_id ? cats.get(p.category_id) ?? "" : "", p.unit,
        p.selling_price, cost.get(p.id), p.reorder_level,
        s?.total_quantity ?? 0, s?.sellable_quantity ?? 0, s?.nearest_expiry,
        !p.is_active || p.selling_price <= 0 ? "Needs pricing" : "Active",
      ];
    });
    return csvResponse(
      `products-${stamp}.csv`,
      toCsv(["Code", "Barcode", "Name", "Category", "Unit", "Selling price", "Latest cost", "Reorder level", "In stock", "Sellable", "Next expiry", "Status"], rows)
    );
  }

  if (kind === "stock") {
    const { data, error } = await supabase
      .from("stock_batches")
      .select("batch_no,date_received,expiry_date,quantity_received,quantity_remaining,base_price,products(code,name),suppliers(name)")
      .eq("business_id", business.id)
      .order("date_received", { ascending: false })
      .limit(MAX_ROWS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = ((data ?? []) as unknown as {
      batch_no: string | null; date_received: string; expiry_date: string | null;
      quantity_received: number; quantity_remaining: number; base_price: number;
      products: { code: string; name: string } | null; suppliers: { name: string } | null;
    }[]).map((b) => [
      b.products?.code, b.products?.name, b.batch_no, b.suppliers?.name,
      b.date_received, b.expiry_date, b.quantity_received, b.quantity_remaining, b.base_price,
      b.quantity_remaining * b.base_price,
    ]);
    return csvResponse(
      `stock-batches-${stamp}.csv`,
      toCsv(["Product code", "Product", "Batch", "Supplier", "Date received", "Expiry date", "Received", "Remaining", "Base price", "Value remaining"], rows)
    );
  }

  return NextResponse.json({ error: "Unknown export." }, { status: 404 });
}
