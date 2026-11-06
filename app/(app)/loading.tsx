// Shown straight away when moving between screens, while the server fetches the plan.
export default function Loading() {
  const block = "motion-safe:animate-pulse rounded-2xl bg-neutral-200/70";
  return (
    <div role="status" aria-label="Loading" data-testid="page-loading">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="space-y-6">
        <div className="space-y-2">
          <div className={`${block} h-7 w-48`} />
          <div className={`${block} h-4 w-full max-w-md`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={`${block} h-28`} />
          <div className={`${block} h-28`} />
          <div className={`${block} h-28`} />
        </div>
        <div className={`${block} h-72`} />
      </div>
    </div>
  );
}
