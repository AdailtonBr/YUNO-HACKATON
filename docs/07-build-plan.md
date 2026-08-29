# 07 — Plano de Build

Ordem de implementação pensada para ter, o quanto antes, o **fluxo feliz de ponta a ponta** rodando, e só então enriquecer com os casos feios e os bonus. Não comece pelos bonus.

## Fase 0 — Fundações
- Monorepo ou dois pacotes: `app1/` (Autoridade + Agente + UI) e `app2/` (duas lojas).
- MongoDB com as coleções de `docs/03`: `mandates`, `merchants`, `agents`, `approvals`, `used_nonces`, `mandate_proposals`, `audit_log`, `idempotency`.
- Seed: dois merchants na allow-list (`store_a`, `store_b`) com apiKey; um agente com segredo; catálogos com interseção (ver Fase 4).

## Fase 1 — Autoridade (o coração) — ✅ **feita** (57 testes verdes, `npm test`)
1. Modelos `mandates`, `merchants`, `agents` (schemas de `docs/03`).
2. **Motor de constraints** (`docs/04`) como módulo **puro** e testável (`evaluate(mandate, purchase, ctx)`) — escreva este primeiro, com os testes.
3. **Bilhete do agente** (`docs/03`): emissão e verificação HMAC, `nonce` de uso único, `exp` curto. A cripto fica fora do motor: a Autoridade verifica e passa o payload em `ctx.ticket`.
4. `POST /mandates` (humanId da sessão, `maxUses` default 1), `POST /mandates/:id/revoke`, `GET /mandates`, `GET /mandates/:id`.
5. `POST /introspect` com: autenticação da loja (apiKey → merchantId), **verificação do bilhete**, chamada ao motor, **consumo atômico** (`findOneAndUpdate` + gravação do nonce), gravação no `audit_log`, disparo de pagamento, **idempotência** e **compensação** se o cofre recusar.
6. Coleção `approvals` + rotas `GET /approvals`, `POST /approvals/:id/approve|reject`. Quando o motor responde `escalate`, a Autoridade grava a pendência com a compra congelada e devolve o `approvalRequestId`. **Só a Autoridade escreve aqui.**
7. `POST /pay` interno + integração com o cofre mock (`/vault/tokenize` e `/vault/charge`).
> Escreva **testes unitários do motor** cedo — é o que a banca vai estressar:
> - **Motor:** fora do mandato · expirado · revogado · esgotado · impostor · `on_missing` (deny/escalate/allow) · `on_fail` (deny/escalate) · moeda divergente.
> - **Portão de aprovação:** sem aprovação escala · com aprovação casada passa · outro produto/preço não passa · consumida ou expirada não passa.
> - **Bilhete:** válido · segredo errado · `productId`/`price` divergindo do que a loja atesta · replay do mesmo nonce · expirado · bilhete de outra loja · bilhete de outro agente.
> - **Ataque da loja:** loja registrada chamando `/introspect` sem bilhete válido → recusado.
> - **Idempotência:** mesma chave duas vezes → um recibo só, `usedCount` incrementado uma vez.
> - **Concorrência:** duas tentativas simultâneas num mandato `maxUses: 1` → só uma passa.

## Fase 2 — Cofre/PSP mock (dois trilhos)
- `POST /vault/charge` que reconhece ref de **cartão** e de **Pix** e devolve `{ receiptId, rail, status:"pago" }`.
- Vincular método na criação do mandato: o humano "escolhe" cartão ou chave Pix (fake) → vira `paymentMethodRef`. O cru nunca é persistido.
- Deixe explícito no código/README o que é real (topologia: Autoridade lê a ref e chama o cofre; agente nunca vê) vs mock (o dinheiro).

## Fase 3 — Trusted Surface (UI, App 1)
- Página `/mandatos/pendentes` na navbar.
- Renderizador `constraints -> linguagem natural` (mesmo JSON que será verificado).
- Fluxo: agente deposita proposta → humano revisa em PT-BR → confirma → `POST /mandates`.
- Página `/compras/pendentes`: aprovações por compra (modo `aprovacao` e `on_fail: escalate`), mostrando a compra exata e o motivo. Aprovar libera **aquela** compra, uma vez — nunca alarga o mandato.
- Página `/mandatos` (registro do humano: o que foi autorizado, usos, status) + botão **Revogar**.
- Uma visão simples de **auditor** (lista do `audit_log`) para o resultado esperado "o auditor vê o trilho completo".

