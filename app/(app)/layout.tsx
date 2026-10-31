import { redirect } from "next/navigation";
import { autoJoin, getAllMemberships, getMembership } from "@/lib/business";
import { ROLE_LABEL } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import NavLinks from "@/components/NavLinks";
import BusinessSwitcher, { type SwitcherGroup } from "@/components/BusinessSwitcher";
import { getMyInvites } from "@/lib/invites";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import ResetDemoButton from "@/components/ResetDemoButton";
import type { Metadata } from "next";
import "../app.css";
import "../pos.css";

// Everything behind login is private: keep it out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getMembership();
  if (!membership) {
    // No business yet. Staff who were invited join theirs, and guests get a demo store.
    // Anyone else sets up their own business.
    if (await autoJoin()) redirect("/dashboard");
    redirect("/onboarding");
  }
  const { business, role, isGuest } = membership;

  const all = await getAllMemberships();
  const inviteCount = isGuest ? 0 : (await getMyInvites()).length;
  const groupMap = new Map<string, SwitcherGroup>();
  for (const e of all) {
    const key = e.business.organization_id ?? e.business.id;
    const g = groupMap.get(key) ?? { name: e.organizationName, branches: [] };
    g.branches.push({ id: e.business.id, label: e.business.branch_name ?? e.business.name });
    groupMap.set(key, g);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="biz">
          {business.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="biz-logo" src={business.logo_url} alt={`${business.name} logo`} />
          ) : (
            <div className="biz-logo">{business.name.charAt(0).toUpperCase()}</div>
          )}
          <div>
            <strong>{business.name}</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {isGuest ? "Guest demo" : ROLE_LABEL[role]}
            </div>
          </div>
        </div>

        <BusinessSwitcher groups={[...groupMap.values()]} currentId={business.id} />
        <NavLinks role={role} inviteCount={inviteCount} multiBranch={all.filter((e) => e.role === "owner" && e.business.organization_id === business.organization_id).length > 1} />

        <form action={signOut} className="sidebar-foot">
          <LogoutButton label={user.is_anonymous ? "Exit guest" : "Log out"} userId={user.id} />
        </form>
      </aside>
      <main className="main">
        {isGuest && (
          <div className="alert demo-banner">
            <span>
              You are exploring a demo store with sample data. It is private to you and is cleared after 24 hours.
            </span>
            <ResetDemoButton />
          </div>
        )}
        {inviteCount > 0 && (
          <div className="alert demo-banner">
            <span>You have {inviteCount} pending {inviteCount === 1 ? "invitation" : "invitations"} to join a business.</span>
            <Link className="btn btn-sm" href="/invitations">Review</Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
