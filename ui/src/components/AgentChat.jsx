/**
 * Conversa com o agente.
 *
 * Cada tentativa do agente vira um cartão de proposta com o veredito da
 * AUTORIDADE estampado — permitido, negado ou aguardando você.  O agente
 * escreve o texto; ele não escreve o selo.  Essa separação é o produto inteiro
 * em uma tela: o que ele diz é conversa, o que está no selo é decisão.
 *
 * Nota honesta: nesta fase o agente é determinístico (busca, compara, tenta).
 * A conversa em linguagem natural via LLM é a Fase 5 do plano de build; o
 * circuito de autorização abaixo já é o definitivo.
 */

import { useEffect, useRef, useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, Select, Metric } from "./ui.jsx";
import DecisionPanel from "./DecisionPanel.jsx";

const outcomeOf = (result) =>
  !result ? "none" : result.ok ? "valid" : result.action === "escalate" ? "escalate" : "reject";

const OUTCOME_CHIP = {
  valid: { tone: "allow", key: "outcome.allowed" },
  escalate: { tone: "wait", key: "outcome.waiting" },
  reject: { tone: "deny", key: "outcome.denied" },
};

function ProposalCard({ locale, entry }) {
  const T = (k) => t(locale, k);
  const [open, setOpen] = useState(false);
  const { chosen, result } = entry;
  const outcome = outcomeOf(result);
  const chip = OUTCOME_CHIP[outcome];

  return (
    <Panel tone={chip.tone} className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <Label>
            {T("chat.proposal")} · {chosen.merchantName}
          </Label>
          <p className="mt-0.5 font-sans text-[15px] font-semibold text-stone-900">{chosen.name}</p>
        </div>
        <Chip tone={chip.tone} dot>
          {T(chip.key)}
        </Chip>
      </header>

      <div className="grid grid-cols-2 divide-x divide-stone-200/70 border-y border-stone-200/70 bg-white/70 sm:grid-cols-3">
        <Metric label={T("chat.unitPrice")} value={money(chosen.price, chosen.currency, locale)} />
        <Metric label={T("chat.attributes")} value={chosen.size ? `size ${chosen.size}` : chosen.category} sub={chosen.color} />
        <Metric label={T("chat.shipsFrom")} value={chosen.ship_country ?? "—"} sub={chosen.brand} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <p className="font-mono text-[11.5px] text-stone-500">
          {result?.receiptId ? (
            <>
              {T("chat.settled")} · <span className="text-stone-700">{result.receiptId.slice(0, 18)}…</span>
            </>
          ) : (
            result?.reasonText ?? "—"
          )}
        </p>
        {(result?.trace?.length ?? 0) > 0 && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="font-sans text-[12.5px] font-semibold text-blue-700 hover:underline"
          >
            {open ? T("chat.hideDecision") : T("chat.seeDecision")}
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-stone-200/70 bg-white p-3">
          <DecisionPanel
            locale={locale}
            trace={result.trace}
            reasonText={result.reasonText}
            outcome={outcome}
            currency={chosen.currency}
          />
        </div>
      )}
    </Panel>
  );
}

export default function AgentChat({ locale, mandate, reload }) {
  const T = (k) => t(locale, k);
  const [log, setLog] = useState([]);
  const [draft, setDraft] = useState("runner");
  const [strategy, setStrategy] = useState("best");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length, busy]);

  const send = async () => {
    if (!mandate || !draft.trim()) return;
    const query = draft.trim();
    setDraft("");
    setLog((l) => [...l, { role: "human", text: query, ts: new Date() }]);
    setBusy(true);
    try {
      const out = await api.shop({ mandateId: mandate.mandateId, query, strategy }, locale);
      const fitting = out.comparison.filter((i) => i.fits).length;
      setLog((l) => [
        ...l,
        {
          role: "agent",
          ts: new Date(),
          // O agente relata o que FEZ. Nada aqui é opinião sobre a validade.
          text:
            strategy === "cheapest"
              ? T("chat.narrateAdversarial")
                  .replace("{n}", out.comparison.length)
                  .replace("{fit}", fitting)
              : T("chat.narrate").replace("{n}", out.comparison.length).replace("{fit}", fitting),
          entry: out.chosen ? out : null,
          note: out.chosen ? null : T("chat.nothingFits"),
        },
      ]);
      await reload();
    } catch (e) {
      setLog((l) => [...l, { role: "agent", ts: new Date(), text: e.message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-4xl flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 pr-1">
        {log.length === 0 && (
          <div className="mt-10 text-center">
            <p className="font-mono text-[12.5px] text-stone-400">
              {mandate ? T("chat.startHint") : T("chat.noMandate")}
            </p>
          </div>
        )}

        {log.map((m, i) =>
          m.role === "human" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] rounded-lg bg-stone-100 px-4 py-2.5">
                <p className="font-sans text-[14px] leading-relaxed text-stone-800">{m.text}</p>
                <p className="mt-1 text-right font-mono text-[10.5px] text-stone-400">
                  {m.ts.toLocaleTimeString(locale === "pt" ? "pt-BR" : "en-US", { timeStyle: "short" })}
                </p>
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              <div className="flex items-baseline gap-2">
                <Label>{T("chat.agentName")}</Label>
                <span className="font-mono text-[10.5px] text-stone-400">
                  {m.ts.toLocaleTimeString(locale === "pt" ? "pt-BR" : "en-US", { timeStyle: "short" })}
                </span>
              </div>
              <p className="max-w-[85%] font-sans text-[14px] leading-relaxed text-stone-800">{m.text}</p>
              {m.note && <p className="font-mono text-[12.5px] text-stone-500">{m.note}</p>}
              {m.entry && <ProposalCard locale={locale} entry={m.entry} />}
            </div>
          )
        )}

        {busy && <p className="font-mono text-[12px] text-stone-400">{T("chat.working")}</p>}
        <div ref={endRef} />
      </div>

      {/* ------------------------------ composer ----------------------------- */}
      <div className="shrink-0 border-t border-stone-200 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && send()}
              placeholder={T("chat.placeholder")}
              disabled={!mandate || busy}
              className="w-full rounded border border-stone-300 bg-white px-3.5 py-2.5 font-sans text-[14px] text-stone-900 outline-none transition focus:border-stone-800 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-50"
            />
          </div>
          <div className="w-[280px]">
            <Label className="mb-1 block">{T("chat.strategy")}</Label>
            <Select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="best">{T("chat.strategyBest")}</option>
              <option value="cheapest">{T("chat.strategyAdversarial")}</option>
            </Select>
          </div>
          <Button onClick={send} disabled={!mandate || busy}>
            {T("chat.send")}
          </Button>
        </div>
        <p className="mt-2.5 font-mono text-[11.5px] text-stone-500">
          {mandate
            ? T("chat.footer").replace("{n}", mandate.constraints?.length ?? 0)
            : T("chat.footerNoMandate")}
        </p>
      </div>
    </div>
  );
}
