/**
 * Integração: Autoridade de ponta a ponta contra um Mongo em memória.
 * Cobre o que o motor puro não pode cobrar sozinho — replay, consumo atômico,
 * idempotência, compensação, e o ataque da loja registrada.
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { buildApp } from "../src/app.js";
import { seed, DEMO } from "../src/seed.js";
import { issueTicket, newNonce } from "../src/authority/ticket.js";
import { Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency, Proposal } from "../src/authority/models.js";

let mongod, server, base;

const url = (path) => `${base}${path}`;
const asHuman = { "content-type": "application/json", "x-human-id": DEMO.humanId };
const asStoreA = { "content-type": "application/json", "x-api-key": "demo-key-store-a" };

const post = (path, body, headers) =>
  fetch(url(path), { method: "POST", headers, body: JSON.stringify(body ?? {}) });
const get = (path, headers) => fetch(url(path), { headers });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("authority_test"));
  await new Promise((r) => {
    server = buildApp().listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      r();
    });
  });
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(
    [Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency, Proposal].map((m) => m.deleteMany({}))
  );
  await seed();
});

/* ----------------------------- helpers ----------------------------- */

const FUTURE = new Date("2026-12-31T23:59:59Z").toISOString();

/**
 * O meio de pagamento agora vem da carteira: o humano cadastra, e a Autoridade
 * traduz o `methodId` para o ponteiro do lado dela.  Os testes passam pelo
 * mesmo caminho, porque um teste que atalha o caminho nao testa o caminho.
 */
async function walletMethod(instrument = { number: "4242424242424242" }) {
  const r = await post("/wallet/methods", { rail: "card", instrument }, asHuman);
  return (await r.json()).methodId;
}

async function createMandate(over = {}) {
  const res = await post(
    "/mandates",
    {
      agentId: DEMO.agentId,
      mode: "autonomo",
      currency: "BRL",
      paymentMethodId: over.paymentMethodId ?? (await walletMethod()),
      maxUses: 1,
      expiresAt: FUTURE,
      constraints: [
        { attr: "category", op: "eq", value: "calcado", on_missing: "deny", on_fail: "deny" },
        { attr: "price", op: "lte", value: 10000, on_missing: "deny", on_fail: "deny" },
      ],
      ...over,
    },
    asHuman
  );
  assert.equal(res.status, 201);
  return res.json();
}

const PURCHASE = {
  productId: "TEN-001",
  price: 9800,
  currency: "BRL",
  attributes: { category: "calcado", price: 9800, size: "40", ship_country: "BR" },
};

/** O agente assina o bilhete com o SEU segredo — a loja não tem esse segredo. */
function agentTicket(mandateId, purchase = PURCHASE, over = {}) {
  return issueTicket(
    {
      agentId: DEMO.agentId,
      mandateId,
      merchantId: "store_a",
      productId: purchase.productId,
      price: purchase.price,
      currency: purchase.currency,
      ...over,
    },
    DEMO.agentSecret
  );
}

const buy = (mandateId, { purchase = PURCHASE, ticket, key } = {}) =>
  post(
    "/introspect",
    {
      mandateId,
      purchase,
      purchaseTicket: ticket ?? agentTicket(mandateId, purchase),
      idempotencyKey: key ?? newNonce(),
    },
    asStoreA
  ).then((r) => r.json());

/* ------------------------------ testes ----------------------------- */

test("fluxo feliz: cria mandato, agente compra, uso e consumido", async () => {
  const { mandateId, humanReadable } = await createMandate();
  assert.match(humanReadable, /at most/i); // frase derivada do MESMO JSON

  const r = await buy(mandateId);
  assert.equal(r.valid, true);
  assert.ok(r.receiptId);

  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 1);
});

test("o mandato NAO expoe o paymentMethodRef", async () => {
  const { mandateId } = await createMandate();
  const body = await get(`/mandates/${mandateId}`).then((r) => r.json());
  assert.equal(body.paymentMethodRef, undefined);
  assert.equal(body.status, "active");
});

