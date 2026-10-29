"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MAX_IMPORT_ROWS, TEMPLATE_HEADER, TEMPLATE_ROWS, parseImport, type ParsedImport } from "@/lib/import-csv";
import { toCsv } from "@/lib/csv";

const MAX_FILE_BYTES = 1024 * 1024;
const PREVIEW_ROWS = 100;

type Failure = { line: number; code: string; message: string };

export default function ImportClient({
  businessId, existingCodes, suppliers,
}: { businessId: string; existingCodes: string[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const codeSet = useMemo(() => new Set(existingCodes), [existingCodes]);
  const supplierByName = useMemo(() => new Map(suppliers.map((s) => [s.name.toLowerCase(), s.id])), [suppliers]);

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<{ ok: number; priced: number; failures: Failure[] } | null>(null);

  const good = parsed?.rows.filter((r) => r.errors.length === 0) ?? [];
  const bad = parsed?.rows.filter((r) => r.errors.length > 0) ?? [];

  function downloadTemplate() {
    const blob = new Blob([toCsv(TEMPLATE_HEADER, TEMPLATE_ROWS)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "servebiz-import-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParsed(null); setDone(null); setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError("That file is over 1 MB. Split it into smaller files."); e.target.value = ""; return; }
    if (!/\.(csv|txt)$/i.test(file.name)) { setError("Please choose a .csv file (in Excel: File > Save As > CSV)."); e.target.value = ""; return; }
    setFileName(file.name);
    const text = await file.text();
    setParsed(parseImport(text, codeSet, new Set(suppliers.map((s) => s.name))));
  }

  async function run() {
    if (!parsed || good.length === 0 || running) return;
    setRunning(true); setDone(null); setProgress(0); setError(null);
    const failures: Failure[] = [];
    let ok = 0;
    const priceFor = new Map<string, number>(); // first selling price per code in the file

    for (let i = 0; i < good.length; i++) {
      const r = good[i];
      const { error: err } = await supabase.rpc("receive_stock", {
        p_business_id: businessId,
        p_code: r.code,
        p_name: r.name,
        p_supplier_id: r.supplier ? supplierByName.get(r.supplier.toLowerCase()) ?? null : null,
        p_date_received: r.dateReceived,
        p_expiry_date: r.expiry,
        p_quantity: r.quantity,
        p_base_price: r.basePrice,
        p_batch_no: r.batchNo,
        p_notes: "Imported from CSV",
      });
      if (err) failures.push({ line: r.line, code: r.code, message: err.message });
      else {
        ok++;
        if (r.sellingPrice && r.sellingPrice > 0 && !priceFor.has(r.code)) priceFor.set(r.code, r.sellingPrice);
      }
      setProgress(i + 1);
    }

    // Selling prices only fill in products that have none yet (same rule as Receiving).
    let priced = 0;
    const codes = [...priceFor.keys()];
    for (let i = 0; i < codes.length; i += 100) {
      const chunk = codes.slice(i, i + 100);
      const { data } = await supabase.from("products").select("id,code,selling_price").eq("business_id", businessId).in("code", chunk);
      for (const p of (data ?? []) as { id: string; code: string; selling_price: number }[]) {
        if (Number(p.selling_price) > 0) continue;
        const { error: perr } = await supabase.from("products").update({ selling_price: priceFor.get(p.code), is_active: true }).eq("id", p.id);
        if (!perr) priced++;
      }
    }

    setRunning(false);
    setDone({ ok, priced, failures });
    setParsed(null);
    setFileName("");
    router.refresh();
  }

  return (
    <>
      <div className="card" style={{ maxWidth: 760, marginBottom: 20 }}>
        <h3 style={{ marginBottom: 6 }}>1. Get your file ready</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Required columns: <code>code</code>, <code>quantity</code>, <code>base_price</code> (cost per unit). New products also need <code>name</code>.
          Optional: <code>selling_price</code> (only used if the product has no price yet), <code>expiry_date</code> and <code>date_received</code> as
          2026-03-31, <code>batch_no</code>, <code>supplier</code> (must already exist). Up to {MAX_IMPORT_ROWS} rows and 1 MB per file.
        </p>
        <button className="btn" type="button" onClick={downloadTemplate}>Download template</button>

        <h3 style={{ margin: "20px 0 6px" }}>2. Choose the file</h3>
        <input className="input" type="file" accept=".csv,.txt,text/csv" onChange={onFile} disabled={running} aria-label="CSV file" />
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {parsed?.fatal && <div className="alert err" role="alert">{parsed.fatal}</div>}

      {parsed && !parsed.fatal && (
        <section className="section">
          <h3>3. Check, then import</h3>
          <p className="muted" style={{ fontSize: 14 }}>
            {fileName}: <strong>{good.length}</strong> row{good.length === 1 ? "" : "s"} ready
            {bad.length > 0 && <>, <strong style={{ color: "var(--danger, #b91c1c)" }}>{bad.length}</strong> with problems (these are skipped)</>}.
            {parsed.ignoredColumns.length > 0 && <> Ignored columns: {parsed.ignoredColumns.join(", ")}.</>}
          </p>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Line</th><th>Code</th><th>Name</th><th className="num">Qty</th><th className="num">Cost</th><th>Expiry</th><th>Status</th></tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, PREVIEW_ROWS).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.code || "-"}</td>
                    <td>{r.name || "-"}</td>
                    <td className="num">{r.quantity || "-"}</td>
                    <td className="num">{r.basePrice}</td>
                    <td>{r.expiry ?? "-"}</td>
                    <td>
                      {r.errors.length > 0
                        ? <span className="chip warn" title={r.errors.join("; ")}>{r.errors.join("; ")}</span>
                        : <span className="chip">{r.isNew ? "New product" : "Adds stock"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > PREVIEW_ROWS && (
            <p className="muted" style={{ fontSize: 13 }}>
              Showing the first {PREVIEW_ROWS} of {parsed.rows.length} rows. Every row is checked; problem rows beyond the preview are skipped too.
            </p>
          )}

          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="button" disabled={running || good.length === 0} onClick={run}>
              {running ? `Importing ${progress} of ${good.length}...` : `Import ${good.length} row${good.length === 1 ? "" : "s"}`}
            </button>
            {good.length === 0 && <span className="muted">Nothing to import. Fix the file and choose it again.</span>}
          </div>
        </section>
      )}

      {done && (
        <div className={`alert${done.failures.length ? " warn" : ""}`} role="status" style={{ marginTop: 16 }}>
          <strong>Imported {done.ok} row{done.ok === 1 ? "" : "s"}.</strong>
          {done.priced > 0 && <> Selling price set on {done.priced} product{done.priced === 1 ? "" : "s"}.</>}
          {done.failures.length > 0 && (
            <>
              {" "}{done.failures.length} failed:
              <ul style={{ margin: "6px 0 0 18px" }}>
                {done.failures.slice(0, 20).map((f) => <li key={f.line}>Line {f.line} ({f.code}): {f.message}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
