import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.fleetfeet.com",
      },
      {
        protocol: "https",
        hostname: "img.runningwarehouse.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "expntlathletics.com",
      }
    ],
  },
};

export default nextConfig;