test("maxUses ausente vira 1 — esquecer o limite bloqueia, nao libera", async () => {
  const { mandateId } = await createMandate({ maxUses: undefined });
  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.maxUses, 1);
});

test("idempotencia: mesma chave duas vezes = um recibo, um uso", async () => {
  const { mandateId } = await createMandate({ maxUses: 3 });
  const ticket = agentTicket(mandateId);
  const key = "k-1";

  const a = await buy(mandateId, { ticket, key });
  const b = await buy(mandateId, { ticket, key });

  assert.equal(a.valid, true);
  assert.deepEqual(a, b); // MESMA resposta gravada
  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 1); // consumiu uma vez so
});

test("replay: mesmo bilhete, chave nova, e recusado", async () => {
  const { mandateId } = await createMandate({ maxUses: 3 });
  const ticket = agentTicket(mandateId);

  assert.equal((await buy(mandateId, { ticket, key: "k-a" })).valid, true);
  const again = await buy(mandateId, { ticket, key: "k-b" });
  assert.equal(again.valid, false);
  assert.equal(again.reason.code, "ticket_replayed");
});

test("mandato esgotado: a segunda compra falha", async () => {
  const { mandateId } = await createMandate({ maxUses: 1 });
  assert.equal((await buy(mandateId)).valid, true);

  const second = await buy(mandateId);
  assert.equal(second.valid, false);
  assert.equal(second.reason.code, "uses_exhausted");
});

test("PROVA DE FOGO: revogacao ao vivo derruba a proxima compra", async () => {
  const { mandateId } = await createMandate({ maxUses: 5 });
  assert.equal((await buy(mandateId)).valid, true);

  const rev = await post(`/mandates/${mandateId}/revoke`, {}, asHuman);
  assert.equal(rev.status, 200);

  const after = await buy(mandateId);
  assert.equal(after.valid, false);
  assert.equal(after.reason.code, "revoked");
});

test("ATAQUE DA LOJA: loja registrada nao consegue cobrar sozinha", async () => {
  const { mandateId } = await createMandate();

  // A loja conhece mandateId e agentId de uma compra legitima, mas nao o segredo.
  const forged = issueTicket(
    { agentId: DEMO.agentId, mandateId, merchantId: "store_a", productId: "TEN-001", price: 9800, currency: "BRL" },
    "segredo-que-a-loja-inventou"
  );
  const r = await buy(mandateId, { ticket: forged });
  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "ticket_bad_signature");

  // E sem bilhete nenhum tambem nao passa.
  const semTicket = await post(
    "/introspect",
    { mandateId, purchase: PURCHASE, idempotencyKey: "k-x" },
    asStoreA
  ).then((r) => r.json());
  assert.equal(semTicket.valid, false);
  assert.equal(semTicket.reason.code, "unknown_agent");

  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 0); // ninguem foi cobrado
});

test("loja nao registrada nem fala com a Autoridade (anti-site-fake)", async () => {
  const { mandateId } = await createMandate();
  const res = await post(
    "/introspect",
    { mandateId, purchase: PURCHASE, purchaseTicket: agentTicket(mandateId), idempotencyKey: "k" },
    { "content-type": "application/json", "x-api-key": "chave-de-loja-falsa" }
  );
  assert.equal(res.status, 401);
});

test("bilhete da Loja A nao vale na Loja B", async () => {
  const { mandateId } = await createMandate();
  const ticketB = agentTicket(mandateId, PURCHASE, { merchantId: "store_b" });
  const r = await buy(mandateId, { ticket: ticketB }); // apresentado na Loja A
  assert.equal(r.reason.code, "ticket_merchant_mismatch");
});

