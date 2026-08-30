/**
 * Cofre / PSP — MOCK.  Ver `docs/03` e D10.
 *
 * O que é REAL aqui (e é o que a banca julga):
 *  - o `paymentMethodRef` vive no mandato, não no agente;
 *  - quem lê a ref e chama o cofre é a AUTORIDADE — nunca o agente, nunca a loja;
 *  - o agente nunca vê o instrumento, e não existe operação "credita alguém",
 *    então ele não tem como se pôr como destino da cobrança.
 *
 * O que é MOCK: a movimentação de dinheiro.  Cartão e Pix são trilhos diferentes
 * atrás da mesma porta — troca o executor, não a arquitetura.
 */

import { opaqueId } from "./ticket.js";

/** Instrumentos crus tokenizados.  O cru entra aqui e não sai. */
const vault = new Map();

/**
 * Chamado pela Trusted Surface, com o humano presente.  Devolve só a ref e um
 * rótulo para o humano reconhecer o método — o número cru nunca é persistido
 * pela Autoridade nem visto pelo agente.
 */
/**
 * DOIS identificadores, de propósito.
 *
 *  - `paymentMethodRef` é o ponteiro que a Autoridade usa para cobrar.  Ele
 *    vive no mandato e **nunca sai daqui**.
 *  - `methodId` é um id opaco de exibição, e é o único que o agente e a UI
 *    chegam a ver.
 *
 * O agente aprende que existe um método chamado `•••• 4242`; ele não aprende o
 * ponteiro nem o cartão.  É o que mantém literal a frase do `docs/05`: *não há
 * ponteiro solto para roubar*.
 */
export function tokenize({ rail, instrument, humanId }) {
  if (!["card", "pix"].includes(rail)) throw new Error("unsupported_rail");
  const ref = opaqueId(rail === "card" ? "pm_card" : "pm_pix");
  const methodId = opaqueId("pm");
  const label =
    rail === "card" ? `•••• ${String(instrument?.number ?? "").slice(-4)}` : instrument?.key ?? "pix";
  // O cru entra aqui e não sai.  O rótulo existe para o humano reconhecer o
  // método; ele não reconstrói o instrumento.
  vault.set(ref, { rail, instrument, humanId, label, methodId, createdAt: new Date() });
  return { paymentMethodRef: ref, methodId, rail, label };
}

/** O que a carteira mostra: rótulos, nunca números, nunca a ref. */
export function listMethods(humanId) {
  return [...vault.values()]
    .filter((v) => v.humanId === humanId)
    .map((v) => ({ methodId: v.methodId, rail: v.rail, label: v.label, createdAt: v.createdAt }));
}

/**
 * A tradução `methodId` → `paymentMethodRef`, que só acontece DENTRO da
 * Autoridade, no momento em que o humano autoriza.  Confere o dono: um id de
 * outra pessoa não resolve.
 */
export function resolveMethod(humanId, methodId) {
  for (const [ref, v] of vault.entries()) {
    if (v.methodId === methodId && v.humanId === humanId) return { paymentMethodRef: ref, rail: v.rail, label: v.label };
  }
  return null;
}

export function forgetMethod(humanId, methodId) {
  for (const [ref, v] of vault.entries()) {
    if (v.methodId === methodId && v.humanId === humanId) return vault.delete(ref);
  }
  return false;
}

/* ------------------------- endereços de entrega -------------------------- */
/*
 * Mesma forma, e pelo mesmo motivo: o agente sabe que existe um endereço
 * chamado "Casa"; ele não sabe onde é "Casa".
 */

const addresses = new Map(); // addressId -> { humanId, label, address }

export function addAddress({ humanId, label, address }) {
  const addressId = opaqueId("adr");
  addresses.set(addressId, { humanId, label, address, createdAt: new Date() });
  return { addressId, label };
}

export function listAddresses(humanId) {
  return [...addresses.entries()]
    .filter(([, a]) => a.humanId === humanId)
    .map(([addressId, a]) => ({ addressId, label: a.label, createdAt: a.createdAt }));
}

export function resolveAddress(humanId, addressId) {
  const a = addresses.get(addressId);
  return a && a.humanId === humanId ? { addressId, label: a.label } : null;
}

export function forgetAddress(humanId, addressId) {
  const a = addresses.get(addressId);
  return a && a.humanId === humanId ? addresses.delete(addressId) : false;
}


/**
 * A Autoridade escolhe o trilho pelo TIPO da ref — o chamador não escolhe.
 * `charge` é mock, mas honesto: pode recusar, e é por isso que a Autoridade
 * precisa de compensação (o uso do mandato já foi consumido quando chegamos aqui).
 */
export function charge({ paymentMethodRef, amount, currency, merchantId }) {
  const entry = vault.get(paymentMethodRef);
  const rail = entry?.rail ?? (paymentMethodRef?.startsWith("pm_pix") ? "pix" : "card");

  if (!paymentMethodRef || amount == null || !currency || !merchantId) {
    return { status: "recusado", reason: "invalid_charge_request" };
  }
  // Gatilho determinístico para exercitar a compensação na demo e nos testes.
  if (entry?.instrument?.declineAll) {
    return { status: "recusado", rail, reason: "issuer_declined" };
  }

  return { receiptId: opaqueId("rcpt"), rail, status: "pago" };
}

/** Só para os testes e o seed: registra uma ref pré-existente. */
export function registerRef(ref, entry) {
  vault.set(ref, entry);
}
