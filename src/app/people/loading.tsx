export default function PeopleLoading() {
  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 h-8 w-48 animate-pulse rounded bg-overlay" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-12 w-full animate-pulse rounded bg-overlay/60"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
