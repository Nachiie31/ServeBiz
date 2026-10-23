import Link from "next/link";
import { getAllMemberships, getMembership } from "@/lib/business";
import { ROLE_LABEL } from "@/lib/permissions";
import { selectBusiness } from "./actions";
import AddBranchForm from "./AddBranchForm";

export default async function BusinessesPage() {
  const current = (await getMembership())!;
  const all = await getAllMemberships();

  const groups = new Map<string, typeof all>();
  for (const e of all) {
    const key = e.business.organization_id ?? e.business.id;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>My businesses</h2>
          <p>Each branch keeps its own products, stock, sales and team. Pick one to work in.</p>
        </div>
        {!current.isGuest && (
          <Link className="btn btn-primary" href="/onboarding?new=1">
            + New business
          </Link>
        )}
      </div>

      {[...groups.entries()].map(([key, branches]) => (
        <div className="card" key={key} style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 10 }}>{branches[0].organizationName}</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {branches.map(({ business, role }) => {
              const active = business.id === current.business.id;
              return (
                <div key={business.id} className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <strong>{business.branch_name ?? business.name}</strong>
                    {active && <span className="badge" style={{ marginLeft: 8 }}>Current</span>}
                    <div className="muted" style={{ fontSize: 13 }}>
                      {ROLE_LABEL[role]}
                      {business.location ? ` · ${business.location}` : ""}
                    </div>
                  </div>
                  {!active && (
                    <form action={selectBusiness}>
                      <input type="hidden" name="business_id" value={business.id} />
                      <button className="btn" type="submit">Switch</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          {!current.isGuest &&
            branches.some((b) => b.role === "owner") &&
            (() => {
              const src = branches.find((b) => b.role === "owner")!;
              return <AddBranchForm sourceBusiness={src.business.id} />;
            })()}
        </div>
      ))}
      {current.isGuest && (
        <p className="muted">Guest demos have one sample business. Sign up to manage several businesses and branches.</p>
      )}
    </>
  );
}
