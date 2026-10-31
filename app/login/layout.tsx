import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log in or create an account",
  description: "Log in to ServeBiz, create a free account, or try the guest demo with sample products and sales.",
  alternates: { canonical: "/login" },
  openGraph: { url: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
