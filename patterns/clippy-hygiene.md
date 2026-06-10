# Clippy Hygiene: workspace clean, deny-by-default for shared rules

**Status:** adopted · **Applies to:** every Rust crate / workspace in the Pheno* ecosystem (binary, library, example, test, bench — `--all-targets`).

## Overview

Every Rust workspace the org ships must pass `cargo clippy --workspace --all-targets -- -D warnings` with **zero** output, every PR, every merge, every `cargo build` invocation. This page is the canonical place that rule lives; it consolidates the "treat clippy warnings as errors" guidance that was previously implicit in the `cargo clippy 2>/dev/null` shortcuts, the `// TODO clippy` comments scattered across adapters, and the per-repo `RUSTFLAGS="-D warnings"` invocations that were never consistent across the fleet.

If a Rust crate is added, edited, or vendored, the diff is incomplete without `cargo clippy --workspace --all-targets -- -D warnings` returning exit code 0. If a `Cargo.toml` adds a per-crate `[[example]] name = "ok_to_have_warnings"` shape, a `#[allow(clippy::...)]` blanket on the crate root, or a `[lints.clippy]` section that downgrades a `deny` to `warn`, either fix the crate or update this page — don't fork the rule. The workspace is the wrapper; the wrapper is the place shared rules live.

This rule was rolled out org-wide in wave 3 (2026-06-08 / 2026-06-09) across **PhenoVCS**, **PhenoRuntime**, **PhenoMCP**, **PhenoAgent**, **PhenoPlugins**, and **Eidolon**. PhenoHandbook catches up after, in the order the org actually does the work.

## The Rule

