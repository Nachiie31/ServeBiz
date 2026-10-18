import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cartToMetadata, getStripe, toMinorUnits } from "@/lib/stripe";

type Body = {
  businessId?: string;
  items?: { product_id: string; quantity: number }[];
  discountType?: "amount" | "percent";
  discountValue?: number;
};

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not set up. Add STRIPE_SECRET_KEY to .env.local and restart." }, { status: 503 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "ServeBiz only accepts Stripe test keys (they start with sk_test_)." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please log in again." }, { status: 401 });

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { businessId, items, discountType = "amount", discountValue = 0 } = body;
  if (!businessId || !Array.isArray(items) || items.length === 0 || items.length > 200) {
    return NextResponse.json({ error: "The cart is empty or too large." }, { status: 400 });
  }

  // Price the cart on the server. Nothing the browser sends is trusted for amounts.
  const { data: quote, error: quoteErr } = await supabase.rpc("quote_sale", {
    p_business_id: businessId,
    p_items: items,
    p_discount_type: discountType,
    p_discount_value: discountValue,
  });
  if (quoteErr) {
    return NextResponse.json(
      {
        error: quoteErr.message.includes("quote_sale")
          ? "The Stripe functions are missing. Run supabase/migrations/004_stripe.sql in Supabase first."
          : quoteErr.message,
      },
      { status: 400 }
    );
  }
  const q = (quote as { total: number }[] | null)?.[0];
  if (!q || !(q.total > 0)) {
    return NextResponse.json({ error: "The total must be greater than 0 to pay by card." }, { status: 400 });
  }

  const { data: business } = await supabase.from("businesses").select("name,currency").eq("id", businessId).single();
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const origin = new URL(request.url).origin;
  const count = items.reduce((n, i) => n + i.quantity, 0);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: business.currency.toLowerCase(),
            unit_amount: toMinorUnits(q.total, business.currency),
            product_data: {
              name: `Order at ${business.name}`,
              description: `${count} item${count === 1 ? "" : "s"}`,
            },
          },
        },
      ],
      success_url: `${origin}/pos/stripe-return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pos?canceled=1`,
      metadata: {
        user_id: user.id,
        business_id: businessId,
        discount_type: discountType,
        discount_value: String(discountValue),
        ...cartToMetadata(items),
      },
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stripe could not start the payment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
