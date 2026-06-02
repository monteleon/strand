"use client";

import { Command } from "cmdk";
import {
  Home,
  Network,
  Users,
  Building2,
  Search,
  UserCircle,
  Upload,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fetchResults } from "@/lib/fetch-results";

type RouteEntry = {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
};

const ROUTES: RouteEntry[] = [
  { href: "/", label: "Home", hint: "hero graph", icon: Home },
  { href: "/graph", label: "Graph", hint: "force-directed view", icon: Network },
  { href: "/people", label: "People", hint: "browse network", icon: Users },
  { href: "/companies", label: "Companies", hint: "browse employers", icon: Building2 },
  {
    href: "/queries/at-company",
    label: "Queries · at company",
    hint: "who do I know at X",
    icon: Search,
  },
  {
    href: "/queries/worked-with",
    label: "Queries · worked with",
    hint: "edges incident to X",
    icon: Search,
  },
  {
    href: "/queries/by-year",
    label: "Queries · by year",
    hint: "connection cohort histogram",
    icon: Search,
  },
  {
    href: "/queries/reach",
    label: "Queries · reach",
    hint: "intermediaries to X",
    icon: Search,
  },
  { href: "/profile", label: "Profile", hint: "owner identity", icon: UserCircle },
  { href: "/upload", label: "Upload", hint: "ingest LinkedIn .zip", icon: Upload },
];

type Person = { id: string; fullName: string; headline: string | null };
type Bookmark = { id: string; name: string; url: string };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Load bookmarks once each time the palette opens — small payload, fresh per session.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchResults<Bookmark>("/api/bookmarks").then((results) => {
      if (!cancelled) setBookmarks(results);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Debounced people search.
  useEffect(() => {
    if (!open) return;
    if (search.trim().length < 2) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetchResults<Person>(
        `/api/people/search?q=${encodeURIComponent(search)}&limit=8`,
        { signal: ctrl.signal },
      ).then((results) => {
        if (!cancelled) setPeople(results);
      });
    }, 200);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(t);
    };
  }, [search, open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setSearch("");
      router.push(href);
    },
    [router],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[15vh] backdrop-blur-sm"
          aria-label="Command palette overlay"
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.33, 1, 0.68, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-lg border border-border-subtle bg-overlay shadow-2xl"
          >
            <Command
              label="Command Palette"
              className="flex flex-col"
              loop
            >
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search routes, people, saved queries…"
                className="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-base text-text-primary placeholder:text-text-tertiary outline-none"
                autoFocus
              />
              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-text-tertiary">
                  No matches.
                </Command.Empty>

                <Command.Group
                  heading="Navigate"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-tertiary"
                >
                  {ROUTES.map((r) => {
                    const Icon = r.icon;
                    return (
                      <Command.Item
                        key={r.href}
                        value={`${r.label} ${r.hint}`}
                        onSelect={() => go(r.href)}
                        className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm text-text-secondary aria-selected:bg-surface aria-selected:text-text-primary"
                      >
                        <Icon size={16} strokeWidth={1.75} aria-hidden />
                        <span className="font-medium">{r.label}</span>
                        <span className="ml-auto font-mono text-[11px] text-text-tertiary">
                          {r.hint}
                        </span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>

                {people.length > 0 && (
                  <Command.Group
                    heading="People"
                    className="mt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-tertiary"
                  >
                    {people.map((p) => (
                      <Command.Item
                        key={p.id}
                        value={`person ${p.fullName} ${p.headline ?? ""}`}
                        onSelect={() => go(`/people/${p.id}`)}
                        className="flex cursor-pointer items-start gap-3 rounded-sm px-3 py-2 text-sm text-text-secondary aria-selected:bg-surface aria-selected:text-text-primary"
                      >
                        <UserCircle
                          size={16}
                          strokeWidth={1.75}
                          aria-hidden
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-text-primary">
                            {p.fullName}
                          </p>
                          {p.headline && (
                            <p className="truncate text-xs text-text-tertiary">
                              {p.headline}
                            </p>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {bookmarks.length > 0 && (
                  <Command.Group
                    heading="Saved queries"
                    className="mt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-tertiary"
                  >
                    {bookmarks.map((b) => (
                      <Command.Item
                        key={b.id}
                        value={`bookmark ${b.name} ${b.url}`}
                        onSelect={() => go(b.url)}
                        className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm text-text-secondary aria-selected:bg-surface aria-selected:text-text-primary"
                      >
                        <Bookmark
                          size={16}
                          strokeWidth={1.75}
                          aria-hidden
                          className="shrink-0"
                        />
                        <span className="truncate font-medium text-text-primary">
                          {b.name}
                        </span>
                        <span className="ml-auto truncate font-mono text-[11px] text-text-tertiary">
                          {b.url}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
              <div className="border-t border-border-subtle px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                <span>↑↓ navigate</span>
                <span className="mx-2">·</span>
                <span>↵ select</span>
                <span className="mx-2">·</span>
                <span>esc close</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
