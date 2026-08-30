/**
 * Propostas pendentes — a Trusted Surface.
 *
 * É aqui que a decisão D4 acontece: o agente **rascunha**, o humano **confirma**.
 * O mandato só passa a existir quando alguém aperta "Authorize" nesta tela.
 *
 * Duas coisas que parecem detalhe e não são:
 *
 *  - a frase em linguagem natural vem do SERVIDOR, do mesmo renderizador que
 *    grava o mandato.  Se a UI tivesse tradutor próprio, ela poderia mostrar
 *    "R$100" enquanto o mandato grava R$1000 — e o humano teria consentido com
 *    uma frase que não é a regra.
 *
 *  - a tabela de regras é mostrada junto.  A frase é para entender; a tabela é
 *    para conferir.  Consentir com o que não se entende não é consentir, mas
 *    consentir sem poder verificar também não.
 */

import { useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, PanelHead, ScreenHead, Empty, Mono } from "./ui.jsx";

const POLICY_TONE = { deny: "deny", escalate: "wait", allow: "mute" };

export default function Proposals({ locale, proposals, reload }) {
  const T = (k) => t(locale, k);
  const [busy, setBusy] = useState(null);

  const authorize = (p) => async () => {
    setBusy(p.proposalId);
    try {
      // O instrumento cru entra no cofre AQUI, com o humano presente, e vira uma
      // referência opaca.  A proposta do agente nunca escolhe com o que se paga.
      const { paymentMethodRef } = await api.tokenize(
        p.draft.rail ?? "card",
        p.draft.rail === "pix" ? { key: "michael@pix.com" } : { number: "4242424242424242", exp: "12/29" },
        locale
      );
      await api.createMandate(
        { agentId: p.agentId, paymentMethodRef, proposalId: p.proposalId, ...p.draft },
        locale
      );
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const discard = (p) => async () => {
    setBusy(p.proposalId);
    try {
      await api.discardProposal(p.proposalId, locale);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ScreenHead title={T("proposals.title")} note={T("proposals.note")} />

      {proposals.length === 0 ? (
        <Panel>
          <Empty>{T("proposals.empty")}</Empty>
        </Panel>
      ) : (
        <div className="space-y-5">
          {proposals.map((p) => (
            <Panel key={p.proposalId} tone="wait" className="overflow-hidden">
              <PanelHead
                title={T("proposals.draftedBy").replace("{agent}", p.agentId)}
                note={p.rationale}
                right={<Chip tone="wait" dot>{T("proposals.awaiting")}</Chip>}
              />

              {/* A frase: para entender. */}
              <div className="border-b border-amber-200/70 bg-stone-900 px-5 py-4">
                <Label className="!text-stone-400">{T("proposals.whatYouAuthorize")}</Label>
                <p className="mt-1.5 font-sans text-[15px] leading-relaxed text-white">{p.humanReadable}</p>
                <p className="mt-2 font-mono text-[10.5px] text-stone-500">{T("proposals.renderedByServer")}</p>
              </div>

              {/* O que ficou EM ABERTO.  Uma regra ausente não aparece numa
                  tabela de regras — e é justamente a ausência que alarga o
                  mandato sem o humano perceber.  Por isso vem antes da tabela. */}
              {(p.unconstrained ?? []).length > 0 && (
                <div className="border-b border-amber-200/70 bg-amber-50/60 px-5 py-3.5">
                  <Label>{T("proposals.notLimited")}</Label>
                  <p className="mt-1 font-sans text-[13px] leading-relaxed text-amber-900">
                    {T("proposals.notLimitedNote")}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {p.unconstrained.map((u) => (
                      <li key={u.attr} className="font-mono text-[12.5px] text-amber-900">
                        <span className="font-semibold">{u.attr}</span>
                        <span className="text-amber-700"> — {T("proposals.catalogHas")} {u.values.join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* A tabela: para conferir. */}
              <div className="overflow-x-auto bg-white/70">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stone-200/70 text-left">
                      <th className="px-5 py-2"><Label>{T("proposals.rule")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("proposals.limit")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("proposals.ifMissing")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("proposals.ifNotMatched")}</Label></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(p.draft.constraints ?? []).map((c, i) => (
                      <tr key={i} className="border-b border-stone-100 last:border-0">
                        <td className="whitespace-nowrap px-5 py-2 font-mono text-[12.5px] text-stone-700">
                          <span className="mr-2 text-stone-400">{String(i + 1).padStart(2, "0")}</span>
                          {c.attr}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12.5px] text-stone-600">
                          {c.op}{" "}
                          {c.attr === "price" ? money(c.value, p.draft.currency, locale) : String(c.value)}
                        </td>
                        <td className="px-3 py-2">
                          <Chip tone={POLICY_TONE[c.on_missing ?? "deny"]}>
                            {T(`policy.${c.on_missing ?? "deny"}`)}
                          </Chip>
                        </td>
                        <td className="px-3 py-2">
                          <Chip tone={POLICY_TONE[c.on_fail ?? "deny"]}>
                            {T(`policy.${c.on_fail ?? "deny"}`)}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-stone-200/70 px-5 py-3 sm:grid-cols-4">
                {[
                  [T("proposals.mode"), T(p.draft.mode === "aprovacao" ? "proposals.modeApproval" : "proposals.modeAutonomous")],
                  [T("proposals.uses"), String(p.draft.maxUses ?? 1)],
                  [T("proposals.validUntil"), new Date(p.draft.expiresAt).toISOString().slice(0, 10)],
                  [T("proposals.currency"), p.draft.currency],
                ].map(([k, v]) => (
                  <div key={k}>
                    <Label>{k}</Label>
                    <p className="mt-0.5 font-mono text-[12.5px] text-stone-800">{v}</p>
                  </div>
                ))}
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/70 px-5 py-3">
                <Mono value={p.proposalId} />
                <div className="flex gap-2">
                  <Button variant="refuse" onClick={discard(p)} disabled={busy === p.proposalId}>
                    {T("proposals.discard")}
                  </Button>
                  <Button variant="approve" onClick={authorize(p)} disabled={busy === p.proposalId}>
                    {busy === p.proposalId ? T("proposals.authorizing") : T("proposals.authorize")}
                  </Button>
                </div>
              </footer>
            </Panel>
          ))}

          <p className="font-mono text-[11.5px] text-stone-500">{T("proposals.footer")}</p>
        </div>
      )}
    </>
  );
}
