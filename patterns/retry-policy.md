# Retry Policy Pattern

## Overview

Every Rust crate in the org that needs to retry a fallible operation across a flaky boundary (an HTTP call, a DB query, a NATS publish, a queue enqueue) goes through one crate: `phenotype-retry`. This page is the canonical place that rule lives; it consolidates the "retry on transient error" guidance that was previously implicit in the hand-rolled `for attempt in 0..3 { sleep(100 * 2u64.pow(attempt)).await; ... }` loops and the `loop { sleep(Duration::from_secs(1)); match op().await { ... } }` blocks scattered across adapters, relay workers, and integration tests.

The `phenotype-retry` crate ships two helpers:

- `exponential_backoff(attempt: u32) -> Duration` — deterministic, `BASE_BACKOFF * 2^attempt`, capped at `MAX_BACKOFF` (30 s). The cap protects against pathological attempt counts without forcing every caller to do their own `min(...)`.
- `with_jitter(base: Duration, jitter_pct: u8) -> Duration` — uniform full-percentage jitter (±`jitter_pct`%) on top of a base `Duration`. The randomized spread de-correlates retry storms when many callers retry in lockstep against the same downstream.

Both are `const`-friendly pure functions on `std::time::Duration`; neither owns the loop, the error mapping, or the abort condition. Callers compose them into their own retry logic (with the error-matching rule from [error-handling](error-handling.md)) and the crate stays small enough to be the lowest-layer primitive in the resilience stack.

If a crate needs to retry, it imports `phenotype_retry::{exponential_backoff, with_jitter}`. If a `Cargo.toml` adds `backoff`, `tokio-retry`, `retry`, or a hand-rolled `2u64.pow(attempt)` constant to drive a retry loop, either fix the crate or update this page — don't fork the rule. The `phenotype-retry` crate exists for exactly this reason: one place to own the base, the cap, the jitter band, and the `Duration` math so every caller gets the same behaviour.

## The Rule

| Context | Use | Crate / Function | Why |
|---------|-----|------------------|-----|
| Compute the delay before attempt `N` of a bounded retry loop (the canonical "double the wait each time, then cap" shape) | `phenotype_retry::exponential_backoff(attempt: u32) -> Duration` | `phenotype-retry` | One function owns the `BASE_BACKOFF * 2^attempt` formula, the `MAX_BACKOFF` cap, and the `saturating_mul` overflow guard. Re-implementing it at the call site is the exact thing the pattern forbids. |
| Add a randomized spread on top of any base delay (an `exponential_backoff` result, a hand-picked constant, a config-supplied `Duration`) to de-correlate retry storms | `phenotype_retry::with_jitter(base: Duration, jitter_pct: u8) -> Duration` | `phenotype-retry` | One function owns the closed-interval `[base * (1 - pct/100), base * (1 + pct/100)]` math, the `0%` / `Duration::ZERO` fast paths, and the `> 100%` clamp. The randomness comes from `rand::thread_rng()`, automatically seeded. |
| A test that needs a deterministic retry delay (no RNG, no clock drift) | `phenotype_retry::exponential_backoff(attempt)` with no `with_jitter` wrap | `phenotype-retry` | The cap is `saturating_mul`'d and the shift is clamped, so `exponential_backoff(u32::MAX)` is well-defined (`MAX_BACKOFF`) and the test can assert against a literal value. Jitter is for production traffic; tests don't need it. |
| Anything that currently uses `100 * 2u64.pow(attempt)`, a hand-rolled `Vec<Duration> = vec![100, 200, 400, 800, ...]`, or a `loop { sleep(...); match op() { ... } }` that ignores attempt counts | `phenotype_retry::{exponential_backoff, with_jitter}` | — | The hard-coded doubling constant, the magic initial delay, and the missing cap are the three bugs the helper exists to remove. Centralising them in one crate means the values are correct once and audited once. |

**Hard rule:** `100 * 2u64.pow(attempt)`, `100 * 2u32.pow(attempt)`, or any other inline `BASE * 2^attempt` expression in a retry loop is forbidden in Phenotype code. The initial delay is `phenotype_retry::BASE_BACKOFF` (100 ms), the cap is `phenotype_retry::MAX_BACKOFF` (30 s), and the overflow guard is the crate's problem, not the caller's. Re-implementing the formula at the call site is the exact thing the pattern forbids.

