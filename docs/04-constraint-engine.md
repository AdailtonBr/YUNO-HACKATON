# 04 — Motor de Constraints (o coração do sistema)

O motor é **genérico**: não conhece "tênis", "assinatura" nem "cimento". Ele avalia uma **lista de constraints** `{attr, op, value, on_missing, on_fail}` contra os **atributos** que a loja informou sobre a compra. Toda a variabilidade (localização, tamanho, cor, voltagem, nível de liga...) vive nos **dados** do mandato, nunca em ramos de código.

## Operadores

```js
const OPS = {
  eq:  (a, b) => a === b,
  ne:  (a, b) => a !== b,
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  in:  (a, b) => Array.isArray(b) && b.includes(a),
};
```

Cobrem os casos da demo e os bonus de condições ricas:
- "abaixo de R$150" → `{ attr:"price", op:"lte", value:15000 }`
- "só do Brasil" → `{ attr:"ship_country", op:"eq", value:"BR" }`
- "cores permitidas" → `{ attr:"color", op:"in", value:["preto","branco"] }`

Condições **stateful** (não são atributo do produto, são estado do mandato) ficam fora do loop de atributos e são checadas à parte: `maxUses`/`usedCount` ("até N vezes") e `expiresAt` ("válido até").

## Política de ausência: `on_missing`

Quando o atributo pedido pela constraint **não veio** nos atributos da compra, o motor **não** aprova nem nega cegamente — ele aplica a política **daquela constraint** e sempre devolve o motivo:

- `deny` → a compra não satisfaz a constraint (rígido: sem prova do atributo, não compra).
- `escalate` → vira human-in-the-loop (pergunta ao humano).
- `allow` → ignora a ausência (use com cuidado; só para atributos de fato opcionais).

Isso transforma "preencher o atributo em todo o catálogo" de **requisito de entrada** em **investimento incremental**: uma loja sem `ship_country` não trava o sistema — ela só não atende mandatos que **exigem** prova de país. Uma loja de software nunca é afetada.

> **Política default recomendada para dinheiro:** as constraints devem ser **whitelist** (só passa o que casa com uma regra explícita) com `on_missing: "deny"` para atributos sensíveis, de modo que **esquecer** uma regra **bloqueia** em vez de **liberar**. A pasta chinesa passar por omissão é o tipo de furo que um juiz procura.

## Política de falha: `on_fail`

`on_missing` responde *"e se a loja não informou o atributo?"*. Uma pergunta **diferente** é *"e se informou e não bateu?"*. São dois eixos independentes, e cada constraint escolhe os dois separadamente:

| Situação | Campo | Valores | Default |
|---|---|---|---|
| O atributo **não veio** | `on_missing` | `deny` · `escalate` · `allow` | `deny` |
| O atributo veio e **não satisfaz** a regra | `on_fail` | `deny` · `escalate` | `deny` |

**Por que dois campos e não um.** Duas regras do mesmo mandato querem políticas opostas nos dois eixos:

- `ship_country/eq/BR` — se a loja **não diz** de onde envia, faz sentido perguntar ao humano (`on_missing: "escalate"` — você não sabe). Se ela diz **`CN`**, não faz: o humano já respondeu essa pergunta quando criou o mandato (`on_fail: "deny"`).
- `price/lte/10000` — se o preço **não veio**, negar é obrigatório: comprar sem saber quanto custa é indefensável (`on_missing: "deny"`). Se veio **R$103**, talvez valha perguntar (`on_fail: "escalate"` — passou R$3, libera?).

Um campo só forçaria as duas regras à mesma política, e o resultado seria o pior dos dois lados: ou um "quer comprar da China?" que contradiz o que o humano já decidiu, ou a impossibilidade de escalar um estouro de R$3 — justamente o "rejected **or escalated** to human approval" que o enunciado pede (`docs/01-hackathon.md`). Reunir os dois casos sob `on_missing` também é **semanticamente errado**: o nome do campo fala de ausência.

**`on_fail` não tem `allow`.** Seria "a regra falhou, siga em frente" — uma constraint que não constrange. Se a regra pode ser ignorada, ela não devia estar no mandato.

**Ambos default `deny`**, pela mesma lógica de whitelist: o silêncio bloqueia.

> **Escalar não é aprovar.** `escalate` devolve a decisão ao humano na Trusted Surface, que aprova **aquela compra específica** — nunca alarga o mandato. É o mesmo mecanismo do modo `aprovacao` (abaixo), acionado por uma origem diferente. Ver a coleção `approvals` em `docs/03-data-model-and-api.md`.

## Implementação

O motor é uma **função pura**: recebe tudo o que precisa e não toca em I/O. Quem busca o mandato e a eventual aprovação no banco é a Autoridade, que os passa em `ctx`. Isso mantém o coração do sistema trivialmente testável.

