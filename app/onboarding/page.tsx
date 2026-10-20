import { redirect } from "next/navigation";
import { autoJoin, getMembership } from "@/lib/business";
import { homeFor } from "@/lib/permissions";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const membership = await getMembership();
  if (membership) redirect(homeFor(membership.role));

  // Invited staff join their business here, and guests get a demo store. Everyone else sets up
  // their own business with the form.
  if (await autoJoin()) redirect("/dashboard");

  return <OnboardingForm />;
}
