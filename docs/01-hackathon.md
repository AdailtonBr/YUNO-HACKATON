# 01 — Contexto do Hackathon

## O evento

**NextWave Hackathon 2026**, promovido por **Yuno × Nauta**, com apoio de OpenAI, Tec de Monterrey, Universidad Torcuato Di Tella e ECBR (E-commerce Brasil).

## O desafio: Challenge 1 — "The Buyer Who Isn't Human"

Todo sistema de pagamento pressupõe que quem aperta "pagar" é uma pessoa — e essa suposição está quebrando. Cada vez mais compras são feitas por um agente de IA em nome de alguém: um assistente que compra a passagem quando o preço cai, um agente que repõe estoque, um agente que compara e assina o melhor plano.

Quando o comprador é um agente, as perguntas mudam:

- Como o merchant sabe que este agente representa um humano real que autorizou a compra?
- Como uma pessoa autoriza seu agente a gastar **sem entregar o cartão cru**?
- O que acontece quando o agente erra, alucina uma compra, ou alguém se passa por ele?
- Quem responde pela disputa: o humano, o agente, o merchant?

Hoje não há boa resposta: merchants ou bloqueiam bots (e perdem a venda legítima) ou os deixam passar como humanos (e comem a fraude e os chargebacks). O **mandato** — a peça que tornaria tudo isso seguro — ainda não existe na prática. É ele que vamos construir.

## Definições oficiais do desafio

- **Merchant:** empresa que coleta pagamentos.
- **Purchasing agent:** sistema de IA que descobre, decide e compra em nome de uma pessoa (ou empresa).
- **Mandate:** a autorização verificável que um humano dá ao seu agente — o que pode comprar, com quais limites (valor, categoria, validade) e com qual método de pagamento.
- **Verification:** como o merchant confirma que o agente que compra dele age dentro de um mandato válido de um humano real.
- **Revocation:** o humano retira o mandato; toda compra posterior deve falhar.
- **Chargeback / disputa:** o titular nega o pagamento ("nunca autorizei isso") e o banco estorna.
- **Human-in-the-loop:** um ponto em que o agente deve parar e pedir aprovação humana.

## Objetivo (o circuito completo)

Construir o circuito completo de uma compra agêntica segura:

- [ ] Um humano cria um mandato de compra para seu agente: o quê, quanto, até quando, com qual método de pagamento — **sem entregar o cartão cru**.
- [ ] O merchant **verifica o mandato antes de aceitar**: agente legítimo, mandato válido, compra dentro dos limites.
- [ ] A compra roda de ponta a ponta: o agente descobre, decide e paga; o humano recebe um registro do que foi comprado e sob qual mandato.
- [ ] Os casos feios são tratados explicitamente: compra fora do mandato, mandato expirado ou revogado ao vivo, agente impostor, disputa posterior.
- [ ] Toda decisão de compra deixa um **trilho auditável** que humano, merchant e auditor conseguem ler.

**Pode incluir (não limitado a):** escalar para aprovação humana quando a compra cai fora do mandato; mandatos por categoria ou recorrentes; identidade do agente separada da identidade do humano.

## Prova de fogo (trial by fire)

Os juízes vão operar o sistema **ao vivo** — revogar o mandato e ver o agente tentar comprar, ou mudar um limite e ver o que acontece. O sistema deve reagir corretamente **sem o time tocar em nada**.

## Resultados esperados (roteiro da demo)

- [ ] Um humano criando um mandato e seu agente completando uma compra real (mockável) de ponta a ponta **dentro** daquele mandato.
- [ ] Uma tentativa **fora** do mandato (valor excedido, categoria proibida, expirado) **rejeitada ou escalada** para aprovação humana — nunca aprovada em silêncio.
- [ ] **Revogação ao vivo** funcionando: mandato revogado → a próxima tentativa falha.
- [ ] O que cada parte vê: o humano seu registro, o merchant sua verificação, o auditor o trilho completo.
- [ ] A prova de fogo passada.

### Bonus points

- Fluxo completo de **disputa**: o humano nega uma compra e o trilho auditável resolve quem tem razão.
- Mandatos com **condições ricas** ("se cair abaixo de R$150", "até 3 vezes por mês") avaliados corretamente.
- Defesa contra um **agente adversarial** tentando comprar fora do mandato por caminhos criativos.

## Caso fictício mínimo (do enunciado)

- **Merchant:** VuelaYa, agência de viagens online que quer aceitar compras de agentes sem abrir a porta pra fraude.
- **Comprador:** Marta autoriza seu agente pessoal: "compre uma passagem pra Córdoba se cair abaixo de $150, válido até o fim do mês".
- **Momentos-chave:**
  1. Marta cria o mandato; o agente começa a vigiar preços.
  2. Aparece uma passagem a $130 → o agente compra; Marta recebe seu registro; a VuelaYa sua verificação.
  3. O agente tenta comprar outra a $300 → fora do mandato → rejeitado ou escalado.
  4. Marta revoga o mandato; o agente tenta de novo → falha.

Catálogo, preços, mandatos, protocolos e métodos de pagamento podem ser inventados.

## Nosso caso de demo (adaptação nossa)

Mantemos o espírito do caso mínimo, mas usamos **duas lojas com catálogos que se cruzam** para exercitar o julgamento do agente ao comparar concorrência (ver `docs/07-build-plan.md` para o roteiro).

## Deliverables

1. Apresentação (slides)
2. Demo (ao vivo ou vídeo)
3. Repo público com README
4. Diagrama de arquitetura
5. **Decision Log** — alternativas consideradas e por que escolhemos o que escolhemos

> **Critério central:** a defesa técnica pesa tanto quanto a demo. Priorize decisões defensáveis sobre features vistosas.
