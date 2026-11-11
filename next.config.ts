import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pg-boss"],
  experimental: {
    // Загрузка видео в медиатеку через server action.
    serverActions: { bodySizeLimit: "300mb" },
  },
};

export default nextConfig;
