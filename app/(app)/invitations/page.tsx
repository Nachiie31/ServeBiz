import { getMyInvites } from "@/lib/invites";
import InviteList from "@/components/InviteList";

export default async function InvitationsPage({ searchParams }: { searchParams: Promise<{ error?: string; declined?: string }> }) {
  const sp = await searchParams;
  const invites = await getMyInvites();
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Invitations</h2>
          <p>Businesses and branches that invited you. Nothing changes until you accept.</p>
        </div>
      </div>
      {sp.error && <div className="alert err" role="alert">{sp.error}</div>}
      {sp.declined && <div className="alert">Invitation declined.</div>}
      {invites.length === 0 ? (
        <div className="empty">No pending invitations.</div>
      ) : (
        <InviteList invites={invites} />
      )}
    </>
  );
}
