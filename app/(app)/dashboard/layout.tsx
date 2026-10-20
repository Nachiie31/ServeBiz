import { requireRole } from "@/lib/auth";

// Owners and managers only. Cashiers are sent to the POS.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireRole(["owner", "manager"]);
  return <>{children}</>;
}
