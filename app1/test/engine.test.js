/**
 * Testes do motor.  Puros: sem banco, sem rede — o motor é uma função pura.
 * É o que a banca vai estressar (ver `docs/07-build-plan.md`, Fase 1).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, mandateStatus } from "../src/authority/engine.js";

const NOW = new Date("2026-08-29T12:00:00Z");
const LATER = new Date("2026-09-30T00:00:00Z");

const mandate = (over = {}) => ({
  _id: "mnd_1",
  humanId: "user_1",
  agentId: "agent_1",
  mode: "autonomo",
  currency: "BRL",
  constraints: [
    { attr: "category", op: "eq", value: "calcado", on_missing: "deny", on_fail: "deny" },
    { attr: "price", op: "lte", value: 10000, on_missing: "deny", on_fail: "deny" },
  ],
  paymentMethodRef: "pm_card_x",
  maxUses: 1,
  usedCount: 0,
  expiresAt: LATER,
  revoked: false,
  ...over,
});

const purchase = (over = {}) => ({
  productId: "TEN-001",
  price: 9800,
  currency: "BRL",
  attributes: { category: "calcado", price: 9800, size: "40", ship_country: "BR" },
  ...over,
});

const ticketFor = (m, p, over = {}) => ({
  agentId: m.agentId,
  mandateId: m._id,
  merchantId: "store_a",
  productId: p.productId,
  price: p.price,
  currency: p.currency,
  nonce: "n1",
  iat: 0,
  exp: 9e9,
  ...over,
});

const ctx = (m, p, over = {}) => ({
  ticket: ticketFor(m, p),
  authenticatedMerchantId: "store_a",
  approval: null,
  now: NOW,
  ...over,
});

const code = (r) => r.reason?.code;

/* ------------------------------ feliz ------------------------------ */

test("compra dentro do mandato passa", () => {
  const m = mandate(), p = purchase();
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.valid, true);
  assert.deepEqual(r.trace.map((t) => t.verdict), ["ok", "ok"]);
});

test("o trace explica regra a regra, e nao mente sobre o que nao olhou", () => {
  // Tres regras; a segunda viola. A terceira NAO foi avaliada — dizer "ok"
  // sobre ela seria inventar. E o que a tela "regra que decidiu" mostra.
  const m = mandate({
    constraints: [
      { attr: "category", op: "eq", value: "calcado", on_missing: "deny", on_fail: "deny" },
      { attr: "price", op: "lte", value: 5000, on_missing: "deny", on_fail: "deny" },
      { attr: "size", op: "eq", value: "40", on_missing: "deny", on_fail: "deny" },
    ],
  });
  const p = purchase();
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.action, "reject");
  assert.deepEqual(r.trace.map((t) => t.verdict), ["ok", "violated", "not_evaluated"]);
  assert.equal(r.trace[1].actual, 9800);
  assert.equal(r.trace[1].value, 5000);
});

/* --------------------------- estado vivo --------------------------- */

test("mandato revogado recusa", () => {
  const m = mandate({ revoked: true }), p = purchase();
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.action, "reject");
  assert.equal(code(r), "revoked");
});

test("mandato expirado recusa", () => {
  const m = mandate({ expiresAt: new Date("2026-08-01T00:00:00Z") }), p = purchase();
  assert.equal(code(evaluate(m, p, ctx(m, p))), "expired");
});

test("mandato esgotado recusa — e esgotado nao e revogado", () => {
  const m = mandate({ maxUses: 1, usedCount: 1 }), p = purchase();
  assert.equal(code(evaluate(m, p, ctx(m, p))), "uses_exhausted");
  assert.equal(mandateStatus(m, NOW), "exhausted");
  assert.equal(m.revoked, false); // consumir o mandato NAO o revoga
});

test("status derivado cobre os quatro estados", () => {
  assert.equal(mandateStatus(mandate(), NOW), "active");
  assert.equal(mandateStatus(mandate({ revoked: true }), NOW), "revoked");
  assert.equal(mandateStatus(mandate({ expiresAt: new Date("2020-01-01") }), NOW), "expired");
  assert.equal(mandateStatus(mandate({ usedCount: 1 }), NOW), "exhausted");
});

/* ----------------------------- impostor ---------------------------- */