**A cripto acontece antes, fora do motor.** A Autoridade verifica o `purchaseTicket` (assinatura HMAC, `nonce` não usado, `exp` no futuro) e só então passa o payload já verificado em `ctx.ticket`. O motor não assina nem valida assinatura — ele **compara** campos. Duas camadas com responsabilidades separadas: uma prova quem falou, a outra decide se o que foi dito cabe no mandato.

```js
// ctx = { ticket, authenticatedMerchantId, approval, now }
//   ticket                  -> payload do purchaseTicket JÁ VERIFICADO (assinatura, nonce, exp)
//                              pela Autoridade. O agentId sai DAQUI — nunca do corpo, nunca
//                              da palavra da loja.
//   authenticatedMerchantId -> da apiKey da loja, NUNCA do corpo
//   approval                -> aprovação humana desta compra, se houver (null se não)
function evaluate(mandate, purchase, ctx) {
  const { ticket, authenticatedMerchantId, approval, now = new Date() } = ctx;
  const authenticatedAgentId = ticket.agentId;

  // 0) o bilhete descreve ESTA compra, nesta loja, sob este mandato
  //    (fecha a loja registrada inventando uma cobrança sozinha, e o replay em outra loja)
  if (ticket.mandateId  !== mandate._id)              return deny("bilhete não é deste mandato");
  if (ticket.merchantId !== authenticatedMerchantId)  return deny("bilhete não é desta loja");
  if (ticket.productId  !== purchase.productId)       return deny("bilhete não é deste produto");

  //    o VERIFICADO é o COBRADO: o valor que a loja atesta tem que ser o que o agente escolheu.
  //    As constraints são TETOS — R$98 e R$99,99 passam igual; só o bilhete diz qual foi pedido.
  if (ticket.price    !== purchase.price)             return deny("preço atestado difere do que o agente pediu");
  if (ticket.currency !== purchase.currency)          return deny("moeda atestada difere da que o agente pediu");

  //    e a moeda do mandato manda: sem isso, price/lte/10000 aprovaria US$100 igual a R$100
  if (mandate.currency !== purchase.currency)         return deny("moeda fora do mandato");

  // 1) estado do mandato (checagens vivas — é aqui que a abordagem B ganha)
  if (mandate.revoked)                         return deny("revogado");
  if (mandate.expiresAt < now)                 return deny("expirado");
  if (mandate.maxUses != null &&
      mandate.usedCount >= mandate.maxUses)    return deny("limite de usos atingido");

  // 2) dono: identidade PROVADA (assinatura do agente), não declarada por ninguém
  if (authenticatedAgentId !== mandate.agentId) return deny("agente não é o dono do mandato");

  // 3) constraints de atributo (motor genérico)
  for (const c of mandate.constraints) {
    const real = purchase.attributes[c.attr];

    if (real === undefined) {                                  // AUSÊNCIA -> on_missing
      if (c.on_missing === "allow")    continue;
      if (c.on_missing === "escalate") return escalate(`atributo ausente: ${c.attr}`);
      return deny(`atributo ausente: ${c.attr}`);              // default: deny
    }

    const op = OPS[c.op];
    if (!op) return deny(`operador desconhecido: ${c.op}`);    // erro de dados: nega, nunca escala

    if (!op(real, c.value)) {                                  // FALHA -> on_fail
      // fora do mandato: recusa OU escala, nunca aprova em silêncio
      const reason = `falhou: ${c.attr} ${c.op} ${JSON.stringify(c.value)}`;
      return c.on_fail === "escalate" ? escalate(reason) : deny(reason);   // default: deny
    }
  }

  // 4) modo: a aprovação por compra é imposta AQUI, não no agente
  if (mandate.mode === "aprovacao" && !approvalMatches(approval, mandate, purchase, ctx)) {
    return escalate("mandato exige aprovação humana para esta compra");
  }

  return ok();
}

// A aprovação é grudada NAQUELA compra e vale UMA vez. Aprovar um tênis de R$98
// não pode virar um cheque em branco para outra coisa de R$300.
function approvalMatches(approval, mandate, purchase, ctx) {
  return !!approval
    && approval.status     === "approved"
    && approval.mandateId  === mandate._id
    && approval.merchantId === ctx.authenticatedMerchantId
    && approval.productId  === purchase.productId
    && approval.price      === purchase.price
    && approval.consumedAt == null
    && approval.expiresAt  > (ctx.now ?? new Date());
}

const ok       = ()       => ({ valid: true });
const deny     = (reason) => ({ valid: false, action: "reject",   reason });
const escalate = (reason) => ({ valid: false, action: "escalate", reason });
```

> **Consumo atômico (TOCTOU):** quando `evaluate` aprova, o incremento de `usedCount` **e** a decisão devem acontecer numa única operação atômica (`findOneAndUpdate` condicional em `{ _id, revoked:false, usedCount:{ $lt: maxUses } }`), para fechar a janela entre "verificou" e "usou". A aprovação, quando existe, é **consumida na mesma transação** (`consumedAt`), para não ser reutilizada por uma segunda tentativa concorrente. O `nonce` do bilhete é gravado na mesma operação. Ver `docs/05-security-and-ugly-cases.md`.

