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
import { Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency, Proposal, PaymentMethod, Address } from "../src/authority/models.js";
import { mandateStatus } from "../src/authority/engine.js";
import { runTick } from "../src/agent/watcher.js";

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
    [Mandate, Approval, AuditLog, Merchant, Agent, UsedNonce, Idempotency, Proposal, PaymentMethod, Address].map((m) => m.deleteMany({}))
  );
  await seed();
});

/* ----------------------------- helpers ----------------------------- */

const asHuman = { "content-type": "application/json", "x-human-id": DEMO.humanId };
const post = (path, body, headers = { "content-type": "application/json" }) =>
  fetch(`${authorityUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

/** O meio de pagamento vem da carteira, como na UI. */
async function walletMethod() {
  const r = await fetch(`${authorityUrl}/wallet/methods`, {
    method: "POST",
    headers: asHuman,
    body: JSON.stringify({ rail: "card", instrument: { number: "4242424242424242" } }),
  });
  return (await r.json()).methodId;
}

/** "Tênis tam. 40, até R$100, só do Brasil" — o mandato da demo. */
async function shoeMandate(over = {}) {
  const { mandateId } = await post(
    "/mandates",
    {
      agentId: DEMO.agentId,
      mode: "autonomo",
      currency: "BRL",
      paymentMethodId: await walletMethod(),
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
  const out = await shop(mandateId, { strategy: "cheapest" });
  const { chosen, result } = out;

  // Ele pegou de fato a mais barata de todas, cabendo ou nao -- e nao a mais
  // barata que cabe.  (Sem fixar o SKU: o catalogo e mock e muda; o que o teste
  // guarda e o comportamento, nao o inventario.)
  const cheapest = out.comparison.reduce((a, b) => (b.price < a.price ? b : a));
  assert.equal(chosen.productId, cheapest.productId);
  assert.equal(chosen.fits, false);

  // E a Autoridade recusou, nomeando a regra que barrou.
  assert.equal(result.ok, false);
  assert.equal(result.action, "reject");
  assert.match(result.reasonText, /fails/);

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

test("O VIGIA: o preco cai na loja e a compra acontece sozinha", async () => {
  // Teto abaixo de tudo o que esta a venda hoje: nada cabe, e o agente na
  // conversa nao teria o que comprar.
  const mandateId = await shoeMandate({
    maxUses: 1,
    constraints: [
      { attr: "category", op: "eq", value: "calcado", on_missing: "deny", on_fail: "deny" },
      { attr: "size", op: "eq", value: "40", on_missing: "deny", on_fail: "deny" },
      { attr: "price", op: "lte", value: 7000, on_missing: "deny", on_fail: "deny" },
    ],
  });

  const stores = [
    { id: "store_a", url: storeServers[0].url },
    { id: "store_b", url: storeServers[1].url },
  ];
  const deps = { stores, agentId: DEMO.agentId, agentSecret: DEMO.agentSecret };

  // Primeiro tique: nada cabe, nada acontece.
  assert.deepEqual(await runTick(deps), []);

  // O operador da Loja B baixa o preco no painel.
  const patched = await fetch(`${storeServers[1].url}/catalog/B-SNEAK-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ price: 6500 }),
  });
  assert.equal(patched.status, 200);

  // Tique seguinte: o vigia acha, tenta, e a Autoridade aprova.
  const done = await runTick(deps);
  assert.equal(done.length, 1);
  assert.equal(done[0].item.productId, "B-SNEAK-2");
  assert.equal(done[0].item.price, 6500);
  assert.equal(done[0].result.ok, true);

  // E o mandato se ENCERRA sozinho: uma compra, e acabou.
  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 1);
  assert.equal(mandateStatus(m), "exhausted");

  // Esgotado, o vigia nao o toca mais.
  assert.deepEqual(await runTick(deps), []);

  // A compra do vigia e distinguivel da compra da conversa pelo prefixo.
  const trail = await AuditLog.find({ mandateId, event: "purchase_decision" }).lean();
  assert.ok(trail.some((e) => e.idempotencyKey?.startsWith("watch:")));

  // Devolve o preco, para nao contaminar os outros testes (catalogo e modulo).
  await fetch(`${storeServers[1].url}/catalog/B-SNEAK-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ price: 9400 }),
  });
});

test("O VIGIA no modo aprovacao: escala em vez de comprar, e conclui depois do sim", async () => {
  const mandateId = await shoeMandate({ mode: "aprovacao", maxUses: 1 });
  const deps = {
    stores: [
      { id: "store_a", url: storeServers[0].url },
      { id: "store_b", url: storeServers[1].url },
    ],
    agentId: DEMO.agentId,
    agentSecret: DEMO.agentSecret,
  };

  const first = await runTick(deps);
  assert.equal(first[0].result.ok, false);
  assert.equal(first[0].result.action, "escalate");

  // A pendencia esperava o humano -- que pode ter estado dormindo.
  const pend = await fetch(`${authorityUrl}/approvals`, { headers: asHuman }).then((r) => r.json());
  assert.equal(pend.length, 1);
  await post(`/approvals/${pend[0].approvalId}/approve`, {}, asHuman);

  // O tique seguinte reencontra a oportunidade, e agora a aprovacao casa.
  // E isto que faz o modo aprovacao valer ao longo do tempo.
  const second = await runTick(deps);
  assert.equal(second[0].result.ok, true);
});

test("a loja ATESTA o productId, entao 'compre exatamente este item' funciona", async () => {
  const { items } = await fetch(`${authorityUrl}/agent/catalogs?q=`).then((r) => r.json());
  const soap = items.find((i) => i.productId === "B-SOAP-1");
  assert.ok(soap, "o sabonete existe no catalogo");

  const mandateId = await shoeMandate({
    maxUses: 1,
    constraints: [{ attr: "productId", op: "eq", value: "B-SOAP-1", on_missing: "deny", on_fail: "deny" }],
  });

  const deps = {
    stores: [
      { id: "store_a", url: storeServers[0].url },
      { id: "store_b", url: storeServers[1].url },
    ],
    agentId: DEMO.agentId,
    agentSecret: DEMO.agentSecret,
  };

  // O vigia varre o catalogo inteiro; so o item nomeado pode passar.
  const done = await runTick(deps);
  assert.equal(done.length, 1);
  assert.equal(done[0].item.productId, "B-SOAP-1");
  assert.equal(done[0].result.ok, true);
});

test("CATEGORIA E GROSSA DEMAIS: 'eletronico ate R$150' compra uma luminaria", async () => {
  // O bug que motivou `product_type`. O mandato diz "eletronico ate R$150" e a
  // Autoridade esta CERTA em aceitar a luminaria: ela cabe nas regras. O erro
  // esta antes -- o mandato nao conseguiu dizer "fone".
  const mandateId = await shoeMandate({
    maxUses: 1,
    constraints: [
      { attr: "category", op: "eq", value: "eletronico", on_missing: "deny", on_fail: "deny" },
      { attr: "price", op: "lte", value: 15000, on_missing: "deny", on_fail: "deny" },
    ],
  });
  const deps = {
    stores: [
      { id: "store_a", url: storeServers[0].url },
      { id: "store_b", url: storeServers[1].url },
    ],
    agentId: DEMO.agentId,
    agentSecret: DEMO.agentSecret,
  };
  const done = await runTick(deps);
  assert.equal(done[0].result.ok, true);
  assert.equal(done[0].item.product_type, "desk_lamp"); // nao era o que se queria
});

test("product_type e o que faz o mandato dizer 'fone' — e a luminaria nao passa", async () => {
  const mandateId = await shoeMandate({
    maxUses: 1,
    constraints: [
      { attr: "product_type", op: "eq", value: "headphones", on_missing: "deny", on_fail: "deny" },
      { attr: "price", op: "lte", value: 15000, on_missing: "deny", on_fail: "deny" },
    ],
  });
  const deps = {
    stores: [
      { id: "store_a", url: storeServers[0].url },
      { id: "store_b", url: storeServers[1].url },
    ],
    agentId: DEMO.agentId,
    agentSecret: DEMO.agentSecret,
  };

  // Nenhum fone cabe em R$150 hoje (R$239 e R$249), entao nada e comprado --
  // e, crucialmente, a luminaria de R$89,90 NAO e comprada no lugar.
  assert.deepEqual(await runTick(deps), []);

  const m = await Mandate.findById(mandateId).lean();
  assert.equal(m.usedCount, 0);

  // Baixe o preco do fone e ele compra o FONE.
  await fetch(`${storeServers[1].url}/catalog/B-HEAD-1`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ price: 12900 }),
  });
  const done = await runTick(deps);
  assert.equal(done[0].item.productId, "B-HEAD-1");
  assert.equal(done[0].result.ok, true);

  await fetch(`${storeServers[1].url}/catalog/B-HEAD-1`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ price: 23900 }),
  });
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