## Fase 4 — Lojas (App 2, ×2)
- Cada loja: `GET /catalog?q=` e `POST /buy` (monta os atributos **reais** do produto e chama `/introspect`, **repassando o `purchaseTicket` intacto** — a loja não gera nem altera o bilhete, e não afirma quem é o agente).
- **Adaptador** de vocabulário por loja (banco interno livre → vocabulário comum de `docs/03`).
- Catálogos com interseção proposital:
  - Ex.: **Tênis Runner** existe nas duas, a preços/atributos diferentes (testa comparação).
  - **Assinatura X** só na Loja A. **Fone Y** só na Loja B.
  - Um item na Loja A com `ship_country: "CN"` (para demonstrar a constraint de país barrando).
- Uma **loja não-registrada** (fora da allow-list) para demonstrar recusa (anti-site-fake).

## Fase 5 — Agente (App 1)
- Orquestração via **OpenAI API** (chave em `OPENAI_API_KEY`, nunca no repo). Capacidades:
  1. Interpretar o pedido do humano em linguagem natural.
  2. Consultar catálogos das lojas candidatas; detectar atributos que **existem e variam** → decidir o que perguntar.
  3. Resolver lacunas críticas **com o humano** (ex.: tamanho) antes de propor o mandato.
  4. Montar a **proposta** (`constraints` com nomes derivados do catálogo, `mode`, `expiresAt`, `paymentMethodRef`).
  5. Depois de criado o mandato: se `autonomo`, **comparar** as opções entre as lojas e comprar a melhor dentro do mandato; se `aprovacao`, montar o carrinho e escalar para o humano antes de pagar.
  6. Registrar para o humano o que comprou e sob qual mandato; guardar a comparação auditável.
- **Nunca** deixe o agente escrever no estado do mandato nem julgar a verificação.

## Fase 6 — Casos feios e bonus
- Bifurcação recusar-vs-escalar no `/buy` e na UI.
- Fluxo de **disputa** (bonus): humano nega uma compra na UI → mostra o `audit_log` resolvendo.
- Condições ricas (bonus): `maxUses`/`usedCount` ("até N vezes"), `price/lte` ("abaixo de R$X").
- Roteiro de **agente adversarial** (bonus): mostrar que manipular a conversa não cria/alarga mandato nem passa compra fora do teto.
- **Painel de operador nas lojas (App 2)** — pedido para uma fase futura. Uma tela por loja onde se **edita o preço** de um produto ao vivo, para ver o agente mudar de comportamento (o mais barato deixa de caber; a comparação troca de loja; o bilhete assinado deixa de casar se o preço mudar entre a busca e a compra). É tela da **loja**, não da Trusted Surface — o merchant mexendo no catálogo dele. Hoje os catálogos são vistos em `GET /catalog` de cada loja (`:4001`, `:4002`, `:4003`).

---

## O que é REAL vs MOCK (deixe explícito na demo e no README)

**Real (a lógica que a banca julga):**
- Mandato como fonte da verdade no servidor; agente só carrega o id.
- Verificação determinística (motor de constraints) com estado vivo (revogação/expiração).
- Identidade do agente **provada** por bilhete assinado que a loja só transporta — não declarada por ninguém.
- `paymentMethodRef` no mandato; **Autoridade** dispara o pagamento; agente nunca vê o instrumento.
- Allow-list de merchants autenticados.
- Trilho auditável append-only.

**Mock (não gaste tempo integrando de verdade):**
- Movimentação de dinheiro (cartão/Pix) — o cofre devolve recibo fake.
- Catálogos e preços das lojas.
- Vínculo do método de pagamento (o "cofre" só guarda uma ref fake).

---

## Roteiro da demo (mapeia 1:1 aos resultados esperados)

1. **Criar mandato + compra feliz:** humano pede "tênis tam. 40 até R$100, só BR, autônomo"; agente pergunta o que falta, propõe, humano confirma na Trusted Surface; agente compara Loja A vs B e compra a melhor **dentro** do mandato; humano vê o registro; loja vê sua verificação.
2. **Fora do mandato:** tentar um tênis a R$300 (excede) e um da China (categoria/país) → **recusado ou escalado**, nunca aprovado em silêncio.
3. **Revogação ao vivo (prova de fogo):** o juiz revoga na UI → a próxima compra do agente **falha** — sem o time tocar em nada.
4. **Cada parte vê o seu:** humano (registro), merchant (verificação), auditor (trilho completo).
5. **Bonus:** disputa resolvida pelo trilho; mandato "até 3 vezes"; agente adversarial contido.

## Critérios de "pronto"
- [ ] Fluxo feliz de ponta a ponta funciona com as duas lojas e comparação.
- [ ] Os 3 casos feios do enunciado passam (fora do mandato, expirado/revogado, impostor).
- [ ] Revogação ao vivo funciona sem intervenção.
- [ ] Cartão e Pix mockados, ambos disparados pela Autoridade.
- [ ] `audit_log` completo e legível.
- [ ] Decision Log escrito (ver `docs/06`) e diagrama de arquitetura exportado (ver `docs/02`).
