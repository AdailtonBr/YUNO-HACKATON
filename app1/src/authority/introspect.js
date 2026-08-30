/**
 * `/introspect` — o coração do sistema.  Ver `docs/03`, `docs/04`, `docs/05`.
 *
 * Ordem das amarras (cada uma fecha um ataque nomeado nos docs):
 *   1. idempotência       -> retentativa não cobra duas vezes
 *   2. mandato existe     -> id opaco de alta entropia, sem enumeração
 *   3. bilhete verificado -> a LOJA não afirma quem é o agente; ela transporta a prova
 *   4. motor (puro)       -> constraints, estado vivo, dono, portão de aprovação
 *   5. nonce + consumo atômicos -> replay e TOCTOU
 *   6. cobrança           -> e COMPENSAÇÃO se o cofre recusar
 *   7. audit_log          -> append-only, base da disputa
 */

import { Mandate, Agent, Approval, UsedNonce, AuditLog, Idempotency } from "./models.js";
import { verifyTicket, peekAgentId, opaqueId } from "./ticket.js";
import { evaluate } from "./engine.js";
import { charge } from "./vault.js";

const APPROVAL_TTL_MS = 15 * 60 * 1000;

async function audit(entry) {
  await AuditLog.create({ _id: opaqueId("aud"), ...entry });
}

const reject = (code, params = {}) => ({ valid: false, action: "reject", reason: { code, params } });

/**
 * @param body { mandateId, purchase: { productId, price, currency, attributes }, purchaseTicket, idempotencyKey }
 * @param ctx  { merchantId }  <- da apiKey AUTENTICADA da loja, nunca do corpo
 */
