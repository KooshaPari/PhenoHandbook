# Shared-Primitive Reuse Pattern

## Overview

`phenoShared` is the org's [libified primitive layer](methodology/wrap-over-handroll.md) — nine Rust crates that own one job each (logging, HTTP, config, secrets, rate-limiting, retry, error-reporting, time, build metadata). Every consumer across the Pheno* fleet (HeliosLab, PhenoRuntime, KWatch, phenoMCP, phenotype-*, the TypeScript bridges in the registry) is expected to reach for the `phenoShared` crate that already ships the primitive, not to re-implement it locally.

This page is the meta-rule that ties the nine primitive pages together. It exists because the failure mode is consistent: a consumer crate adds `tracing` + a hand-rolled `tracing_subscriber::fmt()` setup, a hand-rolled `reqwest::Client` builder, a hand-rolled `100 * 2u64.pow(attempt)` retry loop, or a hand-rolled `serde_yaml::from_str` config loader, when `phenoShared` already ships the canonical implementation. The result is divergent behaviour across the fleet (one binary uses `error!`, the next uses `warn!`, the next writes to `stdout`), bug fixes that don't propagate (the retry cap is wrong in three crates, fixed in none), and a dependency surface that bloats per-crate instead of living in one place.

The rule is short: **when `phenoShared` ships a crate for the primitive, the consumer adds that crate as a `path =` dependency and calls its public API. Anything else is a violation.**

## The Rule

| Context | Use | Crate | Why |
|---------|-----|-------|-----|
| A consumer needs structured logging (`tracing` initialization, the canonical field names, the `with_test_writer` test helper) | `phenotype_logging::{init_tracing, init_tracing_for_test}` | `phenotype-logging` | The crate owns the subscriber shape, the `error = %err` field-name contract, the env-filter parsing, and the test-helper path. Adding `tracing-subscriber` directly forks the field names. |
| A consumer needs an HTTP client (REST call to a downstream service, a NATS-adjacent fetch, an internal API) | `phenotype_http_client::{HttpClient, HttpClientConfig, RetryPolicy}` | `phenotype-http-client` | The crate owns the `reqwest` builder, the timeout / redirect / pool defaults, the retry-policy integration, and the typed error variants. A consumer that uses `reqwest::Client::new()` directly duplicates every default. |
| A consumer needs to load a typed config from a file/env/secret source | `phenotype_config_core::{load_config, ConfigSource}` | `phenotype-config-core` | The crate owns the canonical search-path order (CLI flag → env → `.env` → `config/<env>.{yaml,toml}` → defaults), the typed-loader return shape, and the `ConfigError` enum. A consumer that hand-rolls `serde_yaml::from_str(&fs::read_to_string(...)?)` re-implements the merge logic. |
| A consumer needs to read a secret (DB password, API key, signing key) | `phenotype_secret::{SecretSource, load_secret}` | `phenotype-secret` | The crate owns the source-resolution order (env → secret manager → file), the in-memory zeroing on drop, and the `Secret<String>` newtype that prevents accidental `Display`. Reading `std::env::var("DB_PASSWORD")` directly skips the zeroing and the audit log. |
| A consumer needs to throttle outbound calls to a downstream (per-key, per-IP, per-tenant rate limit) | `phenotype_rate_limit::{RateLimiter, RateLimitPolicy}` | `phenotype-rate-limit` | The crate owns the token-bucket / leaky-bucket primitives, the `DashMap`-backed per-key store, and the `429`-with-`Retry-After` response shape. A consumer that uses a hand-rolled `DashMap<String, Instant>` skips the unit-testable policy and the response contract. |
| A consumer needs to retry a fallible operation with exponential backoff + jitter | `phenotype_retry::{exponential_backoff, with_jitter, BASE_BACKOFF, MAX_BACKOFF}` | `phenotype-retry` | The crate owns the `BASE_BACKOFF * 2^attempt` formula, the `MAX_BACKOFF` cap, the `saturating_mul` overflow guard, and the jitter band. See [retry-policy](retry-policy.md). |
| A consumer needs to surface an error to logs (a `?`-bailed `io::Error`, an `anyhow::Error` from an adapter, a `RepositoryError`) | `phenotype_error_core::report(&err)` | `phenotype-error-core` | The crate owns the `tracing::error!` + `tracing::debug!` shape, the `error = %err` field name, the `source()` walk, and the stable `"operation failed"` message. See [error-reporting](error-reporting.md). |
| A consumer needs an ISO-8601 timestamp, a monotonic duration, or a "now" abstraction that tests can freeze | `phenotype_time::{now_utc, format_iso8601, MonotonicClock}` | `phenotype-time` | The crate owns the wall-clock / monotonic split, the ISO-8601 formatter, and the `Clock` trait that tests implement to freeze time. Calling `chrono::Utc::now()` directly skips the test seam. |
| A consumer needs build metadata (version, git SHA, build profile, target triple) for a log line, a `/health` response, or a `User-Agent` header | `phenotype_build_info::{BuildInfo, build_info!}` | `phenotype-build-info` | The crate owns the four fields (`version`, `git_sha`, `build_profile`, `target_triple`), the `build.rs` invocation, and the `BuildInfo::current()` constructor. Hand-typing `env!("CARGO_PKG_VERSION")` skips the git SHA and the target triple. |

