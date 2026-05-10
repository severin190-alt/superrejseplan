import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Super Rejseplan",
  description: "Intelligent pendlings-dashboard med PFM",
  manifest: "/manifest.json"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