**Hard rule:** adding `backoff`, `tokio-retry`, `retry`, `retry-rs`, or any other third-party retry crate as a direct dependency is forbidden. `phenotype-retry` is the wrapper. Per [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md), the org picks one wrapper per primitive and consumes the wrapper, not the ecosystem crate.

**Hard rule:** `loop { sleep(...); match op() { ... } }` with no `attempt` counter and no cap is forbidden. Without the counter the loop has no upper bound on total wall-clock time; without the cap a high `attempt` value produces a `Duration` that overflows to zero or to `Duration::MAX`. The helper is the place those invariants live; the loop is the place the *error-matching* policy lives.

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-retry = { path = "../phenotype-retry" }

# Note: do NOT add `backoff`, `tokio-retry`, `retry`, or a hand-rolled
# `2u64.pow(attempt)` constant in a consumer crate to drive a retry loop.
# Consumers go through `phenotype_retry::{exponential_backoff, with_jitter}`
# and never re-implement the doubling formula. Add the third-party crate as
# a direct dep only if you are extending `phenotype-retry` itself.
```

### Exponential backoff + jitter — retry a flaky HTTP call

```rust
// crates/<name>/src/adapters/<thing>/client.rs
use std::time::Duration;
use phenotype_retry::{exponential_backoff, with_jitter};
use crate::error::{<Crate>Error, RetryClass};

/// Maximum number of *additional* attempts after the first call.
/// 5 => up to 6 total invocations of `op()` (attempt 0..=5).
const MAX_ATTEMPTS: u32 = 5;

/// Default jitter band, applied on top of every `exponential_backoff`
/// result. 25% is a safe default for "many concurrent callers against
/// the same downstream"; tune via config if the call site is single-tenant.
const JITTER_PCT: u8 = 25;

impl <Thing>HttpClient {
    /// Retry `op` with exponential backoff + jitter, classifying
    /// each error as retryable or terminal. Returns the first success
    /// or the last error.
    pub async fn with_retry<F, Fut, T>(&self, mut op: F) -> Result<T, <Crate>Error>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, <Crate>Error>>,
    {
        let mut last_err: Option<<Crate>Error> = None;

        for attempt in 0..=MAX_ATTEMPTS {
            match op().await {
                Ok(value) => return Ok(value),
                Err(err) => match RetryClass::of(&err) {
                    // Terminal — 4xx, validation, auth, etc. Do not retry;
                    // surface immediately so the caller can react.
                    RetryClass::Terminal => return Err(err),
                    // Transient — 5xx, timeout, connection-reset. Sleep
                    // with the canonical backoff + jitter, then loop.
                    RetryClass::Transient => last_err = Some(err),
                },
            }

            // No sleep after the last attempt — there's nothing to
            // wake up to.
            if attempt < MAX_ATTEMPTS {
                let base = exponential_backoff(attempt);
                let delay = with_jitter(base, JITTER_PCT);
                tokio::time::sleep(delay).await;
            }
        }

        // All attempts exhausted; the last transient error is the
        // one the caller wants to log / DLQ.
        Err(last_err.expect("loop ran at least once"))
    }
}
```

### Composing with the throttled HTTP client

The retry helper composes with the rate-limit pattern (see [rate-limiting](rate-limiting.md)) and the canonical HTTP client (see [http-client](http-client.md)). The throttled client's `<Crate>Error::RateLimited` variant is itself a `RetryClass::Transient` — the retry loop backs off, the bucket owns pacing, the two layers don't fight:

```rust
// crates/<name>/src/adapters/<thing>/client.rs (continued)
impl <Thing>HttpClient {
    pub async fn fetch_with_retry(&self, url: &str) -> Result<Thing, <Crate>Error> {
        // try_acquire() on the token bucket is the throttle; the
        // retry loop is the recovery from a throttled call.
        // RateLimited maps to RetryClass::Transient in <Crate>Error.
        self.with_retry(|| async { self.fetch(url).await }).await
    }
}
```

### Retry on a synchronous boundary

`exponential_backoff` and `with_jitter` are sync `Duration` math — they work in `std::thread` workers, `tokio::task::spawn_blocking` blocks, and `rayon` parallel iterators the same way they work in async loops. The only thing that changes is the sleep primitive:

```rust
// crates/<name>/src/workers/poller.rs
use std::time::Duration;
use phenotype_retry::{exponential_backoff, with_jitter};
use crate::error::{<Crate>Error, RetryClass};

