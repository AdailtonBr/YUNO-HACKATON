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

BROWSING
1. Call search_catalog with an EMPTY query to see everything. The store matches strings literally — it will not understand "tenis de corrida" or "running shoe". Mapping what they want onto what exists is your job.
2. Pick the products that ARE the thing they asked for, and call search_catalog AGAIN with their productIds. Only then do you get the attribute profile, and only over candidates you chose does "varies" mean anything. Be strict: a hand soap is not a toothpaste, a trail shoe is not a running shoe. Sweeping in near-misses makes attributes look like they vary when they do not.

THE FIVE QUESTIONS — ask every one before you propose
3. Any attribute the profile says VARIES among the candidates. Only those: if every candidate is the same brand, brand is not a question, and asking it shows you did not look.
4. Buy on my own, or ask me before each payment? Ask it every time, in these words or your own. It is the difference between an agent that spends while they sleep and one that waits — never assume it.
5. Which payment method? Call list_wallet first. Even with only one: "pago com o cartão •••• 4242?" is a question, not an assumption. None registered → tell them to add one on the Wallet screen.
6. Which delivery address — ONLY if the purchase ships. If they type an address at you instead of choosing one, it is NOT registered: tell them to add it on the Wallet screen and then say which. You cannot register it for them, and you must never invent an id. A toothpaste ships; a cinema ticket or a software licence does not. Resolve "o endereço cadastrado" to their single address if they have exactly one, ask which if several, add-one-first if none. If it does not ship, do not ask, and say why in deliveryNote.
7. How long should I keep looking? That is expiresAt — not "when the authorization expires" but "how long I hunt for this". "Nothing at that price today" is a normal answer: you keep watching until that date and buy the moment something fits.

Do not call propose_mandate until they have answered 4, 5, and 6-if-it-ships. Deciding those quietly is the one thing you must never do — it is their money, their door, and their choice about being asked.

PROPOSING AND BUYING
8. Call propose_mandate. Say in one short sentence what you drafted and that they must authorize it.
9. To pin one exact item — "this soap, not any soap" — constrain productId with op "eq". Never constrain by name: a name is a label, not an identifier, and it differs between stores. It is the tightest rule there is, and right when only one product matches. It is per store: a productId names one listing at one merchant, so the mandate buys there and nowhere else. Never ask them for a productId; you read it from the catalog.
10. Two different things with two different payment methods are TWO mandates. One mandate carries one payment method.
11. After they authorize (a mandateId appears in the conversation), call buy.

DRAFTING A PROPOSAL
- If you asked about an attribute that varies and they answered only some of them, ask once more about the ones they skipped before proposing. Silence is not "I do not care" — a mandate without a size rule lets you buy any size, which is looser than they think they authorized. If they say they do not care, proceed without that rule.
- "category" alone is almost never enough. It has five coarse values, so "eletronico up to R$150" happily buys a desk lamp when they asked for headphones. Constrain "product_type" instead — the stores attest it (headphones, keyboard, running_shoe, toothpaste, concert_ticket…) — whenever they named a kind of thing.
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
        "Browse the stores. Call it with an empty query to see everything, then call it AGAIN with productIds of the products that match what the human asked — only then do you get the attribute profile telling you what actually varies among those candidates.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "keyword. Empty string lists everything." },
          productIds: {
            type: "array",
            items: { type: "string" },
            description:
              "The candidates you picked. With these, the result is those products plus the attribute profile over exactly them.",
          },
        },
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
          // NÃO obrigatórios, de propósito.  Um enum obrigatório força o modelo
          // a chutar quando não sabe — e foi assim que "compra sozinho" passou a
          // ser escolhido calado.  Omitir é uma resposta honesta, e a omissão
          // cai no lado seguro: mesma lógica de whitelist+deny do resto do
          // sistema — esquecer bloqueia, não libera.
          mode: {
            type: "string",
            enum: ["autonomo", "aprovacao"],
            description:
              "Only after the human told you which. If they have not, OMIT this field — omitting means they get asked before each purchase, which is the safe side to err on. Never infer it from their tone.",
          },
          maxUses: { type: "integer", minimum: 1 },
          expiresAt: {
            type: "string",
            description:
              "ISO date — how long to keep looking. Only after they told you. If they have not, OMIT it and a short window is assumed.",
          },
          paymentMethodId: { type: "string", description: "from list_wallet — which method pays for this" },
          requiresDelivery: {
            type: "boolean",
            description:
              "Does this purchase need shipping? A toothpaste does; a cinema ticket or a software licence does not. Your judgement, from what they asked.",
          },
          shippingAddressId: { type: "string", description: "from list_wallet — required when requiresDelivery is true" },
          deliveryNote: { type: "string", description: "one short line explaining the delivery call, for the human to check" },
          rationale: { type: "string", description: "one line: why these rules, for the human to read" },
        },
        required: ["constraints", "rationale", "paymentMethodId", "requiresDelivery"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_wallet",
      description:
        "The human's registered payment methods and delivery addresses. You get labels and ids only — never a card number, never a street. Call it before proposing.",
      parameters: { type: "object", properties: {} },
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
  // Primeiro a forma comum: o mesmo parágrafo repetido.  A versão anterior só
  // olhava `X + X` colado e exigia comprimento par — com uma quebra de linha no
  // meio o total fica ímpar, e ela desistia antes de comparar.  Era por isso
  // que a duplicata em dois parágrafos passava direto.
  const blocks = [];
  for (const raw of String(text).split(/\n+/)) {
    const b = raw.trim();
    if (!b) continue;
    const prev = blocks[blocks.length - 1];
    if (prev === b && b.length >= 40) continue; // repetição exata e longa: descarta
    blocks.push(b);
  }
  const joined = blocks.join("\n\n");

  // E a forma colada, sem separador nenhum.
  if (joined.length >= 40 && joined.length % 2 === 0) {
    const half = joined.length / 2;
    if (joined.slice(0, half).trim() === joined.slice(half).trim()) return joined.slice(0, half).trim();
  }
  return joined;
}

