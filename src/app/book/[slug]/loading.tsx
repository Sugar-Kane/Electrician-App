export default function PublicBookingLoading() {
  return (
    <main className="min-h-screen bg-[#06131d] px-3 py-4 text-white sm:px-5 sm:py-6">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-14 w-56 rounded-2xl bg-white/[0.06]" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[.72fr_1.28fr]">
          <div className="space-y-4">
            <div className="h-5 w-40 rounded bg-white/[0.06]" />
            <div className="h-24 rounded-2xl bg-white/[0.06]" />
            <div className="h-36 rounded-2xl bg-white/[0.04]" />
          </div>
          <div className="h-[560px] rounded-[28px] border border-white/10 bg-[#081925]" />
        </div>
      </div>
    </main>
  );
}
