/**
 * Resolução de disputa — "eu nunca autorizei isso".
 *
 * A promessa do trilho append-only só vale se alguém conseguir *usá-lo* para
 * responder essa frase.  Este módulo faz isso: dado o trilho de um mandato e a
 * compra contestada, ele **reconstitui** a cadeia de autorização e diz de que
 * lado o registro está.
 *
 * O ponto que torna isto defensável: o veredito é **calculado do log**, não
 * afirmado.  Ninguém escreve "essa compra era legítima" em lugar nenhum — a
 * legitimidade é derivada de fatos carimbados em ordem, cada um com um dono:
 *
 *   1. o humano criou o mandato, e com quais limites   (mandate_created)
 *   2. quem pediu a compra provou ser o agente do mandato (agentIdAuthenticated,
 *      derivado do purchaseTicket assinado — ver D16)
 *   3. as regras foram avaliadas, e passaram              (trace, regra a regra)
 *   4. se o mandato exigia, houve um sim específico       (approval_granted)
 *   5. o que foi cobrado é o que foi verificado           (payment_result)
 *
 * Falte um elo e o registro está do lado do titular.  Estejam todos, e o
 * registro está do lado da loja — e o titular pode ver exatamente por quê.
 *
 * Função PURA: recebe o trilho e o mandato, devolve o veredito.  Quem lê o
 * banco é a rota.
 */

/** Elos que precisam existir para a cobrança se sustentar. */
const LINKS = [
  "mandate_created",
  "agent_identity",
  "rules_passed",
  "human_approval",
  "charged_what_was_verified",
];

const link = (key, ok, detail = {}) => ({ key, ok, ...detail });

/**
 * @param disputed  o evento `purchase_decision` contestado (do audit_log)
 * @param trail     todos os eventos daquele mandato, em ordem cronológica
 * @param mandate   o mandato como está hoje (para o modo e o dono)
 */
export function resolveDispute(disputed, trail, mandate) {
  // Nada foi cobrado: não há o que disputar.  Vale dizer explicitamente, porque
  // "o agente tentou e foi recusado" é uma memória fácil de confundir com
  // "o agente comprou".
  if (!disputed || disputed.decision !== "valido") {
    return {
      verdict: "nothing_charged",
      charged: null,
      evidence: [],
      brokenLink: null,
    };
  }

  const charged = {
    ts: disputed.ts,
    merchantId: disputed.merchantId,
    productId: disputed.purchase?.productId,
    price: disputed.purchase?.price,
    currency: disputed.purchase?.currency,
    receiptId: disputed.receiptId,
    agentId: disputed.agentIdAuthenticated,
  };

  const before = (e) => new Date(e.ts) <= new Date(disputed.ts);

  // 1) O humano criou o mandato — e o fez ANTES desta compra.
  const created = trail.find((e) => e.event === "mandate_created" && before(e));
  const evidence = [
    link("mandate_created", !!created, {
      ts: created?.ts ?? null,
      by: created?.actor?.id ?? null,
      // Os limites que o humano leu e aceitou, na frase que ele viu.
      terms: mandate?.humanReadable ?? null,
      rules: mandate?.constraints ?? [],
    }),
  ];

  // 2) Quem comprou provou ser o agente deste mandato.  Não é comparação de
  //    campo declarado: o agentId veio do bilhete assinado (D16).
  const agentMatches = !!mandate && disputed.agentIdAuthenticated === mandate.agentId;
  evidence.push(
    link("agent_identity", agentMatches, {
      claimed: disputed.agentIdAuthenticated ?? null,
      mandateHolder: mandate?.agentId ?? null,
    })
  );

  // 3) As regras foram avaliadas e passaram — com o veredito de cada uma.
  const trace = disputed.trace ?? [];
  const allOk = trace.length > 0 && trace.every((t) => ["ok", "missing_allowed"].includes(t.verdict));
  evidence.push(link("rules_passed", allOk, { trace }));

  // 4) Se o mandato exigia aprovação por compra, tem que existir um sim
  //    específico — e específico daquela compra, não um sim genérico.
  const needsApproval = mandate?.mode === "aprovacao";
  const granted = trail.find(
    (e) =>
      e.event === "approval_granted" &&
      before(e) &&
      e.purchase?.productId === charged.productId &&
      e.purchase?.price === charged.price
  );
  evidence.push(
    link("human_approval", needsApproval ? !!granted : null, {
      required: needsApproval,
      ts: granted?.ts ?? null,
      by: granted?.actor?.id ?? null,
    })
  );

  // 5) O verificado é o cobrado: o recibo existe e é do mesmo valor.
  const payment = trail.find(
    (e) => e.event === "payment_result" && e.receiptId && e.receiptId === disputed.receiptId
  );
  const amountMatches = !!payment && payment.purchase?.price === charged.price;
  evidence.push(
    link("charged_what_was_verified", amountMatches, {
      verified: charged.price,
      charged: payment?.purchase?.price ?? null,
      receiptId: payment?.receiptId ?? null,
    })
  );

  // `null` é "não se aplica" (aprovação num mandato autônomo), não uma falha.
  const broken = evidence.find((e) => e.ok === false);

  return {
    verdict: broken ? "not_authorized" : "authorized",
    charged,
    evidence,
    brokenLink: broken?.key ?? null,
  };
}

export const DISPUTE_LINKS = LINKS;
