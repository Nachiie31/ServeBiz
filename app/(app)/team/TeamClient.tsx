"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import LocalTime from "@/components/LocalTime";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export type MemberRow = { user_id: string; role: Role; email: string | null; created_at: string };
export type InviteRow = { id: string; email: string; role: "manager" | "cashier"; created_at: string };

type Props = {
  businessId: string;
  currentUserId: string;
  members: MemberRow[];
  invites: InviteRow[];
  disabled: boolean;
};

export default function TeamClient({ businessId, currentUserId, members, invites, disabled }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "cashier">("cashier");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function friendly(message: string): string {
    return /invite_member|set_member_role|remove_member|business_invites/.test(message) && /not exist|schema cache|Could not find/i.test(message)
      ? "Staff roles need a database update. Run supabase/migrations/006_roles.sql in Supabase first."
      : message;
  }

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, done?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: err } = await action();
    setBusy(false);
    if (err) {
      setError(friendly(err.message));
      return false;
    }
    if (done) setNotice(done);
    router.refresh();
    return true;
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim();
    const saved = await run(
      () => supabase.rpc("invite_member", { p_business_id: businessId, p_email: target, p_role: role }),
      `Invite saved for ${target.toLowerCase()}. Ask them to sign up or log in with that email and they will join automatically.`
    );
    if (saved) setEmail("");
  }

  return (
    <>
      {error && <div className="alert err" role="alert">{error}</div>}
      {notice && <div className="alert">{notice}</div>}

      <div className="card" style={{ maxWidth: 640, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12 }}>Invite someone</h3>
        <form onSubmit={invite}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="invite-email">Their email</label>
              <input id="invite-email" className="input" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" disabled={disabled} />
            </div>
            <div className="field">
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" className="input" value={role} onChange={(e) => setRole(e.target.value as "manager" | "cashier")} disabled={disabled}>
                <option value="cashier">Cashier: POS and own sales</option>
                <option value="manager">Manager: inventory, prices, reports</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || disabled || !email.trim()}>
            {busy ? "Saving..." : "Send invite"}
          </button>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            They need to confirm their email when they sign up. Nothing is emailed from here, so tell them yourself.
          </p>
        </form>
      </div>

      <section className="section">
        <h3>People</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Email</th><th>Role</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {members.map((m) => {
                const isYou = m.user_id === currentUserId;
                return (
                  <tr key={m.user_id}>
                    <td>
                      {m.email ?? "Guest account"}{isYou && <span className="chip gray" style={{ marginLeft: 8 }}>You</span>}
                    </td>
                    <td>
                      {m.role === "owner" ? (
                        <span className="chip">{ROLE_LABEL.owner}</span>
                      ) : (
                        <select className="role-select" value={m.role} disabled={busy} aria-label={`Role for ${m.email ?? "this person"}`}
                          onChange={(e) => run(() => supabase.rpc("set_member_role", { p_business_id: businessId, p_user_id: m.user_id, p_role: e.target.value }), "Role updated.")}>
                          <option value="manager">{ROLE_LABEL.manager}</option>
                          <option value="cashier">{ROLE_LABEL.cashier}</option>
                        </select>
                      )}
                    </td>
                    <td><LocalTime iso={m.created_at} /></td>
                    <td className="num">
                      {m.role !== "owner" && (
                        <button className="btn btn-sm" type="button" disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Remove ${m.email ?? "this person"} from the team? They will lose access immediately.`)) {
                              void run(() => supabase.rpc("remove_member", { p_business_id: businessId, p_user_id: m.user_id }), "Removed from the team.");
                            }
                          }}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h3>Pending invites</h3>
        <div className="table-wrap">
          {invites.length === 0 ? (
            <div className="empty">No pending invites.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Email</th><th>Role</th><th>Invited</th><th /></tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td><span className="chip gray">{ROLE_LABEL[i.role]}</span></td>
                    <td><LocalTime iso={i.created_at} /></td>
                    <td className="num">
                      <button className="btn btn-sm" type="button" disabled={busy}
                        onClick={() => run(() => supabase.from("business_invites").delete().eq("id", i.id), "Invite cancelled.")}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
