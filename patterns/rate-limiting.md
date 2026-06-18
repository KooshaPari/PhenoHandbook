# Rate Limiting Pattern

## Overview

Every Rust crate in the org that needs to throttle, pace, or back-pressure a stream of work goes through one crate: `phenotype-rate-limit`. This page is the canonical place that rule lives; it consolidates the "throttle" / "rate-limit" / "shed load" guidance that was previously implicit in the hand-rolled `Instant::now() - last < interval` checks and the `tokio::time::sleep(...).await` loops scattered across adapters and relay workers.

The `phenotype-rate-limit` crate ships two primitives:

- `TokenBucket` — a bucket that holds up to `capacity` tokens, refilled one-at-a-time at a fixed interval. Calls `try_acquire` succeed if a token is available, fail otherwise. Allows short bursts up to `capacity` and a sustained long-term rate equal to the refill rate.
- `LeakyBucket` — a bucket that holds up to `capacity` units of queued work, drained one-at-a-time at a fixed interval. Calls `try_submit` enqueue one unit if there is room, fail otherwise. Smooths the output to a constant rate; the queue is the only place bursts can hide.

Both are `Send + Sync` when wrapped in the standard `Mutex` / `RwLock` shims, both implement `serde::Serialize` / `Deserialize` so they can ride on the [config-loading](config-loading.md) factory, and both share the same `Error` / `Result` shape ([error-handling](error-handling.md)).

If a crate needs to rate-limit, it imports `phenotype_rate_limit::{TokenBucket, LeakyBucket}`. If a `Cargo.toml` adds `governor`, `rate_limit`, or a hand-rolled `Mutex<Instant>` to throttle, either fix the crate or update this page — don't fork the rule. The `phenotype-rate-limit` crate exists for exactly this reason: one place to own the bucket math, the typed `Error`, and the serde config shape so every caller gets the same behaviour.

## The Rule

| Context | Use | Type | Why |
|---------|-----|------|-----|
| Throttle outbound calls to a third-party API that publishes a `requests-per-second` or `requests-per-minute` ceiling (e.g. an HTTP adapter to GitHub, Stripe, an LLM provider) | `phenotype_rate_limit::TokenBucket` with `capacity = N` and `refill_interval = 1s / N` | `TokenBucket` | Bursty callers (one slow request followed by 50 quick ones) are fine up to `capacity`; the long-term rate is enforced by the refill cadence. Matches what most vendor rate-limit headers actually say. |
| Pace a worker that emits events / metrics / logs at a steady rate (e.g. a batched exporter, a sampled tracer) | `phenotype_rate_limit::LeakyBucket` with `capacity = 1` and `leak_interval = 1s / rate` | `LeakyBucket` | Output is exactly one event per `leak_interval` on average, with no burst. Back-pressure surfaces as `try_submit` returning `false`, which the worker maps to a "drop / sample / log-and-continue" decision. |
| Back-pressure a queue (in-memory channel, NATS subscriber, file-watcher) so a fast producer cannot drown a slow consumer | `phenotype_rate_limit::LeakyBucket` with `capacity = queue_depth` and `leak_interval = consumer_pace` | `LeakyBucket` | The bucket is the queue's admission policy; producer calls `try_submit` before the enqueue, consumer pace is the leak. |
| Anything that currently uses `tokio::time::sleep(...).await` in a loop, a `Mutex<Instant>`, or a hand-rolled counter to throttle work | `phenotype_rate_limit::{TokenBucket, LeakyBucket}` | — | The sleep-loop is a token bucket with the bucket math re-implemented (and usually wrong) at every call site. Centralising it in one crate means the math is correct once and audited once. |

**Hard rule:** `tokio::time::sleep(...).await` (or `std::thread::sleep`) used as a *throttle* — not as a *retry backoff*; the retry case is governed by [async/event-driven.md](async/event-driven.md) — is forbidden in Phenotype code. The sleep duration is the bucket's refill interval, the `Instant` you wake to is the bucket's last-refill, and the rest of the math is a one-liner the `phenotype-rate-limit` crate owns. Re-implementing it at the call site is the exact thing the pattern forbids.

