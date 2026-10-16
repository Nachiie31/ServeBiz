import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import type { Supplier } from "@/lib/types";
import SupplierForm from "./SupplierForm";

export default async function SuppliersPage() {
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();

  const { data } = await supabase
    .from("suppliers")
    .select("id,name,contact")
    .eq("business_id", business.id)
    .order("name");
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
        </div>
      </div>
    </>
  );
}
