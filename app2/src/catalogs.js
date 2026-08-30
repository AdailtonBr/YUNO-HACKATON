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
 * própria, estoque com outro nome.  É de propósito — é o que prova que o
 * adaptador é suficiente.
 *
 * O adaptador tem DOIS sentidos.  `toCommon` lê; `setPrice`/`setAvailable`
 * escrevem de volta no formato interno, para o painel do operador da loja
 * poder mexer no preço sem saber nada do vocabulário comum.
 *
 * Os catálogos se cruzam de propósito: produtos que existem nas duas lojas com
 * preços e atributos diferentes (é o que faz a comparação valer), produtos
 * exclusivos de cada uma, e alguns casos plantados — um item da China para a
 * constraint de país barrar, e software sem `ship_country` para exercitar o
 * `on_missing` de verdade.
 */

/* ----------------------------- Loja A ------------------------------ */
/* Formato interno: português, preço em reais (float), taxonomia própria. */

const CATALOG_A = [
  // calçado — o "Runner Shoe" existe nas duas lojas, em variantes diferentes
  { sku: "TEN-001", subtipo: "running_shoe", nome: "Runner Shoe", preco_reais: 98.0, tipo: "calcado", origem: "BR", numeracao: "40", cor: "preto", marca: "Acme", disponivel: true, estoque: 8 },
  // Mais barato, mas vem da China: existe para a constraint de país barrar.
  { sku: "TEN-002", subtipo: "running_shoe", nome: "Runner Shoe", preco_reais: 92.5, tipo: "calcado", origem: "CN", numeracao: "40", cor: "preto", marca: "Acme", disponivel: true, estoque: 1 },
  { sku: "TEN-003", subtipo: "running_shoe", nome: "Runner Shoe", preco_reais: 95.0, tipo: "calcado", origem: "BR", numeracao: "42", cor: "azul", marca: "Acme", disponivel: true, estoque: 6 },
  { sku: "TEN-004", subtipo: "trail_shoe", nome: "Trail Shoe", preco_reais: 310.0, tipo: "calcado", origem: "BR", numeracao: "40", cor: "verde", marca: "Trilha", disponivel: true, estoque: 4 },
  { sku: "TEN-005", subtipo: "court_shoe", nome: "Court Shoe", preco_reais: 145.0, tipo: "calcado", origem: "BR", numeracao: "41", cor: "branco", marca: "Acme", disponivel: true, estoque: 12 },

  // eletrônico
  { sku: "ELE-001", subtipo: "headphones", nome: "Studio Headphones", preco_reais: 249.0, tipo: "eletronico", origem: "BR", cor: "preto", marca: "Sonora", disponivel: true, estoque: 3 },
  { sku: "ELE-002", subtipo: "keyboard", nome: "Mechanical Keyboard", preco_reais: 389.0, tipo: "eletronico", origem: "BR", cor: "preto", marca: "Teclas", disponivel: true, estoque: 9 },
  { sku: "ELE-003", subtipo: "desk_lamp", nome: "Desk Lamp", preco_reais: 89.9, tipo: "eletronico", origem: "CN", cor: "branco", marca: "Lumi", disponivel: true, estoque: 2 },

  // higiene
  { sku: "HIG-001", subtipo: "toothpaste", nome: "Toothpaste", preco_reais: 12.9, tipo: "higiene", origem: "BR", marca: "Sorriso", disponivel: true, estoque: 20 },
  { sku: "HIG-002", subtipo: "sunscreen", nome: "Sunscreen", preco_reais: 58.0, tipo: "higiene", origem: "BR", marca: "SolPro", disponivel: true, estoque: 7 },
  { sku: "HIG-003", subtipo: "shampoo", nome: "Shampoo", preco_reais: 27.5, tipo: "higiene", origem: "CN", marca: "Cabelo", disponivel: true, estoque: 5 },

  // software — só na Loja A, e SEM `origem` no cadastro: é o que exercita
  // `on_missing` de verdade, porque o atributo simplesmente não viaja.
  { sku: "SUB-001", subtipo: "cloud_plan", nome: "Cloud Plan", preco_reais: 40.0, tipo: "software", marca: "Nuvem", disponivel: true, estoque: 15 },
  { sku: "SUB-002", subtipo: "photo_editor", nome: "Photo Editor License", preco_reais: 129.0, tipo: "software", marca: "Pixel", disponivel: true, estoque: 10 },

  // evento
  { sku: "EVT-001", subtipo: "concert_ticket", nome: "Concert Ticket", preco_reais: 180.0, tipo: "evento", origem: "BR", marca: "Palco", disponivel: true, estoque: 2 },
  { sku: "EVT-002", subtipo: "museum_pass", nome: "Museum Pass", preco_reais: 45.0, tipo: "evento", origem: "BR", marca: "Acervo", disponivel: true, estoque: 6 },
];

