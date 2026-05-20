import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonById } from "@/lib/queries/people";
import { listManualEdgesForPerson } from "@/lib/queries/manualEdges";
import {
  confidenceLabel,
  listDerivedEdgesForPerson,
} from "@/lib/queries/derivedEdges";
import {
  formatDateYMD,
  getMessageStatsForPerson,
  listMessageThreadForPerson,
} from "@/lib/queries/messages";
import { AddConnection } from "@/components/add-connection";
import { ManualEdges } from "./manual-edges";

export const dynamic = "force-dynamic";

export default async function PersonDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getPersonById(params.id);
  if (!data) notFound();
  const { person, positions, connectedAt } = data;
  // Three query calls — manual edges, derived edges, and messages travel
  // through separate modules (ISC-94 / ISC-253: three epistemic categories,
  // never co-mingled at the read layer).
  const manualEdges = await listManualEdgesForPerson(person.id);
  const derivedEdges = await listDerivedEdgesForPerson(person.id);
  const messageStats = await getMessageStatsForPerson(person.id);
  const messageThread =
    messageStats.total > 0
      ? await listMessageThreadForPerson(person.id, 20)
      : [];

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            <Link
              href="/people"
              className="transition-colors duration-fast ease-cubic-out hover:text-accent-signal"
            >
              People
            </Link>
          </p>
          <h1
            data-testid="person-name"
            className="mt-1 font-display text-3xl font-semibold tracking-tight"
          >
            {person.fullName}
          </h1>
          {person.headline && (
            <p className="mt-3 text-base text-text-secondary">
              {person.headline}
            </p>
          )}
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            {person.email && (
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                  Email
                </dt>
                <dd className="mt-0.5 font-mono text-text-primary">
                  {person.email}
                </dd>
              </div>
            )}
            {person.linkedinUrl && (
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                  LinkedIn
                </dt>
                <dd className="mt-0.5 truncate text-text-primary">
                  <a
                    href={person.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-text-tertiary underline-offset-4 transition-colors duration-fast ease-cubic-out hover:text-accent-signal hover:decoration-accent-signal"
                  >
                    profile ↗
                  </a>
                </dd>
              </div>
            )}
            {connectedAt && (
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                  Connected
                </dt>
                <dd className="mt-0.5 font-mono text-text-primary">
                  {connectedAt}
                </dd>
              </div>
            )}
          </dl>
        </header>

        {positions.length > 0 && (
          <section className="mt-8">
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
              Positions
            </h2>
            <ul data-testid="positions-list" className="mt-3 space-y-2 text-sm">
              {positions.map((p) => (
                <li
                  key={p.id}
                  data-origin={p.origin}
                  className="rounded-md border border-border-subtle bg-surface px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-text-primary">
                      {p.title ?? "(no title)"}
                    </p>
                    {p.companyId && p.companyName && (
                      <Link
                        href={`/companies/${p.companyId}`}
                        className="text-xs text-text-secondary underline decoration-text-tertiary underline-offset-4 transition-colors duration-fast ease-cubic-out hover:text-accent-signal hover:decoration-accent-signal"
                      >
                        {p.companyName}
                      </Link>
                    )}
                  </div>
                  {p.origin === "synthesised" ? (
                    <p
                      data-testid="position-synthesised"
                      className="mt-0.5 text-xs italic text-text-tertiary"
                    >
                      currently at this company (from network metadata; dates
                      unknown)
                    </p>
                  ) : (
                    <p className="mt-0.5 font-mono text-xs text-text-tertiary">
                      {p.startDate ?? "(unknown)"} –{" "}
                      {p.current ? "present" : (p.endDate ?? "(unknown)")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Manual connections
          </h2>
          <ManualEdges personId={person.id} edges={manualEdges} />
          <AddConnection personId={person.id} />
        </section>

        <section className="mt-8" data-testid="derived-edges-section">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Derived connections{" "}
            <span className="ml-1 normal-case text-text-tertiary">
              (inferred from shared employers — never asserted)
            </span>
          </h2>
          {derivedEdges.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">
              No derived connections yet — run the derive job or import a
              LinkedIn export first.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface">
              {derivedEdges.map((e) => (
                <li
                  key={`${e.otherPersonId}-${e.companyId}-${e.kind}`}
                  data-testid="derived-edge-row"
                  className="text-sm"
                >
                  <Link
                    href={`/people/${e.otherPersonId}`}
                    className="block px-4 py-2.5 transition-colors duration-fast ease-cubic-out hover:bg-overlay"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-text-primary">
                        {e.otherPersonName}
                      </span>
                      <span
                        className="rounded-sm border border-accent-signal/30 bg-accent-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-signal"
                        title={`confidence ${e.confidence}`}
                      >
                        {confidenceLabel(e.confidence)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {e.companyName ?? "(unknown company)"}
                      {e.overlapMonths > 0
                        ? ` · ${e.overlapMonths} months overlap`
                        : e.bothCurrent
                          ? " · both currently there"
                          : " · same employer, no overlap window"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Third epistemic category: observed communication events.
            Never mixed with manual or derived edges (ISC-253 / ISC-265 /
            ISC-266). Stats row ALWAYS renders — zeros are signal, not
            absence. Hiding the row would conflate "we checked, there were
            none" with "we don't track this here" — the third-category
            architecture exists precisely to make that distinction legible
            (Advisor 2026-05-20). */}
        <section className="mt-8" data-testid="messages-section">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Messages{" "}
            <span className="ml-1 normal-case text-text-tertiary">
              (LinkedIn messages exchanged — direction + date only; bodies
              never stored)
            </span>
          </h2>
          <dl
            data-testid="messages-stats"
            className="mt-3 grid grid-cols-3 gap-x-6 gap-y-2 text-sm"
          >
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                Sent
              </dt>
              <dd
                data-stat="sent"
                className="mt-0.5 font-mono text-text-primary"
              >
                {messageStats.sent}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                Received
              </dt>
              <dd
                data-stat="received"
                className="mt-0.5 font-mono text-text-primary"
              >
                {messageStats.received}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                Last contact
              </dt>
              <dd
                data-stat="last-contact"
                className="mt-0.5 font-mono text-text-primary"
              >
                {messageStats.lastAt
                  ? formatDateYMD(messageStats.lastAt)
                  : "—"}
              </dd>
            </div>
          </dl>
          {messageStats.total === 0 ? (
            <p
              data-testid="messages-empty"
              className="mt-3 text-sm text-text-secondary"
            >
              No messages exchanged with this person.
            </p>
          ) : (
            <ul
              data-testid="messages-thread"
              className="mt-3 divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface"
            >
              {messageThread.map((m) => (
                <li
                  key={m.id}
                  data-testid="messages-thread-row"
                  data-direction={m.direction}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span
                    className={
                      m.direction === "sent"
                        ? "font-medium text-accent-signal"
                        : "font-medium text-text-primary"
                    }
                  >
                    {m.direction === "sent" ? "Sent" : "Received"}
                  </span>
                  <span className="font-mono text-xs text-text-secondary">
                    {formatDateYMD(m.sentAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
