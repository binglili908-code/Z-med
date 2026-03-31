import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-[#F8FAFC] font-sans selection:bg-teal-200 selection:text-teal-900 antialiased`}
      >
        <Navbar />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
