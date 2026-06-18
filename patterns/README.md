# Phenotype Patterns

The conventions the org actually builds by. PhenoHandbook is the **CONVENTIONS** repo in the [4-role spine](spine-roles.md): registry indexes, PhenoSpecs holds ADRs/contracts, this handbook documents how we work, governance enforces.

## Index

| Category | Pattern | Summary |
|----------|---------|---------|
| Spine | [spine-roles](spine-roles.md) | The 4-role split (index / ADRs / conventions / enforcement) and the authority rule. |
| Architecture | [architecture/hexagonal](architecture/hexagonal.md) | Ports & adapters. |
| Async | [async/event-driven](async/event-driven.md) | Event-driven messaging. |
| Resilience | [retry-policy](retry-policy.md) | `phenotype-retry` (`exponential_backoff` / `with_jitter`) — never inline `100 * 2^attempt` backoff loops. |
| Methodology | [methodology/xdd](methodology/xdd.md) | xDD-first (TDD/BDD/SDD/CDD/DDD/PDD), hexagonal, SOLID/DRY, libify at 2nd use. |
| Methodology | [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) | Wrap existing ecosystem behind ports; reduce LOC. |
| Tooling | [tooling/task-runner](tooling/task-runner.md) | Justfile primary, Taskfile mirror, Tools/*.ps1 for >20-line scripts. |
| Delegation | [delegation/codex-first](delegation/codex-first.md) | codex-spark first; disjoint files; per-worker worktrees; never stash. |
| CI | [ci/never-billable-ci](ci/never-billable-ci.md) | Avoid billable minutes; pin runners/actions; least-privilege; sponsor-merge. |
<<<<<<< Updated upstream
| Security | [secrets](secrets.md) | `phenotype_secret::Secret<T>` for every credential; never `String` / `&str` for API keys, tokens, or signing keys. |
=======
| Logging | [logging-go](logging-go.md) | `log/slog` with `slog.NewJSONHandler` + `sync.Once` guard, not stdlib `log` / `fmt.Fprintln(os.Stderr, ...)` / third-party loggers (`zap`, `zerolog`, `logrus`). |
>>>>>>> Stashed changes
| Stack | [stack/defaults](stack/defaults.md) | TanStack / FastMCP / VitePress / xUnit; Rust/Go for tooling; .env always. |
| Time | [time](time.md) | `phenotype_time::{now_unix_ms, now_unix_secs, format_iso8601, parse_iso8601}` for every clock read and timestamp format/parse; no inline `SystemTime::now().duration_since(UNIX_EPOCH)` or `chrono::Utc::now().to_rfc3339()`. |
| Traceability | [traceability/requirements](traceability/requirements.md) | FR/NFR in Tracera + AgilePlus Epic/Story; requirement→code→test→PR. |

These are descriptive of current practice, not aspirational. If a pattern here no longer matches reality, fix the pattern or the practice — don't let them drift.
