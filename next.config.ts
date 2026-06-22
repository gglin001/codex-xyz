import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	serverExternalPackages: ["node-pty", "@xterm/headless"],
	typedRoutes: true,
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
