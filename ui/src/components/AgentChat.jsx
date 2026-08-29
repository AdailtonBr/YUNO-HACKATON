/**
 * A conversa com o agente — a porta de entrada do sistema.
 *
 * O agente conversa, consulta os catálogos, pergunta o que ainda falta, e
 * **rascunha** um mandato.  Ele nunca cria: o rascunho aparece em Propostas
 * pendentes, para o humano autorizar.
 *
 * O que ele diz é conversa.  O que está no **selo** dos cartões de compra é
 * decisão da Autoridade — o agente não escreve o selo, só o transporta.  Essa
 * separação é o produto inteiro numa tela.
 */

import { useEffect, useRef, useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, Metric } from "./ui.jsx";
import DecisionPanel from "./DecisionPanel.jsx";

const CONVERSATION_ID = "default";

const outcomeOf = (result) =>
  !result ? "none" : result.ok ? "valid" : result.action === "escalate" ? "escalate" : "reject";

const OUTCOME_CHIP = {
  valid: { tone: "allow", key: "outcome.allowed" },
  escalate: { tone: "wait", key: "outcome.waiting" },
  reject: { tone: "deny", key: "outcome.denied" },
};

/** Uma tentativa de compra, com o veredito da Autoridade estampado. */
function PurchaseCard({ locale, item, result }) {
  const T = (k) => t(locale, k);
  const [open, setOpen] = useState(false);
  const outcome = outcomeOf(result);
  const chip = OUTCOME_CHIP[outcome];

  return (
    <Panel tone={chip.tone} className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <Label>
            {T("chat.proposal")} · {item.merchantName}
          </Label>
          <p className="mt-0.5 font-sans text-[15px] font-semibold text-stone-900">{item.name}</p>
        </div>
        <Chip tone={chip.tone} dot>
          {T(chip.key)}
        </Chip>
      </header>

      <div className="grid grid-cols-2 divide-x divide-stone-200/70 border-y border-stone-200/70 bg-white/70 sm:grid-cols-3">
        <Metric label={T("chat.unitPrice")} value={money(item.price, item.currency, locale)} />
        <Metric
          label={T("chat.attributes")}
          value={item.size ? `size ${item.size}` : item.category}
          sub={item.color}
        />
        <Metric label={T("chat.shipsFrom")} value={item.ship_country ?? "—"} sub={item.brand} />
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
            currency={item.currency}
          />
        </div>
      )}
    </Panel>
  );
}

/** Aviso de que um rascunho foi depositado — com o caminho para autorizar. */
function ProposalDrafted({ locale, goToProposals }) {
  const T = (k) => t(locale, k);
  return (
    <Panel tone="wait" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="font-mono text-[12.5px] text-amber-900">{T("chat.proposalDrafted")}</p>
      <Button variant="approve" onClick={goToProposals}>
        {T("chat.goToProposals")}
      </Button>
    </Panel>
  );
}

export default function AgentChat({ locale, mandate, reload, goToProposals }) {
  const T = (k) => t(locale, k);
  const [log, setLog] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setLog((l) => [...l, { role: "human", text, ts: new Date() }]);
    setBusy(true);
    try {
      const out = await api.chat(
        { conversationId: CONVERSATION_ID, message: text, mandateId: mandate?.mandateId },
        locale
      );
      setLog((l) => [...l, { role: "agent", text: out.text, events: out.events ?? [], ts: new Date() }]);
      await reload();
    } catch (e) {
      const msg =
        e.data?.error === "missing_openai_key"
          ? "OPENAI_API_KEY is not set — put it in .env and restart the Authority."
          : e.data?.detail ?? e.message;
      setLog((l) => [...l, { role: "agent", text: msg, events: [], error: true, ts: new Date() }]);
    } finally {
      setBusy(false);
    }
  };

  const time = (d) => d.toLocaleTimeString(locale === "pt" ? "pt-BR" : "en-US", { timeStyle: "short" });

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 pr-1">
        {log.length === 0 && (
          <div className="mx-auto mt-16 max-w-md text-center">
            <p className="font-sans text-[14px] leading-relaxed text-stone-500">{T("chat.startHint")}</p>
            {!mandate && (
              <p className="mt-3 font-mono text-[12px] text-stone-400">{T("chat.noMandate")}</p>
            )}
          </div>
        )}

        {log.map((m, i) =>
          m.role === "human" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] rounded-lg bg-stone-100 px-4 py-2.5">
                <p className="font-sans text-[14px] leading-relaxed text-stone-800">{m.text}</p>
                <p className="mt-1 text-right font-mono text-[10.5px] text-stone-400">{time(m.ts)}</p>
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              <div className="flex items-baseline gap-2">
                <Label>{T("chat.agentName")}</Label>
                <span className="font-mono text-[10.5px] text-stone-400">{time(m.ts)}</span>
              </div>
              {m.text && (
                <p
                  className={`max-w-[90%] whitespace-pre-wrap font-sans text-[14px] leading-relaxed ${
                    m.error ? "text-red-700" : "text-stone-800"
                  }`}
                >
                  {m.text}
                </p>
              )}
              {(m.events ?? []).map((ev, j) =>
                ev.type === "proposal" ? (
                  <ProposalDrafted key={j} locale={locale} goToProposals={goToProposals} />
                ) : ev.type === "purchase" ? (
                  <PurchaseCard key={j} locale={locale} item={ev.item} result={ev.result} />
                ) : null
              )}
            </div>
          )
        )}

        {busy && <p className="font-mono text-[12px] text-stone-400">{T("chat.working")}</p>}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-stone-200 pt-4">
        <div className="flex items-end gap-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={T("chat.placeholder")}
            disabled={busy}
            className="flex-1 rounded border border-stone-300 bg-white px-3.5 py-2.5 font-sans text-[14px] text-stone-900 outline-none transition focus:border-stone-800 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-50"
          />
          <Button onClick={send} disabled={busy || !draft.trim()}>
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
