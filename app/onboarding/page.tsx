import { redirect } from "next/navigation";
import { getCurrentBusiness } from "@/lib/business";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const business = await getCurrentBusiness();
  if (business) redirect("/dashboard");
  return <OnboardingForm />;
}
