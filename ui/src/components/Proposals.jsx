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
import { api, money, isMoneyAttr } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Label, Panel, PanelHead, ScreenHead, Empty, Mono } from "./ui.jsx";

const POLICY_TONE = { deny: "deny", escalate: "wait", allow: "mute" };

export default function Proposals({ locale, proposals, methods = [], addresses = [], reload }) {
  const T = (k) => t(locale, k);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState({});

  const methodLabel = (id) => methods.find((m) => m.methodId === id)?.label;
  const addressLabel = (id) => addresses.find((a) => a.addressId === id)?.label;

  /**
   * Uma proposta que não dá para autorizar.
   *
   * O agente pode ter apontado para um método ou endereço que não existe na
   * carteira (ele chegou a inventar `addressId: "new"` quando o endereço foi
   * ditado no chat em vez de cadastrado).  A Autoridade recusa, e o botão
   * parecia não fazer nada.  Melhor não deixar clicar, e dizer por quê.
   */
  const blocker = (p) => {
    if (!methodLabel(p.draft.paymentMethodId)) return T("proposals.blockedMethod");
    if (p.delivery?.required && !addressLabel(p.delivery.addressId)) return T("proposals.blockedAddress");
    return null;
  };

  const authorize = (p) => async () => {
    setBusy(p.proposalId);
    setError((e) => ({ ...e, [p.proposalId]: null }));
    try {
      // Manda os IDs que você cadastrou na carteira.  A Autoridade traduz para
      // o `paymentMethodRef` do lado dela — o ponteiro nunca passa por aqui.
      await api.createMandate(
        {
          agentId: p.agentId,
          proposalId: p.proposalId,
          ...p.draft,
          shippingAddressId: p.delivery?.addressId ?? null,
        },
        locale
      );
      await reload();
    } catch (e) {
      // Sem isto o erro sumia: a promessa falhava, o `finally` limpava o busy,
      // e a tela ficava exatamente como estava.  Um botão que falha calado é
      // pior que um botão quebrado, porque ninguém sabe procurar o problema.
      setError((prev) => ({ ...prev, [p.proposalId]: e.data?.error ?? e.message }));
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

              {/* O que o agente NÃO perguntou.  Ele caiu no default seguro, mas
                  "seguro" não é "combinado" — você não escolheu isso. */}
              {(p.assumed ?? []).length > 0 && (
                <div className="border-b border-amber-200/70 bg-amber-50/60 px-5 py-3">
                  <Label>{T("proposals.assumed")}</Label>
                  <p className="mt-1 font-sans text-[13px] leading-relaxed text-amber-900">
                    {T("proposals.assumedNote")}{" "}
                    {p.assumed.map((a) => T(`proposals.assumed_${a}`)).join(" · ")}
                  </p>
                </div>
              )}

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

              {/* Como paga e para onde vai: o julgamento de entrega é do modelo,
                  então aparece aqui para o humano conferir ANTES de autorizar. */}
              <div className="grid gap-4 border-b border-amber-200/70 bg-white/70 px-5 py-3 sm:grid-cols-3">
                {/* O MODO fica aqui, não escondido entre as métricas pequenas:
                    "compra dormindo" e "me pergunta antes" é a diferença mais
                    consequente da proposta, e a que o agente mais esquece de
                    perguntar. Se ele decidiu sozinho, é aqui que você pega. */}
                <div>
                  <Label>{T("proposals.mode")}</Label>
                  <p
                    className={`mt-0.5 font-mono text-[13px] ${
                      p.draft.mode === "aprovacao" ? "text-emerald-800" : "text-amber-900"
                    }`}
                  >
                    {T(p.draft.mode === "aprovacao" ? "proposals.modeApproval" : "proposals.modeAutonomous")}
                  </p>
                </div>
                <div>
                  <Label>{T("proposals.paysWith")}</Label>
                  <p className="mt-0.5 font-mono text-[13px] text-stone-800">
                    {methodLabel(p.draft.paymentMethodId) ?? T("proposals.noMethod")}
                  </p>
                </div>
                <div>
                  <Label>{T("proposals.delivery")}</Label>
                  <p className="mt-0.5 font-mono text-[13px] text-stone-800">
                    {p.delivery?.required
                      ? addressLabel(p.delivery.addressId) ?? T("proposals.noAddress")
                      : T("proposals.noDeliveryNeeded")}
                  </p>
                  {p.delivery?.note && (
                    <p className="mt-0.5 font-mono text-[11px] text-stone-400">{p.delivery.note}</p>
                  )}
                </div>
              </div>

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
                          {isMoneyAttr(c.attr) ? money(c.value, p.draft.currency, locale) : String(c.value)}
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

              {(blocker(p) || error[p.proposalId]) && (
                <div className="border-t border-red-200 bg-red-50 px-5 py-3">
                  <Label>{T("proposals.cannotAuthorize")}</Label>
                  <p className="mt-1 font-sans text-[13px] leading-relaxed text-red-800">
                    {blocker(p) ?? error[p.proposalId]}
                  </p>
                </div>
              )}

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/70 px-5 py-3">
                <Mono value={p.proposalId} />
                <div className="flex gap-2">
                  <Button variant="refuse" onClick={discard(p)} disabled={busy === p.proposalId}>
                    {T("proposals.discard")}
                  </Button>
                  <Button
                    variant="approve"
                    onClick={authorize(p)}
                    disabled={busy === p.proposalId || !!blocker(p)}
                  >
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