**Hard rule:** if a `phenoShared` crate ships the primitive, the consumer adds that crate as a `path =` direct dep and calls its public API. Re-implementing the primitive in the consumer — even partially, even with a comment saying "this is just a stub, we'll migrate later" — is a violation. The "later" never comes, the stub drifts from the canonical, and the field-name / severity / cap / jitter contract is silently broken across the fleet.

**Hard rule:** adding a third-party crate that the `phenoShared` wrapper already wraps (`tracing` + `tracing-subscriber` for logging, `reqwest` for HTTP, `backoff` / `tokio-retry` for retry, `serde_yaml` for config, `governor` for rate-limiting, `secrecy` for secrets) as a *direct* dependency of a consumer is forbidden. The wrapper is the API; the ecosystem crate is an implementation detail of the wrapper. Per [wrap-over-handroll](methodology/wrap-over-handroll.md), the org picks one wrapper per primitive and consumes the wrapper, not the ecosystem crate.

**Hard rule:** the only sanctioned exception to the rule is the `phenoShared` crate itself, the org's CLI binaries that are *in* `phenoShared` (e.g. `phenotype-application` extending `phenotype-config-core`), and the `phenotype-port-interfaces` trait definitions that all wrappers implement. Every other consumer goes through the wrapper's public API, not the underlying ecosystem crate.

## Canonical Pattern

### Add the dependency (one line per primitive, in `[dependencies]`)

```toml
# crates/<consumer>/Cargo.toml
[dependencies]
# Pick exactly the primitives this crate needs. Do not add all nine
# "just in case" — the dependency should match the call sites.
phenotype-logging      = { path = "../phenotype-logging" }
phenotype-error-core   = { path = "../phenotype-error-core" }
phenotype-retry        = { path = "../phenotype-retry" }
phenotype-time         = { path = "../phenotype-time" }
phenotype-build-info   = { path = "../phenotype-build-info" }
# phenofoo-http-client = { path = "../phenotype-http-client" }
# phenofoo-config-core = { path = "../phenotype-config-core" }
# phenofoo-secret      = { path = "../phenotype-secret" }
# phenofoo-rate-limit  = { path = "../phenotype-rate-limit" }

# Consumers do NOT add `tracing`, `tracing-subscriber`, `reqwest`,
# `backoff`, `tokio-retry`, `serde_yaml`, `governor`, or `secrecy`
# as direct deps just to do the same job `phenoShared` already does.
# Add the ecosystem crate directly only if you are extending the
# corresponding `phenoShared` crate itself.
```

### Import and call (one `use` per primitive, one call per need)

```rust
// crates/<consumer>/src/main.rs
use std::process::ExitCode;

use phenotype_logging::init_tracing;                              // logging
use phenotype_error_core::report;                                 // error-core
use phenotype_retry::{exponential_backoff, with_jitter};           // retry
use phenotype_time::{now_utc, format_iso8601};                     // time
use phenotype_build_info::build_info;                              // build-info
// use phenotype_http_client::{HttpClient, HttpClientConfig};      // http-client
// use phenotype_config_core::load_config;                         // config
// use phenotype_secret::{SecretSource, load_secret};              // secret
// use phenotype_rate_limit::{RateLimiter, RateLimitPolicy};       // rate-limit

fn main() -> ExitCode {
    // 1. logging — install the canonical `tracing` subscriber before
    //    any `tracing::*!` macro fires. The wrapper owns the field
    //    names, the env-filter parsing, and the test helper.
    init_tracing();

    // 2. build-info — read the build metadata once at startup.
    let info = build_info!();
    tracing::info!(version = %info.version, git_sha = %info.git_sha, "boot");

    // 3. time — call the wrapper for wall-clock / monotonic time.
    //    Tests freeze this via the `Clock` trait; consumers that
    //    call `chrono::Utc::now()` directly break the test seam.
    let started = now_utc();
    tracing::debug!(ts = %format_iso8601(started), "work started");

    // 4. retry — compose the wrapper's helpers into the caller's
    //    loop. The wrapper owns the base, the cap, the jitter, and
    //    the overflow guard. See retry-policy for the full pattern.
    for attempt in 0..=5u32 {
        let delay = with_jitter(exponential_backoff(attempt), 25);
        // ... caller-supplied `op()` invocation + error match ...

        // 5. error-core — when an error is in hand and the next
        //    step is "log it and propagate / exit / move on", the
        //    wrapper emits the top-level event AND the cause chain.
        //    See error-reporting for the full pattern.
        if let Err(err) = some_op() {
            report(&err);
            return ExitCode::from(1);
        }

        // (caller-supplied `tokio::time::sleep(delay).await;`)
    }

    ExitCode::SUCCESS
}
```

