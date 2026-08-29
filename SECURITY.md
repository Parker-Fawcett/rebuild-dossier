# Security Policy

Thanks for taking the time to look at this. `rebuild-dossier` is an MCP server
that ingests repositories, crawls their routes, and generates a specification
for rebuilding them. Because it processes untrusted input (arbitrary
repositories), security matters here — and we appreciate you reporting issues
responsibly.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report vulnerabilities privately by email to:

- **Email:** Parkerscottfawcett@gmail.com

Please include as much of the following as you can:

- A description of the vulnerability and its impact
- Steps to reproduce it (a minimal example is ideal)
- The version of `rebuild-dossier` you tested against
- Any suggested fix, if you have one

We'll acknowledge your report as soon as we can, keep you updated on progress,
and credit you for the discovery if you'd like.

## Scope

The following are **in scope**:

- The `rebuild-dossier` MCP server itself (the code in this repository)
- The spec generation pipeline (repo ingestion, route crawling, and the
  generated spec, tests, and supporting files)
- Any dependencies bundled and executed as part of the server

## Out of scope

The following are **out of scope**:

- Vulnerabilities in applications that users build with the generated spec —
  the spec is a starting point, and the resulting app is the user's own code
- Third-party tools and services that `rebuild-dossier` integrates with
  (e.g. MCP clients, browser automation drivers, or external APIs) — please
  report those to their respective maintainers
- Issues in a user's own repository that happen to be surfaced during
  ingestion or crawling

## Expectations for this project

This is **v0 academic software** — a research project, not a commercial
product. Please expect some delay in responses. We'll do our best to triage
and respond to reports in a reasonable timeframe, but there is no SLA and no
guaranteed fix timeline. If you find something serious, we still want to hear
about it — responsibly disclosed reports help make the research stronger.
