import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { t } from "./i18n.js";
import Shell from "./components/Shell.jsx";
import RevokeDialog from "./components/RevokeDialog.jsx";
import AgentChat from "./components/AgentChat.jsx";
import MandatePlan from "./components/MandatePlan.jsx";
import ApprovalQueue from "./components/ApprovalQueue.jsx";
import AuditTrail from "./components/AuditTrail.jsx";
import { Market, PaymentMethods } from "./components/MarketAndPayments.jsx";

export default function App() {
  const [locale, setLocale] = useState("en"); // inglês é o idioma de entrega
  const [tab, setTab] = useState("chat");
  const [mandates, setMandates] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [trail, setTrail] = useState([]);
  const [methods, setMethods] = useState([]);
  const [revoking, setRevoking] = useState(false);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [m, a, tr, pm] = await Promise.all([
        api.mandates(locale),
        api.approvals(locale),
        api.audit(null, locale),
        api.methods(locale),
      ]);
      setMandates(m);
      setApprovals(a);
      setTrail(tr.slice().reverse()); // mais recente primeiro
      setMethods(pm);
      setErr(null);
    } catch {
      setErr(t(locale, "errors.authorityDown"));
    }
  }, [locale]);

  useEffect(() => {
    reload();
  }, [reload]);

  // O mandato "em foco" da barra superior: o ativo mais recente, senão o último.
  const focused = mandates.find((m) => m.status === "active") ?? mandates[0] ?? null;

  return (
    <>
      <Shell
        locale={locale}
        setLocale={setLocale}
        tab={tab}
        setTab={setTab}
        mandate={focused}
        approvalsCount={approvals.length}
        onRevoke={() => setRevoking(true)}
      >
        {err && (
          <div className="mb-5 rounded border border-red-200 bg-red-50 px-4 py-3 font-mono text-[12.5px] text-red-700">
            {err}
          </div>
        )}

        {tab === "chat" && <AgentChat locale={locale} mandate={focused} reload={reload} />}
        {tab === "market" && <Market locale={locale} mandate={focused} />}
        {tab === "approvals" && <ApprovalQueue locale={locale} approvals={approvals} reload={reload} />}
        {tab === "plan" && (
          <MandatePlan locale={locale} mandates={mandates} methods={methods} reload={reload} />
        )}
        {tab === "audit" && <AuditTrail locale={locale} trail={trail} />}
        {tab === "payment" && <PaymentMethods locale={locale} methods={methods} />}
      </Shell>

      {revoking && (
        <RevokeDialog
          locale={locale}
          mandate={focused}
          onClose={() => setRevoking(false)}
          onConfirm={async () => {
            await api.revoke(focused.mandateId, locale);
            await reload();
          }}
        />
      )}
    </>
  );
}
