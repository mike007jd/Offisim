import type { ReactNode } from 'react';

export function SurfaceCard({
  title,
  description,
  icon,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const compact = !description && !icon;
  return (
    <section
      className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-xl ${className}`}
    >
      <div className={`flex items-start justify-between gap-3 ${compact ? 'mb-3' : 'mb-4'}`}>
        <div>
          <p
            className={
              compact
                ? 'text-sm font-semibold text-slate-200'
                : 'text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400'
            }
          >
            {title}
          </p>
          {description ? <p className="mt-2 text-sm text-slate-300">{description}</p> : null}
        </div>
        {icon ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-100">
            {icon}
          </div>
        ) : null}
      </div>
      {children}
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

export function SectionLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400"
    >
      {children}
    </label>
  );
}

export function surfaceInputProps(className = '') {
  return `h-11 rounded-2xl border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-400/40 ${className}`;
}
