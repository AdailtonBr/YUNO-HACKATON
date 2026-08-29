/**
 * Ponta a ponta: Autoridade + duas lojas reais + a loja fora da allow-list,
 * com o agente buscando, comparando e comprando.
 *
 * É o roteiro da demo (`docs/07-build-plan.md`) rodando como teste, para que a
 * prova de fogo não dependa de ninguém lembrar de clicar na ordem certa.
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { buildApp } from "../src/app.js";
import { seed, DEMO } from "../src/seed.js";
import { buildStore } from "../../app2/src/store.js";
import { STORES } from "../../app2/src/catalogs.js";
import { Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency, Proposal } from "../src/authority/models.js";

let mongod, authority, storeServers = [], authorityUrl;

const listen = (app) =>
  new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("e2e_test"));

  authority = await listen(buildApp());
  authorityUrl = `http://127.0.0.1:${authority.address().port}`;

  // Cada loja sobe numa porta efêmera e aponta para esta Autoridade.
  for (const key of ["store_a", "store_b", "store_fake"]) {
    const s = STORES[key];
    const srv = await listen(buildStore({ ...s, authorityUrl }));
    storeServers.push({ id: s.id, srv, url: `http://127.0.0.1:${srv.address().port}` });
  }

  // O agente descobre as lojas por env — aqui apontamos para as efêmeras.
  process.env.AUTHORITY_SELF_URL = authorityUrl;
  process.env.STORE_A_URL = storeServers[0].url;
  process.env.STORE_B_URL = storeServers[1].url;
  process.env.STORE_FAKE_URL = storeServers[2].url;
});

after(async () => {
  authority?.close();
  storeServers.forEach((s) => s.srv.close());
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

const asHuman = { "content-type": "application/json", "x-human-id": DEMO.humanId };
const post = (path, body, headers = { "content-type": "application/json" }) =>
  fetch(`${authorityUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

/** "Tênis tam. 40, até R$100, só do Brasil" — o mandato da demo. */
async function shoeMandate(over = {}) {
  const { mandateId } = await post(
    "/mandates",
    {
      agentId: DEMO.agentId,
      mode: "autonomo",
      currency: "BRL",
      paymentMethodRef: "pm_card_demo",
      maxUses: 3,
      expiresAt: "2026-12-31T23:59:59Z",
      constraints: [
        { attr: "category", op: "eq", value: "calcado", on_missing: "deny", on_fail: "deny" },
        { attr: "size", op: "eq", value: "40", on_missing: "deny", on_fail: "deny" },
        { attr: "price", op: "lte", value: 10000, on_missing: "deny", on_fail: "deny" },
        { attr: "ship_country", op: "eq", value: "BR", on_missing: "deny", on_fail: "deny" },
      ],
      ...over,
    },
    asHuman
  );
  return mandateId;
}

const shop = (mandateId, over = {}) => post("/agent/shop", { mandateId, query: "runner", ...over });

/* ------------------------------ testes ----------------------------- */

test("adaptador: as duas lojas expoem vocabulario comum a partir de bancos diferentes", async () => {
  const { items } = await fetch(`${authorityUrl}/agent/catalogs?q=runner`).then((r) => r.json());
  const a = items.find((i) => i.productId === "TEN-001");
  const b = items.find((i) => i.productId === "B-SNEAK-2");

  // A loja A guarda "preco_reais/tipo/origem/numeracao"; a B, "amount_cents/kind/ships_from/shoe_size".
  // Do lado de fora, as duas falam a MESMA lingua.
  for (const p of [a, b]) {
    assert.equal(p.category, "calcado");
    assert.equal(p.currency, "BRL");
    assert.equal(p.size, "40");
    assert.equal(typeof p.price, "number");
  }
  assert.equal(a.price, 9800);
  assert.equal(b.price, 9400);
});