/** A carteira como está AGORA — rótulos e ids, nunca o número nem a rua. */
async function currentWallet(deps) {
  const headers = { "x-human-id": deps.humanId };
  const get = (path) =>
    fetch(`${deps.authorityUrl}${path}`, { headers })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  const [payment_methods, addresses] = await Promise.all([
    get("/wallet/methods"),
    get("/wallet/addresses"),
  ]);
  return { payment_methods, addresses };
}

/**
 * O histórico guardado para o próximo turno.
 *
 * Sai o bloco volátil deste turno (senão eles se acumulariam, cada um afirmando
 * uma verdade de uma época diferente).  E os resultados antigos de
 * `list_wallet` são **esvaziados** em vez de removidos: apagá-los deixaria a
 * mensagem do assistente pedindo uma tool sem resposta, o que a API recusa no
 * turno seguinte.  Esvaziar mantém a estrutura válida e tira o dado velho de
 * circulação.
 */
function keptHistory(messages, head, volatile) {
  const walletCalls = new Set();
  for (const m of messages) {
    for (const c of m.tool_calls ?? []) {
      if (c.function?.name === "list_wallet") walletCalls.add(c.id);
    }
  }
  return messages.slice(head.length).flatMap((m) => {
    if (m === volatile) return [];
    if (m.role === "tool" && walletCalls.has(m.tool_call_id)) {
      return [{ ...m, content: JSON.stringify({ stale: true, note: "see the current wallet in the latest system message" }) }];
    }
    return [m];
  });
}

/**
 * A janela curta do histórico — cortada onde a API aceita.
 *
 * Cortar por contagem é ingênuo: o pedido de uma tool e a resposta dela são um
 * par, e o corte cego cai no meio dele.  Sobra um `tool` sem o assistente que o
 * pediu, e a OpenAI recusa o array INTEIRO — *"messages with role 'tool' must
 * be a response to a preceeding message with 'tool_calls'"*.  O estrago é pior
 * do que um turno perdido: o que quebrou é o histórico **guardado**, então toda
 * mensagem seguinte reenvia o mesmo array inválido e a conversa não volta mais.
 *
 * Então recuamos o corte até uma fronteira válida, largando os `tool` órfãos do
 * começo.  A janela fica um pouco menor que `size`; nunca fica inválida.
 */
