/**
 * Bilhete de compra (`purchaseTicket`) — como a identidade do agente é PROVADA.
 * Ver `docs/03-data-model-and-api.md` e D16 em `docs/06-decision-log.md`.
 *
 * A Autoridade NÃO aceita a palavra da loja sobre quem é o agente.  A cada
 * tentativa o agente assina um bilhete descrevendo exatamente a compra pedida;
 * a loja repassa o bilhete intacto e a Autoridade o verifica ela mesma.
 *
 * Sem isso, uma loja registrada que atendeu uma compra legítima conhece o
 * mandateId e o agentId, e poderia chamar /introspect depois — sem agente
 * nenhum — para ser paga pela titular.  A loja é TRANSPORTE, não fonte.
 */

import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 120;

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Só estes campos existem num bilhete.  Qualquer outro é ruído de atacante. */
const canonicalPayload = (p) => ({
  agentId: p.agentId,
  mandateId: p.mandateId,
  merchantId: p.merchantId,
  productId: p.productId,
  price: p.price,
  currency: p.currency,
  nonce: p.nonce,
  iat: p.iat,
  exp: p.exp,
});

const canonical = (payload) => JSON.stringify(canonicalPayload(payload));

const sign = (encodedPayload, secret) =>
  crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");

export const newNonce = () => crypto.randomUUID();

/** Ids opacos de ALTA ENTROPIA — nunca sequenciais (anti-enumeração, `docs/05`). */
export const opaqueId = (prefix) => `${prefix}_${crypto.randomBytes(16).toString("hex")}`;

/**
 * Emitido pelo AGENTE, com o segredo que só ele e a Autoridade conhecem.
 * `price` e `currency` entram porque as constraints são TETOS: sem eles, a loja
 * poderia atestar um valor maior do que anunciou, ainda dentro do teto, e a
 * Autoridade não teria com o que comparar.
 */
export function issueTicket(
  { agentId, mandateId, merchantId, productId, price, currency },
  secret,
  { now = new Date(), ttlSeconds = DEFAULT_TTL_SECONDS, nonce = newNonce() } = {}
) {
  const iat = Math.floor(now.getTime() / 1000);
  const payload = {
    agentId,
    mandateId,
    merchantId,
    productId,
    price,
    currency,
    nonce,
    iat,
    exp: iat + ttlSeconds,
  };
  const encoded = b64url(canonical(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

/** Lê o `agentId` do bilhete SEM confiar nele — só para localizar o segredo. */
export function peekAgentId(ticket) {
  try {
    const [encoded] = String(ticket).split(".");
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")).agentId ?? null;
  } catch {
    return null;
  }
}

/**
 * Verificado pela AUTORIDADE.  Devolve `{ ok, payload }` ou `{ ok:false, code }`.
 * O anti-replay (nonce de uso único) NÃO mora aqui: ele é gravado na mesma
 * operação atômica que consome o uso do mandato, para fechar o TOCTOU.
 */
export function verifyTicket(ticket, secret, { now = new Date() } = {}) {
  if (typeof ticket !== "string" || !ticket.includes(".")) return { ok: false, code: "ticket_malformed" };

  const [encoded, signature] = ticket.split(".");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "ticket_malformed" };
  }

  // Os BYTES têm que ser exatamente os que um emissor legítimo produziria.
  // Só conferir a assinatura sobre a forma canônica não bastaria: um payload com
  // campos a mais assinaria igual, e o extra chegaria intacto a quem lesse depois.
  // Exigindo a forma canônica, não existe campo que a assinatura não cubra.
  const encodedCanonical = b64url(canonical(payload));
  if (encoded !== encodedCanonical) return { ok: false, code: "ticket_malformed" };

  const expected = sign(encodedCanonical, secret);
  const a = Buffer.from(signature ?? "", "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "ticket_bad_signature" };
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now.getTime()) {
    return { ok: false, code: "ticket_expired" };
  }

  // Devolvemos a forma canônica, nunca o objeto cru que chegou pela rede.
  return { ok: true, payload: canonicalPayload(payload) };
}
