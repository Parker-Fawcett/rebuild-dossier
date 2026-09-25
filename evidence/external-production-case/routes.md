# Route IDs used in this record

The application is internal to the operator's company, so routes are named by stable IDs rather
than their real paths. Each description gives the input class that matters for the finding.

| ID  | Route shape | Visible test? | What happened |
|-----|-------------|---------------|---------------|
| R1  | `GET`, channel breakdown; requires a `channel` query parameter (400 without it) | yes, sends no query parameters | **Rebuild throws `ReferenceError` (helper H1 undefined) on every request that passes the 400 guard.** H1 is called by R1's SQL builder, two calls below the handler; contracts capture one level. |
| R2  | `GET`, channel trend; requires `channel` or `channels` (400 without it) | yes, sends no query parameters | **Rebuild throws `ReferenceError` (helper H2 undefined) on every request that passes the 400 guard.** H2 is a *direct* callee, dropped by the comment-apostrophe defect. |
| R3  | `POST`, send a message to a named chat agent; streams the reply (SSE) | yes, asserts `status < 500` with an inferred body field (`getReader`) that is not a real request field | Rebuild checks agent existence (404) before body shape (400); original does the reverse. Contract had no handler section (defect). Rebuild streams, like the original. |
| R4  | `GET`, list chat agents | no (unrunnable against the original without credentials) | Never built; Express default 404. Contract had no handler section (defect). |
| R5  | `GET`, KPI summary | held-out (2 tests) | Never built (404 vs. expected 200). One of its two held-out tests passed anyway, against the missing route. Contract had no handler section (defect). |
| R6  | `GET`, one chat agent by name | yes | Contract had no handler section (defect). |
| R7  | `GET`, channel list | no (unrunnable) | Contract had no handler section (defect). |
| R8  | `GET`, health check | yes | Matched exactly (shape identical apart from timestamp). |
| R9  | `GET`, metric trend by name | yes | Unknown-metric 404 matched exactly. |
| R10 | `GET`, division segments | yes | Missing-parameter 400 matched exactly. |

R2's missing-parameter 400 also matched exactly (the fourth matching check).
The other 19 routes: generated tests unrunnable against the unmodified original without warehouse
credentials (original returns 500), so they were set aside by the mutation check.
