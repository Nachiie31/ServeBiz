import { redirect } from "next/navigation";
import { autoJoin, getMembership } from "@/lib/business";
import { homeFor } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: isNew } = await searchParams;
  const membership = await getMembership();

  if (membership) {
    // Registered users can start another business; guests only get their demo store.
    if (isNew && !membership.isGuest) return <OnboardingForm another />;
    redirect(homeFor(membership.role));
  }

  // Invited staff join their business here, and guests get a demo store. Everyone else sets up
  // their own business with the form.
  if (await autoJoin()) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return <OnboardingForm />;
}
