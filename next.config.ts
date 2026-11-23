import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pg-boss"],
  experimental: {
    // Браузер помнит уже открытые страницы: повторный заход и «назад» — мгновенно (действия сбрасывают кэш через revalidatePath).
    staleTimes: { dynamic: 30, static: 180 },
    // Загрузка видео в медиатеку через server action.
    serverActions: { bodySizeLimit: "300mb" },
  },
};

export default nextConfig;
