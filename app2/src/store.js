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
import { panelHtml } from "./panel.js";

export function buildStore({ id, name, apiKey, catalog, toCommon, setPrice, setAvailable, isAvailable, authorityUrl }) {
  const app = express();
  app.use(express.json());

  // Trilho da loja: "o merchant vê sua verificação" (resultado esperado nº4).
  const verifications = [];

  // O catalogo publico so mostra o que a loja de fato tem: loja nao anuncia o
  // que esta fora de estoque -- e tirar de estoque e uma das duas alavancas do
  // painel do operador.
  const avail = (p) => (isAvailable ? isAvailable(p) : true);
  const common = () => catalog.filter(avail).map(toCommon);

  // Inclui o indisponivel: e o que o painel precisa ver para poder repor.
  const commonAll = () => catalog.map((p) => ({ ...toCommon(p), available: avail(p) }));
  const findRaw = (productId) => catalog.find((p) => toCommon(p).productId === productId);

  app.get("/health", (_req, res) => res.json({ ok: true, store: id, name }));

  // Busca literal, de proposito: a loja casa strings, ela nao adivinha intencao.
  // Quem faz o casamento semantico ("tenis de corrida" -> "Runner Shoe") e o
  // agente, do outro lado, olhando o catalogo inteiro. E seguro porque descoberta
  // nao e o caminho do dinheiro -- ali quem decide e o motor deterministico.
  const norm = (s) =>
    String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

  app.get("/catalog", (req, res) => {
    const tokens = norm(req.query.q).split(/\s+/).filter(Boolean);
    const items = common().filter((p) => {
      if (tokens.length === 0) return true; // sem termo -> catalogo inteiro
      const hay = norm([p.name, p.category, p.brand, p.color, p.ship_country].join(" "));
      return tokens.some((tk) => hay.includes(tk));
    });
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

  /* ----------------------- painel do operador ----------------------- */
  /*
   * A escrita passa pelo ADAPTADOR (`setPrice`/`setAvailable`), que traduz do
   * vocabulario comum de volta para o formato interno desta loja.  O painel
   * fala em centavos e nao sabe nada de `preco_reais` nem de `amount_cents`:
   * o adaptador e a fronteira nos dois sentidos, nao so na leitura.
   *
   * Mutacao em memoria -- reiniciar restaura o catalogo.  E mock, e assumido.
   */
  app.get("/products", (_req, res) => res.json({ merchantId: id, name, items: commonAll() }));

  app.patch("/catalog/:productId", (req, res) => {
    const raw = findRaw(req.params.productId);
    if (!raw) return res.status(404).json({ error: "unknown_product" });

    const { price, available } = req.body ?? {};
    if (price != null) {
      const cents = Math.round(Number(price));
      if (!Number.isFinite(cents) || cents < 0) return res.status(400).json({ error: "invalid_price" });
      setPrice(raw, cents);
    }
    if (available != null) setAvailable(raw, !!available);

    res.json({ ok: true, product: { ...toCommon(raw), available: avail(raw) } });
  });

  app.get("/", (_req, res) => res.type("html").send(panelHtml(id, name)));

  return app;
}
