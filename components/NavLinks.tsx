"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Role } from "@/lib/permissions";

type NavItem = { href: string; label: string; roles: Role[]; needsMulti?: boolean; badge?: "invites" };
type NavGroup = { title: string; items: NavItem[] };

const ALL: Role[] = ["owner", "manager", "cashier"];
const MANAGE: Role[] = ["owner", "manager"];

const top: NavItem[] = [{ href: "/dashboard", label: "Dashboard", roles: MANAGE }];

const groups: NavGroup[] = [
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
      { href: "/invitations", label: "Invitations", roles: ALL, badge: "invites" },
      { href: "/overview", label: "All branches", roles: ["owner"], needsMulti: true },
      { href: "/team", label: "Team", roles: ["owner"] },
      { href: "/audit", label: "Audit log", roles: ["owner"] },
      { href: "/settings", label: "Settings", roles: ["owner"] },
    ],
  },
];

export default function NavLinks({ role, multiBranch = false, inviteCount = 0 }: { role: Role; multiBranch?: boolean; inviteCount?: number }) {
  const pathname = usePathname();
  const visible = (g: NavGroup) => g.items.filter((i) => i.roles.includes(role) && (!i.needsMulti || multiBranch));
  const shown = groups.map((g) => ({ ...g, items: visible(g) })).filter((g) => g.items.length > 0);
  const activeGroup = shown.find((g) => g.items.some((i) => pathname.startsWith(i.href)))?.title ?? null;

  // One section is open at a time, so the sidebar stays short and the log-out button stays in view.
  const [open, setOpen] = useState<string | null>(activeGroup);
  useEffect(() => {
    setOpen(activeGroup);
  }, [activeGroup]);

  const badge = (i: NavItem) => (i.badge === "invites" && inviteCount > 0 ? <span className="nav-badge" aria-label={`${inviteCount} pending`}>{inviteCount}</span> : null);

  return (
    <nav className="nav-list" aria-label="Main">
      {top.filter((i) => i.roles.includes(role)).map((l) => (
        <Link key={l.href} href={l.href} className={`nav-link${pathname.startsWith(l.href) ? " active" : ""}`}>
          {l.label}
        </Link>
      ))}
      {shown.map((g) => {
        const isOpen = open === g.title;
        const id = `nav-${g.title.toLowerCase()}`;
        const hasBadge = g.items.some((i) => i.badge === "invites") && inviteCount > 0;
        return (
          <div key={g.title} className="nav-group">
            <button
              type="button"
              className={`nav-toggle${g.title === activeGroup ? " has-active" : ""}`}
              aria-expanded={isOpen}
              aria-controls={id}
              onClick={() => setOpen(isOpen ? null : g.title)}
            >
              <span>{g.title}</span>
              <span className="nav-toggle-end">
                {hasBadge && !isOpen && <span className="nav-badge" aria-label={`${inviteCount} pending invitations`}>{inviteCount}</span>}
                <span className={`nav-chevron${isOpen ? " open" : ""}`} aria-hidden="true">›</span>
              </span>
            </button>
            {isOpen && (
              <div id={id} className="nav-sub">
                {g.items.map((l) => (
                  <Link key={l.href} href={l.href} className={`nav-link${pathname.startsWith(l.href) ? " active" : ""}`}>
                    <span>{l.label}</span>
                    {badge(l)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
