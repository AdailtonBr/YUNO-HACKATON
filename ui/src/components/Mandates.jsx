/**
 * O registro do humano: o que ele autorizou, quanto já foi usado, e o botão de
 * revogar.  Ver `docs/07-build-plan.md`, Fase 3.
 *
 * Esta tela **não cria** mandato.  Criar é confirmar uma proposta na tela de
 * propostas pendentes — o mandato limita o agente, e quem o cria não pode ser
 * quem é limitado, nem um formulário solto.
 *
 * `status` vem derivado do servidor, e a distinção importa: **esgotado ≠
 * revogado**.  Um cumpriu o papel dele; o outro foi retirado pela mão do humano.
 */

import { useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, PanelHead, ScreenHead, Empty, Mono } from "./ui.jsx";

const STATUS_TONE = { active: "allow", revoked: "deny", expired: "mute", exhausted: "mute" };
const POLICY_TONE = { deny: "deny", escalate: "wait", allow: "mute" };

export default function Mandates({ locale, mandates, selectedId, onSelect, reload, onRevoke }) {
  const T = (k) => t(locale, k);
  const [busy, setBusy] = useState(null);

  return (
    <>
      <ScreenHead title={T("mandates.title")} note={T("mandates.note")} />

      {mandates.length === 0 ? (
        <Panel>
          <Empty>{T("mandates.empty")}</Empty>
        </Panel>
      ) : (
        <div className="space-y-5">
          {mandates.map((m) => (
            <Panel
              key={m.mandateId}
              tone={m.status === "active" ? undefined : "mute"}
              className={m.mandateId === selectedId ? "ring-2 ring-stone-900/10" : ""}
            >
              <PanelHead
                title={m.humanReadable}
                right={
                  <div className="flex items-center gap-2">
                    <Chip tone={STATUS_TONE[m.status]} dot>
                      {T(`status.${m.status}`)}
                    </Chip>
                    <Chip>{T(m.mode === "aprovacao" ? "mandates.modeApproval" : "mandates.modeAutonomous")}</Chip>
                  </div>
                }
              />

              <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-3 sm:grid-cols-4">
                {[
                  [T("mandates.uses"), `${m.usedCount} / ${m.maxUses}`],
                  [T("mandates.currency"), m.currency],
                  [T("mandates.validUntil"), new Date(m.expiresAt).toISOString().slice(0, 10)],
                  [T("mandates.rules"), String(m.constraints?.length ?? 0)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <Label>{k}</Label>
                    <p className="mt-0.5 font-mono text-[13px] text-stone-800">{v}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto border-t border-stone-200/70">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stone-200/70 text-left">
                      <th className="px-5 py-2"><Label>{T("mandates.rule")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("mandates.limit")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("mandates.ifMissing")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("mandates.ifNotMatched")}</Label></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(m.constraints ?? []).map((c, i) => (
                      <tr key={i} className="border-b border-stone-100 last:border-0">
                        <td className="whitespace-nowrap px-5 py-2 font-mono text-[12.5px] text-stone-700">
                          <span className="mr-2 text-stone-400">{String(i + 1).padStart(2, "0")}</span>
                          {c.attr}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12.5px] text-stone-600">
                          {c.op} {c.attr === "price" ? money(c.value, m.currency, locale) : String(c.value)}
                        </td>
                        <td className="px-3 py-2">
                          <Chip tone={POLICY_TONE[c.on_missing]}>{T(`policy.${c.on_missing}`)}</Chip>
                        </td>
                        <td className="px-3 py-2">
                          <Chip tone={POLICY_TONE[c.on_fail]}>{T(`policy.${c.on_fail}`)}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/70 px-5 py-3">
                <Mono value={m.mandateId} copy />
                <div className="flex gap-2">
                  {m.status === "active" && m.mandateId !== selectedId && (
                    <Button variant="ghost" onClick={() => onSelect?.(m.mandateId)}>
                      {T("mandates.use")}
                    </Button>
                  )}
                {!m.revoked && (
                  <Button variant="refuse" onClick={() => onRevoke(m)} disabled={busy === m.mandateId}>
                    {T("mandates.revoke")}
                  </Button>
                )}
                </div>
              </footer>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
