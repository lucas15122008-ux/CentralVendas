import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Central de Vendas",
  description: "Vendas, custos e margem por produto. Organize suas contas e importe custos e impostos do Citel.",
  other: {
    "codex-preview": "development",
  },
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
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
