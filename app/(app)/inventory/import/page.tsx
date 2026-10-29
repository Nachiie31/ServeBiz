import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/paging";
import ImportClient from "./ImportClient";

export default async function ImportPage() {
  const business = (await requireBusiness());
  const supabase = await createClient();

  const [codes, suppliers] = await Promise.all([
    fetchAll<{ code: string }>((a, b) =>
      supabase.from("products").select("code").eq("business_id", business.id).order("id").range(a, b), 50000),
    fetchAll<{ id: string; name: string }>((a, b) =>
      supabase.from("suppliers").select("id,name").eq("business_id", business.id).order("id").range(a, b), 5000),
  ]);

  return (
    <>
      <Link href="/inventory/products" className="back">&larr; Back to products</Link>
      <div className="page-head">
        <div>
          <h2>Import from CSV</h2>
          <p>Add many deliveries at once. Each row is one delivery (a batch), the same as using Receiving.</p>
        </div>
      </div>
      <ImportClient
        businessId={business.id}
        existingCodes={codes.map((c) => c.code)}
        suppliers={suppliers}
      />
    </>
  );
}
