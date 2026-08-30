# 06 — Decision Log

Este documento tem duas partes: **(A)** o registro das decisões já tomadas (fonte da verdade — não contradiga) e **(B)** como transformar isso no deliverable "Decision Log — alternatives considered and why you chose what you chose".

---

## Parte A — Decisões tomadas

Formato de cada decisão: **Decisão · Alternativas consideradas · Por que · Trade-off aceito.**

### D1 — Desafio: Challenge 1 ("The Buyer Who Isn't Human")
Compra agêntica com mandato verificável. (Challenge 4, sobre agente de voz/telefonia, foi descartado.)

### D2 — Verificação por **introspecção com referência opaca** (abordagem B), não JWT assinado (abordagem A)
- **Alternativas:** (A) mandato como JWT/Verifiable Credential assinado, verificado offline pela loja com chave pública (é o modelo do **AP2** do Google); (B) id opaco que a loja resolve chamando `/introspect` na Autoridade.
- **Por que B:** revogação ao vivo **trivial** (flag lida na próxima consulta) — e revogação ao vivo é literalmente o que a prova de fogo testa; **selective disclosure** (a loja só pergunta "cabe?", não vê os limites); **menos superfície de cripto** para dar errado na demo (sem par de chaves, sem `alg:none`/confusão de algoritmo).
- **Trade-off aceito:** uma chamada de rede por compra; dependência da Autoridade estar de pé; a prova de disputa é um log centralizado em vez de um token assinado portável. Em produção com alto volume, A escala melhor (verificação offline); no nosso escopo, revogação e simplicidade pesaram mais.
- **Nota AP2:** o AP2 usa A e, por isso, tem **revogação como problema secundário** (precisa de expiração curta + status vivo por cima da assinatura). Citar isso mostra que conhecemos o padrão de referência e escolhemos conscientemente diferente.

### D3 — Quatro papéis, com **Agente e Autoridade separados** dentro do App 1
- **Alternativa:** o agente também validar/criar mandato (o "app do agente" faz tudo).
- **Por que separar:** se o agente valida ou cria o mandato, ele se autoriza — o preso assinando a própria sentença. A autorização precisa vir de um papel que o agente não controla.
- **Trade-off:** co-locar no mesmo deploy exige disciplina (o agente não tem caminho de escrita ao estado). Defendemos como "papéis separados que por acaso rodam no mesmo processo".

### D4 — O **humano cria o mandato na Trusted Surface**, o agente apenas rascunha
- **Alternativa:** o agente cria o mandato (afinal é com ele que o humano fala).
- **Por que:** o mandato limita o agente; quem o cria não pode ser o limitado. O agente **conversa e propõe**; o humano **confirma e assina** numa página dedicada (navbar). Ataques de manipulação da conversa ("já foi aprovado") não conseguem criar/alargar mandato.
- **Trade-off:** um passo humano a mais no fluxo (aceitação). É o que torna o sistema defensável.

### D5 — Mandato mostrado em **linguagem natural**, derivada do mesmo JSON
- **Por que:** o humano só consente com o que entende; ninguém lê `{op:"lte",value:10000}`. A frase é gerada por um renderizador a partir **do mesmo** JSON que será verificado — nunca escrita pelo agente em paralelo (senão ele descreve "R$100" e grava R$1000).

### D6 — Motor de constraints **genérico** (`{attr, op, value, on_missing, on_fail}`), vocabulário aberto
- **Alternativa:** campos fixos (`maxAmount`, `category`) ou um catálogo central de atributos possíveis.
- **Por que:** produtos diferentes têm restrições diferentes (pasta tem país; assinatura não). Um motor que avalia uma lista de regras contra atributos trata todos os casos sem `if` por produto e sem catalogar o universo. Adicionar um atributo novo não muda o código.
- **Trade-off:** exige um **vocabulário comum** de nomes (ver D8).

