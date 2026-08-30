/**
 * A carteira: meios de pagamento e endereços de entrega.
 *
 * Faz parte da Trusted Surface, e pela mesma razão dela: o instrumento cru
 * entra **aqui**, com o humano presente, e não volta.  Esta tela lista
 * rótulos — `•••• 4242`, `Casa` — nunca o número nem a rua.
 *
 * O agente enxerga exatamente o que esta tela mostra: que existe um método
 * chamado `•••• 4242` e um endereço chamado `Casa`.  Ele não sabe o número, não
 * sabe onde é Casa, e não conhece o `paymentMethodRef` — a tradução de id para
 * ponteiro acontece dentro da Autoridade, no instante em que você autoriza.
 */

import { useState } from "react";
import { api } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Field, Input, Label, Panel, PanelHead, ScreenHead, Select, Empty, Mono } from "./ui.jsx";

export default function Wallet({ locale, methods, addresses, reload }) {
  const T = (k) => t(locale, k);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState({ rail: "card", number: "4242424242424242", key: "michael@pix.com" });
  const [addr, setAddr] = useState({ label: "", address: "" });

  const addMethod = async () => {
    setBusy(true);
    try {
      await api.addMethod(
        card.rail,
        card.rail === "card" ? { number: card.number, exp: "12/29" } : { key: card.key },
        locale
      );
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const addAddress = async () => {
    if (!addr.label.trim() || !addr.address.trim()) return;
    setBusy(true);
    try {
      await api.addAddress(addr.label, addr.address, locale);
      setAddr({ label: "", address: "" });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = (fn, id) => async () => {
    setBusy(true);
    try {
      await fn(id, locale);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHead title={T("wallet.title")} note={T("wallet.note")} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------- pagamento ------------------------- */}
        <Panel>
          <PanelHead title={T("wallet.methods")} note={T("wallet.methodsNote")} />

          {methods.length === 0 ? (
            <Empty>{T("wallet.noMethods")}</Empty>
          ) : (
            <ul className="divide-y divide-stone-100">
              {methods.map((m) => (
                <li key={m.methodId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Chip tone={m.rail === "card" ? "allow" : "wait"}>{m.rail}</Chip>
                      <span className="font-mono text-[14px] text-stone-900">{m.label}</span>
                    </div>
                    <p className="mt-1">
                      <Mono value={m.methodId} />
                    </p>
                  </div>
                  <Button variant="refuse" onClick={remove(api.removeMethod, m.methodId)} disabled={busy}>
                    {T("wallet.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t border-stone-200/70 px-5 py-4">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
              <Field label={T("wallet.rail")}>
                <Select value={card.rail} onChange={(e) => setCard({ ...card, rail: e.target.value })}>
                  <option value="card">card</option>
                  <option value="pix">pix</option>
                </Select>
              </Field>
              {card.rail === "card" ? (
                <Field label={T("wallet.cardNumber")} hint={T("wallet.rawHint")}>
                  <Input value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} />
                </Field>
              ) : (
                <Field label={T("wallet.pixKey")} hint={T("wallet.rawHint")}>
                  <Input value={card.key} onChange={(e) => setCard({ ...card, key: e.target.value })} />
                </Field>
              )}
            </div>
            <Button onClick={addMethod} disabled={busy} className="w-full">
              {T("wallet.addMethod")}
            </Button>
          </div>
        </Panel>

        {/* -------------------------- endereços ------------------------ */}
        <Panel>
          <PanelHead title={T("wallet.addresses")} note={T("wallet.addressesNote")} />

          {addresses.length === 0 ? (
            <Empty>{T("wallet.noAddresses")}</Empty>
          ) : (
            <ul className="divide-y divide-stone-100">
              {addresses.map((a) => (
                <li key={a.addressId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <span className="font-sans text-[14px] font-semibold text-stone-900">{a.label}</span>
                    <p className="mt-1">
                      <Mono value={a.addressId} />
                    </p>
                  </div>
                  <Button variant="refuse" onClick={remove(api.removeAddress, a.addressId)} disabled={busy}>
                    {T("wallet.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t border-stone-200/70 px-5 py-4">
            <Field label={T("wallet.addressLabel")} hint={T("wallet.addressLabelHint")}>
              <Input
                value={addr.label}
                onChange={(e) => setAddr({ ...addr, label: e.target.value })}
                placeholder="Home"
              />
            </Field>
            <Field label={T("wallet.address")} hint={T("wallet.rawHint")}>
              <Input
                value={addr.address}
                onChange={(e) => setAddr({ ...addr, address: e.target.value })}
                placeholder="Rua …, 123 — São Paulo"
              />
            </Field>
            <Button onClick={addAddress} disabled={busy} className="w-full">
              {T("wallet.addAddress")}
            </Button>
          </div>
        </Panel>
      </div>

      <p className="mt-4 font-mono text-[11.5px] text-stone-500">{T("wallet.footer")}</p>
    </>
  );
}
