import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

import { Footer } from "@/components/site/footer";
import { Navbar } from "@/components/site/navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NexusMed",
  description: "专为医疗 AI 研究者与临床医生打造的开源情报社区",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-[#F8FAFC] font-sans selection:bg-teal-200 selection:text-teal-900 antialiased`}
      >
        <Suspense
          fallback={<div className="sticky top-0 z-50 h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md" />}
        >
          <Navbar />
        </Suspense>
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