### D7 — Ausência e falha são **eixos separados**: `on_missing` **e** `on_fail` por constraint
- **Decisão:** cada constraint carrega duas políticas independentes — `on_missing` (`deny`/`escalate`/`allow`, o atributo não veio) e `on_fail` (`deny`/`escalate`, veio e não bateu). Ambas default `deny`.
- **Alternativas:** (a) um campo só, `on_missing`, servindo aos dois casos; (b) falha sempre nega, escalonamento só para ausência.
- **Por que `on_missing`:** "tratar ausência como não-satisfação, devolver o motivo, e deixar o cliente decidir a rigidez". Uma loja sem um atributo não trava o sistema; só não atende mandatos que **exigem** aquele atributo. Default para dinheiro: **whitelist + deny** (esquecer uma regra bloqueia, não libera).
- **Por que separar `on_fail`:** "não sei" e "sei que não" são estados diferentes e pedem respostas diferentes — e duas regras do mesmo mandato querem políticas opostas. `ship_country/eq/BR` quer perguntar se a origem **não veio**, mas recusar direto se veio `CN` (o humano já respondeu isso ao criar o mandato). `price/lte/10000` quer o contrário: negar se o preço não veio, mas talvez perguntar se veio R$103. Um campo só forçaria as duas à mesma política e produziria ou um "quer comprar da China?" que contradiz o humano, ou a impossibilidade de escalar um estouro de R$3 — sendo que "rejected **or escalated**" é literalmente o que o enunciado pede. Reunir os dois casos sob um campo chamado `on_missing` também é semanticamente errado.
- **Trade-off:** um campo a mais no schema e uma política a mais para o humano entender na Trusted Surface (mitigado por defaults `deny` e pelo renderizador de linguagem natural). Não existe `on_fail: "allow"` — uma constraint que pode ser ignorada não devia estar no mandato.
- Detalhe em `docs/04-constraint-engine.md`.

### D8 — **Vocabulário comum** só para universais + formato; adaptador na loja
- **Alternativa:** a loja renomeia o banco dela; ou a Autoridade mantém um catálogo de todos os atributos.
- **Por que:** a loja mantém o banco intacto e escreve um **adaptador fino** (uma vez por loja, não por produto) que expõe seus campos no vocabulário comum. A Autoridade fixa só os **universais** (`price`, `category`, `ship_country`, ...) e o **formato**; atributos de nicho passam como strings opacas que ela não interpreta.
- **Casamento de nomes garantido por construção:** o agente **deriva os nomes das constraints do catálogo real** — não inventa. Assim `mandato.attr` sempre bate com `catalogo.attr`.

### D9 — Reconciliação semântica de nomes (ex.: `liga` ≈ `liga_cimento`) **fora do caminho crítico**
- **Alternativa:** um LLM interpretar nomes de atributo na hora da transação.
- **Por que não na transação:** poria um modelo probabilístico e não-auditável no ponto que libera dinheiro — risco de falso casamento (furo de autorização), nova superfície de ataque (engenheirar nomes) e não-determinismo ("por que aprovou? o modelo achou").
- **Decisão:** se usada, roda no **cadastro/onboarding da loja** (offline, com revisão humana) e é **congelada** como mapa determinístico. **IA rascunha, determinístico decide** — mesma filosofia do resto.

### D10 — Pagamento: **`paymentMethodRef` no mandato**, disparado pela Autoridade; cartão **e** Pix mockados
- **Por que:** quem inicia o pagamento carrega uma **referência**, nunca o instrumento. O humano vincula o método na Trusted Surface (o cru vai para um cofre/PSP e vira token). A **Autoridade** (não o agente, não a loja) lê a ref e dispara o cofre. Cartão e Pix são **trilhos diferentes atrás da mesma porta** — troca o executor, não a arquitetura. Paralelo real: **Pix Automático** (Bacen, 2025) é um mandato de pagamento pré-autorizado; **AP2** separa "autorizou?" de "pagamento válido?".
- **Trade-off/escopo:** movimentação de dinheiro é mock; a impossibilidade de o agente redirecionar a cobrança é topológica (quem-chama-quem), demonstrada, não integrada de verdade.

