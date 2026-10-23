import { getCurrentBusiness, getTaxSettings } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import OrgNameForm from "./OrgNameForm";
import SettingsForm from "./SettingsForm";
import TaxForm from "./TaxForm";

export default async function SettingsPage() {
  const business = (await getCurrentBusiness())!;
  const tax = await getTaxSettings(business.id);
  let org: { id: string; name: string } | null = null;
  if (business.organization_id) {
    const supabase = await createClient();
    const { data } = await supabase.from("organizations").select("id,name").eq("id", business.organization_id).single();
    org = (data as { id: string; name: string } | null) ?? null;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Tax, business details, and currency. These appear on receipts.</p>
        </div>
      </div>

      {org && (
        <div className="card" style={{ maxWidth: 640, marginBottom: 20 }}>
          <h3 style={{ marginBottom: 4 }}>Business name (all branches)</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Groups your branches together. Each branch has its own name, details, tax and team below.
          </p>
          <OrgNameForm orgId={org.id} initial={org.name} />
        </div>
      )}

      <div className="card" id="tax" style={{ maxWidth: 640, marginBottom: 20, scrollMarginTop: 16 }}>
        <h3 style={{ marginBottom: 4 }}>Tax</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Applied automatically at checkout and shown on receipts. Set the rate to 0 for no tax.
        </p>
        <TaxForm businessId={business.id} initial={tax} />
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <h3 style={{ marginBottom: 14 }}>Business details</h3>
        <SettingsForm business={business} />
      </div>
    </>
  );
}
