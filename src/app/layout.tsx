import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { LeftRail } from "@/components/left-rail";
import { CommandPalette } from "@/components/command-palette";
import { NavProgress } from "@/components/nav-progress";
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
        {/* useSearchParams inside NavProgress must be wrapped in Suspense
            so the rest of the layout can still SSR cleanly. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <LeftRail />
        <main className="min-w-0 flex-1">{children}</main>
        <CommandPalette />
      </body>
    </html>
  );
}
