# 11 — Fluxo em produção e integração de pagamento

Este doc responde duas perguntas que a banca faz junto: *"me mostra uma compra acontecendo de ponta a ponta"* e *"onde é que entra um provedor de pagamento de verdade?"*.

A resposta curta para a segunda está no fim, e vale adiantar: o ponto de integração é **um só**, e ele fica **depois** da decisão.

## O ciclo completo de uma compra

### 1. O humano fala

O humano escreve no chat (React, App 1). O backend `/agent/chat` roda o loop do agente — cérebro, mãos e corpo, ver `docs/09-agent.md`. Se ainda não existe mandato, esta etapa termina com uma **proposta** depositada na Trusted Surface, e nada mais acontece até o humano autorizar.

### 2. O agente busca e compara

O agente chama `search_catalog`, que faz `GET /catalog` nas **duas lojas** em paralelo. Cada loja responde no **vocabulário comum**, traduzido do banco dela pelo adaptador — a Loja A guarda `preco_reais/tipo/origem`, a Loja B guarda `amount_cents/kind/ships_from`, e do lado de fora as duas falam a mesma língua (`docs/03`).

Com as opções na mão, o agente compara preço e atributos e escolhe a melhor **que cabe no mandato**. Essa filtragem é conveniência: ela evita tentativas inúteis, e **não autoriza nada**.

### 3. O agente tenta comprar

O agente assina um `purchaseTicket` — `{mandateId, merchantId, productId, price, currency, nonce, exp}`, HMAC com o segredo que só ele e a Autoridade conhecem — e chama `POST /buy` na loja, levando o `mandateId` e o bilhete.

O bilhete é a identidade **provada** do agente (D16). A loja não o gera e não o altera: ela **repassa**.

### 4. A loja verifica com a Autoridade

A loja monta os atributos **reais** do produto, a partir do produto real dela, e chama `POST /introspect` na Autoridade, autenticando-se com a própria apiKey.

A Autoridade então, em ordem:

- confere a idempotência (retentativa não cobra duas vezes);
- **verifica o bilhete** — assinatura, nonce não usado, não expirado, e se ele descreve *esta* compra nesta loja;
- roda o **motor de constraints**: limites batem? o agente é o dono? não foi revogado? não expirou? ainda tem uso?
- consome o uso **atomicamente**, fechando a janela TOCTOU.

Sai daqui um de três: `valid`, `reject` ou `escalate`.

### 5. A Autoridade dispara o pagamento

**Só se o passo 4 disse `valid`.** A Autoridade lê o `paymentMethodRef` do mandato — que o agente nunca viu — e chama o executor de pagamento com **exatamente o valor verificado**. Volta um recibo; a Autoridade responde à loja; a loja confirma ao agente; o agente reporta ao humano.

Se o pagamento for recusado, a Autoridade **compensa**: devolve o uso consumido e registra o resultado no trilho.

## Diagrama

```mermaid
sequenceDiagram
    actor H as Humano
    participant UI as Chat (React)
    participant AG as Agente (App 1)
    participant LO as Loja (App 2)
    participant AU as Autoridade (App 1)
    participant PS as Executor de pagamento<br/>(mock hoje · Yuno em produção)

    H->>UI: "compre um tênis 40, até R$100"
    UI->>AG: POST /agent/chat
    Note over AG: loop: cérebro pede tool,<br/>corpo executa de verdade

    AG->>LO: GET /catalog (Loja A e Loja B, em paralelo)
    LO-->>AG: produtos no vocabulário comum
    Note over AG: compara preço e atributos;<br/>escolhe a melhor que cabe

    AG->>AG: assina purchaseTicket (HMAC)
    AG->>LO: POST /buy { productId, mandateId, purchaseTicket }
    Note over LO: monta os atributos REAIS do produto;<br/>repassa o bilhete INTACTO

    LO->>AU: POST /introspect (apiKey da loja)
    AU->>AU: verifica bilhete → deriva agentId
    AU->>AU: motor: limites? dono? revogado? expirado?
    AU->>AU: consumo atômico (fecha TOCTOU)

    alt válido
        AU->>PS: cobra paymentMethodRef · valor VERIFICADO
        PS-->>AU: recibo
        AU-->>LO: { valid: true, receiptId }
        LO-->>AG: compra confirmada
        AG-->>H: "comprei na Loja B por R$94,00"
    else fora do mandato
        AU-->>LO: { valid: false, action: "reject", reason }
        LO-->>AG: recusado
        AG-->>H: relata a recusa, com a regra que decidiu
    else exige aprovação
        AU->>AU: grava pendência com a compra congelada
        AU-->>LO: { valid: false, action: "escalate", approvalRequestId }
        AG-->>H: "precisa da sua aprovação"
        H->>AU: aprova na Trusted Surface
        Note over AG: agente retenta; agora casa
    end
```

