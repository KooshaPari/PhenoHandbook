# Phenotype Patterns

The conventions the org actually builds by. PhenoHandbook is the **CONVENTIONS** repo in the [4-role spine](spine-roles.md): registry indexes, PhenoSpecs holds ADRs/contracts, this handbook documents how we work, governance enforces.

Patterns are grouped by the kind of problem they solve — workspace structure, runtime resilience, error handling, configuration, observability, build/CI, and security. The grouping is descriptive of current practice, not aspirational; if a pattern here no longer matches reality, fix the pattern or the practice, don't let them drift.

## Workspace

_How repos, roles, and work distribution are organized across the org._

| Pattern | Summary |
|---------|---------|
| [spine-roles](spine-roles.md) | The 4-role split (index / ADRs / conventions / enforcement) and the authority rule. |
| [delegation/codex-first](delegation/codex-first.md) | codex-spark first; disjoint files; per-worker worktrees; never stash. |
| [methodology/xdd](methodology/xdd.md) | xDD-first (TDD/BDD/SDD/CDD/DDD/PDD), hexagonal, SOLID/DRY, libify at 2nd use. |
| [module-decoupling](module-decoupling.md) | When to split a crate: extract to `phenoShared` at the 2nd consumer, keep in-repo at 1. |

## Resilience

_How the system keeps working under load, change, and partial failure._

| Pattern | Summary |
|---------|---------|
| [architecture/hexagonal](architecture/hexagonal.md) | Ports & adapters; domain has zero external dependencies. |
| [async/event-driven](async/event-driven.md) | Event-driven messaging; idempotent consumers; DLQ; traced events. |
| [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) | Wrap existing ecosystem behind ports; reduce LOC. |

## Error handling

_How failures are surfaced, retried, contained, and routed to a human._

The org's retry, dead-letter-queue, and idempotent-consumer conventions currently live inside [async/event-driven](async/event-driven.md). A standalone error-handling page will land when a category of failure (input validation, outbound HTTP, persistence) needs a named convention that does not fit cleanly inside the event-driven page.

## Configuration

_How defaults, config, and secrets are loaded, scoped, and overridden._

| Pattern | Summary |
|---------|---------|
| [stack/defaults](stack/defaults.md) | TanStack / FastMCP / VitePress / xUnit; Rust/Go for tooling; .env always. |

## Observability

_How we see what the system is doing — in production, in CI, and during review._

| Pattern | Summary |
|---------|---------|
| [logging-rust](logging-rust.md) | `tracing` macros with typed fields, installed once via `phenotype_logging::init_tracing`. No `println!` / `eprintln!` / inline `tracing_subscriber::fmt().init()` / third-party loggers (`log`, `env_logger`, `slog`). |
| [traceability/requirements](traceability/requirements.md) | FR/NFR in Tracera + AgilePlus Epic/Story; requirement→code→test→PR. |

## Build/CI

_How the build, test, and CI pipeline stays fast, cheap, and reproducible._

| Pattern | Summary |
|---------|---------|
| [ci/never-billable-ci](ci/never-billable-ci.md) | Avoid billable minutes; pin runners/actions; least-privilege; sponsor-merge. |
| [tooling/task-runner](tooling/task-runner.md) | Justfile primary, Taskfile mirror, Tools/*.ps1 for >20-line scripts. |

## Security

_How the supply chain, secrets, and runtime boundaries are kept tight._

Security hygiene currently lives inside the CI pattern: [ci/never-billable-ci](ci/never-billable-ci.md) covers SHA-pinned third-party actions, pinned `ubuntu-24.04` runners, least-privilege `permissions:`, and central reusable policy workflows. A dedicated security entry will land when a pattern (secret handling, SBOM, dependency-vulnerability response) is large enough to stand on its own.
