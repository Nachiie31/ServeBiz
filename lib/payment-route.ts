import type { SupabaseClient } from "@supabase/supabase-js";
import { isStripeEnabled } from "@/lib/stripe";
import { resolveRoute, type PaymentRoute } from "@/lib/stripe-connect";

export type ConnectedRow = { stripe_account_id: string; charges_enabled: boolean; details_submitted: boolean };

/** The branch's connected Stripe account, or null (also null before migration 013 is installed). */
export async function getConnectedAccount(supabase: SupabaseClient, businessId: string): Promise<ConnectedRow | null> {
  const { data, error } = await supabase
    .from("payment_accounts")
    .select("stripe_account_id,charges_enabled,details_submitted")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return null;
  return (data as ConnectedRow | null) ?? null;
}

export async function getPaymentRoute(supabase: SupabaseClient, businessId: string, isGuest: boolean): Promise<PaymentRoute> {
  const row = await getConnectedAccount(supabase, businessId);
  return resolveRoute({
    connected: row ? { accountId: row.stripe_account_id, chargesEnabled: row.charges_enabled } : null,
    platformKeyOk: isStripeEnabled(),
    requireConnect: process.env.STRIPE_REQUIRE_CONNECT === "1",
    isGuest,
  });
}
