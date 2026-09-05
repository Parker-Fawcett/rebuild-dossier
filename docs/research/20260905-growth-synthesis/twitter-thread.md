1/
I built rebuild-dossier, an MCP server that reverse-engineers a mutation-tested rebuild spec from your existing app. Any AI agent can rebuild cleanly against that spec instead of guessing. Show HN. https://github.com/Parker-Fawcett/rebuild-dossier

2/
The problem: prior research measured 0% behavioral equivalence for rebuild pipelines with no verified feedback loop. Only 9-19% with a coarse one. The bet: lock contracts before testing, plus one-test-at-a-time retries, does better.

3/
How it works: 6 MCP tools run from inside Claude Code or any MCP session. ingest_repo analyzes your codebase (static, no LLM). crawl_site headlessly crawls routes. flag_known_bug stores ambiguity verbatim. get_case_queue surfaces open questions. resolve_case answers them. generate_spec produces the locked spec.

4/
The non-negotiable rule: auto-resolving an ambiguity requires both signal agreement AND evidence someone actually decided. Silent agreement alone never becomes an auto-resolution. This is enforced by hooks, not just prose.

5/
Install: npx rebuild-dossier@latest --help. Requires Node 20.12+. Then add it as an MCP server in Claude Code.

6/
Backed by arXiv paper 2608.23616 and Zenodo DOI 10.5281/zenodo.22036801. The core loop has been tested end-to-end against a real messy repo with two independent fresh-agent handoffs on two model tiers.

7/
What it does NOT do: it does not rebuild your app. It produces the spec a coding agent consumes to do that. Does not claim behavioral equivalence. See docs/v0-findings.md for the honest account.