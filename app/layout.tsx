import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DealDesk",
  description: "AI-run sell-side data room. Sourced answers, seller control, full audit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
