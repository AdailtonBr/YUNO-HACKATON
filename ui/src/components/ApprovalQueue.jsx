/**
 * Fila de aprovações.
 *
 * Cada linha é UMA compra específica — loja, produto, preço congelado — e o
 * motivo pelo qual subiu.  Aprovar libera aquela compra, uma vez; não alarga o
 * mandato.  Sem resposta, a pendência expira e nada é pago: o silêncio do
 * humano nunca vira um "sim".
 *
 * Fechada, a linha diz o que se decide de relance.  Aberta, ela responde a
 * pergunta que sempre vem primeiro diante de uma compra estranha: **qual
 * autorização minha permitiu isto?**  O mandato de origem vem junto, com as
 * regras que ele impôs — cruzar ids na mão entre duas telas não é auditoria.
 */

import { useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, ScreenHead, Empty, Mono } from "./ui.jsx";

const ORIGIN_KEY = {
  mode_aprovacao: "approvals.originMode",
  on_fail: "approvals.originFail",
  on_missing: "approvals.originMissing",
};
const POLICY_TONE = { deny: "deny", escalate: "wait", allow: "mute" };

function countdown(expiresAt, locale) {
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return t(locale, "approvals.expired");
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const Chevron = ({ open }) => (
  <svg
    viewBox="0 0 16 16"
    className={`h-3.5 w-3.5 shrink-0 text-amber-700/60 transition-transform ${open ? "rotate-90" : ""}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
  >
    <path d="M6 3.5L10.5 8L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Os atributos que a LOJA atestou sobre este item, exatamente como chegaram. */
function Attested({ locale, attributes = {} }) {
  const T = (k) => t(locale, k);
  const rows = Object.entries(attributes).filter(([k]) => k !== "price");
  if (rows.length === 0) return null;
  return (
    <div>
      <Label>{T("approvals.attested")}</Label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {rows.map(([k, v]) => (
          <span key={k} className="rounded border border-stone-200 bg-white px-2 py-0.5 font-mono text-[11.5px] text-stone-600">
            {k} <span className="text-stone-900">{String(v)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ApprovalRow({ locale, a, busy, onApprove, onRefuse }) {
  const T = (k) => t(locale, k);
  const [open, setOpen] = useState(false);

  return (
    <Panel tone="wait" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <Chip tone="wait" dot>
          {T("approvals.awaiting")}
        </Chip>
        <div className="flex items-center gap-2">
          <Label>{T("approvals.expiresIn")}</Label>
          <span className="font-mono text-[13px] font-medium text-amber-800">
            {countdown(a.expiresAt, locale)}
          </span>
        </div>
      </header>

      {/* ---------------------- fechado: o que se decide ---------------------- */}
      <div className="grid gap-4 border-y border-amber-200/70 bg-white/70 px-4 py-3.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-start gap-2.5 text-left">
          <Chevron open={open} />
          <span className="min-w-0">
            <span className="block font-sans text-[15px] font-semibold text-stone-900">
              {a.name ?? a.productId}
            </span>
            <span className="mt-0.5 block font-mono text-[12px] text-stone-500">
              {a.merchantId}
              {a.attributes?.product_type ? ` · ${a.attributes.product_type}` : ""}
              {a.attributes?.ship_country ? ` · ${a.attributes.ship_country}` : ""}
            </span>
            <span className="mt-1.5 block font-mono text-[17px] font-medium text-stone-900">
              {money(a.price, a.currency, locale)}
            </span>
          </span>
        </button>

        <div className="min-w-0">
          <Label>{T("approvals.why")}</Label>
          <p className="mt-1 font-mono text-[12.5px] leading-relaxed text-amber-900">{a.reasonText}</p>
          <p className="mt-1 font-mono text-[11px] text-stone-400">
            {T(ORIGIN_KEY[a.origin] ?? "approvals.originFail")}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="refuse" onClick={onRefuse} disabled={busy}>
            {T("approvals.refuse")}
          </Button>
          <Button variant="approve" onClick={onApprove} disabled={busy}>
            {T("approvals.approve")}
          </Button>
        </div>
      </div>

      {/* --------------- aberto: o que é, e sob qual autorização -------------- */}
      {open && (
        <div className="space-y-4 border-b border-amber-200/70 bg-white px-4 py-4">
          <Attested locale={locale} attributes={a.attributes} />

          {a.mandate && (
            <div>
              <Label>{T("approvals.underMandate")}</Label>
              <p className="mt-1 font-sans text-[13.5px] leading-relaxed text-stone-800">
                {a.mandate.humanReadable}
              </p>
              <p className="mt-1 font-mono text-[11.5px] text-stone-500">
                {T(`status.${a.mandate.status}`)} · {a.mandate.usedCount}/{a.mandate.maxUses} ·{" "}
                {T(a.mandate.mode === "aprovacao" ? "mandates.modeApproval" : "mandates.modeAutonomous")}
              </p>

              <div className="mt-2 overflow-x-auto rounded border border-stone-200">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left">
                      <th className="px-3 py-1.5"><Label>{T("mandates.rule")}</Label></th>
                      <th className="px-3 py-1.5"><Label>{T("mandates.limit")}</Label></th>
                      <th className="px-3 py-1.5"><Label>{T("approvals.thisPurchase")}</Label></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a.mandate.constraints ?? []).map((c, i) => {
                      const actual = c.attr === "price" ? a.price : a.attributes?.[c.attr];
                      return (
                        <tr key={i} className="border-b border-stone-100 last:border-0">
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-stone-700">{c.attr}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-stone-600">
                            {c.op} {c.attr === "price" ? money(c.value, a.currency, locale) : String(c.value)}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-stone-900">
                            {actual === undefined ? (
                              <span className="text-stone-300">—</span>
                            ) : c.attr === "price" ? (
                              money(actual, a.currency, locale)
                            ) : (
                              String(actual)
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <Label>{T("approvals.mandateId")}</Label> <Mono value={a.mandateId} copy />
            </span>
            <span>
              <Label>{T("approvals.approvalId")}</Label> <Mono value={a.approvalId} />
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

export default function ApprovalQueue({ locale, approvals, reload }) {
  const T = (k) => t(locale, k);
  const [busy, setBusy] = useState(null);

  const act = (id, fn) => async () => {
    setBusy(id);
    try {
      await fn(id, locale);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const waiting = approvals.reduce((sum, a) => sum + a.price, 0);

  return (
    <>
      <ScreenHead
        title={T("approvals.title")}
        note={T("approvals.note")}
        right={
          approvals.length > 0 && (
            <Chip tone="wait">
              {T("approvals.exposureWaiting")} {money(waiting, approvals[0]?.currency, locale)}
            </Chip>
          )
        }
      />

      {approvals.length === 0 ? (
        <Panel>
          <Empty>{T("approvals.empty")}</Empty>
        </Panel>
      ) : (
        <div className="space-y-4">
          {approvals.map((a) => (
            <ApprovalRow
              key={a.approvalId}
              locale={locale}
              a={a}
              busy={busy === a.approvalId}
              onApprove={act(a.approvalId, api.approve)}
              onRefuse={act(a.approvalId, api.reject)}
            />
          ))}
          <p className="font-mono text-[11.5px] text-stone-500">{T("approvals.footer")}</p>
        </div>
      )}
    </>
  );
}
