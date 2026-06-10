# Patterns Summary

One-pager catalog of every pattern documented under `patterns/`. Read this
when you want a fast map of "what conventions exist and where"; jump to the
linked file for the full rule.

| Pattern | Purpose | Status |
|---------|---------|--------|
| [spine-roles](spine-roles.md) | The 4-role split (index / ADRs / conventions / enforcement) and the authority rule. | adopted |
| [build-verification](build-verification.md) | Every `jobs.<id>` must declare `timeout-minutes:` (default `10`); caps the billable-CI surface. | adopted |
| [parallel-execution](parallel-execution.md) | Worktree-per-subagent: N subagents → N worktrees → N `chore/<repo>-<purpose>-<date>` branches → atomic commits → single sponsor-merge pass. | adopted |
| [architecture/hexagonal](architecture/hexagonal.md) | Ports & adapters; domain has zero external dependencies; dependencies point inward. | adopted |
| [async/event-driven](async/event-driven.md) | Loosely-coupled async messaging via the Phenotype Event Bus (NATS JetStream), with idempotent consumers and DLQs. | adopted |
| [methodology/xdd](methodology/xdd.md) | xDD-first (TDD/BDD/SDD/CDD/DDD/PDD), hexagonal, SOLID/DRY; libify at the 2nd use. | adopted |
| [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) | Wrap existing ecosystem libraries behind ports; LOC reduction is a first-class goal. | adopted |
| [tooling/task-runner](tooling/task-runner.md) | `Justfile` primary, `Taskfile.yml` mirror; scripts >20 lines live in `Tools/*.ps1`. | adopted |
| [delegation/codex-first](delegation/codex-first.md) | codex-spark first channel; disjoint files per worker; per-worker worktrees; never `git stash`. | adopted |
| [ci/never-billable-ci](ci/never-billable-ci.md) | Avoid billable CI minutes; pin runners to `ubuntu-24.04`; SHA-pin third-party actions; least-privilege; sponsor-merge protocol. | adopted |
| [stack/defaults](stack/defaults.md) | TanStack / FastMCP / VitePress / xUnit; Rust or Go for new tooling; `.env` for all config and secrets. | adopted |
| [traceability/requirements](traceability/requirements.md) | FR/NFR in Tracera + AgilePlus Epic/Story; the chain requirement → code → test → PR. | adopted |

## Notes

- All 12 patterns are **descriptive of current practice, not aspirational.**
  If a pattern here no longer matches reality, fix the pattern or the practice
  — don't let them drift.
- Patterns are grouped under `patterns/<category>/<name>.md`. Three patterns
  live at the `patterns/` root because they span categories (`spine-roles`,
  `build-verification`, `parallel-execution`).
- Every pattern file declares a `**Status:**` header. The values you should
  see are `adopted`; `draft` / `deprecated` are reserved for future use and
  are not currently in scope.
