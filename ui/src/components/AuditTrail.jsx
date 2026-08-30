/**
 * Trilha de auditoria.
 *
 * Append-only: nada nesta tela pode ser editado ou apagado.  É o que sustenta
 * a disputa — "eu nunca autorizei isso" se resolve aqui, porque o sim
 * específico, a regra que decidiu e o recibo estão todos carimbados em ordem.
 *
 * Cada linha abre o veredito regra a regra daquela verificação.
 */

import { useState } from "react";
import { api, money } from "../api.js";
import { t, EVENT_LABEL, DECISION_LABEL } from "../i18n.js";
import { Button, Chip, Label, Panel, ScreenHead, Empty, Mono } from "./ui.jsx";
import DecisionPanel from "./DecisionPanel.jsx";

/**
 * A disputa, mostrada como cadeia de elos.
 *
 * O veredito não é uma opinião do sistema: cada linha é um fato carimbado no
 * trilho, com quem o praticou e quando.  O titular pode conferir elo a elo em
 * vez de aceitar um "foi legítimo" sem recurso — e quando um elo falta, é
 * exatamente esse que aparece quebrado.
 */
function DisputeResult({ locale, result }) {
  const T = (k) => t(locale, k);
  const tone =
    result.verdict === "authorized" ? "allow" : result.verdict === "nothing_charged" ? "mute" : "deny";
  const title = T(
    result.verdict === "authorized"
      ? "audit.disputeAuthorized"
      : result.verdict === "nothing_charged"
      ? "audit.disputeNothingCharged"
      : "audit.disputeNotAuthorized"
  );

  return (
    <Panel tone={tone} className="mt-3 overflow-hidden">
      <div className="px-4 py-3">
        <Label>{T("audit.disputeTitle")}</Label>
        <p
          className={`mt-1 font-sans text-[15px] font-semibold ${
            tone === "allow" ? "text-emerald-900" : tone === "deny" ? "text-red-900" : "text-stone-700"
          }`}
        >
          {title}
        </p>
        {result.verdict !== "nothing_charged" && (
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-stone-600">
            {T(result.verdict === "authorized" ? "audit.disputeAuthorizedNote" : "audit.disputeNotAuthorizedNote")}
          </p>
        )}
      </div>

      {result.evidence.length > 0 && (
        <ul className="divide-y divide-stone-200/70 border-t border-stone-200/70 bg-white/70">
          {result.evidence.map((e) => (
            <li key={e.key} className="flex items-start gap-3 px-4 py-2.5">
              <Chip tone={e.ok === true ? "allow" : e.ok === null ? "mute" : "deny"} dot={e.ok !== null}>
                {e.ok === true ? "ok" : e.ok === null ? "n/a" : "missing"}
              </Chip>
              <div className="min-w-0">
                <p className="font-sans text-[13px] text-stone-800">{T(`audit.link.${e.key}`)}</p>
                {e.ok === null && (
                  <p className="font-mono text-[11.5px] text-stone-400">{T("audit.notApplicable")}</p>
                )}
                {e.terms && <p className="font-mono text-[11.5px] text-stone-500">{e.terms}</p>}
                {e.by && (
                  <p className="font-mono text-[11.5px] text-stone-500">
                    {e.by} · {new Date(e.ts).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}
                  </p>
                )}
                {e.key === "agent_identity" && e.ok === false && (
                  <p className="font-mono text-[11.5px] text-red-700">
                    {e.claimed} ≠ {e.mandateHolder}
                  </p>
                )}
                {e.key === "charged_what_was_verified" && e.ok === false && (
                  <p className="font-mono text-[11.5px] text-red-700">
                    {money(e.verified, "BRL", locale)} → {money(e.charged ?? 0, "BRL", locale)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const DECISION_TONE = { valido: "allow", recusado: "deny", escalado: "wait" };
const EVENT_TONE = {
  mandate_created: "mute",
  mandate_revoked: "deny",
  approval_granted: "allow",
  approval_rejected: "deny",
  purchase_decision: "mute",
  payment_result: "allow",
};
const ACTOR_MARK = { human: "you", agent: "agent", authority: "authority", merchant: "store" };

const FILTERS = ["all", "purchase_decision", "payment_result", "approval_granted", "mandate_revoked"];

export default function AuditTrail({ locale, trail }) {
  const T = (k) => t(locale, k);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [disputes, setDisputes] = useState({}); // auditId -> resultado
  const [busy, setBusy] = useState(null);

  const dispute = async (auditId) => {
    setBusy(auditId);
    try {
      const r = await api.dispute(auditId, "the holder denies this purchase", locale);
      setDisputes((d) => ({ ...d, [auditId]: r }));
    } finally {
      setBusy(null);
    }
  };

  const rows = trail.filter((e) => filter === "all" || e.event === filter);

  return (
    <>
      <ScreenHead
        title={T("audit.title")}
        note={T("audit.note").replace("{n}", trail.length)}
        right={
          <Chip tone="allow" dot>
            {T("audit.appendOnly")}
          </Chip>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Label className="mr-1">{T("audit.filter")}</Label>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition ${
              filter === f
                ? "border-stone-800 bg-stone-900 text-white"
                : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            {f === "all" ? T("audit.all") : EVENT_LABEL[locale][f] ?? f}
          </button>
        ))}
      </div>

      <Panel className="overflow-hidden">
        {rows.length === 0 ? (
          <Empty>{T("audit.empty")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2.5"><Label>{T("audit.seq")}</Label></th>
                  <th className="px-3 py-2.5"><Label>{T("audit.time")}</Label></th>
                  <th className="px-3 py-2.5"><Label>{T("audit.event")}</Label></th>
                  <th className="px-3 py-2.5"><Label>{T("audit.amount")}</Label></th>
                  <th className="px-3 py-2.5"><Label>{T("audit.result")}</Label></th>
                  <th className="px-3 py-2.5"><Label>{T("audit.actor")}</Label></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => {
                  const seq = rows.length - i;
                  const expandable = (e.trace?.length ?? 0) > 0;
                  const isOpen = open === i;
                  return (
                    <>
                      <tr
                        key={i}
                        onClick={() => expandable && setOpen(isOpen ? null : i)}
                        className={`border-b border-stone-100 last:border-0 ${
                          expandable ? "cursor-pointer hover:bg-stone-50" : ""
                        } ${isOpen ? "bg-stone-50" : ""}`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-stone-400">
                          #{String(seq).padStart(4, "0")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] tabular-nums text-stone-600">
                          {new Date(e.ts).toLocaleTimeString(locale === "pt" ? "pt-BR" : "en-US")}
                        </td>
                        <td className="px-3 py-2.5">
                          <Chip tone={EVENT_TONE[e.event] ?? "mute"} dot>
                            {EVENT_LABEL[locale][e.event] ?? e.event}
                          </Chip>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12.5px] tabular-nums text-stone-800">
                          {e.purchase?.price != null ? money(e.purchase.price, e.purchase.currency, locale) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {e.decision && (
                              <Chip tone={DECISION_TONE[e.decision]}>
                                {DECISION_LABEL[locale][e.decision] ?? e.decision}
                              </Chip>
                            )}
                            <span className="font-mono text-[12px] text-stone-500">
                              {e.reasonText ?? (e.receiptId ? <Mono value={e.receiptId} copy /> : "")}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11.5px] text-stone-500">
                          {ACTOR_MARK[e.actor?.type] ?? "—"}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${i}-detail`} className="border-b border-stone-100">
                          <td colSpan={6} className="bg-stone-50 px-4 py-4">
                            <DecisionPanel
                              locale={locale}
                              trace={e.trace}
                              reasonText={e.reasonText}
                              outcome={e.decision === "valido" ? "valid" : e.decision === "escalado" ? "escalate" : "reject"}
                              currency={e.purchase?.currency}
                            />

                            {/* A disputa mora AQUI, no trilho: negar a compra e
                                ver o registro responder é o mesmo gesto. */}
                            {e.event === "purchase_decision" && (
                              <div className="mt-3">
                                {!disputes[e.auditId] ? (
                                  <Button
                                    variant="refuse"
                                    onClick={() => dispute(e.auditId)}
                                    disabled={busy === e.auditId}
                                  >
                                    {busy === e.auditId ? T("audit.disputing") : T("audit.disputeButton")}
                                  </Button>
                                ) : (
                                  <DisputeResult locale={locale} result={disputes[e.auditId]} />
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="mt-3 font-mono text-[11.5px] text-stone-500">{T("audit.footer")}</p>
    </>
  );
}