test("agente que nao e o dono recusa", () => {
  const m = mandate(), p = purchase();
  const c = ctx(m, p, { ticket: ticketFor(m, p, { agentId: "agent_mallory" }) });
  assert.equal(code(evaluate(m, p, c)), "agent_not_owner");
});

/* ------------------------ on_missing / on_fail --------------------- */

test("on_missing deny: atributo ausente recusa", () => {
  const m = mandate({
    constraints: [{ attr: "ship_country", op: "eq", value: "BR", on_missing: "deny", on_fail: "deny" }],
  });
  const p = purchase({ attributes: { category: "calcado" } });
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.action, "reject");
  assert.equal(r.reason.params.attr, "ship_country");
});

test("on_missing escalate: atributo ausente escala", () => {
  const m = mandate({
    constraints: [{ attr: "ship_country", op: "eq", value: "BR", on_missing: "escalate", on_fail: "deny" }],
  });
  const p = purchase({ attributes: { category: "calcado" } });
  assert.equal(evaluate(m, p, ctx(m, p)).action, "escalate");
});

test("on_missing allow: atributo ausente passa", () => {
  const m = mandate({
    constraints: [{ attr: "color", op: "eq", value: "preto", on_missing: "allow", on_fail: "deny" }],
  });
  const p = purchase({ attributes: {} });
  assert.equal(evaluate(m, p, ctx(m, p)).valid, true);
});

test("os dois eixos sao INDEPENDENTES: escalate na ausencia, deny na falha", () => {
  // A regra que motivou separar on_fail de on_missing: "nao sei de onde vem"
  // pergunta ao humano; "vem da China" recusa direto — ele ja respondeu isso.
  const c = { attr: "ship_country", op: "eq", value: "BR", on_missing: "escalate", on_fail: "deny" };
  const m = mandate({ constraints: [c] });

  const ausente = purchase({ attributes: {} });
  assert.equal(evaluate(m, ausente, ctx(m, ausente)).action, "escalate");

  const china = purchase({ attributes: { ship_country: "CN" } });
  assert.equal(evaluate(m, china, ctx(m, china)).action, "reject");
});

test("on_fail escalate: estouro pequeno de preco pergunta ao humano", () => {
  const m = mandate({
    constraints: [{ attr: "price", op: "lte", value: 10000, on_missing: "deny", on_fail: "escalate" }],
  });
  const p = purchase({ price: 10300, attributes: { price: 10300 } });
  const c = ctx(m, p, { ticket: ticketFor(m, p) });
  const r = evaluate(m, p, c);
  assert.equal(r.action, "escalate");
  assert.equal(r.reason.code, "constraint_failed");
});

test("on_fail default e deny", () => {
  const m = mandate({ constraints: [{ attr: "price", op: "lte", value: 10000, on_missing: "deny" }] });
  const p = purchase({ price: 30000, attributes: { price: 30000 } });
  assert.equal(evaluate(m, p, ctx(m, p, { ticket: ticketFor(m, p) })).action, "reject");
});

test("operador desconhecido nega, nunca escala (erro de dados, nao duvida)", () => {
  const m = mandate({ constraints: [{ attr: "price", op: "wat", value: 1, on_fail: "escalate" }] });
  const p = purchase();
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.action, "reject");
  assert.equal(code(r), "unknown_operator");
});

/* ------------------------------ moeda ------------------------------ */

test("moeda divergente do mandato recusa", () => {
  const m = mandate({ currency: "BRL" });
  const p = purchase({ currency: "USD" });
  const c = ctx(m, p, { ticket: ticketFor(m, p, { currency: "USD" }) });
  assert.equal(code(evaluate(m, p, c)), "currency_outside_mandate");
});

/* ------------------------------ bilhete ---------------------------- */

test("bilhete de outro mandato recusa", () => {
  const m = mandate(), p = purchase();
  const c = ctx(m, p, { ticket: ticketFor(m, p, { mandateId: "mnd_outro" }) });
  assert.equal(code(evaluate(m, p, c)), "ticket_mandate_mismatch");
});

test("bilhete de outra loja recusa (replay cruzado)", () => {
  const m = mandate(), p = purchase();
  const c = ctx(m, p, { ticket: ticketFor(m, p, { merchantId: "store_b" }) });
  assert.equal(code(evaluate(m, p, c)), "ticket_merchant_mismatch");
});

