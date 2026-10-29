export const MAX_IMPORT_ROWS = 500;

export const TEMPLATE_HEADER = ["code", "name", "quantity", "base_price", "selling_price", "expiry_date", "date_received", "batch_no", "supplier"];
export const TEMPLATE_ROWS = [
  ["MILK-1L", "Fresh Milk 1L", "24", "58.50", "75", "2027-03-01", "", "B-1001", ""],
  ["RICE-5KG", "Rice 5kg", "10", "240", "290", "", "", "", ""],
];

/** Plain CSV parser: quoted cells, doubled quotes, line breaks inside quotes, BOM, comma / semicolon / tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch as keyof typeof counts]++;
  }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const ALIASES: Record<string, string> = {
  code: "code", sku: "code", productcode: "code", itemcode: "code",
  name: "name", productname: "name", product: "name", item: "name", description: "name",
  quantity: "quantity", qty: "quantity", units: "quantity",
  baseprice: "base_price", cost: "base_price", costprice: "base_price", unitcost: "base_price", latestcost: "base_price",
  sellingprice: "selling_price", price: "selling_price", retailprice: "selling_price", srp: "selling_price",
  expirydate: "expiry_date", expiry: "expiry_date", expirationdate: "expiry_date", expiration: "expiry_date", bestbefore: "expiry_date",
  datereceived: "date_received", received: "date_received", receiveddate: "date_received",
  batchno: "batch_no", batch: "batch_no", batchnumber: "batch_no", lot: "batch_no", lotno: "batch_no",
  supplier: "supplier", suppliername: "supplier", vendor: "supplier",
};
const canon = (h: string) => ALIASES[h.toLowerCase().replace(/[^a-z]/g, "")] ?? null;

export type ImportRow = {
  line: number;                 // line number in the file (header is line 1)
  code: string; name: string; quantity: number; basePrice: number;
  sellingPrice: number | null; expiry: string | null; dateReceived: string;
  batchNo: string | null; supplier: string | null;
  isNew: boolean;
  errors: string[];
};
export type ParsedImport = { rows: ImportRow[]; fatal: string | null; ignoredColumns: string[] };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Accepts YYYY-MM-DD or YYYY/MM/DD. Day-first / month-first dates are refused because they are ambiguous. */
export function parseIsoDate(text: string): string | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!validDate(y, mo, d)) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseMoney(text: string): number | null {
  const t = text.trim().replace(/^[₱$€£]\s*/, "").replace(/\s/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n < 1e10 ? n : null;
}

/** Cells written by our own export may start with an apostrophe to stop spreadsheet formulas. */
const clean = (s: string) => s.trim().replace(/^'(?=[=+\-@])/, "");

export function parseImport(text: string, existingCodes: Set<string>, supplierNames: Set<string>): ParsedImport {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], fatal: "The file is empty.", ignoredColumns: [] };

  const header = table[0];
  const idx: Record<string, number> = {};
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const key = canon(h);
    if (key && idx[key] === undefined) idx[key] = i;
    else if (h.trim()) ignored.push(h.trim());
  });
  const missing = ["code", "quantity", "base_price"].filter((k) => idx[k] === undefined);
  if (missing.length) {
    return {
      rows: [], ignoredColumns: ignored,
      fatal: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Use the template for the expected headers.`,
    };
  }
  const body = table.slice(1);
  if (body.length === 0) return { rows: [], fatal: "The file has a header but no rows.", ignoredColumns: ignored };
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], ignoredColumns: ignored, fatal: `Too many rows (${body.length}). Import up to ${MAX_IMPORT_ROWS} rows at a time.` };
  }

  const get = (r: string[], k: string) => (idx[k] === undefined ? "" : clean(r[idx[k]] ?? ""));
  const suppliersLower = new Set([...supplierNames].map((s) => s.toLowerCase()));
  const codesLower = new Set([...existingCodes]);
  const today = todayISO();

  const rows: ImportRow[] = body.map((r, i) => {
    const errors: string[] = [];
    const code = get(r, "code");
    const name = get(r, "name");
    if (!code) errors.push("code is required");
    else if (code.length > 64) errors.push("code is longer than 64 characters");
    if (name.length > 200) errors.push("name is longer than 200 characters");
    const isNew = !!code && !codesLower.has(code);
    if (isNew && !name) errors.push("name is required for a new product");

    const qtyText = get(r, "quantity");
    const quantity = /^\d+$/.test(qtyText) ? Number(qtyText) : NaN;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000) errors.push("quantity must be a whole number above 0");

    const base = parseMoney(get(r, "base_price"));
    if (base === null) errors.push("base_price must be a number (0 or more)");

    const sellText = get(r, "selling_price");
    let sellingPrice: number | null = null;
    if (sellText) {
      sellingPrice = parseMoney(sellText);
      if (sellingPrice === null) errors.push("selling_price must be a number (0 or more)");
    }

    const dateText = get(r, "date_received");
    let dateReceived = today;
    if (dateText) {
      const d = parseIsoDate(dateText);
      if (!d) errors.push("date_received must look like 2026-03-31");
      else dateReceived = d;
    }
    const expText = get(r, "expiry_date");
    let expiry: string | null = null;
    if (expText) {
      expiry = parseIsoDate(expText);
      if (!expiry) errors.push("expiry_date must look like 2026-03-31");
      else if (expiry < dateReceived) errors.push("expiry_date is earlier than date_received");
    }

    const supplier = get(r, "supplier") || null;
    if (supplier && !suppliersLower.has(supplier.toLowerCase())) errors.push(`supplier "${supplier}" does not exist (add it under Suppliers first)`);
    const batchNo = get(r, "batch_no") || null;
    if (batchNo && batchNo.length > 100) errors.push("batch_no is longer than 100 characters");

    return {
      line: i + 2, code, name, quantity: Number.isFinite(quantity) ? quantity : 0, basePrice: base ?? 0,
      sellingPrice, expiry, dateReceived, batchNo, supplier, isNew, errors,
    };
  });
  return { rows, fatal: null, ignoredColumns: ignored };
}
