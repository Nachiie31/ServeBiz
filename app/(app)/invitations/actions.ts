"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BUSINESS_COOKIE, getAllMemberships } from "@/lib/business";
import { homeFor } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where to come back to with a message: only these two pages, never a URL from the form. */
function back(formData: FormData): string {
  return formData.get("return_to") === "/onboarding" ? "/onboarding" : "/invitations";
}

/** Accept an invitation, switch to that branch and open its home page. */
export async function acceptInvite(formData: FormData) {
  const id = String(formData.get("invite_id") ?? "");
  const to = back(formData);
  if (!ID.test(id)) redirect(`${to}?error=` + encodeURIComponent("That invitation is not valid."));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invite", { p_invite_id: id });
  if (error) redirect(`${to}?error=` + encodeURIComponent(error.message));

  const businessId = String(data);
  (await cookies()).set(BUSINESS_COOKIE, businessId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  const joined = (await getAllMemberships()).find((e) => e.business.id === businessId);
  redirect(joined ? homeFor(joined.role) : "/dashboard");
}

/** Decline an invitation. The owner sees it as "Declined" and can invite again later. */
export async function declineInvite(formData: FormData) {
  const id = String(formData.get("invite_id") ?? "");
  const to = back(formData);
  if (!ID.test(id)) redirect(`${to}?error=` + encodeURIComponent("That invitation is not valid."));
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_invite", { p_invite_id: id });
  revalidatePath("/", "layout");
  redirect(error ? `${to}?error=` + encodeURIComponent(error.message) : `${to}?declined=1`);
}