**Hard rule:** adding `governor`, `rate_limit`, `leaky-bucket`, or any other third-party throttling crate as a direct dependency is forbidden. `phenotype-rate-limit` is the wrapper. Per [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md), the org picks one wrapper per primitive and consumes the wrapper, not the ecosystem crate.

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-rate-limit = { path = "../phenotype-rate-limit" }

# Note: do NOT add `governor`, `rate_limit`, `leaky-bucket`, or a hand-rolled
# Mutex<Instant> in a consumer crate to throttle work. Consumers go through
# `phenotype_rate_limit::{TokenBucket, LeakyBucket}` and never re-implement
# the bucket math. Add the third-party crate as a direct dep only if you are
# extending `phenotype-rate-limit` itself.
```

### Token bucket — throttle an outbound HTTP adapter

```rust
// crates/<name>/src/adapters/<thing>/client.rs
use std::sync::Mutex;
use std::time::Duration;

use phenotype_rate_limit::{TokenBucket, Result as RateLimitResult};
use crate::error::<Crate>Error;

/// HTTP client wrapper for the <thing> adapter, throttled to
/// `RATE_PER_SEC` requests per second with a burst tolerance of `BURST`.
///
/// The `TokenBucket` lives behind a `Mutex` so the same client can be
/// shared across an `Arc` (HTTP adapters are usually held in a
/// `OnceLock` or DI container, see [http-client](http-client.md)).
#[derive(Clone)]
pub struct <Thing>HttpClient {
    http: reqwest::Client,
    bucket: std::sync::Arc<Mutex<TokenBucket>>,
}

const RATE_PER_SEC: u32 = 10;   // vendor says: 10 req/s sustained
const BURST: u32 = 20;          // vendor says: tolerate 2× burst

impl <Thing>HttpClient {
    pub fn new() -> Result<Self, <Crate>Error> {
        let http = build_default_client().map_err(<Crate>Error::from)?;

        // 1 token every 100 ms ⇒ 10 tokens/sec sustained, capacity 20
        // allows a 2-second burst at the start of each quiet period.
        let bucket = TokenBucket::new(BURST, Duration::from_millis(1_000 / RATE_PER_SEC as u64))
            .map_err(<Crate>Error::from)?;

        Ok(Self { http, bucket: std::sync::Arc::new(Mutex::new(bucket)) })
    }

    pub async fn fetch(&self, url: &str) -> Result<Thing, <Crate>Error> {
        // try_acquire is non-blocking and non-async: the bucket math is
        // a few arithmetic ops on a `u64` and an `Instant`. We hold the
        // lock for the duration of that math only.
        let acquired = {
            let mut b = self.bucket.lock().expect("bucket mutex poisoned");
            b.try_acquire()
        };

        if !acquired {
            // Map "rate limit hit" into the crate's typed error so the
            // caller's retry / DLQ logic ([async/event-driven](async/event-driven.md))
            // can `match` on it. Do NOT sleep-and-retry here — the
            // bucket owns pacing; the caller owns the backoff policy.
            return Err(<Crate>Error::RateLimited);
        }

        let response = self.http.get(url).send().await
            .map_err(<Crate>Error::from)?
            .error_for_status()
            .map_err(<Crate>Error::from)?;
        let body = response.json::<Thing>().await.map_err(<Crate>Error::from)?;
        Ok(body)
    }
}
```

### Leaky bucket — pace a metrics exporter

```rust
// crates/<name>/src/observability/exporter.rs
use std::sync::Mutex;
use std::time::Duration;

use phenotype_rate_limit::{LeakyBucket, Result as RateLimitResult};
use crate::error::<Crate>Error;

