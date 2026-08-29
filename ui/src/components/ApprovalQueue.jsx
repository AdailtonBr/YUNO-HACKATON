/**
 * Fila de aprovações.
 *
 * Cada linha é UMA compra específica — loja, produto, preço congelado — e o
 * motivo pelo qual subiu.  Aprovar libera aquela compra, uma vez; não alarga o
 * mandato.  Sem resposta, a pendência expira e nada é pago: o silêncio da
 * humana nunca vira um "sim".
 */

import { useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, ScreenHead, Empty, Mono } from "./ui.jsx";

const ORIGIN_KEY = { mode_aprovacao: "approvals.originMode", on_fail: "approvals.originFail", on_missing: "approvals.originMissing" };

function countdown(expiresAt, locale) {
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return t(locale, "approvals.expired");
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
            <Panel key={a.approvalId} tone="wait" className="overflow-hidden">
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

              <div className="grid gap-4 border-y border-amber-200/70 bg-white/70 px-4 py-3.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <p className="font-sans text-[15px] font-semibold text-stone-900">{a.productId}</p>
                  <p className="mt-0.5 font-mono text-[12px] text-stone-500">
                    {a.merchantId}
                    {a.attributes?.size ? ` · size ${a.attributes.size}` : ""}
                    {a.attributes?.ship_country ? ` · ${a.attributes.ship_country}` : ""}
                  </p>
                  <p className="mt-1.5 font-mono text-[17px] font-medium text-stone-900">
                    {money(a.price, a.currency, locale)}
                  </p>
                </div>

                <div className="min-w-0">
                  <Label>{T("approvals.why")}</Label>
                  <p className="mt-1 font-mono text-[12.5px] leading-relaxed text-amber-900">{a.reasonText}</p>
                  <p className="mt-1 font-mono text-[11px] text-stone-400">{T(ORIGIN_KEY[a.origin] ?? "approvals.originFail")}</p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button variant="refuse" onClick={act(a.approvalId, api.reject)} disabled={busy === a.approvalId}>
                    {T("approvals.refuse")}
                  </Button>
                  <Button variant="approve" onClick={act(a.approvalId, api.approve)} disabled={busy === a.approvalId}>
                    {T("approvals.approve")}
                  </Button>
                </div>
              </div>

              <div className="px-4 py-2">
                <Mono value={a.mandateId} />
              </div>
            </Panel>
          ))}

          <p className="font-mono text-[11.5px] text-stone-500">{T("approvals.footer")}</p>
        </div>
      )}
    </>
  );
}
