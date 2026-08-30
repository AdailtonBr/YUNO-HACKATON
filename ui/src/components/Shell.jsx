/**
 * A moldura: barra superior + navegação lateral.
 *
 * Duas decisões de layout que são decisões de produto:
 *  - o estado do mandato fica na barra superior, visível em TODAS as telas.
 *    Quem opera precisa saber a todo momento sob que autorização está.
 *  - REVOKE fica sempre à mão, no canto, em vermelho.  É o freio; um freio que
 *    precisa ser procurado não é um freio.  É também o que o juiz aperta na
 *    prova de fogo, sem ninguém do time tocar em nada.
 */

import { t } from "../i18n.js";
import { Chip, Label, Meter, TONE } from "./ui.jsx";

// As quatro telas da Fase 3 do plano (propostas, aprovacoes, mandatos,
// auditoria), mais a superficie do agente, que e a porta de entrada.
const NAV = ["chat", "proposals", "approvals", "mandates", "audit"];

export default function Shell({
  locale,
  setLocale,
  tab,
  setTab,
  mandate,
  mandates = [],
  onSelectMandate,
  counts = {},
  onRevoke,
  children,
}) {
  const T = (k) => t(locale, k);
  const status = mandate?.status ?? "none";
  const tone = status === "active" ? "allow" : status === "none" ? "mute" : "deny";

  return (
    <div className="flex min-h-full flex-col">
      {/* ---------------------------- barra superior --------------------------- */}
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-stone-900">
            {T("brand")}
          </span>

          <div className="h-5 w-px bg-stone-200" />

          {/* Com mais de um mandato o chip vira seletor: qual deles o agente
              usa é escolha da humana, não do primeiro da lista. */}
          {mandates.length > 1 ? (
            <label className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} />
              <select
                value={mandate?.mandateId ?? ""}
                onChange={(e) => onSelectMandate?.(e.target.value)}
                className="max-w-[280px] truncate rounded border border-stone-300 bg-white px-2 py-1 font-mono text-[11.5px] text-stone-800 outline-none focus:border-stone-800"
                title={T("topbar.pick")}
              >
                {mandates.map((m) => (
                  <option key={m.mandateId} value={m.mandateId}>
                    {T(`status.${m.status}`)} · {m.humanReadable?.slice(0, 46) ?? m.mandateId}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Chip tone={tone} dot>
              {mandate ? `${T(`status.${status}`)} · ${mandate.mandateId.slice(0, 12)}` : T("status.none")}
            </Chip>
          )}

          {mandate && (
            <div className="hidden min-w-[180px] max-w-[260px] flex-1 sm:block">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <Label>{T("topbar.uses")}</Label>
                <span className="font-mono text-[12px] text-stone-700">
                  {mandate.usedCount} / {mandate.maxUses}
                </span>
              </div>
              <Meter
                value={mandate.usedCount}
                max={mandate.maxUses}
                tone={mandate.usedCount >= mandate.maxUses ? "wait" : "allow"}
              />
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-[11.5px] text-stone-500 md:inline">
              {T("topbar.agent")} <span className="text-stone-800">agent_michael</span>
            </span>

            <div className="flex overflow-hidden rounded border border-stone-300">
              {["en", "pt"].map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={`px-2 py-1 font-mono text-[11px] font-medium uppercase transition ${
                    locale === l ? "bg-stone-900 text-white" : "bg-white text-stone-500 hover:bg-stone-50"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            <button
              onClick={onRevoke}
              disabled={!mandate || mandate.revoked}
              className="flex items-center gap-2 rounded bg-red-700 px-3.5 py-2 font-sans text-[12.5px] font-semibold uppercase tracking-wide text-white transition hover:bg-red-800 disabled:bg-stone-200 disabled:text-stone-400"
            >
              <span className="h-2 w-2 bg-white/90" />
              {T("revoke.button")}
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* ------------------------------ lateral ----------------------------- */}
        <nav className="hidden w-56 shrink-0 border-r border-stone-200 bg-white px-3 py-5 md:block">
          <Label className="px-2">{T("nav.section")}</Label>
          <ul className="mt-3 space-y-0.5">
            {NAV.map((k) => (
              <li key={k}>
                <button
                  onClick={() => setTab(k)}
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-left font-sans text-[13.5px] transition ${
                    tab === k
                      ? "bg-stone-100 font-semibold text-stone-900"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  }`}
                >
                  {T(`nav.${k}`)}
                  {counts[k] > 0 && (
                    <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-800">
                      {counts[k]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {mandate && (
            <div className="mt-8 border-t border-stone-200 px-2 pt-4">
              <Label>{T("nav.enforcedBy")}</Label>
              <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-stone-500">
                {T("nav.enforcedByNote")}
              </p>
            </div>
          )}
        </nav>

        {/* tabs no mobile, já que a lateral some */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-1 overflow-x-auto border-b border-stone-200 bg-white px-3 md:hidden">
            {NAV.map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`whitespace-nowrap px-3 py-2.5 font-sans text-[13px] ${
                  tab === k ? "font-semibold text-stone-900" : "text-stone-500"
                }`}
              >
                {T(`nav.${k}`)}
              </button>
            ))}
          </div>

          <main className="min-w-0 flex-1 px-5 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
