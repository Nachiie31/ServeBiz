import Link from "next/link";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/paging";
import NewPoForm from "./NewPoForm";

export default async function NewPoPage() {
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();
  const [suppliers, products] = await Promise.all([
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("suppliers").select("id,name").eq("business_id", business.id).order("name").order("id").range(a, b), 5000),
    fetchAll<{ code: string; name: string }>((a, b) => supabase.from("products").select("code,name").eq("business_id", business.id).order("name").order("id").range(a, b), 5000),
  ]);
  return (
    <>
      <Link href="/inventory/purchase-orders" className="back">&larr; Back to purchase orders</Link>
      <div className="page-head"><div><h2>New purchase order</h2><p>List what you are ordering. You can receive it in parts later.</p></div></div>
      <NewPoForm businessId={business.id} currency={business.currency} suppliers={suppliers} products={products} />
    </>
  );
}
