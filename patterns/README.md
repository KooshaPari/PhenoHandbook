# Phenotype Patterns

The conventions the org actually builds by. PhenoHandbook is the **CONVENTIONS** repo in the [4-role spine](spine-roles.md): registry indexes, PhenoSpecs holds ADRs/contracts, this handbook documents how we work, governance enforces.

## Index

| Category | Pattern | Summary |
|----------|---------|---------|
| Spine | [spine-roles](spine-roles.md) | The 4-role split (index / ADRs / conventions / enforcement) and the authority rule. |
| Architecture | [architecture/hexagonal](architecture/hexagonal.md) | Ports & adapters. |
| Async | [async/event-driven](async/event-driven.md) | Event-driven messaging. |
| Methodology | [methodology/xdd](methodology/xdd.md) | xDD-first (TDD/BDD/SDD/CDD/DDD/PDD), hexagonal, SOLID/DRY, libify at 2nd use. |
| Methodology | [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) | Wrap existing ecosystem behind ports; reduce LOC. |
| Tooling | [tooling/task-runner](tooling/task-runner.md) | Justfile primary, Taskfile mirror, Tools/*.ps1 for >20-line scripts. |
| Delegation | [delegation/codex-first](delegation/codex-first.md) | codex-spark first; disjoint files; per-worker worktrees; never stash. |
| CI | [ci/never-billable-ci](ci/never-billable-ci.md) | Avoid billable minutes; pin runners/actions; least-privilege; sponsor-merge. |
| Logging | [logging-go](logging-go.md) | `log/slog` with `slog.NewJSONHandler` + `sync.Once` guard, not stdlib `log` / `fmt.Fprintln(os.Stderr, ...)` / third-party loggers (`zap`, `zerolog`, `logrus`). |
| Stack | [stack/defaults](stack/defaults.md) | TanStack / FastMCP / VitePress / xUnit; Rust/Go for tooling; .env always. |
| Traceability | [traceability/requirements](traceability/requirements.md) | FR/NFR in Tracera + AgilePlus Epic/Story; requirement→code→test→PR. |
| Reuse | [shared-primitive-reuse](shared-primitive-reuse.md) | When `phenoShared` ships a crate for a primitive (logging, http-client, config, secret, rate-limit, retry, error-core, time, build-info), consumers add it as a `path =` dep and call its public API — never re-implement. |

These are descriptive of current practice, not aspirational. If a pattern here no longer matches reality, fix the pattern or the practice — don't let them drift.
