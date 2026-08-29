/**
 * Motor de constraints — o coração do sistema.  Ver `docs/04-constraint-engine.md`.
 *
 * É uma FUNÇÃO PURA: recebe tudo o que precisa e não toca em I/O.  Quem busca o
 * mandato, o bilhete verificado e a eventual aprovação no banco é a Autoridade,
 * que os passa em `ctx`.  Isso mantém o coração do sistema trivialmente testável.
 *
 * A cripto acontece ANTES, fora daqui: a Autoridade verifica a assinatura do
 * `purchaseTicket`, o nonce e o exp, e só então passa o payload em `ctx.ticket`.
 * O motor não assina nem valida assinatura — ele COMPARA campos.
 *
 * O motor é genérico: não conhece "tênis", "assinatura" nem "cimento".  Toda a
 * variabilidade vive nos DADOS do mandato, nunca em ramos de código.
 */

/** Operadores suportados nas constraints.  Vocabulário fechado, de propósito. */
export const OPS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
};

/**
 * `reason` é um CÓDIGO estruturado, nunca uma frase pronta.  Duas razões:
 * a frase para o humano é renderizada por `messages.js` (i18n PT-BR -> EN sem
 * caçar string no código), e o `audit_log` guarda algo estável de auditar.
 */
const ok = () => ({ valid: true });
const deny = (code, params = {}) => ({ valid: false, action: "reject", reason: { code, params } });
const escalate = (code, params = {}) => ({ valid: false, action: "escalate", reason: { code, params } });

/**
 * A aprovação humana é grudada NAQUELA compra e vale UMA vez.  Aprovar um tênis
 * de R$98 não pode virar cheque em branco para outra coisa de R$300.
 */
export function approvalMatches(approval, mandate, purchase, ctx) {
  const now = ctx.now ?? new Date();
  return (
    !!approval &&
    approval.status === "approved" &&
    approval.mandateId === mandate._id &&
    approval.merchantId === ctx.authenticatedMerchantId &&
    approval.productId === purchase.productId &&
    approval.price === purchase.price &&
    approval.consumedAt == null &&
    approval.expiresAt > now
  );
}

/**
 * @param mandate   documento do mandato (fonte da verdade, lida do banco)
 * @param purchase  { productId, price, currency, attributes } — ATESTADO PELA LOJA
 * @param ctx       { ticket, authenticatedMerchantId, approval, now }
 *                  - ticket: payload do purchaseTicket JÁ VERIFICADO.  O agentId
 *                    sai daqui — nunca do corpo, nunca da palavra da loja.
 *                  - authenticatedMerchantId: da apiKey da loja, nunca do corpo.
 *                  - approval: aprovação humana desta compra, se houver.
 */
export function evaluate(mandate, purchase, ctx) {
  const { ticket, authenticatedMerchantId, approval, now = new Date() } = ctx;

  // 0) O bilhete descreve ESTA compra, nesta loja, sob este mandato.
  //    Fecha a loja registrada inventando uma cobrança sozinha (ela conhece o
  //    mandateId de uma compra anterior, mas não consegue assinar um bilhete),
  //    e fecha o replay de um bilhete legítimo em outra loja.
  if (!ticket) return deny("ticket_missing");
  if (ticket.mandateId !== mandate._id) return deny("ticket_mandate_mismatch");
  if (ticket.merchantId !== authenticatedMerchantId) return deny("ticket_merchant_mismatch");
  if (ticket.productId !== purchase.productId) return deny("ticket_product_mismatch");

  //    O VERIFICADO é o COBRADO: o valor que a loja atesta tem que ser exatamente
  //    o que o agente escolheu.  As constraints são TETOS — com "no máximo R$100",
  //    R$98 e R$99,99 passam igual, e só o bilhete diz qual foi pedido.
  if (ticket.price !== purchase.price) return deny("ticket_price_mismatch");
  if (ticket.currency !== purchase.currency) return deny("ticket_currency_mismatch");

  //    E a moeda do mandato manda: o motor compara price como número puro, então
  //    sem isto `price lte 10000` aprovaria US$100 do mesmo jeito que R$100.
  if (mandate.currency !== purchase.currency) return deny("currency_outside_mandate");

  // 1) Estado do mandato — checagens VIVAS.  É aqui que a abordagem B ganha:
  //    a verdade sobre "ainda vale?" é lida no instante da compra.
  if (mandate.revoked) return deny("revoked");
  if (mandate.expiresAt < now) return deny("expired");
  if (mandate.maxUses != null && mandate.usedCount >= mandate.maxUses) return deny("uses_exhausted");

  // 2) Dono: identidade PROVADA (assinatura do agente), não declarada por ninguém.
  if (ticket.agentId !== mandate.agentId) return deny("agent_not_owner");

  // 3) Constraints de atributo (motor genérico).
  for (const c of mandate.constraints) {
    const real = purchase.attributes?.[c.attr];

    if (real === undefined) {
      // AUSÊNCIA -> on_missing.  "Não sei" é um estado diferente de "sei que não".
      if (c.on_missing === "allow") continue;
      if (c.on_missing === "escalate") return escalate("attribute_missing", { attr: c.attr });
      return deny("attribute_missing", { attr: c.attr }); // default: deny
    }

    const op = OPS[c.op];
    // Operador desconhecido é erro de DADOS, não dúvida sobre a compra: nega, nunca escala.
    if (!op) return deny("unknown_operator", { op: c.op });

    if (!op(real, c.value)) {
      // FALHA -> on_fail.  Fora do mandato recusa OU escala, nunca aprova em silêncio.
      const params = { attr: c.attr, op: c.op, value: c.value, actual: real };
      return c.on_fail === "escalate"
        ? escalate("constraint_failed", params)
        : deny("constraint_failed", params); // default: deny
    }
  }

  // 4) Modo do mandato: a aprovação por compra é imposta AQUI, na Autoridade,
  //    e não no agente.  Se a trava vivesse no agente, bastaria ele não lê-la.
  if (mandate.mode === "aprovacao" && !approvalMatches(approval, mandate, purchase, ctx)) {
    return escalate("approval_required");
  }

  return ok();
}

/** `status` é DERIVADO, nunca gravado.  Esgotado ≠ revogado. */
export function mandateStatus(mandate, now = new Date()) {
  if (mandate.revoked) return "revoked";
  if (mandate.expiresAt < now) return "expired";
  if (mandate.maxUses != null && mandate.usedCount >= mandate.maxUses) return "exhausted";
  return "active";
}