test("loja inflando o preco dentro do teto e recusada", async () => {
  const { mandateId } = await createMandate();
  const ticket = agentTicket(mandateId); // agente pediu 9800
  const inflada = { ...PURCHASE, price: 9999, attributes: { ...PURCHASE.attributes, price: 9999 } };

  const r = await buy(mandateId, { purchase: inflada, ticket });
  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "ticket_price_mismatch");
});

test("agente impostor com mandato de outra pessoa e recusado", async () => {
  const { mandateId } = await createMandate();
  await Agent.create({ _id: "agent_mallory", humanId: "user_mallory", hmacSecret: "s-mallory", active: true });
  const ticket = issueTicket(
    { agentId: "agent_mallory", mandateId, merchantId: "store_a", productId: "TEN-001", price: 9800, currency: "BRL" },
    "s-mallory"
  );
  const r = await buy(mandateId, { ticket });
  assert.equal(r.reason.code, "agent_not_owner");
});

/* ---------------------- portao de aprovacao ------------------------ */

test("modo aprovacao: escala, humano aprova, retentativa passa", async () => {
  const { mandateId } = await createMandate({ mode: "aprovacao", maxUses: 2 });

  const first = await buy(mandateId);
  assert.equal(first.valid, false);
  assert.equal(first.action, "escalate");
  assert.ok(first.approvalRequestId);

  const pend = await get("/approvals", asHuman).then((r) => r.json());
  assert.equal(pend.length, 1);
  assert.equal(pend[0].price, 9800); // a compra exata, congelada

  const ok = await post(`/approvals/${first.approvalRequestId}/approve`, {}, asHuman);
  assert.equal(ok.status, 200);

  const second = await buy(mandateId); // bilhete e chave novos
  assert.equal(second.valid, true);
});

test("aprovacao nao e cheque em branco: outro produto volta a escalar", async () => {
  const { mandateId } = await createMandate({ mode: "aprovacao", maxUses: 5 });
  const first = await buy(mandateId);
  await post(`/approvals/${first.approvalRequestId}/approve`, {}, asHuman);

  const outro = { ...PURCHASE, productId: "TEN-999" };
  const r = await buy(mandateId, { purchase: outro });
  assert.equal(r.action, "escalate");
});

test("aprovacao e de uso unico", async () => {
  const { mandateId } = await createMandate({ mode: "aprovacao", maxUses: 5 });
  const first = await buy(mandateId);
  await post(`/approvals/${first.approvalRequestId}/approve`, {}, asHuman);

  assert.equal((await buy(mandateId)).valid, true);
  assert.equal((await buy(mandateId)).action, "escalate"); // o "sim" ja foi gasto
});

test("on_fail escalate cria pendencia com o motivo", async () => {
  const { mandateId } = await createMandate({
    constraints: [{ attr: "price", op: "lte", value: 10000, on_missing: "deny", on_fail: "escalate" }],
  });
  const cara = { ...PURCHASE, price: 10300, attributes: { ...PURCHASE.attributes, price: 10300 } };
  const r = await buy(mandateId, { purchase: cara });
  assert.equal(r.action, "escalate");

  const pend = await get("/approvals", asHuman).then((x) => x.json());
  assert.equal(pend[0].origin, "on_fail");
  assert.match(pend[0].reasonText, /fails lte/i);
});

test("RECUSAR DURA: a mesma compra nao volta a perguntar", async () => {
  const { mandateId } = await createMandate({ mode: "aprovacao", maxUses: 5 });

  const first = await buy(mandateId);
  assert.equal(first.action, "escalate");

  // O humano diz NAO.
  const rej = await post(`/approvals/${first.approvalRequestId}/reject`, {}, asHuman);
  assert.equal(rej.status, 200);

  // O agente (ou o vigia) tenta de novo: nao pode virar pendencia nova.
  const again = await buy(mandateId);
  assert.equal(again.valid, false);
  assert.equal(again.action, "reject");
  assert.equal(again.reason.code, "approval_refused");

  // E nao ficou nada esperando o humano.
  const pend = await get("/approvals", asHuman).then((r) => r.json());
  assert.equal(pend.length, 0);
});

