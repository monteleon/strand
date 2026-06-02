// Validates that a string is a same-origin in-app URL path. Bookmarks (and
// any future user-supplied URL surface) must point at the Strand app itself
// — never off-site, never another origin, never a non-http scheme.
//
// Naïve string checks ("starts with `/` but not `//`") are insufficient:
// browsers normalise backslash to forward slash inside an <a href>, so an
// input like `/\evil.com` passes the cheap check yet renders as `//evil.com`
// → protocol-relative → external navigation. The WHATWG URL parser
// reproduces that normalisation, so resolving the input against a base and
// asserting same-origin catches every shape — `/\evil.com`, `//evil.com`,
// `https://evil.com`, `javascript:`, `data:`, etc.
//
// The literal `/`-prefix gate stays as a belt-and-braces check: it rejects
// shapes like `\foo` that the URL parser happens to resolve same-origin but
// that the bookmark UI has no reason to accept.

const STRAND_BASE = "http://strand.local";

export function isLocalAppPath(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith("/")) return false;
  let parsed: URL;
  try {
    parsed = new URL(url, STRAND_BASE);
  } catch {
    return false;
  }
  return parsed.origin === STRAND_BASE;
}
