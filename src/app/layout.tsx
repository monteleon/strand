import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
