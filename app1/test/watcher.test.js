/**
 * Testes do vigia.  Puros: `planTick` decide o que tentar a partir dos mandatos
 * e de um retrato do catálogo — sem banco e sem rede.
 *
 * O que estes testes guardam é o risco novo que a autonomia traz: um vigia com
 * bug compra sozinho, de madrugada, sem ninguém olhando.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planTick, watchKey } from "../src/agent/watcher.js";

const NOW = new Date("2026-08-29T12:00:00Z");
const LATER = new Date("2026-09-30T00:00:00Z");

const mandate = (over = {}) => ({
  _id: "mnd_1",
  agentId: "agent_michael",
  mode: "autonomo",
  currency: "BRL",
  constraints: [
    { attr: "category", op: "eq", value: "calcado", on_missing: "deny", on_fail: "deny" },
    { attr: "size", op: "eq", value: "40", on_missing: "deny", on_fail: "deny" },
    { attr: "price", op: "lte", value: 10000, on_missing: "deny", on_fail: "deny" },
  ],
  maxUses: 1,
  usedCount: 0,
  expiresAt: LATER,
  revoked: false,
  ...over,
});

const item = (over = {}) => ({
  productId: "TEN-001",
  name: "Runner Shoe",
  price: 9800,
  currency: "BRL",
  category: "calcado",
  size: "40",
  ship_country: "BR",
  merchantId: "store_a",
  merchantName: "Store A",
  storeUrl: "http://a",
  ...over,
});

const CATALOG = [
  item(),                                                                    // A, 98,00
  item({ productId: "B-SNEAK-2", price: 9400, merchantId: "store_b", merchantName: "Store B" }), // B, 94,00
  item({ productId: "TEN-004", price: 31000 }),                              // caro demais
  item({ productId: "TEN-003", size: "42", price: 8000 }),                    // barato, tamanho errado
];

/* --------------------------- o caso feliz -------------------------- */

test("escolhe a mais barata que cabe, atravessando as lojas", () => {
  const plan = planTick({ mandates: [mandate()], items: CATALOG, now: NOW });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].item.productId, "B-SNEAK-2");
  assert.equal(plan[0].item.merchantId, "store_b");
  assert.equal(plan[0].item.price, 9400);
});

test("nada que caiba: nao tenta nada", () => {
  const m = mandate({ constraints: [{ attr: "price", op: "lte", value: 5000, on_missing: "deny", on_fail: "deny" }] });
  assert.deepEqual(planTick({ mandates: [m], items: CATALOG, now: NOW }), []);
});

/* ------------------ mandatos que nao devem ser tocados ------------- */

test("mandato revogado e ignorado", () => {
  const plan = planTick({ mandates: [mandate({ revoked: true })], items: CATALOG, now: NOW });
  assert.equal(plan.length, 0);
});

test("mandato expirado e ignorado", () => {
  const m = mandate({ expiresAt: new Date("2026-08-01T00:00:00Z") });
  assert.equal(planTick({ mandates: [m], items: CATALOG, now: NOW }).length, 0);
});

test("mandato esgotado e ignorado — e o cumprido na conversa esgota sozinho", () => {
  // E o que faz um mandato cumprido no chat nunca ser tocado pelo vigia:
  // usedCount === maxUses ja o tirou de `active`.
  const m = mandate({ maxUses: 1, usedCount: 1 });
  assert.equal(planTick({ mandates: [m], items: CATALOG, now: NOW }).length, 0);
});

/* ----------------------- o raio de explosao ------------------------ */

test("teto por tique limita quantas compras um bug consegue disparar", () => {
  const muitos = Array.from({ length: 12 }, (_, i) => mandate({ _id: `mnd_${i}` }));
  const plan = planTick({ mandates: muitos, items: CATALOG, now: NOW, maxPurchases: 5 });
  assert.equal(plan.length, 5);
});

test("cada mandato rende no maximo uma tentativa por tique", () => {
  const plan = planTick({ mandates: [mandate()], items: CATALOG, now: NOW, maxPurchases: 5 });
  assert.equal(plan.length, 1);
});

/* --------------------------- idempotencia -------------------------- */

test("a chave e ESTAVEL na mesma oportunidade: retentativa nao compra duas vezes", () => {
  const m = mandate();
  const a = planTick({ mandates: [m], items: CATALOG, now: NOW })[0];
  const b = planTick({ mandates: [m], items: CATALOG, now: NOW })[0];
  assert.equal(a.idempotencyKey, b.idempotencyKey);
});

test("a chave MUDA depois de um uso consumido: mandato de 3 usos consegue os 3", () => {
  const antes = watchKey(mandate({ maxUses: 3, usedCount: 0 }), item());
  const depois = watchKey(mandate({ maxUses: 3, usedCount: 1 }), item());
  assert.notEqual(antes, depois);
});

test("a chave muda com o produto e com o preco", () => {
  const m = mandate();
  assert.notEqual(watchKey(m, item()), watchKey(m, item({ productId: "OUTRO" })));
  assert.notEqual(watchKey(m, item()), watchKey(m, item({ price: 9000 })));
  assert.match(watchKey(m, item()), /^watch:/); // o prefixo distingue do chat
});

/* ------------------------- modo aprovacao -------------------------- */

test("modo aprovacao tambem e tentado — quem escala e a Autoridade, nao o vigia", () => {
  // O vigia nao decide que precisa de aprovacao; ele tenta, e a Autoridade
  // responde `escalate` criando a pendencia.  Se o vigia filtrasse aqui,
  // estaria julgando validade do lado errado da rede.
  const plan = planTick({ mandates: [mandate({ mode: "aprovacao" })], items: CATALOG, now: NOW });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].item.productId, "B-SNEAK-2");
});