pub fn run_until_success<F>(mut op: F) -> Result<(), <Crate>Error>
where
    F: FnMut() -> Result<(), <Crate>Error>,
{
    const MAX_ATTEMPTS: u32 = 5;
    const JITTER_PCT: u8 = 25;

    let mut last_err: Option<<Crate>Error> = None;

    for attempt in 0..=MAX_ATTEMPTS {
        match op() {
            Ok(()) => return Ok(()),
            Err(err) => match RetryClass::of(&err) {
                RetryClass::Terminal => return Err(err),
                RetryClass::Transient => last_err = Some(err),
            },
        }

        if attempt < MAX_ATTEMPTS {
            let base = exponential_backoff(attempt);
            let delay = with_jitter(base, JITTER_PCT);
            std::thread::sleep(delay);
        }
    }

    Err(last_err.expect("loop ran at least once"))
}
```

### Read the constants at the call site

The two public constants are the audit-friendly handles for the "what's the base / what's the cap" questions an operator will ask:

```rust
use phenotype_retry::{BASE_BACKOFF, MAX_BACKOFF};

fn log_retry_policy() {
    // The values are `const fn` evaluable, so this is a constant-fold
    // away — no runtime cost.
    tracing::info!(
        base_backoff_ms = BASE_BACKOFF.as_millis() as u64,
        max_backoff_ms = MAX_BACKOFF.as_millis() as u64,
        "retry policy active"
    );
}
```

## When to use `exponential_backoff` vs `with_jitter`

The two helpers look like alternatives but they model different concerns. Pick by **what the call site is doing**, not by which is more familiar — and remember they compose: `with_jitter(exponential_backoff(attempt), pct)` is the canonical production shape.

| Property | `exponential_backoff` | `with_jitter` |
|----------|----------------------|---------------|
| Models | "Each successive attempt should wait longer, up to a cap" | "Spread any given base delay by ±`pct`% so concurrent callers don't wake at the same instant" |
| Input | The attempt index (`u32`) | A `Duration` and a percentage (`u8`) |
| Output | A `Duration` in `[BASE_BACKOFF, MAX_BACKOFF]`, doubling each step | A `Duration` in `[base * (1 - pct/100), base * (1 + pct/100)]` |
| Determinism | Pure function of `attempt` — same input, same output, every call | Calls `rand::thread_rng()` — different output every call |
| Use alone | Tests, single-tenant call sites, deterministic warm-up sequences | A static / config-supplied `Duration` that you want to fuzz slightly |
| Use together | Almost always in production — `exponential_backoff` picks the band, `with_jitter` spreads it | (n/a — `with_jitter` is the *second* step) |
| Anti-fit | Don't use `exponential_backoff` *without* `with_jitter` when many coroutines / tasks / threads retry the same downstream — they will wake in lockstep and recreate the thundering herd the jitter exists to prevent | Don't use `with_jitter` to *replace* the doubling schedule — a constant base with jitter is a constant wait with noise, not a backoff. |
| Anti-fit | Don't use `exponential_backoff` as the only "retry" mechanism if you also need a per-attempt cap on operation wall-clock time — that is the `tokio::time::timeout` / `reqwest` timeout story, not this one | Don't use `with_jitter` to *inflate* a delay beyond its base — the output is in the closed interval `[base - span, base + span]`; if you want a longer wait, raise the base. |

A rule of thumb: **production retry loops compose the two (`with_jitter(exponential_backoff(attempt), JITTER_PCT)`), tests use `exponential_backoff` alone, and `with_jitter` is never the only step.** The cap (`MAX_BACKOFF`) and the jitter band (`JITTER_PCT`) are the two tuning knobs the org standardises; everything else (the loop, the error class, the abort condition) is the caller's.

## What `phenotype-retry` Configures

The crate is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Base backoff | `BASE_BACKOFF: Duration = 100 ms` | The `0`th-attempt return value. The first retry waits 100 ms (with jitter), not 1 s — a 1 s floor on the first retry is a 1 s floor on tail latency. |
| Cap | `MAX_BACKOFF: Duration = 30 s` | At `BASE_BACKOFF = 100 ms` the cap is reached at attempt 9 (`100 * 2^9 = 51_200 ms`), and every attempt >= 9 returns exactly `MAX_BACKOFF`. The cap protects against pathological attempt counts and against `Duration` overflow. |
| Formula | `BASE_BACKOFF * 2^attempt` | Standard exponential backoff; the doubling is in the base, the cap is on the result. |
| Overflow guard | `attempt.min(40)` shift + `saturating_mul(1u64 << shift)` + `min(MAX_BACKOFF)` | Three layers: the shift is clamped well below 64 bits to leave headroom for the multiplication, the multiplication saturates, and the final result is min'd against the cap. `u32::MAX` is a safe input. |
| Jitter band | Closed interval `[base * (1 - pct/100), base * (1 + pct/100)]` | Symmetric "full-percentage" jitter. The output is *always* within the band; the band itself is documented in the function's docstring. |
| `jitter_pct = 0` fast path | Returns `base` unchanged, no RNG call | Deterministic callers (tests, single-tenant call sites) can pass `0` and get a pure function. The RNG is not touched on the fast path. |
| `base = Duration::ZERO` fast path | Returns `Duration::ZERO` unchanged, no RNG call | A zero base means "don't wait" — there is no band to draw from. The helper preserves the intent. |
| `jitter_pct > 100` clamp | Clamped to 100 (output uniformly distributed over `[0, 2 * base]`) | Caller can't ask for "more than full" jitter. The clamp makes the function total. |
| RNG | `rand::thread_rng()` | Thread-local, OS-seeded. No `Send` requirement, no manual entropy injection in the common case. Tests that need determinism use `jitter_pct = 0` and avoid the RNG entirely. |
| Public API | `pub const BASE_BACKOFF`, `pub const MAX_BACKOFF`, `pub fn exponential_backoff(u32) -> Duration`, `pub fn with_jitter(Duration, u8) -> Duration` | Two constants + two pure functions. No traits, no async, no `Result` — the helpers are the *math*; the loop, the error class, and the abort condition are the caller's. |

If a caller needs different behaviour (a different base, a different cap, a non-uniform jitter distribution, a "decorrelated jitter" variant per the AWS Architecture Blog), the seam is to **extend `phenotype-retry`** — add a new function next to the existing ones and have the caller reach for the new symbol. Do not re-implement the math at the call site.

## Anti-Patterns

- ❌ `100 * 2u64.pow(attempt)` (or `2u32.pow`, or `1 << attempt` multiplied inline) as the backoff delay — the base is hard-coded, the cap is missing, and overflow is one `attempt` away. Use `phenotype_retry::exponential_backoff(attempt)`.
- ❌ `vec![Duration::from_millis(100), Duration::from_millis(200), Duration::from_millis(400), ...]` hand-typed into a `match attempt { ... }` — the table is a base-times-powers-of-two, and the cap is missing. The helper is one line; the table is twenty.
- ❌ `loop { sleep(Duration::from_secs(1)); match op() { ... } }` with no `attempt` counter and no max — the loop has no upper bound on total wall-clock time, the delay never grows, and the surrounding `tokio` runtime can't size its budget. Use a `for attempt in 0..=MAX_ATTEMPTS` loop with `exponential_backoff(attempt)`.
- ❌ Adding `backoff`, `tokio-retry`, `retry`, `retry-rs`, or any other third-party retry crate as a direct dependency. The org picks one wrapper per primitive (`phenotype-retry`); consumers go through the wrapper.
- ❌ `exponential_backoff(attempt)` *without* `with_jitter` in a multi-tenant / concurrent production loop — N coroutines all wait the same deterministic `Duration` and recreate the thundering herd the jitter exists to prevent. The canonical production shape is `with_jitter(exponential_backoff(attempt), JITTER_PCT)`.
- ❌ `with_jitter(exponential_backoff(attempt), 0)` in production — same anti-pattern, just with explicit zeros. The `0` fast path is for tests; production wants at least 10–25%.
- ❌ `exponential_backoff(0)` used as the *first* retry delay in a path that should "fail fast" — the 100 ms base is the minimum, and 100 ms is too long for a hot-path "the user typed the wrong URL" case. Match the retry class to the error (per [error-handling](error-handling.md)) and reserve retry for transient failures.
- ❌ `phenotype_retry::MAX_BACKOFF` shadowed by a hand-rolled `const MAX_BACKOFF: Duration = ...` in a consumer crate — the two values will drift, the org-wide audit will miss one of them, and an operator's "why is the cap 60 s here and 30 s there?" question will not have a single answer.
- ❌ `rand::thread_rng().gen_range(0..=...)` inlined into a retry loop to "save the dependency" — the helper is one `use` away, the math is already there, and the dependency is already in the workspace (it is `phenotype-retry`'s only runtime dep).
- ❌ Using a `Duration::from_millis(rand::random::<u64>())` constant as a "retry delay" — that's a uniform random in `[0, u64::MAX]`, which is either a 0 ms wait (most of the time) or a `Duration::MAX` wait (extremely rarely). The helper produces a value in a *bounded* band; the random constant produces a value in an unbounded one.
- ❌ Sleeping with a `Duration` derived from `Instant::elapsed()` on the previous attempt ("adaptive backoff") — the org's wrapper doesn't do that, the seam for that is the `PhenotypeRetry` extension point in `phenotype-retry` itself, and the caller's job is to reach for the helper, not to invent a new policy.
- ❌ Mixing `phenotype_retry::exponential_backoff` with a per-call-site hand-picked constant `Duration::from_millis(N)` for the *first* attempt — the first attempt's delay is `exponential_backoff(0) = BASE_BACKOFF` by construction, and any other value is a fork of the org-wide policy.

## Reference Implementation

The single source of truth for the helpers:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-retry/src/lib.rs:23-31` | `pub const BASE_BACKOFF: Duration`, `pub const MAX_BACKOFF: Duration` | The 100 ms base and the 30 s cap. `const`-evaluable, so the linker can fold calls in `static` initializers. |
| **phenoShared** | `crates/phenotype-retry/src/lib.rs:65-73` | `pub fn exponential_backoff(attempt: u32) -> Duration` | The `BASE_BACKOFF * 2^attempt` formula with the three-layer overflow guard (`attempt.min(40)` shift, `saturating_mul`, `min(MAX_BACKOFF)`). |
| **phenoShared** | `crates/phenotype-retry/src/lib.rs:109-128` | `pub fn with_jitter(base: Duration, jitter_pct: u8) -> Duration` | The closed-interval `[base * (1 - pct/100), base * (1 + pct/100)]` math with the `0%` / `Duration::ZERO` / `> 100%` fast paths. RNG is `rand::thread_rng()`. |
| **phenoShared** | `crates/phenotype-retry/src/lib.rs:130-222` | `mod tests` | Inline tests, each annotated with the `FR-RTRY-00X` requirement it traces to. `exponential_backoff(u32::MAX)` is asserted equal to `MAX_BACKOFF`; the 0% / `Duration::ZERO` / > 100% jitter paths are asserted as identity / clamp. |

