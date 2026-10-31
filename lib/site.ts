// Central SEO settings. Set NEXT_PUBLIC_SITE_URL in your host (e.g. https://servebiz.vercel.app).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
export const SITE_NAME = "ServeBiz";
export const SITE_TAGLINE = "POS and Inventory for Small Businesses";
export const SITE_DESCRIPTION =
  "ServeBiz is a free online point of sale (POS) and inventory system for small shops. Track stock by batch and expiry, sell at the counter, accept cash, card and GCash, manage branches and staff, and see sales reports.";
export const KEYWORDS = [
  "POS system", "point of sale", "inventory management", "small business POS", "sari-sari store POS",
  "retail inventory software", "stock tracking", "expiry date tracking", "multi-branch POS",
  "GCash payments", "sales reports", "offline POS", "Philippines POS",
];
