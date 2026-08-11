/**
 * What a page shows in the moment between a tap and the data arriving.
 *
 * Without a loading file, Next holds the old page on screen until the server
 * has finished rendering the new one — so tapping a menu item does nothing
 * visible for as long as the queries take, and the tap reads as ignored. People
 * then tap again, which is worse.
 *
 * This is deliberately the shape of the page rather than a spinner: the frame
 * and the header arrive immediately, and only the content is pending, so the
 * navigation reads as having already happened.
 */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <main className="min-h-screen bg-canvas p-2 pb-28 text-ink sm:p-3 lg:pb-3" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="mx-auto grid max-w-[1760px] gap-2 lg:grid-cols-[248px_minmax(0,1fr)]">
        <div className="hidden rounded-panel border border-line bg-sunken lg:block" />
        <div className="min-w-0 lg:px-4 lg:py-2">
          <div className="mb-5 mt-3 animate-pulse rounded-panel border border-line bg-surface p-5 lg:mt-4 lg:p-8">
            <div className="h-3 w-24 rounded-full bg-white/10" />
            <div className="mt-3 h-7 w-64 max-w-full rounded-full bg-white/10" />
            <div className="mt-3 h-3 w-80 max-w-full rounded-full bg-white/5" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: rows }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse rounded-panel border border-line bg-surface p-5"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <div className="h-4 w-40 rounded-full bg-white/10" />
                <div className="mt-3 h-3 w-full rounded-full bg-white/5" />
                <div className="mt-2 h-3 w-2/3 rounded-full bg-white/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
