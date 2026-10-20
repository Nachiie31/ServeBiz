import Link from "next/link";
import { notFound } from "next/navigation";
import { getMembership, getTaxSettings } from "@/lib/business";
import { canManage } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import Receipt, { type ReceiptData } from "@/components/Receipt";
import PrintButton from "./PrintButton";
import VoidButton from "./VoidButton";

export default async function SaleDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  const { business, role } = (await getMembership())!;
  const taxSettings = await getTaxSettings(business.id);
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("sales")
    .select("id,receipt_no,created_at,status,subtotal,discount,tax,total")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!sale) notFound();

  const [itemsRes, payRes] = await Promise.all([
    supabase.from("sale_items").select("quantity,unit_price,products(name)").eq("sale_id", id),
    supabase.from("payments").select("method,amount,amount_tendered,reference").eq("sale_id", id).limit(1),
  ]);

  const items = ((itemsRes.data ?? []) as unknown as { quantity: number; unit_price: number; products: { name: string } | null }[]).map(
    (i) => ({ name: i.products?.name ?? "Item", quantity: i.quantity, unit_price: i.unit_price })
  );
  const pay = (payRes.data ?? [])[0] as { method: string; amount: number; amount_tendered: number | null; reference: string | null } | undefined;

  const data: ReceiptData = {
    ...(sale as Omit<ReceiptData, "items" | "method" | "tendered">),
    method: pay?.method ?? "cash",
    tendered: pay?.method === "cash" ? pay.amount_tendered : null,
    items,
  };

  return (
    <>
      <Link href="/sales" className="back">&larr; Back to sales</Link>
      <div className="page-head">
        <div>
          <h2>Receipt {data.receipt_no}</h2>
          {pay?.reference && <p>Payment reference: {pay.reference}</p>}
        </div>
      </div>

      {paid === "1" && (
        <div className="alert" style={{ maxWidth: 380 }}>Online payment received. The sale is recorded and stock updated.</div>
      )}

      <div style={{ maxWidth: 380 }}>
        <Receipt
          business={business}
          currency={business.currency}
          data={data}
          taxLabel={taxSettings.rate > 0 ? `${taxSettings.name} (${taxSettings.rate}%${taxSettings.inclusive ? ", included" : ""})` : taxSettings.name}
        />
        <div className="modal-actions">
          <PrintButton />
          {data.status === "completed" && canManage(role) && <VoidButton saleId={id} />}
        </div>
      </div>
    </>
  );
}
