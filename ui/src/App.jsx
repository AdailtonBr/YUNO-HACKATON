import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { t } from "./i18n.js";
import Shell from "./components/Shell.jsx";
import RevokeDialog from "./components/RevokeDialog.jsx";
import AgentChat from "./components/AgentChat.jsx";
import Proposals from "./components/Proposals.jsx";
import ApprovalQueue from "./components/ApprovalQueue.jsx";
import Mandates from "./components/Mandates.jsx";
import AuditTrail from "./components/AuditTrail.jsx";
import Wallet from "./components/Wallet.jsx";

// Acompanha o vigia, que bate a cada 5s.  Não precisa ser mais rápido que ele.
const POLL_MS = 5000;

export default function App() {
  const [locale, setLocale] = useState("en"); // inglês é o idioma de entrega
  const [tab, setTab] = useState("chat");
  const [mandates, setMandates] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [trail, setTrail] = useState([]);
  const [methods, setMethods] = useState([]);
  // A conversa vive AQUI, não dentro do AgentChat: trocar de aba desmonta a
  // tela, e com o estado lá dentro a conversa ia junto.  Sobe um nível e ela
  // sobrevive à navegação.  (Um reload ainda a perde — o histórico que o
  // agente usa também vive em memória no servidor, então persistir só a
  // metade visível criaria uma conversa que você lê e ele não lembra.)
  const [chatLog, setChatLog] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [revoking, setRevoking] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [m, pr, a, tr, pm, ad] = await Promise.all([
        api.mandates(locale),
        api.proposals(locale),
        api.approvals(locale),
        api.audit(null, locale),
        api.methods(locale),
        api.addresses(locale),
      ]);
      setMandates(m);
      setProposals(pr);
      setApprovals(a);
      setMethods(pm);
      setAddresses(ad);
      setTrail(tr); // já vem do servidor com o mais recente primeiro
      setErr(null);
    } catch {
      setErr(t(locale, "errors.authorityDown"));
    }
  }, [locale]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * A tela acompanha o vigia.
   *
   * Desde que existe um ator agindo em segundo plano, uma interface estática
   * mente por omissão: você aprova uma compra, o vigia a conclui seis segundos
   * depois, e a tela segue mostrando o mandato como ativo até você mexer em
   * alguma coisa.  Foi exatamente assim que "aprovei e não encerrou" apareceu.
   *
   * Só quando a aba está visível — atualizar uma janela que ninguém olha é
   * gastar rede à toa.  E um `reload` já em voo não é atropelado por outro.
   */
  const busyRef = useRef(false);
  useEffect(() => {
    const tick = async () => {
      if (document.hidden || busyRef.current) return;
      busyRef.current = true;
      try {
        await reload();
      } finally {
        busyRef.current = false;
      }
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  /**
   * O mandato em foco.
   *
   * A escolha EXPLÍCITA vence, mesmo se o mandato já morreu: você acabou de
   * revogar e quer ver o agente tentar assim mesmo e ser recusado — tirá-lo da
   * frente esconderia justamente a cena que importa.
   *
   * Mas a escolha AUTOMÁTICA só recai sobre um mandato vivo.  Antes o fallback
   * era `mandates[0]`, então um mandato já cumprido continuava no topo como se
   * ainda valesse.  Cumprido é `exhausted`, e esgotado não é oferecido.
   */
  const usable = mandates.filter((m) => m.status === "active");
  const focused =
    mandates.find((m) => m.mandateId === selectedId) ?? usable[0] ?? null;

  // Compras que o vigia fez sozinho: a `idempotencyKey` com prefixo `watch:` é
  // o que as distingue das compras feitas na conversa.  Sem endpoint novo — o
  // trilho já veio carregado.
  const DAY = 24 * 60 * 60 * 1000;
  const whileAway = trail.filter(
    (e) =>
      e.event === "purchase_decision" &&
      e.decision === "valido" &&
      e.idempotencyKey?.startsWith("watch:") &&
      Date.now() - new Date(e.ts).getTime() < DAY
  );

  return (
    <>
      <Shell
        locale={locale}
        setLocale={setLocale}
        tab={tab}
        setTab={setTab}
        mandate={focused}
        mandates={mandates}
        usable={usable}
        onSelectMandate={setSelectedId}
        counts={{ proposals: proposals.length, approvals: approvals.length }}
        onRevoke={() => focused && setRevoking(focused)}
      >
        {err && (
          <div className="mb-5 rounded border border-red-200 bg-red-50 px-4 py-3 font-mono text-[12.5px] text-red-700">
            {err}
          </div>
        )}

        {tab === "chat" && (
          <AgentChat
            locale={locale}
            mandate={focused}
            whileAway={whileAway}
            log={chatLog}
            setLog={setChatLog}
            reload={reload}
            goToProposals={() => setTab("proposals")}
          />
        )}
        {tab === "proposals" && (
          <Proposals
            locale={locale}
            proposals={proposals}
            methods={methods}
            addresses={addresses}
            reload={reload}
          />
        )}
        {tab === "wallet" && (
          <Wallet locale={locale} methods={methods} addresses={addresses} reload={reload} />
        )}
        {tab === "approvals" && <ApprovalQueue locale={locale} approvals={approvals} reload={reload} />}
        {tab === "mandates" && (
          <Mandates
            locale={locale}
            mandates={mandates}
            selectedId={focused?.mandateId}
            onSelect={(id) => {
              setSelectedId(id);
              setTab("chat");
            }}
            onRevoke={setRevoking}
          />
        )}
        {tab === "audit" && <AuditTrail locale={locale} trail={trail} />}
      </Shell>

      {revoking && (
        <RevokeDialog
          locale={locale}
          mandate={revoking}
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await api.revoke(revoking.mandateId, locale);
            // Fica selecionado de propósito: a próxima tentativa do agente tem
            // que ser sob ESTE mandato, para a recusa da Autoridade aparecer.
            setSelectedId(revoking.mandateId);
            await reload();
          }}
        />
      )}
    </>
  );
}
