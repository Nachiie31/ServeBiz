import { createClient } from "@/lib/supabase/server";

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

/** Returns the user's first business, or null when none is set up yet. */
export async function getCurrentBusiness(): Promise<Business | null> {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("business_members")
    .select("business_id")
    .limit(1);

  const businessId = memberships?.[0]?.business_id;
  if (!businessId) return null;

  const { data } = await supabase
    .from("businesses")
    .select("id,name,business_type,logo_url,location,contact_phone,contact_email,currency")
    .eq("id", businessId)
    .single();

  return (data as Business | null) ?? null;
}
