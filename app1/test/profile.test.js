/**
 * Testes do perfil de atributos.
 *
 * Este arquivo existe por causa de um bug concreto: o agente anunciou
 * *"pastas de dente de duas marcas, Sorriso e Sorriso"*.  Ele não alucinou —
 * a nossa tool disse a ele que `brand` variava, porque o perfil estava sendo
 * calculado sobre o catálogo INTEIRO, onde marca varia trivialmente (tênis e
 * pasta de dente diferem em tudo).
 *
 * O que estes testes guardam é a afirmação central do projeto: *o agente
 * pergunta sobre um atributo porque ele varia no catálogo real*.  Com o
 * conjunto errado, "varia" não quer dizer nada, e a afirmação vira falsa.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { attributeProfile } from "../src/agent/llm.js";
import { STORES } from "../../app2/src/catalogs.js";

const all = [
  ...STORES.store_a.catalog.map(STORES.store_a.toCommon),
  ...STORES.store_b.catalog.map(STORES.store_b.toCommon),
];
const byName = (name) => all.filter((i) => i.name === name);

test("O BUG: sobre o catalogo inteiro, marca 'varia' trivialmente", () => {
  const p = attributeProfile(all);
  assert.equal(p.brand.varies, true);
  assert.ok(p.brand.distinct_values.length > 5);
  // E o mesmo vale para tudo o mais: nao ha pergunta que nao se justifique.
  assert.equal(p.size.varies, true);
  assert.equal(p.color.varies, true);
  assert.equal(p.category.varies, true);
});

test("O CONSERTO: sobre as pastas de dente, marca NAO varia", () => {
  const paste = byName("Toothpaste");
  assert.equal(paste.length, 2); // uma em cada loja
  const p = attributeProfile(paste);

  // As duas sao Sorriso. Nao ha o que perguntar sobre marca.
  assert.equal(p.brand.varies, false);
  assert.deepEqual(p.brand.distinct_values, ["Sorriso"]);

  // Nem sobre pais de origem, nem categoria.
  assert.equal(p.ship_country.varies, false);
  assert.equal(p.category.varies, false);

  // O que de fato varia entre elas e o preco -- e e so sobre isso que o
  // agente deveria perguntar.
  assert.equal(p.price.varies, true);
});

test("entre os tenis, tamanho e cor variam de verdade — e ai perguntar e certo", () => {
  const p = attributeProfile(byName("Runner Shoe"));
  assert.equal(p.size.varies, true);
  assert.equal(p.ship_country.varies, true); // ha um vindo da China
  assert.equal(p.category.varies, false); // todos sao calcado
});

test("um candidato so: nada varia, entao nao ha pergunta a fazer", () => {
  const p = attributeProfile([all[0]]);
  for (const k of Object.keys(p)) assert.equal(p[k].varies, false, `${k} nao deveria variar`);
});

test("atributo ausente em parte dos candidatos aparece em present_in", () => {
  // O software da Loja A nao tem `ship_country` no cadastro -- e o que faz o
  // `on_missing` valer alguma coisa.
  const soft = all.filter((i) => i.category === "software");
  const p = attributeProfile(soft);
  assert.equal(p.ship_country, undefined); // nenhum deles informa
  assert.equal(p.price.present_in, soft.length);
});
