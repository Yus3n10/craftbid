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
  const upstreamApi = env.VITE_API_URL ?? "http://localhost:4000";

  /**
   * Where the browser sends API calls.
   *
   * The production web build always uses /api on its own origin, which the
   * site's Worker forwards to the API (worker/api-proxy.ts). That is what makes
   * the session cookies first-party. Called cross-site, they were third-party
   * cookies, and every iPhone browser refuses those, so signing in there
   * produced a session the browser never kept. VITE_API_URL is deliberately
   * not consulted for this build: pointed back at the API's own host, it would
   * quietly reintroduce exactly that failure.
   *
   * The desktop build still calls the API directly. It is served from
   * tauri://localhost with no Worker in front, and it carries bearer tokens
   * rather than cookies, so there is nothing for a browser to refuse.
   * Development calls the local API directly; localhost to localhost is
   * same-site, so its cookies were never third-party.
   */
  const apiUrl = mode === "production" ? "/api" : upstreamApi;

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
      __API_URL__: JSON.stringify(apiUrl),
    },
    server: { port: 5173 },
    // `vite preview` stands in for the Worker locally: it serves the
    // production build, which calls /api, so /api has to go somewhere.
    preview: {
      proxy: {
        "/api": {
          target: upstreamApi,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "") || "/",
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      rollupOptions: {
        output: {
          /**
           * React, the router and the query client in a chunk of their own.
           *
           * They were part of the entry chunk, which meant every deploy gave
           * the entry a new hash and made a returning reader download all of
           * it again -- roughly 170KB gzipped, of which the ~50KB that is
           * actually this application is the only part that changed. These
           * three change when they are upgraded and not otherwise, so split
           * out they stay in the browser cache across deploys.
           *
           * They belong together rather than in three chunks because they are
           * always all needed: nothing renders without React, and every screen
           * is inside the router. Three requests to fetch one dependency graph
           * would cost more on a high-latency connection than it saves.
           */
          manualChunks: (id) =>
            /node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom|@tanstack)[\/]/.test(
              id,
            )
              ? "vendor"
              : undefined,
        },
      },
    },
  };
});
