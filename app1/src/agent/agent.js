/**
 * O Agente.  Papel SEPARADO da Autoridade, ainda que compartilhem o deploy.
 *
 * Repare em como este módulo conversa com o resto: **só por HTTP**.  Ele não
 * importa `models.js`, não abre o Mongo, não chama `evaluate` para decidir nada.
 * A fronteira do `docs/02` ("o agente lê, a Autoridade escreve") não é
 * disciplina de quem escreve o código — é o que este arquivo consegue alcançar.
 *
 * O que o agente tem: a própria credencial (para assinar o bilhete) e o id do
 * mandato.  O que ele não tem: caminho de escrita no estado do mandato, acesso
 * ao `paymentMethodRef`, e qualquer influência sobre a resposta da verificação.
 *
 * Esta é a parte determinística (buscar, comparar, comprar).  A conversa em
 * linguagem natural com o humano é a Fase 5 (`docs/07-build-plan.md`).
 */

import { issueTicket, newNonce } from "../authority/ticket.js";

const OPS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
};

/**
 * Filtro de COMPRAS, não de autorização.  O agente usa as constraints visíveis
 * para não tentar o que obviamente não cabe — é cortesia, não segurança.  Se
 * este filtro estiver errado (ou for burlado), quem diz "não" continua sendo a
 * Autoridade, do outro lado da rede.  Nada aqui autoriza coisa alguma.
 */
function fitsHeuristically(item, constraints) {
  for (const c of constraints ?? []) {
    const real = c.attr === "price" ? item.price : item[c.attr];
    if (real === undefined) {
      if (c.on_missing === "allow") continue;
      return false;
    }
    const op = OPS[c.op];
    if (!op || !op(real, c.value)) return false;
  }
  return true;
}

/** Busca em todas as lojas conhecidas, em paralelo. */
export async function searchCatalogs(stores, query = "") {
  const results = await Promise.all(
    stores.map(async (s) => {
      try {
        const r = await fetch(`${s.url}/catalog?q=${encodeURIComponent(query)}`);
        const body = await r.json();
        return body.items.map((i) => ({ ...i, merchantId: s.id, merchantName: body.name, storeUrl: s.url }));
      } catch {
        return [];
      }
    })
  );
  return results.flat();
}

/**
 * Compara as opções e devolve a escolha + a tabela que justifica a escolha.
 * A comparação é guardada porque "por que este e não aquele?" é uma pergunta
 * que o humano e o auditor têm o direito de fazer.
 *
 * @param strategy "best" — a mais barata que cabe no mandato (comportamento normal)
 *                 "cheapest" — a mais barata de todas, ignorando o mandato.
 *                 A segunda é o AGENTE ADVERSARIAL da demo: mostra que um agente
 *                 que tenta burlar não consegue, porque quem decide é a Autoridade.
 */
export function compare(items, mandate, strategy = "best") {
  const scored = items
    .map((i) => ({ ...i, fits: fitsHeuristically(i, mandate.constraints) }))
    .sort((a, b) => a.price - b.price);

  const chosen = strategy === "cheapest" ? scored[0] : scored.find((i) => i.fits) ?? null;
  return { comparison: scored, chosen: chosen ?? null };
}

/**
 * Tenta a compra: assina o bilhete e entrega à loja.  O agente NÃO interpreta
 * o resultado — ele repassa o que a Autoridade respondeu, inclusive o "não".
 */
export async function attemptPurchase({ mandateId, item, agentId, agentSecret, idempotencyKey, quantity = 1 }) {
  const ticket = issueTicket(
    {
      agentId,
      mandateId,
      merchantId: item.merchantId,
      productId: item.productId,
      // O preço que o agente VIU e escolheu.  É esta a segunda fonte que impede
      // a loja de atestar um valor maior, ainda dentro do teto do mandato.
      price: item.price,
      // Quantas unidades ele escolheu, e quanto isso soma.  Assinar os dois é o
      // que impede a loja de multiplicar as unidades depois — cada uma dentro
      // do teto unitário, e o total muito além do que o humano autorizou.
      quantity,
      total: item.price * quantity,
      currency: item.currency,
    },
    agentSecret
  );

  const r = await fetch(`${item.storeUrl}/buy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productId: item.productId,
      quantity,
      mandateId,
      purchaseTicket: ticket,
      idempotencyKey: idempotencyKey ?? newNonce(),
    }),
  });
  return r.json();
}
