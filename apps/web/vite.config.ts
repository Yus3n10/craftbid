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

  /**
   * The deployed API. Not a secret: it is compiled into the bundle and visible
   * in every request a visitor makes, which is why it lives here rather than
   * in a committed .env file. A local .env may still override it, and so may
   * VITE_API_URL in the build environment.
   */
  const DEPLOYED_API = "https://craftbid-api.onrender.com";

  /**
   * The desktop build ignores a local .env on purpose. It is the one build
   * nobody can correct after the fact: an installed app that calls
   * localhost:4000 finds nothing, and the developer machine that built it has
   * a dev .env saying exactly that. Only VITE_API_URL set in the build
   * environment overrides the deployed address.
   */
  const upstreamApi =
    mode === "desktop"
      ? (process.env.VITE_API_URL ?? DEPLOYED_API)
      : (env.VITE_API_URL ?? (mode === "development" ? "http://localhost:4000" : DEPLOYED_API));

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

  /**
   * The desktop build carries bearer tokens. It is served from
   * tauri://localhost with no site Worker in front, so there is no first-party
   * origin for a cookie to belong to. Decided by the build mode rather than by
   * a file, so a release cannot be built without it by accident.
   */
  const authMode = mode === "desktop" ? "bearer" : (env.VITE_AUTH_MODE ?? "cookie");

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
          // Real files and Cloudflare's own endpoints are not app routes. The
          // fallback used to answer every navigation with the app shell, so
          // opening /robots.txt on a device that had visited the site showed
          // the app's not-found page instead of the file, and /cdn-cgi/trace
          // could not be used to diagnose a network problem (section 23).
          navigateFallbackDenylist: [
            /^\/api/,
            /^\/cdn-cgi\//,
            /^\/robots\.txt$/,
            /^\/sitemap\.xml$/,
            /^\/llms\.txt$/,
            /^\/favicon\.ico$/,
          ],
          // The app shell plus the Latin font files, so a repeat visit needs no
          // network for type. Other subsets load on demand by unicode-range.
          globPatterns: ["**/*.{js,css,html,svg,png}", "**/*-latin-{opsz,wght}-normal-*.woff2"],
        },
      }),
    ],
    envDir: repoRoot,
    define: {
      __API_URL__: JSON.stringify(apiUrl),
      __BEARER_MODE__: JSON.stringify(authMode === "bearer"),
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
          sourcemapExcludeSources: true,
          /**
           * React, the router and the query client in a chunk of their own.
           *
           * These three change when they are upgraded and not otherwise, so
           * split out they stay in the browser cache across deploys.
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
