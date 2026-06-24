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
	},
	appleWebApp: {
		capable: true,
		statusBarStyle: "black-translucent",
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
	viewportFit: "cover",
	interactiveWidget: "resizes-content",
	themeColor: [
		{ media: "(prefers-color-scheme: dark)", color: "#0f1011" },
		{ media: "(prefers-color-scheme: light)", color: "#f3f5f6" },
	],
};

const themeBootScript = `
(() => {
  try {
    const mode = window.localStorage.getItem("coz-theme-mode");
    document.documentElement.dataset.theme = mode === "day" ? "day" : "dark";
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
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Inline boot script applies the stored theme before React hydrates. */}
				<script
					suppressHydrationWarning
					dangerouslySetInnerHTML={{ __html: themeBootScript }}
				/>
				{children}
			</body>
		</html>
	);
}
