import pkg from "../../package.json";

// Single source of truth for the version string the app advertises (homepage
// pill today; footer / about page / API banner whenever they appear).
// `version` comes from package.json so a `bun version` or manual bump flows
// to every surface automatically. The lifecycle stage ("alpha") stays a
// literal here until we promote to beta / 1.0.
export const STRAND_VERSION = pkg.version;
export const STRAND_VERSION_LABEL = `v${pkg.version} — alpha`;
