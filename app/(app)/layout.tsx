import { redirect } from "next/navigation";
import { autoJoin, getMembership } from "@/lib/business";
import { ROLE_LABEL } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import NavLinks from "@/components/NavLinks";
import ResetDemoButton from "@/components/ResetDemoButton";
import "../app.css";
import "../pos.css";

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

        <NavLinks role={role} />

        <form action={signOut} className="sidebar-foot">
          <button className="btn btn-block" type="submit">
            {user.is_anonymous ? "Exit guest" : "Log out"}
          </button>
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
        {children}
      </main>
    </div>
  );
}