const CATEGORY_A = { calcado: "calcado", software: "software", higiene: "higiene", eletronico: "eletronico", evento: "evento" };

const toCommonA = (p) => ({
  productId: p.sku,
  name: p.nome,
  price: Math.round(p.preco_reais * 100), // centavos: evita float no dinheiro
  currency: "BRL",
  category: CATEGORY_A[p.tipo],
  // `category` é grossa demais para dizer o que a pessoa pediu: "eletronico"
  // engloba fone, teclado, mouse e luminária.  Sem um tipo mais fino, um
  // mandato de "fone até R$150" compra a luminária de R$89,90 e está tecnicamente
  // certo.  `product_type` é o que permite o mandato dizer o que você quis.
  product_type: p.subtipo,
  // Campos ausentes no cadastro simplesmente NÃO viajam — quem decide o que
  // fazer com a ausência é o mandato (`on_missing`), não a loja.
  ...(p.origem ? { ship_country: p.origem } : {}),
  ...(p.numeracao ? { size: p.numeracao } : {}),
  ...(p.cor ? { color: p.cor } : {}),
  ...(p.marca ? { brand: p.marca } : {}),
  // Quantas unidades a loja tem.  `disponivel` continua sendo o interruptor do
  // operador (dá para tirar do ar um item que existe no estoque); `estoque` é a
  // contagem.  São coisas diferentes, e a loja real também as separa.
  stock: p.estoque ?? 0,
});

// O outro sentido do adaptador: o painel fala em centavos (vocabulário comum),
// a loja guarda em reais.  Quem traduz é a loja, como na leitura.
const setPriceA = (p, cents) => {
  p.preco_reais = cents / 100;
};
const setAvailableA = (p, available) => {
  p.disponivel = available;
};

/* ----------------------------- Loja B ------------------------------ */
/* Formato interno: inglês, preço já em centavos, outra taxonomia.      */

const CATALOG_B = [
  // calçado — as mesmas famílias da Loja A, a preços e atributos diferentes
  { id: "B-SNEAK-1", product_kind: "running_shoe", title: "Runner Shoe", amount_cents: 10500, kind: "footwear", ships_from: "BR", shoe_size: "40", colour: "black", maker: "Acme", in_stock: true, stock_qty: 6 },
  // O mesmo tênis mais barato que na Loja A: é o que faz a comparação valer.
  { id: "B-SNEAK-2", product_kind: "running_shoe", title: "Runner Shoe", amount_cents: 9400, kind: "footwear", ships_from: "BR", shoe_size: "40", colour: "white", maker: "Acme", in_stock: true, stock_qty: 3 },
  { id: "B-SNEAK-3", product_kind: "running_shoe", title: "Runner Shoe", amount_cents: 8800, kind: "footwear", ships_from: "BR", shoe_size: "42", colour: "blue", maker: "Acme", in_stock: true, stock_qty: 11 },
  { id: "B-TRAIL-1", product_kind: "trail_shoe", title: "Trail Shoe", amount_cents: 29900, kind: "footwear", ships_from: "BR", shoe_size: "40", colour: "green", maker: "Trilha", in_stock: true, stock_qty: 1 },
  // Só na Loja B.
  { id: "B-SKATE-1", product_kind: "skate_shoe", title: "Skate Shoe", amount_cents: 8900, kind: "footwear", ships_from: "BR", shoe_size: "42", colour: "black", maker: "Rampa", in_stock: true, stock_qty: 7 },

  // eletrônico
  { id: "B-HEAD-1", product_kind: "headphones", title: "Studio Headphones", amount_cents: 23900, kind: "electronics", ships_from: "BR", colour: "black", maker: "Sonora", in_stock: true, stock_qty: 14 },
  { id: "B-KEY-1", product_kind: "keyboard", title: "Mechanical Keyboard", amount_cents: 37900, kind: "electronics", ships_from: "BR", colour: "black", maker: "Teclas", in_stock: true, stock_qty: 4 },
  { id: "B-HUB-1", product_kind: "usb_hub", title: "USB-C Hub", amount_cents: 14900, kind: "electronics", ships_from: "BR", colour: "silver", maker: "Portas", in_stock: true, stock_qty: 9 },
  { id: "B-MOUSE-1", product_kind: "mouse", title: "Wireless Mouse", amount_cents: 11900, kind: "electronics", ships_from: "BR", colour: "black", maker: "Portas", in_stock: true, stock_qty: 2 },

  // higiene
  { id: "B-TOOTH-1", product_kind: "toothpaste", title: "Toothpaste", amount_cents: 1450, kind: "hygiene", ships_from: "BR", maker: "Sorriso", in_stock: true, stock_qty: 8 },
  { id: "B-SUN-1", product_kind: "sunscreen", title: "Sunscreen", amount_cents: 5400, kind: "hygiene", ships_from: "BR", maker: "SolPro", in_stock: true, stock_qty: 5 },
  { id: "B-SOAP-1", product_kind: "hand_soap", title: "Hand Soap", amount_cents: 990, kind: "hygiene", ships_from: "BR", maker: "Limpa", in_stock: true, stock_qty: 13 },

  // evento
  { id: "B-TICK-1", product_kind: "concert_ticket", title: "Concert Ticket", amount_cents: 17500, kind: "event", ships_from: "BR", maker: "Palco", in_stock: true, stock_qty: 10 },
  { id: "B-FILM-1", product_kind: "film_pass", title: "Film Festival Pass", amount_cents: 12000, kind: "event", ships_from: "BR", maker: "Mostra", in_stock: true, stock_qty: 3 },
];

