"use client";

// Global top-of-screen progress bar that flashes during route navigation.
//
// Why: Next 14 dev/prod server-renders dynamic routes on demand and the
// /graph assembler in particular takes ~5s. Without feedback the user
// clicks a nav link and sees nothing for 5s — they don't know whether
// the click registered. This bar flashes ON at click-on-internal-link
// time and OFF when the pathname or query string changes (i.e. when
// navigation actually completes).
//
// Why click-interception (not router events): Next 14 App Router does
// not expose start/end navigation hooks for client components. The
// canonical fallback is to detect navigation-start by intercepting
// clicks on internal anchors, then end when usePathname/useSearchParams
// updates. Next 15 has `useLinkStatus`; this file is the bridge.

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);

  // Navigation has completed — pathname or query string changed.
  useEffect(() => {
    setActive(false);
  }, [pathname, searchParams]);

  // Navigation has started — user clicked an internal link.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Modifier keys → user is opening in a new tab/window; not a nav.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank") return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("http://") || href.startsWith("https://")) {
        // External link → only treat as nav if same origin.
        try {
          if (new URL(href).origin !== window.location.origin) return;
        } catch {
          return;
        }
      }
      if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

      // Same destination as current location → not a real navigation.
      if (
        anchor.pathname === window.location.pathname &&
        anchor.search === window.location.search
      ) {
        return;
      }

      setActive(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="nav-progress"
          aria-hidden
          initial={{ scaleX: 0, opacity: 1 }}
          // Ease toward ~85% over a few seconds while we wait. Even slow
          // routes (e.g. /graph at ~5s TTFB) feel responsive because the
          // bar is visibly making progress.
          animate={{
            scaleX: 0.85,
            transition: { duration: 6, ease: [0.0, 0.5, 0.5, 1] },
          }}
          exit={{
            scaleX: 1,
            opacity: 0,
            transition: { duration: 0.25, ease: "easeOut" },
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            transformOrigin: "left",
            zIndex: 60,
            pointerEvents: "none",
            background:
              "linear-gradient(to right, hsl(var(--accent-warmth)), hsl(var(--accent-signal)))",
            boxShadow: "0 0 8px hsl(var(--accent-signal) / 0.5)",
          }}
        />
      )}
    </AnimatePresence>
  );
}
