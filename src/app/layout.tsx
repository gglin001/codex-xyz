import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex XYZ",
  description: "Local-first Codex control plane",
  applicationName: "Codex XYZ",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Codex XYZ"
  },
  icons: {
    icon: "/icons/icon.svg",
    shortcut: "/icons/icon.svg",
    apple: "/icons/icon.svg"
  },
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f1011" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5f6" }
  ]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
