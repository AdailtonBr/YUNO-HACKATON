/**
 * Dicionário de strings visíveis ao humano.  Toda frase para pessoa nasce aqui.
 *
 * Duas razões (ver CLAUDE.md, "Idioma"):
 *  - a entrega final é em inglês, e a virada PT-BR -> EN tem que ser trivial;
 *  - o motor devolve CÓDIGOS (`{ code, params }`), nunca frases: o `audit_log`
 *    guarda algo estável de auditar e a apresentação fica separada da decisão.
 */

export const DEFAULT_LOCALE = "en";

const money = (cents, currency, locale) =>
  new Intl.NumberFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: currency || "BRL",
  }).format(cents / 100);

const REASONS = {
  en: {
    ticket_missing: () => "No signed agent ticket was presented.",
    ticket_malformed: () => "The agent ticket is malformed.",
    ticket_bad_signature: () => "The agent ticket signature is invalid.",
    ticket_expired: () => "The agent ticket has expired.",
    ticket_replayed: () => "This agent ticket has already been used.",
    ticket_mandate_mismatch: () => "The ticket was not issued for this mandate.",
    ticket_merchant_mismatch: () => "The ticket was not issued for this store.",
    ticket_product_mismatch: () => "The ticket was not issued for this product.",
    ticket_price_mismatch: () => "The price the store reported is not the price the agent asked for.",
    ticket_quantity_mismatch: () => "The quantity the store reported is not the quantity the agent asked for.",
    ticket_total_mismatch: () => "The total the store reported is not the total the agent signed for.",
    total_mismatch: () => "The total does not match unit price times quantity.",
    quantity_invalid: ({ quantity }) => `Invalid quantity: ${quantity}.`,
    quantity_uncapped: ({ quantity }) =>
      `This mandate has no limit on the total, so it authorises one unit at a time — not ${quantity}. Create a mandate with a total cap to buy more than one.`,
    ticket_currency_mismatch: () => "The currency the store reported is not the one the agent asked for.",
    currency_outside_mandate: () => "The purchase currency is not the mandate's currency.",
    unknown_agent: () => "Unknown or inactive agent.",
    unknown_merchant: () => "Unknown or inactive store.",
    unknown_mandate: () => "No such mandate.",
    revoked: () => "The mandate was revoked.",
    expired: () => "The mandate has expired.",
    uses_exhausted: () => "The mandate has no uses left.",
    agent_not_owner: () => "This agent does not hold this mandate.",
    attribute_missing: (p) => `The store did not report "${p.attr}", and the mandate requires it.`,
    unknown_operator: (p) => `Unknown operator "${p.op}" in the mandate.`,
    constraint_failed: (p) => `"${p.attr}" is ${JSON.stringify(p.actual)}, which fails ${p.op} ${JSON.stringify(p.value)}.`,
    approval_required: () => "This mandate requires your approval for each purchase.",
    approval_refused: () => "You refused this purchase at this price, so it is not being asked again.",
    payment_declined: () => "The payment was declined.",
  },
  "pt-BR": {
    ticket_missing: () => "Nenhum bilhete assinado do agente foi apresentado.",
    ticket_malformed: () => "O bilhete do agente está malformado.",
    ticket_bad_signature: () => "A assinatura do bilhete do agente é inválida.",
    ticket_expired: () => "O bilhete do agente expirou.",
    ticket_replayed: () => "Este bilhete do agente já foi usado.",
    ticket_mandate_mismatch: () => "O bilhete não foi emitido para este mandato.",
    ticket_merchant_mismatch: () => "O bilhete não foi emitido para esta loja.",
    ticket_product_mismatch: () => "O bilhete não foi emitido para este produto.",
    ticket_price_mismatch: () => "O preço informado pela loja não é o preço que o agente pediu.",
    ticket_quantity_mismatch: () => "A quantidade informada pela loja não é a que o agente pediu.",
    ticket_total_mismatch: () => "O total informado pela loja não é o total que o agente assinou.",
    total_mismatch: () => "O total não bate com o preço unitário vezes a quantidade.",
    quantity_invalid: ({ quantity }) => `Quantidade inválida: ${quantity}.`,
    quantity_uncapped: ({ quantity }) =>
      `Este mandato não limita o total, então autoriza uma unidade por vez — não ${quantity}. Para levar mais de uma, crie um mandato com teto de total.`,
    ticket_currency_mismatch: () => "A moeda informada pela loja não é a que o agente pediu.",
    currency_outside_mandate: () => "A moeda da compra não é a do mandato.",
    unknown_agent: () => "Agente desconhecido ou inativo.",
    unknown_merchant: () => "Loja desconhecida ou inativa.",
    unknown_mandate: () => "Mandato inexistente.",
    revoked: () => "O mandato foi revogado.",
    expired: () => "O mandato expirou.",
    uses_exhausted: () => "O mandato não tem usos restantes.",
    agent_not_owner: () => "Este agente não é o dono deste mandato.",
    attribute_missing: (p) => `A loja não informou "${p.attr}", e o mandato exige esse atributo.`,
    unknown_operator: (p) => `Operador desconhecido "${p.op}" no mandato.`,
    constraint_failed: (p) => `"${p.attr}" é ${JSON.stringify(p.actual)}, o que falha em ${p.op} ${JSON.stringify(p.value)}.`,
    approval_required: () => "Este mandato exige sua aprovação a cada compra.",
    approval_refused: () => "Você recusou esta compra por este preço, então ela não é perguntada de novo.",
    payment_declined: () => "O pagamento foi recusado.",
  },
};

