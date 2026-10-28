import type Stripe from "stripe";

/** Countries offered when a business connects its own Stripe account (Stripe rejects any it does not support). */
export const CONNECT_COUNTRIES: { code: string; name: string }[] = [
  { code: "PH", name: "Philippines" }, { code: "SG", name: "Singapore" }, { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" }, { code: "AU", name: "Australia" }, { code: "CA", name: "Canada" },
  { code: "MY", name: "Malaysia" }, { code: "TH", name: "Thailand" }, { code: "ID", name: "Indonesia" },
  { code: "HK", name: "Hong Kong" }, { code: "JP", name: "Japan" }, { code: "NZ", name: "New Zealand" },
  { code: "IN", name: "India" }, { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
];

const DEFAULT_COUNTRY: Record<string, string> = {
  PHP: "PH", SGD: "SG", USD: "US", GBP: "GB", AUD: "AU", CAD: "CA", MYR: "MY", THB: "TH", IDR: "ID", HKD: "HK", JPY: "JP", INR: "IN", EUR: "DE",
};

export const defaultCountryFor = (currency: string) => DEFAULT_COUNTRY[currency.toUpperCase()] ?? "US";
export const isAllowedCountry = (code: string) => CONNECT_COUNTRIES.some((c) => c.code === code);
export const ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,64}$/;

export type PaymentRoute =
  | { mode: "connected"; accountId: string }
  | { mode: "platform" }
  | { mode: "none"; reason: string };

/**
 * Where does an online payment for this branch go?
 * - the branch's own connected Stripe account, once it can take charges
 * - otherwise the shared ServeBiz test account (the demo behaviour), unless the server requires connecting
 */
export function resolveRoute(input: {
  connected: { accountId: string; chargesEnabled: boolean } | null;
  platformKeyOk: boolean;
  requireConnect: boolean;
  isGuest: boolean;
}): PaymentRoute {
  const { connected, platformKeyOk, requireConnect, isGuest } = input;
  if (!platformKeyOk) return { mode: "none", reason: "Online payments are not set up on this server (no Stripe test key)." };
  if (connected) {
    return connected.chargesEnabled
      ? { mode: "connected", accountId: connected.accountId }
      : { mode: "none", reason: "This branch's Stripe account setup is not finished. The owner can finish it in Settings > Online payments." };
  }
  if (requireConnect && !isGuest) {
    return { mode: "none", reason: "This branch has not connected a Stripe account yet. The owner can do it in Settings > Online payments." };
  }
  return { mode: "platform" };
}

/**
 * After Stripe sends the customer back: may this payment be recorded as a sale?
 * `requestedAccount` is the account id from the URL, which anyone can edit, so it only counts when it equals
 * the account registered for the business named in the payment itself.
 */
export function decideReturn(input: {
  requestedAccount: string | null;
  metadata: Record<string, string> | null | undefined;
  userId: string;
  registeredAccount: string | null;
}): { ok: true; businessId: string } | { ok: false; message: string } {
  const { requestedAccount, metadata, userId, registeredAccount } = input;
  if (requestedAccount !== null && !ACCOUNT_ID.test(requestedAccount)) return { ok: false, message: "The payment link is not valid." };
  if (!metadata || metadata.user_id !== userId) return { ok: false, message: "This payment belongs to a different login." };
  const businessId = metadata.business_id;
  if (!businessId) return { ok: false, message: "The payment is missing details. No sale was recorded." };

  const stamped = metadata.stripe_account ? metadata.stripe_account : null;
  if (requestedAccount === null) {
    if (stamped) return { ok: false, message: "This payment was made on a connected account but the link is missing it. No sale was recorded." };
    return { ok: true, businessId };
  }
  if (stamped !== requestedAccount) return { ok: false, message: "The payment account does not match. No sale was recorded." };
  if (registeredAccount !== requestedAccount) {
    return { ok: false, message: "That Stripe account is not connected to this branch. No sale was recorded." };
  }
  return { ok: true, businessId };
}

/**
 * Creates (or reuses) the branch's connected account and returns Stripe's hosted onboarding link.
 * Uses Accounts v2 (no legacy `type`) with Stripe as fees + losses collector, which is what
 * platforms on Stripe's managed-risk program require. Each business gets its own full Stripe dashboard.
 */
export async function startOnboarding(
  stripe: Stripe,
  opts: { existingAccountId: string | null; country: string; businessName: string; email?: string | null; returnUrl: string; refreshUrl: string; currency?: string | null },
): Promise<{ accountId: string; url: string; created: boolean }> {
  let accountId = opts.existingAccountId;
  let created = false;
  if (!accountId) {
    const account = await stripe.v2.core.accounts.create({
      contact_email: opts.email || undefined,
      display_name: opts.businessName.slice(0, 100),
      dashboard: "full",
      identity: { country: opts.country.toLowerCase(), business_details: { registered_name: opts.businessName.slice(0, 100) } },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: {
        ...(opts.currency ? { currency: opts.currency.toLowerCase() } : {}),
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      },
      metadata: { created_by: "servebiz" },
    });
    accountId = account.id;
    created = true;
  }
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { refresh_url: opts.refreshUrl, return_url: opts.returnUrl },
    },
  });
  return { accountId, url: link.url, created };
}

export async function readAccountStatus(stripe: Stripe, accountId: string): Promise<{ chargesEnabled: boolean; detailsSubmitted: boolean }> {
  const a = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "requirements"] });
  const chargesEnabled = a.configuration?.merchant?.capabilities?.card_payments?.status === "active";
  const waitingOnUser = (a.requirements?.entries ?? []).some((e) => e.awaiting_action_from === "user");
  return { chargesEnabled, detailsSubmitted: chargesEnabled || !waitingOnUser };
}
