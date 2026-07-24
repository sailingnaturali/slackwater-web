import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  test: {
    // Only usePreferences.test.ts needs a DOM (localStorage); everything else
    // runs fine without one, so this is the cheapest environment that works.
    environment: "jsdom",
    // Session worktrees nest under .claude/worktrees/ — without this, vitest
    // collects THEIR test files too and a mid-rebase worktree fails the suite.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Slackwater — Offline Tides",
        short_name: "Slackwater",
        description:
          "Tide predictions for the Salish Sea, computed on your device. Works with no signal.",
        theme_color: "#0b1a2b",
        background_color: "#0b1a2b",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The station data and the engine are the whole product offline, so they
        // are precached rather than fetched on demand. woff2 is in here too —
        // the self-hosted fonts (see README: no webfont request, on purpose)
        // otherwise fail with ERR_INTERNET_DISCONNECTED the moment the network
        // actually goes away, which the offline smoke check caught.
        //
        // pmtiles is deliberately NOT globbed here: a precache entry is a plain
        // 200 with the full body and no Range support, but pmtiles reads the
        // archive with Range requests and needs 206 — once the SW controls the
        // page, that throws and the coastline never draws offline. It's served
        // instead by the runtimeCaching Range route below. The app's largest
        // precached chunk (MapScreen's ~1 MB JS) is well under the default 2 MB
        // cap, so no maximumFileSizeToCacheInBytes bump is needed now that the
        // 4.6 MB pmtiles file isn't in this list.
        globPatterns: ["**/*.{js,css,html,svg,png,json,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".pmtiles"),
            handler: "CacheFirst",
            options: {
              cacheName: "land-pmtiles",
              rangeRequests: true, // makes Workbox serve 206 partials from the cached full body — pmtiles needs this
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
