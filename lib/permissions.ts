export type Role = "owner" | "manager" | "cashier";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
};

export function isRole(value: unknown): value is Role {
  return value === "owner" || value === "manager" || value === "cashier";
}

/** Owners and managers run the shop: inventory, prices, reports, voiding sales. */
export function canManage(role: Role): boolean {
  return role === "owner" || role === "manager";
}

/** Where each role starts. Cashiers only ever need the POS. */
export function homeFor(role: Role): string {
  return role === "cashier" ? "/pos" : "/dashboard";
}