export function windowHistory(history, size = 24) {
  let cut = Math.max(0, history.length - size);
  while (cut < history.length && history[cut].role === "tool") cut += 1;
  return history.slice(cut);
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

  /**
   * O contexto VOLÁTIL — o que é verdade agora, e que muda entre turnos.
   *
   * Ele fica **logo antes da mensagem nova**, não no topo.  A diferença não é
   * estética: no topo ele competia com o histórico, que vem depois e portanto
   * soa mais recente.  Um resultado de `list_wallet` de dois turnos atrás
   * dizendo "só um cartão" ganhava do aviso fresco lá em cima — foi exatamente
   * assim que o agente não viu o Pix recém-cadastrado.  O mesmo risco valia
   * para o mandato: "revogado" no topo perdendo para uma compra bem-sucedida
   * no meio do histórico.
   *
   * A regra, agora: o que é verdade agora é a última coisa que o modelo lê.
   */
  const wallet = await currentWallet(deps);

  const volatile = {
    role: "system",
    content: [
      `Today is ${new Date().toISOString().slice(0, 10)}. Any expiresAt you propose must be after today.`,
      mandate
        ? `The human has a mandate: mandateId=${mandate.mandateId}, rules=${JSON.stringify(mandate.constraints)}, ` +
          `mode=${mandate.mode}, purchases used=${mandate.usedCount}/${mandate.maxUses}. ` +
          `Do not try to judge whether it is still valid — it may have been revoked or expired since. ` +
          `Attempt the purchase and report whatever the Authority answers.`
        : "The human has no authorized mandate yet. You cannot buy; you can search and propose.",
      // A carteira vinha só como resultado de tool no histórico, e envelhecia
      // ali.  Agora é estado, entregue fresco a cada turno.
      `WALLET RIGHT NOW (this supersedes anything older in the conversation) — ` +
        `payment methods: ${JSON.stringify(wallet.payment_methods)}; addresses: ${JSON.stringify(wallet.addresses)}.`,
    ].join("\n\n"),
  };

  const head = [{ role: "system", content: SYSTEM }];
  const messages = [...head, ...history, volatile, { role: "user", content: message }];

  const events = [];
  let lastCatalog = [];   // tudo o que a loja expôs — âncora dos NOMES de atributo
  let lastCandidates = []; // o que o modelo escolheu — âncora do que VARIA

  // No máximo 6 voltas: o suficiente para buscar, propor e comprar, e curto o
  // bastante para um loop maluco não virar uma conta de API.
  for (let turn = 0; turn < 6; turn++) {
    const data = await callOpenAI(messages);
    const choice = data.choices?.[0]?.message;
    if (!choice) break;
    messages.push(choice);

    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      return { text: dedupe(choice.content ?? ""), events, history: keptHistory(messages, head, volatile) };
    }

    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      const result = await runTool(call.function.name, args, { deps, mandate, lastCatalog, lastCandidates, events });
      if (call.function.name === "search_catalog") {
        lastCatalog = result.__items ?? lastCatalog;
        if (result.__candidates) lastCandidates = result.__candidates;
      }
      delete result.__items;
      delete result.__candidates;
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { text: "", events, history: keptHistory(messages, head, volatile) };
}

/** Aceita o id (`store_a`) ou o nome exibido (`Store A`), sem caixa. */
const findStore = (stores, ref) => {
  const want = String(ref ?? "").toLowerCase().replace(/\s+/g, "_");
  return stores.find((st) => st.id.toLowerCase() === want);
};

