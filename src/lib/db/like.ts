// LIKE pattern wildcard escaper. SQLite's LIKE treats `%` (any sequence) and
// `_` (any single char) as wildcards. When user input is concatenated into a
// LIKE pattern (`%${q}%`) those characters need to be neutralised, or
// `q="%"` matches every row and `q="_"` matches every single-character row.
// Drizzle parameter-binds the value, but the wildcard interpretation happens
// INSIDE the LIKE — the value is the right place to escape.
//
// Returned string is intended for use with `LIKE ${pattern} ESCAPE '\'` —
// backslash is the escape character. Backslashes in the input itself are
// doubled first so they don't accidentally escape the following character.
export function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
