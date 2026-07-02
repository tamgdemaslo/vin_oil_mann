import path from "path";
import type { NextConfig } from "next";

// Use __dirname so root is always where next.config lives (project root), not cwd
const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  serverExternalPackages: ["telegram"],
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      tailwindcss: path.join(projectRoot, "node_modules", "tailwindcss"),
    },
  },
  webpack: (config) => {
    const nodeModules = path.join(projectRoot, "node_modules");
    config.context = projectRoot;
    config.resolve = config.resolve ?? {};
    config.resolve.modules = [
      nodeModules,
      ...(Array.isArray(config.resolve.modules) ? config.resolve.modules : []),
    ];
    config.resolve.alias = {
      ...config.resolve.alias,
      tailwindcss: path.join(nodeModules, "tailwindcss"),
    };
    return config;
  },
};

export default nextConfig;