A canonical *consumer* of the crate — a place to look when wiring this into a new adapter:

| Repo | Path | Pattern |
|------|------|---------|
| **phenoShared** | `crates/phenotype-http-adapter/src/http_client.rs` (planned) | Wrap outbound HTTP in `with_retry(|| async { self.fetch(url).await })`. Classify 5xx and timeout as `RetryClass::Transient`, 4xx (other than 429) as `RetryClass::Terminal`. Match `<Crate>Error::RateLimited` to `Transient` so the throttled client and the retry loop compose. |
| **PhenoRuntime** | `crates/pheno-telemetry/src/exporter.rs` (planned) | Wrap the metrics sink in `with_retry` for the "transient collector outage" case. The bucket (per [rate-limiting](rate-limiting.md)) owns the *sampling* decision; the retry loop owns the *recovery* decision; the two are layered, not duplicated. |
| **PhenoMCP-cheap** | integration test harness | Use `exponential_backoff` *without* `with_jitter` so the test is deterministic and asserts against literal `Duration` values. |

## Migration Checklist (per crate)

1. Remove `backoff` / `tokio-retry` / `retry` / `retry-rs` from `[dependencies]` (keep them as transitive deps only if `phenotype-retry` re-exports types from them, which it currently does not).
2. Remove any `100 * 2u64.pow(attempt)` block, any hand-typed `vec![Duration::from_millis(100), ...]` retry table, and any `loop { sleep(...); match op() { ... } }` with no `attempt` counter.
3. Add `phenotype-retry = { path = "../phenotype-retry" }`.
4. Replace every inline backoff expression with `with_jitter(exponential_backoff(attempt), JITTER_PCT)`, where `JITTER_PCT` is a per-call-site `const` (25% is the org default).
5. Convert the `Result` from the inner `op()` into a `RetryClass` (per [error-handling](error-handling.md)) and `match` on it: `RetryClass::Terminal` returns the error immediately, `RetryClass::Transient` records it and continues the loop. The retry is *not* the place to log the terminal error.
6. Bound the loop with `for attempt in 0..=MAX_ATTEMPTS` (a `u32` upper bound, 5 is the org default) and skip the `sleep` after the last attempt. There is no `loop { ... }` without a counter.
7. Use the public constants `phenotype_retry::BASE_BACKOFF` and `phenotype_retry::MAX_BACKOFF` in any `tracing::info!` / `tracing::warn!` line that reports the policy in effect — do not shadow them with per-crate constants.
8. In tests, use `exponential_backoff` *without* `with_jitter` (i.e. `JITTER_PCT = 0` or no wrap) so the test is deterministic. Assert against literal `Duration` values.

