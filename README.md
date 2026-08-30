# Agentic Mandate

> **NextWave Hackathon 2026** (Yuno × Nauta) — Challenge 1, *"The Buyer Who Isn't Human"*.

A human authorises an AI agent to buy **within limits that can be verified**. A merchant checks the
mandate before accepting. Everything ugly — out of mandate, expired, revoked live, impostor agent,
disputed charge — has an exact place where it dies.

---

## The problem

Every payment system assumes a person is pressing "pay". That assumption is breaking: more and more
purchases are made by an agent acting for someone. When the buyer is an agent, four questions have no
answer.

- How does the store know this agent represents a real human who authorised this?
- How does the person authorise spending **without handing over the card**?
- What happens when the agent is wrong, hallucinates, or someone impersonates it?
- Who answers for the dispute afterwards?

Today the store has two bad options: block bots and lose the legitimate sale, or let it through as human
and eat the fraud. The missing piece — **the mandate** — is what this repository builds.

---

## The invariants

These are the claims the project stands on. Every one of them is enforced in code and covered by tests.

1. **Authorisation is enforced on the server, never in the agent.** The agent only *tries*; the Authority
   is what says no.
2. **The agent never creates or widens a mandate.** It drafts a proposal; the human confirms it on a
   dedicated screen. There is no "create mandate" tool.
3. **The agent has no write path** to mandate state or revocation. It reads an id; only the Authority writes.
4. **Identity is proved, not declared.** The `agentId` is derived from a **ticket the agent signed**
   (HMAC), verified by the Authority. The store relays that ticket untouched — it is transport, not source.
5. **Price and attributes are attested by the store**, from the real product, and must match what the
   agent signed.
6. **What was verified is what is charged.** Retries are idempotent; if the charge fails after the use is
   consumed, the Authority compensates it.
7. **The agent never sees the payment instrument.** The mandate holds an opaque `paymentMethodRef`; only
   the Authority resolves it and fires the payment.
8. **Revocation is a live question.** Validity is read at the instant of purchase, never baked into a
   static token — which is why revoking mid-demo actually works.
9. **No LLM on the transaction path.** AI drafts; the deterministic engine decides.

---

## Deterministic vs LLM

This is the design decision the whole project turns on.

| Stage | Who decides | Why |
|---|---|---|
| Understanding "running shoes, size 40, under R$100" | **LLM** | Interpreting loose language is what a model is good at |
| Deciding **what to ask** | **code**, then LLM | Code measures which attributes actually **vary** among the candidate products; the model may only ask about those. It asks your shoe size because size varies in the real catalogue |
| Creating the mandate | **human** | The mandate constrains the agent. Whoever is constrained cannot be the one who writes it |
| Choosing a product and attempting to buy | **LLM** | A suggestion, not an authority. A wrong pick is stopped by the next stage |
| **Deciding whether the purchase is allowed** | **deterministic** | Numbers and strings compared against the mandate's rules. Same input, same output, always |
| Watching a price for a month | **deterministic** | "Does it fit?" is the rule engine, not a conversation. No LLM in the watcher |
| Charging | **deterministic** | The Authority resolves the payment pointer and fires it |

**AI drafts, deterministic decides.** Assume the worst: the model hallucinates and tries to buy something
for R$500 under a R$100 mandate. It calls the tool, the store reports the real price, the engine compares,
the Authority refuses. The model does not write the verification's answer — that answer lives in a process
it does not control. Remove the model and the system gets dumb, not unsafe.

### What the agent actually is

Not "a model that goes shopping". Three parts, and none of them alone is the agent:

| Part | What it is | What it does |
|---|---|---|
| **Brain** | the LLM API | reasons, and picks which tool to call |
| **Hands** | tools **we** wrote | `search_catalog`, `get_product`, `list_wallet`, `propose_mandate`, `buy` |
| **Body** | our Node code | runs the loop: sends the conversation, receives a request, **actually executes it**, returns the result |

The model never touches the network. It returns text saying *"call `buy` with this"*; our code makes the call.

---

## Running it

```bash
npm install
npm test        # 134 tests. Spins up an in-memory Mongo — no Atlas needed
npm run dev     # Authority :3001 · stores :4001-4003 · UI :5173
```

Open **http://localhost:5173**.

With no `MONGODB_URI` the Authority boots on an in-memory Mongo and seeds the merchant allow-list and the
demo agent, so it runs with no setup. Set `MONGODB_URI` to use Atlas instead.

The agent's chat needs `OPENAI_API_KEY` in `.env`; without it that screen returns
`missing_openai_key` and everything else — mandates, verification, revocation, the audit trail — still works.

### Screens

