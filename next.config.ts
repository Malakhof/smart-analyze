import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["@prisma/adapter-pg", "pg", "bcryptjs"],
};

export default nextConfig;
