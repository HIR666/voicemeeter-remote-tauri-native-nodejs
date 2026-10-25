import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  // The release bundle deliberately omits this so it uses same-origin /ws.
  define: command === "serve" ? { "import.meta.env.VITE_VM_REMOTE_WS_URL": JSON.stringify("ws://127.0.0.1:5164/ws") } : {},
}));
