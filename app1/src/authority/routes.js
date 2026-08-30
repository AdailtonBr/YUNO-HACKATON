/**
 * Rotas da Autoridade.  Ver `docs/03-data-model-and-api.md`.
 *
 * A separação que importa está nos middlewares: quem você é NUNCA vem do corpo.
 *  - loja   -> apiKey  -> merchantId
 *  - humano -> sessão  -> humanId
 *  - agente -> segredo -> agentId (e, na compra, o bilhete assinado)
 */

import express from "express";
import crypto from "node:crypto";
import { Mandate, Merchant, Agent, Approval, Proposal, AuditLog, Dispute } from "./models.js";
import { mandateStatus } from "./engine.js";
import { introspect } from "./introspect.js";
import { resolveDispute } from "./dispute.js";
import { opaqueId } from "./ticket.js";
import {
  tokenize, listMethods, resolveMethod, forgetMethod,
  addAddress, listAddresses, resolveAddress, forgetAddress,
} from "./vault.js";
import { humanReadable, reasonText } from "../shared/messages.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/* --------------------------- autenticação --------------------------- */

async function requireMerchant(req, res, next) {
  const key = req.get("x-api-key");
  if (!key) return res.status(401).json({ error: "missing_api_key" });
  // Allow-list: loja não-registrada não fala com a Autoridade (anti-site-fake).
  const merchant = await Merchant.findOne({ apiKeyHash: sha256(key), active: true }).lean();
  if (!merchant) return res.status(401).json({ error: "unknown_merchant" });
  req.merchantId = merchant._id;
  next();
}

/**
 * MOCK de sessão para a demo: o humano se identifica por header.
 * O que é REAL e importa: o `humanId` vem da camada de autenticação, nunca do
 * corpo — trocar isto por uma sessão de verdade não muda nenhuma outra linha.
 */
function requireHuman(req, res, next) {
  const humanId = req.get("x-human-id");
  if (!humanId) return res.status(401).json({ error: "missing_human_session" });
  req.humanId = humanId;
  next();
}

async function requireAgent(req, res, next) {
  const agentId = req.get("x-agent-id");
  const secret = req.get("x-agent-secret");
  const agent = agentId ? await Agent.findById(agentId).lean() : null;
  if (!agent || !agent.active || agent.hmacSecret !== secret) {
    return res.status(401).json({ error: "unknown_agent" });
  }
  req.agentId = agent._id;
  req.humanId = agent.humanId;
  next();
}

/* ------------------------------ rotas ------------------------------- */

