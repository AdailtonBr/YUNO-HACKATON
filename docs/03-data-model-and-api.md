# 03 — Modelo de Dados e Contratos de API

Todos os identificadores e nomes de campo em **inglês** (convenção). Textos para o humano em **português** (gerados a partir do dado, ver Trusted Surface).

## Vocabulário comum de atributos (mínimo, para a demo)

A Autoridade não mantém um catálogo de atributos possíveis — o motor é aberto a qualquer `attr` (ver `docs/04-constraint-engine.md`). Este vocabulário fixa apenas os **atributos universais** e o **formato**, para que loja e mandato usem a mesma string.

| Atributo | Tipo | Convenção |
|---|---|---|
| `productId` | string | o id do produto **naquela loja**. Atestado junto dos demais para que o mandato possa dizer *"compre exatamente este item"* — a regra mais apertada que existe. Como o id é por loja, um mandato assim compra ali e em lugar nenhum mais. |
| `price` | number | em **centavos** (evita float) |
| `currency` | string | ISO-4217 (`BRL`) |
| `category` | string | taxonomia grossa da demo: `calcado`, `higiene`, `software`, `evento`, `eletronico`. **Quase nunca basta sozinha num mandato** — ver `product_type` abaixo. |
| `product_type` | string | o que a coisa **é**: `headphones`, `keyboard`, `desk_lamp`, `running_shoe`, `toothpaste`… Existe porque `category` é grossa: um mandato de *"eletrônico até R$150"* compra uma luminária de R$89,90 quando a pessoa pediu um fone — e está tecnicamente certo, porque o mandato nunca disse "fone". É o atributo que permite ao mandato dizer o que você quis. |
| `ship_country` | string | ISO-3166 alpha-2 (`BR`, `CN`) |
| `size` | string | específico de calçado |
| `color` | string | específico |
| `brand` | string | específico |

> **Nem todo atributo que serve de regra é atributo que valha perguntar.** `productId` fica fora do perfil que o agente usa para decidir o que perguntar — todo item tem o seu, então ele "varia" sempre e trivialmente, e perguntar seria absurdo. Mas é regra legítima, e o agente lê o id do catálogo em vez de pedi-lo ao humano. Ver `docs/09-agent.md`.

> **Regra de ouro do casamento de nomes:** o Agente, ao montar constraints, **deriva os nomes de atributo do catálogo real das lojas candidatas** — nunca inventa. Assim `mandato.attr` sempre bate com `catalogo.attr` por construção. Atributos de nicho (não universais) são strings livres que loja e mandato combinam entre si; a Autoridade os transporta sem interpretar.

## Coleção `mandates` (Autoridade / Mongo)

```js
{
  _id: "mnd_9f3a2b...",          // id opaco de ALTA ENTROPIA (UUID v4 / random 128 bits). NUNCA sequencial.
  humanId: "user_42",             // dono humano (vem da SESSÃO do humano, nunca do corpo da requisição)
  agentId: "agent_42",            // agente autorizado (comparado com o agente PROVADO pelo purchaseTicket, ver abaixo)
  mode: "autonomo",               // "autonomo" (human-not-present) | "aprovacao" (human-present, exige ok por compra)
  constraints: [                  // lista aberta de regras {attr, op, value, on_missing, on_fail}
    { attr: "category",     op: "eq",  value: "calcado",  on_missing: "deny",     on_fail: "deny" },
    { attr: "price",        op: "lte", value: 10000,      on_missing: "deny",     on_fail: "escalate" }, // 10000 = R$100,00
    { attr: "size",         op: "eq",  value: "40",       on_missing: "deny",     on_fail: "deny" },
    { attr: "ship_country", op: "eq",  value: "BR",       on_missing: "escalate", on_fail: "deny" }
  ],
  currency: "BRL",                 // moeda do mandato. A compra só passa se a moeda atestada bater com esta.
  shippingAddressId: "adr_...",    // ID do endereço escolhido (a RUA vive no cofre), ou null se nada se entrega
  paymentMethodRef: "pm_ref_7c1e", // PONTEIRO opaco para o cofre. NUNCA o cartão/chave crus. Vinculado pelo humano.
  maxUses: 3,                      // OBRIGATÓRIO na criação. Default 1 (pedido de compra única).
  usedCount: 0,                    // contador (consumo atômico — ver TOCTOU em 05)
  expiresAt: ISODate("2026-08-31T23:59:59Z"),
  revoked: false,                  // SÓ o humano vira para true. Esgotar por uso NÃO revoga.
  createdAt: ISODate("..."),
  humanReadable: "Comprar calçado tamanho 40, no máximo R$100, só de vendedores no Brasil, até 3 vezes, válido até 31/08."
}
```