test("FLUXO FELIZ: o agente compara as duas lojas e compra a melhor que cabe", async () => {
  const mandateId = await shoeMandate();
  const { comparison, chosen, result } = await shop(mandateId);

  // A escolha atravessou a fronteira das lojas: o mais barato que CABE esta na B.
  assert.equal(chosen.merchantId, "store_b");
  assert.equal(chosen.price, 9400);
  assert.equal(result.ok, true);
  assert.ok(result.receiptId);

  // E existe uma comparacao auditavel: por que este e nao aquele.
  const cn = comparison.find((i) => i.productId === "TEN-002");
  assert.equal(cn.price, 9250); // mais barato...
  assert.equal(cn.fits, false); // ...mas nao cabe (vem da China)
});

test("FORA DO MANDATO: agente adversarial pega a mais barata e a Autoridade recusa", async () => {
  const mandateId = await shoeMandate();
  // `cheapest` ignora o mandato de proposito: e o agente tentando burlar.
  const { chosen, result } = await shop(mandateId, { strategy: "cheapest" });

  assert.equal(chosen.productId, "TEN-002"); // a da China, R$92,50
  assert.equal(result.ok, false);
  assert.match(result.reasonText, /ship_country/);

  // Nada foi cobrado: o agente nao tem alavanca para virar um "nao" em "sim".
  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 0);
});

test("ANTI-SITE-FAKE: loja fora da allow-list nao consegue vender nem com o melhor preco", async () => {
  const mandateId = await shoeMandate();
  const { chosen, result } = await shop(mandateId, { strategy: "cheapest", includeUnregistered: true });

  assert.equal(chosen.merchantId, "store_fake"); // R$29,00, bom demais para ser verdade
  assert.equal(result.ok, false);
  assert.match(result.reasonText, /not registered/i);
});

test("PROVA DE FOGO: o humano revoga e a proxima compra do agente falha", async () => {
  const mandateId = await shoeMandate();
  assert.equal((await shop(mandateId)).result.ok, true);

  await post(`/mandates/${mandateId}/revoke`, {}, asHuman);

  const depois = await shop(mandateId);
  assert.equal(depois.result.ok, false);
  assert.match(depois.result.reasonText, /revoked/i);
});

test("HUMAN-IN-THE-LOOP: modo aprovacao escala, humano aprova, agente conclui", async () => {
  const mandateId = await shoeMandate({ mode: "aprovacao" });

  const first = await shop(mandateId);
  assert.equal(first.result.ok, false);
  assert.equal(first.result.action, "escalate");

  const pend = await fetch(`${authorityUrl}/approvals`, { headers: asHuman }).then((r) => r.json());
  assert.equal(pend.length, 1);
  assert.equal(pend[0].price, 9400); // a compra exata que o humano esta aprovando

  await post(`/approvals/${pend[0].approvalId}/approve`, {}, asHuman);
  assert.equal((await shop(mandateId)).result.ok, true);
});

test("a loja ve a propria verificacao", async () => {
  const mandateId = await shoeMandate();
  await shop(mandateId);

  const storeB = storeServers[1];
  const { verifications } = await fetch(`${storeB.url}/verifications`).then((r) => r.json());
  assert.equal(verifications[0].decision, "valido");
  assert.equal(verifications[0].productId, "B-SNEAK-2");
  assert.ok(verifications[0].receiptId);
});

test("cada parte ve o seu: humano, loja e auditor", async () => {
  const mandateId = await shoeMandate();
  await shop(mandateId);

  // Humano: o registro do que autorizou.
  const mine = await fetch(`${authorityUrl}/mandates`, { headers: asHuman }).then((r) => r.json());
  assert.equal(mine[0].usedCount, 1);
  assert.equal(mine[0].paymentMethodRef, undefined);

  // Auditor: o trilho completo.
  const trail = await fetch(`${authorityUrl}/audit?mandateId=${mandateId}`).then((r) => r.json());
  assert.ok(trail.some((e) => e.event === "mandate_created"));
  assert.ok(trail.some((e) => e.event === "payment_result" && e.receiptId));
});
