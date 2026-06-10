# Module Decoupling Pattern

**Status:** adopted · **Applies to:** Rust workspaces (and Go modules) when a crate, package, or `mod` block starts being reached for from more than one consumer.

## Overview

Phenotype ships a fleet of independently-versioned repos (PhenoMCP, PhenoAgent, PhenoRuntime, KWatch, phenoMCP, HeliosLab, pheno, …) and one shared library workspace, `phenoShared`, that owns the primitives the fleet reaches for (logging, HTTP, config, secrets, rate-limiting, retry, error-reporting, time, build-info). A recurring fork-decision sits between those two layers: **a piece of code is about to be needed by a second consumer — do we copy it across, or do we lift it into `phenoShared` first?** This page is the rule for that fork. It is the companion to [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) (which says "wrap an existing ecosystem crate") and [methodology/xdd](methodology/xdd.md) (which says "libify at the 2nd use"); this page makes the 2nd-use rule concrete by fixing the destination — the consumer repo first, `phenoShared` at the threshold — and the rename/refactor steps the lift requires.

The failure mode this page exists to prevent is **in-repo drift**: a primitive is added to a consumer repo, a second consumer reaches for the same logic and copies it, the two copies fork (one adds a `Retry-After` header, the other doesn't; one normalizes timestamps to UTC, the other to local time; one wires the org's `tracing` field names, the other uses ad-hoc strings), and the fleet's contract — the field-name, severity, cap, and jitter conventions `phenoShared` enforces — is silently broken. The rule below is the single line that prevents the fork: extract to `phenoShared` at the moment a second consumer appears, never after.

> **Scope note.** This page covers the *when and where* of extraction — the threshold that triggers a lift, the destination (`phenoShared` for fleet-wide primitives, the consumer repo for project-local ones), and the refactor steps the lift requires. The *contents* of each lifted crate (the public API, the field-name contract, the test helpers) live on the nine per-primitive pages. The *policy* that says "all consumers must use the lifted crate, not the underlying ecosystem crate" lives in [shared-primitive-reuse](shared-primitive-reuse.md). This page is the move *to* `phenoShared`; the other page is the contract *from* `phenoShared`.

## The Rule

The fork-decision has exactly two branches, keyed off the number of consumers:

| Context | Where the code lives | Crate / module path | Why |
|---------|---------------------|---------------------|-----|
| **1 consumer** (a primitive is added to a single consumer repo, no other repo has reached for it yet, no second call site exists inside the consumer) | **In-repo.** The primitive lives in the consumer's own crate (Rust: `crates/<name>/src/<primitive>.rs`; Go: `internal/<primitive>/`). The consumer owns its tests, its public API, its `Cargo.toml` / `go.mod` entry, and its release tag. | The consumer's own crate, at whatever path is idiomatic for that repo. | The code has not earned a release boundary yet. Lifting to `phenoShared` is an irreversible commitment (a published crate, a version, a contract, a deprecation cost) and is not justified by a single call site. Premature extraction is its own form of complexity: every consumer of `phenoShared` now has a transitive dep, a CHANGELOG pin, and a renovate-bot PR cycle for code that only one repo uses. |
| **2+ consumers** (a second consumer repo — a different sibling under `repos/`, a different workspace member in the consumer repo, or a distinct crate inside the same workspace — reaches for the primitive, even partially, even with a comment saying "we'll migrate later") | **Extract to `phenoShared`.** The primitive becomes a first-class crate under `phenoShared/crates/phenotype-<primitive>/`, with its own `Cargo.toml`, its own `#[non_exhaustive]` public API, its own test suite, and its own per-primitive pattern doc on the [nine-primitive index](shared-primitive-reuse.md). | `phenotype-<primitive>` at `path = "../phenotype-<primitive>"` from every consumer. | Two call sites doing the same thing is the org's *libification threshold* (see [methodology/xdd](methodology/xdd.md)). Two independent consumers in two independent repos is a stronger signal: it means the fleet's contract — the field names, the cap, the jitter, the env-var order — has started to fork. The lift is the cheapest moment to fix the fork, and the moment *after* is more expensive by an order of magnitude (every consumer has a copy to migrate, a test suite to update, a CHANGELOG to amend). |

**Hard rule:** the threshold is the *second* consumer, not the third. Per [methodology/xdd](methodology/xdd.md), the org extracts at the 2nd use. "We'll lift it when there's a third" is rejected on sight; the two existing copies have already forked by the time the third appears.

**Hard rule:** "in-repo" is a *temporary* classification, not a *permanent* one. Code that lives in-repo at consumer-N becomes `phenoShared` material the moment consumer-N+1 reaches for it. If the in-repo code is not on a path to extraction (no public API boundary, no test seam, no deprecation plan), the lift is blocked — refactor the in-repo code first, *then* extract. The lift is never a `git mv` of an unstructured blob.

