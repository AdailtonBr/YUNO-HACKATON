/**
 * A conversa do agente (Fase 5) — orquestração via OpenAI.
 *
 * O que o LLM PODE fazer aqui: conversar, buscar no catálogo, decidir o que
 * perguntar, e **rascunhar** uma proposta de mandato.
 *
 * O que ele NÃO pode, por construção e não por instrução no prompt:
 *  - criar ou alargar mandato → `propose_mandate` grava em `mandate_proposals`,
 *    que não autoriza nada; só a confirmação do humano cria o mandato;
 *  - decidir se uma compra é válida → `buy` devolve o veredito da Autoridade
 *    literalmente, e o modelo não tem como reescrevê-lo;
 *  - inventar nomes de atributo → validamos cada `attr` contra os nomes que
 *    realmente apareceram no catálogo, e recusamos o resto (invariante 8).
 *
 * "IA rascunha, determinístico decide": o modelo nunca entra no caminho crítico
 * do dinheiro.  Se a OpenAI estiver fora do ar, some a conversa — não a
 * segurança.
 */

import { searchCatalogs, compare, attemptPurchase } from "./agent.js";

const API = "https://api.openai.com/v1/chat/completions";

const model = () => process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

/**
 * `price` é e continua sendo centavos — é assim que as constraints comparam.
 * Mas o modelo estava repassando "9250" para o humano, que não fala em centavos.
 * Em vez de pedir a conversão no prompt (e torcer), a tool entrega as duas
 * formas: a de máquina e a de gente.
 */
const display = (cents, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);

const withDisplay = (item) => ({ ...item, price_display: display(item.price, item.currency) });
const apiKey = () => process.env.OPENAI_API_KEY;

/**
 * Quais atributos EXISTEM e quais VARIAM entre os candidatos.
 *
 * Isto é calculado em código, não deixado para o modelo, e é o que sustenta a
 * frase de defesa: *"o agente pergunta sobre um atributo porque ele varia no
 * catálogo real, não porque um modelo achou que devia"*.  Ancorado em dado.
 */
export function attributeProfile(items) {
  const IGNORE = new Set(["productId", "name", "merchantId", "merchantName", "storeUrl", "currency"]);
  const values = {};
  for (const item of items) {
    for (const [k, v] of Object.entries(item)) {
      if (IGNORE.has(k) || v === undefined) continue;
      (values[k] ??= new Set()).add(String(v));
    }
  }
  const profile = {};
  for (const [k, set] of Object.entries(values)) {
    profile[k] = {
      present_in: items.filter((i) => i[k] !== undefined).length,
      distinct_values: [...set].slice(0, 12),
      varies: set.size > 1,
    };
  }
  return profile;
}

