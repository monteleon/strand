// Per-route loading skeleton — Next 14 streams this in immediately while
// /graph's server component (assembleNetworkGraph) runs its SQL. Without
// this file the user sees a blank screen for ~5s after clicking a nav link.

export default function GraphLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3 text-text-tertiary">
        <div className="h-2 w-32 animate-pulse rounded-full bg-overlay" />
        <p className="font-mono text-[11px] uppercase tracking-wide">
          Assembling network…
        </p>
      </div>
    </div>
  );
}
