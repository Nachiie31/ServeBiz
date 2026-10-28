import { acceptInvite, declineInvite } from "@/app/(app)/invitations/actions";
import LocalTime from "@/components/LocalTime";
import { ROLE_LABEL } from "@/lib/permissions";
import type { MyInvite } from "@/lib/invites";

/** Cards for pending invitations, each with Accept and Decline. Used by the Invitations page and the first-login screen. */
export default function InviteList({ invites, returnTo = "/invitations" }: { invites: MyInvite[]; returnTo?: "/invitations" | "/onboarding" }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {invites.map((i) => (
        <div className="card" key={i.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <strong>{i.org_name}</strong>
              <span className="muted"> · {i.branch_name} branch</span>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Join as <strong>{ROLE_LABEL[i.role]}</strong>
                {i.location ? ` · ${i.location}` : ""}
                {i.invited_by_email ? ` · invited by ${i.invited_by_email}` : ""}
                {" · "}<LocalTime iso={i.created_at} />
              </div>
              {i.blocked && (
                <div className="alert warn" style={{ marginTop: 8, marginBottom: 0 }}>
                  You already work for a different business, so you cannot join this one. You can decline it.
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {!i.blocked && (
                <form action={acceptInvite}>
                  <input type="hidden" name="invite_id" value={i.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className="btn btn-primary" type="submit">Accept</button>
                </form>
              )}
              <form action={declineInvite}>
                <input type="hidden" name="invite_id" value={i.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                <button className="btn" type="submit">Decline</button>
              </form>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
