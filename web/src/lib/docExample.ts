/**
 * The single reference to the committed showcase export that Technical
 * Documentation uses as its worked example.
 *
 * It is centralized here on purpose: the export file stem is renamed when the
 * curated example set is rebuilt, and changing this one constant is then the
 * whole frontend side of that rename. Nothing else in the documentation page
 * names an export file.
 *
 * The example is chosen only because it carries a full λ envelope alongside an
 * optimizer result, which the model specification's optimization and
 * lambda-envelope sections cover. Its internal
 * identifier is never rendered: the page calls it what it is, a three-site
 * example portfolio.
 */
export const DOC_EXAMPLE_PATH = "/data/cheap_site_risky_schedule.json";
