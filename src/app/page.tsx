import Link from "next/link";
import { cn } from "@/lib/utils";

type RouteStatus = "live" | "next" | "later";

const routes: Array<{
  name: string;
  path: string;
  status: RouteStatus;
  badge: string;
  description: string;
}> = [
  { name: "Upload", path: "/upload", status: "live", badge: "Live", description: "Drop your LinkedIn .zip export here" },
  { name: "Profile", path: "/profile", status: "live", badge: "Live", description: "Your own owner identity from Profile.csv" },
  { name: "People", path: "/people", status: "live", badge: "Live", description: "Browse and filter your connections" },
  { name: "Companies", path: "/companies", status: "live", badge: "Live", description: "Everyone in your network who has worked at X" },
  { name: "Queries · at company", path: "/queries/at-company", status: "live", badge: "Live", description: "Who do I know at X — with status / sort filters and saved bookmarks" },
  { name: "Queries · worked with", path: "/queries/worked-with", status: "live", badge: "Live", description: "Manual + derived edges incident to one person, kept honest about provenance" },
  { name: "Queries · by year", path: "/queries/by-year", status: "live", badge: "Live", description: "Connections-by-year histogram and per-year drilldown" },
  { name: "Queries · reach", path: "/queries/reach", status: "live", badge: "Live", description: "Strongest intermediaries from you to a target person" },
  { name: "Graph", path: "/graph", status: "live", badge: "Live", description: "Force-directed Cytoscape view of your network, clustered by company" },
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
          {routes.map((r) => {
            const row = (
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <div className="flex flex-1 items-baseline gap-3">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground">{r.description}</span>
                </div>
                <span
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs font-medium",
                    r.status === "live"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.badge}
                </span>
              </div>
            );
            return (
              <li key={r.name + r.path} className="px-4 py-3">
                {r.status === "live" ? (
                  <Link href={r.path} className="block -mx-4 px-4 py-1 rounded hover:bg-muted/40">
                    {row}
                  </Link>
                ) : (
                  <div className="opacity-60 cursor-not-allowed">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
        <p>
          Built with Next.js · Bun · SQLite · Drizzle · Tailwind · Cytoscape.
          v0.1.0.
        </p>
      </footer>
    </main>
  );
}
