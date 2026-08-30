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
 * Tokeniza: o instrumento cru entra AQUI e não sai.
 *
 * Este módulo é o **cofre**, e num sistema real ele seria o PSP — outro
 * processo, outra empresa.  Por isso o cru fica em memória e não no Mongo: o
 * banco da Autoridade nunca deve conter um número de cartão.  Ela guarda só o
 * ponteiro (`paymentMethodRef`) e um rótulo, na coleção `payment_methods`.
 *
 * Consequência honesta do mock: reiniciar esvazia o cofre falso, e um ponteiro
 * guardado no Mongo deixa de encontrar seu instrumento.  `charge` degrada em
 * vez de quebrar — o que também espelha a realidade, já que o PSP é um sistema
 * separado e a nossa base guarda apenas o token.
 */
export function tokenize({ rail, instrument }) {
  if (!["card", "pix"].includes(rail)) throw new Error("unsupported_rail");
  const ref = opaqueId(rail === "card" ? "pm_card" : "pm_pix");
  const label =
    rail === "card" ? `•••• ${String(instrument?.number ?? "").slice(-4)}` : instrument?.key ?? "pix";
  vault.set(ref, { rail, instrument, label, createdAt: new Date() });
  return { paymentMethodRef: ref, rail, label };
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
