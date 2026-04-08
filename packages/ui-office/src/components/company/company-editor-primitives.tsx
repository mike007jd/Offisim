import { type ReactNode } from 'react';

export function SurfaceCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-slate-950/45 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
        {eyebrow}
      </p>
      <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
      {description ? <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400"
    >
      {children}
    </label>
  );
}

export function surfaceInputClassName(className = '') {
  return `h-11 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 text-sm text-white outline-none focus:border-cyan-300/40 ${className}`.trim();
}

export function surfaceTextareaClassName(className = '') {
  return `w-full rounded-[24px] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40 ${className}`.trim();
}
