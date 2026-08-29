/**
 * API do AGENTE para a UI do humano.  Não confundir com as rotas da Autoridade:
 * este router não escreve estado de mandato nem decide verificação — ele busca,
 * compara e tenta comprar, e repassa o que a Autoridade respondeu.
 *
 * As lojas que o agente conhece são as REGISTRADAS.  A loja fora da allow-list
 * fica aqui de propósito, atrás de uma flag, para a demo do anti-site-fake:
 * o agente até tenta, e a Autoridade recusa na porta.
 */

import express from "express";
import { searchCatalogs, compare, attemptPurchase } from "./agent.js";

// Lidos a cada chamada, não na carga do módulo: os testes sobem tudo em portas
// efêmeras, e config lida cedo demais congela endereços que ainda não existem.
const authorityUrl = () => process.env.AUTHORITY_SELF_URL ?? "http://127.0.0.1:3001";

const knownStores = () => [
  { id: "store_a", url: process.env.STORE_A_URL ?? "http://127.0.0.1:4001" },
  { id: "store_b", url: process.env.STORE_B_URL ?? "http://127.0.0.1:4002" },
];
const unregisteredStore = () => ({ id: "store_fake", url: process.env.STORE_FAKE_URL ?? "http://127.0.0.1:4003" });

// O agente guarda o PRÓPRIO segredo.  Ele não tem, e não precisa ter, acesso ao
// banco da Autoridade — tudo o que sabe do mandato vem da rota pública de leitura.
const agentCredential = () => ({
  id: process.env.AGENT_ID ?? "agent_marina",
  secret: process.env.AGENT_SECRET ?? "demo-agent-secret-marina",
});

export function buildAgentRouter() {
  const r = express.Router();

  const storesFor = (includeFake) => (includeFake ? [...knownStores(), unregisteredStore()] : knownStores());

  r.get("/agent/catalogs", async (req, res) => {
    const items = await searchCatalogs(storesFor(req.query.includeUnregistered === "true"), req.query.q ?? "");
    res.json({ items });
  });

  /**
   * Um ciclo do agente: lê o mandato (pela porta pública), busca, compara,
   * escolhe e tenta.  Devolve a comparação junto com o resultado — "por que
   * este e não aquele?" é pergunta que o humano tem direito de fazer.
   */
  r.post("/agent/shop", async (req, res) => {
    const { mandateId, query = "", strategy = "best", includeUnregistered = false } = req.body ?? {};
    if (!mandateId) return res.status(400).json({ error: "missing_mandateId" });

    // Leitura pela MESMA porta pública que qualquer um usa.  Não expõe o
    // paymentMethodRef, e o agente não teria como alcançá-lo de outro jeito.
    const mandate = await fetch(`${authorityUrl()}/mandates/${mandateId}`).then((x) => (x.ok ? x.json() : null));
    if (!mandate) return res.status(404).json({ error: "unknown_mandate" });

    const items = await searchCatalogs(storesFor(includeUnregistered), query);
    const { comparison, chosen } = compare(items, mandate, strategy);

    if (!chosen) {
      return res.json({ mandate, comparison, chosen: null, result: null, note: "no_option_fits" });
    }

    const agent = agentCredential();
    const result = await attemptPurchase({
      mandateId,
      item: chosen,
      agentId: agent.id,
      agentSecret: agent.secret,
    });

    res.json({ mandate, comparison, chosen, result });
  });

  return r;
}