/** Renderiza o `{ code, params }` devolvido pelo motor numa frase para o humano. */
export function reasonText(reason, locale = DEFAULT_LOCALE) {
  if (!reason) return null;
  const table = REASONS[locale] ?? REASONS[DEFAULT_LOCALE];
  const fn = table[reason.code] ?? REASONS[DEFAULT_LOCALE][reason.code];
  return fn ? fn(reason.params ?? {}) : reason.code;
}

/* ------------------------------------------------------------------ *
 * Mandato em linguagem natural (D5)
 *
 * Gerado a partir do MESMO JSON que será verificado — nunca escrito à mão
 * pelo agente em paralelo, senão ele descreve "R$100" e grava R$1000.
 * ------------------------------------------------------------------ */

const CONSTRAINT_PHRASE = {
  en: {
    // "per item", não "spend at most": `price` é o preço de UMA unidade, e desde
    // que quantidade existe, chamá-lo de gasto seria descrever o mandato errado
    // para a única pessoa que precisa entendê-lo.
    price: (c, cur) =>
      c.op === "lte" ? `pay at most ${money(c.value, cur, "en")} per item` : `unit price ${c.op} ${c.value}`,
    // Este sim é o teto de gasto: é o que sai da conta.
    total: (c, cur) =>
      c.op === "lte" ? `spend at most ${money(c.value, cur, "en")} in total` : `total ${c.op} ${c.value}`,
    quantity: (c) => (c.op === "lte" ? `at most ${c.value} units` : `quantity ${c.op} ${fmt(c.value)}`),
    category: (c) => (c.op === "eq" ? `buy only ${c.value}` : `category ${c.op} ${fmt(c.value)}`),
    ship_country: (c) => (c.op === "eq" ? `only from sellers in ${c.value}` : `shipping country ${c.op} ${fmt(c.value)}`),
    size: (c) => (c.op === "eq" ? `size ${c.value}` : `size ${c.op} ${fmt(c.value)}`),
    color: (c) => (c.op === "in" ? `in ${fmt(c.value)}` : c.op === "eq" ? `in ${c.value}` : `color ${c.op} ${fmt(c.value)}`),
    brand: (c) => (c.op === "eq" ? `from ${c.value}` : `brand ${c.op} ${fmt(c.value)}`),
    _default: (c) => `${c.attr} ${c.op} ${fmt(c.value)}`,
  },
  "pt-BR": {
    price: (c, cur) =>
      c.op === "lte" ? `pagar no máximo ${money(c.value, cur, "pt-BR")} por unidade` : `preço unitário ${c.op} ${c.value}`,
    total: (c, cur) =>
      c.op === "lte" ? `gastar no máximo ${money(c.value, cur, "pt-BR")} no total` : `total ${c.op} ${c.value}`,
    quantity: (c) => (c.op === "lte" ? `no máximo ${c.value} unidades` : `quantidade ${c.op} ${fmt(c.value)}`),
    category: (c) => (c.op === "eq" ? `comprar só ${c.value}` : `categoria ${c.op} ${fmt(c.value)}`),
    ship_country: (c) => (c.op === "eq" ? `só de vendedores em ${c.value}` : `país de origem ${c.op} ${fmt(c.value)}`),
    size: (c) => (c.op === "eq" ? `tamanho ${c.value}` : `tamanho ${c.op} ${fmt(c.value)}`),
    color: (c) => (c.op === "in" ? `na cor ${fmt(c.value)}` : c.op === "eq" ? `na cor ${c.value}` : `cor ${c.op} ${fmt(c.value)}`),
    brand: (c) => (c.op === "eq" ? `da marca ${c.value}` : `marca ${c.op} ${fmt(c.value)}`),
    _default: (c) => `${c.attr} ${c.op} ${fmt(c.value)}`,
  },
};