/// Sampled metrics exporter, paced to one batch per `EXPORT_INTERVAL`.
///
/// The bucket's `capacity = 1` and `leak_interval = EXPORT_INTERVAL`
/// means: at most one batch is in flight; the next `try_submit` only
/// succeeds once `EXPORT_INTERVAL` has elapsed. If the worker is
/// faster than that, it gets back-pressure on the bucket, not a
/// `sleep` that hides the pressure from the surrounding logic.
pub struct MetricsExporter {
    bucket: Mutex<LeakyBucket>,
    sink: Box<dyn MetricsSink>,
}

impl MetricsExporter {
    pub fn new(sink: Box<dyn MetricsSink>) -> RateLimitResult<Self> {
        Ok(Self {
            // 1-batch capacity, 1-second leak ⇒ exactly 1 batch/sec.
            bucket: Mutex::new(LeakyBucket::new(1, Duration::from_secs(1))?),
            sink,
        })
    }

    /// Returns `Ok(())` if the batch was accepted, `Err(RateLimited)`
    /// if the bucket is full (i.e. the previous second's batch is
    /// still in flight). The worker maps `RateLimited` to "drop the
    /// batch and log a sampled-out event" — see [logging](logging.md)
    /// for the structured-field shape.
    pub fn try_export(&self, batch: MetricBatch) -> Result<(), <Crate>Error> {
        let mut b = self.bucket.lock().expect("bucket mutex poisoned");
        if !b.try_submit() {
            tracing::debug!(batch_size = batch.len(), "metrics batch sampled out");
            return Err(<Crate>Error::RateLimited);
        }
        self.sink.write(batch).map_err(<Crate>Error::from)
    }
}
```

### Configuring a bucket from the typed config

Both types implement `serde::Serialize` / `Deserialize` so they ride the [config-loading](config-loading.md) factory — no hand-rolled parser, no `Mutex<Instant>` shadow config:

```rust
// crates/<name>/src/config.rs
use std::time::Duration;
use serde::Deserialize;
use phenotype_rate_limit::{TokenBucket, LeakyBucket, Error as RateLimitError};

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub name: String,

    /// Token-bucket config for the outbound <thing> adapter. The
    /// factory deserializes straight into a `TokenBucket`, validates
    /// capacity > 0 and refill_interval > 0 in the constructor, and
    /// fails the config load with `RateLimitError::Invalid` otherwise.
    #[serde(rename = "thing_rate_limit")]
    pub thing_bucket: BucketConfig,

    /// Leaky-bucket config for the metrics exporter.
    #[serde(rename = "metrics_rate_limit")]
    pub metrics_bucket: BucketConfig,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BucketConfig {
    Token { capacity: u32, refill_interval_ms: u64 },
    Leaky { capacity: u32, leak_interval_ms: u64 },
}

impl BucketConfig {
    pub fn into_token(self) -> Result<TokenBucket, RateLimitError> {
        match self {
            BucketConfig::Token { capacity, refill_interval_ms } =>
                TokenBucket::new(capacity, Duration::from_millis(refill_interval_ms)),
            other => Err(RateLimitError::Invalid(format!(
                "expected Token bucket config, got {:?}", other
            ))),
        }
    }

