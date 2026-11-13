// Shown inside the admin shell the moment a link is clicked, while the next page loads.
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-brand-soft ${className}`} />;
}

export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <Bar className="h-8 w-48" />
        <Bar className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-line/80 bg-surface p-5">
            <Bar className="mb-3 h-3 w-20" />
            <Bar className="h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-line/80 bg-surface p-5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line/60 py-3 last:border-0">
            <Bar className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-1/2" />
            </div>
            <Bar className="hidden h-6 w-20 sm:block" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