Notas:

- `constraints` é uma **lista aberta** — adicionar um atributo novo (ex.: `voltage`) **não exige mudança de código**, só que loja e mandato usem o mesmo nome.
- `on_missing` por constraint: `deny` | `allow` | `escalate` (ver 04). É a política "tratar ausência como não-satisfação, devolver o motivo, e deixar o cliente decidir a rigidez".
- `on_fail` por constraint: `deny` | `escalate`, default `deny` (ver 04). Eixo **independente** de `on_missing`: aquele trata "o atributo não veio", este trata "veio e não bateu". No exemplo acima, preço R$103 pergunta ao humano (`escalate`), mas origem `CN` recusa direto (`deny`) — o humano já respondeu essa pergunta ao criar o mandato. Não existe `on_fail: "allow"`.
- `humanReadable` é **derivado** das constraints (ver Trusted Surface). Nunca escrito à mão pelo agente em paralelo ao JSON.
- Condições ricas (bonus): `price/lte` cobre "abaixo de R$X"; `maxUses`+`usedCount` cobre "até N vezes"; `expiresAt` cobre "válido até".
- **`maxUses` é obrigatório na criação, default `1`.** Um mandato sem limite de usos é um cheque em aberto: o humano pede "um tênis", o agente compra hoje, e o mandato segue válido até `expiresAt` — um agente com bug ou comprometido compraria trinta, todos "dentro do mandato". Vale a mesma lógica de whitelist do `on_missing`: **esquecer o limite bloqueia** (1 uso), não libera.
- **`status` é derivado, nunca gravado:** `revoked` → `revoked`; `expiresAt < now` → `expired`; `usedCount >= maxUses` → `exhausted`; senão `active`. **Esgotado ≠ revogado** — um cumpriu o papel dele, o outro foi retirado pela mão do humano. Misturar os dois embaralha o trilho de auditoria, a disputa e a demo de revogação ao vivo.
- `currency` no mandato: o motor compara `price` como número puro, então sem esta checagem `price lte 10000` aprovaria US$100 do mesmo jeito que R$100. A moeda é conferida contra a **atestada pela loja** e contra a **assinada pelo agente** no `purchaseTicket`.

## Coleção `merchants` (Autoridade / allow-list)

```js
{
  _id: "store_a",
  name: "Loja A",
  apiKeyHash: "...",   // credencial que a loja usa para autenticar no /introspect. Loja não-registrada não participa.
  active: true
}
```

## Coleção `approvals` (Autoridade / human-in-the-loop)

Uma pendência = **uma compra específica esperando o "sim" do humano**. É o mecanismo único por trás dos dois caminhos de escalonamento: `mode: "aprovacao"` (o mandato exige ok por compra) e `on_fail: "escalate"` (uma regra falhou e o mandato manda perguntar).

```js
{
  _id: "apr_4d1c...",                    // id opaco de alta entropia (mesma regra do mandato)
  mandateId: "mnd_9f3a2b...",
  humanId: "user_42",                    // só o dono do mandato pode aprovar
  merchantId: "store_a",                 // da apiKey AUTENTICADA da loja, nunca do corpo
  productId: "TEN-001",
  price: 10300,                          // centavos — preço ATESTADO pela loja, congelado aqui
  currency: "BRL",
  attributes: { ... },                   // snapshot do que a loja atestou (para o humano ver o que aprova)
  origin: "mode_aprovacao",              // "mode_aprovacao" | "on_fail" — por que subiu ao humano
  reason: "falhou: price lte 10000",     // motivo devolvido pelo evaluate
  status: "pending",                     // "pending" | "approved" | "rejected"
  consumedAt: null,                      // carimbado na MESMA operação atômica que efetiva a compra
  expiresAt: ISODate("..."),             // janela curta (ex.: 15 min). Aprovação velha não vale.
  createdAt: ISODate("...")
}
```

Notas — cada uma fecha um furo:

- **Só a Autoridade escreve** esta coleção. O agente não cria pendência nem aprova nenhuma; ele apenas recebe `escalate` e tenta de novo depois. Invariante 3 do `CLAUDE.md` preservada.
- **Vínculo estreito + uso único.** A aprovação casa por `(mandateId, merchantId, productId, price)`, com `consumedAt: null` e não expirada. Sem isso, aprovar um tênis de R$98 viraria um cheque em branco para qualquer outra compra.
- **`price` é congelado no momento da pendência.** O humano aprova um número, não um produto de preço variável. Se a loja mudar o preço entre a pendência e a retentativa, o casamento falha e sobe nova pendência — correto.
- **Aprovar não alarga o mandato.** Libera *aquela* compra; `constraints`, teto e validade continuam intactos. Alargar mandato só acontece criando outro, pela mão do humano (D4).
- **Aprovar exige o humano autenticado** como `humanId` do mandato — pela Trusted Surface, num caminho que o agente não alcança.

## Coleção `agents` (Autoridade / identidade do agente)

```js
{
  _id: "agent_42",
  humanId: "user_42",       // de quem este agente é o agente
  hmacSecretHash: "...",    // o segredo cru vive só no agente e no cofre da Autoridade; a LOJA nunca o vê
  active: true,
  createdAt: ISODate("...")
}
```

## O bilhete de compra (`purchaseTicket`) — como a identidade do agente é **provada**

A Autoridade **não** aceita a palavra da loja sobre quem é o agente. A cada tentativa, o agente assina um bilhete que descreve exatamente a compra que ele está pedindo; a loja **repassa o bilhete intacto** e a Autoridade o verifica ela mesma.

```js
payload = { mandateId, merchantId, productId, price, currency, nonce, iat, exp }
ticket  = base64url(payload) + "." + hmacSha256(agentSecret, base64url(payload))
```

Regras:

- `agentId` **é derivado do bilhete verificado** — nunca lido do corpo da requisição, nunca aceito da loja.
- `nonce` de **uso único** (coleção `used_nonces`, índice TTL) e `exp` curto (~120 s): a loja não guarda um bilhete para reusar depois.
- `merchantId` no bilhete tem que bater com a loja **autenticada** pela apiKey: um bilhete emitido para a Loja A não vale na Loja B.
- `price` + `currency` no bilhete são o valor que o agente **viu no catálogo e escolheu**. A Autoridade só aprova se o valor **atestado pela loja** for exatamente esse.

Por que amarrar o preço, já que a loja atesta os atributos: as constraints são **tetos, não valores exatos**. Com um mandato "no máximo R$100", tanto R$98 quanto R$99,99 passam — e só o agente sabe qual dos dois ele de fato escolheu. Sem o preço no bilhete, a loja pode atestar um valor maior do que anunciou, ainda dentro do teto, e a Autoridade não tem com o que comparar. O bilhete é a **segunda fonte independente** daquele número.

> Amarramos o preço e a moeda, não `size`/`color`: o preço é o que move dinheiro. Se a loja atestar "tamanho 40" e enviar 42, isso é fraude de entrega — morre no `audit_log` e na disputa, não em cripto. O produto já está preso pelo `productId`.

## Coleção `used_nonces` (anti-replay)

```js
{ _id: "<nonce>", agentId: "agent_42", usedAt: ISODate("..."), expiresAt: ISODate("...") }  // índice TTL em expiresAt
```

## Coleção `mandate_proposals` (rascunho do agente, antes da confirmação humana)

O agente **deposita** aqui; ele não escreve em `mandates`. Só a confirmação do humano na Trusted Surface promove uma proposta a mandato.

```js
{
  _id: "prp_8b2f...",
  humanId: "user_42",
  agentId: "agent_42",         // do bilhete/canal autenticado do agente
  draft: { mode, constraints, currency, maxUses, expiresAt },   // MESMO formato que será gravado e verificado
  rationale: "size varia entre as opções do catálogo; perguntei o tamanho",
  status: "pending",           // "pending" | "confirmed" | "discarded"
  mandateId: null,             // preenchido quando o humano confirma
  createdAt: ISODate("...")
}
```

`paymentMethodRef` **não** vem na proposta: o humano vincula o método na Trusted Surface, no momento da confirmação. O agente não escolhe com o que se paga.

## Coleção `disputes` (Autoridade / "eu nunca autorizei isso")

O veredito é **calculado do trilho**, nunca afirmado — e depois **congelado**, com a evidência que o sustentou. Recalcular meses depois, sobre um trilho que cresceu, daria outra resposta; uma resolução que muda sozinha não resolve nada.