const SUFFIX = {
  en: {
    on_fail: " (ask me if it does not match)",
    on_missing: " (ask me if the store does not report it)",
    autonomo: "buy automatically without asking me each time",
    aprovacao: "show me the cart and wait for my approval before paying",
    uses: (n) => (n === 1 ? "one purchase, then the mandate closes" : `up to ${n} purchases`),
    // Não é "a autorização expira em": é "eu vou estar procurando até".  O
    // humano precisa consentir com o robô caçando preço, não só com o teto.
    valid: (d) => `keep looking until ${d} and buy when something fits`,
  },
  "pt-BR": {
    on_fail: " (me perguntar se não bater)",
    on_missing: " (me perguntar se a loja não informar)",
    autonomo: "comprar automaticamente sem me perguntar a cada compra",
    aprovacao: "me mostrar o carrinho e esperar minha aprovação antes de pagar",
    uses: (n) => (n === 1 ? "uma compra, e o mandato se encerra" : `até ${n} compras`),
    valid: (d) => `procurar até ${d} e comprar quando aparecer`,
  },
};

const fmt = (v) => (Array.isArray(v) ? v.join(", ") : String(v));

/**
 * @param draft { mode, constraints, currency, maxUses, expiresAt }
 * O mesmo objeto que vira mandato e que o motor vai avaliar.
 */
export function humanReadable(draft, locale = DEFAULT_LOCALE) {
  const L = SUFFIX[locale] ?? SUFFIX[DEFAULT_LOCALE];
  const P = CONSTRAINT_PHRASE[locale] ?? CONSTRAINT_PHRASE[DEFAULT_LOCALE];

  const parts = (draft.constraints ?? []).map((c) => {
    let phrase = (P[c.attr] ?? P._default)(c, draft.currency);
    // A rigidez faz parte do que o humano consente: escalar não é aprovar.
    if (c.on_fail === "escalate") phrase += L.on_fail;
    else if (c.on_missing === "escalate") phrase += L.on_missing;
    return phrase;
  });

  parts.push(L.uses(draft.maxUses ?? 1));
  if (draft.expiresAt) parts.push(L.valid(new Date(draft.expiresAt).toISOString().slice(0, 10)));
  parts.push(L[draft.mode] ?? draft.mode);

  const sentence = parts.join(locale === "pt-BR" ? ", " : ", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}
