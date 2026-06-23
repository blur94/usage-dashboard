import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon; keep it external so it is required at
  // runtime from node_modules rather than bundled by Turbopack/webpack.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
