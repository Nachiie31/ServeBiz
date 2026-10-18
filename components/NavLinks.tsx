"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links: { href: string; label: string; section?: string; disabled?: boolean; tag?: string }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inventory/receiving", label: "Receiving", section: "Inventory" },
  { href: "/inventory/products", label: "Products" },
  { href: "/inventory/suppliers", label: "Suppliers" },
  { href: "/pos", label: "Point of sale", section: "Sales" },
  { href: "/sales", label: "Sales history" },
  { href: "/settings", label: "Settings", section: "Business" },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="nav-list" aria-label="Main">
      {links.map((l) => (
        <div key={l.href} style={{ display: "contents" }}>
          {l.section && <div className="nav-sep">{l.section}</div>}
          <Link
            href={l.href}
            aria-disabled={l.disabled}
            tabIndex={l.disabled ? -1 : undefined}
            className={`nav-link${pathname.startsWith(l.href) ? " active" : ""}${l.disabled ? " disabled" : ""}`}
          >
            {l.label}
            {l.tag && <span className="chip gray">{l.tag}</span>}
          </Link>
        </div>
      ))}
    </nav>
  );
}
