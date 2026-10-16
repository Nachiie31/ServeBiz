import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ServeBiz: POS and Inventory",
  description: "Manage your inventory and sell with a simple online point of sale.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
