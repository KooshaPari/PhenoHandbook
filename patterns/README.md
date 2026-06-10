# Phenotype Patterns

The conventions the org actually builds by. PhenoHandbook is the **CONVENTIONS** repo in the [4-role spine](spine-roles.md): registry indexes, PhenoSpecs holds ADRs/contracts, this handbook documents how we work, governance enforces.

## Index

| Category | Pattern | Summary |
|----------|---------|---------|
| Spine | [spine-roles](spine-roles.md) | The 4-role split (index / ADRs / conventions / enforcement) and the authority rule. |
| Architecture | [architecture/hexagonal](architecture/hexagonal.md) | Ports & adapters. |
| Async | [async/event-driven](async/event-driven.md) | Event-driven messaging. |
| HTTP | [http-client](http-client.md) | Always use `phenotype_http_client_core::build_default_client()`; never `reqwest::Client::new()` with bare defaults. |
| Methodology | [methodology/xdd](methodology/xdd.md) | xDD-first (TDD/BDD/SDD/CDD/DDD/PDD), hexagonal, SOLID/DRY, libify at 2nd use. |
| Methodology | [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) | Wrap existing ecosystem behind ports; reduce LOC. |
| Tooling | [tooling/task-runner](tooling/task-runner.md) | Justfile primary, Taskfile mirror, Tools/*.ps1 for >20-line scripts. |
| Delegation | [delegation/codex-first](delegation/codex-first.md) | codex-spark first; disjoint files; per-worker worktrees; never stash. |
| CI | [ci/never-billable-ci](ci/never-billable-ci.md) | Avoid billable minutes; pin runners/actions; least-privilege; sponsor-merge. |
| Stack | [stack/defaults](stack/defaults.md) | TanStack / FastMCP / VitePress / xUnit; Rust/Go for tooling; .env always. |
| Traceability | [traceability/requirements](traceability/requirements.md) | FR/NFR in Tracera + AgilePlus Epic/Story; requirement→code→test→PR. |

These are descriptive of current practice, not aspirational. If a pattern here no longer matches reality, fix the pattern or the practice — don't let them drift.
