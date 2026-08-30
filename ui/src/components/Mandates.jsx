/**
 * O registro do humano: o que ele autorizou, quanto já foi usado, e o freio.
 * Ver `docs/07-build-plan.md`, Fase 3.
 *
 * Esta tela **não cria** mandato.  Criar é confirmar uma proposta na tela de
 * propostas pendentes — o mandato limita o agente, e quem o cria não pode ser
 * quem é limitado, nem um formulário solto.
 *
 * `status` vem derivado do servidor, e a distinção importa: **esgotado ≠
 * revogado**.  Um cumpriu o papel dele; o outro foi retirado pela mão do humano.
 *
 * Cada mandato é uma LINHA que abre.  Fechado, cabe o que se olha de relance:
 * status, a frase, e quanto já foi gasto.  Aberto, vem o que se confere: as
 * regras uma a uma, com a política de cada eixo.  Uma lista de cartões altos
 * obriga a rolar para achar o mandato certo, que é o oposto de um registro.
 */

import { useState } from "react";
import { money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, ScreenHead, Empty, Mono } from "./ui.jsx";

const STATUS_TONE = { active: "allow", revoked: "deny", expired: "mute", exhausted: "mute" };
const POLICY_TONE = { deny: "deny", escalate: "wait", allow: "mute" };

/** Seta que gira ao abrir — a única affordance de que a linha tem mais dentro. */
const Chevron = ({ open }) => (
  <svg
    viewBox="0 0 16 16"
    className={`h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
  >
    <path d="M6 3.5L10.5 8L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function MandateRow({ locale, m, selected, onSelect, onRevoke, defaultOpen }) {
  const T = (k) => t(locale, k);
  const [open, setOpen] = useState(defaultOpen);
  const dead = m.status !== "active";

  return (
    <Panel
      tone={dead ? "mute" : undefined}
      className={`overflow-hidden ${selected ? "ring-2 ring-stone-900/10" : ""}`}
    >
      {/* ------------------------ fechado: de relance ------------------------ */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-stone-50/70"
      >
        <Chevron open={open} />

        <Chip tone={STATUS_TONE[m.status]} dot>
          {T(`status.${m.status}`)}
        </Chip>

        <span className={`min-w-0 flex-1 truncate font-sans text-[13.5px] ${dead ? "text-stone-500" : "text-stone-800"}`}>
          {m.humanReadable}
        </span>

        <span className="shrink-0 font-mono text-[12px] tabular-nums text-stone-500">
          {m.usedCount}/{m.maxUses}
        </span>
        {selected && (
          <span className="shrink-0 label-tech text-stone-400!">{T("mandates.inUse")}</span>
        )}
      </button>

      {/* ------------------------ aberto: para conferir ---------------------- */}
      {open && (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-stone-200/70 px-4 py-3 sm:grid-cols-4">
            {[
              [T("mandates.uses"), `${m.usedCount} / ${m.maxUses}`],
              [T("mandates.mode"), T(m.mode === "aprovacao" ? "mandates.modeApproval" : "mandates.modeAutonomous")],
              [T("mandates.validUntil"), new Date(m.expiresAt).toISOString().slice(0, 10)],
              [T("mandates.currency"), m.currency],
            ].map(([k, v]) => (
              <div key={k}>
                <Label>{k}</Label>
                <p className="mt-0.5 font-mono text-[12.5px] text-stone-800">{v}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border-t border-stone-200/70">
            <table className="w-full">
              <thead>
                <tr className="border-b border-stone-200/70 text-left">
                  <th className="px-4 py-2"><Label>{T("mandates.rule")}</Label></th>
                  <th className="px-3 py-2"><Label>{T("mandates.limit")}</Label></th>
                  <th className="px-3 py-2"><Label>{T("mandates.ifMissing")}</Label></th>
                  <th className="px-3 py-2"><Label>{T("mandates.ifNotMatched")}</Label></th>
                </tr>
              </thead>
              <tbody>
                {(m.constraints ?? []).map((c, i) => (
                  <tr key={i} className="border-b border-stone-100 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[12.5px] text-stone-700">
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

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/70 px-4 py-3">
            <Mono value={m.mandateId} copy />
            <div className="flex gap-2">
              {!dead && !selected && (
                <Button variant="ghost" onClick={() => onSelect?.(m.mandateId)}>
                  {T("mandates.use")}
                </Button>
              )}
              {!m.revoked && (
                <Button variant="refuse" onClick={() => onRevoke(m)}>
                  {T("mandates.revoke")}
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
    </Panel>
  );
}

export default function Mandates({ locale, mandates, selectedId, onSelect, onRevoke }) {
  const T = (k) => t(locale, k);

  // Vivos primeiro: o registro guarda tudo, mas o que ainda vale vem na frente.
  const ordered = [...mandates].sort(
    (a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1)
  );

  return (
    <>
      <ScreenHead title={T("mandates.title")} note={T("mandates.note")} />

      {ordered.length === 0 ? (
        <Panel>
          <Empty>{T("mandates.empty")}</Empty>
        </Panel>
      ) : (
        <div className="space-y-2.5">
          {ordered.map((m) => (
            <MandateRow
              key={m.mandateId}
              locale={locale}
              m={m}
              selected={m.mandateId === selectedId}
              onSelect={onSelect}
              onRevoke={onRevoke}
              // Com um mandato só, esconder o conteúdo atrás de um clique é
              // fricção sem ganho — não há lista para percorrer.
              defaultOpen={ordered.length === 1}
            />
          ))}
        </div>
      )}
    </>
  );
}
