import { cn } from "@/lib/utils";

const routes = [
  { name: "Upload", path: "/upload", week: "W2", description: "Drop your LinkedIn .zip export here" },
  { name: "People", path: "/people", week: "W3", description: "Browse and filter your connections" },
  { name: "Companies", path: "/companies", week: "W3", description: "Everyone in your network who has worked at X" },
  { name: "Queries", path: "/queries", week: "W5", description: "Who do I know at X · who's worked with whom · closest path" },
  { name: "Graph", path: "/graph", week: "W6", description: "Force-directed view of your network" },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Strand</h1>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            v0.0.0 · skeleton
          </span>
        </div>
        <p className="mt-3 text-base text-muted-foreground">
          Your professional network, your data. Self-hostable. Local-first.
        </p>
      </header>

      <section className="mt-10 space-y-4 text-sm leading-relaxed">
        <p>
          Strand ingests your LinkedIn data export and lets you query your
          professional network — who you know at X, who&apos;s worked with whom,
          who&apos;s closest to person Y — without anything leaving your
          machine.
        </p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Why this matters:</span>{" "}
          the LinkedIn export contains your first-degree connections only. It
          does not export how those connections are connected to each other.
          Strand derives that signal from shared employers and overlapping
          employment dates — surfaced as edges with confidence scores.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Roadmap
        </h2>
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {routes.map((r) => (
            <li
              key={r.path}
              className={cn(
                "flex items-baseline justify-between gap-4 px-4 py-3",
                "text-sm",
              )}
            >
              <div className="flex flex-1 items-baseline gap-3">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">{r.description}</span>
              </div>
              <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {r.week}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
        <p>
          Built with Next.js · Bun · SQLite · Drizzle · Tailwind · Cytoscape.
          Private until v0.1.0.
        </p>
      </footer>
    </main>
  );
}
