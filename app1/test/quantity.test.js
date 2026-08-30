/**
 * Testes de quantidade.
 *
 * A pergunta que este arquivo guarda não é "dá para comprar dois?" — é *o que o
 * número do mandato passa a significar quando dá*.
 *
 * Um mandato diz `price lte 15000` e o humano lê "o agente pode gastar R$150".
 * Solte a quantidade debaixo dessa regra e a frase vira falsa sem que nenhuma
 * regra seja violada: vinte unidades de R$150 são R$3.000, e cada uma cabe.  O
 * teto que limita gasto é o do TOTAL, porque é o total que sai da conta.
 *
 * Daí as duas invariantes aqui: o total é assinado pelo agente e refeito pela
 * Autoridade (a loja não multiplica unidades por conta própria), e um mandato
 * que não fala em total compra UMA unidade — esquecer bloqueia, não libera.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/authority/engine.js";

const LATER = new Date("2026-09-30T00:00:00Z");

const mandate = (over = {}) => ({
  _id: "mnd_1",
  humanId: "user_1",
  agentId: "agent_1",
  mode: "autonomo",
  currency: "BRL",
  constraints: [{ attr: "price", op: "lte", value: 15000, on_missing: "deny", on_fail: "deny" }],
  paymentMethodRef: "pm_card_x",
  maxUses: 1,
  usedCount: 0,
  expiresAt: LATER,
  revoked: false,
  ...over,
});

/** Um mandato que SABE limitar o gasto: teto de total, não só de unidade. */
const capped = (total, over = {}) =>
  mandate({
    constraints: [
      { attr: "price", op: "lte", value: 15000, on_missing: "deny", on_fail: "deny" },
      { attr: "total", op: "lte", value: total, on_missing: "deny", on_fail: "deny" },
    ],
    ...over,
  });

/** A compra como a LOJA a atesta — preço unitário, quantidade e total. */
const purchase = (quantity = 1, over = {}) => {
  const price = 9800;
  const total = price * quantity;
  return {
    productId: "TEN-001",
    price,
    quantity,
    total,
    currency: "BRL",
    attributes: { category: "calcado", price, quantity, total, size: "40" },
    ...over,
  };
};

const ctx = (m, p, ticketOver = {}, over = {}) => ({
  ticket: {
    agentId: m.agentId,
    mandateId: m._id,
    merchantId: "store_a",
    productId: p.productId,
    price: p.price,
    quantity: p.quantity,
    total: p.total,
    currency: p.currency,
    nonce: "n1",
    iat: 0,
    exp: 9e9,
    ...ticketOver,
  },
  authenticatedMerchantId: "store_a",
  approval: null,
  now: new Date("2026-08-29T12:00:00Z"),
  ...over,
});

/* ---------------------------------------------------------------- *
 * A invariante central: o mandato tem que saber limitar o gasto.
 * ---------------------------------------------------------------- */

test("mandato SEM teto de total compra uma unidade, e recusa duas", () => {
  const m = mandate(); // só `price lte 15000`
  const p = purchase(2);

  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "quantity_uncapped");
  // A recusa diz quantas foram pedidas: o humano precisa saber o que negou.
  assert.equal(r.reason.params.quantity, 2);
});

test("o MESMO mandato compra uma unidade normalmente", () => {
  const m = mandate();
  const p = purchase(1);
  assert.equal(evaluate(m, p, ctx(m, p)).valid, true);
});

test("O BURACO que isso fecha: 20 unidades cabem no teto UNITARIO", () => {
  // Cada unidade custa R$98 e o teto unitário é R$150: as 20 passam na regra de
  // `price`.  Sem o portão, sairiam R$1.960 de um mandato que o humano leu
  // como "até R$150".
  const m = mandate();
  const p = purchase(20);

  const precoDeCadaUmaCabe = p.price <= 15000;
  assert.equal(precoDeCadaUmaCabe, true);
  assert.equal(p.total, 196000); // R$1.960 sairiam da conta

  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "quantity_uncapped");
});

test("com teto de TOTAL, duas unidades passam", () => {
  const m = capped(30000); // até R$300 no total
  const p = purchase(2); // 2 × R$98 = R$196
  assert.equal(evaluate(m, p, ctx(m, p)).valid, true);
});

