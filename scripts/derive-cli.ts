// Rebuild derived_edges for the local tenant from scratch.
// Cheap to run repeatedly — derive is idempotent (clear-then-rebuild per
// tenant). Hook this if you import positions outside the normal ingest path.
import { deriveSharedEmployerEdges, countDerivedEdges } from "@/lib/derived/edges";

const result = await deriveSharedEmployerEdges();
const byKind = await countDerivedEdges();
console.log(JSON.stringify({ ...result, byKindInDb: byKind }, null, 2));
