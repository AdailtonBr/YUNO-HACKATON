/**
 * Uma loja (merchant).  Ver `docs/02` e `docs/03`.
 *
 * O que a loja FAZ:
 *  - descreve os próprios produtos no vocabulário comum (adaptador);
 *  - monta os atributos REAIS da compra a partir do produto real;
 *  - repassa o bilhete do agente INTACTO e chama a Autoridade.
 *
 * O que a loja NÃO faz:
 *  - não conhece as constraints do cliente;
 *  - não julga a compra — ela recebe `valid`/`reject`/`escalate` e obedece;
 *  - **não afirma quem é o agente**: ela transporta a prova, não a produz.
 *    É a diferença que impede uma loja registrada de cobrar sozinha (D16).
 */

import express from "express";

export function buildStore({ id, name, apiKey, catalog, toCommon, authorityUrl }) {
  const app = express();
  app.use(express.json());

  // Trilho da loja: "o merchant vê sua verificação" (resultado esperado nº4).
  const verifications = [];

  const common = () => catalog.map(toCommon);

  app.get("/health", (_req, res) => res.json({ ok: true, store: id, name }));

  app.get("/catalog", (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const items = common().filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)
    );
    res.json({ merchantId: id, name, items });
  });

  app.post("/buy", async (req, res) => {
    const { productId, mandateId, purchaseTicket, idempotencyKey } = req.body ?? {};
    const product = common().find((p) => p.productId === productId);
    if (!product) return res.status(404).json({ ok: false, reason: "unknown_product" });

    // Os atributos vêm do PRODUTO REAL, montados pela loja — nunca do agente.
    // É o que fecha o confused deputy: o agente não consegue mentir preço nem
    // categoria para caber no mandato.
    const { productId: _pid, name: _n, price, currency, ...attributes } = product;
    const purchase = { productId, price, currency, attributes: { ...attributes, price } };

    let result;
    try {
      const r = await fetch(`${authorityUrl}/introspect`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        // O bilhete atravessa daqui para a Autoridade sem ser tocado.
        body: JSON.stringify({ mandateId, purchase, purchaseTicket, idempotencyKey }),
      });
      if (r.status === 401) {
        // Loja fora da allow-list: a Autoridade não fala com ela (anti-site-fake).
        result = { valid: false, action: "reject", reasonText: "This store is not registered with the Authority." };
      } else {
        result = await r.json();
      }
    } catch (e) {
      result = { valid: false, action: "reject", reasonText: `Authority unreachable: ${e.message}` };
    }

    verifications.unshift({
      ts: new Date().toISOString(),
      mandateId,
      productId,
      price,
      currency,
      decision: result.valid ? "valido" : result.action === "escalate" ? "escalado" : "recusado",
      reasonText: result.reasonText ?? null,
      receiptId: result.receiptId ?? null,
    });

    // A loja repassa o veredito da Autoridade inteiro, inclusive o detalhe por
    // regra.  Ela nao interpreta nem resume: nao e dela a decisao.
    if (result.valid) {
      return res.json({ ok: true, receiptId: result.receiptId, price, currency, trace: result.trace ?? [] });
    }
    res.json({
      ok: false,
      action: result.action ?? "reject",
      reasonText: result.reasonText,
      reason: result.reason ?? null,
      trace: result.trace ?? [],
      approvalRequestId: result.approvalRequestId ?? null,
    });
  });

  app.get("/verifications", (_req, res) => res.json({ merchantId: id, name, verifications: verifications.slice(0, 50) }));

  return app;
}
