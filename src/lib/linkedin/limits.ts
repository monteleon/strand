// Upper bound on an ingestable upload. Real LinkedIn exports are a few MB at
// most (Matt's is ~600 KB; the largest connection lists hit single-digit MB).
// 50 MB leaves comfortable headroom while preventing a multi-GB body from
// being materialised into the Node heap by `file.arrayBuffer()`.
//
// Lives here, not in the route module: Next's route type-check rejects any
// export from route.ts that isn't a route handler or segment config, which
// breaks `next build`.
export const MAX_INGEST_BYTES = 50 * 1024 * 1024;
