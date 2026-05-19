import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
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
      <body>
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-6xl items-center px-6 py-3">
            <Link
              href="/"
              className="text-base font-semibold tracking-tight text-foreground transition-colors hover:text-accent"
              aria-label="Strand — home"
            >
              Strand
            </Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
