import { NextResponse } from "next/server";
import {
  createManualEdge,
  deleteManualEdge,
  personExists,
} from "@/lib/queries/manualEdges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  person_a_id?: unknown;
  person_b_id?: unknown;
  note?: unknown;
};

async function parseBody(request: Request): Promise<CreateBody | null> {
  try {
    return (await request.json()) as CreateBody;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (!body || typeof body.person_a_id !== "string" || typeof body.person_b_id !== "string") {
    return NextResponse.json(
      { error: "expected JSON body with string person_a_id and person_b_id" },
      { status: 400 },
    );
  }
  const a = body.person_a_id;
  const b = body.person_b_id;
  if (a === b) {
    return NextResponse.json(
      { error: "cannot create a manual edge from a person to themselves" },
      { status: 400 },
    );
  }
  if (!(await personExists(a)) || !(await personExists(b))) {
    return NextResponse.json(
      { error: "one or both person ids do not exist in this tenant" },
      { status: 400 },
    );
  }
  const note =
    typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  const result = await createManualEdge({ personA: a, personB: b, note });
  if (result.kind === "existing") {
    return NextResponse.json(
      { existing: true, edge: { person_a: result.personA, person_b: result.personB } },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { existing: false, edge: { person_a: result.personA, person_b: result.personB } },
    { status: 201 },
  );
}

export async function DELETE(request: Request) {
  const body = await parseBody(request);
  if (!body || typeof body.person_a_id !== "string" || typeof body.person_b_id !== "string") {
    return NextResponse.json(
      { error: "expected JSON body with string person_a_id and person_b_id" },
      { status: 400 },
    );
  }
  const result = await deleteManualEdge({ personA: body.person_a_id, personB: body.person_b_id });
  if (!result.deleted) {
    return NextResponse.json(
      { error: "edge not found" },
      { status: 404 },
    );
  }
  return new Response(null, { status: 204 });
}