The shape is the same for every primitive: **one `path =` line in `Cargo.toml`, one `use` in the source file, one call at the use site**. The wrapper exposes a small, stable surface; the consumer's job is to import it and call it. Anything that reaches past the wrapper (a hand-rolled `tracing_subscriber::fmt()`, a hand-rolled `reqwest::Client::new()`, a hand-rolled `100 * 2u64.pow(attempt)`) is a violation.

## Reference: 9 Primitives in `phenoShared`

The current primitive layer. Each row is the crate, its primary source path, the one-or-two-symbol public surface a consumer reaches for, and the page that documents the call-site contract in detail.

| # | Primitive | Crate | Primary source path | Public API a consumer calls | Pattern page |
|---|-----------|-------|---------------------|------------------------------|---------------|
| 1 | Logging | `phenotype-logging` | `crates/phenotype-logging/src/lib.rs` | `init_tracing()`, `init_tracing_for_test()` | [logging](logging.md) |
| 2 | HTTP client | `phenotype-http-client` | `crates/phenotype-http-client/src/lib.rs` | `HttpClient::new(HttpClientConfig::default())`, `HttpClient::get(url).send().await` | [http-client](http-client.md) |
| 3 | Config | `phenotype-config-core` | `crates/phenotype-config-core/src/lib.rs` | `load_config::<MyConfig>(ConfigSource::default())` | [config](config.md) |
| 4 | Secret | `phenotype-secret` | `crates/phenotype-secret/src/lib.rs` | `load_secret(SecretSource::Env("DB_PASSWORD"))` → `Secret<String>` | [secret](secret.md) |
| 5 | Rate-limit | `phenotype-rate-limit` | `crates/phenotype-rate-limit/src/lib.rs` | `RateLimiter::new(RateLimitPolicy::default())`, `limiter.check(key)` | [rate-limit](rate-limit.md) |
| 6 | Retry | `phenotype-retry` | `crates/phenotype-retry/src/lib.rs` | `exponential_backoff(attempt)`, `with_jitter(base, pct)`, `BASE_BACKOFF`, `MAX_BACKOFF` | [retry-policy](retry-policy.md) |
| 7 | Error-core | `phenotype-error-core` | `crates/phenotype-error-core/src/lib.rs` | `report(&err)` | [error-reporting](error-reporting.md) |
| 8 | Time | `phenotype-time` | `crates/phenotype-time/src/lib.rs` | `now_utc()`, `format_iso8601(dt)`, `MonotonicClock::now()` | [time](time.md) |
| 9 | Build-info | `phenotype-build-info` | `crates/phenotype-build-info/src/lib.rs` | `build_info!()` → `BuildInfo { version, git_sha, build_profile, target_triple }` | [build-info](build-info.md) |

