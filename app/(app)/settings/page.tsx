import { getCurrentBusiness, getTaxSettings } from "@/lib/business";
import SettingsForm from "./SettingsForm";
import TaxForm from "./TaxForm";

export default async function SettingsPage() {
  const business = (await getCurrentBusiness())!;
  const tax = await getTaxSettings(business.id);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Tax, business details, and currency. These appear on receipts.</p>
        </div>
      </div>

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