### D11 — Modo de operação é **atributo do mandato** (`autonomo` vs `aprovacao`), e o portão é **imposto pela Autoridade**
- **Por que o modo é do mandato:** "preciso aprovar cada compra?" é uma condição de autorização, decidida no **setup** (criação), não em runtime. `autonomo` = human-not-present (compra direto dentro dos limites); `aprovacao` = human-present (mostra o carrinho e espera ok). Mapeia ao AP2 **Intent Mandate** vs **Cart Mandate**.
- **Alternativa para o portão:** o **Agente** ler o modo, parar e esperar o ok. É o caminho óbvio e mais simples.
- **Por que na Autoridade:** colocar a trava no agente é pôr a trava dentro daquilo que ela existe para limitar. Um bug, uma conversa manipulada ("minha chefe já aprovou por fora") ou um agente adversarial que simplesmente não lê o campo passam direto, sem nada atrás para pegar — o oposto da invariante "autorização no servidor, nunca no agente". Na Autoridade, toda compra num mandato `aprovacao` volta `escalate` até existir uma aprovação humana **casada com aquela compra**: o agente não pula a etapa nem querendo. Não é disciplina dele, é topologia.
- **Mecanismo:** coleção `approvals` (ver `docs/03`), vínculo estreito por `(mandateId, merchantId, productId, price)`, **uso único** e expiração curta — senão aprovar um tênis de R$98 viraria cheque em branco para R$300. O **mesmo** mecanismo atende o `escalate` vindo de `on_fail` (D7): nos dois casos a pergunta é "esta compra específica tem um sim explícito do humano?".
- **Trade-off:** uma coleção, uma tela e uma ida-e-volta a mais no fluxo (o agente tenta, é escalado, o humano aprova, o agente tenta de novo). É o mesmo preço de D4 e pela mesma razão: é o que torna o sistema defensável.

### D12 — Duas lojas com **catálogos que se cruzam**
- **Por que:** produtos só na A, só na B, e compartilhados, para exercitar o **julgamento do agente** ao comparar concorrência (escolher a melhor opção dentro do mandato, com comparação auditável).

### D13 — Anti-site-fake por **allow-list de merchants autenticados** (credenciadora externa fora de escopo)
- **Por que:** o agente só compra em loja **registrada e autenticada** na Autoridade. Loja não-registrada não participa. Discutimos uma *credenciadora* externa (bandeiras, PSPs, federação tipo AP2) como o análogo real das Certificate Authorities, mas **deixamos fora do escopo** — no nosso sistema, o registro de merchants é mantido pela própria Autoridade. (Mencionar como evolução possível no decision log.)

### D14 — Trilho auditável append-only para disputa (bonus)
- Cada introspecção gera um registro imutável (quem, o quê, resposta, timestamp, recibo) que sustenta o fluxo de disputa.

### D15 — Caminho de escala do modelo de id opaco
- **Decisão:** manter **B puro no MVP** (uma chamada viva por compra) e tratar escala como uma curva a percorrer depois: Autoridade stateless shardada pelo próprio id opaco → cache da parte imutável → deny-list de revogados propagada por *push* (bloom filter no fast path) → TTL de frescura **tunável por mandato**.
- **Alternativas:** (a) já nascer em A (JWT assinado) por medo do custo da chamada viva; (b) assumir "B não escala" como limitação do protótipo e não responder à pergunta.
- **Por que:** o custo de B é uma chamada, e ela é um *point lookup* numa única shard — o id de alta entropia, escolhido por **segurança** (anti-enumeração), já é a chave de particionamento ideal. Só `revoked` e `usedCount` mudam; todo o resto é imutável e cacheável para sempre. Empurrado ao limite, B vira **A+B** (assinar o imutável, introspectar só a revogação): A e B **convergem**, então escolher B agora não fecha porta nenhuma.
- **Trade-off assumido:** em escala, a revogação passa de instantânea a **propagada** (sub-segundo a segundos). É irredutível — verificação local exige que "morreu" chegue ao verificador. Mitigado por ser tunável **por mandato**: alto valor → TTL 0, sempre ao vivo.
- Detalhe em `docs/08-scaling.md`.

