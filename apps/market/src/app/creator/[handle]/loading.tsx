/** Creator profile loading skeleton — matches profile header + listings grid. */
export default function CreatorLoading() {
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <div className="animate-pulse">
        {/* Profile header */}
        <div className="mb-8 space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-7 w-40 rounded bg-gray-200" />
            <div className="h-5 w-5 rounded-full bg-gray-200" />
          </div>
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-4 w-64 rounded bg-gray-200" />
        </div>

        {/* Listings section */}
        <div className="space-y-4">
          <div className="h-5 w-36 rounded bg-gray-200" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 rounded-lg bg-gray-200" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
