# Mandato Agêntico — Compra segura feita por IA

> Projeto para o **NextWave Hackathon 2026** (Yuno × Nauta), desafio **Challenge 1 — "The Buyer Who Isn't Human"**.
> Um circuito completo de compra agêntica segura: um humano autoriza um agente a comprar dentro de limites verificáveis, um merchant verifica o mandato antes de aceitar, e todo o resto (fora do mandato, expirado, revogado ao vivo, agente impostor, disputa) é tratado explicitamente.

Este repositório contém **documentação de contexto e decisão** para orientar a implementação. Leia os arquivos em `docs/` na ordem antes de escrever código.

---

## Para o Claude Code: como usar esta documentação

Estes `.md` são a fonte da verdade do projeto. Antes de implementar qualquer parte:

1. Leia `docs/01-hackathon.md` para entender **o que os juízes avaliam**.
2. Leia `docs/02-architecture.md` para entender **os papéis e o fluxo** (quem chama quem, e por quê).
3. Consulte `docs/03-data-model-and-api.md` para os **schemas e contratos de endpoint** exatos.
4. Consulte `docs/04-constraint-engine.md` ao implementar o **motor de verificação** (é o coração do projeto).
5. Consulte `docs/05-security-and-ugly-cases.md` ao implementar **qualquer verificação** — cada caso feio e cada ataque tem um ponto exato onde é barrado.
6. Use `docs/06-decision-log.md` para produzir o **Decision Log** (deliverable obrigatório) e para não contradizer decisões já tomadas.
7. Siga `docs/07-build-plan.md` para a **ordem de implementação** e o roteiro da demo.
8. Consulte `docs/08-scaling.md` para o **caminho de escala** do modelo de id opaco — nada ali entra no MVP; serve para defender a escolha quando perguntarem "e em escala?".

**Princípio que atravessa tudo:** a autorização é imposta no servidor (na Autoridade), nunca no agente. O agente rascunha e executa; ele nunca decide se uma compra é válida. Identidade e valores nunca são auto-declarados — só vale o que foi autenticado ou atestado pela parte de direito.

---

## Escopo em uma frase

Duas aplicações deployáveis:

- **App 1 — Serviço agêntico + Autoridade de Mandato.** Contém (a) a UI onde o humano cria/revoga mandatos em linguagem natural (a *Trusted Surface*), (b) o Agente que conversa, busca, compara e compra, e (c) a Autoridade que guarda o estado, verifica constraints e dispara pagamento. Agente e Autoridade são **papéis separados** que compartilham o deploy — o Agente só lê; a Autoridade é a única a escrever o estado.
- **App 2 — Lojas falsas (2).** Catálogos com interseção (produtos só na A, só na B, e compartilhados) para avaliar o julgamento do Agente ao comparar concorrência. Cada loja se autentica na Autoridade e descreve os próprios produtos num vocabulário comum.

Pagamento (cartão **e** Pix) é **mockado** — a *lógica* de que o instrumento vem do mandato e é acionado pela Autoridade é real; a movimentação de dinheiro é simulada.

---

## Estado atual e como rodar

**Fase 1 pronta:** Autoridade + motor de constraints + bilhete assinado do agente + cofre mock, com 57 testes.
Fases 2–6 (Trusted Surface, lojas, agente via Claude API, bonus) seguem `docs/07-build-plan.md`.

```bash
npm install
npm test                      # 57 testes; sobe um Mongo em memoria, nao precisa de Atlas

cp .env.example .env          # ajuste MONGODB_URI se for usar Atlas
npm run seed  --workspace app1   # allow-list de merchants + agente da demo
npm run dev   --workspace app1   # Autoridade em :3001
```

Estrutura:

```
app1/src/authority/engine.js      # motor de constraints — FUNCAO PURA, sem I/O
app1/src/authority/ticket.js      # bilhete assinado do agente (HMAC)
app1/src/authority/introspect.js  # /introspect: as amarras em ordem
app1/src/authority/routes.js      # rotas + autenticacao (quem voce e nunca vem do corpo)
app1/src/authority/vault.js       # cofre/PSP MOCK (cartao e Pix)
app1/src/shared/messages.js       # dicionario i18n + mandato em linguagem natural
app1/test/                        # motor, bilhete e integracao
```

## Stack recomendada

- **Backend:** Node.js + Express
- **Banco:** MongoDB (Atlas) + Mongoose
- **Frontend (App 1):** React + Tailwind + Vite
- **Agente:** orquestração via Claude API (o modelo conversa, busca no catálogo e decide dentro do mandato)
- **Lojas:** Node/Express simples, cada uma com seu catálogo e adaptador de vocabulário

Ajuste se necessário; a arquitetura não depende dessas escolhas.

---

## Deliverables do hackathon (o que este repo precisa produzir)

1. Apresentação (slides)
2. Demo (ao vivo ou vídeo)
3. Repo público com README ← este arquivo
4. Diagrama de arquitetura ← ver `docs/02-architecture.md`
5. **Decision Log** — alternativas consideradas e por que escolhemos ← ver `docs/06-decision-log.md`

> A defesa técnica pesa **tanto quanto** a demo. Uma demo espetacular que o time não sabe explicar perde para uma demo modesta defendida com julgamento. Todo este conjunto de docs existe para garantir que cada escolha seja defensável.
