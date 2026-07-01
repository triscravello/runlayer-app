import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.fleetfeet.com",
      },
    ],
  },
};

export default nextConfig;