## Onde entra a Yuno

Repare no diagrama: existe **uma única seta** saindo do nosso sistema para um serviço de pagamento, e ela sai da **Autoridade**, **depois** do "sim".

Isso não é acidente — é a topologia que torna tudo o resto verdadeiro:

- O **agente** não tem essa seta. Ele nunca vê o instrumento nem inicia cobrança.
- A **loja** não tem essa seta. Ela recebe um recibo; não puxa dinheiro.
- Só a **Autoridade** tem, e ela só a usa depois de verificar.

### Hoje: mock

`POST /vault/charge` reconhece o tipo da ref e devolve `{ receiptId, rail, status: "pago" }`, cobrindo cartão e Pix como trilhos diferentes atrás da mesma porta. O mock pode **recusar**, de propósito, para exercitar a compensação.

### Em produção: Yuno no lugar do mock

Quando a Autoridade decide "pode pagar", em vez do cofre fake ela chama a **orquestração da Yuno**, que roteia para o melhor PSP e move o dinheiro. O `paymentMethodRef` deixa de apontar para uma entrada em memória e passa a apontar para um **token no cofre da Yuno** — vinculado pelo humano na Trusted Surface, no mesmo momento e pelo mesmo caminho.

**Trocar o mock pela Yuno é trocar a URL de um endpoint.** Nada mais no sistema muda:

| Muda | Não muda |
|---|---|
| a URL e as credenciais do executor | o modelo de dados do mandato |
| o formato do recibo | o motor de constraints |
| onde o `paymentMethodRef` é resolvido | a introspecção, a revogação, o trilho |
| — | quem chama quem |

O motivo de ser tão barato é que o contrato dessa fronteira é mínimo: *"cobre este valor, desta referência, a favor desta loja, com esta chave de idempotência; devolva um recibo ou uma recusa"*. Tudo o que é difícil — decidir **se** pode — já aconteceu antes da chamada.

### A distinção que resume o projeto

> **Nosso sistema = autorização.** Agente + lojas + Autoridade decidem **SE** pode pagar: o mandato existe, é do agente certo, não foi revogado, não expirou, tem uso disponível, e a compra cabe nos limites.
>
> **Yuno / PSP = execução.** Move o dinheiro, **depois** do "sim", e só então.

O que o desafio pede — o mandato verificável, a verificação pelo merchant, a revogação ao vivo, o trilho auditável — vive inteiro do lado da autorização. O movimento do dinheiro é um serviço externo plugado no instante final, e é honesto dizer que é a parte que **não** inventamos.

## Real vs mock, sem eufemismo

**Real (é o que a banca julga):**

- o mandato como fonte da verdade no servidor, escrito só pela Autoridade;
- a verificação determinística com estado vivo — revogação e expiração lidas no instante da compra;
- a identidade do agente **provada** por bilhete assinado, com a loja como transporte;
- os atributos da compra **atestados pela loja**, a partir do produto real;
- o `paymentMethodRef` morando no mandato, com a **Autoridade** disparando a cobrança;
- a allow-list de merchants autenticados;
- o trilho append-only, com o veredito regra a regra.

**Mock (não gastamos tempo integrando):**

- o movimento do dinheiro — `/vault/charge` devolve recibo fake;
- os catálogos e preços das lojas;
- a tokenização do instrumento — o cofre guarda uma ref e um rótulo, não um token de PSP real.

A impossibilidade de o agente redirecionar uma cobrança é **topológica**, e está demonstrada por quem-chama-quem: não existe, em lugar nenhum do sistema, uma operação que credite alguém. Isso continua verdade quando o mock virar Yuno, porque a seta continua saindo do mesmo lugar.
