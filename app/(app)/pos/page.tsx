import { getMembership, getTaxSettings } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/lib/types";
import { getPaymentRoute } from "@/lib/payment-route";
import { fetchAll } from "@/lib/paging";
import PosClient, { type PosProduct } from "./PosClient";

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string; stripe_error?: string }>;
}) {
  const { canceled, stripe_error } = await searchParams;
  const { business, role, userId, isGuest } = (await getMembership())!;
  const supabase = await createClient();

  const route = await getPaymentRoute(supabase, business.id, isGuest);
  const [productsData, stockRes, catRes, tax] = await Promise.all([
    fetchAll((a, b) =>
      supabase
        .from("products")
        .select("id,code,barcode,name,category_id,unit,selling_price")
        .eq("business_id", business.id)
        .eq("is_active", true)
        .gt("selling_price", 0)
        .order("name")
        .order("id")
        .range(a, b)),
    (async () => {
      try {
        const data = await fetchAll((a, b) =>
          supabase.from("product_stock").select("product_id,sellable_quantity")
            .eq("business_id", business.id).order("product_id").range(a, b));
        return { data, error: null as { message: string } | null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    })(),
    supabase.from("categories").select("id,name").eq("business_id", business.id).order("name"),
    getTaxSettings(business.id),
  ]);

  const stock = new Map(
    ((stockRes.data ?? []) as { product_id: string; sellable_quantity: number }[]).map((s) => [s.product_id, s.sellable_quantity])
  );

  const products: PosProduct[] = (
    (productsData ?? []) as {
      id: string; code: string; barcode: string | null; name: string;
      category_id: string | null; unit: string; selling_price: number;
    }[]
  ).map((p) => ({
    id: p.id,
    code: p.code,
    barcode: p.barcode,
    name: p.name,
    categoryId: p.category_id,
    unit: p.unit,
    price: p.selling_price,
    stock: stock.get(p.id) ?? 0,
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Point of sale</h2>
          <p>Search or scan a barcode, build the cart, and check out.</p>
        </div>
      </div>
      {stockRes.error && (
        <div className="alert err">
          Stock levels could not be loaded. Run <code>supabase/migrations/003_pos.sql</code> in the Supabase SQL Editor, then refresh.
        </div>
      )}
      <PosClient
        business={{ id: business.id, name: business.name, location: business.location, contact_phone: business.contact_phone }}
        currency={business.currency}
        taxRate={tax.rate}
        taxName={tax.name}
        taxInclusive={tax.inclusive}
        products={products}
        categories={(catRes.data ?? []) as Category[]}
        stripeEnabled={route.mode !== "none"}
        onlineNote={route.mode === "connected" ? "Online payments go to this branch's Stripe account." : route.mode === "none" ? route.reason : null}
        notice={stripe_error ? stripe_error.slice(0, 600) : null}
        restoreCart={canceled === "1" || !!stripe_error}
        canEditTax={role === "owner"}
        userId={userId}
      />
    </>
  );
}
