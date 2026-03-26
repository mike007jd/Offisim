/** Creator profile loading skeleton — matches profile header + listings grid. */
export default function CreatorLoading() {
  const skeletonCards = ['skeleton-1', 'skeleton-2', 'skeleton-3'];
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <div className="animate-pulse">
        {/* Profile header */}
        <div className="mb-8 space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-7 w-40 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-5 w-5 rounded-full bg-[var(--bg-tertiary)]" />
          </div>
          <div className="h-4 w-24 rounded bg-[var(--bg-tertiary)]" />
          <div className="h-4 w-64 rounded bg-[var(--bg-tertiary)]" />
        </div>

        {/* Listings section */}
        <div className="space-y-4">
          <div className="h-5 w-36 rounded bg-[var(--bg-tertiary)]" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {skeletonCards.map((card) => (
              <div key={card} className="h-40 rounded-lg bg-[var(--bg-tertiary)]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
