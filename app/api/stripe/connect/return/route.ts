import { NextResponse } from "next/server";
import { BUSINESS_COOKIE } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getConnectedAccount } from "@/lib/payment-route";
import { readAccountStatus, startOnboarding } from "@/lib/stripe-connect";

// Stripe sends the owner back here after setup (or when the setup link expired). We ask Stripe for the
// account's real status instead of trusting the URL, store it, and go back to Settings.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const businessId = searchParams.get("business") ?? "";
  const refresh = searchParams.get("refresh") === "1";
  const done = (state: string, message?: string) => {
    const res = NextResponse.redirect(`${origin}/settings?payments=${state}${message ? `&msg=${encodeURIComponent(message.slice(0, 300))}` : ""}#payments`);
    // Land on the branch that was being set up, even if the owner had another one selected.
    res.cookies.set(BUSINESS_COOKIE, businessId, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
    return res;
  };

  const stripe = getStripe();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (!stripe) return NextResponse.redirect(`${origin}/settings?payments=error&msg=${encodeURIComponent("No Stripe test key on this server.")}#payments`);

  const { data: member } = await supabase
    .from("business_members").select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
  if ((member as { role: string } | null)?.role !== "owner") return NextResponse.redirect(`${origin}/settings`);

  const row = await getConnectedAccount(supabase, businessId);
  if (!row) return done("error", "No Stripe account is connected to this branch yet.");

  try {
    if (refresh) {
      // The setup link expired: make a fresh one and continue where the owner left off.
      const back = `${origin}/api/stripe/connect/return?business=${encodeURIComponent(businessId)}`;
      const { url } = await startOnboarding(stripe, {
        existingAccountId: row.stripe_account_id, country: "US", businessName: "", returnUrl: back, refreshUrl: `${back}&refresh=1`,
      });
      return NextResponse.redirect(url);
    }
    const status = await readAccountStatus(stripe, row.stripe_account_id);
    const { error } = await supabase.rpc("save_stripe_account", {
      p_business_id: businessId, p_account_id: row.stripe_account_id,
      p_charges_enabled: status.chargesEnabled, p_details_submitted: status.detailsSubmitted,
    });
    if (error) return done("error", error.message);
    return done(status.chargesEnabled ? "ok" : "pending");
  } catch (e) {
    return done("error", e instanceof Error ? e.message : "Could not read the account from Stripe.");
  }
}
