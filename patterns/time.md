# Time / Timestamps Pattern

## Overview

Every Rust crate in the Pheno* ecosystem that needs the current Unix epoch, an RFC 3339 / ISO 8601 string, or a `SystemTime` parsed from a timestamp goes through one crate: `phenotype-time`. This page is the canonical place that rule lives; it consolidates the "read the clock, format the clock" guidance that was previously implicit in the inline `SystemTime::now().duration_since(UNIX_EPOCH)` and `chrono::Utc::now().to_rfc3339()` blocks scattered across `phenoShared` binaries, the various `*-adapter` crate helpers, and the hand-rolled `format_timestamp` / `parse_timestamp` functions in `PhenoRuntime`, `PhenoAgent`, `PhenoMCP-cheap`, `HeliosLab`, `PhenoEventStore`, and `PhenoVCS`.

If a crate needs the current time, a millisecond Unix stamp, or a canonical ISO 8601 string, it imports `phenotype_time::{now_unix_ms, now_unix_secs, format_iso8601, parse_iso8601}`. If a `Cargo.toml` adds `chrono` (or `time`) directly to format a timestamp, either fix the crate or update this page — don't fork the rule. The `phenotype-time` crate exists for exactly this reason: one place to own the `Z`-terminated millisecond form, the strict RFC 3339 parser, the `TimeError` shape that preserves the offending input, and the `now_unix_*` helpers that match the rest of the org.

## The Rule

| Context | Use | Crate / Function | Why |
|---------|-----|------------------|-----|
| A crate needs the current Unix epoch in whole milliseconds (`i64`) — cache keys, idempotency tokens, log timestamps, monotonic counters | `phenotype_time::now_unix_ms() -> i64` | `phenotype-time` | One helper, one `i64` return, never panics (returns `0` on a pre-epoch clock instead). |
| A crate needs the current Unix epoch in whole seconds (`i64`) — JWT `exp` claims, human-readable log headers | `phenotype_time::now_unix_secs() -> i64` | `phenotype-time` | Same semantics as `now_unix_ms` at second resolution. Prefer `now_unix_ms` for cache TTLs and counters. |
| A crate needs a `SystemTime` rendered as the canonical ISO 8601 string (`YYYY-MM-DDTHH:MM:SS.sssZ`, 24 chars, millisecond resolution, `Z` suffix) | `phenotype_time::format_iso8601(t: SystemTime) -> String` | `phenotype-time` | The `Z`-terminated millisecond form is the form every other Pheno\* crate has converged on; log lines align in a terminal and operators learn one shape. |
| A crate needs to parse an RFC 3339 / ISO 8601 string into a `SystemTime` (env-var input, request body, persisted envelope) | `phenotype_time::parse_iso8601(s: &str) -> Result<SystemTime, TimeError>` | `phenotype-time` | Strict RFC 3339 (accepts both `Z` and `+00:00`); returns `TimeError::Empty` on `""` and `TimeError::Parse { input, reason }` on garbage, with the offending input in the diagnostic. |
| A crate needs sub-millisecond precision or a non-UTC `DateTime<FixedOffset>` | `chrono::{DateTime, Utc}` directly at the call site | `chrono` (direct) | The canonical form is millisecond. If a single call site needs microsecond / nanosecond resolution, reach for `chrono` directly there; do not propagate the deviation through helpers. |

