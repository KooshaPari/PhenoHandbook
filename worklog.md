# Worklog

## 2026-04-24 — Bootstrap worklog

Category: ARCHITECTURE

Recent work includes feature development and implementation.

### Recent Commits
```
8c1ad29 chore(governance): adopt CLAUDE.md + governance framework
02a7304 test(ts): wire vitest runner for smoke test
fc4bbd9 test(smoke): seed minimal smoke test — proves harness works
445ea4a chore(ci): adopt phenotype-tooling quality-gate + fr-coverage
986fcc5 feat: add 8 new patterns - JWT, API Keys, Circuit Breaker, Retry, BDD, Health Checks, Graceful Degradation + 3 ADRs
```

## 2026-04-30 — Journey traceability adoption

Category: GOVERNANCE

### Context

Cross-repo docs audit showed that journey keyframes and recordings were missing
from many docs surfaces. The shared standard was added in `phenotype-infra`
first, then propagated to the docs hub, then to the handbook.

### Finding / Decision

PhenoHandbook should carry a governance page for journey traceability so the
pattern registry itself models the evidence contract it asks other repos to
follow. The page points at the shared standard and names hwLedger as the
reference implementation for `ShotGallery` and `RecordingEmbed`.

### Impact

Creates a reusable docs contract for future patterns and repo docs. The
handbook can now point contributors at a concrete journey-evidence standard
instead of only prose guidelines.

### Tags

`[PhenoHandbook]` `[cross-repo]` `[GOVERNANCE]`

## 2026-06-08 — Error-handling pattern consolidated

Category: CONVENTIONS

### Context

Error-structuring guidance was scattered: `SPEC.md:2217-2254` carried
`GUIDELINE-RUST-001: Error Handling` (the `thiserror` / `anyhow` rule),
`patterns/async/event-driven.md:174-191` re-derived the rule for
retry / DLQ, and seven other pattern files (`hexagonal.md`, `cqrs.md`,
`jwt.md`, `oauth-pkce.md`, `outbox.md`, `cache-aside.md`, `saga.md`)
inlined a per-pattern `*Error` enum shape that contradicted nothing
but also pointed at no shared doc.

Meanwhile, the per-repo picture was mixed: `HeliosCLI`, `thegent`, and
`AuthKit` are fully on `thiserror`; `Civis` still ships several
hand-rolled `impl Display + impl std::error::Error` enums (e.g.
`IntegrityError` in `crates/engine/src/integrity.rs:11-26`).

### Finding / Decision

Promote the rule to a first-class pattern doc and index it.
`patterns/error-handling.md` is now the canonical place for the
"one `enum *Error` per crate, `thiserror` for libraries, `anyhow`
for binaries" rule, with the layered (domain / application / adapter)
shape required by [architecture/hexagonal.md](patterns/architecture/hexagonal.md)
and a reference-implementation table that points at 2+ real repos
(`HeliosCLI/crates/harness_spec/src/error.rs:6-35`,
`HeliosCLI/crates/harness_checkpoint/src/error.rs:6-35`,
`thegent/crates/thegent-policy/src/errors.rs:3-16`).

`patterns/README.md` gains an `Errors` row so the doc is discoverable
without grepping the spec. `SPEC.md:2217-2254` is kept as the
spec-grade Guidelines Catalog entry; the new pattern page points back
at it. `Civis` is called out in the reference table as a
migration-in-progress case.

### Impact

Future pattern files that need an `*Error` example link to
`patterns/error-handling.md` instead of re-stating the rule. New
crates copy the canonical `error.rs` shape verbatim. The `Civis`
migration is now traceable from one table.

### Tags

`[PhenoHandbook]` `[conventions]` `[errors]` `[Rust]`
