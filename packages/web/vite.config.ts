// SPDX-License-Identifier: MIT
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "IEEE camera-ready checker",
        short_name: "ieee-check",
        description:
          "Offline validation of IEEE camera-ready papers. Files never leave your browser.",
        display: "standalone",
        background_color: "#f6f7fb",
        theme_color: "#0b3d91",
        icons: [],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallbackDenylist: [/^\/admin\.html$/],
      },
    }),
  ],
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: "index.html",
        admin: "admin.html",
      },
    },
  },
});