```js
{
  _id: "dsp_1a2b...",
  humanId: "user_michael",
  mandateId: "mnd_...",
  auditId: "aud_...",              // a compra contestada
  reason: "não reconheço esta compra",
  verdict: "authorized",           // "authorized" | "not_authorized" | "nothing_charged"
  brokenLink: null,                // qual elo faltou, quando falta algum
  charged: { productId, price, currency, merchantId, receiptId, ts, agentId },
  evidence: [ ... ],               // os cinco elos, com quem e quando
  createdAt: ISODate("...")
}
```

**Os cinco elos da cadeia de autorização.** Falte um, e o registro está do lado do titular:

| Elo | O que prova | De onde sai |
|---|---|---|
| `mandate_created` | o humano autorizou aqueles limites, **antes** da compra | `audit_log`, ator humano |
| `agent_identity` | quem comprou **provou** ser o agente do mandato | `agentIdAuthenticated`, derivado do bilhete assinado (D16) |
| `rules_passed` | as regras foram avaliadas e passaram | `trace`, regra a regra |
| `human_approval` | houve um sim para **aquela** compra | `approval_granted` casado por produto e preço (só se `mode: "aprovacao"`) |
| `charged_what_was_verified` | o valor cobrado é o valor verificado | `payment_result` com o mesmo recibo e o mesmo valor |

Repare que a ordem importa: um `mandate_created` **posterior** à compra não a legitima. É o tipo de coisa que só um trilho carimbado consegue distinguir.

## Catálogo das lojas (App 2 — cada loja tem o seu)

Formato **interno** livre (o banco da loja é dela). Na fronteira, o **adaptador** traduz para o vocabulário comum:

```js
// produto interno da Loja A (formato dela)
{ sku: "TEN-001", nome: "Tênis Runner", preco_reais: 98.0, tipo: "calcado",
  origem: "BR", numeracao: "40", cor: "preto", marca: "Acme" }

// o que o adaptador da Loja A EXPÕE (vocabulário comum):
function toCommon(p) {
  return {
    productId: p.sku,
    price: Math.round(p.preco_reais * 100),   // centavos
    currency: "BRL",
    category: MAP_CATEGORIA[p.tipo],          // taxonomia dela -> a comum
    ship_country: p.origem,
    size: p.numeracao,
    color: p.cor,
    brand: p.marca
  };
}
```

> A loja **mantém o banco intacto** e escreve um adaptador fino (dez–vinte linhas). O custo é **por loja, uma vez** — não por produto, não por cliente. É o mesmo padrão de integrar qualquer gateway.

## Log de auditoria `audit_log` (append-only)

```js
{
  _id: "...",
  ts: ISODate("..."),
  event: "purchase_decision",     // ver lista abaixo
  actor: { type: "agent", id: "agent_42" },   // "agent" | "human" | "merchant" | "authority"
  mandateId: "mnd_...",
  merchantId: "store_a",
  agentIdAuthenticated: "agent_42",   // derivado do purchaseTicket verificado
  purchase: { productId: "TEN-001", price: 9800, currency: "BRL", attributes: {...} },
  decision: "valido" | "recusado" | "escalado",
  reason: "acima do limite" | null,
  approvalId: "apr_..." | null,
  receiptId: "rcpt_..." | null,
  idempotencyKey: "..." | null
}
```

**Eventos registrados** (não só a compra — a disputa precisa do ciclo de vida inteiro):

| `event` | Quem | Por que está no trilho |
|---|---|---|
| `mandate_created` | humano | Prova que a autorização nasceu da mão dele, e com quais limites. |
| `mandate_revoked` | humano | O momento exato do freio — é o que a prova de fogo demonstra. |
| `approval_granted` / `approval_rejected` | humano | "Eu nunca autorizei isso" cai aqui: o sim específico está carimbado. |
| `purchase_decision` | agente (via loja) | A verificação: o que foi pedido, o que a loja atestou, o que a Autoridade decidiu. |
| `payment_result` | autoridade | O que de fato foi cobrado, e de qual `paymentMethodRef`. |

Base para o "trilho auditável" e para o fluxo de disputa (bonus). Append-only: nada é editado nem apagado.

---

## Contratos de endpoint

### Autoridade (App 1)

