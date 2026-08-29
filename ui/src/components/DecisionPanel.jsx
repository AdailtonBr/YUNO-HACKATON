/**
 * "A regra que decidiu" — a explicação regra a regra de uma verificação.
 *
 * Esta tela só é possível porque o motor devolve um `trace` com o veredito de
 * CADA constraint, e não só o da que barrou.  Repare no estado "não avaliada":
 * o motor para na primeira violação, então dizer "ok" sobre as seguintes seria
 * inventar.  Uma decisão sobre dinheiro tem que poder ser reconstituída.
 */

import { money } from "../api.js";
import { t } from "../i18n.js";
import { Chip, Label, Panel } from "./ui.jsx";

const VERDICT = {
  ok: { tone: "allow", key: "verdict.ok" },
  violated: { tone: "deny", key: "verdict.violated" },
  missing: { tone: "deny", key: "verdict.missing" },
  missing_allowed: { tone: "mute", key: "verdict.missingAllowed" },
  invalid_rule: { tone: "deny", key: "verdict.invalidRule" },
  not_evaluated: { tone: "mute", key: "verdict.notEvaluated" },
};

const fmt = (v) => (Array.isArray(v) ? v.join(", ") : v === undefined ? "—" : String(v));

/** `price` vive em centavos; qualquer outro atributo é literal. */
const fmtValue = (attr, v, currency, locale) =>
  attr === "price" && typeof v === "number" ? money(v, currency, locale) : fmt(v);

export default function DecisionPanel({ locale, trace = [], reasonText, outcome, currency = "BRL", compact = false }) {
  const T = (k) => t(locale, k);
  if (!trace.length && !reasonText) return null;

  const tone = outcome === "valid" ? "allow" : outcome === "escalate" ? "wait" : "deny";
  const decidingIndex = trace.findIndex((r) => ["violated", "missing", "invalid_rule"].includes(r.verdict));

  return (
    <Panel tone={tone} className="overflow-hidden">
      {reasonText && (
        <div className="px-4 py-3">
          <Label>{T("decision.rule")}</Label>
          <p
            className={`mt-1.5 font-mono text-[13.5px] leading-relaxed ${
              tone === "deny" ? "text-red-800" : tone === "wait" ? "text-amber-900" : "text-emerald-900"
            }`}
          >
            {reasonText}
          </p>
          {decidingIndex >= 0 && decidingIndex < trace.length - 1 && (
            <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-stone-500">
              {T("decision.stopped")}
            </p>
          )}
        </div>
      )}

      {trace.length > 0 && (
        <div className="overflow-x-auto border-t border-current/10 bg-white/60">
          <table className="w-full">
            <thead>
              <tr className="border-b border-stone-200/80 text-left">
                <th className="px-4 py-2">
                  <Label>{T("decision.rule_")}</Label>
                </th>
                <th className="px-3 py-2">
                  <Label>{T("decision.limit")}</Label>
                </th>
                {!compact && (
                  <th className="px-3 py-2">
                    <Label>{T("decision.actual")}</Label>
                  </th>
                )}
                <th className="px-3 py-2 text-right">
                  <Label>{T("decision.verdict")}</Label>
                </th>
              </tr>
            </thead>
            <tbody>
              {trace.map((r, i) => {
                const v = VERDICT[r.verdict] ?? VERDICT.not_evaluated;
                const decided = i === decidingIndex;
                return (
                  <tr
                    key={`${r.attr}-${i}`}
                    className={`border-b border-stone-100 last:border-0 ${decided ? "bg-red-50/60" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[12.5px] text-stone-700">
                      <span className="mr-2 text-stone-400">{String(i + 1).padStart(2, "0")}</span>
                      {r.attr}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12.5px] text-stone-600">
                      {r.attr} {r.op} {fmtValue(r.attr, r.value, currency, locale)}
                    </td>
                    {!compact && (
                      <td
                        className={`px-3 py-2 font-mono text-[12.5px] ${
                          decided ? "font-medium text-red-700" : "text-stone-700"
                        }`}
                      >
                        {r.verdict === "not_evaluated" ? (
                          <span className="text-stone-300">—</span>
                        ) : (
                          fmtValue(r.attr, r.actual, currency, locale)
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <Chip tone={v.tone} dot={v.tone !== "mute"}>
                        {T(v.key)}
                      </Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
