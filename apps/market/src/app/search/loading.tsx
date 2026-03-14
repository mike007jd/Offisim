/** Search page loading skeleton — matches search bar + filters + results grid. */
export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <div className="animate-pulse space-y-6">
        {/* Search bar */}
        <div className="flex gap-2">
          <div className="h-10 flex-1 rounded-md bg-gray-200" />
          <div className="h-10 w-20 rounded-md bg-gray-200" />
        </div>

        {/* Filters + count */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <div className="h-8 w-20 rounded bg-gray-200" />
            <div className="h-8 w-20 rounded bg-gray-200" />
          </div>
          <div className="h-4 w-16 rounded bg-gray-200" />
        </div>

        {/* Results grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-lg bg-gray-200" />
          ))}
        </div>
      </div>
    </div>
  );
}