### D16 — Identidade do agente **provada por bilhete assinado** (HMAC); a loja é transporte, não fonte
- **Decisão:** a cada tentativa, o agente assina um `purchaseTicket` (HMAC-SHA256 com segredo compartilhado agente↔Autoridade) descrevendo `{mandateId, merchantId, productId, price, currency, nonce, iat, exp}`. A loja **repassa o bilhete intacto**; a Autoridade o verifica e **deriva dele** o `agentId`. Não existe campo `agentId` no corpo do `/introspect`.
- **Alternativas:** (a) a loja autentica o agente e **conta** à Autoridade quem ele é (era o desenho anterior); (b) par de chaves Ed25519, com a Autoridade guardando só a pública.
- **Por que não (a):** uma loja registrada que atendeu uma compra legítima passa a conhecer `mandateId` e `agentId`. Com a Autoridade confiando na palavra dela, essa loja pode chamar `/introspect` depois, **sem agente nenhum**, e ser paga pela titular — mandato válido, loja na allow-list, atributos atestados por quem tem o direito de atestá-los. Nenhuma amarra pega; só o `audit_log` registra, depois do fato. Era um furo direto na invariante "identidade nunca é auto-declarada": ela apenas passava a ser **declarada por um terceiro**.
- **Por que HMAC e não Ed25519:** o argumento a favor de Ed25519 é que nem a Autoridade forjaria um bilhete. Mas a Autoridade **já é a raiz de confiança** — ela guarda o `paymentMethodRef`, decide toda verificação e dispara o pagamento; se ela for hostil, forjar bilhete é o menor dos problemas. HMAC fecha o mesmo ataque (a loja não tem o segredo) com muito menos peça móvel, na mesma linha de D2 ("menos superfície de cripto para dar errado na demo").
- **Por que o bilhete carrega `price`/`currency`:** as constraints são **tetos, não valores exatos**. Com "no máximo R$100", tanto R$98 quanto R$99,99 passam, e só o agente sabe qual ele escolheu no catálogo. Sem o preço assinado, a loja pode atestar um valor maior do que anunciou, dentro do teto, e a Autoridade não tem com o que comparar. O bilhete é a **segunda fonte independente** desse número.
- **Trade-off aceito:** uma coleção `agents` e uma `used_nonces`, gestão de segredo por agente, e uma tentativa a mais quando o preço muda entre a busca e a compra (o bilhete deixa de casar e o agente refaz — que é o comportamento correto). Não amarramos `size`/`color`: o preço é o que move dinheiro; divergência de atributo na entrega é fraude de entrega, resolvida no trilho e na disputa.

### D17 — `maxUses` **obrigatório, default 1**; esgotado ≠ revogado
- **Decisão:** todo mandato nasce com limite de usos; ausente, a Autoridade assume **1**. `status` é derivado (`active`/`exhausted`/`expired`/`revoked`) e `revoked` continua **exclusivo da mão do humano**.
- **Alternativas:** (a) `maxUses` opcional, mandato válido até `expiresAt` (era o desenho anterior); (b) a Autoridade **revogar automaticamente** o mandato após a compra.
- **Por que não (a):** mandato sem limite de usos é cheque em aberto. O humano pede "um tênis", o agente compra hoje, e o mandato segue válido por semanas — um agente com bug ou comprometido compraria trinta, todos "dentro do mandato". Mesma lógica do `on_missing`: **esquecer o limite tem que bloquear, não liberar**.
- **Por que não (b):** revogar automaticamente mistura "a humana retirou a autorização" com "o mandato cumpriu seu papel". São fatos diferentes, e a diferença importa em três lugares: no trilho de auditoria, na disputa, e na demo de revogação ao vivo — onde `revoked` precisa significar exatamente *"a humana puxou o freio"*.
- **Trade-off:** mandatos recorrentes exigem o humano dizer o número explicitamente. É o ponto: o número passa pela Trusted Surface e aparece no `humanReadable`.

### D18 — Idempotência e compensação no caminho de pagamento
- **Decisão:** toda tentativa carrega `idempotencyKey`. Repetir a mesma chave devolve a **mesma resposta gravada**, sem reavaliar, consumir uso ou cobrar. E como o uso é consumido *antes* da cobrança (para fechar o TOCTOU), uma recusa do cofre **compensa**: devolve o uso, reabre a aprovação, registra `payment_result`.
- **Alternativa:** ignorar (protótipo), tratando a retentativa como caso raro.
- **Por que:** a retentativa é o caminho **normal** aqui — o agente retenta depois de uma aprovação humana, e qualquer rede perde respostas. Sem idempotência, uma resposta perdida vira cobrança dupla; sem compensação, uma falha de pagamento queima um uso do mandato sem entregar nada. Para uma banca de uma empresa de pagamentos, é o tipo de detalhe que separa "protótipo" de "pensado".
- **Trade-off:** uma chave a mais em dois contratos e uma tabela de respostas gravadas. Barato.

---

### D19 — Quantidade: o teto de dinheiro é o do **total**, e mandato sem esse teto compra uma unidade

**Contexto.** O app só comprava uma unidade de cada coisa. "Quero dois tênis" não tinha como ser dito.

**O problema, que não é de conveniência.** A implementação óbvia — aceitar `quantity` e cobrar `price × quantity` — abre um buraco. O mandato diz `price lte 15000` e o humano lê isso como *"o agente pode gastar R$150"*. Com a quantidade solta, vinte unidades a R$150 são R$3.000 **sem violar regra nenhuma**: cada uma cabe. A invariante 5 (*o verificado é o cobrado*) continuaria verdadeira no papel, e ainda assim o número que o humano autorizou teria parado de significar o que ele achava.

