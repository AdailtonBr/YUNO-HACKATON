/**
 * Duas telas irmãs:
 *
 *  - Mercado & ofertas: o catálogo das lojas no vocabulário comum, com a marca
 *    de quem cabe no mandato ativo.  A loja não registrada aparece atrás de um
 *    interruptor, com o melhor preço da tela — e é justamente ela que a
 *    Autoridade recusa na porta.
 *
 *  - Meios de pagamento: os instrumentos que o agente pode ACIONAR sem nunca
 *    ver.  O número cru entrou no cofre e não volta — nem para esta tela.
 */

import { useEffect, useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Chip, Label, Panel, PanelHead, ScreenHead, Empty, Mono, Metric } from "./ui.jsx";

/* ------------------------------ mercado ---------------------------- */

export function Market({ locale, mandate }) {
  const T = (k) => t(locale, k);
  const [q, setQ] = useState("");
  const [includeFake, setIncludeFake] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    api
      .catalogs(q, includeFake, locale)
      .then((d) => alive && setItems(d.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [q, includeFake, locale]);

  /**
   * Marca "cabe?" só para orientar o olho.  É a MESMA heurística do agente, e
   * como ele, não autoriza nada: quem decide continua sendo a Autoridade, na
   * hora da compra.  Um "cabe" aqui pode virar recusa lá, e está certo assim.
   */
  const fits = (i) =>
    !mandate
      ? null
      : (mandate.constraints ?? []).every((c) => {
          const real = c.attr === "price" ? i.price : i[c.attr];
          if (real === undefined) return c.on_missing === "allow";
          const ops = { eq: (a, b) => a === b, ne: (a, b) => a !== b, lte: (a, b) => a <= b, gte: (a, b) => a >= b, in: (a, b) => b.includes(a) };
          return ops[c.op]?.(real, c.value) ?? false;
        });

  const byStore = items.reduce((acc, i) => {
    (acc[i.merchantName] ??= []).push(i);
    return acc;
  }, {});

  return (
    <>
      <ScreenHead title={T("market.title")} note={T("market.note")} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={T("market.search")}
          className="w-64 rounded border border-stone-300 bg-white px-3 py-2 font-mono text-[13px] outline-none focus:border-stone-800"
        />
        <label className="flex items-center gap-2 font-mono text-[12px] text-stone-600">
          <input
            type="checkbox"
            checked={includeFake}
            onChange={(e) => setIncludeFake(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {T("market.includeUnregistered")}
        </label>
      </div>

      <div className="space-y-5">
        {Object.entries(byStore).map(([storeName, list]) => {
          const unregistered = list[0].merchantId === "store_fake";
          return (
            <Panel key={storeName} tone={unregistered ? "deny" : undefined}>
              <PanelHead
                title={storeName}
                note={unregistered ? T("market.unregisteredNote") : T("market.registeredNote")}
                right={
                  <Chip tone={unregistered ? "deny" : "allow"} dot>
                    {T(unregistered ? "market.unregistered" : "market.registered")}
                  </Chip>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stone-200/70 text-left">
                      <th className="px-5 py-2"><Label>{T("market.product")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("market.attributes")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("market.price")}</Label></th>
                      <th className="px-3 py-2 text-right"><Label>{T("market.fits")}</Label></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((i) => {
                      const ok = fits(i);
                      return (
                        <tr key={i.productId} className="border-b border-stone-100 last:border-0">
                          <td className="px-5 py-2.5">
                            <span className="font-sans text-[13.5px] text-stone-800">{i.name}</span>
                            <span className="ml-2 font-mono text-[11px] text-stone-400">{i.productId}</span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[12px] text-stone-500">
                            {[i.category, i.size && `size ${i.size}`, i.ship_country, i.color]
                              .filter(Boolean)
                              .join(" · ")}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] tabular-nums text-stone-900">
                            {money(i.price, i.currency, locale)}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {ok === null ? (
                              <span className="font-mono text-[11px] text-stone-300">—</span>
                            ) : (
                              <Chip tone={ok ? "allow" : "mute"}>{T(ok ? "market.yes" : "market.no")}</Chip>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          );
        })}
        {items.length === 0 && (
          <Panel>
            <Empty>{T("market.empty")}</Empty>
          </Panel>
        )}
      </div>

      <p className="mt-3 font-mono text-[11.5px] text-stone-500">{T("market.footer")}</p>
    </>
  );
}

/* -------------------------- meios de pagamento --------------------- */

export function PaymentMethods({ locale, methods }) {
  const T = (k) => t(locale, k);

  return (
    <>
      <ScreenHead title={T("payment.title")} note={T("payment.note")} />

      <Panel className="mb-5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Label>{T("payment.reversibilityRule")}</Label>
          <span className="flex items-center gap-2">
            <Chip tone="allow">{T("payment.reversible")}</Chip>
            <span className="font-mono text-[12px] text-stone-600">{T("payment.reversibleNote")}</span>
          </span>
          <span className="flex items-center gap-2">
            <Chip tone="deny">{T("payment.irreversible")}</Chip>
            <span className="font-mono text-[12px] text-stone-600">{T("payment.irreversibleNote")}</span>
          </span>
        </div>
      </Panel>

      {methods.length === 0 ? (
        <Panel>
          <Empty>{T("payment.empty")}</Empty>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {methods.map((m) => (
            <Panel key={m.paymentMethodRef} tone={m.reversible ? "allow" : "wait"} className="overflow-hidden">
              <header className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <Label>{m.rail === "card" ? T("payment.virtualCard") : T("payment.pixKey")}</Label>
                  <p className="mt-0.5 font-mono text-[15px] text-stone-900">{m.label}</p>
                </div>
                <Chip tone={m.reversible ? "allow" : "deny"}>
                  {T(m.reversible ? "payment.reversible" : "payment.irreversible")}
                </Chip>
              </header>

              <div className="grid grid-cols-2 divide-x divide-stone-200/70 border-y border-stone-200/70 bg-white/70">
                <Metric label={T("payment.usedBy")} value={String(m.usedBy.length)} sub={T("payment.mandates")} />
                <Metric
                  label={T("payment.agentSees")}
                  value={T("payment.never")}
                  sub={T("payment.onlyAuthorityCharges")}
                />
              </div>

              <div className="px-4 py-2.5">
                <Mono value={m.paymentMethodRef} copy />
                {m.usedBy.map((u) => (
                  <p key={u.mandateId} className="mt-1.5 font-mono text-[11.5px] text-stone-500">
                    {u.status} · {u.humanReadable?.slice(0, 60)}…
                  </p>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <p className="mt-3 font-mono text-[11.5px] text-stone-500">{T("payment.footer")}</p>
    </>
  );
}
