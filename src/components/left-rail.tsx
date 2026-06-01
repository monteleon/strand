"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Network,
  Users,
  Building2,
  Search,
  UserCircle,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { STRAND_VERSION_LABEL } from "@/lib/version";

type RailRoute = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
};

// One source of truth for the navigation surface. Adding a route is one
// entry; the active-state matcher takes care of the rest.
const ROUTES: RailRoute[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/people", label: "People", icon: Users, matchPrefix: "/people" },
  {
    href: "/companies",
    label: "Companies",
    icon: Building2,
    matchPrefix: "/companies",
  },
  {
    href: "/queries/at-company",
    label: "Queries",
    icon: Search,
    matchPrefix: "/queries",
  },
  { href: "/profile", label: "Profile", icon: UserCircle },
  { href: "/upload", label: "Upload", icon: Upload },
];

function isActive(pathname: string, route: RailRoute): boolean {
  if (route.matchPrefix) return pathname.startsWith(route.matchPrefix);
  return pathname === route.href;
}

export function LeftRail() {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Primary navigation"
      className="group/rail relative z-10 flex h-screen w-14 shrink-0 flex-col border-r border-border-subtle bg-surface text-text-primary transition-[width] duration-base ease-cubic-out hover:w-[220px] focus-within:w-[220px]"
    >
      <Link
        href="/"
        aria-label="Strand — home"
        className="flex h-12 items-center gap-3 border-b border-border-subtle px-4 transition-colors duration-fast ease-cubic-out hover:text-accent-warmth"
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full bg-accent-warmth"
        />
        <span className="overflow-hidden whitespace-nowrap font-display text-sm font-semibold tracking-tight opacity-0 transition-opacity duration-base ease-cubic-out group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
          Strand
        </span>
      </Link>

      <ul className="flex flex-1 flex-col gap-1 px-2 py-3">
        {ROUTES.map((route) => {
          const active = isActive(pathname, route);
          const Icon = route.icon;
          return (
            <li key={route.href}>
              <Link
                href={route.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-9 items-center gap-3 rounded-sm px-2 transition-colors duration-fast ease-cubic-out ${
                  active
                    ? "bg-overlay text-text-primary"
                    : "text-text-secondary hover:bg-overlay hover:text-text-primary"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute -left-2 top-1 bottom-1 w-0.5 rounded-full bg-accent-warmth"
                  />
                )}
                <Icon
                  size={18}
                  strokeWidth={active ? 2.2 : 1.75}
                  aria-hidden="true"
                  className="shrink-0"
                />
                <span className="overflow-hidden whitespace-nowrap text-sm opacity-0 transition-opacity duration-base ease-cubic-out group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
                  {route.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border-subtle px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-text-tertiary opacity-0 transition-opacity duration-base ease-cubic-out group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
          <kbd className="rounded-sm border border-border-subtle bg-overlay px-1.5 py-0.5 normal-case tracking-normal text-text-secondary">
            ⌘K
          </kbd>
          <span>search</span>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary opacity-0 transition-opacity duration-base ease-cubic-out group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
          {STRAND_VERSION_LABEL}
        </p>
      </div>
    </nav>
  );
}