export async function introspect(body, { merchantId }) {
  const { mandateId, purchase, purchaseTicket, idempotencyKey } = body ?? {};
  const now = new Date();

  // 1) Idempotência.  A retentativa é o caminho NORMAL aqui (o agente retenta
  //    depois de uma aprovação, e qualquer rede perde respostas).  Mesma chave
  //    -> mesma resposta gravada, sem reavaliar, consumir uso ou cobrar.
  const idemId = idempotencyKey ? `${merchantId}:${idempotencyKey}` : null;
  if (idemId) {
    const seen = await Idempotency.findById(idemId).lean();
    if (seen) return seen.response;
  }
  /**
   * Memoriza só o que é DESFECHO.
   *
   * `escalate` não é desfecho — é "volte depois que o humano decidir".  Guardar
   * a escalada faz a retentativa devolver a resposta velha, e a compra nunca
   * consegue se concluir depois da aprovação: a pendência fica pendurada para
   * sempre.  E não guardar é seguro, porque uma escalada não cobra nada — a
   * idempotência existe para impedir cobrança dupla, não para congelar espera.
   *
   * (O caminho do chat escapava disso por acidente, gerando uma chave nova a
   * cada tentativa.  O vigia, que deriva a chave de propósito para não cobrar
   * duas vezes, foi quem revelou o problema.)
   */
  const remember = async (response) => {
    const terminal = response.valid || response.action === "reject";
    if (idemId && terminal) await Idempotency.create({ _id: idemId, response }).catch(() => {});
    return response;
  };

  const mandate = await Mandate.findById(mandateId).lean();
  if (!mandate) return remember(reject("unknown_mandate"));

  // 3) O bilhete.  Lemos o agentId do payload SEM confiar nele — só para achar
  //    o segredo.  A confiança vem da assinatura conferir, logo abaixo.
  const claimedAgentId = peekAgentId(purchaseTicket);
  const agent = claimedAgentId ? await Agent.findById(claimedAgentId).lean() : null;
  if (!agent || !agent.active) return remember(reject("unknown_agent"));

  const verified = verifyTicket(purchaseTicket, agent.hmacSecret, { now });
  if (!verified.ok) return remember(reject(verified.code));
  const ticket = verified.payload;

  // 4) Aprovação humana desta compra exata, se existir.  A busca é estreita de
  //    propósito: aprovar um tênis de R$98 não pode virar cheque em branco.
  const approval = await Approval.findOne({
    mandateId,
    merchantId,
    productId: purchase?.productId,
    price: purchase?.price,
    status: "approved",
    consumedAt: null,
    expiresAt: { $gt: now },
  }).lean();

  const decision = evaluate(mandate, purchase, {
    ticket,
    authenticatedMerchantId: merchantId,
    approval,
    now,
  });

  const base = {
    mandateId,
    merchantId,
    agentIdAuthenticated: ticket.agentId,
    purchase,
    idempotencyKey: idempotencyKey ?? null,
    actor: { type: "agent", id: ticket.agentId },
    // O veredito regra a regra vai para o trilho: uma decisão sobre dinheiro
    // tem que poder ser reconstituída, não só relembrada pelo resultado.
    trace: decision.trace ?? [],
  };

  // --- Escalonamento: a AUTORIDADE grava a pendência.  O agente não escreve nada.
  if (!decision.valid && decision.action === "escalate") {
    const existing = await Approval.findOne({
      mandateId,
      merchantId,
      productId: purchase.productId,
      price: purchase.price,
      status: "pending",
      expiresAt: { $gt: now },
    }).lean();

    const approvalId = existing?._id ?? opaqueId("apr");
    if (!existing) {
      await Approval.create({
        _id: approvalId,
        mandateId,
        humanId: mandate.humanId,
        merchantId,
        productId: purchase.productId,
        price: purchase.price, // congelado: o humano aprova um número
        currency: purchase.currency,
        attributes: purchase.attributes ?? {},
        origin: decision.reason.code === "approval_required" ? "mode_aprovacao" : "on_fail",
        reason: decision.reason,
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
      });
    }

    const response = { ...decision, approvalRequestId: approvalId };
    await audit({ ...base, event: "purchase_decision", decision: "escalado", reason: decision.reason, approvalId });
    return remember(response);
  }

  if (!decision.valid) {
    await audit({ ...base, event: "purchase_decision", decision: "recusado", reason: decision.reason });
    return remember(decision);
  }

  // --- 5) Anti-replay e consumo, ATÔMICOS.
  //     O nonce primeiro: um bilhete vale uma vez, mesmo que duas requisições
  //     concorrentes cheguem juntas (índice único no _id resolve a corrida).
  try {
    await UsedNonce.create({
      _id: ticket.nonce,
      agentId: ticket.agentId,
      expiresAt: new Date(ticket.exp * 1000),
    });
  } catch {
    return remember(reject("ticket_replayed"));
  }

  //     Consumo condicional: a mesma operação que aprova incrementa `usedCount`.
  //     Fecha a janela entre "verificou" e "usou" — se o humano revogou nesse
  //     intervalo, a condição não casa e ninguém é cobrado.
  const consumed = await Mandate.findOneAndUpdate(
    {
      _id: mandateId,
      revoked: false,
      expiresAt: { $gt: now },
      $expr: { $lt: ["$usedCount", "$maxUses"] },
    },
    { $inc: { usedCount: 1 } },
    { new: true }
  ).lean();

  if (!consumed) {
    const raced = reject("uses_exhausted");
    await audit({ ...base, event: "purchase_decision", decision: "recusado", reason: raced.reason });
    return remember(raced);
  }

  //     A aprovação usada é consumida na mesma passagem, para não valer duas vezes.
  if (approval) {
    await Approval.updateOne({ _id: approval._id, consumedAt: null }, { $set: { consumedAt: now } });
  }

  // --- 6) Cobrança.  Quem lê a ref e chama o cofre é a AUTORIDADE.
  const receipt = charge({
    paymentMethodRef: mandate.paymentMethodRef,
    amount: purchase.price, // o VERIFICADO é o COBRADO
    currency: purchase.currency,
    merchantId,
    idempotencyKey,
  });

  if (receipt.status !== "pago") {
    // COMPENSAÇÃO: o uso foi consumido antes da cobrança (é o que fecha o TOCTOU).
    // Se o cofre recusa, devolvemos o uso e reabrimos a aprovação — senão uma
    // falha de pagamento queimaria um uso do mandato sem entregar nada.
    await Mandate.updateOne({ _id: mandateId }, { $inc: { usedCount: -1 } });
    if (approval) await Approval.updateOne({ _id: approval._id }, { $set: { consumedAt: null } });

    const failed = reject("payment_declined", { reason: receipt.reason });
    await audit({ ...base, event: "payment_result", decision: "recusado", reason: failed.reason });
    return remember(failed);
  }

  const response = { valid: true, receiptId: receipt.receiptId, trace: decision.trace ?? [] };
  await audit({
    ...base,
    event: "purchase_decision",
    decision: "valido",
    approvalId: approval?._id ?? null,
    receiptId: receipt.receiptId,
  });
  await audit({
    ...base,
    event: "payment_result",
    actor: { type: "authority", id: "authority" },
    decision: "valido",
    receiptId: receipt.receiptId,
  });

  return remember(response);
}
