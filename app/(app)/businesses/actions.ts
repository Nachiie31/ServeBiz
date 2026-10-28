"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BUSINESS_COOKIE, getAllMemberships } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/permissions";

async function remember(id: string) {
  (await cookies()).set(BUSINESS_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Switch to another branch the user belongs to, then open that branch's home page. */
export async function selectBusiness(formData: FormData) {
  const id = String(formData.get("business_id") ?? "");
  const all = await getAllMemberships();
  const target = all.find((e) => e.business.id === id);
  if (!target) redirect("/businesses");
  await remember(target.business.id);
  revalidatePath("/", "layout");
  redirect(homeFor(target.role));
}

/** Same as selectBusiness but returns the page to open (used by the sidebar dropdown). */
export async function switchBusiness(id: string): Promise<string> {
  const all = await getAllMemberships();
  const target = all.find((e) => e.business.id === id);
  if (!target) return "/businesses";
  await remember(target.business.id);
  revalidatePath("/", "layout");
  return homeFor(target.role);
}

/** Used right after creating a business or branch so the user lands in it. */
export async function rememberBusiness(id: string) {
  const all = await getAllMemberships();
  if (!all.some((e) => e.business.id === id)) return;
  await remember(id);
  revalidatePath("/", "layout");
}

export type BranchState = { error?: string };

/** Owner adds another branch to the business they are looking at. */
export async function addBranch(_prev: BranchState, formData: FormData): Promise<BranchState> {
  const source = String(formData.get("source_business") ?? "");
  const branch = String(formData.get("branch_name") ?? "").trim();
  if (!branch) return { error: "Branch name is required." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_branch", {
    p_source_business: source,
    p_branch_name: branch,
    p_location: String(formData.get("location") ?? "").trim() || null,
    p_phone: String(formData.get("phone") ?? "").trim() || null,
    p_email: String(formData.get("email") ?? "").trim() || null,
  });
  if (error) return { error: error.message };
  await remember(String(data));
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export type RemoveState = { error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function dropStaleCookie(removedIds: string[]) {
  const jar = await cookies();
  const current = jar.get(BUSINESS_COOKIE)?.value;
  if (current && removedIds.includes(current)) jar.delete(BUSINESS_COOKIE);
}

/** Remove one branch (the person must type its name). The database refuses to remove someone's only business. */
export async function removeBranch(_prev: RemoveState, formData: FormData): Promise<RemoveState> {
  const id = String(formData.get("id") ?? "");
  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (!UUID.test(id)) return { error: "Branch not found." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("businesses").select("branch_name,organization_id").eq("id", id).maybeSingle();
  const branch = row as { branch_name: string; organization_id: string } | null;
  if (!branch) return { error: "Branch not found." };
  if (typed !== branch.branch_name.trim().toLowerCase()) return { error: `Type the branch name (${branch.branch_name}) exactly to confirm.` };

  // If this is the business's last branch the whole business goes too, so remember all its branches.
  const { data: siblings } = await supabase.from("businesses").select("id").eq("organization_id", branch.organization_id);
  const { error } = await supabase.rpc("delete_branch", { p_business_id: id });
  if (error) return { error: friendlyRemoveError(error.message) };
  const gone = ((siblings ?? []) as { id: string }[]).length <= 1 ? ((siblings ?? []) as { id: string }[]).map((b) => b.id) : [id];
  await dropStaleCookie(gone);
  revalidatePath("/", "layout");
  redirect("/businesses?removed=branch");
}

/** Remove a whole business and all its branches (the person must type the business name). */
export async function removeBusiness(_prev: RemoveState, formData: FormData): Promise<RemoveState> {
  const id = String(formData.get("id") ?? "");
  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (!UUID.test(id)) return { error: "Business not found." };
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("name").eq("id", id).maybeSingle();
  const name = (org as { name: string } | null)?.name;
  if (!name) return { error: "Business not found." };
  if (typed !== name.trim().toLowerCase()) return { error: `Type the business name (${name}) exactly to confirm.` };

  const { data: branches } = await supabase.from("businesses").select("id").eq("organization_id", id);
  const { error } = await supabase.rpc("delete_business", { p_org_id: id });
  if (error) return { error: friendlyRemoveError(error.message) };
  await dropStaleCookie(((branches ?? []) as { id: string }[]).map((b) => b.id));
  revalidatePath("/", "layout");
  redirect("/businesses?removed=business");
}

function friendlyRemoveError(message: string): string {
  return /delete_branch|delete_business|my_business_count/.test(message) && /not exist|schema cache|Could not find/i.test(message)
    ? "Removing needs a database update. Run supabase/migrations/014_invites_remove.sql in Supabase first."
    : message;
}
