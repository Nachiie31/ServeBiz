import { redirect } from "next/navigation";
import { getCurrentBusiness } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import NavLinks from "@/components/NavLinks";
import "../app.css";

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

  const business = await getCurrentBusiness();
  if (!business) redirect("/onboarding");

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
            <div className="muted" style={{ fontSize: 13 }}>{business.business_type}</div>
          </div>
        </div>

        <NavLinks />

        <form action={signOut} className="sidebar-foot">
          <button className="btn btn-block" type="submit">
            {user.is_anonymous ? "Exit guest" : "Log out"}
          </button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