async function runTool(name, args, { deps, mandate, lastCatalog, lastCandidates, events }) {
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

    const picked = (args.productIds ?? []).filter(Boolean);
    if (picked.length) {
      const wanted = new Set(picked);
      const candidates = items.filter((i) => wanted.has(i.productId));
      return {
        __items: items,
        __candidates: candidates,
        count: candidates.length,
        items: candidates.map(({ storeUrl, ...i }) => withDisplay(i)),
        // O perfil é sobre EXATAMENTE os candidatos escolhidos.
        attribute_profile: attributeProfile(candidates),
      };
    }

    // Sem candidatos escolhidos, NÃO mandamos perfil.
    //
    // Um perfil sobre o catálogo inteiro diz que marca, tamanho e cor "variam"
    // — sempre, trivialmente, porque tênis e pasta de dente diferem em tudo.
    // Foi assim que o agente anunciou "duas marcas, Sorriso e Sorriso": ele foi
    // informado de que `brand` variava e obedeceu.  Omitir é o que garante;
    // deixar disponível é convidar o modelo a papagaiar um número sem sentido.
    return {
      __items: items,
      count: items.length,
      note:
        (fellBack ? `Nothing matched "${args.query}" literally, so this is the whole catalog. ` : "") +
        "No attribute profile yet: pick the products that match what the human asked and call search_catalog again with their productIds. Only over those candidates does \"varies\" mean anything.",
      items: items.map(({ storeUrl, ...i }) => withDisplay(i)),
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

  if (name === "list_wallet") {
    const [methods, addresses] = await Promise.all([
      fetch(`${deps.authorityUrl}/wallet/methods`, { headers: { "x-human-id": deps.humanId } }).then((r) => r.json()),
      fetch(`${deps.authorityUrl}/wallet/addresses`, { headers: { "x-human-id": deps.humanId } }).then((r) => r.json()),
    ]);
    // Rótulos e ids.  Nada aqui reconstrói um cartão nem uma rua.
    return { payment_methods: methods, addresses };
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
    // Nem todo atributo que serve de REGRA é atributo que valha PERGUNTAR.
    //
    // `productId` fica fora do perfil (todo item tem o seu, então "varia"
    // sempre e trivialmente — perguntar seria absurdo), mas é regra legítima e
    // a mais apertada de todas: "compre exatamente este item".  `price` idem,
    // por outro motivo: ele é sempre comparável, mesmo quando não varia.
    const ALWAYS_CONSTRAINABLE = ["price", "productId"];
    const known = new Set([...Object.keys(attributeProfile(universe)), ...ALWAYS_CONSTRAINABLE]);
    const unknown = (args.constraints ?? []).map((c) => c.attr).filter((a) => !known.has(a));
    if (unknown.length) {
      // A dica importa tanto quanto a recusa: sem ela o modelo tenta `name`,
      // depois `product`, depois pergunta ao humano uma coisa que ele não tem
      // como responder.  `name` é rótulo, não regra — o identificador é o id.
      return {
        ok: false,
        error: "unknown_attributes",
        unknown,
        known: [...known],
        hint: unknown.includes("name")
          ? "To pin one exact item use productId (read it from the catalog), never name — a name is a label, not an identifier, and it differs between stores."
          : "Use only the attribute names above, or productId to pin one exact item.",
      };
    }

    // Sem meio de pagamento não há proposta: pagar com o quê é decisão do
    // humano, e ele já cadastrou as opções.  Escolher por ele seria o agente
    // decidindo algo que não é dele.
    if (!args.paymentMethodId) {
      return { ok: false, error: "missing_payment_method", hint: "call list_wallet and ask the human which one" };
    }

    if (args.requiresDelivery && !args.shippingAddressId) {
      return { ok: false, error: "missing_address", hint: "call list_wallet and ask the human which address" };
    }

    // Os ids TÊM que existir na carteira.  Sem isto o modelo inventa — chegou a
    // mandar `addressId: "new"` quando o humano ditou um endereço no chat em vez
    // de cadastrá-lo — e a proposta nascia impossível de autorizar: a Autoridade
    // recusa o id inventado, e o humano fica clicando em Authorize sem entender.
    // Mesma classe do nome de atributo inventado: identificador não se inventa,
    // se lê de onde ele existe.
    const wallet = await currentWallet(deps);
    if (!wallet.payment_methods.some((m) => m.methodId === args.paymentMethodId)) {
      return {
        ok: false,
        error: "unknown_payment_method",
        known: wallet.payment_methods.map((m) => ({ methodId: m.methodId, label: m.label })),
        hint: "Use a methodId from list_wallet. If they have none, they must add one on the Wallet screen — you cannot create it for them.",
      };
    }
    if (args.requiresDelivery && !wallet.addresses.some((a) => a.addressId === args.shippingAddressId)) {
      return {
        ok: false,
        error: "unknown_address",
        known: wallet.addresses.map((a) => ({ addressId: a.addressId, label: a.label })),
        hint: "Use an addressId from list_wallet. An address typed in the chat is NOT registered — ask them to add it on the Wallet screen, then ask which one. Never invent an id.",
      };
    }

    // O que não foi perguntado cai no lado seguro, e isso vai visível na
    // proposta: o humano vê "te pergunta antes de cada compra" e a janela
    // curta, e sabe que ninguém decidiu isso por ele.
    const SHORT_WINDOW_DAYS = 7;
    const assumed = [];
    if (!args.mode) assumed.push("mode");
    if (!args.expiresAt) assumed.push("expiresAt");

    const draft = {
      mode: args.mode ?? "aprovacao",
      currency: "BRL",
      maxUses: args.maxUses ?? 1,
      expiresAt: new Date(
        args.expiresAt ?? Date.now() + SHORT_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      paymentMethodId: args.paymentMethodId,
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
    // Sobre os CANDIDATOS, não sobre o catálogo: num mandato de pasta de dente,
    // "size — no catálogo: 40, 42" seria ruído sobre um atributo que nem existe
    // para o produto em questão.
    const profile = attributeProfile(lastCandidates.length ? lastCandidates : universe);
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
      body: JSON.stringify({
        draft,
        rationale: args.rationale,
        unconstrained,
        // O que o humano NÃO respondeu, dito na cara — para ele pegar.
        assumed,
        delivery: {
          required: !!args.requiresDelivery,
          addressId: args.requiresDelivery ? args.shippingAddressId ?? null : null,
          note: args.deliveryNote ?? null,
        },
      }),
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
