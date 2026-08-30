/**
 * Testes da resolução de disputa.  Puros: o veredito sai do trilho, e o trilho
 * é só dado — não precisa de banco para provar isso.
 *
 * O que estes testes realmente verificam é a promessa do log append-only: que
 * "eu nunca autorizei isso" tem resposta, e que a resposta é reconstituível.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolveDispute } from "../src/authority/dispute.js";

const T0 = "2026-08-29T10:00:00Z";
const T1 = "2026-08-29T11:00:00Z";
const T2 = "2026-08-29T12:00:00Z";

const mandate = (over = {}) => ({
  _id: "mnd_1",
  humanId: "user_michael",
  agentId: "agent_michael",
  mode: "autonomo",
  humanReadable: "Spend at most R$100.00, a single purchase.",
  constraints: [{ attr: "price", op: "lte", value: 10000 }],
  ...over,
});

const purchase = { productId: "TEN-001", price: 9800, currency: "BRL" };

const decision = (over = {}) => ({
  _id: "aud_buy",
  ts: T1,
  event: "purchase_decision",
  mandateId: "mnd_1",
  merchantId: "store_a",
  agentIdAuthenticated: "agent_michael",
  purchase,
  decision: "valido",
  receiptId: "rcpt_1",
  trace: [{ attr: "price", op: "lte", value: 10000, actual: 9800, verdict: "ok" }],
  ...over,
});

const created = { ts: T0, event: "mandate_created", actor: { type: "human", id: "user_michael" } };
const paid = { ts: T1, event: "payment_result", receiptId: "rcpt_1", purchase };

const linkOf = (r, key) => r.evidence.find((e) => e.key === key);

/* ------------------------- a favor da loja ------------------------- */

test("cadeia completa: o registro sustenta a cobranca", () => {
  const m = mandate();
  const d = decision();
  const r = resolveDispute(d, [created, d, paid], m);

  assert.equal(r.verdict, "authorized");
  assert.equal(r.brokenLink, null);
  assert.equal(r.charged.price, 9800);
  assert.equal(r.charged.receiptId, "rcpt_1");

  // Cada elo pode ser mostrado ao titular, um a um.
  assert.equal(linkOf(r, "mandate_created").ok, true);
  assert.equal(linkOf(r, "mandate_created").by, "user_michael");
  assert.equal(linkOf(r, "agent_identity").ok, true);
  assert.equal(linkOf(r, "rules_passed").ok, true);
  assert.equal(linkOf(r, "charged_what_was_verified").ok, true);
  // Mandato autonomo nao exige aprovacao: null e "nao se aplica", nao falha.
  assert.equal(linkOf(r, "human_approval").ok, null);
});

test("modo aprovacao com o sim especifico: sustenta", () => {
  const m = mandate({ mode: "aprovacao" });
  const d = decision();
  const granted = {
    ts: T0,
    event: "approval_granted",
    actor: { type: "human", id: "user_michael" },
    purchase,
  };
  const r = resolveDispute(d, [created, granted, d, paid], m);
  assert.equal(r.verdict, "authorized");
  assert.equal(linkOf(r, "human_approval").ok, true);
});

/* ------------------------ a favor do titular ----------------------- */

test("sem mandato criado no trilho: o registro NAO sustenta", () => {
  const d = decision();
  const r = resolveDispute(d, [d, paid], mandate());
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "mandate_created");
});

test("quem comprou nao era o agente do mandato", () => {
  const d = decision({ agentIdAuthenticated: "agent_mallory" });
  const r = resolveDispute(d, [created, d, paid], mandate());
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "agent_identity");
  assert.equal(linkOf(r, "agent_identity").claimed, "agent_mallory");
  assert.equal(linkOf(r, "agent_identity").mandateHolder, "agent_michael");
});

test("regra violada no trace: o registro NAO sustenta", () => {
  const d = decision({
    trace: [{ attr: "price", op: "lte", value: 10000, actual: 30000, verdict: "violated" }],
  });
  const r = resolveDispute(d, [created, d, paid], mandate());
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "rules_passed");
});

test("modo aprovacao SEM o sim: o registro NAO sustenta", () => {
  const m = mandate({ mode: "aprovacao" });
  const d = decision();
  const r = resolveDispute(d, [created, d, paid], m);
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "human_approval");
});

test("aprovacao de OUTRA compra nao serve de prova", () => {
  const m = mandate({ mode: "aprovacao" });
  const d = decision();
  const outra = {
    ts: T0,
    event: "approval_granted",
    actor: { type: "human", id: "user_michael" },
    purchase: { productId: "TEN-999", price: 30000, currency: "BRL" },
  };
  const r = resolveDispute(d, [created, outra, d, paid], m);
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "human_approval");
});

test("cobrado diferente do verificado: o registro NAO sustenta", () => {
  const d = decision();
  const paidMore = { ts: T1, event: "payment_result", receiptId: "rcpt_1", purchase: { ...purchase, price: 30000 } };
  const r = resolveDispute(d, [created, d, paidMore], mandate());
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "charged_what_was_verified");
  assert.equal(linkOf(r, "charged_what_was_verified").verified, 9800);
  assert.equal(linkOf(r, "charged_what_was_verified").charged, 30000);
});

/* ------------------------- nada foi cobrado ------------------------ */

test("compra recusada: nao ha o que disputar", () => {
  const d = decision({ decision: "recusado", receiptId: null });
  const r = resolveDispute(d, [created, d], mandate());
  assert.equal(r.verdict, "nothing_charged");
  assert.equal(r.charged, null);
});

/* --------------------------- ordem importa ------------------------- */

test("mandato criado DEPOIS da compra nao autoriza a compra", () => {
  // Um mandato posterior nao pode legitimar o que ja tinha sido cobrado.
  const depois = { ts: T2, event: "mandate_created", actor: { type: "human", id: "user_michael" } };
  const d = decision();
  const r = resolveDispute(d, [d, paid, depois], mandate());
  assert.equal(r.verdict, "not_authorized");
  assert.equal(r.brokenLink, "mandate_created");
});