Each row is the canonical answer to "I need a primitive that does X — where do I get it?" If a new primitive is added to `phenoShared` (a new row in this table), this page is the place to link the pattern doc that documents the call-site contract, and every consumer of the new primitive is expected to add the crate as a `path =` direct dep and call its public API. If a consumer is using a primitive that is *not* in this table, that is a signal to either add the primitive to `phenoShared` (if it has 2+ uses) or to reach for an existing ecosystem crate directly with an adapter behind a port (if it has 1 use, per [xdd](methodology/xdd.md)'s 2nd-use libification threshold).

## Anti-Patterns

- ❌ Adding `tracing` + `tracing-subscriber` as direct deps in a consumer to install a one-off subscriber — duplicates `phenotype_logging::init_tracing`, drifts the field-name contract, and forces operators to wire up a second log stream. Use `phenotype_logging::init_tracing()`.
- ❌ Calling `reqwest::Client::new()` directly — duplicates `phenotype_http_client::HttpClient::new`, drifts the timeout / redirect / pool defaults, and skips the typed error variants. Use `phenotype_http_client::HttpClient::new(HttpClientConfig::default())`.
- ❌ Hand-rolling a `100 * 2u64.pow(attempt)` retry loop — drifts from `phenotype_retry::exponential_backoff`, drops the cap, drops the overflow guard, and the `Duration` overflows to zero or to `Duration::MAX`. Use `phenotype_retry::{exponential_backoff, with_jitter}`.
- ❌ Calling `tracing::error!("{err}")` directly (with no `error = %err` field) — drops the cause chain, drops the canonical field name, and breaks every structured-log query that filters on the `error` field. Use `phenotype_error_core::report(&err)`.
- ❌ Calling `chrono::Utc::now()` directly — skips the test seam (the `Clock` trait `phenotype-time` exposes) and makes any test that asserts on the wall-clock time flaky or impossible. Use `phenotype_time::now_utc()`.
- ❌ Hand-typing `env!("CARGO_PKG_VERSION")` and a manual `git rev-parse HEAD` in a build script — skips the `BuildInfo` struct's four fields, drifts the build identity, and forces every crate to wire up the same build.rs logic. Use `phenotype_build_info::build_info!()`.
- ❌ Calling `std::env::var("DB_PASSWORD")` and storing the result in a plain `String` — skips the `Secret<String>` newtype's in-memory zeroing on drop, skips the audit log, and makes the secret string printable in a `Display` / `Debug` chain. Use `phenotype_secret::load_secret(SecretSource::Env("DB_PASSWORD"))`.
- ❌ Hand-rolling a `DashMap<String, Instant>` rate limiter with a `if last.elapsed() < dur { return Err(...) }` check — drifts from the token-bucket / leaky-bucket primitives, skips the per-key unit testability, and silently breaks under concurrent load. Use `phenotype_rate_limit::{RateLimiter, RateLimitPolicy}`.
- ❌ Hand-rolling a `serde_yaml::from_str(&fs::read_to_string(path)?)` config loader — duplicates the canonical search-path order, drifts the merge logic across crates, and forces every config to be parsed in the same way manually. Use `phenotype_config_core::load_config::<MyConfig>(ConfigSource::default())`.
- ❌ Adding a third-party crate (`backoff`, `tokio-retry`, `governor`, `secrecy`, `reqwest`, `serde_yaml`, `tracing`, `tracing-subscriber`) as a direct dep of a consumer just to do the job the wrapper already does — forks the contract, blocks the wrapper from being upgraded in lockstep, and forces every consumer to track the ecosystem crate's major version independently. The wrapper is the API.

## Related Patterns

- [wrap-over-handroll](methodology/wrap-over-handroll.md) — the methodology this rule operationalizes. Wrap the ecosystem behind a port; consume the wrapper, not the ecosystem crate; libify at the 2nd use.
- [xdd](methodology/xdd.md) — the 2nd-use libification threshold. A primitive ships in `phenoShared` when it has 2+ uses; before that, the consumer uses the ecosystem crate directly behind an adapter. After that, the consumer migrates to the wrapper.
- [architecture/hexagonal](architecture/hexagonal.md) — the wrappers are *adapters*; the `phenotype-port-interfaces` crate exposes the *port* trait that each wrapper implements. The consumer depends on the port trait when it needs swappability; it depends on the concrete wrapper when it needs the production behaviour.
- [spine-roles](spine-roles.md) — `phenoShared` is the *primitives* repo in the 4-role spine; this handbook documents the *call-site contract* for the primitives; the registry indexes the public API; governance enforces the rule.
- [logging](logging.md), [http-client](http-client.md), [config](config.md), [secret](secret.md), [rate-limit](rate-limit.md), [retry-policy](retry-policy.md), [error-reporting](error-reporting.md), [time](time.md), [build-info](build-info.md) — the nine primitive pages, one per row of the table above. Each is the canonical place the call-site contract lives; this page is the meta-rule that says "if the primitive is in the table, use the wrapper".

## References

- `phenoShared/Cargo.toml` — the workspace `members` list that defines which crates are in the primitive layer.
- `phenoShared/README.md` — the crate catalog with one-line summaries of every primitive.
- `phenoShared/clippy.toml` — the workspace lint config that flags `unwrap_used`, `expect_used`, and other patterns the wrappers (and the consumers) must respect.
- `phenoShared/AGENTS.md` — the agent-facing conventions for working in the `phenoShared` repo (workspace layout, dep-graph rules, "don't break the wrapper's public API").
- `phenoShared/CLAUDE.md` — the Claude-facing companion to `AGENTS.md`.
- `phenoShared/ADR.md` — the architecture decisions that produced the primitive layer (one ADR per primitive, plus the meta-ADR on "why a primitives repo at all").
- Internal: this page is the meta-rule. If you add a new primitive to `phenoShared` (a new row in the table above), add the corresponding primitive page in the same PR and link it from the table. If you change a wrapper's public API, update both the wrapper's docs and the primitive page in the same PR.
