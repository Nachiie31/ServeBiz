import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cartFromMetadata, getStripe } from "@/lib/stripe";
import { getConnectedAccount } from "@/lib/payment-route";
import { decideReturn } from "@/lib/stripe-connect";

// Stripe sends the customer back here after paying. We confirm the payment with Stripe
// ourselves (never trusting the URL), then record the sale exactly once.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const fail = (message: string) =>
    NextResponse.redirect(`${origin}/pos?stripe_error=${encodeURIComponent(message)}`);

  const sessionId = searchParams.get("session_id");
  const stripe = getStripe();
  if (!sessionId || !stripe) return fail("Could not confirm the card payment.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // A payment made on a branch's own Stripe account is read from that account. The id in the URL can be
  // edited by anyone, so it is only trusted after it is matched to the account registered for the business.
  const acct = searchParams.get("acct");
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["payment_intent.payment_method"] },
      acct && /^acct_[A-Za-z0-9]{6,64}$/.test(acct) ? { stripeAccount: acct } : undefined
    );
  } catch {
    return fail("Could not confirm the card payment with Stripe.");
  }

  if (session.payment_status !== "paid") return fail("The card payment was not completed. No sale was recorded.");
  const claimedBusiness = session.metadata?.business_id;
  const registered = claimedBusiness && acct ? await getConnectedAccount(supabase, claimedBusiness) : null;
  const verdict = decideReturn({
    requestedAccount: acct,
    metadata: session.metadata,
    userId: user.id,
    registeredAccount: registered?.stripe_account_id ?? null,
  });
  if (!verdict.ok) return fail(verdict.message);

  const intent = typeof session.payment_intent === "string" ? null : session.payment_intent;
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  // Which method the customer actually used (card, gcash, ...), kept on the payment record.
  const pm = intent && typeof intent.payment_method !== "string" ? intent.payment_method : null;
  const LABELS: Record<string, string> = { card: "Card", gcash: "GCash", grabpay: "GrabPay", paymaya: "Maya" };
  const methodLabel = pm?.type ? LABELS[pm.type] ?? pm.type : "Online";
  const businessId = verdict.businessId;
  if (!paymentIntent) return fail("The payment is missing details. No sale was recorded.");

  const lookup = async () => {
    const { data } = await supabase
      .from("payments")
      .select("sale_id")
      .eq("stripe_payment_intent", paymentIntent)
      .maybeSingle();
    return (data as { sale_id: string } | null)?.sale_id ?? null;
  };

  // Already recorded (page refreshed or opened twice)? Just show the receipt.
  const existing = await lookup();
  if (existing) return NextResponse.redirect(`${origin}/sales/${existing}?paid=1`);

  const items = cartFromMetadata(session.metadata);
  if (items.length === 0) return fail(`Payment received but the cart could not be read. Reference: ${paymentIntent}`);

  const { data: saleId, error } = await supabase.rpc("complete_sale", {
    p_business_id: businessId,
    p_items: items,
    p_discount_type: session.metadata?.discount_type === "percent" ? "percent" : "amount",
    p_discount_value: Number(session.metadata?.discount_value ?? 0),
    p_method: "stripe",
    p_tendered: null,
    p_reference: `${methodLabel} · ${paymentIntent}${acct ? ` (${acct})` : ""}`,
    p_stripe_pi: paymentIntent,
  });

  if (error || !saleId) {
    // A parallel request may have recorded it first (unique index on the payment reference).
    const again = await lookup();
    if (again) return NextResponse.redirect(`${origin}/sales/${again}?paid=1`);
    return fail(
      `Payment received but the sale could not be recorded (${error?.message ?? "unknown error"}). ` +
        `Refund it in the Stripe dashboard or record the sale manually. Reference: ${paymentIntent}`
    );
  }

  return NextResponse.redirect(`${origin}/sales/${saleId}?paid=1`);
}
