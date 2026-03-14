/** Listing detail loading skeleton — matches header + install bar + description + sidebar. */
export default function ListingLoading() {
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <div className="animate-pulse">
        {/* Header */}
        <div className="mb-8 space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded bg-gray-200" />
            <div className="h-7 w-48 rounded bg-gray-200" />
            <div className="h-5 w-16 rounded bg-gray-200" />
          </div>
          <div className="flex items-center gap-4">
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="h-4 w-20 rounded bg-gray-200" />
            <div className="h-4 w-16 rounded bg-gray-200" />
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main content */}
          <div className="space-y-8 lg:col-span-2">
            {/* Install bar */}
            <div className="h-16 rounded-lg bg-gray-200" />
            {/* Description */}
            <div className="space-y-2">
              <div className="h-5 w-28 rounded bg-gray-200" />
              <div className="h-4 w-full rounded bg-gray-200" />
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="h-4 w-5/6 rounded bg-gray-200" />
            </div>
            {/* Versions */}
            <div className="space-y-2">
              <div className="h-5 w-20 rounded bg-gray-200" />
              <div className="h-24 rounded bg-gray-200" />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="h-32 rounded-lg bg-gray-200" />
            <div className="h-20 rounded-lg bg-gray-200" />
          </div>
        </div>
      </div>
    </div>
  );
}
