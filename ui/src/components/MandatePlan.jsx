/**
 * O plano de mandato: as regras vigentes, e a Trusted Surface onde a humana
 * cria um mandato novo.
 *
 * A frase de "o que você está autorizando" vem do SERVIDOR, do mesmo
 * renderizador que grava o mandato.  Se a UI tivesse tradutor próprio, ela
 * poderia dizer "R$100" enquanto o mandato grava R$1000 — e a humana teria
 * consentido com uma frase que não é a regra.
 */

import { useEffect, useState } from "react";
import { api, money } from "../api.js";
import { t } from "../i18n.js";
import { Button, Chip, Field, Input, Label, Panel, PanelHead, ScreenHead, Select, Mono, Empty } from "./ui.jsx";

const STATUS_TONE = { active: "allow", revoked: "deny", expired: "mute", exhausted: "mute" };

const inOneMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

const POLICY_TONE = { deny: "deny", escalate: "wait", allow: "mute" };

export default function MandatePlan({ locale, mandates, methods, reload }) {
  const T = (k) => t(locale, k);
  const [form, setForm] = useState({
    category: "calcado",
    size: "40",
    maxPrice: "100.00",
    shipCountry: "BR",
    countryOnMissing: "deny",
    countryOnFail: "deny",
    mode: "autonomo",
    maxUses: 3,
    expiresAt: inOneMonth(),
    rail: "card",
  });
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  /** O rascunho no MESMO formato que o motor vai avaliar. */
  const draft = () => ({
    mode: form.mode,
    currency: "BRL",
    maxUses: Number(form.maxUses),
    expiresAt: new Date(`${form.expiresAt}T23:59:59Z`).toISOString(),
    constraints: [
      { attr: "category", op: "eq", value: form.category, on_missing: "deny", on_fail: "deny" },
      ...(form.size ? [{ attr: "size", op: "eq", value: form.size, on_missing: "deny", on_fail: "deny" }] : []),
      { attr: "price", op: "lte", value: Math.round(Number(form.maxPrice) * 100), on_missing: "deny", on_fail: "deny" },
      ...(form.shipCountry
        ? [{ attr: "ship_country", op: "eq", value: form.shipCountry, on_missing: form.countryOnMissing, on_fail: form.countryOnFail }]
        : []),
    ],
  });

  useEffect(() => {
    let alive = true;
    api
      .previewMandate(draft(), locale)
      .then((r) => alive && setPreview(r.humanReadable))
      .catch(() => alive && setPreview(""));
    return () => {
      alive = false;
    };
  }, [JSON.stringify(form), locale]);

  const create = async () => {
    setBusy(true);
    try {
      // O instrumento cru entra no cofre e vira uma referência opaca.
      const { paymentMethodRef } = await api.tokenize(
        form.rail,
        form.rail === "card" ? { number: "4242424242424242", exp: "12/29" } : { key: "marina@pix.com" },
        locale
      );
      await api.createMandate({ agentId: "agent_marina", paymentMethodRef, ...draft() }, locale);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHead title={T("plan.title")} note={T("plan.note")} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        {/* ---------------------------- mandatos ---------------------------- */}
        <div className="space-y-5">
          {mandates.length === 0 && (
            <Panel>
              <Empty>{T("plan.empty")}</Empty>
            </Panel>
          )}

          {mandates.map((m) => (
            <Panel key={m.mandateId} tone={m.status === "active" ? undefined : "mute"}>
              <PanelHead
                title={m.humanReadable}
                right={
                  <div className="flex items-center gap-2">
                    <Chip tone={STATUS_TONE[m.status]} dot>
                      {T(`status.${m.status}`)}
                    </Chip>
                    <Chip>{m.mode}</Chip>
                  </div>
                }
              />
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-3 sm:grid-cols-4">
                {[
                  [T("plan.uses"), `${m.usedCount} / ${m.maxUses}`],
                  [T("plan.currency"), m.currency],
                  [T("plan.validUntil"), new Date(m.expiresAt).toISOString().slice(0, 10)],
                  [T("plan.rules"), String(m.constraints?.length ?? 0)],
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
                      <th className="px-5 py-2"><Label>{T("plan.rule")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("plan.limit")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("plan.ifMissing")}</Label></th>
                      <th className="px-3 py-2"><Label>{T("plan.ifNotMatched")}</Label></th>
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

              <div className="border-t border-stone-200/70 px-5 py-2.5">
                <Mono value={m.mandateId} copy />
              </div>
            </Panel>
          ))}
        </div>

        {/* ------------------------- Trusted Surface ------------------------ */}
        <Panel className="h-fit xl:sticky xl:top-24">
          <PanelHead title={T("plan.newTitle")} note={T("plan.trustedNote")} />
          <div className="space-y-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={T("plan.category")}>
                <Select value={form.category} onChange={set("category")}>
                  {["calcado", "higiene", "software", "eletronico"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label={T("plan.size")}>
                <Input value={form.size} onChange={set("size")} placeholder="40" />
              </Field>
              <Field label={`${T("plan.maxPrice")} · BRL`}>
                <Input value={form.maxPrice} onChange={set("maxPrice")} inputMode="decimal" />
              </Field>
              <Field label={T("plan.shipsFrom")}>
                <Select value={form.shipCountry} onChange={set("shipCountry")}>
                  <option value="BR">BR</option>
                  <option value="CN">CN</option>
                  <option value="">—</option>
                </Select>
              </Field>
            </div>

            {form.shipCountry && (
              <div className="grid grid-cols-2 gap-3 rounded border border-stone-200 bg-stone-50 p-3">
                <Field label={T("plan.ifMissing")} hint={T("plan.ifMissingHint")}>
                  <Select value={form.countryOnMissing} onChange={set("countryOnMissing")}>
                    {["deny", "escalate", "allow"].map((v) => (
                      <option key={v} value={v}>{T(`policy.${v}`)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={T("plan.ifNotMatched")} hint={T("plan.ifNotMatchedHint")}>
                  <Select value={form.countryOnFail} onChange={set("countryOnFail")}>
                    {["deny", "escalate"].map((v) => (
                      <option key={v} value={v}>{T(`policy.${v}`)}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}

            <Field label={T("plan.mode")}>
              <Select value={form.mode} onChange={set("mode")}>
                <option value="autonomo">{T("plan.modeAutonomous")}</option>
                <option value="aprovacao">{T("plan.modeApproval")}</option>
              </Select>
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label={T("plan.uses")}>
                <Input type="number" min="1" value={form.maxUses} onChange={set("maxUses")} />
              </Field>
              <Field label={T("plan.validUntil")}>
                <Input type="date" value={form.expiresAt} onChange={set("expiresAt")} />
              </Field>
              <Field label={T("plan.rail")}>
                <Select value={form.rail} onChange={set("rail")}>
                  <option value="card">card</option>
                  <option value="pix">pix</option>
                </Select>
              </Field>
            </div>

            <div className="rounded border border-stone-800 bg-stone-900 px-4 py-3">
              <Label className="!text-stone-400">{T("plan.whatYouAuthorize")}</Label>
              <p className="mt-1.5 font-sans text-[13.5px] leading-relaxed text-white">{preview || "…"}</p>
              <p className="mt-2 font-mono text-[10.5px] text-stone-500">{T("plan.renderedByServer")}</p>
            </div>

            <Button onClick={create} disabled={busy} className="w-full">
              {busy ? T("plan.creating") : T("plan.create")}
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
