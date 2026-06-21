import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "codex-xyz",
  description: "codex-xyz-first Codex control plane",
  applicationName: "codex-xyz",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "codex-xyz"
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
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f1011" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5f6" }
  ]
};

const themeBootScript = `
(() => {
  try {
    const mode = window.localStorage.getItem("codex-xyz-theme-mode");
    document.documentElement.dataset.theme = mode === "day" ? "day" : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {children}
      </body>
    </html>
  );
}
