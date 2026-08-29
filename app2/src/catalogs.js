/**
 * Catálogos das lojas (App 2) — MOCK.
 *
 * O ponto arquitetural aqui: cada loja mantém o **banco dela intacto**, no
 * formato dela, e escreve um **adaptador fino** que expõe os campos no
 * vocabulário comum de `docs/03`.  O custo é por LOJA, uma vez — não por
 * produto, não por cliente.  É o mesmo padrão de integrar qualquer gateway.
 *
 * Repare que os dois formatos internos não têm nenhum campo em comum: nomes
 * diferentes, idiomas diferentes, preço em reais vs. centavos, taxonomia
 * própria.  É de propósito — é o que prova que o adaptador é suficiente.
 */

/* ----------------------------- Loja A ------------------------------ */
/* Formato interno: português, preço em reais (float), taxonomia própria. */

const CATALOG_A = [
  { sku: "TEN-001", nome: "Runner Shoe", preco_reais: 98.0, tipo: "calcado", origem: "BR", numeracao: "40", cor: "preto", marca: "Acme" },
  // Mais barato, mas vem da China: existe para a constraint de país barrar.
  { sku: "TEN-002", nome: "Runner Shoe", preco_reais: 92.5, tipo: "calcado", origem: "CN", numeracao: "40", cor: "preto", marca: "Acme" },
  { sku: "TEN-003", nome: "Runner Shoe", preco_reais: 95.0, tipo: "calcado", origem: "BR", numeracao: "42", cor: "azul", marca: "Acme" },
  { sku: "TEN-004", nome: "Trail Shoe", preco_reais: 310.0, tipo: "calcado", origem: "BR", numeracao: "40", cor: "verde", marca: "Trilha" },
  // Só na Loja A. Sem `origem` no cadastro: exercita `on_missing` de verdade.
  { sku: "SUB-001", nome: "Cloud Plan", preco_reais: 40.0, tipo: "software" },
];

const CATEGORY_A = { calcado: "calcado", software: "software", higiene: "higiene" };

const toCommonA = (p) => ({
  productId: p.sku,
  name: p.nome,
  price: Math.round(p.preco_reais * 100), // centavos: evita float no dinheiro
  currency: "BRL",
  category: CATEGORY_A[p.tipo],
  // Campos ausentes no cadastro simplesmente NÃO viajam — quem decide o que
  // fazer com a ausência é o mandato (`on_missing`), não a loja.
  ...(p.origem ? { ship_country: p.origem } : {}),
  ...(p.numeracao ? { size: p.numeracao } : {}),
  ...(p.cor ? { color: p.cor } : {}),
  ...(p.marca ? { brand: p.marca } : {}),
});

/* ----------------------------- Loja B ------------------------------ */
/* Formato interno: inglês, preço já em centavos, outra taxonomia.      */

const CATALOG_B = [
  { id: "B-SNEAK-1", title: "Runner Shoe", amount_cents: 10500, kind: "footwear", ships_from: "BR", shoe_size: "40", colour: "black", maker: "Acme" },
  // O mesmo tênis mais barato que na Loja A: é o que faz a comparação valer.
  { id: "B-SNEAK-2", title: "Runner Shoe", amount_cents: 9400, kind: "footwear", ships_from: "BR", shoe_size: "40", colour: "white", maker: "Acme" },
  // Só na Loja B.
  { id: "B-HEAD-1", title: "Studio Headphones", amount_cents: 25000, kind: "electronics", ships_from: "BR", colour: "black", maker: "Sonora" },
];

const CATEGORY_B = { footwear: "calcado", electronics: "eletronico", hygiene: "higiene" };

const toCommonB = (p) => ({
  productId: p.id,
  name: p.title,
  price: p.amount_cents,
  currency: "BRL",
  category: CATEGORY_B[p.kind],
  ship_country: p.ships_from,
  ...(p.shoe_size ? { size: p.shoe_size } : {}),
  ...(p.colour ? { color: p.colour } : {}),
  ...(p.maker ? { brand: p.maker } : {}),
});

/* --------------------- Loja fora da allow-list --------------------- */
/* Idêntica por fora; a diferença é que a Autoridade não a conhece.    */

const CATALOG_FAKE = [
  { sku: "FAKE-001", nome: "Runner Shoe", preco_reais: 29.0, tipo: "calcado", origem: "BR", numeracao: "40", cor: "preto", marca: "Acme" },
];

export const STORES = {
  store_a: { id: "store_a", name: "Store A", port: 4001, apiKey: "demo-key-store-a", catalog: CATALOG_A, toCommon: toCommonA },
  store_b: { id: "store_b", name: "Store B", port: 4002, apiKey: "demo-key-store-b", catalog: CATALOG_B, toCommon: toCommonB },
  // Preço imbatível e nenhuma credencial válida: a Autoridade recusa na porta.
  store_fake: { id: "store_fake", name: "Bargain Bin (unregistered)", port: 4003, apiKey: "nao-registrada", catalog: CATALOG_FAKE, toCommon: toCommonA },
};
