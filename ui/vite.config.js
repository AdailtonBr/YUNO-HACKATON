import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxy = (target) => ({ target, changeOrigin: true, rewrite: (p) => p.replace(/^\/[^/]+/, "") });

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // A UI fala com a Autoridade e com as lojas por caminhos distintos, de
      // proposito: fica visivel na aba de rede quem esta sendo consultado.
      "/api": proxy("http://127.0.0.1:3001"),
      "/store-a": proxy("http://127.0.0.1:4001"),
      "/store-b": proxy("http://127.0.0.1:4002"),
    },
  },
});