    pub fn into_leaky(self) -> Result<LeakyBucket, RateLimitError> {
        match self {
            BucketConfig::Leaky { capacity, leak_interval_ms } =>
                LeakyBucket::new(capacity, Duration::from_millis(leak_interval_ms)),
            other => Err(RateLimitError::Invalid(format!(
                "expected Leaky bucket config, got {:?}", other
            ))),
        }
    }
}
```

`AppConfig` loads through `phenotype_config_core::config_loader::load_config::<AppConfig>(path)` — same factory, same `LOAD_TIMEOUT`, same `path`-in-error contract as every other typed config.

## When to use TokenBucket vs LeakyBucket

The two primitives look similar but model different policies. Pick by **what the producer / consumer pair looks like**, not by which is more familiar.

| Property | `TokenBucket` | `LeakyBucket` |
|----------|---------------|---------------|
| Models | "I have N chances per unit time" | "I emit at most 1 per unit time, with a bounded queue" |
| Long-term rate | One token per `refill_interval`, up to `capacity` in flight | One unit drained per `leak_interval`, up to `capacity` queued |
| Burst behaviour | **Allows bursts up to `capacity`** — a quiet period is "saved up" as tokens, then spent in a rush | **Rejects bursts** — once the bucket is full, `try_submit` returns `false`; the producer is back-pressured |
| Output shape | Variable, bounded by capacity + refill cadence | Smooth, exactly one per `leak_interval` on average |
| Back-pressure on producer | Producer sees `try_acquire() == false` and decides what to do (queue / drop / sleep-and-retry) | Producer sees `try_submit() == false` and decides what to do (queue / drop / sleep-and-retry) |
| Back-pressure on consumer | None — the consumer may receive a burst and have to keep up | Implicit — the bucket drains at `leak_interval`, so the consumer is paced too |
| When the upstream says | "10 requests per second, up to 20 burst" (most vendor rate-limit headers) | "At most 1 message per second" (sampling, telemetry export, heartbeats) |
| Typical use | Outbound API client throttling, login attempt throttling, LLM token budget | Sampled metrics exporter, paced heartbeat emitter, queue admission control |
| Anti-fit | Don't use `TokenBucket` if you need a *strict* per-tick rate — the burst allowance will let you exceed the nominal rate by `capacity - 1` | Don't use `LeakyBucket` if the producer genuinely needs to send bursts and you have no queue — you'll drop work the bucket *should* have absorbed |

A rule of thumb: **if the bucket's job is to be a polite neighbour to a downstream that publishes a rate limit, use `TokenBucket`. If the bucket's job is to give the system a steady heartbeat, use `LeakyBucket`.** When in doubt, start with `TokenBucket` — vendor rate limits are almost always token-shaped — and only switch to `LeakyBucket` when the requirement is "this thing must not burst, period."

## What `phenotype-rate-limit` Configures

The crate is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Capacity validation | `capacity > 0`; constructor returns `Error::Invalid` otherwise | Zero-capacity buckets are always full / always empty depending on the type; either is a bug. |
| Interval validation | `refill_interval > 0` and `leak_interval > 0`; constructor returns `Error::Invalid` otherwise | Zero-interval buckets refill / leak instantly and silently become no-ops; the bug presents as "rate limit not enforced", which is the worst possible failure mode. |
| Time source | `std::time::Instant` (monotonic) | Wall-clock (`SystemTime`) is wrong for rate limiting — NTP slew, leap-seconds, and clock-jump corrections all show up as false bursts or false throttles. |
| Serde shape | `TokenBucket` / `LeakyBucket` both `#[derive(Serialize, Deserialize)]`; the `time::Duration` field is serialised as `{ secs, nanos }` (serde's default) | The bucket config rides `phenotype-config-core` unchanged. No custom (de)serialiser, no `String` shim for the interval. |
| `Send + Sync` | The structs are `Send + Sync` once their fields are (the `Instant` is, the `Duration` is, the `u32` / `u64` counters are) | They sit in a `Mutex` / `RwLock` and are shared across an `Arc` without ceremony. |
| Conversion into `<Crate>Error` | `Error::Invalid(String)` is a single-variant `thiserror` enum; wrap with `#[from]` per [error-handling](error-handling.md) | The crate's `Result` alias is short (`Result<T>`), and the `#[from]` path lets call sites `?` the constructor into their crate-local error without `.map_err`. |

If a caller needs different behaviour (a different time source for tests, a different serialisation shape, a token bucket that refills `N` tokens per interval instead of one), the seam is to **extend `phenotype-rate-limit`** — do not re-implement the bucket at the call site. The crate is the wrapper; the wrapper is the place new variants live.

## Anti-Patterns

