import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { LeftRail } from "@/components/left-rail";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Strand — your professional network, your data",
  description:
    "Self-hostable web app that ingests your LinkedIn data export and lets you query your professional network.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="flex min-h-screen">
        <LeftRail />
        <main className="min-w-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
