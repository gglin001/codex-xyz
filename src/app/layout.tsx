import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: {
		default: "codex-xyz",
		template: "%s | codex-xyz",
	},
	description: "Codex control plane for managing active threads.",
	applicationName: "codex-xyz",
	creator: "coz",
	formatDetection: {
		address: false,
		email: false,
		telephone: false,
	},
	other: {
		"apple-mobile-web-app-capable": "yes",
		"msapplication-navbutton-color": "#161718",
	},
	appleWebApp: {
		capable: true,
		statusBarStyle: "black",
		title: "codex-xyz",
	},
	icons: {
		icon: [
			{ url: "/icons/icon.svg", type: "image/svg+xml" },
			{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
			{ url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
		],
		shortcut: "/icons/icon-192.png",
		apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
	},
	manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 1,
	interactiveWidget: "resizes-content",
	colorScheme: "dark light",
	themeColor: [
		{ media: "(prefers-color-scheme: dark)", color: "#161718" },
		{ media: "(prefers-color-scheme: light)", color: "#e8e9e6" },
	],
};

const themeBootScript = `
(() => {
  try {
    const mode = window.localStorage.getItem("coz-theme-mode") === "day" ? "day" : "dark";
    const chromeColor = mode === "day" ? "#e8e9e6" : "#161718";
    document.documentElement.dataset.theme = mode;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", chromeColor);
    }
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" data-theme="dark" suppressHydrationWarning>
			<body data-app-shell="coz">
				<script suppressHydrationWarning>{themeBootScript}</script>
				{children}
			</body>
		</html>
	);
}
