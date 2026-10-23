"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/permissions";

type NavItem = { href: string; label: string; roles: Role[]; needsMulti?: boolean };
type NavGroup = { title?: string; items: NavItem[] };

const ALL: Role[] = ["owner", "manager", "cashier"];
const MANAGE: Role[] = ["owner", "manager"];

const groups: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", roles: MANAGE }] },
  {
    title: "Inventory",
    items: [
      { href: "/inventory/receiving", label: "Receiving", roles: MANAGE },
      { href: "/inventory/products", label: "Products", roles: MANAGE },
      { href: "/inventory/purchase-orders", label: "Purchase orders", roles: MANAGE },
      { href: "/inventory/suppliers", label: "Suppliers", roles: MANAGE },
    ],
  },
  {
    title: "Sales",
    items: [
      { href: "/pos", label: "Point of sale", roles: ALL },
      { href: "/sales", label: "Sales history", roles: ALL },
      { href: "/reports", label: "Reports", roles: MANAGE },
    ],
  },
  {
    title: "Business",
    items: [
      { href: "/businesses", label: "My businesses", roles: ALL },
      { href: "/overview", label: "All branches", roles: ["owner"], needsMulti: true },
      { href: "/team", label: "Team", roles: ["owner"] },
      { href: "/audit", label: "Audit log", roles: ["owner"] },
      { href: "/settings", label: "Settings", roles: ["owner"] },
    ],
  },
];

export default function NavLinks({ role, multiBranch = false }: { role: Role; multiBranch?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="nav-list" aria-label="Main">
      {groups.map((g, gi) => {
        const items = g.items.filter((i) => i.roles.includes(role) && (!i.needsMulti || multiBranch));
        if (items.length === 0) return null;
        return (
          <div key={g.title ?? gi} style={{ display: "contents" }}>
            {g.title && <div className="nav-sep">{g.title}</div>}
            {items.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`nav-link${pathname.startsWith(l.href) ? " active" : ""}`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