- ❌ `tokio::time::sleep(d).await` used as a throttle (`while !ready { sleep(...).await; ready = ... }`) — the sleep duration is the bucket's refill interval, the `Instant` you wake to is the bucket's last-refill, the rest of the math is a `u64` counter. Use the bucket; reserve `sleep` for retry backoff (governed by [async/event-driven.md](async/event-driven.md)) and test waits.
- ❌ `std::thread::sleep` between requests in a synchronous worker — same anti-pattern, just on the blocking thread. Buckets are sync internally; the async / sync split is orthogonal to the rate-limit shape.
- ❌ `Mutex<Instant>` + a hand-rolled "have N ms elapsed?" check — the bucket, with no constructor validation, no `Send + Sync` story, no serde config, and the math re-implemented at every call site.
- ❌ Adding `governor`, `rate_limit`, `leaky-bucket`, or any other third-party throttling crate as a direct dependency. The org picks one wrapper per primitive (`phenotype-rate-limit`); consumers go through the wrapper.
- ❌ `TokenBucket::new(0, ...)` or `LeakyBucket::new(N, Duration::ZERO)` — the constructors reject these with `Error::Invalid`; a `try_acquire` on a misconfigured bucket will silently always return `false` (token bucket) or `true` (leaky bucket with `capacity = 0`), which is the worst possible failure mode. Validate at config load.
- ❌ Sleeping inside the bucket's `try_acquire` / `try_submit` — the bucket is *non-blocking by design*. If you need to block until a token is available, use the bucket to decide *when* to wake (`tokio::time::sleep_until(deadline)`) and let the bucket own the pacing decision.
- ❌ Using `TokenBucket` to enforce a strict per-tick rate — the burst allowance will let you exceed the nominal rate by `capacity - 1`. Use `LeakyBucket` for strict pacing, or shrink `capacity` to `1`.
- ❌ Using `LeakyBucket` as a "free pass" queue with `capacity = u32::MAX` — that's no longer a queue, it's a buffer, and you've lost the rate-limit. Pick a capacity that matches the consumer's actual tolerance.
- ❌ Sharing a `TokenBucket` / `LeakyBucket` across an `Arc` **without** a `Mutex` / `RwLock` — the bucket is `Send + Sync` but its `try_acquire` / `try_submit` take `&mut self`. The crate is a primitive; the concurrency primitive is the caller's choice.

## Reference Implementation

The single source of truth for the crate:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-rate-limit/src/lib.rs` | `pub struct TokenBucket`, `pub struct LeakyBucket`, `pub enum Error`, `pub type Result<T>` | Defines both primitives, the `Error::Invalid(String)` variant (single-variant `thiserror` enum, per [error-handling](error-handling.md)), and the `Result` alias. `#[derive(Serialize, Deserialize)]` on both bucket types so they ride the [config-loading](config-loading.md) factory. |
| **phenoShared** | `crates/phenotype-rate-limit/src/token_bucket.rs` | `TokenBucket::new(capacity, refill_interval) -> Result<Self, Error>`, `try_acquire() -> bool`, `try_acquire_many(n) -> bool`, `capacity() -> u32`, `available() -> u32` | The full surface. `new` is the only constructor; the only way to get a bucket is the validated path. |
| **phenoShared** | `crates/phenotype-rate-limit/src/leaky_bucket.rs` | `LeakyBucket::new(capacity, leak_interval) -> Result<Self, Error>`, `try_submit() -> bool`, `try_submit_many(n) -> bool`, `level() -> u32`, `capacity() -> u32` | The full surface. `level()` exposes the current fill so the caller can log back-pressure (see [logging](logging.md) on typed fields). |

A canonical *consumer* of the crate — a place to look when wiring this into a new adapter:

| Repo | Path | Pattern |
|------|------|---------|
| **phenoShared** | `crates/phenotype-http-adapter/src/http_client.rs` (planned) | Throttle outbound HTTP to vendor rate-limit headers. Wrap `TokenBucket` in `Arc<Mutex<_>>`, hold the client in a `OnceLock`, surface `try_acquire() == false` as `<Crate>Error::RateLimited`. |
| **PhenoRuntime** | `crates/pheno-telemetry/src/exporter.rs` (planned) | Pace a sampled metrics exporter with `LeakyBucket::new(1, EXPORT_INTERVAL)`. Map `try_submit() == false` to a `tracing::debug!` "sampled out" event with the batch size as a structured field. |

