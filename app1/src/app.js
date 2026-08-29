import express from "express";
import { buildRouter } from "./authority/routes.js";
import { buildAgentRouter } from "./agent/routes.js";

/** App sem `listen`, para os testes montarem em porta efemera. */
export function buildApp() {
  const app = express();
  app.use(express.json());

  // CORS aberto: a UI roda em outra porta no dev. Escopo de demo.
  app.use((req, res, next) => {
    res.set("access-control-allow-origin", "*");
    res.set("access-control-allow-headers", "content-type, x-human-id, x-api-key, x-agent-id, x-agent-secret, accept-language");
    res.set("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Dois PAPEIS, um deploy. O agente fala com a Autoridade por HTTP, como
  // qualquer outro cliente -- ele nao alcanca o banco dela (ver docs/02).
  app.use(buildRouter());
  app.use(buildAgentRouter());
  return app;
}
