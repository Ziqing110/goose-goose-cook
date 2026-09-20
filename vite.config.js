import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1, NOT localhost. On Windows, "localhost" resolves to
      // ::1 first and Node 18+ does not reliably fall back to IPv4 on a
      // proxied request — measured 3.6s to 13.4s for /api/kitchens
      // through the proxy, against milliseconds hitting :3001 directly.
      // The app fires its kitchen and session fetches on boot and renders
      // nothing until they land, so that delay shows up as a white screen
      // for ten seconds, which looks exactly like a crash.
      "/api": "http://127.0.0.1:3001",
      // Local speaker-identification sidecar (`npm run speaker`). Same
      // 127.0.0.1 reasoning as above.
      "/speaker": {
        target: "http://127.0.0.1:3103",
        rewrite: (path) => path.replace(/^\/speaker/, ""),
      },
    },
  },
});
