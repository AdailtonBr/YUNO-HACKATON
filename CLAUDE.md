# CLAUDE.md

Instruções permanentes para o Claude Code neste repositório. **Leia antes de qualquer tarefa** e não contrarie estas regras. Detalhes completos em `docs/`.

## O que é este projeto

Camada de **autorização de compra agêntica** para o NextWave Hackathon 2026 (Yuno × Nauta, Challenge 1). Um humano autoriza um agente de IA a comprar dentro de limites verificáveis; um merchant verifica o mandato antes de aceitar; casos feios (fora do mandato, expirado, revogado ao vivo, agente impostor, disputa) são tratados explicitamente.

Dois apps: **App 1** (Agente + Autoridade de Mandato + UI) e **App 2** (duas lojas falsas com catálogos que se cruzam).

## Idioma — LEIA COM ATENÇÃO

- **Trabalho e planejamento com quem mantém o repo:** português (PT-BR). Converse, explique e comente em PT-BR.
- **Entrega final do app:** **inglês.** O produto final — todo texto de UI, mensagens ao usuário, README público, slides e qualquer conteúdo voltado ao usuário — deve ser em **inglês**. A construção inicial é em PT-BR, mas o alvo é um app entregue em inglês.
- **Regra prática:** escreva o código já com identificadores e JSON em inglês (isso nunca muda). Para strings visíveis ao usuário, **estruture para i18n desde o começo** (não hardcode PT-BR espalhado) — de preferência um dicionário de strings, para a virada PT-BR → inglês ser trivial no fim. Quando em dúvida sobre texto de UI, escreva em inglês.
- Comentários de código podem ficar em PT-BR durante a construção; na entrega, prefira comentários em inglês nos trechos que forem para o repo público.

## Regras invioláveis (as invariantes de segurança)

Estas não são negociáveis. Qualquer implementação que as viole está errada, por mais que "funcione" na demo.

1. **A autorização é imposta no servidor (Autoridade), nunca no agente.** O agente só *tenta*; quem responde "não" é a Autoridade. O agente nunca decide se uma compra é válida.
2. **O agente NUNCA cria nem alarga um mandato.** O mandato nasce da mão do humano na Trusted Surface. O agente apenas **rascunha uma proposta**; o humano **confirma e cria**.
3. **O agente NÃO tem caminho de escrita ao estado do mandato nem à revogação.** Agente e Autoridade compartilham o deploy do App 1, mas são papéis separados: o agente **lê** um id; só a Autoridade **escreve** o estado.
4. **Identidade e valores nunca são auto-declarados — nem declarados por terceiro.** O `agentId` que vale é o **derivado do `purchaseTicket` assinado pelo agente** e verificado pela Autoridade; nunca um campo do corpo, nem quando quem preenche o corpo é a loja. `price`/`category` são **atestados pela loja** (a partir do produto real), nunca pelo agente — e o `price` ainda precisa bater com o que o agente assinou no bilhete.
5. **O verificado é o cobrado.** O valor aprovado na introspecção é exatamente o valor enviado ao cofre. Sem gap entre o que se verificou e o que se cobrou. Retentativa é idempotente; se a cobrança falhar depois do consumo, a Autoridade **compensa** o uso.
6. **O agente nunca vê o instrumento de pagamento.** O mandato guarda um `paymentMethodRef` (ponteiro opaco). Quem lê a ref e dispara o pagamento é a **Autoridade** — nunca o agente, nunca a loja.
7. **Revogação é consulta viva.** Usamos a abordagem B (introspecção) justamente para que "ainda vale?" seja lido no instante da compra. Nada de assar a autorização num token estático.
8. **Nomes de atributo das constraints são derivados do catálogo real das lojas** — o agente nunca inventa nomes. É o que garante o casamento `mandato.attr == catalogo.attr`.
9. **Nenhum LLM no caminho crítico da transação.** IA rascunha; o determinístico (motor de constraints) decide. Reconciliação semântica de nomes, se existir, roda no cadastro da loja (offline, revisão humana) e é congelada como mapa determinístico.

## Decisões-chave já tomadas (não reabrir sem avisar quem mantém o repo)