## Related Patterns

- [error-handling](error-handling.md) — the retry loop is *not* the place to invent an error class. A `RetryClass` enum (`Terminal` / `Transient`) over the crate-local `<Crate>Error` is the documented shape; the retry loop `match`es on it. The `?`-into-`<Crate>Error` path stays one layer; the retry decision is a second layer on top.
- [async/event-driven](async/event-driven.md) — retry + DLQ behaviour on top of a transient error. The retry loop is the *fast* recovery (a few attempts with exponential backoff); the DLQ is the *slow* recovery (give up retrying, persist for later). The two compose; neither subsumes the other.
- [rate-limiting](rate-limiting.md) — sibling "canonical primitive" pattern. The throttled client's `<Crate>Error::RateLimited` is itself a `RetryClass::Transient`; the retry loop backs off, the bucket owns pacing. The two layers don't fight: the bucket decides *whether* to send, the retry loop decides *how long* to wait when the answer is "not now."
- [http-client](http-client.md) — sibling "canonical primitive" pattern. The retry loop wraps a call to `phenotype_http_client_core::build_default_client()`; it does *not* replace the client's own `timeout` configuration. Per-request timeouts and per-call retries are orthogonal: the timeout bounds a single attempt, the retry loop bounds the *sequence* of attempts.
- [config-loading](config-loading.md) — `MAX_ATTEMPTS` and `JITTER_PCT` are the two values that most often need to be tunable per environment (staging wants fast retries, prod wants conservative ones). They ride the same `phenotype_config_core::config_loader::load_config` factory as every other typed config; do not hand-roll a parser for them.
- [logging](logging.md) — the retry loop's `attempt` counter and the chosen `delay` are exactly the fields that should be on a structured log line when a transient error fires: `tracing::warn!(attempt, delay_ms = delay.as_millis() as u64, error = %err, "transient error, retrying")`. The terminal error after the loop expires is a `tracing::error!`, not a `warn!`.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-retry` is the org's wrapper around the retry ecosystem. Don't reach past it.
- [architecture/hexagonal](architecture/hexagonal.md) — the retry loop is an *adapter-level* concern. The domain layer expresses "this operation may be retried" by returning a typed `Transient` error; the *adapter* wraps the call in `with_retry`. Don't leak `phenotype_retry::exponential_backoff` into the domain layer's public API.

## References

- [`std::time::Duration` docs](https://doc.rust-lang.org/std/time/struct.Duration.html) — the return type of both helpers and the input type of `with_jitter`.
- [`rand::thread_rng` docs](https://docs.rs/rand/latest/rand/fn.thread_rng.html) — the RNG `with_jitter` uses. Thread-local, OS-seeded; do not substitute a manually-seeded RNG in production code.
- [AWS Architecture Blog — "Exponential Backoff And Jitter"](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — the canonical reference for "why jitter de-correlates retry storms." The `phenotype-retry` jitter is a symmetric full-percentage variant of the "Equal Jitter" strategy in the post.
- Internal: `phenoShared/crates/phenotype-retry/src/lib.rs` — the crate this page governs. If you change the public API of `exponential_backoff` / `with_jitter` / `BASE_BACKOFF` / `MAX_BACKOFF`, update this page in the same PR.
- Internal: `phenoShared/FUNCTIONAL_REQUIREMENTS.md` — the `FR-RTRY-00X` requirements the inline tests trace to.
