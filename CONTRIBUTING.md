# Contributing to Strand

Thanks for the interest. Strand is small enough that a few guidelines go a
long way.

## Where the project state lives

The single source of truth for Strand's design, decisions, and verification
state is the **ISA** at `Projects/Strand/ISA.md`. It captures:

- Every Ideal-State Criterion (ISC) across W1–W7, marked `[x]` or
  `[DEFERRED-VERIFY]` with evidence
- Decisions and refinements (timestamped, with reasoning)
- A Changelog in conjecture / refutation / learning format
- The full verification log per week

Read the relevant ISA sections before proposing architectural changes —
several non-obvious calls (3-kind derived-edge taxonomy, manual-vs-derived
epistemic separation, owner-centric graph star, local-first URL validation)
are intentional and documented there.

## Local development

```bash
bun install
bun run db:migrate
bun dev
```

## Running the test suite

Unit tests (parser + derive math):

```bash
bun test
```

Type-check:

```bash
bun run typecheck
```

Integration probes (require a running `bun dev` at `localhost:3000`):

```bash
bun run scripts/verify-w3.ts   # browse + manual edges
bun run scripts/verify-w4.ts   # derived edges + synthesised positions
bun run scripts/verify-w5.ts   # /queries/at-company + bookmarks
bun run scripts/verify-w5b.ts  # /queries/worked-with + by-year + reach
bun run scripts/verify-w6.ts   # /graph
```

The integration probes use Playwright. One-time per machine:

```bash
bun x playwright install firefox
```

A PR that adds or changes a feature should add an ISC + verification entry
to the ISA, and a verification probe to the relevant `verify-w*.ts`. The
goal is that every claim in the ISA is testable from the CLI.

## Pull request conventions

- One change per PR; small is better than complete.
- The PR description should reference the ISC(s) the change satisfies or
  modifies.
- Branch names: `wN-<slug>` for feature weeks, `fix/<slug>` for fixes,
  `doc/<slug>` for docs.
- Commits use short imperative subjects (`W4: derive shared-employer edges`,
  `fix: parser handles null connected_at`).

## Schema changes

Schema migrations live in `drizzle/NNNN_<slug>.sql`. Generate with:

```bash
bun run db:generate    # diffs schema.ts against the last snapshot
```

Then check the generated SQL, edit if needed, and update
`drizzle/meta/_journal.json` + `drizzle/meta/NNNN_snapshot.json` so the
runtime migrator picks the new migration up. Confirm idempotency by running
`bun run db:migrate` twice — the second invocation must be a no-op.

## Privacy invariants

Strand is local-first. Any PR that adds an outbound network call (analytics,
telemetry, third-party API, font CDN, anything that talks to a host that
isn't the user's own machine) must explain why in the PR description AND
add the corresponding anti-criterion to the ISA. The default is no.

## License

MIT — see [LICENSE](LICENSE). By contributing, you agree your contribution
is licensed under the same terms.
