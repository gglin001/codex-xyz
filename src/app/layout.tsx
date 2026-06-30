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
	icons: {
		icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
	},
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
