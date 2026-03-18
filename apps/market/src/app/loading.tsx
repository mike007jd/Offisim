/** Root loading skeleton — matches homepage layout (hero + listing grid). */
export default function Loading() {
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <div className="animate-pulse space-y-4">
        <div className="mb-12 space-y-2">
          <div className="h-8 w-64 rounded bg-[var(--bg-tertiary)]" />
          <div className="h-4 w-96 rounded bg-[var(--bg-tertiary)]" />
        </div>
        <div className="h-5 w-24 rounded bg-[var(--bg-tertiary)]" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-lg bg-[var(--bg-tertiary)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