**Hard rule:** `SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)` (and its `as_secs()`, `as_micros()`, `as_nanos()` siblings) is forbidden in Phenotype code. The defaults are wrong for us: every call site re-implements the same `unwrap_or(0)` (or worse, `unwrap()` — see the [anti-patterns](#anti-patterns)), the resolution drifts (one crate uses `as_millis`, the next uses `as_micros`, the next truncates to `i32`), and there is no place to inject a deterministic clock for tests. `phenotype_time::now_unix_ms()` is the only sanctioned read site; the helper is `#[inline]` and the body is one line, so the wrapping cost is zero.

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-time = { path = "../phenotype-time" }

# Do NOT add `chrono` (or `time`) as a direct dependency in a
# consumer crate just to format or parse a timestamp at one call
# site. Consumers go through `phenotype_time::{format_iso8601,
# parse_iso8601}` and never touch `chrono::DateTime<Utc>` or
# `SecondsFormat` directly. Add `chrono` as a direct dep only if
# you are building a `serde` adapter that needs the `DateTime`
# newtypes, or if you are extending `phenotype-time` itself.
#
# `phenotype-time` depends on `chrono` + `thiserror` (workspace
# pins), so the cost of pulling it in is a single `path =` line
# and no extra dep-graph churn in the consumer.
```

### Read the current time

```rust
// crates/<name>/src/telemetry.rs
use phenotype_time::{now_unix_ms, now_unix_secs};

/// Build a cache key from a request id and the current millisecond
/// clock. `now_unix_ms` is `#[inline]` and returns `i64` directly,
/// so this is a register-sized call with no allocation.
pub fn cache_key(request_id: &str) -> String {
    format!("{}:{}", request_id, now_unix_ms())
}

/// A JWT `exp` claim is whole seconds, not milliseconds. The
/// `now_unix_secs` helper is the sanctioned read site; the seconds
/// resolution is intentional (RFC 7519 is whole-second).
pub fn jwt_exp_in(seconds: i64) -> i64 {
    now_unix_secs() + seconds
}
```

### Format a `SystemTime` as ISO 8601

```rust
// crates/<name>/src/log.rs
use std::time::SystemTime;
use phenotype_time::format_iso8601;
use tracing::info;

/// Render a structured log line. `format_iso8601` returns the
/// canonical 24-char `YYYY-MM-DDTHH:MM:SS.sssZ` form, fixed-width
/// so log lines align in a terminal.
pub fn log_request(path: &str, started: SystemTime) {
    info!(
        ts = %format_iso8601(started),
        path = %path,
        "request handled",
    );
}
```

### Parse an ISO 8601 string back to `SystemTime`

```rust
// crates/<name>/src/cli.rs
use std::time::SystemTime;
use phenotype_time::parse_iso8601;
use crate::error::CrateError;

/// Read a `--since` argument in either `Z` or `+00:00` form and
/// convert it to a `SystemTime`. The typed `TimeError` preserves
/// the offending input so the diagnostic is actionable; convert
/// into your crate-local error with `#[from]`.
pub fn parse_since(raw: &str) -> Result<SystemTime, CrateError> {
    parse_iso8601(raw).map_err(CrateError::from)
}
```

Conventions (lifted from `phenoShared/crates/phenotype-time/src/lib.rs:48-168`):

- `now_unix_ms` and `now_unix_secs` are `#[inline]` and return `i64` directly — prefer them in `static` initializers, `format!` arguments, and tracing fields. There is no `Result` return; the helpers swallow a pre-epoch clock to `0` so a request path can never crash on a misconfigured VM.
- `format_iso8601` is the only sanctioned formatter. The output is fixed-width 24 chars (`YYYY-MM-DDTHH:MM:SS.sssZ`), millisecond resolution, `Z`-terminated. If a caller needs a different shape (a JSON envelope, a Prometheus label set, a `strftime` template), build it on top of the `SystemTime` value, never re-derive the string with `chrono::Utc.timestamp_*.to_rfc3339()`.
- `parse_iso8601` accepts both `Z` and `+00:00` and round-trips identically. Sub-millisecond precision is tolerated but discarded — the canonical form is millisecond, so the round-trip is lossy at the microsecond / nanosecond tail by design. If a caller needs to preserve microseconds, reach for `chrono::DateTime::<Utc>::parse_from_rfc3339` directly and document the deviation.
- The return type is `Result<SystemTime, TimeError>`; convert into your crate-local `<Crate>Error` with `#[from]` (see [error-handling](error-handling.md)) so the rest of the binary keeps one error type. Never re-export `TimeError` from your crate's public API.
- Both `format_iso8601` and `parse_iso8601` are pure (no global state, no `RefCell`); they are safe to call from a `tracing` field initializer, a `serde` `Serialize` impl, or a `static` lazy-init context.

## What `phenotype-time` Configures

The crate is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Canonical form | `YYYY-MM-DDTHH:MM:SS.sssZ`, 24 chars, millisecond resolution, `Z` suffix (`phenoShared/crates/phenotype-time/src/lib.rs:97-123`) | One shape across every Pheno\* log line, error envelope, and `/healthz` response. Operators regex against one shape; terminal output aligns. The `Z` suffix is the log-friendly UTC shorthand; `+00:00` is accepted on parse but never emitted. |
| `now_unix_*` resolution | `now_unix_ms` → `i64` millis, `now_unix_secs` → `i64` whole seconds (`lib.rs:48-95`) | Two helpers, two resolutions. The `i64` return is signed and negative on pre-1970 hosts, matching `std::time::SystemTime` semantics. The `as_millis() as i64` cast is intentional: `u128` is too wide for the rest of the org's serializations. |
| Pre-epoch clock behaviour | `.unwrap_or(0)` (`lib.rs:68-73`, `lib.rs:90-95`) | The literal `0` rather than a panic or a `None`. Log timestamps should never crash a request path on a misconfigured VM. The `0` is recognizably broken in dashboards, which is the desired signal. |
| Parser strictness | `chrono::DateTime::parse_from_rfc3339` (`lib.rs:153-168`) | Strict RFC 3339 — the superset of ISO 8601 we want. It accepts both `Z` and explicit numeric offsets and rejects ambiguous / partial forms. The `TimeError::Parse { input, reason }` variant keeps the offending input in the diagnostic so log lines are actionable. |
| Empty-string handling | `TimeError::Empty` (`lib.rs:43-46`, `lib.rs:154-157`) | Surfaced as its own variant, not collapsed into `Parse`. A `CLI --since=""` is a user error, not a parse error; the variant matches the diagnostic. |
| `Z` ↔ `+00:00` round-trip | Both forms parse to the same `SystemTime`; only `Z` is emitted (`lib.rs:125-152`) | `parse_iso8601` normalises to UTC via `.with_timezone(&Utc)`, so a `+00:00` input round-trips through `format_iso8601` to a `Z` output. The output shape is the only canonical form. |
| Sub-millisecond loss | `format_iso8601` uses `SecondsFormat::Millis` (`lib.rs:121-122`) | The canonical form is millisecond; the microsecond / nanosecond tail is intentionally discarded. Callers that need it reach for `chrono` directly. |

If a caller needs different behaviour (a different resolution, a non-`Z` suffix, a non-strict parser, a different pre-epoch fallback), the seam is the same crate: add a new helper next to the existing ones and have the caller reach for the new symbol. Do not fork the helper at the call site.

## Anti-Patterns

- ❌ `SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)` (or the `as_secs` / `as_micros` / `as_nanos` siblings) inlined at a call site — re-implements `now_unix_ms` (or its sibling), drifts from the documented pre-epoch fallback, and silently breaks the day someone wants a deterministic clock for tests. Use `phenotype_time::now_unix_ms()` / `now_unix_secs()`.
- ❌ `chrono::Utc::now().to_rfc3339()` (or `to_rfc3339_opts(SecondsFormat::AutoSi, true)`) inlined at a call site — emits the `+00:00` form, not the canonical `Z`-terminated form; drifts from every other Pheno\* log line. Use `phenotype_time::format_iso8601(SystemTime::now())` (or pass an explicit `started: SystemTime` captured at request entry).
- ❌ `chrono::DateTime::parse_from_rfc3339(s).map(|dt| dt.with_timezone(&Utc).into())` inlined at a call site — re-implements `parse_iso8601`, drifts from the `TimeError` shape, and silently changes the error contract (no `Empty` variant, no `input` field). Use `phenotype_time::parse_iso8601(s)`.
- ❌ `.unwrap()` / `.expect()` on `SystemTime::now().duration_since(UNIX_EPOCH)` at a call site — the canonical pre-epoch fallback is `unwrap_or(0)`, not a panic. A misconfigured VM clock should not be able to crash a request path; reach for the helper, not the inline form.
- ❌ Hand-rolled `format_timestamp(t: SystemTime) -> String` that re-derives the canonical form with `format!("{}", chrono::DateTime::<Utc>::from(t).format("%Y-%m-%dT%H:%M:%S%.3fZ"))` — drifts from the canonical form the day someone changes the format string (off-by-one hyphen, capital `%Z` vs `Z` literal, `%3f` vs `%.3f`). Use `phenotype_time::format_iso8601(t)`.
- ❌ `chrono` / `time` added as a direct dependency in a consumer crate just to format or parse a single timestamp — the helper crate is the wrapper. `chrono` is a transitive dep of `phenotype-time`; consumers do not name it.
- ❌ Branching on `now_unix_ms() == 0` to decide whether the host clock is "real" — the `0` is a documented fallback, not a sentinel. If a caller needs a monotonic / deterministic clock for tests, inject one via a port (`trait Clock { fn now_unix_ms(&self) -> i64; }`) and pass a `SystemClock` in production and a `FixedClock` in tests; do not poll `now_unix_ms` for sentinels.
- ❌ Building an `Instant`-based monotonic clock from a `SystemTime` value (e.g. `Instant::now() - started.duration_since(UNIX_EPOCH).unwrap()`) — `Instant` is monotonic and not comparable to wall-clock; this anti-pattern silently produces garbage. If you need a monotonic delta, use `Instant::now()` directly and a `Duration` arithmetic, never a wall-clock subtraction.
- ❌ Persisting `now_unix_ms()` as an `i32` to save bytes — the value overflows `i32` at 2038-01-19T03:14:07Z, the canonical Y2038 boundary. Use `i64` everywhere; do not optimise the width.
- ❌ Reading the clock twice in the same function and assuming the two values are equal — `now_unix_ms()` is non-monotonic per `SystemTime` semantics. Capture once into a `let started = now_unix_ms();` and reuse it.

## Reference Implementation

The single source of truth for the helpers:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-time/src/lib.rs:48-73` | `pub fn now_unix_ms() -> i64` | `SystemTime::now().duration_since(UNIX_EPOCH).map(\|d\| d.as_millis() as i64).unwrap_or(0)`. The pre-epoch fallback to `0` is intentional. |
| **phenoShared** | `crates/phenotype-time/src/lib.rs:75-95` | `pub fn now_unix_secs() -> i64` | Same shape at second resolution. Use for JWT `exp` claims and human-readable log headers. |
| **phenoShared** | `crates/phenotype-time/src/lib.rs:97-123` | `pub fn format_iso8601(t: SystemTime) -> String` | The canonical 24-char `YYYY-MM-DDTHH:MM:SS.sssZ` form, `Z`-terminated, millisecond resolution. `chrono::DateTime<Utc>` implements `From<SystemTime>`, so the body is allocation-free. |
| **phenoShared** | `crates/phenotype-time/src/lib.rs:125-168` | `pub fn parse_iso8601(s: &str) -> Result<SystemTime, TimeError>` | Strict RFC 3339 (accepts both `Z` and `+00:00`); round-trips identically. Returns `TimeError::Empty` on `""` and `TimeError::Parse { input, reason }` on garbage. |
| **phenoShared** | `crates/phenotype-time/src/lib.rs:32-46` | `pub enum TimeError` (`#[derive(Debug, Error, PartialEq, Eq)]`) | Two variants, `Empty` and `Parse { input, reason }`. Every variant preserves the offending input. Follows the [error-handling](error-handling.md) pattern. |
| **phenoShared** | `crates/phenotype-time/src/lib.rs:170-177` | `fn system_time_from_chrono(dt: DateTime<Utc>) -> SystemTime` | Internal helper: `UNIX_EPOCH + Duration::new(secs, nanos)`. The `try_from(0)` floor for negative timestamps is intentional. |
| **phenoShared** | `crates/phenotype-time/src/lib.rs:179-247` | `mod tests` | Inline tests, each annotated with the `FR-TIME-00X` requirement it traces to. Pins the 24-char form, the `Z` suffix, the `+00:00` ↔ `Z` round-trip, and the `Empty` / `Parse` error contract. |

## Migration Checklist (per crate / binary)

1. Add `phenotype-time = { path = "../phenotype-time" }` to `[dependencies]`.
2. Replace every `SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)` (or its `as_secs` / `as_micros` / `as_nanos` siblings) with `phenotype_time::now_unix_ms()` (or `now_unix_secs()`). Delete the inline `unwrap_or(0)` — the helper owns the pre-epoch fallback.
3. Replace every `chrono::Utc::now().to_rfc3339()` / `to_rfc3339_opts(...)` block used to format a log / response / envelope timestamp with `phenotype_time::format_iso8601(SystemTime::now())` (or pass an explicit `started: SystemTime` captured at request entry).
4. Replace every `chrono::DateTime::parse_from_rfc3339(s).map(|dt| dt.with_timezone(&Utc).into())` (or its `NaiveDateTime` / `DateTime<FixedOffset>` siblings) with `phenotype_time::parse_iso8601(s)`. Convert the `TimeError` into your crate-local error with `#[from]` — the `input` field must survive the conversion.
5. Delete any `chrono` / `time` direct dependency that was only there to format or parse a timestamp at a call site. Keep `chrono` as a transitive dep if you need the `DateTime` newtypes in a `serde` adapter.
6. Delete any `.unwrap()` / `.expect()` on `SystemTime::now().duration_since(UNIX_EPOCH)` — the helper's `unwrap_or(0)` is the sanctioned pre-epoch fallback. If a caller needs a panic on pre-epoch, it should be explicit (`.expect("host clock predates Unix epoch")`) and live behind a test-only feature flag.
7. If a test needs a deterministic clock, inject a `trait Clock` port (`fn now_unix_ms(&self) -> i64`) and pass a `SystemClock` in production and a `FixedClock` in tests. Do not branch on `now_unix_ms() == 0` to detect the test environment.
8. Audit every `i32` (and `u32`) field that stores a Unix epoch timestamp — promote to `i64` to survive the Y2038 boundary. This is a one-line change but easy to miss; grep for `i32` and `as i32` in any timestamp field.

## Related Patterns

- [config-loading](config-loading.md) — sibling "canonical primitive" pattern: a single crate owns a default (timeouts, format auto-detection, typed errors with a `path` field) and every consumer goes through it. The seam is the same shape: extend `phenotype-time` rather than fork the helper.
- [error-handling](error-handling.md) — `TimeError` is the `thiserror` enum every `parse_iso8601` call site converts into its own `<Crate>Error` via `#[from]`. The `input: String` field must survive the conversion — it is the actionable part of the diagnostic.
- [build-info](build-info.md) — the timestamp on a log line and the `git_sha` on the same line come from two different canonical primitives. The log line's `ts` is `format_iso8601(started)`; the same line's `git_sha` is `phenotype_build_info::git_sha()`. Pair them; do not duplicate either.
- [logging](logging.md) — the structured-log contract for timestamps is `format_iso8601(started)` as a `tracing` field, not `chrono::Utc::now().to_rfc3339()` as a `Display` value. The 24-char fixed width keeps log lines aligned in a terminal.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-time` is the org's wrapper around `std::time::SystemTime` + `chrono::DateTime<Utc>`. Don't reach past it.
- [architecture/hexagonal](architecture/hexagonal.md) — time is a *port*: the rest of the binary depends on `phenotype_time::now_unix_ms` / `format_iso8601` / `parse_iso8601`, and a `trait Clock` adapter swaps in a `FixedClock` for tests. The helper is the production adapter; the trait is the seam.

## References

- [`std::time::SystemTime` docs](https://doc.rust-lang.org/std/time/struct.SystemTime.html) — the type `now_unix_*` reads and `format_iso8601` / `parse_iso8601` operate on.
- [`std::time::UNIX_EPOCH` constant](https://doc.rust-lang.org/std/time/constant.UNIX_EPOCH.html) — the `now_unix_*` helpers' reference point.
- [`chrono` crate](https://docs.rs/chrono) — the `phenotype-time` crate's only direct dependency; consumers do not name it.
- [RFC 3339 — Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339) — the format `parse_iso8601` accepts and `format_iso8601` is a strict subset of.
- [ISO 8601 — Date and time format](https://www.iso.org/iso-8601-date-and-time-format.html) — the broader standard; the canonical form is the millisecond-precision `Z`-terminated subset.
- Internal: `phenoShared/crates/phenotype-time/src/lib.rs` — the helpers this page governs. If you change the public API (new helper, new `TimeError` variant, new resolution), update this page in the same PR.
- Internal: `phenoShared/crates/phenotype-time/Cargo.toml` — the `phenotype-time = { workspace = true }` + `chrono` + `thiserror` dep set. Bumping `chrono` is a coordinated change; the helper's `to_rfc3339_opts(SecondsFormat::Millis, true)` call site is the only place that has to track the `chrono` major version.