test("com teto de total, a quantidade que estoura o total e recusada", () => {
  const m = capped(30000);
  const p = purchase(4); // 4 × R$98 = R$392 > R$300
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.valid, false);
  // Quem barra é a REGRA do humano, não um portão nosso — o trace prova.
  assert.equal(r.trace.find((t) => t.attr === "total").verdict, "violated");
});

test("o teto unitario continua valendo junto com o do total", () => {
  const m = capped(100000); // total generoso
  // Um item caro: cabe no total, mas fura o teto por unidade.
  const p = purchase(1, { price: 31000, total: 31000, attributes: { price: 31000, quantity: 1, total: 31000 } });
  const r = evaluate(m, p, ctx(m, p));
  assert.equal(r.valid, false);
  assert.equal(r.trace.find((t) => t.attr === "price").verdict, "violated");
});

/* ---------------------------------------------------------------- *
 * O bilhete: a loja não multiplica unidades por conta própria.
 * ---------------------------------------------------------------- */

test("ATAQUE: o agente assina 1, a loja atesta 20", () => {
  const m = capped(500000); // teto alto de propósito: quem tem que barrar é o bilhete
  const p = purchase(20);
  // O bilhete que o agente realmente assinou era de UMA unidade.
  const r = evaluate(m, p, ctx(m, p, { quantity: 1, total: 9800 }));
  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "ticket_quantity_mismatch");
});

test("ATAQUE: a loja infla o total mantendo a quantidade", () => {
  const m = capped(500000);
  const p = purchase(2, { total: 50000 }); // 2 × 9800 não é 50000
  const r = evaluate(m, p, ctx(m, p, { total: 50000 }));
  assert.equal(r.valid, false);
  // A conta não fecha, e o total não pode ser AFIRMADO: tem que ser derivável.
  assert.equal(r.reason.code, "total_mismatch");
});

test("ATAQUE: total menor que a conta, para caber no teto", () => {
  // A loja atesta 10 unidades mas declara o total de 2, para passar debaixo do
  // teto — e cobraria o que quisesse depois.
  const m = capped(30000);
  const p = purchase(10, { total: 19600 });
  const r = evaluate(m, p, ctx(m, p, { total: 19600 }));
  assert.equal(r.valid, false);
  assert.equal(r.reason.code, "total_mismatch");
});

test("quantidade invalida e recusada, nunca arredondada para cima", () => {
  const m = capped(500000);
  for (const q of [0, -3, 1.5]) {
    const p = purchase(1, { quantity: q, total: 9800 * q });
    const r = evaluate(m, p, ctx(m, p, { quantity: q, total: 9800 * q }));
    assert.equal(r.valid, false, `quantidade ${q} deveria ser recusada`);
    assert.equal(r.reason.code, "quantity_invalid");
  }
});

/* ---------------------------------------------------------------- *
 * Compatibilidade: nada disso pode quebrar o que já existia.
 * ---------------------------------------------------------------- */

test("compra SEM quantidade nenhuma continua valendo como uma unidade", () => {
  const m = mandate();
  // Exatamente a forma antiga: sem `quantity`, sem `total`, em lugar nenhum.
  const p = {
    productId: "TEN-001",
    price: 9800,
    currency: "BRL",
    attributes: { category: "calcado", price: 9800, size: "40" },
  };
  const c = ctx(m, p);
  delete c.ticket.quantity;
  delete c.ticket.total;

  assert.equal(evaluate(m, p, c).valid, true);
});

/* ---------------------------------------------------------------- *
 * A aprovação humana congela a quantidade.
 * ---------------------------------------------------------------- */

test("aprovar 2 nao autoriza 3", () => {
  const m = capped(100000, { mode: "aprovacao" });
  const aprovacaoDeDuas = {
    status: "approved",
    mandateId: m._id,
    merchantId: "store_a",
    productId: "TEN-001",
    price: 9800,
    quantity: 2,
    consumedAt: null,
    expiresAt: LATER,
  };

  const duas = purchase(2);
  assert.equal(evaluate(m, duas, ctx(m, duas, {}, { approval: aprovacaoDeDuas })).valid, true);

  // A MESMA aprovação, agora para três: não serve.
  const tres = purchase(3);
  const r = evaluate(m, tres, ctx(m, tres, {}, { approval: aprovacaoDeDuas }));
  assert.equal(r.valid, false);
  assert.equal(r.action, "escalate"); // volta a pedir o sim do humano
});
