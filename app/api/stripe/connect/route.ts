import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getConnectedAccount } from "@/lib/payment-route";
import { defaultCountryFor, isAllowedCountry, startOnboarding } from "@/lib/stripe-connect";

// Owner clicks "Connect Stripe account": create (or reuse) this branch's Stripe account and send them to Stripe's setup.
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Online payments are not set up on this server (no Stripe test key)." }, { status: 503 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  if (user.is_anonymous) return NextResponse.json({ error: "Guest demos use the shared test account. Sign up to connect your own." }, { status: 403 });

  let body: { businessId?: string; country?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const businessId = body.businessId ?? "";

  const { data: member } = await supabase
    .from("business_members").select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
  if ((member as { role: string } | null)?.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can set up online payments." }, { status: 403 });
  }
  const { data: business } = await supabase.from("businesses").select("name,currency,contact_email").eq("id", businessId).single();
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  const b = business as { name: string; currency: string; contact_email: string | null };

  const existing = await getConnectedAccount(supabase, businessId);
  const country = body.country && isAllowedCountry(body.country) ? body.country : defaultCountryFor(b.currency);
  const origin = new URL(request.url).origin;
  const back = `${origin}/api/stripe/connect/return?business=${encodeURIComponent(businessId)}`;

  try {
    const { accountId, url, created } = await startOnboarding(stripe, {
      existingAccountId: existing?.stripe_account_id ?? null,
      country,
      businessName: b.name,
      email: b.contact_email ?? user.email ?? null,
      currency: b.currency,
      returnUrl: back,
      refreshUrl: `${back}&refresh=1`,
    });
    if (created) {
      const { error } = await supabase.rpc("save_stripe_account", { p_business_id: businessId, p_account_id: accountId, p_charges_enabled: false, p_details_submitted: false });
      if (error) {
        return NextResponse.json({
          error: error.message.includes("save_stripe_account")
            ? "Per-branch payments need a database update. Run supabase/migrations/013_payment_accounts.sql in Supabase."
            : error.message,
        }, { status: 400 });
      }
    }
    return NextResponse.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stripe could not start the setup.";
    return NextResponse.json({
      error: /connect/i.test(message) ? `${message} (Turn on Connect in your Stripe dashboard: Connect > Get started, in test mode.)` : message,
    }, { status: 502 });
  }
}
