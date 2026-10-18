import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cartFromMetadata, getStripe } from "@/lib/stripe";

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

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return fail("Could not confirm the card payment with Stripe.");
  }

  if (session.payment_status !== "paid") return fail("The card payment was not completed. No sale was recorded.");
  if (session.metadata?.user_id !== user.id) return fail("This payment belongs to a different login.");

  const paymentIntent =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const businessId = session.metadata?.business_id;
  if (!paymentIntent || !businessId) return fail("The payment is missing details. No sale was recorded.");

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
    p_reference: paymentIntent,
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
