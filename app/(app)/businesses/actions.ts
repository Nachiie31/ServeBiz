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
