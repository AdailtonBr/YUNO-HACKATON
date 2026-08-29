/**
 * Testes do bilhete assinado (D16).  Também puros — só cripto, sem banco.
 * O anti-replay (nonce de uso único) é testado na integração, porque acontece
 * na mesma operação atômica que consome o mandato.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { issueTicket, verifyTicket, peekAgentId } from "../src/authority/ticket.js";

const SECRET = "segredo-do-agente";
const NOW = new Date("2026-08-29T12:00:00Z");

const claim = {
  agentId: "agent_1",
  mandateId: "mnd_1",
  merchantId: "store_a",
  productId: "TEN-001",
  price: 9800,
  currency: "BRL",
};

test("bilhete valido verifica e devolve o payload", () => {
  const t = issueTicket(claim, SECRET, { now: NOW });
  const r = verifyTicket(t, SECRET, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.payload.agentId, "agent_1");
  assert.equal(r.payload.price, 9800);
});

test("segredo errado nao verifica", () => {
  const t = issueTicket(claim, SECRET, { now: NOW });
  const r = verifyTicket(t, "segredo-da-loja", { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.code, "ticket_bad_signature");
});

test("payload adulterado nao verifica (a loja nao consegue reescrever o preco)", () => {
  const t = issueTicket(claim, SECRET, { now: NOW });
  const [encoded, sig] = t.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.price = 30000; // a loja tenta inflar
  const forged = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig;
  assert.equal(verifyTicket(forged, SECRET, { now: NOW }).ok, false);
});

test("campo extra no payload nao passa (assinamos a forma canonica)", () => {
  const t = issueTicket(claim, SECRET, { now: NOW });
  const [encoded, sig] = t.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.admin = true;
  const forged = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig;
  assert.equal(verifyTicket(forged, SECRET, { now: NOW }).ok, false);
});

test("bilhete expirado nao verifica", () => {
  const t = issueTicket(claim, SECRET, { now: NOW, ttlSeconds: 60 });
  const depois = new Date(NOW.getTime() + 61_000);
  assert.equal(verifyTicket(t, SECRET, { now: depois }).code, "ticket_expired");
});

test("bilhete malformado nao verifica", () => {
  assert.equal(verifyTicket("lixo", SECRET, { now: NOW }).code, "ticket_malformed");
  assert.equal(verifyTicket(null, SECRET, { now: NOW }).code, "ticket_malformed");
});

test("peekAgentId le sem confiar — so para achar o segredo", () => {
  const t = issueTicket(claim, SECRET, { now: NOW });
  assert.equal(peekAgentId(t), "agent_1");
  assert.equal(peekAgentId("lixo"), null);
});

test("cada bilhete tem nonce proprio", () => {
  const a = issueTicket(claim, SECRET, { now: NOW });
  const b = issueTicket(claim, SECRET, { now: NOW });
  assert.notEqual(verifyTicket(a, SECRET, { now: NOW }).payload.nonce, verifyTicket(b, SECRET, { now: NOW }).payload.nonce);
});
