import { requireRole } from "@/lib/auth";

// Owner only. Everyone else goes back to their starting page.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireRole(["owner"]);
  return <>{children}</>;
}
