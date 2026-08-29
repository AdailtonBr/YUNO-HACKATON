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
import { runTurn } from "./llm.js";

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
  id: process.env.AGENT_ID ?? "agent_michael",
  secret: process.env.AGENT_SECRET ?? "demo-agent-secret-michael",
});

/**
 * Histórico de conversa, em memória e por conversa.
 *
 * É estado DO AGENTE, não do mandato — some quando o processo reinicia, e isso
 * não tem consequência nenhuma para a autorização.  Nada aqui autoriza nada:
 * o que autoriza vive no Mongo, escrito só pela Autoridade.
 */
const conversations = new Map();

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

  /**
   * A conversa (Fase 5).  O humano escreve em linguagem natural; o modelo busca,
   * pergunta o que falta, propõe, e — quando já existe mandato autorizado —
   * compra.  Toda decisão sobre validade continua na Autoridade.
   */
  r.post("/agent/chat", async (req, res) => {
    const { conversationId = "default", message, mandateId } = req.body ?? {};
    if (!message?.trim()) return res.status(400).json({ error: "empty_message" });

    // O agente lê o mandato pela porta pública, como qualquer cliente.
    let mandate = null;
    if (mandateId) {
      mandate = await fetch(`${authorityUrl()}/mandates/${mandateId}`)
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (mandate && mandate.status !== "active") mandate = null;
    }

    const agent = agentCredential();
    const history = conversations.get(conversationId) ?? [];

    try {
      const out = await runTurn({
        history,
        message,
        mandate,
        deps: {
          stores: knownStores(),
          agentId: agent.id,
          agentSecret: agent.secret,
          authorityUrl: authorityUrl(),
        },
      });
      conversations.set(conversationId, out.history.slice(-24)); // janela curta
      res.json({ conversationId, text: out.text, events: out.events });
    } catch (e) {
      const missingKey = e.message === "missing_openai_key";
      res.status(missingKey ? 503 : 502).json({
        error: missingKey ? "missing_openai_key" : "agent_unavailable",
        detail: e.message,
      });
    }
  });

  r.post("/agent/reset", (req, res) => {
    conversations.delete(req.body?.conversationId ?? "default");
    res.json({ ok: true });
  });

  return r;
}
