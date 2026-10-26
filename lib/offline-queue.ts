/**
 * Cash sales rung up without a connection are kept on the device and sent later.
 * Each sale carries a client reference, so sending it twice never sells twice
 * (see sync_offline_sale in migration 012).
 */
export type QueuedSale = {
  ref: string;                  // uuid, also the idempotency key
  userId: string;
  businessId: string;
  items: { product_id: string; quantity: number }[];
  discountType: "amount" | "percent";
  discountValue: number;
  tendered: number | null;
  soldAt: string;               // ISO time of the sale
  total: number;                // for display only
  status: "pending" | "failed";
  error?: string;
};

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export const QUEUE_KEY = "servebiz-offline-queue";
export const MAX_QUEUE = 200;

function read(store: StorageLike): QueuedSale[] {
  try {
    const parsed = JSON.parse(store.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed.filter((s) => s && typeof s.ref === "string" && Array.isArray(s.items)) as QueuedSale[]) : [];
  } catch {
    return [];
  }
}
function write(store: StorageLike, q: QueuedSale[]) {
  store.setItem(QUEUE_KEY, JSON.stringify(q));
}

export const queueFor = (store: StorageLike, userId: string) => read(store).filter((s) => s.userId === userId);

/** Adds a sale. Throws if the device cannot store it (full storage) so the sale is never silently lost. */
export function enqueue(store: StorageLike, sale: QueuedSale): void {
  const all = read(store);
  if (all.length >= MAX_QUEUE) throw new Error("Too many unsynced sales on this device. Connect to the internet and sync first.");
  if (all.some((s) => s.ref === sale.ref)) return;
  write(store, [...all, sale]);
  if (!read(store).some((s) => s.ref === sale.ref)) throw new Error("This device could not save the sale.");
}

export function remove(store: StorageLike, ref: string): void {
  write(store, read(store).filter((s) => s.ref !== ref));
}

export function update(store: StorageLike, ref: string, patch: Partial<QueuedSale>): void {
  write(store, read(store).map((s) => (s.ref === ref ? { ...s, ...patch } : s)));
}

/** Retry-able: no connection, or the login token needs refreshing. Everything else is a real refusal (e.g. out of stock). */
export function isTransient(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  const code = err.code ?? "";
  if (code === "PGRST301" || msg.includes("jwt")) return true;
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("PGRST")) return false;   // a Postgres or PostgREST answer: the server did respond
  return /fetch|network|load failed|timeout|timed out|offline|connection|abort/.test(msg);
}

export type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type SendFn = (sale: QueuedSale) => PromiseLike<RpcResult>;

/** Sends pending sales oldest first. Stops at the first connection problem so order is kept. */
export async function flush(
  store: StorageLike, userId: string, send: SendFn,
): Promise<{ sent: number; failed: number; offline: boolean }> {
  let sent = 0, failed = 0;
  const pending = queueFor(store, userId).filter((s) => s.status === "pending").sort((a, b) => a.soldAt.localeCompare(b.soldAt));
  for (const sale of pending) {
    let res: RpcResult;
    try {
      res = await send(sale);
    } catch {
      return { sent, failed, offline: true };
    }
    if (!res.error) {
      remove(store, sale.ref);
      sent++;
    } else if (isTransient(res.error)) {
      return { sent, failed, offline: true };
    } else {
      update(store, sale.ref, { status: "failed", error: res.error.message ?? "The sale was refused." });
      failed++;
    }
  }
  return { sent, failed, offline: false };
}

/** Units already promised to offline sales, so the till cannot sell the same stock twice. */
export function reservedUnits(store: StorageLike, userId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of queueFor(store, userId)) {
    if (s.status !== "pending") continue;
    for (const i of s.items) out.set(i.product_id, (out.get(i.product_id) ?? 0) + i.quantity);
  }
  return out;
}
