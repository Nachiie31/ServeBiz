import { formatMoney } from "@/lib/format";
import LocalTime from "@/components/LocalTime";

export type ReceiptData = {
  receipt_no: string;
  created_at: string;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  method: string;
  tendered: number | null;
  items: { name: string; quantity: number; unit_price: number }[];
};

type Props = {
  business: { name: string; location: string | null; contact_phone: string | null };
  currency: string;
  data: ReceiptData;
  /** e.g. "VAT (12%, included)". Falls back to "Tax". */
  taxLabel?: string;
};

// card / ewallet are kept so older receipts (from before payments were simplified) still print.
const METHOD_LABEL: Record<string, string> = { cash: "Cash", stripe: "Online", card: "Card", ewallet: "E-wallet" };

export default function Receipt({ business, currency, data, taxLabel }: Props) {
  const money = (n: number) => formatMoney(n, currency);
  const change = data.method === "cash" && data.tendered !== null ? data.tendered - data.total : null;

  return (
    <div className="receipt receipt-print">
      <div className="receipt-head">
        <strong>{business.name}</strong>
        {business.location && <div>{business.location}</div>}
        {business.contact_phone && <div>{business.contact_phone}</div>}
      </div>

      <div className="receipt-meta">
        <span>{data.receipt_no}</span>
        <span><LocalTime iso={data.created_at} /></span>
      </div>
      {data.status !== "completed" && <div className="receipt-void">{data.status.toUpperCase()}</div>}

      <table className="receipt-lines">
        <tbody>
          {data.items.map((it, i) => (
            <tr key={i}>
              <td>
                {it.name}
                <div className="receipt-sub">{it.quantity} x {money(it.unit_price)}</div>
              </td>
              <td className="r">{money(it.quantity * it.unit_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-totals">
        <div><span>Subtotal</span><span>{money(data.subtotal)}</span></div>
        {data.discount > 0 && <div><span>Discount</span><span>-{money(data.discount)}</span></div>}
        {data.tax > 0 && <div><span>{taxLabel ?? "Tax"}</span><span>{money(data.tax)}</span></div>}
        <div className="grand"><span>Total</span><span>{money(data.total)}</span></div>
        <div><span>Paid by</span><span>{METHOD_LABEL[data.method] ?? data.method}</span></div>
        {data.method === "cash" && data.tendered !== null && (
          <>
            <div><span>Cash received</span><span>{money(data.tendered)}</span></div>
            <div><span>Change</span><span>{money(change ?? 0)}</span></div>
          </>
        )}
      </div>

      <div className="receipt-foot">Thank you!</div>
    </div>
  );
}
