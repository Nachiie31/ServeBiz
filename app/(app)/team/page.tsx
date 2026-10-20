import { getMembership } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";
import TeamClient, { type InviteRow, type MemberRow } from "./TeamClient";

const PERMISSIONS: { what: string; owner: boolean; manager: boolean; cashier: boolean }[] = [
  { what: "Ring up sales at the POS", owner: true, manager: true, cashier: true },
  { what: "See their own sales and reprint receipts", owner: true, manager: true, cashier: true },
  { what: "See everyone's sales", owner: true, manager: true, cashier: false },
  { what: "Void a sale", owner: true, manager: true, cashier: false },
  { what: "Receive stock, edit products and prices, suppliers", owner: true, manager: true, cashier: false },
  { what: "See costs, reports and profit", owner: true, manager: true, cashier: false },
  { what: "Business details, tax and currency", owner: true, manager: false, cashier: false },
  { what: "Invite and remove staff", owner: true, manager: false, cashier: false },
];

export default async function TeamPage() {
  const { business, userId } = (await getMembership())!;
  const supabase = await createClient();

  const [membersRes, invitesRes] = await Promise.all([
    supabase
      .from("business_members")
      .select("user_id,role,email,created_at")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("business_invites")
      .select("id,email,role,created_at")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false }),
  ]);

  const needsMigration = !!membersRes.error || !!invitesRes.error;
  const members = ((membersRes.data ?? []) as { user_id: string; role: Role; email: string | null; created_at: string }[]) satisfies MemberRow[];
  const invites = (invitesRes.data ?? []) as InviteRow[];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Team</h2>
          <p>Invite staff and choose what each person can do.</p>
        </div>
      </div>

      {needsMigration && (
        <div className="alert warn">
          Staff roles need a database update. Run <code>supabase/migrations/006_roles.sql</code> in the Supabase SQL Editor, then refresh.
        </div>
      )}

      <TeamClient businessId={business.id} currentUserId={userId} members={members} invites={invites} disabled={needsMigration} />

      <section className="section" style={{ marginTop: 28 }}>
        <h3>What each role can do</h3>
        <div className="table-wrap">
          <table className="table perm-table">
            <thead>
              <tr><th>Permission</th><th>Owner</th><th>Manager</th><th>Cashier</th></tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.what}>
                  <td>{p.what}</td>
                  {[p.owner, p.manager, p.cashier].map((allowed, i) => (
                    <td key={i} className={allowed ? "yes" : "no"} aria-label={allowed ? "Allowed" : "Not allowed"}>
                      {allowed ? "Yes" : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          These limits are enforced by the database, not just hidden in the menu.
        </p>
      </section>
    </>
  );
}
