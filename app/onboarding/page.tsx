import { redirect } from "next/navigation";
import { autoJoin, getMembership } from "@/lib/business";
import { homeFor } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import OnboardingForm from "./OnboardingForm";
import InviteList from "@/components/InviteList";
import { getMyInvites } from "@/lib/invites";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string; own?: string; error?: string; declined?: string }> }) {
  const sp = await searchParams;
  const { new: isNew, own } = sp;
  const membership = await getMembership();

  if (membership) {
    // Signed-in users (guests too, so the demo shows multiple businesses) can start another business.
    if (isNew) return <OnboardingForm another />;
    redirect(homeFor(membership.role));
  }

  // Invited staff join their business here, and guests get a demo store. Everyone else sets up
  // their own business with the form.
  if (await autoJoin()) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  // Invited people choose here: accept (join that business) or decline and set up their own.
  const invites = own ? [] : await getMyInvites();
  if (invites.length > 0) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card" style={{ maxWidth: 620 }}>
          <h2 style={{ marginTop: 0 }}>You have been invited</h2>
          <p className="muted">Accept to join, or decline. You can also set up your own business instead.</p>
          {sp.error && <div className="alert err" role="alert">{sp.error}</div>}
          {sp.declined && <div className="alert">Invitation declined.</div>}
          <InviteList invites={invites} returnTo="/onboarding" />
          <p style={{ marginBottom: 0, marginTop: 16 }}>
            <a href="/onboarding?own=1">Set up my own business instead</a>
          </p>
        </div>
      </div>
    );
  }
  return (
    <>
      {sp.declined && <div className="alert" style={{ maxWidth: 520, margin: "16px auto 0" }}>Invitation declined. You can set up your own business below.</div>}
      <OnboardingForm />
    </>
  );
}