| Context | Command / Config | Default | Why |
|---------|------------------|---------|-----|
| Local verification of any Rust workspace before `git commit` | `cargo clippy --workspace --all-targets -- -D warnings` | exit code 0 | `--workspace` covers every member crate; `--all-targets` covers `lib`, `bin`, `examples`, `tests`, `benches`; `-D warnings` escalates every warning to a hard error. One command, one exit code, one source of truth. |
| The CI gate on every PR and push to `main` | `cargo clippy --workspace --all-targets -- -D warnings` in a `lint` / `quality-gate` / `ci` job | exit code 0 | The CI job is the contract. A "clippy passes locally but breaks CI" outcome means the local and CI invocations disagree about something — usually the toolchain pin, the `rust-toolchain.toml` channel, or the `clippy.toml` `msrv`. Fix the divergence, don't disable the gate. |
| Shared lint rules that should be uniform across the workspace (currently `clippy::needless_return`) | `[workspace.lints.clippy] needless_return = "deny"` in the root `Cargo.toml`, plus `lints.workspace = true` in every member crate | `deny` | One place to change the rule, every crate inherits it. A new member crate that forgets the `lints.workspace = true` line silently drops the rule; the pre-commit / CI gate catches the regression. |
| A lint that is repo-local (a `clippy.toml` `msrv` override, a `disallowed-types = [...]` for an internal anti-pattern) | `clippy.toml` at the workspace root | — | `clippy.toml` is the stable surface for `msrv`, `avoid-breaking-exported-api`, `allow-dbg-in-tests`, `allow-print-in-tests`, and the `disallowed-*` lists. It is **not** the place for lint *severity* (that's `[workspace.lints.clippy]`); the two files are not interchangeable. |
| A test, example, or benchmark that legitimately needs a `println!` / `dbg!` for setup or diagnostics | `#[allow(clippy::print_stdout, clippy::dbg_macro)]` on the specific function — **never** on the whole crate | — | `clippy.toml` already has `allow-dbg-in-tests = true` and `allow-print-in-tests = true` for the test build. Outside the test build, the rule is a real warning and a per-function `#[allow]` documents the exception at the call site. |
| A vendored dependency that emits clippy warnings (an `aws-lc-sys` FFI, a `git2` binding) | The dependency's crate; the warning is **not** the org's problem to fix | — | Clippy only runs on the org's crates. Third-party warnings show up in the org's `cargo build` output but are **not** linted by `cargo clippy --workspace --all-targets` unless the org has `RUSTFLAGS="--warn clippy::all"` set explicitly. Don't `#[allow(...)]` the third-party crate at the call site; that's a vendoring anti-pattern. |

**Hard rule:** `cargo clippy --workspace --all-targets` without `-D warnings` is forbidden as a verification step. The default level is `warn`, which is the wrong severity for a CI gate. A warning that is allowed to remain a warning is a warning that is allowed to accumulate. The `-D warnings` flag is the contract.

**Hard rule:** a `#[allow(clippy::...)]` on the crate root (`lib.rs` / `main.rs`) is forbidden. The crate root is the wrong granularity — it allows the lint on every module in the crate, including modules that should not have the exception. The `#[allow]` belongs on the specific `fn` / `impl` / `mod` that legitimately needs it, with a code comment explaining the exception. A future reader of the file should be able to grep for `#[allow(clippy::` and audit every site in one pass; a crate-root allow is invisible to that audit.

**Hard rule:** a `[lints.clippy]` section in a member crate that overrides the workspace's `deny` to `warn` is forbidden. The whole point of `[workspace.lints.clippy]` is that one place owns the severity. A member-crate override forks the rule. If a member crate genuinely needs a different severity, the seam is to add the new severity to the workspace table, not to override it locally.

**Hard rule:** `cargo clippy 2>/dev/null` (or any redirection that hides the warning text) is forbidden as a verification step. The exit code is not the only signal — the warning *text* is what tells the next contributor what the regression is. If a job is failing on `-D warnings` and you can't see the warning, you've hidden the diagnostic the next person needs.

## Canonical Pattern

### Workspace root `Cargo.toml`

```toml
# Cargo.toml (workspace root)
[workspace]
members = [
  "crates/<name-a>",
  "crates/<name-b>",
]
resolver = "2"

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT OR Apache-2.0"
rust-version = "1.75"

# Wave 3: the canonical place to declare org-wide clippy severities.
# A member crate that wants to inherit this declares
# `lints.workspace = true` in its own [package] (see below).
[workspace.lints.clippy]
needless_return = "deny"
```

Conventions:

- `[workspace.lints.clippy]` is the *only* place a clippy severity is `deny`'d for the whole workspace. Adding a new `deny` (e.g. `pedantic = { level = "deny", priority = -1 }` for an opt-in pedantic pass) is a one-line change to this table. The pattern is the wrapper; the wrapper is the place shared rules live.
- `resolver = "2"` (or `"3"` for edition 2024) is required for `[workspace.lints]` to be inherited correctly by member crates. Without a resolver declaration, older Cargo versions silently ignore the `lints.workspace = true` inheritance, and the member crate reverts to its own (empty) `[lints]`.
- `rust-version` in `[workspace.package]` is the `msrv` the org pins; `clippy.toml`'s `msrv` must match it. A mismatch (`rust-version = "1.75"` in `Cargo.toml`, `msrv = "1.85"` in `clippy.toml`) escalates to a build failure on `-D warnings` because clippy emits `clippy::incompatible_msrv` on the offending crate. This is the exact failure PhenoRuntime hit in `chore(clippy): resolve workspace clippy warnings` (986e11d); the fix is a local `clippy.toml` that pins the local MSRV, not a downgrade of the org MSRV.
- The PhenoVCS wave-3 commit `2bdda2e` is the canonical example: `[workspace.lints.clippy] needless_return = "deny"` in `PhenoVCS/Cargo.toml` plus `lints.workspace = true` in every member crate's `[package]`.

### Member crate `Cargo.toml`

```toml
# crates/<name>/Cargo.toml (member crate)
[package]
name = "<name>"
version = "0.1.0"
edition = "2021"
license = "MIT OR Apache-2.0"
rust-version = "1.75"

# Wave 3: opt the member crate into the workspace's [workspace.lints].
# Without this line, the member crate sees an empty [lints] and the
# workspace's `deny` rules are silently dropped.
[lib]
path = "src/lib.rs"

[lints]
workspace = true
```

Conventions:

- `lints.workspace = true` is the only line a member crate needs in `[lints]`. Don't redeclare `clippy = { ... }` blocks at the member level; that forks the rule. If a member crate needs a *local* exception (a `clippy::needless_return` allow on a single `fn`), the exception is a `#[allow(clippy::needless_return)]` on the function, not a new entry in the member crate's `[lints]`.
- A binary crate (`[[bin]]`) inside a workspace inherits `lints.workspace = true` the same way as a library crate — there is no separate "bin-level lints" surface. The same `[lints]` section above applies to `crates/<name>/src/main.rs`.
- An example, a test, or a benchmark is part of `--all-targets`; the same inheritance applies. There is no per-target lints configuration; a workspace's `deny` covers every target.

### Workspace root `clippy.toml`

```toml
# clippy.toml (workspace root)
# Phenotype-org standard clippy config
msrv = "1.75"
avoid-breaking-exported-api = true
allow-dbg-in-tests = true
allow-print-in-tests = true
disallowed-methods = []
disallowed-types = []
disallowed-macros = []
```

Conventions:

- `msrv` in `clippy.toml` must equal `rust-version` in `[workspace.package]`. A mismatch is a `clippy::incompatible_msrv` failure on `-D warnings` and a hard build error. PhenoRuntime's `986e11d` added a PhenoRuntime-local override for exactly this reason (the root crate declares `rust-version = "1.85"` for edition 2024, and the org baseline is 1.75; the local override pins the local MSRV to match the local declaration).
- `avoid-breaking-exported-api = true` is the org's default. It asks clippy to skip lints that would force a breaking API change. New clippy lints that target a public API surface are deferred to the next major version, not flagged on the current `main`.
- `allow-dbg-in-tests = true` and `allow-print-in-tests = true` are the org's concessions to the test build. The `cargo test` invocation emits a *lot* of `println!` and `dbg!` diagnostics; allowing them inside the test build keeps the test output useful without leaking `println!` into the library build. They are **not** "allow everywhere" flags; outside the test build, `clippy::print_stdout` and `clippy::dbg_macro` are still warnings.
- The `disallowed-*` lists are the org's extension point. A `disallowed-types = ["std::sync::Mutex"]` (or similar) declares an org-wide ban; the `Cargo.toml` `[workspace.lints.clippy]` table declares the *severity*. The two files are not interchangeable; the rule for which file owns which setting is: *"severity of a lint I want to keep" → `Cargo.toml`; "ban on a thing I want gone" → `clippy.toml`.*

### CI workflow

```yaml
# .github/workflows/quality-gate.yml
permissions:
  contents: read

name: Quality Gate

on:
  pull_request:
  push:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  rust:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@<sha>

      - name: Run tests
        run: cargo test --workspace

      - name: Run clippy
        run: cargo clippy --workspace --all-targets -- -D warnings

      - name: Check formatting
        run: cargo fmt --all -- --check
```

Conventions:

- `--workspace --all-targets` are both mandatory. `--workspace` is the alias for `--all` on a workspace `Cargo.toml`; together with `--all-targets` it covers every member crate, every `lib` / `bin` / `example` / `test` / `bench`. A CI job that drops `--workspace` and runs `cargo clippy --all-targets -- -D warnings` from a member crate is missing the other member crates; a job that drops `--all-targets` is missing the test build. The org standard is both.
- `-D warnings` is the contract. A `cargo clippy --workspace --all-targets` job without `-D warnings` would treat warnings as non-fatal, which is the wrong severity for a CI gate. The job fails on the first warning, and the warning's text is the diagnostic.
- `cargo fmt --all -- --check` is a sibling gate, not part of the clippy rule. A repo that passes clippy clean but fails `cargo fmt` is still a hygiene violation, but it is the `formatting` rule, not the `clippy -D warnings` rule. The two are deliberately separate; do not collapse them into a single job step.
- `permissions: contents: read` is the [CI hygiene](ci/never-billable-ci.md) baseline. The clippy job reads the repo and runs a build; it does not need write access. Least-privilege applies here.
- `concurrency: { group: ..., cancel-in-progress: true }` is also the CI hygiene baseline. A superseded PR's clippy job is cancelled the moment a new push lands; a 20-minute cold build does not run twice for a stale SHA.
- The `dtolnay/rust-toolchain` action with the org-pinned SHA is the toolchain source. The `rust-toolchain.toml` at the workspace root pins the channel; the action reads it and installs the matching toolchain. A workflow that hard-codes `channel: stable` instead of letting `rust-toolchain.toml` decide will silently drift from the local dev environment on a toolchain bump.

## Reference: Wave 3 Cleanup

The six repos that landed the wave-3 clippy cleanup, with the canonical commit and the specific lints that were fixed:

| Repo | Commit | What changed | Lints touched |
|------|--------|--------------|----------------|
| **PhenoVCS** | `2bdda2e` — `chore(clippy): deny needless_return by default in workspace` | Added `[workspace.lints.clippy] needless_return = "deny"` to the root `Cargo.toml`, plus `lints.workspace = true` in both member crates (`pheno-vcs-core`, `worktree-manager`). The codebase already avoided needless returns; the change is a guard rail against regressions. | `clippy::needless_return` (rule set) |
| **PhenoRuntime** | `986e11d` — `chore(clippy): resolve workspace clippy warnings` | (1) Dropped a trivial `assert!(true, ...)` in `tests/smoke_test.rs` that triggered `clippy::assertions_on_constants`. (2) Replaced `|args| Ok(args)` with the tuple-variant `Ok` in `crates/phenotype-mcp-server`'s `test_register_and_call` to clear `clippy::redundant_closure`. (3) Added a PhenoRuntime-local `clippy.toml` that pins `msrv = "1.85"` to match the root `Cargo.toml`'s `rust-version = "1.85"`. | `clippy::assertions_on_constants`, `clippy::redundant_closure`, `clippy::incompatible_msrv` (the local-MSRV fix) |
| **PhenoMCP** | `f0a8dea` — `chore(phenomcp): fix clippy warning + unblock workspace build` | (1) `crates/pheno-meilisearch/src/lib.rs:279` — replaced `client.health().await.is_ok() \|\| true` (a logic bug that always passed the assertion) with `let _ =` to exercise the call without asserting success. (2) Bumped `surrealdb` from `=3.0.5` to `=3.1.2` to match `surrealdb-core 3.1.2` already in `Cargo.lock`; a 3.0.5 source calls `Datastore::index_compaction` with 2 args but the 3.1.2 core requires 3 args (a `CancellationToken`). The clippy gate would have escalated this to a build failure. | (Build failure escalated by `-D warnings`; the assertion was flagged separately) |
| **PhenoAgent** | `0958f54` — `phenotype-daemon: fix clippy -D warnings` | (1) Removed `ConnectionStats`, `DEFAULT_SOCKET_PATH`, `DEFAULT_TCP_PORT` from `protocol.rs` (dead code, never constructed / never referenced). (2) Removed the `resolver` field from `rpc.rs` and dropped the unused `DependencyResolver` import (dead code, never read). (3) Annotated `max_size`, `begin_sandbox`, `SandboxGuard` with `cfg_attr(not(test), allow(dead_code))` so the bin build is clean and the test build sees them as live code. (4) `#[allow(clippy::large_enum_variant)]` on `Request::SkillRegister` and `Response::Skill` in `protocol.rs` (the variant is 304 bytes inline; boxing would change the on-the-wire JSON shape and add a heap allocation per RPC). Trade-off documented in a doc comment. | `clippy::dead_code` (8 instances on the bin + 6 on the test build), `clippy::large_enum_variant` |
| **PhenoPlugins** | `05bf09d` — `chore(PhenoPlugins): clippy-clean + fix pre-existing git2 API breakage` | (1) Repaired 6 E0308 / E0593 errors in `pheno-plugin-git` against `git2 0.21` (`Result<StringArray, _>` vs `Result<&[String], _>`, `Reference::shorthand` now returns `Result<&str, _>`). (2) Collapsed a redundant `\|e\| PluginError::Io(e)` closure in `pheno-plugin-git` flagged by `clippy::redundant_closure`. (3) Replaced field-by-field reassignment after `Default::default()` with struct-update syntax in `pheno-plugin-vessel`'s `test_service_dependencies` (`clippy::field_reassign_with_default`). (4) Dropped the `phenotype-test-support` dev-dep that pointed at the missing `phenoShared/crates/phenotype-test-support` and re-vendored the BDD step body into `tests/bdd/steps.rs` so `cucumber`, `uuid`, and `criterion` are usable from `PhenoPlugins` standalone. `cargo test --workspace`: 48 passed, 0 failed. | `clippy::redundant_closure`, `clippy::field_reassign_with_default`, plus the 6 type errors that `-D warnings` escalated to build failures |
| **Eidolon** | `9288507` — `chore(eidolon-desktop): drop unused Viewport import to satisfy clippy -D warnings` | Removed one unused `Viewport` import in `crates/eidolon-desktop/tests/test_desktop.rs`. One-line change, but it is the canonical example of "the smallest possible clippy gate regression": a renamed symbol in an upstream crate leaves a downstream test with an unused import, and the gate fails on the import. The fix is to delete the import; the lesson is to run the gate on the test build, not just the lib build. | `clippy::unused_imports` |

If a Rust crate is added to the org and the wave-3 clippy gate is in place, the work to make it pass follows the same five-step loop: (1) add `[workspace.lints.clippy]` to the root `Cargo.toml` if missing; (2) add `lints.workspace = true` to the new member crate's `[lints]`; (3) run `cargo clippy --workspace --all-targets -- -D warnings` and read the warnings; (4) fix every warning at the call site (the default is a per-`fn` / per-`impl` fix, not a crate-root allow); (5) if a warning is a *false positive* for the org's use case, add the `#[allow]` at the call site with a code comment, and update the canonical table above in the same PR. The post-condition is the same as for the wave-3 repos: `cargo test --workspace` passes, and `cargo clippy --workspace --all-targets -- -D warnings` returns exit code 0.

## Anti-Patterns

- ❌ `cargo clippy 2>/dev/null` (or any output suppression) as a CI step — the exit code is not the only signal. The warning *text* is the diagnostic the next contributor needs to fix the regression. A failing build with a hidden warning is a failing build that nobody can fix.
- ❌ `cargo clippy --workspace --all-targets` (no `-D warnings`) — the default severity is `warn`, which is the wrong gate. A warning that is allowed to remain a warning is a warning that is allowed to accumulate, and the next contributor has no signal that their change introduced a new one. Always `-D warnings`.
- ❌ `#[allow(clippy::...)]` on the crate root (`lib.rs` / `main.rs`) — the wrong granularity. The crate-root allow makes the lint invisible across every module in the crate, including modules that should not have the exception. A future reader cannot grep-and-audit the exceptions; the allow is silent. Per-function `#[allow]` with a code comment is the contract.
- ❌ `[lints.clippy]` in a member crate that downgrades a workspace `deny` to `warn` — forks the rule. The whole point of `[workspace.lints.clippy]` is that one place owns the severity. A member-crate override means the org's `[lints]` table is no longer the source of truth; the audit has to read every member crate.
- ❌ `[lints]` in a member crate that re-declares a workspace rule (e.g. `clippy.needless_return = "deny"` at the member level) — duplicates the rule. A future change to the workspace table is silently shadowed by the member-level re-declaration. `lints.workspace = true` is the only line a member crate should have.
- ❌ Running `cargo clippy` only on the lib build (dropping `--all-targets`) — the test build, the example build, and the bench build each have their own clippy output. A `-D warnings` gate on just `cargo clippy` (which defaults to the lib build) misses `clippy::unused_imports` in `tests/`, `clippy::needless_pass_by_value` in `examples/`, and the entire `benches/` tree. `--all-targets` is mandatory.
- ❌ Running `cargo clippy` only on a single member crate (dropping `--workspace`) — the other member crates have their own warnings, and the gate is per-workspace. A multi-crate workspace that runs clippy per-crate must N-times the CI runtime, and a PR that breaks one crate's gate but is reviewed from a different crate's CI log slips through. `--workspace` is mandatory.
- ❌ `RUSTFLAGS="-D warnings"` as a global "turn everything into an error" — the wrong tool. `-D warnings` is a cargo-flag on the `cargo clippy` invocation; `RUSTFLAGS="-D warnings"` makes `rustc` deny warnings during the *build*, which escalates *non-clippy* lints (e.g. `dead_code`, `unused_variables` from `rustc` itself) to errors. The two flags are not interchangeable; the clippy gate is `cargo clippy -- -D warnings`, not `RUSTFLAGS="-D warnings"`.
- ❌ A `clippy.toml` `msrv` that disagrees with `[workspace.package].rust-version` — escalates to a build failure on `-D warnings` via `clippy::incompatible_msrv`. PhenoRuntime's `986e11d` added a local `clippy.toml` to pin the local MSRV (1.85) to match the local `rust-version` (1.85). The seam for an MSRV mismatch is a local `clippy.toml`, not a downgrade of the workspace `rust-version` and not a member-crate `[lints]` override.
- ❌ `cargo clippy --fix --allow-dirty --allow-staged` followed by `git commit` without reading the diff — the `--fix` mode silently changes code, and the changes are not always what the lint intended (e.g. `clippy::needless_borrow` "fixes" can change a `&T` to a `T` parameter and shift ownership in ways the call site did not expect). Always `cargo clippy --fix`, then `git diff`, then `git commit`. The `--allow-dirty` / `--allow-staged` flags exist for the read-the-diff workflow; they are not a license to skip the read step.

## Related Patterns

- [ci/never-billable-ci](ci/never-billable-ci.md) — the CI hygiene baseline that the clippy gate runs on top of. The `concurrency: cancel-in-progress: true` and the `permissions: contents: read` are the CI hygiene rules; the `cargo clippy --workspace --all-targets -- -D warnings` step is the clippy rule. The two compose: a clippy job that violates CI hygiene is still a hygiene violation.
- [methodology/xdd](methodology/xdd.md) — xDD-first means the test is the spec. A clippy gate that is not part of the test loop is a gate that drifts. The clippy job runs in CI; a PR that does not pass `cargo clippy` locally before pushing will fail CI, which is the same loop the test runner enforces. The "test" of the clippy rule is the CI job; treat it as a test.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `[workspace.lints.clippy]` is the org's wrapper around the clippy ecosystem's `deny` rules. A member crate that hand-rolls a `[lints]` table forks the wrapper. A repo that adds a new `clippy.toml` setting (a `disallowed-methods` list) is extending the wrapper, and the extension is welcome — the seam is the workspace `clippy.toml`, not the member crate.
- [architecture/hexagonal](architecture/hexagonal.md) — the clippy gate is an *adapter-level* concern. A clippy lint that targets the domain layer (a `clippy::module_name_repetitions` on a domain type) is still a domain-level decision; the gate surfaces it. The hexagonal rule is "domain depends on ports, not on adapters"; the clippy rule is "the workspace compiles clean". They compose: a hex-shaped repo that fails clippy is a hex-shaped repo with a build issue.
- [spine-roles](spine-roles.md) — PhenoHandbook is the **CONVENTIONS** repo. The clippy rule is a convention (a documented way of working); the `[workspace.lints.clippy]` table in a member crate is the *enforcement* of the convention. The convention lives here, the enforcement lives in the member crate's `Cargo.toml`, and the test is the CI job. A new clippy rule added to the convention but missing from a member crate's `[lints]` is a convention-without-enforcement, which is the exact spine violation the 4-role split is designed to prevent.

## References

- [`cargo clippy` documentation](https://doc.rust-lang.org/cargo/) — the `--workspace`, `--all-targets`, and `-- -D warnings` flag shapes. The three flags are the contract; each one is mandatory in the org's CI.
- [`[workspace.lints]` RFC 2906](https://rust-lang.github.io/rfcs/2906-cargo-workspace-doesnt-have-exists-purely-for-the-rename-of-the-workspace-lints-table.html) — the design rationale for workspace-level lints and member-crate `lints.workspace = true` inheritance. The shape used here (root `[workspace.lints.clippy]` + per-member `lints.workspace = true`) is the cargo-stable form of the proposal; the pre-RFC shape (`[workspace.metadata]` + per-crate `clippy.toml`) is deprecated.
- [`clippy.toml` reference](https://doc.rust-lang.org/clippy/configuration.html) — the `msrv`, `avoid-breaking-exported-api`, `allow-dbg-in-tests`, `allow-print-in-tests`, `disallowed-methods`, `disallowed-types`, `disallowed-macros` settings. These are the org's `clippy.toml` baseline; new settings are added by extending the workspace root `clippy.toml`, not by adding a per-crate `clippy.toml`.
- Internal: wave-3 commits, the source of the six reference implementations above. If a new member crate is added to the org, the work to bring it into the wave-3 standard is the five-step loop in the `## Reference: Wave 3 Cleanup` section, and the post-condition is `cargo clippy --workspace --all-targets -- -D warnings` returns exit code 0.