```
POST /mandates                      # cria mandato (chamado pela Trusted Surface após confirmação do humano)
  auth: sessão do HUMANO -> define humanId. NUNCA aceito do corpo (seria auto-declaração).
  body: { agentId, mode, constraints, currency, paymentMethodRef, maxUses, expiresAt, proposalId? }
  # maxUses é obrigatório; se ausente, a Autoridade assume 1 (nunca "ilimitado")
  -> { mandateId, humanReadable }

POST /mandates/:id/revoke           # revoga (chamado pelo humano na UI)
  auth: sessão do humano; só o dono
  -> { ok: true }

GET  /mandates                       # registro do humano: tudo o que ele autorizou
  auth: sessão do humano
  -> [ { mandateId, humanReadable, status, usedCount, maxUses, expiresAt }, ... ]

GET  /mandates/:id                   # registro para o humano (o que foi autorizado)
  -> { mode, humanReadable, status, revoked, usedCount, maxUses, ... }   # NÃO expõe paymentMethodRef cru

GET  /audit?mandateId=...            # trilho completo (visão do auditor / base da disputa)
  -> [ { auditId, ts, event, actor, decision, reason, trace, receiptId, ... }, ... ]

POST /disputes                       # o titular nega uma compra; o TRILHO responde
  auth: sessão do humano; só o dono do mandato
  body: { auditId, reason }
  -> { disputeId, verdict, brokenLink, charged, evidence }
  # o veredito sai do trilho daquele mandato, e é gravado junto com a evidência.
  # A própria disputa vira um evento `dispute_resolved` no trilho.

GET  /disputes                       # o que o titular já contestou, e como terminou
  -> [ { disputeId, verdict, brokenLink, charged, evidence, createdAt }, ... ]

POST /proposals                      # o AGENTE deposita um rascunho de mandato (não cria mandato)
  auth: credencial do agente
  body: { draft: { mode, constraints, currency, maxUses, expiresAt }, rationale }
  -> { proposalId }

GET  /proposals?status=pending       # Trusted Surface mostra ao humano para revisar
  auth: sessão do humano
  -> [ { proposalId, draft, humanReadable, rationale, agentId }, ... ]

POST /introspect                     # chamado pela LOJA (autenticada). Coração do sistema.
  auth: apiKey da loja -> define merchantId; loja não-registrada é recusada
  body: { mandateId, purchase: { productId, price, currency, attributes }, purchaseTicket, idempotencyKey }
  # NÃO existe campo agentId. O agentId é DERIVADO do purchaseTicket verificado pela Autoridade.
  # A loja repassa o bilhete intacto; ela é transporte da identidade do agente, não fonte dela.
  # A Autoridade confere: assinatura válida -> nonce não usado -> não expirado ->
  #   ticket.merchantId == loja autenticada -> ticket.productId/price/currency == o que a loja atestou.
  -> { valid: true, receiptId }                                            # aprovado e cobrado
   | { valid: false, action: "reject",   reason }                          # recusa dura (revogado/expirado/impostor/ticket inválido)
   | { valid: false, action: "escalate", reason, approvalRequestId }       # human-in-the-loop
  # no caso "escalate", a AUTORIDADE grava a pendência em `approvals` e devolve o id.
  # A loja/agente só pode aguardar e tentar de novo; nenhum dos dois escreve a decisão.
  # idempotencyKey: repetir a MESMA chave devolve a MESMA resposta, sem cobrar nem consumir de novo.

POST /wallet/methods                 # o humano cadastra um meio de pagamento
  auth: sessão do humano
  body: { rail: "card"|"pix", instrument: { ... } }   # o cru entra AQUI e não sai
  -> { methodId, rail, label }         # NUNCA devolve o paymentMethodRef

GET  /wallet/methods                 -> [ { methodId, rail, label }, ... ]
DELETE /wallet/methods/:id

POST /wallet/addresses               # body: { label, address }
  -> { addressId, label }            # NUNCA devolve a rua
GET  /wallet/addresses               -> [ { addressId, label }, ... ]
DELETE /wallet/addresses/:id

GET  /approvals?status=pending       # pendências do humano (Trusted Surface)
  auth: sessão do HUMANO (define humanId; o agente não tem acesso a esta rota)
  -> [ { approvalId, mandateId, merchantId, productId, price, attributes, origin, reason, expiresAt }, ... ]

POST /approvals/:id/approve          # o humano libera AQUELA compra (uso único, expira)
  auth: sessão do humano; só o `humanId` dono do mandato
  -> { ok: true }

POST /approvals/:id/reject
  -> { ok: true }

POST /pay                            # INTERNO à Autoridade (não exposto ao agente). Dispara o cofre/PSP.
  body: { paymentMethodRef, amount, currency, merchantId }
  -> { receiptId, status: "pago" }
```

### Cofre / PSP (mock — dois trilhos)

