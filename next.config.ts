import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	serverExternalPackages: ["node-pty", "@xterm/headless"],
	typedRoutes: true,
	async headers() {
		return [
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
