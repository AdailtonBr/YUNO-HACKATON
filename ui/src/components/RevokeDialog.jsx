/**
 * Diálogo de revogação.
 *
 * Revogar é irreversível e encerra o mandato, então a caixa faz três coisas
 * que uma confirmação genérica não faria: diz **o que exatamente será
 * encerrado**, exige o humano digitar a confirmação (evita o clique reflexo),
 * e avisa que o ato fica registrado no trilho.
 *
 * O que ela NÃO faz é decidir qualquer coisa: quem revoga é a Autoridade,
 * quando o humano confirma.  Esta tela só coleta a intenção.
 */

import { useEffect, useState } from "react";
import { t } from "../i18n.js";
import { Button, Label, Mono } from "./ui.jsx";

export default function RevokeDialog({ locale, mandate, onClose, onConfirm }) {
  const T = (k) => t(locale, k);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const phrase = `REVOKE ${mandate?.mandateId?.slice(0, 12) ?? ""}`;
  const matches = typed.trim() === phrase;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mandate) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 bg-red-700 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 bg-white" />
            <h2 className="font-sans text-[15px] font-semibold text-white">{T("revoke.title")}</h2>
          </div>
          <span className="font-mono text-[11.5px] text-red-100">{mandate.mandateId.slice(0, 16)}…</span>
        </header>

        <div className="space-y-5 px-5 py-5">
          <p className="font-sans text-[14px] leading-relaxed text-stone-700">{T("revoke.lead")}</p>

          <div>
            <Label>{T("revoke.whatEnds")}</Label>
            <ul className="mt-2 space-y-1.5">
              {[
                T("revoke.item1"),
                T("revoke.item2"),
                T("revoke.item3"),
                T("revoke.item4"),
              ].map((line, i) => (
                <li key={i} className="flex gap-2.5 font-mono text-[12.5px] leading-relaxed text-stone-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-red-600" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-stone-200 bg-stone-50 px-4 py-3">
            <Label>{T("revoke.mandate")}</Label>
            <p className="mt-1 font-sans text-[13.5px] leading-relaxed text-stone-800">{mandate.humanReadable}</p>
            <p className="mt-2">
              <Mono value={mandate.mandateId} copy />
            </p>
          </div>

          <div>
            <Label>{T("revoke.typeToConfirm")}</Label>
            <div className="mt-1.5 flex items-center gap-3">
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={phrase}
                className="w-full rounded border border-stone-300 bg-white px-3 py-2.5 font-mono text-[14px] tracking-wide text-stone-900 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/10"
              />
              {matches && (
                <span className="shrink-0 font-mono text-[12px] font-medium text-emerald-700">
                  {T("revoke.matches")}
                </span>
              )}
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-5 py-3.5">
          <p className="font-mono text-[11.5px] text-stone-500">{T("revoke.logged")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {T("revoke.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={!matches || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? T("revoke.revoking") : T("revoke.confirm")}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