test("bilhete de outro produto recusa", () => {
  const m = mandate(), p = purchase();
  const c = ctx(m, p, { ticket: ticketFor(m, p, { productId: "OUTRO" }) });
  assert.equal(code(evaluate(m, p, c)), "ticket_product_mismatch");
});

test("LOJA INFLANDO O PRECO DENTRO DO TETO recusa", () => {
  // O ataque que o preco no bilhete existe para fechar: o agente escolheu R$98,
  // a loja atesta R$99,99 — passa em todas as constraints (o teto e R$100),
  // mas nao e o que o agente pediu.
  const m = mandate(), p = purchase({ price: 9999, attributes: { category: "calcado", price: 9999 } });
  const c = ctx(m, p, { ticket: ticketFor(m, p, { price: 9800 }) });
  const r = evaluate(m, p, c);
  assert.equal(r.action, "reject");
  assert.equal(code(r), "ticket_price_mismatch");
});

test("sem bilhete recusa", () => {
  const m = mandate(), p = purchase();
  assert.equal(code(evaluate(m, p, ctx(m, p, { ticket: null }))), "ticket_missing");
});

/* ------------------------ portao de aprovacao ---------------------- */

const approval = (m, p, over = {}) => ({
  _id: "apr_1",
  status: "approved",
  mandateId: m._id,
  merchantId: "store_a",
  productId: p.productId,
  price: p.price,
  consumedAt: null,
  expiresAt: new Date(NOW.getTime() + 60000),
  ...over,
});

test("modo aprovacao sem aprovacao escala", () => {
  const m = mandate({ mode: "aprovacao" }), p = purchase();
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.action, "escalate");
  assert.equal(code(r), "approval_required");
});

test("modo aprovacao com aprovacao casada passa", () => {
  const m = mandate({ mode: "aprovacao" }), p = purchase();
  assert.equal(evaluate(m, p, ctx(m, p, { approval: approval(m, p) })).valid, true);
});

test("aprovacao de OUTRO produto nao vale (cheque em branco)", () => {
  const m = mandate({ mode: "aprovacao" }), p = purchase();
  const a = approval(m, p, { productId: "OUTRO" });
  assert.equal(evaluate(m, p, ctx(m, p, { approval: a })).action, "escalate");
});

test("aprovacao com OUTRO preco nao vale", () => {
  const m = mandate({ mode: "aprovacao" }), p = purchase();
  const a = approval(m, p, { price: 30000 });
  assert.equal(evaluate(m, p, ctx(m, p, { approval: a })).action, "escalate");
});

test("aprovacao ja consumida nao vale", () => {
  const m = mandate({ mode: "aprovacao" }), p = purchase();
  const a = approval(m, p, { consumedAt: NOW });
  assert.equal(evaluate(m, p, ctx(m, p, { approval: a })).action, "escalate");
});

test("aprovacao expirada nao vale", () => {
  const m = mandate({ mode: "aprovacao" }), p = purchase();
  const a = approval(m, p, { expiresAt: new Date(NOW.getTime() - 1) });
  assert.equal(evaluate(m, p, ctx(m, p, { approval: a })).action, "escalate");
});

test("aprovacao de outra loja nao vale", () => {
  const m = mandate({ mode: "aprovacao" }), p = purchase();
  const a = approval(m, p, { merchantId: "store_b" });
  assert.equal(evaluate(m, p, ctx(m, p, { approval: a })).action, "escalate");
});

/* -------------------- universalidade do motor ---------------------- */

test("mesmo motor, dados diferentes: assinatura de software ignora pais", () => {
  // Nenhuma constraint de ship_country -> pais nem e olhado. Nada de `if (produto === ...)`.
  const m = mandate({
    constraints: [
      { attr: "category", op: "eq", value: "software", on_missing: "deny", on_fail: "deny" },
      { attr: "price", op: "lte", value: 5000, on_missing: "deny", on_fail: "deny" },
    ],
  });
  const p = purchase({
    productId: "SUB-1",
    price: 4000,
    attributes: { category: "software", price: 4000, ship_country: "CN" },
  });
  assert.equal(evaluate(m, p, ctx(m, p, { ticket: ticketFor(m, p) })).valid, true);
});
