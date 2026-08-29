import express from "express";
import { buildRouter } from "./authority/routes.js";

/** App sem `listen`, para os testes montarem em porta efêmera. */
export function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(buildRouter());
  return app;
}
