import { getAllMemberships, getTaxSettings, requireMembership } from "@/lib/business";
import { getConnectedAccount } from "@/lib/payment-route";
import { defaultCountryFor } from "@/lib/stripe-connect";
import { isStripeEnabled } from "@/lib/stripe";
import PaymentsCard from "./PaymentsCard";
import { createClient } from "@/lib/supabase/server";
import OrgNameForm from "./OrgNameForm";
import SettingsForm from "./SettingsForm";
import TaxForm from "./TaxForm";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ payments?: string; msg?: string }> }) {
  const sp = await searchParams;
  const { business, isGuest } = (await requireMembership());
  const tax = await getTaxSettings(business.id);
  const supabaseForPay = await createClient();
  const acct = await getConnectedAccount(supabaseForPay, business.id);
  const all = await getAllMemberships();
  const siblings: { id: string; name: string }[] = [];
  for (const e of all) {
    if (e.business.id === business.id || e.role !== "owner" || e.business.organization_id !== business.organization_id) continue;
    if ((await getConnectedAccount(supabaseForPay, e.business.id))) siblings.push({ id: e.business.id, name: e.business.branch_name ?? e.business.name });
  }
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

      <PaymentsCard s={{
        businessId: business.id,
        platformReady: isStripeEnabled(),
        isGuest,
        account: acct ? { suffix: acct.stripe_account_id.slice(-4), chargesEnabled: acct.charges_enabled, detailsSubmitted: acct.details_submitted } : null,
        defaultCountry: defaultCountryFor(business.currency),
        sameBusinessBranches: siblings,
        flash: sp.payments ? { state: sp.payments, msg: sp.msg ?? null } : null,
      }} />

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
