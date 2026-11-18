import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Internal Wiki AI Search",
  description:
    "Enterprise wiki search with RBAC (per-page access tags), source provenance, 'I don't have that in the wiki' safe-mode fallback, and an admin dashboard. Hybrid retrieval (BM25 + vector + RRF), streaming chat with inline citations grounded only in chunks the current user is allowed to see.",
  keywords: [
    "RAG",
    "enterprise wiki",
    "RBAC",
    "access control",
    "Confluence search",
    "internal knowledge base",
    "Next.js",
    "Prisma",
  ],
  authors: [{ name: "Internal Wiki AI Search" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
