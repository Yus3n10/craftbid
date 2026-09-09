import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  // One .env at the repo root serves every package, so point Vite at it
  // instead of keeping a second copy here.
  const env = loadEnv(mode, repoRoot, "VITE_");

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg"],
        manifest: {
          name: "Craftbid",
          short_name: "Craftbid",
          description: "Commission handmade work from Filipino artists.",
          theme_color: "#1F3A4D",
          background_color: "#F7F4EE",
          display: "standalone",
          start_url: "/",
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // Never cache API responses: a marketplace showing yesterday's
          // postings and bids is worse than one that waits for the network.
          navigateFallbackDenylist: [/^\/api/],
        },
      }),
    ],
    envDir: repoRoot,
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL ?? "http://localhost:4000"),
    },
    server: { port: 5173 },
    build: { outDir: "dist", sourcemap: true },
  };
});
