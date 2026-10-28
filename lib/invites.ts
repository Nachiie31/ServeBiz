import { createClient } from "@/lib/supabase/server";

export type MyInvite = {
  id: string;
  org_name: string;
  branch_name: string;
  location: string | null;
  role: "manager" | "cashier";
  invited_by_email: string | null;
  created_at: string;
  /** the person already works for a different business, so they can only decline */
  blocked: boolean;
};

/** Invitations waiting for the logged-in person to accept or decline. Empty before migration 014. */
export async function getMyInvites(): Promise<MyInvite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_invites");
  if (error || !data) return [];
  return data as MyInvite[];
}