**Hard rule:** the destination is `phenoShared`, not "a new repo under `repos/`" and not "a new top-level workspace member in the consumer repo." Per [workspace-organization](workspace-organization.md), a primitive owned by one consumer is a workspace member; a primitive owned by the fleet is `phenoShared`; a primitive owned by no one (an experiment) does not get a repo at all. The destination is fixed by the consumer count, not by the developer's preference.

**Hard rule:** a lift that introduces a circular dependency between `phenoShared` and the consumer repo is a violation, full stop. `phenoShared` depends on ecosystem crates (`tracing`, `reqwest`, `serde_yaml`, `backoff`); it does not depend on consumer repos, on PhenoMCP, on PhenoAgent, on HeliosLab, on KWatch, on pheno, or on the workspace's own `crates/` tree. If the lift would create a cycle, the primitive has the wrong boundary — re-cut it so the port (the trait) lives in `phenoShared` and the adapter (the impl) lives in the consumer.

**Hard rule:** the "second consumer" includes a second *workspace member* in the same repo (a `crates/<a>/` module reaching for a `crates/<b>/` helper is a 2-consumer signal, not a 1-consumer signal). The threshold is call sites, not repos. Two `use crate::foo::bar;` lines in two different workspace members count.

## Canonical Pattern

### 1. In-repo: the primitive lives in the consumer's own crate, with a public API seam

```rust
// crates/<consumer>/src/<primitive>.rs          (in-repo, 1 consumer)
//
// Lives here while there is exactly one consumer. The module has:
//   - a single public type or helper (the "port" surface)
//   - a single test module (the "contract" surface)
//   - a single Cargo.toml entry (no path = "../phenoShared/..." yet)
//
// The moment a second consumer in this repo (or a sibling repo) reaches
// for this module, the next section applies: lift to phenoShared.

pub struct <Primitive> { /* ... */ }

impl <Primitive> {
    pub fn new() -> Self { /* ... */ }
    pub fn op(&self) -> Result<(), <Primitive>Error> { /* ... */ }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn round_trip() { /* ... */ }
}
```

```toml
# crates/<consumer>/Cargo.toml                   (in-repo, 1 consumer)
#
# The primitive is a sibling module of the consumer's main code. No
# path = dependency on a not-yet-existing phenoShared crate. When the
# second consumer appears, the lift creates the phenoShared crate
# AND flips this file to a path = dependency in the same PR.

[dependencies]
# Direct ecosystem deps are still allowed here because the primitive
# is in-repo, not in phenoShared. The wrap-over-handroll rule for
# *phenoShared itself* kicks in only after the lift.
serde = { version = "1", features = ["derive"] }
```

### 2. The threshold: a second consumer reaches for the primitive

```rust
// crates/<consumer-b>/src/lib.rs                 (the second consumer)
//
// The signal: a different workspace member (or a different sibling
// repo) imports the primitive. This is the trigger for the lift.

use <consumer>::<primitive>::<Primitive>;        // ❌ wrong — the second
                                                  //   consumer just created
                                                  //   a 2-call-site fork.
```

When the second `use` lands, the lift PR is filed *in the same change* — the second consumer's `use` is rewritten to point at the new `phenotype-<primitive>` crate as part of the same diff, and the in-repo module is deleted. The "lift later, the second consumer can land first" ordering is rejected; the lift is the merge that unblocks the second consumer.

### 3. The lift: a 6-step refactor that produces a `phenoShared` crate

The lift is one PR, six files, and the same diff lands the new crate, deletes the in-repo module, and rewrites both consumers' `use` statements. The six files:

```text
phenoShared/
└── crates/
    └── phenotype-<primitive>/
        ├── Cargo.toml                            # (1) new crate
        ├── src/
        │   └── lib.rs                            # (2) moved from in-repo module
        └── tests/
            └── integration.rs                    # (3) integration tests
                                                    #     (the in-repo unit
                                                    #      tests move too)

phenoShared/Cargo.toml                             # (4) workspace member
                                                    #     +1
phenoShared/crates/phenotype-<primitive>/README.md # (5) the per-primitive
                                                    #     pattern doc
phenotype-registry/ECOSYSTEM_MAP.md               # (6) row in the
                                                    #     shared-primitive
                                                    #     table
```

