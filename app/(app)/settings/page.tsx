import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage() {
  const business = (await getCurrentBusiness())!;
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("tax_rate").eq("id", business.id).single();
  const taxRate = Number((data as { tax_rate: number } | null)?.tax_rate ?? 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Business details, currency, and tax. These appear on receipts.</p>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 640 }}>
        <SettingsForm business={business} taxRate={taxRate} />
      </div>
    </>
  );
}
