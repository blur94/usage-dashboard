// Temporal polyfill is imported once here so business logic can rely on it
// being available app-wide (NFR-1). All date arithmetic uses Temporal.
import "@js-temporal/polyfill";
import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Claude Code Token Usage",
  description: "Local dashboard for Claude Code token consumption.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full antialiased font-sans", manrope.variable)}
    >
      <body className="min-h-full">
        <NuqsAdapter>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </NuqsAdapter>
      </body>
    </html>
  );
}