```toml
# phenoShared/crates/phenotype-<primitive>/Cargo.toml   (the new crate)
#
# The crate is a thin wrapper over the ecosystem crate per
# wrap-over-handroll. The Cargo.toml declares a `path =` dep on the
# *ecosystem* crate (e.g. `tracing`, `reqwest`, `serde_yaml`,
# `governor`, `backoff`, `secrecy`); consumer repos declare a
# `path =` dep on *this* crate, not on the ecosystem crate.

[package]
name = "phenotype-<primitive>"
version = "0.1.0"
edition = "2021"
description = "<one-line job description>"

[dependencies]
# Ecosystem crate the wrapper owns. Consumers do NOT add this as
# a direct dep — they go through phenotype-<primitive>'s API.
serde = { version = "1", features = ["derive"] }
```

```toml
# crates/<consumer>/Cargo.toml                   (consumer, post-lift)
#
# After the lift, the consumer adds the new phenoShared crate as a
# path = dep, removes the in-repo module, and (if the consumer was
# the only direct user of the ecosystem crate) drops the ecosystem
# crate from [dependencies] too.

[dependencies]
phenotype-<primitive> = { path = "../phenotype-<primitive>" }
# serde = { version = "1", features = ["derive"] }   ← dropped, the
#                                                    wrapper owns it now
```

```rust
// crates/<consumer>/src/main.rs                  (consumer, post-lift)
//
// The use statement is rewritten to point at the lifted crate. The
// import shape, the field names, the error variants, and the test
// helpers are now the lifted crate's public API — see the per-primitive
// pattern doc linked from the reference table below.

use phenotype_<primitive>::<Primitive>;           // ✅ — fleet-wide
                                                  //   contract, single
                                                  //   source of truth.
```

### 4. Anti-patterns: the moves the rule rejects

- ❌ **"Lift at the 3rd use."** The two existing copies have already forked by the third use; the migration is now 3× the work and the contract has silently drifted. The 2nd-use threshold exists to catch the fork *before* it costs.
- ❌ **"Lift to a new repo under `repos/`."** The destination for fleet-wide primitives is `phenoShared`, not a fresh `repos/phenotype-<primitive>/`. A new repo brings its own `.git`, its own CI, its own release tag, its own `deny.toml`, its own onboarding row in `ECOSYSTEM_MAP.md` — overhead that the primitive has not earned. The `phenoShared` workspace already amortises that overhead across nine crates.
- ❌ **"Lift to a new workspace member in the consumer repo."** A workspace member is owned by one consumer; a primitive owned by the fleet cannot live in one consumer's workspace without either (a) being `path =`ed by siblings, which is the "two repos with a shared internal crate" anti-pattern (the source of the cycle problem), or (b) being published, which is what `phenoShared` is for.
- ❌ **"Re-export the in-repo module from `phenoShared`."** `phenoShared` does not `pub use` from consumer repos. Re-exports hide the source of truth, defeat the cycle check, and break the renovate-bot / cargo-deny baseline that assumes `phenoShared` deps are ecosystem crates or other `phenoShared` crates.
- ❌ **"Copy the in-repo module into the second consumer and file a follow-up issue to extract."** The follow-up never lands. The two copies fork. The org has a precedent for this: see the in-repo anti-patterns called out in [logging-rust](logging-rust.md) (the `HeliosLab/pheno-cli/src/main.rs:135` `eprintln!` and the `HeliosLab/pheno-cli/src/main.rs:143` inline `tracing_subscriber::fmt().init()`), both of which are slated for migration precisely because the "follow-up" promise didn't hold.
- ❌ **"Lift a primitive that the consumer owns the *contract* for."** The contract owner stays the contract owner. If a primitive's `tracing` field names are owned by the consumer's domain (e.g. a healthcare-specific `patient_id` field), the primitive stays in the consumer repo even if another consumer reaches for it; the *shared* layer is the type signature, not the domain-specific field names. The lift is for fleet-wide primitives, not for primitives that happen to be reusable.
- ❌ **"Lift before the public API stabilises."** The lift is a release boundary. A primitive whose public API is still "we'll see what shakes out" is not liftable; the in-repo period is the API-discovery period. If the API is unstable, the lift is blocked — refactor the in-repo code to expose a stable port (the trait), *then* lift.

## Reference: 9 phenoShared Primitives

The nine primitives currently shipped from `phenoShared/crates/`. Each row links to the per-primitive pattern doc that documents the public API, the field-name contract, and the test helper. The "Origin" column records the consumer that owned the primitive *before* the lift; the "Consumers" column records the fleet repos that now `path =` the lifted crate. This is the org's running ledger of every lift the rule has produced.

