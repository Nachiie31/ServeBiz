import { cache } from "react";
import { cookies } from "next/headers";
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
  /** the business this branch belongs to (migration 008) */
  organization_id?: string;
  branch_name?: string;
};

export const BUSINESS_COOKIE = "servebiz_business";

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

const BUSINESS_COLS = "id,name,business_type,logo_url,location,contact_phone,contact_email,currency,organization_id,branch_name";
const BUSINESS_COLS_OLD = "id,name,business_type,logo_url,location,contact_phone,contact_email,currency";

export type BranchEntry = { business: Business; role: Role; organizationName: string };

/** Every branch the user belongs to (all their businesses), oldest first. */
export async function getAllMemberships(): Promise<BranchEntry[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows } = await supabase
    .from("business_members")
    .select("business_id,role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(500);
  const members = (rows ?? []) as { business_id: string; role: string }[];
  if (members.length === 0) return [];
  const ids = members.map((m) => m.business_id);

  let rowsB: unknown[] | null = null;
  const res = await supabase.from("businesses").select(BUSINESS_COLS).in("id", ids);
  if (!res.error) rowsB = res.data;
  else rowsB = (await supabase.from("businesses").select(BUSINESS_COLS_OLD).in("id", ids)).data; // before migration 008
  const businesses = (rowsB ?? []) as Business[];

  const orgIds = [...new Set(businesses.map((b) => b.organization_id).filter(Boolean))] as string[];
  const orgNames = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs } = await supabase.from("organizations").select("id,name").in("id", orgIds);
    for (const o of (orgs ?? []) as { id: string; name: string }[]) orgNames.set(o.id, o.name);
  }

  const byId = new Map(businesses.map((b) => [b.id, b]));
  const out: BranchEntry[] = [];
  for (const m of members) {
    const business = byId.get(m.business_id);
    if (!business) continue;
    out.push({
      business,
      role: isRole(m.role) ? m.role : "cashier", // an unknown role gets the least access
      organizationName: (business.organization_id && orgNames.get(business.organization_id)) || business.name,
    });
  }
  return out;
}

/**
 * Looks up the logged-in user's current business and role. The user can belong to several
 * businesses and branches; the one they picked is remembered in a cookie. Not cached: use
 * getMembership() in pages.
 */
export async function loadMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const all = await getAllMemberships();
  if (all.length === 0) return null;

  let wanted: string | undefined;
  try {
    wanted = (await cookies()).get(BUSINESS_COOKIE)?.value;
  } catch {
    wanted = undefined;
  }
  // A stale or tampered cookie simply falls back to the first branch. RLS decides real access.
  const chosen = all.find((e) => e.business.id === wanted) ?? all[0];

  return {
    business: chosen.business,
    role: chosen.role,
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