export function buildRouter() {
  const r = express.Router();
  const locale = (req) => req.get("accept-language")?.startsWith("pt") ? "pt-BR" : "en";

  const audit = (entry) => AuditLog.create({ _id: opaqueId("aud"), ...entry });

  /* --- Trusted Surface: o humano cria o mandato -------------------- */

  r.post("/mandates", requireHuman, async (req, res) => {
    const { agentId, mode, constraints, currency, maxUses, expiresAt, proposalId } = req.body ?? {};
    const { paymentMethodId, shippingAddressId } = req.body ?? {};
    if (!agentId || !mode || !currency || !expiresAt) {
      return res.status(400).json({ error: "missing_fields" });
    }

    // A tradução id -> ref acontece AQUI, dentro da Autoridade, com o humano
    // autenticado.  Nem a UI nem o agente jamais tocam o `paymentMethodRef`.
    const method = paymentMethodId ? resolveMethod(req.humanId, paymentMethodId) : null;
    if (!method) return res.status(400).json({ error: "unknown_payment_method" });

    // Endereço é opcional: nem tudo se entrega (ingresso, assinatura).
    const address = shippingAddressId ? resolveAddress(req.humanId, shippingAddressId) : null;
    if (shippingAddressId && !address) return res.status(400).json({ error: "unknown_address" });
    const agent = await Agent.findById(agentId).lean();
    // O humano só pode dar mandato ao PRÓPRIO agente.
    if (!agent || agent.humanId !== req.humanId) return res.status(403).json({ error: "not_your_agent" });

    // Um mandato que já nasce expirado não é autorização, é ruído no registro.
    if (new Date(expiresAt) <= new Date()) return res.status(400).json({ error: "expiresAt_in_the_past" });

    const draft = {
      mode,
      constraints: constraints ?? [],
      currency,
      // Ausente vira 1, nunca "ilimitado": esquecer o limite bloqueia, não libera.
      maxUses: maxUses ?? 1,
      expiresAt: new Date(expiresAt),
    };

    const mandate = await Mandate.create({
      _id: opaqueId("mnd"),
      humanId: req.humanId, // da sessão
      agentId,
      ...draft,
      paymentMethodRef: method.paymentMethodRef,
      shippingAddressId: address?.addressId ?? null,
      // Derivado do MESMO JSON que será verificado — nunca escrito em paralelo.
      humanReadable: humanReadable(draft, locale(req)),
    });

    if (proposalId) {
      await Proposal.updateOne(
        { _id: proposalId, humanId: req.humanId },
        { $set: { status: "confirmed", mandateId: mandate._id } }
      );
    }

    await audit({
      event: "mandate_created",
      actor: { type: "human", id: req.humanId },
      mandateId: mandate._id,
      decision: "valido",
    });

    res.status(201).json({ mandateId: mandate._id, humanReadable: mandate.humanReadable });
  });

  /**
   * Preview da frase, para a Trusted Surface mostrar ao humano ANTES de criar.
   * Existe para que a UI não tenha um renderizador próprio: se a frase fosse
   * escrita em paralelo ao JSON, ela poderia dizer "R$100" e o mandato gravar
   * R$1000.  Uma fonte só, a mesma que grava (D5).
   */
  r.post("/mandates/preview", requireHuman, (req, res) => {
    const { mode, constraints, currency, maxUses, expiresAt } = req.body ?? {};
    res.json({
      humanReadable: humanReadable({ mode, constraints, currency, maxUses: maxUses ?? 1, expiresAt }, locale(req)),
    });
  });

  r.post("/mandates/:id/revoke", requireHuman, async (req, res) => {
    // Só a mão do humano vira esta flag.  O agente não tem caminho de escrita aqui.
    const m = await Mandate.findOneAndUpdate(
      { _id: req.params.id, humanId: req.humanId },
      { $set: { revoked: true } },
      { new: true }
    ).lean();
    if (!m) return res.status(404).json({ error: "unknown_mandate" });

    await audit({
      event: "mandate_revoked",
      actor: { type: "human", id: req.humanId },
      mandateId: m._id,
      decision: "valido",
    });
    res.json({ ok: true });
  });

  const publicMandate = (m) => ({
    mandateId: m._id,
    mode: m.mode,
    humanReadable: m.humanReadable,
    status: mandateStatus(m),
    revoked: m.revoked,
    usedCount: m.usedCount,
    maxUses: m.maxUses,
    currency: m.currency,
    expiresAt: m.expiresAt,
    constraints: m.constraints,
    shippingAddressId: m.shippingAddressId ?? null,
    // paymentMethodRef NUNCA sai daqui.
  });

  r.get("/mandates", requireHuman, async (req, res) => {
    const list = await Mandate.find({ humanId: req.humanId }).sort({ createdAt: -1 }).lean();
    res.json(list.map(publicMandate));
  });

  r.get("/mandates/:id", async (req, res) => {
    const m = await Mandate.findById(req.params.id).lean();
    if (!m) return res.status(404).json({ error: "unknown_mandate" });
    res.json(publicMandate(m));
  });

  /* --- Propostas: o agente rascunha, o humano confirma ------------- */

  r.post("/proposals", requireAgent, async (req, res) => {
    const { draft, rationale, unconstrained, delivery, assumed } = req.body ?? {};
    if (!draft) return res.status(400).json({ error: "missing_draft" });
    const p = await Proposal.create({
      _id: opaqueId("prp"),
      humanId: req.humanId,
      agentId: req.agentId,
      draft,
      rationale,
      unconstrained: unconstrained ?? [],
      delivery: delivery ?? null,
      assumed: assumed ?? [],
    });
    // O agente depositou um rascunho.  Isto NÃO é um mandato.
    res.status(201).json({ proposalId: p._id });
  });

  r.get("/proposals", requireHuman, async (req, res) => {
    const list = await Proposal.find({ humanId: req.humanId, status: "pending" })
      .sort({ createdAt: -1 })
      .lean();
    res.json(
      list.map((p) => ({
        proposalId: p._id,
        agentId: p.agentId,
        draft: p.draft,
        rationale: p.rationale,
        unconstrained: p.unconstrained ?? [],
        delivery: p.delivery ?? null,
        assumed: p.assumed ?? [],
        createdAt: p.createdAt,
        // A frase vem do MESMO renderizador que grava o mandato: o humano revisa
        // exatamente o que será verificado, não uma descrição paralela.
        humanReadable: humanReadable(p.draft, locale(req)),
      }))
    );
  });

  r.post("/proposals/:id/discard", requireHuman, async (req, res) => {
    const p = await Proposal.findOneAndUpdate(
      { _id: req.params.id, humanId: req.humanId, status: "pending" },
      { $set: { status: "discarded" } },
      { new: true }
    ).lean();
    if (!p) return res.status(404).json({ error: "unknown_proposal" });
    res.json({ ok: true });
  });

  /* --- Introspecção: chamada pela LOJA ----------------------------- */

  r.post("/introspect", requireMerchant, async (req, res) => {
    const result = await introspect(req.body, { merchantId: req.merchantId });
    res.json({ ...result, reasonText: reasonText(result.reason, locale(req)) });
  });

  /* --- Aprovações por compra --------------------------------------- */

  r.get("/approvals", requireHuman, async (req, res) => {
    const list = await Approval.find({
      humanId: req.humanId,
      status: req.query.status ?? "pending",
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json(
      list.map((a) => ({
        approvalId: a._id,
        mandateId: a.mandateId,
        merchantId: a.merchantId,
        productId: a.productId,
        price: a.price,
        currency: a.currency,
        attributes: a.attributes,
        origin: a.origin,
        reasonText: reasonText(a.reason, locale(req)),
        expiresAt: a.expiresAt,
      }))
    );
  });

  const decide = (status, event) => async (req, res) => {
    const a = await Approval.findOneAndUpdate(
      { _id: req.params.id, humanId: req.humanId, status: "pending" },
      { $set: { status } },
      { new: true }
    ).lean();
    if (!a) return res.status(404).json({ error: "unknown_approval" });
    await audit({
      event,
      actor: { type: "human", id: req.humanId },
      mandateId: a.mandateId,
      merchantId: a.merchantId,
      purchase: { productId: a.productId, price: a.price, currency: a.currency },
      approvalId: a._id,
      decision: status === "approved" ? "valido" : "recusado",
    });
    res.json({ ok: true });
  };

  r.post("/approvals/:id/approve", requireHuman, decide("approved", "approval_granted"));
  r.post("/approvals/:id/reject", requireHuman, decide("rejected", "approval_rejected"));

  /* --- Disputa: "eu nunca autorizei isso" --------------------------- */

  r.post("/disputes", requireHuman, async (req, res) => {
    const { auditId, reason } = req.body ?? {};
    const disputed = await AuditLog.findById(auditId).lean();
    if (!disputed) return res.status(404).json({ error: "unknown_audit_entry" });

    const mandate = await Mandate.findById(disputed.mandateId).lean();
    // Só o titular contesta uma compra do próprio mandato.
    if (!mandate || mandate.humanId !== req.humanId) return res.status(403).json({ error: "not_your_mandate" });

    // O trilho INTEIRO daquele mandato, em ordem: é dele que o veredito sai.
    const trail = await AuditLog.find({ mandateId: disputed.mandateId }).sort({ ts: 1 }).lean();
    const resolution = resolveDispute(disputed, trail, mandate);

    const dispute = await Dispute.create({
      _id: opaqueId("dsp"),
      humanId: req.humanId,
      mandateId: disputed.mandateId,
      auditId,
      reason,
      ...resolution,
    });

    // A própria disputa entra no trilho.  Contestar é um ato, e atos ficam.
    await audit({
      event: "dispute_resolved",
      actor: { type: "human", id: req.humanId },
      mandateId: disputed.mandateId,
      merchantId: disputed.merchantId,
      purchase: disputed.purchase,
      decision: resolution.verdict === "authorized" ? "valido" : "recusado",
      reason: { code: `dispute_${resolution.verdict}`, params: { brokenLink: resolution.brokenLink } },
    });

    res.status(201).json({ disputeId: dispute._id, ...resolution });
  });

  r.get("/disputes", requireHuman, async (req, res) => {
    const list = await Dispute.find({ humanId: req.humanId }).sort({ createdAt: -1 }).lean();
    res.json(list.map((d) => ({ disputeId: d._id, ...d, _id: undefined })));
  });

  /* --- Trilho auditável -------------------------------------------- */

  r.get("/audit", async (req, res) => {
    const q = req.query.mandateId ? { mandateId: req.query.mandateId } : {};
    const list = await AuditLog.find(q).sort({ ts: 1 }).limit(500).lean();
    res.json(
      list.map((e) => ({
        auditId: e._id,
        ts: e.ts,
        event: e.event,
        actor: e.actor,
        mandateId: e.mandateId,
        merchantId: e.merchantId,
        agentIdAuthenticated: e.agentIdAuthenticated,
        purchase: e.purchase,
        decision: e.decision,
        reason: e.reason ?? null,
        reasonText: reasonText(e.reason, locale(req)),
        receiptId: e.receiptId,
        // Sai porque a UI distingue por ela o que o vigia comprou sozinho do
        // que foi comprado na conversa (prefixo `watch:`).  Não é segredo: é
        // derivada do próprio mandato, que é do humano que está perguntando.
        idempotencyKey: e.idempotencyKey ?? null,
        trace: e.trace ?? [],
      }))
    );
  });

  /* --- Cofre: tokenização (o cru entra aqui e não sai) -------------- */

  /* --- Carteira: meios de pagamento e endereços --------------------- */
  /*
   * O instrumento cru entra por aqui, com o humano presente, e não volta.  O
   * que sai é `methodId` + rótulo; o `paymentMethodRef` fica dentro do cofre.
   */
  r.post("/wallet/methods", requireHuman, (req, res) => {
    try {
      const { rail, instrument } = req.body ?? {};
      const { methodId, label } = tokenize({ rail, instrument, humanId: req.humanId });
      res.status(201).json({ methodId, rail, label }); // sem a ref, de propósito
    } catch {
      res.status(400).json({ error: "unsupported_rail" });
    }
  });

  r.get("/wallet/methods", requireHuman, (req, res) => res.json(listMethods(req.humanId)));

  r.delete("/wallet/methods/:id", requireHuman, (req, res) =>
    forgetMethod(req.humanId, req.params.id)
      ? res.json({ ok: true })
      : res.status(404).json({ error: "unknown_method" })
  );

  r.post("/wallet/addresses", requireHuman, (req, res) => {
    const { label, address } = req.body ?? {};
    if (!label?.trim() || !address?.trim()) return res.status(400).json({ error: "missing_fields" });
    res.status(201).json(addAddress({ humanId: req.humanId, label: label.trim(), address: address.trim() }));
  });

  // Devolve rótulos.  A rua fica no cofre, como o número do cartão.
  r.get("/wallet/addresses", requireHuman, (req, res) => res.json(listAddresses(req.humanId)));

  r.delete("/wallet/addresses/:id", requireHuman, (req, res) =>
    forgetAddress(req.humanId, req.params.id)
      ? res.json({ ok: true })
      : res.status(404).json({ error: "unknown_address" })
  );


  return r;
}

export { requireMerchant, requireHuman, requireAgent, sha256 };
