# Strand design tokens

This file is the vocabulary for **Graph-Forward Dark** — the design system
adopted in v0.2.0. Every route in Strand renders on these tokens; the v0.1.x
light palette has been fully retired (no consumers, no legacy CSS vars, no
`prefers-color-scheme` block).

## Philosophy

**Strand is the only app that knows your professional network as a graph.
The UI should *be* that graph, not describe it.** Every token below flows
from that thesis — what is foreground, what is background, where motion
lives, what the accent colour is reserved for.

Three rules govern the system:

1. **Color carries data.** If a UI element is an accent colour, it means
   something — high-signal, high-confidence, or "you." Decorative use of
   accent is a bug.
2. **Two densities, not three.** Comfortable rhythm (16 / 24 / 32) for the
   graph and hero routes; dense rhythm (8 / 12 / 16) for list/table routes.
   No third density.
3. **Motion is content-driven.** Animation happens when the data changes
   shape — a filter narrows the graph, the inspector reveals a selection,
   a node is centred. Scroll-jacking and decorative animation are banned.

---

## Color

All values are stored as space-separated HSL components (Tailwind's
`hsl(var(--token))` convention) so opacity modifiers like `bg-canvas/80`
keep working.

### Background layers — three steps of lift

| Token | CSS var | HSL | Hex (approx) | Role |
| --- | --- | --- | --- | --- |
| `bg-canvas` | `--bg-canvas` | `216 13% 5%` | `#0B0D10` | App background — near-black with a slight blue undertone |
| `bg-surface` | `--bg-surface` | `214 16% 9%` | `#13171C` | Cards, panels, side rails — lifted by 1 |
| `bg-overlay` | `--bg-overlay` | `212 18% 13%` | `#1B2027` | Modals, popovers, command palette — lifted by 2 |

Elevation comes from layer shift, not shadows.

### Borders

| Token | CSS var | HSL | Hex (approx) | Role |
| --- | --- | --- | --- | --- |
| `border-subtle` | `--border-subtle` | `214 19% 16%` | `#222831` | Hairline dividers, default borders |
| `border-strong` | `--border-strong` | `216 15% 27%` | `#3A4250` | Hover, active, focus borders |

### Text — three contrast steps

| Token | CSS var | HSL | Hex (approx) | Role |
| --- | --- | --- | --- | --- |
| `text-primary` | `--text-primary` | `214 22% 93%` | `#E8ECF1` | Body, headlines |
| `text-secondary` | `--text-secondary` | `214 13% 65%` | `#9AA4B2` | Labels, metadata |
| `text-tertiary` | `--text-tertiary` | `214 14% 42%` | `#5E6A7A` | Disabled state, watermarks |

### Accents — color carries data

| Token | CSS var | HSL | Hex (approx) | Reserved for |
| --- | --- | --- | --- | --- |
| `accent-signal` | `--accent-signal` | `199 95% 74%` | `#7DD3FC` | Manual edges, high-confidence derived edges, interactive focus rings |
| `accent-warmth` | `--accent-warmth` | `35 88% 69%` | `#F5C16C` | YOU as the network owner — your node in the graph, your row in tables, references to "you" in copy |

One token, one meaning. `accent-signal` never decorates a button just
because; `accent-warmth` never appears on anything that isn't the owner.

---

## Typography

Three roles, three CSS variables. Actual font files are loaded in a later
commit — these tokens declare the *slots*, not the fonts.

| Class | CSS var | Default fallback chain | Use |
| --- | --- | --- | --- |
| `font-display` | `--font-display` | Inter → system-ui → sans-serif | Route titles, person names on detail pages, large numbers |
| `font-sans` | `--font-sans` | Inter → system-ui → sans-serif | Body copy |
| `font-mono` | `--font-mono` | JetBrains Mono → ui-monospace | Numbers, IDs, confidence scores, dates, code |

**Mono for numbers is non-negotiable.** Confidence scores, year ranges, and
counts are real data — they need a monospaced family that signals so.

### Scale (uses Tailwind defaults)

| Class | Size / line-height | Use |
| --- | --- | --- |
| `text-xs` | 12 / 16 | Labels, table metadata |
| `text-sm` | 14 / 20 | Body, list rows |
| `text-base` | 16 / 24 | Form inputs, dense table cells |
| `text-lg` | 18 / 28 | Subheads |
| `text-xl` | 20 / 28 | Card titles |
| `text-2xl` | 24 / 32 | Section headings |
| `text-3xl` | 30 / 36 | Route titles |
| `text-4xl` | 36 / 40 | Hero name on `/profile` |

### Letter-spacing convention

- Display sizes (`text-2xl`+): `tracking-tight` (-0.02em)
- Body: default
- Uppercase labels (sidebar, metadata): `tracking-wide` (+0.02em), 11px,
  weight 500

---

## Spacing & rhythm

8px base unit. Two named densities only.

| Density | Padding rhythm | Used in |
| --- | --- | --- |
| Comfortable | 16 / 24 / 32 | `/`, `/graph`, `/profile`, modals |
| Dense | 8 / 12 / 16 | `/people`, `/companies`, `/queries/*` results |

No third density. Cards in a dense list don't suddenly use comfortable
padding because they "feel important."

---

## Radii

Three steps. The Tailwind defaults are overridden so `rounded-sm` /
`rounded-md` / `rounded-lg` produce the values below.

| Class | CSS var | Value | Use |
| --- | --- | --- | --- |
| `rounded-sm` | `--radius-sm` | 6px | Inputs, chips, small buttons |
| `rounded-md` | `--radius-md` | 10px | Cards, panels, default buttons |
| `rounded-lg` | `--radius-lg` | 16px | Modals, command palette |

`rounded-full` for avatars/dots stays at the Tailwind default.

---

## Motion

Four duration steps and two easing curves. Animation happens when the data
changes shape; otherwise the UI is still.

### Duration

| Class | CSS var | Value | Use |
| --- | --- | --- | --- |
| `duration-fast` | `--motion-fast` | 120ms | Hover state changes, focus rings, small UI lifts |
| `duration-base` | `--motion-base` | 220ms | Route transitions, inspector slide, card reveal |
| `duration-slow` | `--motion-slow` | 360ms | Filter-applied highlight pulse, content stagger |
| `duration-graph` | `--motion-graph` | 480ms | Cytoscape camera pan, layout re-settle |

### Easing

| Class | CSS var | Curve | Use |
| --- | --- | --- | --- |
| `ease-cubic-out` | `--motion-ease-out` | `cubic-bezier(0.33, 1, 0.68, 1)` | Entrances, reveals, navigation — most things |
| `ease-cubic-inout` | `--motion-ease-inout` | `cubic-bezier(0.65, 0, 0.35, 1)` | Symmetric transitions (filter pulse, hover-out matching hover-in) |

Exits use the entrance easing reversed — never a separate "exit" curve.

---

## Usage rules

- **Prefer named tokens to raw values.** `bg-canvas` over `bg-[#0B0D10]`,
  `duration-base` over `duration-200`.
- **Accent restraint.** A page with more than one or two `accent-signal`
  elements visible at once is probably misusing it. Reserve it for
  high-confidence / interactive-focus / you.
- **Mono for numbers.** Any rendered number that is data (count, year,
  confidence, ID, percentage) uses `font-mono`. Numbers that are part of
  prose (the word "two" in a sentence) do not.
