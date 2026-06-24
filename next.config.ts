import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	serverExternalPackages: ["node-pty", "@xterm/headless"],
	typedRoutes: true,
	async headers() {
		return [
			{
				source: "/sw.js",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=0, must-revalidate",
					},
					{
						key: "Service-Worker-Allowed",
						value: "/",
					},
				],
			},
			{
				source: "/manifest.webmanifest",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=3600, must-revalidate",
					},
					{
						key: "Content-Type",
						value: "application/manifest+json",
					},
				],
			},
			{
				source: "/offline.html",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=0, must-revalidate",
					},
				],
			},
			{
				source: "/icons/:path*",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=86400",
					},
				],
			},
		];
	},
	outputFileTracingExcludes: {
		"/*": [
			".coz/**",
			"debug_agent/**",
			"dist/**",
			"dot.home/**",
			"third_party/**",
			"tsconfig.tsbuildinfo",
		],
	},
};

export default nextConfig;
