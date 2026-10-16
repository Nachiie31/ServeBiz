import Link from "next/link";

const features = [
  {
    badge: "Inventory",
    title: "Receive stock, track every batch",
    text: "Log deliveries with supplier, expiry date, quantity, and base price. Totals are computed from batches, so counts stay accurate.",
  },
  {
    badge: "Point of sale",
    title: "Sell fast, deduct automatically",
    text: "Search or scan products, check out, and let the system take stock from the earliest-expiring batch first.",
  },
  {
    badge: "Insights",
    title: "Know what to reorder",
    text: "Low-stock and near-expiry alerts, sales history, and profit by product (coming in later phases).",
  },
];

export default function Landing() {
  return (
    <div className="container">
      <nav className="nav">
        <Link href="/" className="logo">
          <span className="logo-mark" /> ServeBiz
        </Link>
        <Link href="/login" className="btn">Log in</Link>
      </nav>

      <section className="hero">
        <h1>Inventory and point of sale for small businesses.</h1>
        <p>
          Set up your business in a minute, receive products, manage stock accurately, and start selling.
        </p>
        <div className="hero-actions">
          <Link href="/login" className="btn btn-primary">Get started</Link>
          <Link href="/login?guest=1" className="btn">Try the guest demo</Link>
        </div>
      </section>

      <section className="features">
        {features.map((f) => (
          <div className="card" key={f.title}>
            <span className="badge">{f.badge}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
