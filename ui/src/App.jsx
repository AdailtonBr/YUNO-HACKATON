import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { t } from "./i18n.js";
import Shell from "./components/Shell.jsx";
import RevokeDialog from "./components/RevokeDialog.jsx";
import AgentChat from "./components/AgentChat.jsx";
import Proposals from "./components/Proposals.jsx";
import ApprovalQueue from "./components/ApprovalQueue.jsx";
import Mandates from "./components/Mandates.jsx";
import AuditTrail from "./components/AuditTrail.jsx";

export default function App() {
  const [locale, setLocale] = useState("en"); // inglês é o idioma de entrega
  const [tab, setTab] = useState("chat");
  const [mandates, setMandates] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [trail, setTrail] = useState([]);
  const [revoking, setRevoking] = useState(null);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [m, pr, a, tr] = await Promise.all([
        api.mandates(locale),
        api.proposals(locale),
        api.approvals(locale),
        api.audit(null, locale),
      ]);
      setMandates(m);
      setProposals(pr);
      setApprovals(a);
      setTrail(tr.slice().reverse()); // mais recente primeiro
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
        counts={{ proposals: proposals.length, approvals: approvals.length }}
        onRevoke={() => focused && setRevoking(focused)}
      >
        {err && (
          <div className="mb-5 rounded border border-red-200 bg-red-50 px-4 py-3 font-mono text-[12.5px] text-red-700">
            {err}
          </div>
        )}

        {tab === "chat" && (
          <AgentChat locale={locale} mandate={focused} reload={reload} goToProposals={() => setTab("proposals")} />
        )}
        {tab === "proposals" && <Proposals locale={locale} proposals={proposals} reload={reload} />}
        {tab === "approvals" && <ApprovalQueue locale={locale} approvals={approvals} reload={reload} />}
        {tab === "mandates" && <Mandates locale={locale} mandates={mandates} reload={reload} onRevoke={setRevoking} />}
        {tab === "audit" && <AuditTrail locale={locale} trail={trail} />}
      </Shell>

      {revoking && (
        <RevokeDialog
          locale={locale}
          mandate={revoking}
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await api.revoke(revoking.mandateId, locale);
            await reload();
          }}
        />
      )}
    </>
  );
}
