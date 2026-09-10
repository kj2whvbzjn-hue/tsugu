import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "継ぐ — 開発ワークスペース",
  description: "目的、議論、決定、作業、検証を次の開発へつなぐ。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
