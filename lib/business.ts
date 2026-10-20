import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/permissions";

export type Business = {
  id: string;
  name: string;
  business_type: string;
  logo_url: string | null;
  location: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  currency: string;
};

export type TaxSettings = {
  rate: number;
  name: string;
  inclusive: boolean;
  /** false until migration 005 has been run (the tax name/inclusive columns do not exist yet) */
  migrated: boolean;
};

export async function getTaxSettings(businessId: string): Promise<TaxSettings> {
  const supabase = await createClient();
  const full = await supabase
    .from("businesses")
    .select("tax_rate,tax_name,tax_inclusive")
    .eq("id", businessId)
    .single();
  if (!full.error && full.data) {
    const d = full.data as { tax_rate: number; tax_name: string; tax_inclusive: boolean };
    return { rate: Number(d.tax_rate ?? 0), name: d.tax_name || "Tax", inclusive: !!d.tax_inclusive, migrated: true };
  }
  const basic = await supabase.from("businesses").select("tax_rate").eq("id", businessId).single();
  return {
    rate: Number((basic.data as { tax_rate: number } | null)?.tax_rate ?? 0),
    name: "Tax",
    inclusive: false,
    migrated: false,
  };
}

export type Membership = {
  business: Business;
  role: Role;
  userId: string;
  /** true for guest (anonymous) logins, which get a private demo store */
  isGuest: boolean;
};

/** Looks up the logged-in user's business and role. Not cached: use getMembership() in pages. */
export async function loadMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("business_members")
    .select("business_id,role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const row = memberships?.[0] as { business_id: string; role: string } | undefined;
  if (!row) return null;

  const { data } = await supabase
    .from("businesses")
    .select("id,name,business_type,logo_url,location,contact_phone,contact_email,currency")
    .eq("id", row.business_id)
    .single();
  if (!data) return null;

  return {
    business: data as Business,
    role: isRole(row.role) ? row.role : "cashier", // an unknown role gets the least access
    userId: user.id,
    isGuest: !!user.is_anonymous,
  };
}

/** Same as loadMembership, but only runs once per request however many components ask. */
export const getMembership = cache(loadMembership);

/** Returns the user's business, or null when none is set up yet. */
export async function getCurrentBusiness(): Promise<Business | null> {
  return (await getMembership())?.business ?? null;
}

/**
 * For a login with no business yet: first join any business that invited this email, and give
 * guests their own demo store. Returns true when the user now belongs to a business.
 * Both steps quietly do nothing if the matching migration (006 / 007) has not been run yet.
 */
export async function autoJoin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  if (!user.is_anonymous) {
    await supabase.rpc("claim_invites");
  } else {
    await supabase.rpc("create_demo_business");
  }
  return (await loadMembership()) !== null;
}
