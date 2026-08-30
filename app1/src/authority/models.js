/**
 * Schemas do Mongo.  Ver `docs/03-data-model-and-api.md`.
 *
 * Convenção: todo `_id` é uma STRING opaca de alta entropia (`opaqueId`), nunca
 * sequencial — um id opaco só é seguro se for imprevisível (anti-enumeração).
 * De brinde, id imprevisível é também a chave de particionamento ideal quando
 * isto escalar (ver `docs/08-scaling.md`).
 */

import mongoose from "mongoose";

const { Schema, model } = mongoose;
const opts = { versionKey: false };

const constraintSchema = new Schema(
  {
    attr: { type: String, required: true },
    op: { type: String, required: true, enum: ["eq", "ne", "lte", "gte", "in"] },
    value: { type: Schema.Types.Mixed, required: true },
    // Eixos INDEPENDENTES: um trata "o atributo não veio", o outro "veio e não bateu".
    on_missing: { type: String, enum: ["deny", "escalate", "allow"], default: "deny" },
    on_fail: { type: String, enum: ["deny", "escalate"], default: "deny" },
  },
  { _id: false }
);

const mandateSchema = new Schema(
  {
    _id: String,
    humanId: { type: String, required: true, index: true }, // da SESSÃO, nunca do corpo
    agentId: { type: String, required: true },
    mode: { type: String, required: true, enum: ["autonomo", "aprovacao"] },
    constraints: { type: [constraintSchema], default: [] },
    currency: { type: String, required: true },
    paymentMethodRef: { type: String, required: true }, // ponteiro opaco, nunca o instrumento
    // Obrigatório: mandato sem limite de usos é cheque em aberto.  Esquecer bloqueia (1), não libera.
    maxUses: { type: Number, required: true, default: 1, min: 1 },
    usedCount: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
    // SÓ o humano vira para true.  Esgotar por uso NÃO revoga — são fatos diferentes.
    revoked: { type: Boolean, required: true, default: false },
    humanReadable: String,
    createdAt: { type: Date, default: Date.now },
  },
  opts
);

const merchantSchema = new Schema(
  { _id: String, name: String, apiKeyHash: String, active: { type: Boolean, default: true } },
  opts
);

const agentSchema = new Schema(
  {
    _id: String,
    humanId: { type: String, required: true },
    // O segredo cru vive no agente e no cofre da Autoridade.  A LOJA nunca o vê.
    hmacSecret: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  opts
);

const approvalSchema = new Schema(
  {
    _id: String,
    mandateId: { type: String, required: true, index: true },
    humanId: { type: String, required: true, index: true },
    merchantId: { type: String, required: true },
    productId: { type: String, required: true },
    price: { type: Number, required: true }, // congelado: o humano aprova um número
    currency: { type: String, required: true },
    attributes: { type: Schema.Types.Mixed, default: {} },
    origin: { type: String, enum: ["mode_aprovacao", "on_fail", "on_missing"], required: true },
    reason: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    consumedAt: { type: Date, default: null }, // uso único
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  opts
);

/** Anti-replay do bilhete.  TTL limpa sozinho o que já expirou. */
const usedNonceSchema = new Schema(
  {
    _id: String, // o próprio nonce
    agentId: String,
    usedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  opts
);
usedNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** O agente DEPOSITA aqui; ele não escreve em `mandates`. */
const proposalSchema = new Schema(
  {
    _id: String,
    humanId: { type: String, required: true, index: true },
    agentId: { type: String, required: true },
    draft: { type: Schema.Types.Mixed, required: true }, // mesmo formato que será verificado
    rationale: String,
    // Atributos que VARIAM no catálogo e não têm regra: o humano vê o que está
    // deixando em aberto antes de autorizar.
    unconstrained: { type: Schema.Types.Mixed, default: [] },
    status: { type: String, enum: ["pending", "confirmed", "discarded"], default: "pending" },
    mandateId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  opts
);

/** Append-only.  Nada é editado nem apagado — é a base da disputa. */
const auditSchema = new Schema(
  {
    _id: String,
    ts: { type: Date, default: Date.now },
    event: { type: String, required: true },
    actor: { type: Schema.Types.Mixed },
    mandateId: { type: String, index: true },
    merchantId: String,
    agentIdAuthenticated: String,
    purchase: { type: Schema.Types.Mixed, default: null },
    decision: String,
    reason: { type: Schema.Types.Mixed, default: null },
    approvalId: { type: String, default: null },
    receiptId: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
    trace: { type: Schema.Types.Mixed, default: [] },
  },
  opts
);

/**
 * "Eu nunca autorizei isso."  A disputa em si é append-only como o resto: o
 * veredito é gravado com a evidência que o sustentou, congelada no momento em
 * que foi calculada.  Recalcular depois, sobre um trilho que cresceu, daria
 * outra resposta — e uma resolução que muda sozinha não resolve nada.
 */
const disputeSchema = new Schema(
  {
    _id: String,
    humanId: { type: String, required: true, index: true },
    mandateId: { type: String, required: true },
    auditId: { type: String, required: true }, // a compra contestada
    reason: String,
    verdict: { type: String, enum: ["authorized", "not_authorized", "nothing_charged"], required: true },
    brokenLink: { type: String, default: null },
    evidence: { type: Schema.Types.Mixed, default: [] },
    charged: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  opts
);

/** Resposta gravada por chave: repetir a chave devolve o MESMO resultado. */
const idempotencySchema = new Schema(
  {
    _id: String, // `${merchantId}:${idempotencyKey}`
    response: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
  },
  opts
);

export const Mandate = model("Mandate", mandateSchema, "mandates");
export const Merchant = model("Merchant", merchantSchema, "merchants");
export const Agent = model("Agent", agentSchema, "agents");
export const Approval = model("Approval", approvalSchema, "approvals");
export const UsedNonce = model("UsedNonce", usedNonceSchema, "used_nonces");
export const Proposal = model("Proposal", proposalSchema, "mandate_proposals");
export const AuditLog = model("AuditLog", auditSchema, "audit_log");
export const Dispute = model("Dispute", disputeSchema, "disputes");
export const Idempotency = model("Idempotency", idempotencySchema, "idempotency");