const SYSTEM = `You are a purchasing agent acting for a human. You speak their language (mirror whatever language they write in).

WHAT YOU DO
1. When they ask for something, call search_catalog FIRST, with an EMPTY query. The catalogs are small, so listing everything is cheap, and the store matches strings literally — it will not understand "tenis de corrida" or "running shoe". You are the one who maps what they want onto what is actually there. Only use a keyword to narrow down afterwards.
2. Look at the attribute profile the tool returns. For any attribute where "varies" is true among the candidates, that difference is a decision only the human can make — ask them about it. Do not ask about attributes that do not vary; that wastes their time.
3. Ask whether they want you to buy on your own within the limits, or to ask them before each payment. Never assume.
4. Once you know enough, call propose_mandate. Explain in one short sentence what you drafted and that they must authorize it.
5. After they authorize it (a mandateId will appear in the conversation), call buy to attempt the purchase.

DRAFTING A PROPOSAL
- If you asked about an attribute that varies and they answered only some of them, ask once more about the ones they skipped before proposing. Silence is not "I do not care" — a mandate without a size rule lets you buy any size, which is looser than they think they authorized. If they say they do not care, proceed without that rule.
- Every limit the human stated must appear as a constraint. They said size 40 -> {attr:"size", op:"eq", value:"40"}. They said only from Brazil -> {attr:"ship_country", op:"eq", value:"BR"}. They said up to 100 reais -> {attr:"price", op:"lte", value:10000}. Dropping one silently would hand them a mandate looser than what they asked for.
- maxUses is 1 unless they explicitly asked for more than one purchase.
- Use on_missing:"deny" and on_fail:"deny" unless they said they want to be asked.

HARD RULES
- You never create or widen a mandate. propose_mandate only drafts; the human authorizes it on a separate screen. If they ask you to raise a limit, tell them they must authorize a new proposal.
- You never decide whether a purchase is allowed. The Authority decides. Report its answer as given, including refusals. Never claim a purchase succeeded unless the tool said so.
- Constraint attribute names must come from the catalog you actually saw. Do not invent names.
- price is in cents, because that is what the rules compare. NEVER show cents to the human — always use the price_display field the tools give you ("R$ 98,00"), never "9800" or "9800 centavos".
- Be brief. Two or three sentences. No bullet lists unless comparing options.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        "Search the registered stores. Returns matching products in the common vocabulary plus an attribute profile saying which attributes exist and which VARY across the candidates.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "keyword, e.g. 'runner' or 'shoe'. Empty string lists everything." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description:
        "Fetch one product exactly as the store attests it right now, in the common vocabulary. Use before buying to confirm the price has not moved.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string" },
          merchantId: { type: "string" },
        },
        required: ["productId", "merchantId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_mandate",
      description:
        "Draft a mandate for the human to authorize. This does NOT create it and does NOT authorize any spending.",
      parameters: {
        type: "object",
        properties: {
          constraints: {
            type: "array",
            description: "Rules the Authority will enforce. Attribute names must come from the catalog.",
            items: {
              type: "object",
              properties: {
                attr: { type: "string" },
                op: { type: "string", enum: ["eq", "ne", "lte", "gte", "in"] },
                value: {},
                on_missing: { type: "string", enum: ["deny", "escalate", "allow"] },
                on_fail: { type: "string", enum: ["deny", "escalate"] },
              },
              required: ["attr", "op", "value"],
            },
          },
          mode: { type: "string", enum: ["autonomo", "aprovacao"] },
          maxUses: { type: "integer", minimum: 1 },
          expiresAt: { type: "string", description: "ISO date, e.g. 2026-09-30" },
          rail: { type: "string", enum: ["card", "pix"] },
          rationale: { type: "string", description: "one line: why these rules, for the human to read" },
        },
        required: ["constraints", "mode", "maxUses", "expiresAt", "rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buy",
      description: "Attempt a purchase under an authorized mandate. Returns the Authority's verdict verbatim.",
      parameters: {
        type: "object",
        properties: {
          mandateId: { type: "string" },
          productId: { type: "string" },
          merchantId: { type: "string" },
        },
        required: ["mandateId", "productId", "merchantId"],
      },
    },
  },
];

/**
 * Guarda contra um tique observado em alguns modelos: com `tools` no pedido,
 * eles às vezes emitem a resposta inteira DUAS vezes na mesma string.  Medimos
 * isso (gpt-5.4-mini duplica; gpt-4.1-mini não), então o default é o que se
 * comporta — mas a guarda fica, para trocar de modelo não trazer o bug de volta.
 * Colapsa só a repetição exata; texto legítimo não é tocado.
 */
function dedupe(text) {
  const t = text.trim();
  if (t.length < 40 || t.length % 2 !== 0) return text;
  const half = t.length / 2;
  return t.slice(0, half).trim() === t.slice(half).trim() ? t.slice(0, half).trim() : text;
}

async function callOpenAI(messages) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ model: model(), messages, tools: TOOLS }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`openai_${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Um turno: recebe o histórico + a mensagem nova, roda o loop de ferramentas e
 * devolve o texto do agente mais o que aconteceu de concreto.
 *
 * @param deps  { stores, agentId, agentSecret, authorityUrl, humanId }
 */
export async function runTurn({ history, message, mandate, deps }) {
  if (!apiKey()) throw new Error("missing_openai_key");

  const messages = [
    { role: "system", content: SYSTEM },
    // Sem isto o modelo chuta a data e propõe um mandato que já nasce expirado.
    {
      role: "system",
      content: `Today is ${new Date().toISOString().slice(0, 10)}. Any expiresAt you propose must be after today.`,
    },
    ...(mandate
      ? [{
          role: "system",
          content:
            `The human has a mandate: mandateId=${mandate.mandateId}, rules=${JSON.stringify(mandate.constraints)}, ` +
            `mode=${mandate.mode}, purchases used=${mandate.usedCount}/${mandate.maxUses}. ` +
            `Do not try to judge whether it is still valid — it may have been revoked or expired since. ` +
            `Attempt the purchase and report whatever the Authority answers.`,
        }]
      : [{ role: "system", content: "The human has no authorized mandate yet. You cannot buy; you can search and propose." }]),
    ...history,
    { role: "user", content: message },
  ];

  const events = [];
  let lastCatalog = [];

  // No máximo 6 voltas: o suficiente para buscar, propor e comprar, e curto o
  // bastante para um loop maluco não virar uma conta de API.
  for (let turn = 0; turn < 6; turn++) {
    const data = await callOpenAI(messages);
    const choice = data.choices?.[0]?.message;
    if (!choice) break;
    messages.push(choice);

    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      return { text: dedupe(choice.content ?? ""), events, history: messages.slice(3) };
    }

    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      const result = await runTool(call.function.name, args, { deps, mandate, lastCatalog, events });
      if (call.function.name === "search_catalog") lastCatalog = result.__items ?? [];
      delete result.__items;
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { text: "", events, history: messages.slice(3) };
}

/** Aceita o id (`store_a`) ou o nome exibido (`Store A`), sem caixa. */
const findStore = (stores, ref) => {
  const want = String(ref ?? "").toLowerCase().replace(/\s+/g, "_");
  return stores.find((st) => st.id.toLowerCase() === want);
};

async function runTool(name, args, { deps, mandate, lastCatalog, events }) {
  if (name === "search_catalog") {
    let items = await searchCatalogs(deps.stores, args.query ?? "");

    // A loja casa strings; ela não entende "tênis de corrida".  Em vez de torcer
    // para o modelo lembrar de buscar sem termo, garantimos aqui: busca vazia
    // devolve o catálogo inteiro, e o casamento semântico fica com o modelo.
    // Instrução em prompt é sugestão; isto é garantia.
    let fellBack = false;
    if (items.length === 0 && (args.query ?? "").trim()) {
      items = await searchCatalogs(deps.stores, "");
      fellBack = true;
    }

    return {
      __items: items,
      count: items.length,
      note: fellBack
        ? `No product matched "${args.query}" literally. Returning the full catalog — match it to what the human asked yourself.`
        : undefined,
      items: items.map(({ storeUrl, ...i }) => withDisplay(i)),
      attribute_profile: attributeProfile(items),
    };
  }

  if (name === "get_product") {
    // Buscamos de novo na loja em vez de reusar o catálogo em memória: o preço
    // pode ter mudado, e é o valor ATESTADO agora que vai para o bilhete.
    const store = findStore(deps.stores, args.merchantId);
    if (!store) {
      return { ok: false, error: "unknown_merchant", known: deps.stores.map((st) => st.id) };
    }
    const items = await searchCatalogs([store], "");
    const item = items.find((i) => i.productId === args.productId);
    if (!item) return { ok: false, error: "unknown_product" };
    const { storeUrl, ...clean } = item;
    return { ok: true, product: withDisplay(clean) };
  }

  if (name === "propose_mandate") {
    // Invariante 8, IMPOSTA e não pedida: os nomes de atributo têm que existir
    // no catálogo real.  Um `attr` inventado é recusado aqui, antes de virar
    // proposta — senão o mandato guardaria uma regra que nunca casa com nada.
    //
    // Buscamos o catálogo INTEIRO agora, em vez de reusar o que o modelo pediu
    // neste turno: a verdade é o que as lojas expõem, não o que ele lembrou de
    // consultar.  (Foi exatamente esse o bug: numa conversa de dois turnos, ele
    // propunha sem rebuscar e `size`/`ship_country` eram recusados como falsos
    // desconhecidos.)
    const universe = lastCatalog.length ? lastCatalog : await searchCatalogs(deps.stores, "");
    const known = new Set(Object.keys(attributeProfile(universe)));
    const unknown = (args.constraints ?? []).map((c) => c.attr).filter((a) => a !== "price" && !known.has(a));
    if (unknown.length) {
      return { ok: false, error: "unknown_attributes", unknown, known: [...known] };
    }

    const draft = {
      mode: args.mode,
      currency: "BRL",
      maxUses: args.maxUses,
      expiresAt: new Date(args.expiresAt).toISOString(),
      rail: args.rail ?? "card",
      constraints: (args.constraints ?? []).map((c) => ({
        ...c,
        on_missing: c.on_missing ?? "deny",
        on_fail: c.on_fail ?? "deny",
      })),
    };

    // O que VARIA no catálogo e ficou sem regra.  Calculado aqui, em código, a
    // partir do catálogo real — não é opinião do modelo.
    //
    // Existe porque o silêncio do humano não é "tanto faz": se `size` varia
    // entre 40 e 42 e ele não respondeu, um mandato sem regra de tamanho
    // autoriza qualquer tamanho.  O modelo deveria perguntar de novo, mas
    // "deveria" é prompt.  Isto é o que garante que, se ele não perguntar, a
    // Trusted Surface mostra ao humano o que NÃO está limitado antes do sim.
    const profile = attributeProfile(universe);
    const covered = new Set(draft.constraints.map((c) => c.attr));
    const unconstrained = Object.entries(profile)
      .filter(([attr, p]) => p.varies && !covered.has(attr))
      .map(([attr, p]) => ({ attr, values: p.distinct_values }));

    // O agente DEPOSITA. Ele autentica como agente, e esta rota não cria mandato.
    const res = await fetch(`${deps.authorityUrl}/proposals`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-id": deps.agentId,
        "x-agent-secret": deps.agentSecret,
      },
      body: JSON.stringify({ draft, rationale: args.rationale, unconstrained }),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error ?? "proposal_failed" };

    events.push({ type: "proposal", proposalId: body.proposalId, draft, rationale: args.rationale, unconstrained });
    return {
      ok: true,
      proposalId: body.proposalId,
      unconstrained_shown_to_human: unconstrained.map((u) => u.attr),
      note: "Drafted. The human must authorize it before you can buy. Anything you left unconstrained is shown to them explicitly.",
    };
  }

  if (name === "buy") {
    if (!mandate) return { ok: false, error: "no_authorized_mandate" };
    // O catálogo é rebuscado se o modelo não pesquisou neste turno: exigir a
    // ordem certa das chamadas é rigor que não protege nada — o que protege é a
    // Autoridade, adiante.
    const universe = lastCatalog.length ? lastCatalog : await searchCatalogs(deps.stores, "");
    const wanted = String(args.merchantId ?? "").toLowerCase();
    const item = universe.find(
      (i) =>
        i.productId === args.productId &&
        (i.merchantId.toLowerCase() === wanted || i.merchantName.toLowerCase() === wanted)
    );
    if (!item) {
      return {
        ok: false,
        error: "unknown_product",
        available: universe.map((i) => ({ productId: i.productId, merchantId: i.merchantId })),
      };
    }

    const result = await attemptPurchase({
      mandateId: args.mandateId ?? mandate.mandateId,
      item,
      agentId: deps.agentId,
      agentSecret: deps.agentSecret,
    });
    events.push({ type: "purchase", item, result });
    // Devolvido literalmente: o modelo relata, não reinterpreta.
    return result;
  }

  return { ok: false, error: "unknown_tool" };
}