## Migration Checklist (per crate)

1. Remove `governor` / `rate_limit` / `leaky-bucket` from `[dependencies]` (keep them as transitive deps only if `phenotype-rate-limit` re-exports types from them, which it currently does not).
2. Remove any hand-rolled `Mutex<Instant>` + `Instant::elapsed()` throttle block.
3. Add `phenotype-rate-limit = { path = "../phenotype-rate-limit" }`.
4. Replace every `tokio::time::sleep(d).await` used as a throttle with a `TokenBucket` (for outbound throttling) or `LeakyBucket` (for steady pacing). Keep `sleep` for retry backoff — that is governed by [async/event-driven.md](async/event-driven.md), not this page.
5. Wrap the bucket in `Arc<Mutex<_>>` (or `Arc<RwLock<_>>` if you only read `level()` / `available()`) and share it across the adapter's hot path.
6. If the bucket parameters come from config, declare them as `BucketConfig` (the tagged enum above) and let the [config-loading](config-loading.md) factory deserialise straight into the bucket. Add `#[from] RateLimitError` to your crate-local error so the config-load path stays a single `?` chain.
7. Surface `try_acquire() == false` / `try_submit() == false` as a typed `<Crate>Error::RateLimited` variant; do not panic, do not swallow, do not silently retry. The bucket's decision is the source of truth.

## Related Patterns

- [error-handling](error-handling.md) — `phenotype_rate_limit::Error` is a single-variant `thiserror` enum; wrap it into `<Crate>Error` via `#[from]`, the same way `ConfigError` and `HttpClientBuildError` are wrapped. The `<Crate>Error::RateLimited` variant is the one the bucket's `try_acquire` / `try_submit` decision flows into.
- [http-client](http-client.md) — sibling "canonical primitive" pattern. `build_default_client` is the org's wrapper around `reqwest`; `phenotype-rate-limit` is the org's wrapper around the rate-limit ecosystem. The two compose: the throttled HTTP client above shows the canonical pairing.
- [config-loading](config-loading.md) — `TokenBucket` and `LeakyBucket` are both `Serialize` / `Deserialize`, and the bucket parameters ride the same `load_config` factory as every other typed config. The `BucketConfig` enum above is the documented way to keep the on-disk shape stable across the two primitive types.
- [logging](logging.md) — the bucket's `available()` / `level()` are exactly the fields that should be on a structured log line when back-pressure fires. `tracing::warn!(bucket = "thing", available = %available, "rate limit hit")` is the shape.
- [async/event-driven](async/event-driven.md) — retry / DLQ behaviour on top of `<Crate>Error::RateLimited`. The bucket owns the *pacing* decision; the event-driven layer owns the *recovery* decision (retry with backoff? dead-letter? shed and log?).
- [architecture/hexagonal](architecture/hexagonal.md) — the bucket is an *adapter-level* concern. The domain layer expresses "this operation is throttled" by returning a typed `RateLimited` error; the *adapter* wraps the bucket. Don't leak `phenotype_rate_limit::TokenBucket` into the domain layer's public API.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-rate-limit` is the org's wrapper around the rate-limit ecosystem. Don't reach past it.

## References

- [`std::time::Instant` docs](https://doc.rust-lang.org/std/time/struct.Instant.html) — the monotonic time source the bucket uses internally. Don't substitute `SystemTime`; the wall clock is wrong for rate limiting.
- [`std::time::Duration` docs](https://doc.rust-lang.org/std/time/struct.Duration.html) — the interval type for `refill_interval` / `leak_interval`.
- [`serde` derive docs](https://docs.rs/serde/latest/serde/index.html) — the derive macros on both bucket types. Consumers don't need a custom (de)serialiser; the defaults produce a stable on-disk shape.
- Internal: `phenoShared/crates/phenotype-rate-limit/src/` — the crate this page governs. If you change the public API of `TokenBucket` / `LeakyBucket` / `Error`, update this page in the same PR.
