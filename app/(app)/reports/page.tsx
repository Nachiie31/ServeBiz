import { requireBusiness } from "@/lib/business";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  const business = (await requireBusiness());
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p>How much you sold, what you earned, and what sells best. Completed sales only; voided sales are left out.</p>
        </div>
      </div>
      <ReportsClient businessId={business.id} currency={business.currency} />
    </>
  );
}
