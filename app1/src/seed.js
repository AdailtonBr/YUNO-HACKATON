/**
 * Seed da demo.  Idempotente: pode rodar quantas vezes quiser.
 *
 * Cria a allow-list de merchants, um humano com seu agente, e um método de
 * pagamento tokenizado.  As credenciais são fixas SÓ para a demo — em qualquer
 * coisa real cada segredo seria gerado e guardado num cofre.
 */

import mongoose from "mongoose";
import crypto from "node:crypto";
import { Merchant, Agent } from "./authority/models.js";

export const DEMO = {
  humanId: "user_marina",
  agentId: "agent_marina",
  agentSecret: "demo-agent-secret-marina",
  merchants: [
    { _id: "store_a", name: "Store A", apiKey: "demo-key-store-a" },
    { _id: "store_b", name: "Store B", apiKey: "demo-key-store-b" },
  ],
};

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

export async function seed() {
  for (const m of DEMO.merchants) {
    await Merchant.updateOne(
      { _id: m._id },
      { $set: { name: m.name, apiKeyHash: sha256(m.apiKey), active: true } },
      { upsert: true }
    );
  }
  await Agent.updateOne(
    { _id: DEMO.agentId },
    { $set: { humanId: DEMO.humanId, hmacSecret: DEMO.agentSecret, active: true } },
    { upsert: true }
  );
  return DEMO;
}

// `node src/seed.js` roda direto; importado nos testes, só exporta.
if (process.argv[1]?.endsWith("seed.js")) {
  await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/mandato_agentico");
  await seed();
  console.log("seeded:", DEMO.merchants.map((m) => m._id).join(", "), "+", DEMO.agentId);
  await mongoose.disconnect();
}