> **Idempotência e compensação:** a retentativa é o caminho **normal** aqui — o agente retenta depois de uma aprovação, e qualquer rede perde respostas. Duas amarras:
>
> - **Idempotência.** Toda tentativa carrega uma `idempotencyKey`. Repetir a mesma chave devolve a **mesma resposta gravada**, sem reavaliar, sem consumir uso e sem cobrar de novo. Sem isso, uma resposta perdida vira cobrança dupla.
> - **Compensação.** O uso é consumido *antes* da cobrança (é o que fecha o TOCTOU). Se o cofre recusar, a Autoridade **devolve o uso** (`$inc: { usedCount: -1 }`), reabre a aprovação consumida e registra `payment_result: recusado` no trilho. Sem isso, uma falha de pagamento queimaria um uso do mandato sem entregar nada.

## O portão do modo `aprovacao` (imposto pela Autoridade)

`mode` diz se o mandato exige um "ok" humano **por compra** (`aprovacao`) ou não (`autonomo`) — ver D11 em `docs/06-decision-log.md`. A pergunta de projeto é **quem segura a compra**:

- **O Agente segura** (ele lê o modo, para e espera o ok): simples, e errado. A trava que existe para limitar o agente ficaria **dentro** do agente. Um bug, uma conversa manipulada ("minha chefe já aprovou por fora") ou um agente adversarial que simplesmente não lê o campo passam direto, e não há nada atrás para pegar. Viola a invariante 1 do `CLAUDE.md`.
- **A Autoridade segura** (escolhido): toda compra num mandato `aprovacao` volta `escalate`, **a menos que** exista uma aprovação humana registrada para aquela compra. O agente não consegue pular a etapa nem querendo — não é disciplina dele, é topologia.

Fluxo em dois passos:

1. Agente tenta comprar → `/introspect` responde `escalate` e a **Autoridade** grava um pedido pendente com a compra exata (mandato, loja, produto, preço). *O agente não escreve nada — invariante 3.*
2. Humano vê o pendente na Trusted Surface e aprova → agente tenta de novo → `evaluate` acha a aprovação, casa, e libera.

O casamento é **estreito e de uso único** (`approvalMatches` acima): mesmo mandato, mesma loja, mesmo produto, mesmo preço, não consumida e não expirada. Uma aprovação larga viraria cheque em branco — ver `docs/05-security-and-ugly-cases.md`.

Note que `escalate` vindo de `on_fail` usa **o mesmo mecanismo**: nos dois casos a pergunta é "esta compra específica tem um sim explícito do humano?". Um mecanismo, duas origens.

> Paralelo AP2: o mandato é o *Intent Mandate*; a aprovação de uma compra específica é o *Cart Mandate*.

## Exemplos que provam a universalidade (mesmo código, dados diferentes)

**Pasta de dente** (não quero da China):
```js
constraints: [
  { attr:"category",     op:"eq",  value:"higiene", on_missing:"deny" },
  { attr:"price",        op:"lte", value:3000,      on_missing:"deny" },
  { attr:"ship_country", op:"eq",  value:"BR",      on_missing:"deny" }
]
// loja manda ship_country:"CN" -> falha em ship_country -> recusa. Correto.
```

**Assinatura de plataforma** (localização é irrelevante):
```js
constraints: [
  { attr:"category", op:"eq",  value:"software", on_missing:"deny" },
  { attr:"price",    op:"lte", value:5000,       on_missing:"deny" }
]
// nenhuma constraint de ship_country -> país nem é olhado -> passa de qualquer origem. Correto.
```

**O mesmo `evaluate` tratou os dois** — a diferença viveu inteiramente nos dados. Nunca escreva `if (produto === "pasta de dente")`.

## Onde a inteligência do agente entra (não confundir com o motor)

O **motor** é burro e determinístico de propósito. A **inteligência de saber quais perguntas importam** é do Agente (LLM), e roda **antes**, na conversa com o humano:

1. O Agente consulta o catálogo real das lojas candidatas.
2. Descobre quais atributos **existem e variam** entre as opções daquele produto (ex.: `size` varia entre tênis → é decisão-crítica; `size` não existe para assinatura → não pergunta).
3. Resolve as lacunas críticas **com o humano presente** (pergunta o tamanho).
4. Deriva as `constraints` usando **os nomes de atributo do próprio catálogo** (garante o casamento de nomes).
5. Deposita a proposta na Trusted Surface para o humano confirmar.

Regra defensável para a banca: *"o agente pergunta sobre um atributo porque ele varia no catálogo real, não porque um modelo achou que devia"* — ancorado em dado, auditável, com a fluência do LLM só por cima.