- **Verificação = abordagem B** (referência opaca + `/introspect`), **não** JWT assinado. Motivo: revogação ao vivo trivial, selective disclosure, menos cripto. (AP2 usa JWT/VC assinado — é a alternativa citada no decision log.)
- **Motor de constraints genérico**: lista de `{attr, op, value, on_missing, on_fail}`, vocabulário aberto. Nunca `if (produto === "x")`.
- **`on_missing` e `on_fail` por constraint** — eixos **independentes**: `on_missing` (`deny`/`escalate`/`allow`) trata "o atributo não veio"; `on_fail` (`deny`/`escalate`, sem `allow`) trata "veio e não bateu". Ambos default `deny`; para dinheiro, **whitelist + deny** (esquecer regra bloqueia, não libera).
- **`mode` é atributo do mandato**: `autonomo` (compra direto) vs `aprovacao` (mostra carrinho e espera ok). Decidido no setup, não em runtime. **O portão é imposto pela Autoridade**, nunca pelo agente: mandato `aprovacao` volta `escalate` até existir uma `approval` casada com aquela compra (mesmo mandato/loja/produto/preço, uso único, expira). O mesmo mecanismo atende o `escalate` vindo de `on_fail`.
- **Identidade do agente = `purchaseTicket` assinado** (HMAC, segredo agente↔Autoridade). A loja **repassa intacto**, nunca gera nem afirma quem é o agente; a Autoridade verifica e deriva o `agentId`. O bilhete amarra `{mandateId, merchantId, productId, price, currency, nonce, exp}` — o preço entra porque as constraints são **tetos**, e sem ele a loja poderia atestar mais do que anunciou, dentro do teto.
- **`maxUses` obrigatório na criação, default 1.** `status` derivado (`active`/`exhausted`/`expired`/`revoked`); **esgotado ≠ revogado** — `revoked` só a mão do humano vira.
- **Idempotência obrigatória** em `/buy` e `/introspect`; se o cofre recusar depois do consumo atômico, a Autoridade **compensa** o uso.
- **Pagamento cartão + Pix mockados**; a topologia (Autoridade dispara o cofre) é real.
- **Duas lojas com catálogos que se cruzam** (só na A, só na B, compartilhados) para exercitar o julgamento do agente.
- **Anti-site-fake = allow-list de merchants autenticados** na Autoridade. Credenciadora externa ficou **fora de escopo**.
- **Quantidade: `price` é o unitário, `total` é o teto de gasto.** `total` (`price × quantity`) é atributo atestado, e **é o teto de `total` que limita gasto** — `price lte 15000` sozinho deixaria vinte unidades saírem por R$3.000 sem violar regra nenhuma. Quantidade e total são **assinados no bilhete** e a Autoridade **refaz a conta**. **Mandato sem regra de `total` compra UMA unidade** (esquecer bloqueia); a Autoridade **não** migra mandato antigo copiando `price` para `total`. `maxUses` conta compras, não unidades. Ver D19.

## Ordem de implementação

Siga `docs/07-build-plan.md`. Resumo: **fluxo feliz de ponta a ponta primeiro**, depois casos feios, depois bonus. Não comece pelos bonus.

> **Todas as fases estão feitas (134 testes verdes).** A lista abaixo fica como registro da ordem em que
> foi construído. O que falta **não é código**: slides, diagrama exportado e o Decision Log em formato de
> entrega.

1. Autoridade + motor de constraints (com testes unitários cedo).
2. Cofre/PSP mock (cartão + Pix).
3. Trusted Surface (UI de criação/revogação, mandato em linguagem natural derivada do JSON).
4. Duas lojas + adaptadores de vocabulário.
5. Agente (**OpenAI API**) — conversa, descobre atributos que variam, propõe, compara, compra.
6. Casos feios (recusar vs escalar) e bonus (disputa, condições ricas, agente adversarial).

## Real vs Mock

- **Real (o que a banca julga):** mandato como fonte da verdade no servidor; verificação determinística com estado vivo; identidade autenticada; `paymentMethodRef` no mandato disparado pela Autoridade; allow-list de merchants; trilho auditável append-only.
- **Mock:** movimentação de dinheiro (cartão/Pix), catálogos/preços das lojas, o cofre (devolve recibo fake).

## Mapa dos docs

- `docs/01-hackathon.md` — o desafio, deliverables, critérios, resultados esperados.
- `docs/02-architecture.md` — papéis, fluxo (mermaid), modelo de confiança.
- `docs/03-data-model-and-api.md` — schemas do Mongo e contratos de endpoint.
- `docs/04-constraint-engine.md` — o motor (`evaluate`), operadores, `on_missing`/`on_fail`, portão de aprovação, exemplos.
- `docs/05-security-and-ugly-cases.md` — casos feios, ataques, defesas.
- `docs/06-decision-log.md` — as decisões + como escrever o deliverable.
- `docs/07-build-plan.md` — build faseado, real vs mock, roteiro da demo.
- `docs/08-scaling.md` — caminho de escala do modelo de id opaco (não implementado no MVP; existe para defender "e em escala?").
- `docs/09-agent.md` — o agente: cérebro (LLM) + mãos (tools) + corpo (orquestrador), o loop, e por que as decisões do modelo são sugestões.
- `docs/11-fluxo-producao.md` — a compra de ponta a ponta e onde entra a Yuno (execução do pagamento, depois do "sim").

## Estilo de trabalho

- Quem mantém este repo quer **entender o porquê** e ser **dona do próprio código**: faça mudanças cirúrgicas e explique o raciocínio; não reescreva o que não foi pedido.
- Testa a consistência lógica e sinaliza contradições — seja causalmente explícito.
- Priorize decisões **defensáveis** (a defesa técnica pesa tanto quanto a demo) sobre features vistosas.
