/**
 * O vigia de preço.
 *
 * O mandato já é a instrução "procure isto e compre": `expiresAt` é a janela de
 * busca, `maxUses` é quantas vezes, e esgotar encerra sozinho.  Faltava alguém
 * de fato olhando — sem isto, "compre se cair abaixo de R$150 até o fim do mês"
 * autoriza mas não vigia, e o preço que cai às 3h da manhã passa em branco.
 *
 * **Sem LLM, e isso não é economia — é arquitetura.**  Decidir "cabe no
 * mandato?" é o motor de constraints; o modelo só era necessário para
 * *rascunhar* o mandato.  Se o vigia rodasse o loop do agente por mandato por
 * tique, seriam centenas de milhares de chamadas por dia; do jeito certo, é
 * zero.  É a separação "IA rascunha, determinístico decide" se pagando.
 *
 * **Sem privilégio novo.**  O vigia é mais um cliente do mesmo caminho
 * `/buy` → `/introspect`.  Ele não alarga mandato, não escreve estado, e a
 * revogação o mata na tentativa seguinte.  Autonomia não adiciona autoridade.
 */

import { searchCatalogs, compare, attemptPurchase } from "./agent.js";
import { Mandate } from "../authority/models.js";
import { mandateStatus } from "../authority/engine.js";

/**
 * Chave derivada, nunca aleatória.
 *
 * Estável dentro de uma mesma oportunidade — se um tique repetir, ou se a
 * resposta se perder na rede, a idempotência da Autoridade reconhece e não
 * cobra de novo.  E muda quando `usedCount` avança, para um mandato de três
 * usos conseguir de fato os três.
 */
export const watchKey = (mandate, item) =>
  `watch:${mandate._id}:${mandate.usedCount}:${item.merchantId}:${item.productId}:${item.price}`;

/**
 * Um tique, como função pura o quanto dá: recebe os mandatos e o retrato do
 * catálogo, devolve o que deve ser tentado.  Quem faz I/O é `runTick`.
 *
 * O catálogo é UM retrato compartilhado por todos os mandatos — buscar por
 * mandato seria O(mandatos × lojas) de rede à toa.
 */
export function planTick({ mandates, items, now = new Date(), maxPurchases = 5 }) {
  const attempts = [];
  for (const mandate of mandates) {
    if (attempts.length >= maxPurchases) break;

    // Revogado, expirado e esgotado saem sozinhos: `active` já significa
    // "vale agora e ainda tem uso".
    if (mandateStatus(mandate, now) !== "active") continue;

    // O mesmo filtro que o agente usa na conversa.  Continua sendo heurística
    // de COMPRAS, não autorização: quem diz não é a Autoridade, adiante.
    const { chosen } = compare(items, mandate, "best");
    if (!chosen) continue;

    attempts.push({ mandate, item: chosen, idempotencyKey: watchKey(mandate, chosen) });
  }
  return attempts;
}

/**
 * @param deps { stores, agentId, agentSecret, maxPurchases }
 * @returns   o que foi tentado e como a Autoridade respondeu
 */
export async function runTick(deps) {
  const mandates = await Mandate.find({ revoked: false }).lean();
  if (mandates.length === 0) return [];

  const items = await searchCatalogs(deps.stores, "");
  if (items.length === 0) return [];

  const planned = planTick({
    mandates,
    items,
    maxPurchases: deps.maxPurchases ?? 5,
  });

  const done = [];
  for (const { mandate, item, idempotencyKey } of planned) {
    const result = await attemptPurchase({
      mandateId: mandate._id,
      item,
      agentId: deps.agentId,
      agentSecret: deps.agentSecret,
      idempotencyKey,
    });
    done.push({ mandateId: mandate._id, item, result });
  }
  return done;
}

/**
 * O laço.  Um tique por vez — sem sobreposição, porque dois tiques correndo
 * juntos tentariam a mesma oportunidade duas vezes.  (Com várias instâncias da
 * Autoridade seria preciso uma trava no Mongo; fora do escopo do MVP, e o
 * consumo atômico ainda impediria a compra dupla, só desperdiçaria chamadas.)
 */
export function startWatcher(deps) {
  const interval = Number(process.env.WATCHER_INTERVAL_MS ?? 5000);
  const maxPurchases = Number(process.env.WATCHER_MAX_PURCHASES_PER_TICK ?? 5);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const done = await runTick({ ...deps, maxPurchases });
      for (const d of done) {
        const ok = d.result?.ok;
        console.log(
          `[watcher] ${d.mandateId.slice(0, 12)} → ${d.item.merchantId}/${d.item.productId} ` +
            `${(d.item.price / 100).toFixed(2)} · ${ok ? "bought" : d.result?.action ?? "refused"}` +
            `${ok ? "" : ` (${d.result?.reasonText ?? ""})`}`
        );
      }
    } catch (e) {
      console.warn("[watcher] tick failed:", e.message);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  handle.unref?.(); // não segura o processo de pé sozinho
  console.log(
    `  watcher: every ${interval}ms, at most ${maxPurchases} purchases per tick` +
      "  (demo pacing — production would be minutes, or driven by store webhooks)"
  );
  return () => clearInterval(handle);
}
