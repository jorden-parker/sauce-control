import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// oxlint-disable-next-line one-var -- next/font requires one loader per const
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});
// oxlint-disable-next-line one-var -- next/font requires one loader per const
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  description: "Compare a branch against its base, side by side.",
  title: "Sauce Control",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