test("mas outro PRECO e outra pergunta — recusar um valor nao recusa o produto", async () => {
  const { mandateId } = await createMandate({ mode: "aprovacao", maxUses: 5 });
  const first = await buy(mandateId);
  await post(`/approvals/${first.approvalRequestId}/reject`, {}, asHuman);

  // Mesmo produto, preco menor: e uma pergunta nova, e legitimo perguntar.
  const barato = { ...PURCHASE, price: 5000, attributes: { ...PURCHASE.attributes, price: 5000 } };
  const r = await buy(mandateId, { purchase: barato, ticket: agentTicket(mandateId, barato) });
  assert.equal(r.action, "escalate");
});

test("o vigia insistindo nao enche o trilho: uma escalada, uma linha", async () => {
  const { mandateId } = await createMandate({ mode: "aprovacao", maxUses: 5 });

  // Cinco tentativas da MESMA compra, como o vigia faz a cada tique.
  for (let i = 0; i < 5; i++) await buy(mandateId, { key: `t-${i}` });

  const escalados = await AuditLog.countDocuments({ mandateId, decision: "escalado" });
  assert.equal(escalados, 1, "so a escalada que criou a pendencia entra no trilho");

  // E continua havendo UMA pendencia esperando o humano.
  const pend = await get("/approvals", asHuman).then((r) => r.json());
  assert.equal(pend.length, 1);
});

test("o trilho devolve os eventos MAIS RECENTES primeiro", async () => {
  const { mandateId } = await createMandate({ maxUses: 5 });
  await buy(mandateId);

  const trail = await get(`/audit?mandateId=${mandateId}`, asHuman).then((r) => r.json());
  assert.ok(trail.length >= 3);
  // Mais novo no topo: e o que acabou de acontecer que importa achar primeiro.
  const ts = trail.map((e) => new Date(e.ts).getTime());
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a));
  assert.equal(trail[0].event, "payment_result");
});

/* ----------------- compensacao e concorrencia ---------------------- */

test("pagamento recusado COMPENSA o uso ja consumido", async () => {
  const declining = await walletMethod({ number: "4000000000000002", declineAll: true });
  const { mandateId } = await createMandate({ paymentMethodId: declining, maxUses: 1 });

  const r = await buy(mandateId);
  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "payment_declined");

  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 0); // devolvido: falha de pagamento nao queima uso
});

test("concorrencia: duas tentativas simultaneas em maxUses 1, so uma passa", async () => {
  const { mandateId } = await createMandate({ maxUses: 1 });
  const results = await Promise.all([
    buy(mandateId, { key: "c-1" }),
    buy(mandateId, { key: "c-2" }),
  ]);
  assert.equal(results.filter((r) => r.valid).length, 1);
  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 1);
});

/* --------------------- fronteiras de papel ------------------------- */

test("o humano so cria mandato para o PROPRIO agente", async () => {
  await Agent.create({ _id: "agent_outro", humanId: "user_outro", hmacSecret: "s", active: true });
  const res = await post(
    "/mandates",
    { agentId: "agent_outro", mode: "autonomo", currency: "BRL", paymentMethodId: await walletMethod(), expiresAt: FUTURE },
    asHuman
  );
  assert.equal(res.status, 403);
});

test("sem sessao de humano nao se cria nem se revoga mandato", async () => {
  const res = await post("/mandates", {}, { "content-type": "application/json" });
  assert.equal(res.status, 401);
});

test("o agente deposita PROPOSTA, nao mandato", async () => {
  const res = await post(
    "/proposals",
    { draft: { mode: "autonomo", currency: "BRL", maxUses: 1, constraints: [] }, rationale: "size varia no catalogo" },
    { "content-type": "application/json", "x-agent-id": DEMO.agentId, "x-agent-secret": DEMO.agentSecret }
  );
  assert.equal(res.status, 201);
  assert.equal(await Mandate.countDocuments({}), 0); // nenhum mandato foi criado
});

