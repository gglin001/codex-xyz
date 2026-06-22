import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	serverExternalPackages: ["node-pty", "@xterm/headless"],
	typedRoutes: true,
	outputFileTracingExcludes: {
		"/*": [
			".codex-xyz/**",
			"debug_agent/**",
			"dist/**",
			"dot.home/**",
			"third_party/**",
			"tsconfig.tsbuildinfo",
		],
	},
};

export default nextConfig;
