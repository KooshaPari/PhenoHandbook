# Build Verification / CI Timeout Pattern

**Status:** adopted · **Applies to:** every `.github/workflows/*` file (every job, including reusable-workflow calls).

## Overview

Every GitHub Actions job the org runs must declare a `timeout-minutes:` budget, defaulting to **10 minutes**. This page is the canonical place that rule lives; it consolidates the "cap a job's wall clock" guidance that was previously implicit in the `timeout-minutes: 360` (six hours) GitHub leaves as the default, the trust-us-it's-fast cargo shortcuts, and the per-job inherited-timeout holes in the org's workflow tree. The default is short because a job that genuinely needs more than ten minutes has a problem worth naming, not hiding.

If a workflow is added, edited, or vendored, the diff is incomplete without a `timeout-minutes:` line on every `jobs.<id>` block. If a `Cargo.toml` adds `tokio::time::timeout` to wrap a unit test that "occasionally hangs", either fix the workflow (it should have a 10-minute cap that triggers the same path) or update this page — don't fork the rule. The 10-minute default is the wrapper; the job timeout is the enforcement.

This rule was rolled out org-wide in two waves: **PhenoDevOps** (#206, 75 jobs across 41 files) and **HeliosLab** (29 jobs across 17 files). The PhenoHandbook catches up after, in the order the org actually does the work.

## The Rule

| Context | Use | Default | Why |
|---------|-----|---------|-----|
| Every `jobs.<id>` block in every `.github/workflows/*.{yml,yaml}` file under the Phenotype org | `timeout-minutes: 10` | 10 | One default, one canonical budget. A job that runs longer than ten minutes is either hung, looping on a flaky test, or doing work that should be a reusable workflow — and the timeout surfaces all three with a clean failure rather than a six-hour billable run. |
| A job that is **known** to need more than 10 minutes (a full `cargo test --workspace` cold build, a multi-platform matrix `release.yml`, a long-running integration test, a `codeql` analyze of a 100k+ line monorepo) | `timeout-minutes: <explicit budget>` (typically 20–30 for cargo, 360 for `codeql analyze`) | — | The default is a *floor for explicitness*, not a *ceiling*. The point of the rule is that the budget is **named** at the job level, not hidden in the GitHub default. A 30-minute cap on a cold `cargo test --workspace` is fine; an implicit six-hour cap is not. |
| A reusable-workflow `uses:` call (e.g. `phenotype-org-governance/.github/workflows/cargo-deny.yml@…`) | Re-declare `timeout-minutes:` on the **calling** job | 10 | Reusable workflows may set their own internal timeouts, but the caller's job is what GitHub bills. The caller is responsible for the cap. |
| A `matrix` strategy whose per-leg budget is known to vary (e.g. `ubuntu-24.04` legs get 10 minutes, `windows-latest` legs need 30 for MSVC cold builds) | `timeout-minutes:` on each leg via the matrix expression, **not** a single value at the matrix level | 10 per leg | GitHub honours a matrix-level `timeout-minutes`, but the value is one number for all legs. A leg that needs 30 must declare 30 explicitly; the silent default would still be 10. |

**Hard rule:** any `jobs.<id>` block without a `timeout-minutes:` line is a hygiene violation. The default GitHub applies (360 minutes, six hours, billable on Linux runners) is the *wrong default for the org* and is the exact thing the pattern forbids. A job without a `timeout-minutes:` is a job that can run for six hours on a hung cargo build, on a NATS request that never returns, on a flaky test that panics inside a `cargo nextest` retry loop, and on a matrix leg that hangs because one `os:` is misconfigured.

**Hard rule:** a workflow with no `timeout-minutes:` on any job is a workflow that will silently incur six-hour billable runs the first time something goes wrong. The cap is per-job, not per-workflow, and the cap is mandatory, not default.

**Hard rule:** `timeout-minutes: 0` is forbidden. GitHub treats `0` as "no timeout", the same as omitting the field. A `0` is a "fix the lint" trap, not a "disable the cap" knob. If a job genuinely should not have a cap, the right answer is to document the reason in a code comment **and** set an explicit value, not to set `0`.

**Hard rule:** silently inheriting a cap from a reusable workflow (i.e. the caller does not set `timeout-minutes:` because the called workflow sets one internally) is forbidden. The caller's job is the billing boundary; the caller is responsible for the cap. Re-declare on every `uses:` call.

## Canonical Pattern

### A standard CI job

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-24.04
    timeout-minutes: 10           # canonical default for a fast job
    steps:
      - uses: actions/checkout@v6
      - run: just lint

  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    strategy:
      matrix:
        crate: [core, api, worker]
    steps:
      - uses: actions/checkout@v6
      - run: cargo test -p ${{ matrix.crate }}

  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - run: cargo build --release
```

### A long-running job that needs an explicit, larger budget

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 30           # cold --release build of the full monorepo
    steps:
      - uses: actions/checkout@v6
      - run: cargo build --release --workspace
      - run: cargo test --release --workspace

  publish:
    runs-on: ubuntu-24.04
    timeout-minutes: 15           # publish is I/O-bound; the budget is for the
    needs: [build]                #   registry round-trips, not the cargo work
    steps:
      - uses: actions/checkout@v6
      - run: cargo publish --workspace --token ${{ secrets.CARGO_TOKEN }}
```

### A CodeQL job with its known multi-hour budget

```yaml
# .github/workflows/codeql.yml
jobs:
  analyze:
    runs-on: ubuntu-24.04
    timeout-minutes: 360          # CodeQL's own recommendation; left explicit
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v6
      - uses: github/codeql-action/init@v3
      - uses: github/codeql-action/analyze@v3
```

### A reusable-workflow caller

```yaml
# .github/workflows/quality-gate.yml
jobs:
  cargo-deny:
    uses: phenotype-org-governance/.github/workflows/cargo-deny.yml@main
    with:
      config: deny.toml
    timeout-minutes: 10           # caller is the billing boundary; declare it

  scorecard:
    uses: phenotype-org-governance/.github/workflows/scorecard.yml@main
    with:
      target_branch: main
    timeout-minutes: 15           # scorecard's SARIF upload needs the headroom
```

Conventions (lifted from the org's rollout waves):

- `timeout-minutes:` is the second-level key on the `jobs.<id>` block, immediately after `runs-on:` (the common case from the PhenoDevOps wave) or before `uses:` (for reusable-workflow callers — the `coverage` / `promote` / `release/gate-check` shape from the same wave). The exact insertion point does not matter; the presence of the line does.
- The value is an integer, not a string, and is bounded `[1, 360]`. `0` is forbidden; a fractional value (e.g. `0.5`) is forbidden; a value above `360` is forbidden.
- The default is `10` for every job that is not the named-exception list (`codeql analyze`, large `cargo test --workspace` cold builds, anything that crosses the 10-minute mark in the org's median run).
- The default is *also* `10` for a job that runs in under a minute. The whole point of the rule is that the budget is named; the budget being lenient is fine, the budget being absent is the violation.
- A `matrix` leg inherits the matrix-level `timeout-minutes:` if the leg does not set its own. Per-leg overrides are allowed and encouraged when the leg is known to need more (e.g. `windows-latest` for MSVC cold builds, `macos-latest` for codesigning).
- A `timeout-minutes:` cap interacts with `concurrency.cancel-in-progress: true` exactly as expected: a superseded run is cancelled at the GitHub level, and the `timeout-minutes:` cap is the *worst case* if the cancel does not fire. The two settings are complementary, not redundant.

## Reference: the two rollout waves

| Repo | Scope | Commit / PR | Files | Jobs | Notes |
|------|-------|-------------|-------|------|-------|
| **PhenoDevOps** | `.github/workflows/*` (all files) | `b5b43bf` — "ci: add timeout-minutes: 10 to all jobs lacking a timeout" (PR #206) | 41 files | 75 jobs | Insertion points used by the wave: after `runs-on:` (common), before `uses:` (reusable), before the first property (jobs with no `runs-on`, e.g. `ci/buf`). 4 jobs that already had explicit timeouts (`sast-full` `codeql` / `full-semgrep`, `sast-quick` `semgrep` / `secrets`) were left untouched. Pure additive change; YAML syntax verified across all 42 files. |
| **HeliosLab** | `.github/workflows/*` (all files) | `82acde5` — "chore(ci): add timeout-minutes: 10 to all jobs in HeliosLab workflows" (branch `chore/helioslab-timeout-minutes-20260608`) | 17 files | 29 jobs | Mirrors the PhenoDevOps wave on a separate repo. `codeql-rust.yml::analyze` already had a 360-minute timeout and was left as-is. Verification: `yaml.safe_load` round-trip parse 18/18 OK; `yamllint` line count 48 before == 48 after (no new issues). |
| **PhenoHandbook** | `.github/workflows/*` | (this page) | (this page introduces the pattern; the rollout is tracked separately) | — | The handbook documents the rule; the rule is enforced repo-by-repo, not centrally. |

The numbers come from `git show --stat` on each commit. PhenoDevOps: 41 changed files, 75 added `timeout-minutes:` lines. HeliosLab: 17 changed files, 29 added `timeout-minutes:` lines. If a future wave patches a different repo, add a row to this table and link the commit / PR.

## Anti-Patterns

- ❌ A `jobs.<id>` block with no `timeout-minutes:` line — silently inherits GitHub's six-hour (360-minute) default, which is the wrong cap for the org. A hung `cargo test`, a NATS request that never returns, a flaky `cargo nextest` retry loop, or a misconfigured `os:` matrix leg will all bill for six hours before failing. Add `timeout-minutes: 10` (or the explicit larger budget the job actually needs).
- ❌ `timeout-minutes: 0` — treated by GitHub as "no timeout", the same as omitting the field. A `0` is a "fix the lint" trap, not a "disable the cap" knob. If a job genuinely should run for an unbounded time, document the reason in a code comment **and** set an explicit value, not `0`.
- ❌ `timeout-minutes: '10'` (string-quoted) — YAML accepts the value either as an integer or as a string-coerced integer, but the integer form is the convention. Quote your integers only when you also need a templated expression like `${{ matrix.timeout }}`; the literal `10` is an integer.
- ❌ A workflow-level `timeout-minutes:` with no per-job `timeout-minutes:` — a workflow-level cap is a *fallback*; the per-job cap is the *contract*. A workflow-level cap that masks a per-job cap of 6 hours gives the appearance of a budget without the enforcement. Set the cap on every job; the workflow-level cap (when used) is the *outer* bound, not the only one.
- ❌ A reusable-workflow caller with no `timeout-minutes:` because the called workflow sets one internally — the caller's job is the billing boundary. The reusable workflow's internal cap is for the reusable's *own* jobs; the caller pays for the caller's wall clock. Re-declare `timeout-minutes:` on every `uses:` call.
- ❌ A `matrix` strategy that sets `timeout-minutes:` at the matrix level but not per-leg, with the assumption that the matrix-level value covers all legs — it does, but the per-leg override is the *explicit* path. A leg that needs 30 (a `windows-latest` MSVC cold build) should declare 30 explicitly; the silent default would still be 10. Use a matrix expression (`timeout-minutes: ${{ matrix.os == 'windows-latest' && 30 || 10 }}`) when the per-leg budget is known.
- ❌ Hand-rolling a `timeout-minutes` substitute in shell (`timeout 600 cargo test`, `gtimeout 600 …` on macOS runners) — duplicates GitHub's own cap with a different kill signal (SIGTERM vs. SIGKILL, no cause-chain log, no matrix-aware override), and bypasses the workflow's `concurrency.cancel-in-progress` path. Use `timeout-minutes:` at the job level; let GitHub do the killing.
- ❌ Wrapping a unit test in `tokio::time::timeout` (or `std::time::Duration::checked_add`) inside the *step* to "save CI time" — a 10-minute `timeout-minutes:` on the job is the *correct* enforcement layer; a per-test timeout is a *complement* for flaky test detection, not a replacement for the job-level cap. Use both, with the per-test timeout shorter than the job cap, but never *instead* of the job cap.
- ❌ Setting `timeout-minutes: 360` on a fast job (a lint, a `cargo check`, a `cargo test -p small-crate`) "to be safe" — the cap should match the *expected* wall clock with a small safety margin, not the maximum GitHub allows. A 10-minute cap on a 30-second job is the canonical default; a 360-minute cap is the codeql exception, not the default.
- ❌ Inheriting a job-level `timeout-minutes:` from a *different* job in the same workflow (e.g. "the `lint` job has 10 minutes, so the `test` job inherits 10 minutes") — GitHub does not inherit job-level timeouts across jobs. Every `jobs.<id>` block is its own scope. Set the cap on every job; do not assume inheritance.

## Migration Checklist (per repo / per workflow)

1. List every file under `.github/workflows/` (`find .github/workflows -name '*.yml' -o -name '*.yaml'`). Each file is in scope; the rule is per-file, not per-workflow.
2. For every `jobs.<id>` block, check whether a `timeout-minutes:` line is present. If not, add one. Use `timeout-minutes: 10` unless the job is in the named-exception list (`codeql analyze`, large `cargo test --workspace` cold builds, anything that crosses the 10-minute mark in the org's median run).
3. For a job that calls a reusable workflow (`uses: org/repo/.github/workflows/x.yml@…`), re-declare `timeout-minutes:` on the calling job. The caller's job is the billing boundary; the reusable's internal cap is for the reusable's own jobs.
4. For a `matrix` strategy, declare `timeout-minutes:` on the matrix (the simpler case) **or** per-leg via a matrix expression (the explicit case). Per-leg is preferred when the leg's budget is known to vary.
5. Verify with `python3 -c 'import yaml, sys; list(yaml.safe_load_all(open(sys.argv[1])))' .github/workflows/<file>.yml` (or `yq eval`) that the file still parses. The `timeout-minutes:` line is additive; the diff should be a pure-insertion patch.
6. Verify with `yamllint .github/workflows/<file>.yml` (or the org's lint config) that no new warnings are introduced. The PhenoDevOps and HeliosLab waves both held the line count stable (`48 before == 48 after` in the HeliosLab case).
7. Open a PR with a title that names the rule (`ci: add timeout-minutes: 10 to all jobs lacking a timeout` is the PhenoDevOps wording; `chore(ci): add timeout-minutes: 10 to all jobs in <repo> workflows` is the HeliosLab wording). Reference this pattern in the PR body.

## Related Patterns

- [ci/never-billable-ci](ci/never-billable-ci.md) — the broader CI-hygiene rule: avoid billable minutes, pin runners to `ubuntu-24.04`, SHA-pin third-party actions, use least-privilege `permissions:`, and add `concurrency.cancel-in-progress`. The `timeout-minutes:` cap is one slice of that billable-minutes surface; the two are complementary (a six-hour run that gets cancelled at the 10-minute mark is still a six-hour *budget* if the cancel does not fire).
- [ci/never-billable-ci — Sponsor-merge protocol](ci/never-billable-ci.md#sponsor-merge-protocol) — the path for a PR that is green but blocked by required-review protection. The two rollout waves (`PhenoDevOps` #206, `HeliosLab` `chore/helioslab-timeout-minutes-20260608`) both used this path because the patches are pure-additive and the test surface is the next CI run, not a code review.
- [tooling/task-runner](tooling/task-runner.md) — the `just` / `task` / `Tools/*.ps1` split. A `just lint` step that takes 30 seconds does not need a 30-minute `timeout-minutes:`; a `just test` step that takes 8 minutes does. The pattern's default (`10`) is the safety margin for the longest `just` step the org has shipped, not a one-size-fits-all.
- [architecture/hexagonal](architecture/hexagonal.md) — the same "wrapper over a third-party primitive" shape. `phenotype-time` wraps `chrono`; `phenotype-retry` wraps `tokio` + `backoff`; the build-verification pattern wraps GitHub's own `timeout-minutes:` cap (and the org's own implicit "every job needs a cap" rule) in a single, named, auditable default.

## References

- [GitHub Actions: `jobs.<job_id>.timeout-minutes`](https://docs.github.com/en/actions/using-jobs/setting-a-timeout-for-a-job) — the official field reference. Default is 360 minutes; valid range is `[1, 360]` for hosted runners; the org's default of 10 is well within range.
- [GitHub Actions: Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions) — the top-level `timeout-minutes` (workflow scope) and the job-level `timeout-minutes` (job scope) are independent; the job-level cap is the one this pattern governs.
- [GitHub Actions: Usage limits, billing, and administration](https://docs.github.com/en/actions/learn-github-actions/usage-limits-billing-and-administration) — the billable-minutes surface. A six-hour job that hangs is the worst-case line item on a free-tier runner; the 10-minute cap is the difference between a $0.008/minute run and a $0.008/minute run that ends after 10 minutes.
- Internal: PhenoDevOps commit `b5b43bf` ("ci: add timeout-minutes: 10 to all jobs lacking a timeout", PR #206) — the first rollout wave. 75 jobs across 41 files. Insertion-point matrix (after `runs-on:`, before `uses:`, before the first property) is the org's reference for future waves.
- Internal: HeliosLab commit `82acde5` ("chore(ci): add timeout-minutes: 10 to all jobs in HeliosLab workflows", branch `chore/helioslab-timeout-minutes-20260608`) — the second rollout wave. 29 jobs across 17 files. Verification recipe (`yaml.safe_load` round-trip + `yamllint` line-count stability) is the org's reference for future waves.
- Internal: `.github/workflows/` in every Pheno\* repo — the in-scope tree. A new workflow file is automatically in scope; the rule is enforced by the org's review checklist, not by a central linter (yet).
