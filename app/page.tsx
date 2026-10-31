import Link from "next/link";
import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "ServeBiz: Free POS and Inventory System for Small Businesses" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const features = [
  { badge: "Inventory", title: "Receive stock, track every batch", text: "Log deliveries with supplier, expiry date, quantity and cost. Stock is computed from batches, so counts stay accurate, and low-stock and near-expiry alerts tell you what to reorder." },
  { badge: "Point of sale", title: "Sell fast, deduct automatically", text: "Search or scan products, apply discounts, take cash, card or GCash, and print a receipt. Stock comes off the earliest-expiring batch first." },
  { badge: "Insights", title: "Know how your shop is doing", text: "Sales trends, best sellers, profit by product, and a full audit log of every change." },
  { badge: "Multi-branch", title: "One account, many shops", text: "Run several businesses and branches, switch between them in one tap, and compare them side by side." },
  { badge: "Team", title: "Roles for owners, managers and cashiers", text: "Invite staff by email. Cashiers ring up sales; managers handle stock and refunds; owners see everything." },
  { badge: "Works offline", title: "Keep selling when the internet drops", text: "Install ServeBiz on your phone like an app. Cash sales made offline are saved and synced when you reconnect." },
];

const steps = [
  { title: "Set up your business", text: "Create an account (or try the guest demo) and name your shop and first branch." },
  { title: "Receive your stock", text: "Record deliveries with cost, selling price and expiry dates, or import products from a CSV file." },
  { title: "Start selling", text: "Open the POS, tap products, charge the customer and hand over the receipt." },
  { title: "Review your sales", text: "Check the dashboard for trends, low stock and profit." },
];

const faqs = [
  { q: "What is ServeBiz?", a: "ServeBiz is an online point of sale (POS) and inventory management system for small businesses such as sari-sari stores, cafes and retail shops." },
  { q: "Can I try ServeBiz without signing up?", a: "Yes. Choose 'Try the guest demo' to explore a ready-made store with sample products and a month of sales. No email is needed." },
  { q: "Does ServeBiz work offline?", a: "Yes. Install it as an app on your phone or computer. Cash sales made while offline are saved on the device and sent automatically when you are back online." },
  { q: "Which payment methods are supported?", a: "Cash at the counter, plus card and GCash online payments through Stripe once you connect your own Stripe account." },
  { q: "Can I manage more than one branch?", a: "Yes. Add branches or separate businesses, switch between them, and compare branch income, orders and profit in one overview." },
  { q: "Can I track expiry dates?", a: "Yes. Every delivery is stored as a batch with its own expiry date, and the dashboard lists items that are expiring soon." },
  { q: "Who can see my sales and stock?", a: "Only people you invite. Owners, managers and cashiers each see only what their role allows, and changes are recorded in an audit log." },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME, description: SITE_DESCRIPTION, inLanguage: "en" },
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icons/icon-512.png` },
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android, iOS (installable web app)",
      description: SITE_DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "PHP" },
      featureList: features.map((f) => f.title),
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ],
};

export default function Landing() {
  return (
    <div className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header>
        <nav className="nav" aria-label="Main">
          <Link href="/" className="logo">
            <span className="logo-mark" aria-hidden="true" /> ServeBiz
          </Link>
          <Link href="/login" className="btn">Log in</Link>
        </nav>
      </header>

      <main>
        <section className="hero">
          <h1>POS and inventory system for small businesses.</h1>
          <p>
            Set up your shop in a minute, receive products, track stock and expiry dates, and start selling with cash, card or GCash.
          </p>
          <div className="hero-actions">
            <Link href="/login" className="btn btn-primary">Get started</Link>
            <Link href="/login?guest=1" className="btn">Try the guest demo</Link>
          </div>
        </section>

        <section aria-labelledby="features-h">
          <h2 id="features-h" className="seo-h2">Everything a small shop needs</h2>
          <div className="features">
            {features.map((f) => (
              <article className="card" key={f.title}>
                <span className="badge">{f.badge}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="how-h" className="seo-block">
          <h2 id="how-h" className="seo-h2">How it works</h2>
          <ol className="seo-steps">
            {steps.map((s) => (
              <li key={s.title}>
                <strong>{s.title}.</strong> {s.text}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="faq-h" className="seo-block">
          <h2 id="faq-h" className="seo-h2">Frequently asked questions</h2>
          {faqs.map((f) => (
            <details key={f.q} className="seo-faq">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
      </main>

      <footer className="seo-footer">
        <p>&copy; {new Date().getFullYear()} ServeBiz. POS and inventory for small businesses.</p>
        <nav aria-label="Footer">
          <Link href="/login">Log in</Link> · <Link href="/login?guest=1">Guest demo</Link>
        </nav>
      </footer>
    </div>
  );
}