/* ----------------------------- carteira ---------------------------- */

test("a carteira nunca devolve o instrumento nem o ponteiro que a Autoridade cobra", async () => {
  const created = await post(
    "/wallet/methods",
    { rail: "card", instrument: { number: "4242424242424242", exp: "12/29" } },
    asHuman
  ).then((r) => r.json());

  // Sai o methodId e um rotulo; NAO sai a ref nem o numero.
  assert.ok(created.methodId);
  assert.equal(created.label, "•••• 4242");
  assert.equal(created.paymentMethodRef, undefined);
  assert.equal(created.instrument, undefined);

  const list = await get("/wallet/methods", asHuman).then((r) => r.json());
  const raw = JSON.stringify(list);
  assert.ok(!raw.includes("4242424242424242"), "o numero cru vazou na listagem");
  assert.ok(!raw.includes("pm_card_"), "o paymentMethodRef vazou na listagem");
});

test("a carteira nunca devolve a rua do endereco", async () => {
  const created = await post(
    "/wallet/addresses",
    { label: "Home", address: "Rua das Flores, 123 — Sao Paulo" },
    asHuman
  ).then((r) => r.json());
  assert.ok(created.addressId);

  const list = await get("/wallet/addresses", asHuman).then((r) => r.json());
  assert.equal(list[0].label, "Home");
  assert.ok(!JSON.stringify(list).includes("Rua das Flores"), "o endereco cru vazou");
});

test("methodId de OUTRA pessoa nao cria mandato", async () => {
  const outro = await post(
    "/wallet/methods",
    { rail: "card", instrument: { number: "4111111111111111" } },
    { "content-type": "application/json", "x-human-id": "user_outro" }
  ).then((r) => r.json());

  const res = await post(
    "/mandates",
    {
      agentId: DEMO.agentId,
      mode: "autonomo",
      currency: "BRL",
      paymentMethodId: outro.methodId, // nao e dele
      maxUses: 1,
      expiresAt: FUTURE,
      constraints: [],
    },
    asHuman
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "unknown_payment_method");
});

test("sem meio de pagamento nao ha mandato", async () => {
  const res = await post(
    "/mandates",
    { agentId: DEMO.agentId, mode: "autonomo", currency: "BRL", maxUses: 1, expiresAt: FUTURE, constraints: [] },
    asHuman
  );
  assert.equal(res.status, 400);
});

test("endereco escolhido fica no mandato — e o mandato guarda o ID, nao a rua", async () => {
  const addr = await post("/wallet/addresses", { label: "Home", address: "Rua X, 1" }, asHuman).then((r) => r.json());
  const { mandateId } = await createMandate({ shippingAddressId: addr.addressId });

  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.shippingAddressId, addr.addressId);
  assert.ok(!JSON.stringify(m).includes("Rua X"), "a rua acabou no mandato");
});

/* ------------------------- trilho auditavel ------------------------ */

test("o trilho registra o ciclo de vida, nao so a compra", async () => {
  const { mandateId } = await createMandate({ maxUses: 5 });
  await buy(mandateId);
  await post(`/mandates/${mandateId}/revoke`, {}, asHuman);
  await buy(mandateId);

  const trail = await get(`/audit?mandateId=${mandateId}`).then((r) => r.json());
  const events = trail.map((e) => e.event);
  assert.ok(events.includes("mandate_created"));
  assert.ok(events.includes("purchase_decision"));
  assert.ok(events.includes("payment_result"));
  assert.ok(events.includes("mandate_revoked"));

  const recusada = trail.find((e) => e.decision === "recusado");
  assert.match(recusada.reasonText, /revoked/i);
});
