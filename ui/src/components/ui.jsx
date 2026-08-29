/**
 * Primitivas visuais.  Sem lógica de domínio.
 *
 * A regra que atravessa todas: valor medido ou decidido pelo sistema aparece em
 * mono; texto dirigido à humana aparece em sans.  Se está em mono, dá para
 * conferir contra o mandato.
 */

/* --------------------------- semântica ----------------------------- */

export const TONE = {
  allow: {
    chip: "bg-[--color-allow-bg] text-[--color-allow-ink] border-[--color-allow-line]",
    panel: "bg-[--color-allow-bg] border-[--color-allow-line]",
    dot: "bg-emerald-600",
  },
  deny: {
    chip: "bg-[--color-deny-bg] text-[--color-deny-ink] border-[--color-deny-line]",
    panel: "bg-[--color-deny-bg] border-[--color-deny-line]",
    dot: "bg-red-600",
  },
  wait: {
    chip: "bg-[--color-wait-bg] text-[--color-wait-ink] border-[--color-wait-line]",
    panel: "bg-[--color-wait-bg] border-[--color-wait-line]",
    dot: "bg-amber-500",
  },
  mute: {
    chip: "bg-stone-100 text-stone-600 border-stone-200",
    panel: "bg-stone-50 border-stone-200",
    dot: "bg-stone-400",
  },
};

/** Etiqueta técnica em caixa alta — o rótulo padrão da interface. */
export const Label = ({ children, className = "" }) => (
  <span className={`label-tech ${className}`}>{children}</span>
);

/** Chip de estado. `dot` acende o ponto colorido à esquerda. */
export const Chip = ({ tone = "mute", dot = false, children, className = "" }) => (
  <span
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.06em] ${TONE[tone].chip} ${className}`}
  >
    {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} />}
    {children}
  </span>
);

/* ----------------------------- estrutura --------------------------- */

export const Panel = ({ tone, className = "", children }) => (
  <section
    className={`rounded-lg border ${tone ? TONE[tone].panel : "border-stone-200 bg-white"} ${className}`}
  >
    {children}
  </section>
);

export const PanelHead = ({ title, note, right }) => (
  <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200/70 px-5 py-3.5">
    <div className="min-w-0">
      <h2 className="font-sans text-sm font-semibold tracking-tight text-stone-900">{title}</h2>
      {note && <p className="mt-1 font-mono text-[12px] leading-relaxed text-stone-500">{note}</p>}
    </div>
    {right}
  </header>
);

/** Cabeçalho de tela: título em sans, linha de contexto em mono. */
export const ScreenHead = ({ title, note, right }) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 className="font-sans text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
      {note && <p className="mt-1 font-mono text-[12.5px] leading-relaxed text-stone-500">{note}</p>}
    </div>
    {right}
  </div>
);

export const Empty = ({ children }) => (
  <p className="px-5 py-10 text-center font-mono text-[12.5px] text-stone-400">{children}</p>
);

/* ----------------------------- controles --------------------------- */

const CONTROL =
  "w-full rounded border border-stone-300 bg-white px-2.5 py-2 font-mono text-[13px] text-stone-900 " +
  "outline-none transition focus:border-stone-800 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-50";

export const Input = (p) => <input {...p} className={`${CONTROL} ${p.className ?? ""}`} />;
export const Select = ({ children, className = "", ...p }) => (
  <select {...p} className={`${CONTROL} ${className}`}>
    {children}
  </select>
);

export const Field = ({ label, children, hint }) => (
  <label className="block">
    <Label className="mb-1.5 block">{label}</Label>
    {children}
    {hint && <span className="mt-1 block font-mono text-[11px] text-stone-400">{hint}</span>}
  </label>
);

const BUTTON = {
  primary: "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-stone-300",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-stone-300",
  approve: "bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-stone-300",
  refuse: "border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-40",
  ghost: "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-40",
};

export const Button = ({ variant = "primary", className = "", ...p }) => (
  <button
    {...p}
    className={`rounded px-3.5 py-2 font-sans text-[13px] font-semibold transition disabled:cursor-not-allowed ${BUTTON[variant]} ${className}`}
  />
);

/* ------------------------------ dados ------------------------------ */

/** Célula de métrica: rótulo técnico em cima, valor grande em mono embaixo. */
export const Metric = ({ label, value, tone, sub }) => (
  <div className="min-w-0 px-4 py-3">
    <Label>{label}</Label>
    <p
      className={`mt-1 truncate font-mono text-[15px] font-medium ${
        tone === "deny" ? "text-red-700" : tone === "allow" ? "text-emerald-700" : "text-stone-900"
      }`}
    >
      {value}
    </p>
    {sub && <p className="mt-0.5 truncate font-mono text-[11px] text-stone-400">{sub}</p>}
  </div>
);

export const Meter = ({ value, max, tone = "allow" }) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
      <div
        className={`h-full rounded-full ${tone === "wait" ? "bg-amber-500" : "bg-teal-700"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

/** Id/hash truncado com botão de copiar — some quando não há o que copiar. */
export function Mono({ value, copy = false, className = "" }) {
  if (!value) return <span className="font-mono text-[11px] text-stone-300">—</span>;
  const short = value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="font-mono text-[11px] text-stone-500" title={value}>
        {short}
      </span>
      {copy && (
        <button
          onClick={() => navigator.clipboard?.writeText(value)}
          className="label-tech rounded border border-stone-200 px-1.5 py-0.5 transition hover:bg-stone-50"
        >
          copy
        </button>
      )}
    </span>
  );
}
