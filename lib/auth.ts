import { redirect } from "next/navigation";
import { getMembership, type Membership } from "@/lib/business";
import { homeFor, type Role } from "@/lib/permissions";

/**
 * Page-level guard: sends people to the right place when their role is not allowed here.
 * This is for a clean experience. The real protection is in the database (see migration 006),
 * so a cashier who types a URL still cannot read or change anything they should not.
 */
export async function requireRole(allowed: Role[]): Promise<Membership> {
  const m = await getMembership();
  if (!m) redirect("/onboarding");
  if (!allowed.includes(m.role)) redirect(homeFor(m.role));
  return m;
}