```
POST /vault/tokenize                 # chamado pela TRUSTED SURFACE, com o humano presente
  body: { rail: "card" | "pix", instrument: { ... } }   # o cru entra AQUI e não sai
  # o instrumento cru NUNCA é persistido pela Autoridade nem visto pelo agente
  -> { paymentMethodRef: "pm_ref_7c1e", rail, last4?: "4242" }   # só a ref e um rótulo para o humano reconhecer

POST /vault/charge                   # mock genérico; a Autoridade escolhe o trilho pelo tipo da ref
  body: { paymentMethodRef, amount, currency, merchantId, idempotencyKey }
  # se a ref for de cartão -> simula autorização de cartão
  # se a ref for de Pix    -> simula geração/confirmação de Pix (ou Pix Automático pré-autorizado)
  -> { receiptId, rail: "card" | "pix", status: "pago" }
   | { status: "recusado", reason }   # a Autoridade COMPENSA o uso já consumido (ver 04, TOCTOU)
```

> **Real vs mock:** é real que (a) o `paymentMethodRef` vive no mandato, (b) a **Autoridade** (não o agente, não a loja) lê a ref e chama o cofre, (c) o agente nunca vê a ref. É mock a movimentação de dinheiro e a integração com cartão/Bacen. A impossibilidade de o agente redirecionar a cobrança é **conceitual/topológica**, demonstrada por quem-chama-quem.

### Lojas (App 2)

```
GET  /catalog?q=tenis                # busca; retorna produtos no vocabulário comum
  -> [ { productId, price, category, ship_country, size, color, brand }, ... ]

POST /buy                            # o agente tenta comprar
  auth: credencial do agente na loja (controle de acesso DELA; não define identidade para a Autoridade)
  body: { productId, mandateId, purchaseTicket, idempotencyKey }
  # a loja monta os atributos REAIS do produto e chama /introspect,
  # REPASSANDO o purchaseTicket intacto — ela não o gera, não o altera, não o substitui
  -> { ok: true, receiptId } | { ok: false, action, reason }

GET  /verifications                  # o que ESTA loja verificou (visão do merchant na demo)
  auth: operador da loja
  -> [ { ts, mandateId, productId, price, decision, reason, receiptId }, ... ]
```

> **Quem descreve os atributos da compra é a LOJA** (a partir do produto real), nunca o agente. Isso fecha o *confused deputy*: o agente não pode mentir `price`/`category` para passar. Ver `docs/05-security-and-ugly-cases.md`.

## Trusted Surface (página de aceitação — App 1 UI)

- Rota dedicada na navbar (ex.: `/mandatos/pendentes`).
- O Agente **deposita** a proposta (rascunho de `constraints`, `mode`, `paymentMethodRef`, `expiresAt`).
- A página mostra o mandato em **linguagem natural**, gerada por um renderizador `{attr, op, value} -> frase` a partir **do mesmo JSON** que será verificado. Exemplos:
  - `price/lte/10000` → "gastar no máximo R$100,00"
  - `ship_country/eq/BR` → "só de vendedores no Brasil"
  - `size/eq/40` → "tamanho 40"
  - `mode/autonomo` → "comprar automaticamente sem me perguntar a cada compra"
  - `mode/aprovacao` → "me mostrar o carrinho e esperar minha aprovação antes de pagar"
  - `price/lte/10000` + `on_fail/escalate` → "gastar no máximo R$100,00 — **me perguntar** se passar disso"
  - `ship_country/eq/BR` + `on_missing/escalate` → "só de vendedores no Brasil — **me perguntar** se a loja não informar a origem"
- O humano **revisa e confirma** → só então a Autoridade grava o mandato. **O agente nunca cria o mandato sozinho.**
- O humano também **vincula o método de pagamento** aqui (o cartão/chave entra neste ambiente seguro e vira `paymentMethodRef`; o número cru nunca é guardado nem visto pelo agente).

### Página de pendências (aprovação por compra)

Segunda rota da Trusted Surface (ex.: `/compras/pendentes`), alimentada por `GET /approvals`. Mostra cada pendência com **a compra exata** que o humano está aprovando (loja, produto, preço, atributos atestados) e **por que** ela subiu (`origin` + `reason`: "o mandato exige sua aprovação" ou "passou R$3 do seu limite").

Aprovar aqui libera **aquela compra**, uma vez, dentro da janela de `expiresAt` — nunca alarga o mandato. É o mesmo princípio da criação: **a decisão de dinheiro nasce da mão do humano, num lugar que o agente não alcança.**