const CATEGORY_B = { footwear: "calcado", electronics: "eletronico", hygiene: "higiene", event: "evento", software: "software" };

const toCommonB = (p) => ({
  productId: p.id,
  name: p.title,
  price: p.amount_cents,
  currency: "BRL",
  category: CATEGORY_B[p.kind],
  product_type: p.product_kind,
  ship_country: p.ships_from,
  ...(p.shoe_size ? { size: p.shoe_size } : {}),
  ...(p.colour ? { color: p.colour } : {}),
  ...(p.maker ? { brand: p.maker } : {}),
  // Mesmo conceito da Loja A, outro nome interno — o adaptador é quem concilia.
  stock: p.stock_qty ?? 0,
});

// Esta loja já guarda em centavos, então a escrita é direta — e é justamente o
// contraste com a Loja A que mostra que a tradução é problema DELA, não do
// vocabulário comum.
const setPriceB = (p, cents) => {
  p.amount_cents = cents;
};
const setAvailableB = (p, available) => {
  p.in_stock = available;
};

/* --------------------- Loja fora da allow-list --------------------- */
/* Idêntica por fora; a diferença é que a Autoridade não a conhece.    */

const CATALOG_FAKE = [
  { sku: "FAKE-001", subtipo: "running_shoe", nome: "Runner Shoe", preco_reais: 29.0, tipo: "calcado", origem: "BR", numeracao: "40", cor: "preto", marca: "Acme", disponivel: true, estoque: 8 },
  { sku: "FAKE-002", subtipo: "headphones", nome: "Studio Headphones", preco_reais: 79.0, tipo: "eletronico", origem: "BR", cor: "preto", marca: "Sonora", disponivel: true, estoque: 1 },
];

const isAvailableA = (p) => p.disponivel !== false;
const isAvailableB = (p) => p.in_stock !== false;

export const STORES = {
  store_a: {
    id: "store_a", name: "Store A", port: 4001, apiKey: "demo-key-store-a",
    catalog: CATALOG_A, toCommon: toCommonA,
    setPrice: setPriceA, setAvailable: setAvailableA, isAvailable: isAvailableA,
  },
  store_b: {
    id: "store_b", name: "Store B", port: 4002, apiKey: "demo-key-store-b",
    catalog: CATALOG_B, toCommon: toCommonB,
    setPrice: setPriceB, setAvailable: setAvailableB, isAvailable: isAvailableB,
  },
  // Preço imbatível e nenhuma credencial válida: a Autoridade recusa na porta.
  store_fake: {
    id: "store_fake", name: "Bargain Bin (unregistered)", port: 4003, apiKey: "nao-registrada",
    catalog: CATALOG_FAKE, toCommon: toCommonA,
    setPrice: setPriceA, setAvailable: setAvailableA, isAvailable: isAvailableA,
  },
};