**Decisão.**

1. `price` continua sendo o **unitário**; `total` (`price × quantity`) entra como atributo atestado novo. Não mudamos o significado de um atributo que já existia — mandatos antigos continuam querendo dizer o que diziam.
2. **O teto de dinheiro que limita gasto é o de `total`.** É ele que sai da conta.
3. **`quantity` e `total` são assinados no bilhete**, pela mesma razão que o preço: sem isso a loja infla a quantidade depois que o agente assinou, cada unidade dentro do teto. E a Autoridade **refaz a conta** — um total afirmado não é um total verificado.
4. **Mandato sem regra de `total` compra UMA unidade.** Esquecer bloqueia, não libera.
5. **`maxUses` conta compras, não unidades.** Levar dois tênis numa transação é um uso; quem limita quantidade é o `total`.
6. A aprovação humana **congela quantidade e total**: aprovar 2 por R$196 não autoriza 5.

**Alternativa rejeitada: migrar os mandatos antigos copiando `price` para `total`.** Seria a Autoridade reescrevendo o que um humano autorizou — alargar sozinha uma autorização é precisamente o que ela existe para impedir. Preferimos recusar e explicar: *"este mandato não limita o total, então autoriza uma unidade por vez"*.

**O que cai de graça.** `quantity lte 3` funciona **sem tocar no motor**, porque o vocabulário é aberto (D3) — é o motor genérico se pagando. E a frase do mandato mudou junto: `price` agora se lê *"pagar no máximo X por unidade"*, e só `total` se lê *"gastar no máximo X"*. A frase é o que o humano consente; deixá-la dizendo "gastar" sobre o unitário seria descrever o mandato errado para a única pessoa que precisa entendê-lo.

---

## Parte B — Como escrever o Decision Log (deliverable)

Os juízes querem ver **julgamento**, não features. Para cada decisão importante, escreva um bloco curto com esta estrutura:

> **Decisão:** \<o que escolhemos, em uma linha\>
> **Alternativas consideradas:** \<as opções reais, incluindo a que o "padrão" (AP2) usa\>
> **Por que escolhemos:** \<o raciocínio causal — o que a escolha otimiza\>
> **Trade-off assumido:** \<o que perdemos de propósito, e por que aceitamos\>

Regras de qualidade:

- **Sempre nomeie a alternativa que perdeu.** Uma decisão sem alternativa não é decisão. As mais fortes: B vs A (introspecção vs JWT/AP2), humano-cria vs agente-cria o mandato, motor genérico vs campos fixos, IA-na-transação vs IA-no-cadastro.
- **Ancore no critério do enunciado.** Ex.: "escolhemos B porque revogação ao vivo é o que a prova de fogo testa".
- **Seja honesto sobre os trade-offs.** Admitir "B não escala tão bem quanto A em alto volume; DoS na Autoridade para tudo" **fortalece** a defesa. Esconder fragilidade é o que perde ponto.
- **Cite o mundo real com precisão** (AP2: mandatos como Verifiable Credentials assinadas, separação autorizou-vs-pagamento-válido; Pix Automático como mandato pré-autorizado; Trusted Surface). Mostra que a escolha foi informada, não improvisada.
- **Priorize ~6–8 decisões de peso** (D2, D4, D6/D7, D10/D11, **D16**, D9, **D15**) em vez de listar as 18. Profundidade > cobertura.
  - **D16 é a mais forte da lista** e deve estar no slide: é a única que conta a história de um furo real *encontrado e fechado* — "confiávamos na palavra da loja sobre quem era o agente; percebemos que uma loja registrada podia cobrar sozinha; passamos a exigir prova assinada". Julgamento em movimento é exatamente o que a banca quer ver.
  - **D15** antecipa a objeção natural a B ("e em escala?") e a responde mostrando que A e B convergem no limite.

Ordem sugerida no slide/documento: D1 → D2 → D4 → D6/D7 → **D16** → D10/D11 → D9 → D13 → D15, cada uma no formato acima. D16 entra logo depois do modelo de confiança, porque é o que o torna verdadeiro; D15 fecha bem, retomando D2 e mostrando que a escolha do MVP não fecha porta nenhuma.
