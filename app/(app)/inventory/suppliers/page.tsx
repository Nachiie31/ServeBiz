import { requireBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import type { Supplier } from "@/lib/types";
import { redirect } from "next/navigation";
import Paginator from "@/components/Paginator";
import { PAGE_SIZE, pageCount, parsePage } from "@/lib/paging";
import SupplierForm from "./SupplierForm";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const business = (await requireBusiness());
  const supabase = await createClient();

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await supabase
    .from("suppliers")
    .select("id,name,contact", { count: "exact" })
    .eq("business_id", business.id)
    .order("name")
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  const total = count ?? 0;
  if (page > 1 && page > pageCount(total)) redirect(`/inventory/suppliers${pageCount(total) > 1 ? `?page=${pageCount(total)}` : ""}`);
  const suppliers = (data ?? []) as Supplier[];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Suppliers</h2>
          <p>Keep a list of who you buy from, so you can pick them when receiving products.</p>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Add supplier</h3>
          <SupplierForm businessId={business.id} />
        </div>

        <div className="table-wrap">
          {suppliers.length === 0 ? (
            <div className="empty">No suppliers yet.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Name</th><th>Contact</th></tr></thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.contact ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Paginator basePath="/inventory/suppliers" page={page} total={total} pageSize={PAGE_SIZE} noun="suppliers" />
        </div>
      </div>
    </>
  );
}
