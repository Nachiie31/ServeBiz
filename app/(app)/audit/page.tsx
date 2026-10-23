import { redirect } from "next/navigation";
import Link from "next/link";
import { getMembership } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { PAGE_SIZE, pageCount, parsePage } from "@/lib/paging";
import Paginator from "@/components/Paginator";
import LocalTime from "@/components/LocalTime";

type Row = {
  id: string; created_at: string; actor_email: string | null; action: string; entity: string;
  entity_label: string | null; details: Record<string, unknown>; total_count: number;
};

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "product", label: "Products" },
  { key: "stock", label: "Stock" },
  { key: "sale", label: "Voids & refunds" },
  { key: "purchase", label: "Purchases" },
  { key: "member", label: "Team" },
  { key: "invite", label: "Invites" },
  { key: "settings", label: "Settings" },
];

const ACTION: Record<string, string> = {
  "product.created": "Added product",
  "product.price_changed": "Changed price",
  "product.edited": "Edited product",
  "product.deleted": "Deleted product",
  "sale.voided": "Voided sale",
  "sale.refunded": "Refunded items",
  "stock.received": "Received stock",
  "stock.adjusted": "Adjusted stock",
  "po.created": "Created purchase order",
  "po.partial": "Partly received order",
  "po.received": "Order received",
  "po.cancelled": "Cancelled order",
  "member.joined": "Team member joined",
  "member.role_changed": "Changed role",
  "member.removed": "Removed from team",
  "invite.sent": "Sent invite",
  "invite.cancelled": "Cancelled invite",
  "settings.tax_changed": "Changed tax settings",
  "settings.changed": "Changed business details",
};

const FIELD: Record<string, string> = {
  selling_price: "price", reorder_level: "reorder level", is_active: "active", branch_name: "branch name",
  business_type: "type", contact_phone: "phone", contact_email: "email", tax_rate: "tax rate",
  tax_name: "tax name", tax_inclusive: "tax included in price", category_id: "category",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : String(v));

function describe(r: Row, currency: string): string {
  const d = r.details ?? {};
  if (r.action === "product.created") return `price ${formatMoney(Number(d.selling_price ?? 0), currency)}`;
  if (r.action === "sale.voided") return `total ${formatMoney(Number(d.total ?? 0), currency)}`;
  if (r.action === "sale.refunded") return `refunded ${formatMoney(Number(d.total ?? 0), currency)}${d.reason ? `: ${String(d.reason)}` : ""}`;
  if (r.action === "stock.received" || r.action === "stock.adjusted") {
    const c = Number(d.change ?? 0);
    return `${c > 0 ? "+" : ""}${c}${d.type && d.type !== "receive" ? ` (${String(d.type)})` : ""}${d.reason ? `: ${String(d.reason)}` : ""}`;
  }
  if (r.action === "member.joined" || r.action === "member.removed" || r.action === "invite.sent" || r.action === "invite.cancelled") {
    return `as ${show(d.role)}`;
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v) && v.length === 2) {
      const money = k === "selling_price";
      const f = (x: unknown) => (money && x !== null ? formatMoney(Number(x), currency) : show(x));
      parts.push(`${FIELD[k] ?? k}: ${f(v[0])} → ${f(v[1])}`);
    }
  }
  return parts.join("; ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; page?: string }> }) {
  const sp = await searchParams;
  const entity = FILTERS.some((f) => f.key === sp.entity) ? sp.entity! : "all";
  const page = parsePage(sp.page);
  const { business } = (await getMembership())!;
  const supabase = await createClient();

  const run = (pg: number) =>
    supabase.rpc("list_audit", { p_business_id: business.id, p_entity: entity, p_limit: PAGE_SIZE, p_offset: (pg - 1) * PAGE_SIZE });
  const res = await run(page);
  if (res.error) {
    return <div className="alert warn">The audit log needs <code>supabase/migrations/009_audit_overview.sql</code>. Run it in the Supabase SQL Editor, then refresh.</div>;
  }
  const rows = (res.data ?? []) as Row[];
  let total = Number(rows[0]?.total_count ?? 0);
  if (rows.length === 0 && page > 1) {
    const first = ((await run(1)).data ?? []) as Row[];
    total = Number(first[0]?.total_count ?? 0);
    const last = pageCount(total);
    redirect(`/audit?${new URLSearchParams({ ...(entity !== "all" ? { entity } : {}), ...(last > 1 ? { page: String(last) } : {}) })}`);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Audit log</h2>
          <p>Who changed what in {business.branch_name ? `${business.branch_name} branch` : business.name}. Entries cannot be edited or deleted.</p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === "all" ? "/audit" : `/audit?entity=${f.key}`} className={`tab${entity === f.key ? " active" : ""}`}>{f.label}</Link>
        ))}
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">Nothing recorded yet. Changes made from now on will appear here.</div>
        ) : (
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><LocalTime iso={r.created_at} /></td>
                  <td>{r.actor_email ?? "System"}</td>
                  <td>{ACTION[r.action] ?? r.action}</td>
                  <td>{r.entity_label ?? "-"}</td>
                  <td className="muted">{describe(r, business.currency) || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Paginator basePath="/audit" params={{ entity: entity === "all" ? undefined : entity }} page={page} total={total} pageSize={PAGE_SIZE} noun="entries" />
    </>
  );
}