**Agent** (the conversation) · **Pending proposals** (what the agent drafted, awaiting you) ·
**Purchase approvals** (one purchase at a time, waiting for your yes) · **My mandates** ·
**Wallet** (payment methods and addresses) · **Audit trail**.

### A two-minute demo

1. **Wallet** — add a card and an address. The raw instrument goes in and never comes back out: the
   screen lists labels, never numbers.
2. **Agent** — *"I want running shoes, size 40, up to R$100, only from Brazil."* It asks only about what
   varies among the real candidates, and asks how to pay and where to ship.
3. **Pending proposals** — read the mandate as a sentence, see what was **left unconstrained** and what
   the agent **assumed**, then authorise. Only now does the mandate exist.
4. **Agent** — ask it to buy. It compares both stores and buys the cheapest one that fits.
5. **Audit trail** — open the purchase and see the verdict **rule by rule**.
6. **The trial by fire** — **My mandates** → revoke. Point the agent at that mandate again and ask it to
   buy: the Authority refuses, live. The agent does **not** pre-check validity — it tries, and is told no.

Other things worth showing: a mandate in **approval mode** parks each purchase in *Purchase approvals*
(approving is single-use and bound to that exact purchase and price); the unregistered store on **:4003**
is refused because it is not on the allow-list; and a mandate with a **total** cap can buy two units,
while one without it buys exactly one.

---

## Layout

```
app1/src/authority/engine.js      # the constraint engine — a PURE function, no I/O
app1/src/authority/ticket.js      # the agent's signed ticket (HMAC)
app1/src/authority/introspect.js  # /introspect: the checks, in order
app1/src/authority/routes.js      # routes + auth (who you are never comes from the body)
app1/src/authority/dispute.js     # "I never authorised this" — resolved from the trail
app1/src/authority/vault.js       # mock vault/PSP (card and Pix)
app1/src/agent/llm.js             # the OpenAI loop and the tools
app1/src/agent/watcher.js         # price watch — deterministic, no LLM
app1/src/shared/messages.js       # i18n + the mandate rendered as a sentence
app2/src/                         # two stores + one unregistered, each with its own adapter
ui/src/                           # the Trusted Surface (React + Vite + Tailwind)
```

Stack: Node + Express + Mongoose + MongoDB, React + Vite + Tailwind, OpenAI for the agent,
`node --test` for the suite.

---

## Real vs mock

| Real — the logic being judged | Mock — not worth integrating for a hackathon |
|---|---|
| The mandate as the source of truth on the server | The movement of money (the vault returns a fake receipt) |
| Deterministic verification against **live** state | The two stores' catalogues and prices |
| Agent identity **proved** by signature | Tokenisation (the vault stores a pointer, not a real PSP token) |
| Price, attributes and quantity attested by the store | Delivery — the address is recorded but not sent to the store |
| The payment pointer living in the mandate, fired by the Authority | |
| The merchant allow-list, the append-only trail, dispute resolution | |

## Where Yuno fits

In the whole flow there is **one arrow** leaving this system for a payment service, and it leaves the
**Authority**, **after** the yes.

```
Agent + Stores + Authority          →          Yuno / PSP
decide IF it may be paid                       move the money, after the yes
```

That is the point of the topology: the **agent** does not have that arrow, and neither does the **store** —
it receives a receipt, it does not pull money. Swapping the mock for Yuno is swapping one endpoint URL:
the data model, the rule engine, revocation and the trail are all upstream of it.

---

## Documentation

Written in PT-BR, and the source of truth for every decision here.

| | |
|---|---|
| `docs/01-hackathon.md` | the challenge, deliverables, judging criteria |
| `docs/02-architecture.md` | roles, flow, trust model |
| `docs/03-data-model-and-api.md` | schemas and endpoint contracts |
| `docs/04-constraint-engine.md` | the engine, operators, `on_missing`/`on_fail`, the approval gate |
| `docs/05-security-and-ugly-cases.md` | each ugly case and attack, and where it dies |
| `docs/06-decision-log.md` | **the Decision Log** — D1–D19, alternatives and why |
| `docs/07-build-plan.md` | build order, real vs mock, demo script |
| `docs/08-scaling.md` | how the opaque-id model scales (not in the MVP) |
| `docs/09-agent.md` | brain + hands + body, the tools, the loop |
| `docs/11-fluxo-producao.md` | the end-to-end purchase and the single Yuno integration point |

## Deliverables

1. Slides
2. Demo (live or recorded)
3. Public repo with README ← this file
4. Architecture diagram ← `docs/02-architecture.md`
5. **Decision Log** ← `docs/06-decision-log.md`

> The technical defence weighs as much as the demo. Every choice here is meant to be defensible — which is
> why the decision log records the alternatives we rejected, and why.