| Primitive | Crate | Origin (consumer that owned the in-repo version) | Consumers (repos that now `path =` the lifted crate) | Pattern doc |
|-----------|-------|--------------------------------------------------|------------------------------------------------------|-------------|
| **Logging** | `phenotype-logging` | `pheno` (`crates/pheno-logging/`, the `tracing_subscriber::fmt().init()` block at the top of every `main.rs`) | pheno, HeliosLab, PhenoDevOps, Pyron, PhenoRuntime, PhenoAgent, PhenoMCP, KWatch, phenoMCP | [logging-rust](logging-rust.md) |
| **HTTP client** | `phenotype-http-client` | `pheno` (`crates/pheno-http-client/`, the hand-rolled `reqwest::Client::builder()` with org-default timeouts / redirects / pool sizes) | pheno, PhenoMCP, PhenoAgent, PhenoRuntime, KWatch | [http-client](http-client.md) |
| **Config loading** | `phenotype-config-core` | `pheno` (`crates/pheno-config/`, the hand-rolled CLI-flag → env → `.env` → `config/<env>.{yaml,toml}` → defaults merge) | pheno, PhenoMCP, PhenoAgent, PhenoRuntime, HeliosLab | [config](config.md) |
| **Secrets** | `phenotype-secret` | `pheno` (`crates/pheno-secret/`, the hand-rolled `std::env::var("DB_PASSWORD")` paths that skipped the in-memory zeroing and the audit log) | pheno, PhenoMCP, PhenoAgent, PhenoRuntime, KWatch | [secrets](secrets.md) |
| **Rate limiting** | `phenotype-rate-limit` | `pheno` (`crates/pheno-rate-limit/`, the hand-rolled `DashMap<String, Instant>` token-bucket) | pheno, PhenoMCP, PhenoAgent, KWatch | [rate-limiting](rate-limiting.md) |
| **Retry** | `phenotype-retry` | `pheno` (`crates/pheno-retry/`, the hand-rolled `100 * 2u64.pow(attempt)` exponential-backoff loops) | pheno, PhenoMCP, PhenoAgent, PhenoRuntime, KWatch | [retry-policy](retry-policy.md) |
| **Error reporting** | `phenotype-error-core` | `pheno` (`crates/pheno-error/`, the hand-rolled `tracing::error!(err = %e, "operation failed")` shape with the `source()` walk) | pheno, HeliosLab, PhenoMCP, PhenoAgent, PhenoRuntime | [error-reporting](error-reporting.md) |
| **Time** | `phenotype-time` | `pheno` (`crates/pheno-time/`, the hand-rolled `chrono::Utc::now()` calls that broke the test-freeze `Clock` trait) | pheno, PhenoMCP, PhenoAgent, PhenoRuntime, KWatch | [time](time.md) |
| **Build metadata** | `phenotype-build-info` | `pheno` (`crates/pheno-build-info/`, the hand-typed `env!("CARGO_PKG_VERSION")` calls that skipped the git SHA and the target triple) | pheno, PhenoMCP, PhenoAgent, PhenoRuntime, HeliosLab, KWatch | [build-info](build-info.md) |

> **Reading the table.** Every row in the table is a lift the rule has produced: a primitive that was in-repo at one consumer, reached for by a second consumer, and lifted to `phenoShared` in a single PR. The "Consumers" column is the proof the threshold fired — a one-element column would mean the lift happened too early (a violation of the rule) and would be a backfill candidate for moving the crate back in-repo until a real second consumer appears.
>
> **Adding a new primitive.** The "Origin" column of the new row is the consumer that just had a second reach-for event. The lift is the same six-file PR described in §3. The "Consumers" column starts at two (the original owner + the second reacher) and grows as siblings adopt. The "Pattern doc" column points at the new per-primitive page that lands in the same PR. Filing the lift without the pattern doc is a violation; the pattern doc is the contract the consumers are agreeing to.

## Related Patterns

- [methodology/xdd](methodology/xdd.md) — The 2nd-use libification threshold; this page is the *destination* of that threshold.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — The lifted crate is a wrapper over an ecosystem crate; this page is the moment the wrapper earns a release boundary.
- [shared-primitive-reuse](shared-primitive-reuse.md) — The contract *from* `phenoShared` to consumers (use the wrapper, not the ecosystem crate); this page is the contract *to* `phenoShared` (extract at the 2nd consumer).
- [workspace-organization](workspace-organization.md) — The physical layout of `phenoShared` as a sibling of `pheno` under `repos/`, not a subdirectory of a consumer.
- [spine-roles](spine-roles.md) — `phenoShared` is a fleet-wide library, not a 4-role spine citizen; the ECOSYSTEM_MAP.md row that names it is an INDEX-row, not a CONVENTIONS-row.
- [logging-rust](logging-rust.md) — The reference lift: the `phenotype-logging` crate was the first primitive the rule produced, and is the model every subsequent lift follows.
