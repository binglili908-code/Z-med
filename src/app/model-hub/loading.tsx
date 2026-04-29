function SkeletonCard() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex gap-2">
            <div className="h-6 w-20 rounded-md bg-slate-100" />
            <div className="h-6 w-16 rounded-md bg-slate-100" />
          </div>
          <div className="mt-4 h-6 w-2/3 rounded-md bg-slate-100" />
        </div>
        <div className="h-14 w-16 rounded-lg bg-slate-100" />
      </div>
      <div className="mt-4 h-4 w-full rounded bg-slate-100" />
      <div className="mt-2 h-4 w-5/6 rounded bg-slate-100" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        <div className="h-10 rounded-lg bg-slate-100" />
        <div className="h-10 rounded-lg bg-slate-100" />
        <div className="h-10 rounded-lg bg-slate-100" />
        <div className="h-10 rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

export default function ModelHubLoading() {
  return (
    <main className="mx-auto max-w-7xl px-6 pb-20 pt-10">
      <div className="animate-pulse">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-slate-100" />
            <div>
              <div className="h-4 w-24 rounded bg-slate-100" />
              <div className="mt-3 h-8 w-72 max-w-full rounded bg-slate-100" />
            </div>
          </div>
          <div className="mt-4 h-5 max-w-3xl rounded bg-slate-100" />
          <div className="mt-2 h-5 max-w-2xl rounded bg-slate-100" />
        </header>

        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="h-24 rounded-lg border border-slate-200 bg-white" />
          <div className="h-24 rounded-lg border border-slate-200 bg-white" />
          <div className="h-24 rounded-lg border border-slate-200 bg-white" />
        </section>

        <nav className="mb-6 flex flex-wrap gap-2">
          <div className="h-9 w-16 rounded-full bg-slate-100" />
          <div className="h-9 w-24 rounded-full bg-slate-100" />
          <div className="h-9 w-24 rounded-full bg-slate-100" />
          <div className="h-9 w-28 rounded-full bg-slate-100" />
          <div className="h-9 w-24 rounded-full bg-slate-100" />
        </nav>

        <section className="grid gap-5 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </section>
      </div>
    </main>
  );
}
