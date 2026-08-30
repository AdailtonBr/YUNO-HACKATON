/**
 * Cliente HTTP da UI.
 *
 * A identidade do humano vai no header, nunca no corpo — é a mesma regra do
 * servidor, e é por isso que trocar este mock por uma sessão de verdade não
 * mexe em mais nada.
 */

export const HUMAN_ID = "user_michael";
export const AGENT_ID = "agent_michael";

const headers = (locale) => ({
  "content-type": "application/json",
  "x-human-id": HUMAN_ID,
  "accept-language": locale === "pt" ? "pt-BR" : "en",
});

async function req(method, path, { body, locale = "en" } = {}) {
  const res = await fetch(path, {
    method,
    headers: headers(locale),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(data?.error ?? res.statusText), { status: res.status, data });
  return data;
}

export const api = {
  // Autoridade
  mandates: (locale) => req("GET", "/api/mandates", { locale }),
  createMandate: (draft, locale) => req("POST", "/api/mandates", { body: draft, locale }),
  previewMandate: (draft, locale) => req("POST", "/api/mandates/preview", { body: draft, locale }),
  revoke: (id, locale) => req("POST", `/api/mandates/${id}/revoke`, { locale }),
  approvals: (locale) => req("GET", "/api/approvals", { locale }),
  approve: (id, locale) => req("POST", `/api/approvals/${id}/approve`, { locale }),
  reject: (id, locale) => req("POST", `/api/approvals/${id}/reject`, { locale }),
  audit: (mandateId, locale) =>
    req("GET", `/api/audit${mandateId ? `?mandateId=${mandateId}` : ""}`, { locale }),
  tokenize: (rail, instrument, locale) =>
    req("POST", "/api/vault/tokenize", { body: { rail, instrument }, locale }),

  // Disputa: "eu nunca autorizei isso" -> o trilho responde.
  dispute: (auditId, reason, locale) =>
    req("POST", "/api/disputes", { body: { auditId, reason }, locale }),

  // Propostas de mandato: o agente deposita, o humano confirma.
  proposals: (locale) => req("GET", "/api/proposals", { locale }),
  discardProposal: (id, locale) => req("POST", `/api/proposals/${id}/discard`, { locale }),

  // Agente (papel separado; a UI fala com ele por rotas próprias)
  chat: (payload, locale) => req("POST", "/api/agent/chat", { body: payload, locale }),
  resetChat: (conversationId, locale) =>
    req("POST", "/api/agent/reset", { body: { conversationId }, locale }),
};

export const money = (cents, currency = "BRL", locale = "en") =>
  new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency }).format(cents / 100);
