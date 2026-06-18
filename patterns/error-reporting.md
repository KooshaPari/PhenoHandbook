# Error Reporting Pattern

## Overview

Every Rust crate in the Pheno* ecosystem that needs to surface an error to logs (a `?`-bailed `io::Error`, a `RepositoryError::NotFound`, an `anyhow::Error` returned from an adapter, a `serde_json` parse failure inside a worker) goes through one function: `phenotype_error_core::report`. This page is the canonical place that rule lives; it consolidates the "log this error" guidance that was previously implicit in the inline `eprintln!("Error: {err}")`, `println!("{err}")`, `log::error!("{err}")`, and ad-hoc `format!`-and-then-`tracing` blocks scattered across `phenoShared` binaries, the various `*-adapter` crate handlers, the `HeliosLab` / `PhenoRuntime` / `KWatch` / `phenoMCP` worker loops, and the request-handler tails in the TypeScript bridges.

If a call site has an error in hand and the next action is "log it and propagate / exit / move on", it imports `phenotype_error_core::report` and calls `report(&err)`. If a `Cargo.toml` adds `tracing` (or `log` / `env_logger`) directly just to emit a single `error!` line, either fix the crate or update this page — don't fork the rule. The `phenotype-error-core` crate exists for exactly this reason: one place to own the `tracing::error!` + `tracing::debug!` shape, the `error = %err` / `depth = N` field names, the `std::error::Error::source()` walk, the stable `"operation failed"` message, and the contract that the function never panics and never returns a value to the caller.

> **Scope note.** This page covers the *report call site* — what to call and what not to call when an error is being surfaced to logs. The *error type* (the `thiserror` enum a library exposes, the `#[from]` chain that converts a foreign error into it, the `ErrorEnvelope` wire shape) is the subject of [error-handling](error-handling.md). If you are designing a new error type, start there. If you already have an error in hand and need to log it, you are in the right place.

## The Rule

| Context | Use | Crate / Function | Why |
|---------|-----|------------------|-----|
| A Rust call site has an error value in hand and the next step is "log it and propagate / exit / move on" — request-handler tails, worker loops, adapter fallbacks, `main` returning `Result` from `run()`, panic-catching `catch_unwind` arms | `phenotype_error_core::report(&err)` (or the `Box<dyn std::error::Error + Send + Sync>` form for trait-object callers) | `phenotype-error-core` | One call, one canonical tracing shape: the top-level error at `error!` with `error = %err` and the stable message `"operation failed"`, every cause in the `source()` chain at `debug!` with `error = %cause, depth = N`. |
| A caller wants to log only the top-level error's `Display` and skip the cause chain (rare — diagnostic dump) | `tracing::error!(error = %err, "...")` directly | `tracing` (direct) | The only sanctioned deviation. Document it with a comment; the cause chain is the diagnostic value `report` buys you, and skipping it should be a deliberate choice, not a default. |
| A caller wants to log an informational / non-error event (a startup banner, a successful `?` path, a metric) | `tracing::info!` / `tracing::debug!` / `tracing::warn!` directly | `tracing` (direct) | `report` is for *errors*. Routing an `info!` event through `report` would emit it at `error!` severity and walk a non-existent source chain, which is wrong by shape. |
| A TypeScript call site has a caught error (a `try`/`catch` arm, a `Promise.catch` handler, a `Result.err()` on a Rust→TS bridge) | `phenotype.errors.report(err)` from `@phenotype/errors` | `@phenotype/errors` | Symmetric to the Rust `report` function — same field shape, same stable message, same `cause` walk on TS errors that implement `cause: unknown`. Mirrors the wire contract in `ErrorEnvelope` (see [error-handling](error-handling.md)). |

**Hard rule:** `eprintln!("Error: {err}")`, `println!("error: {err}")`, `log::error!("{err}")`, `tracing::error!("{err}")` (with no `error = %err` field), and the `format!("Error: {e}"); eprintln!(...)` two-liner are forbidden at Phenotype error-reporting call sites. The defaults are wrong for us: every call site re-implements the same `Display` glue (or worse, drops the `error` field name and turns the message into an unstructured string), the severity drifts (one crate uses `error!`, the next uses `warn!`, the next writes to `stdout` instead of `stderr`), and the cause chain is silently lost — `Display` only prints the top-level error, so an `OuterError { source: InnerError { source: io::Error } }` collapses to a one-liner and the `io::Error` is gone before an on-call operator can act on it. `phenotype_error_core::report(&err)` is the only sanctioned report site; the body is two `tracing` macro invocations and a `while let Some` loop, so the cost of routing through it is one function call.

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-error-core = { path = "../phenotype-error-core" }

# Consumers do NOT need to add `tracing` as a direct dependency just
# to call `report`. The function is `#[inline]` and the only
# crate-level dependency it needs is `phenotype-error-core` (which
# itself depends on `tracing` + `serde` + `serde_json` + `thiserror`
# + `anyhow` via the workspace pin). Add `tracing` as a direct dep
# only if your crate also emits non-error events (`info!`, `debug!`,
# `warn!`) at the call site.
#
# `phenotype-error-core` has no transitive coupling to the rest of
# `phenoShared`'s ports (`phenotype-time`, `phenotype-build-info`),
# so the cost of pulling it in is a single `path =` line and zero
# extra dep-graph churn in the consumer.
```

### Report an error in a request handler

```rust
// crates/<name>/src/handler.rs
use std::process::ExitCode;
use phenotype_error_core::report;

fn handle_request(req: Request) -> Result<Response, HandlerError> {
    let user = lookup_user(req.user_id)
        .map_err(HandlerError::Lookup)?;
    let body = render_response(&user)
        .map_err(HandlerError::Render)?;
    Ok(body)
}

fn main() -> ExitCode {
    // `?` already propagates the error up; the only step left is
    // the operator-facing log line. `report` emits the top-level
    // error at `error!` and walks `err.source()` to emit every
    // cause at `debug!` — the full diagnostic chain survives.
    if let Err(err) = run() {
        report(&err);
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}
```

### Report an error inside a worker loop without aborting

```rust
// crates/<name>/src/worker.rs
use phenotype_error_core::report;
use crate::error::JobError;

pub async fn drain(queue: &JobQueue) {
    loop {
        match queue.next().await {
            Ok(job) => {
                if let Err(err) = process_job(job).await {
                    // The job failed but the loop must keep draining.
                    // `report` is fire-and-forget — it does not return
                    // a `Result`, does not panic, and does not block
                    // the loop on a slow log sink. The `JobError` is
                    // wrapped / owned by `process_job`'s return type;
                    // `report` takes `&E` so the caller does not have
                    // to clone the error to log it.
                    report(&err);
                }
            }
            Err(queue_err) => {
                // Same shape for a queue-level failure: log the error,
                // keep the worker alive, retry on the next poll.
                report(&queue_err);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}
```

### Report an `anyhow::Error` or `Box<dyn Error>` returned from an adapter

```rust
// crates/<name>/src/adapter_bridge.rs
use std::error::Error;
use phenotype_error_core::report;

fn run_adapter(input: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
    let parsed = parse_input(input)?;          // Box<dyn Error + Send + Sync>
    let out = transform(parsed)?;              // another ?-bailed error
    Ok(out)
}

pub fn call(input: &str) -> String {
    match run_adapter(input) {
        Ok(out) => out,
        Err(err) => {
            // `report` is generic over `E: std::error::Error`, so a
            // `Box<dyn Error + Send + Sync>` is also a valid argument
            // — the function walks the `source()` chain on the boxed
            // trait object just as it does on a concrete type. No
            // need to unbox, no need to re-wrap.
            report(&err);
            String::new()
        }
    }
}
```

### Report a chained error in a test or smoke harness

```rust
// crates/<name>/tests/smoke.rs
use std::io;
use phenotype_error_core::report;

#[test]
fn smoke_emit_does_not_panic_on_chained_error() {
    // `report` is the only error-emitting helper tested in
    // `phenotype-error-core`'s own test module
    // (`crates/phenotype-error-core/src/error_reporter.rs:51-82`),
    // but consumer crates that need to assert the call-site path
    // is wired up correctly can call it directly under
    // `tracing_subscriber::fmt().with_test_writer()`.
    let io_err = io::Error::new(io::ErrorKind::Other, "boom");
    report(&io_err);
}
```

Conventions (lifted from `phenoShared/crates/phenotype-error-core/src/error_reporter.rs:14-49`):

- `report` is generic over `E: std::error::Error` and takes `&E` — pass a borrow, do not move the error into the call. The function walks `err.source()` for the cause chain, so the borrow is necessary for the caller to keep using the error afterwards (e.g. to render it in a response after logging).
- The top-level event uses the literal field name `error = %err` and the literal message `"operation failed"`. The field name is the contract; do not rename it to `err` / `e` / `message` — log scrapers and dashboards regex against the `error` field across the org.
- Cause-chain events use the same `error = %cause` field name and add `depth = N` (1-indexed: the first `source()` is `depth = 1`, the second is `depth = 2`, etc.) at `debug!` severity. The depth field is the only place to assert causal ordering in structured log queries.
- `report` never panics and never returns a value. It is fire-and-forget by design. Do not `try_report(...)` — there is no `Result` return to wait on. Do not assign its return to a `Result` variable — there is no return.
- `report` does not own or store the error. The caller is still responsible for propagating it, rendering it in a response, mapping it to an exit code, or dropping it. The function is a *log side effect*, not a *handler*.
- `report` does not depend on a global subscriber being installed. If no `tracing` subscriber is active, the macro invocations are no-ops — the call still compiles, runs, and returns. Tests that want to assert on the emitted events must install a `tracing_subscriber` (typically `tracing_subscriber::fmt().with_test_writer()`).
- For trait-object callers (`Box<dyn Error + Send + Sync>`, `anyhow::Error`), pass the value as-is. `Box<dyn Error>` already implements `Error`, and `anyhow::Error` derefs to one. No unbox, no `Any::downcast`, no re-wrap.
- For a foreign error that does not implement `std::error::Error` (a string, a custom non-standard type), convert it to a typed error first with `thiserror` and a `#[from]`, *then* call `report`. Do not extend `report` to accept non-`Error` arguments.

## What `phenotype-error-core` Configures

The crate is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Top-level severity | `tracing::error!` (`error_reporter.rs:36`) | The top-level error is always operator-facing. A `report` of a `warn!` event would silently lose the error in any log stream that filters below `error`. |
| Top-level field name | `error = %err` (`error_reporter.rs:36`) | The literal field name. The `error` field is the org-wide contract for "this is the error value" in structured log queries; renaming it breaks every dashboard. |
| Top-level message | The literal string `"operation failed"` (`error_reporter.rs:36`) | A stable, generic message. The actual error context lives in the `error` field, not in the message. Stable message + structured field lets log scrapers filter on the field and operators filter on the message. |
| Cause-chain severity | `tracing::debug!` (`error_reporter.rs:45`) | The cause chain is for *diagnosis*, not for *alerting*. Emitting causes at `error!` would spam higher-severity streams and drown the operator-facing event. |
| Cause-chain fields | `error = %cause, depth = N` (`error_reporter.rs:45`) | The `error` field reuses the top-level name so log scrapers can query by field across the whole chain. The `depth` field (1-indexed) preserves the causal ordering: `depth = 1` is the first `source()` after the top-level error, `depth = 2` is the next, and so on. |
| Source-chain walk | `while let Some(cause) = err.source()` (`error_reporter.rs:42-48`) | The standard library's `Error::source` chain. Stops at the first `None`. A `report` of a single-level error emits exactly one event (the top-level); a `report` of a deeply-chained error emits one event per level plus the top-level. |
| Panic safety | The function does not `unwrap` / `expect` / index-slice any user input (`error_reporter.rs:33-49`) | `report` must never panic. A panic inside an error reporter is a denial-of-service: the program crashes not because of the error but because of the report. The body is two macro invocations and a `while let` loop — nothing to panic on. |
| Public surface | `pub use error_reporter::report;` re-exported from the crate root (`lib.rs:14`); the `error_reporter` module itself is `mod error_reporter;` (private) | The function is the contract. The module is an implementation detail. Consumers must not name `phenotype_error_core::error_reporter::report`; the crate-root re-export is the only sanctioned import path. |
| Return type | `()` (unit) — never `Result`, never `Option`, never the error itself | The function does not own the error. The caller can still propagate, render, or drop it after `report` returns. A return-value design would force the caller to `let _ = report(...);` everywhere, which is worse than a unit return. |
| `tracing` dependency | `tracing` is a workspace-pinned direct dep of `phenotype-error-core` (`Cargo.toml:14`); consumers do not add it as a direct dep just to call `report` | Consumers call `report`; `report` calls `tracing`. The transitive dep is enough. |

If a caller needs different behaviour (a different severity, a different field name, a JSON-shaped log line, a cause-chain length cap, a `Report` trait extension point for non-`Error` types), the seam is the same crate: add a new function or a new field next to the existing ones and have the caller reach for the new symbol. Do not fork the function at the call site.

## Anti-Patterns

- ❌ `eprintln!("Error: {err}")` / `eprintln!("error: {e}")` / `eprintln!("{:?}", err)` at a call site — bypasses `tracing` entirely, drops the field-name contract, drops the cause chain, and writes to `stderr` in a shape that no other log scraper in the org can parse. Use `phenotype_error_core::report(&err)`.
- ❌ `println!("{err}")` (note `println`, not `eprintln`) — writes to `stdout` instead of `stderr`, which mixes error output with normal program output and silently breaks pipe-based consumers (`cmd | grep`, `cmd | jq`). Use `phenotype_error_core::report(&err)`.
- ❌ `tracing::error!("{err}")` or `tracing::error!(target: "errors", "{err}")` with no `error = %err` field — emits the error's `Display` as the *message*, not as a *field*, and breaks every structured-log query that filters on the `error` field. Use `phenotype_error_core::report(&err)`.
- ❌ `tracing::error!(error = %err)` with a custom message (`"user lookup failed"`, `"request aborted"`) — drifts the top-level message away from the canonical `"operation failed"` and silently breaks log filters that regex on the message. The actual error context is in the `error` field; the message is the org-wide stable string.
- ❌ `tracing::error!(error = %err, "operation failed")` *without* walking the cause chain — emits the top-level event in the right shape but drops every cause in the `source()` chain. A `Repository → Domain → io::Error` chain collapses to one line, and the `io::Error` (the actionable part) is gone. Use `phenotype_error_core::report(&err)`; the function walks the chain for you.
- ❌ A hand-rolled `walk_source(err: &dyn Error, depth: usize)` helper that mirrors `report`'s `while let Some` loop — drifts from the canonical field names, drifts from the `error` field convention, and silently breaks if `report` adds a new event (e.g. a `tracing::trace!` for `>10` deep chains). Use `phenotype_error_core::report(&err)`.
- ❌ `log::error!("{err}")` after adding `log` + `env_logger` to a consumer crate just to log one error — duplicates the `tracing` setup the rest of the org uses, forks the field-name contract (`log` has no `error = %err` shape), and forces operators to wire up a second log stream. Use `phenotype_error_core::report(&err)`.
- ❌ `.format_error_chain(&err)` (a custom helper that `eprintln!`s each level with `"→ {cause}"` arrows) — the arrow form is unreadable in a structured-log query (`error.cause.0.message` is the field, `"→ inner → io error"` is not). Use `phenotype_error_core::report(&err)`.
- ❌ `dbg!(&err)` / `println!("{:#?}", err)` at a call site — emits the `Debug` form (which includes struct field names, not just the user-facing message) and goes to `stderr` in a shape no log scraper can parse. `Debug` is for development; the canonical reporter uses `Display` via `%err`. Use `phenotype_error_core::report(&err)`.
- ❌ `panic!("{err}")` instead of `report` — turns a recoverable error into a process abort and loses the cause chain on unwind. The org's `main` returns `Result` precisely so `report` can emit the chain and `ExitCode::from(1)` can shut down cleanly. Use `phenotype_error_core::report(&err)` and propagate.
- ❌ Calling `report` twice on the same error — duplicates every event in the source chain at every severity. `report` is the only report site; it emits the top-level *and* every cause in one call.
- ❌ Calling `report` on a `Result` value (e.g. `report(&result)`) — `Result` does not implement `Error`; the call does not compile. Unwrap or pattern-match first, then call `report(&err)`.
- ❌ Storing the result of `report(&err)` in a variable (`let _ = report(&err);` or `let _: () = report(&err);`) — there is no return to discard. The function returns `()`; assigning it to `let _ = ...` works but is noise. Call it as a statement: `report(&err);`.
- ❌ Routing an `info!` / `debug!` / `warn!` event through `report` — `report` is for *errors*. Calling it on a `String` or a non-`Result` value does not compile; calling it on a non-error `Error` type (e.g. an enum that is `Error` but is used as a control-flow signal, not as a failure) emits an `error!` event for a non-error condition. Use `tracing::info!` / `tracing::debug!` / `tracing::warn!` directly for non-error events.

## Reference Implementation

The single source of truth for the function:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-error-core/src/error_reporter.rs:1-12` | `//! Canonical error reporter for the Phenotype ecosystem.` (module docstring) | The crate-level contract. Lists the `report` entry point, the `error!` + `debug!` severity split, and the `source()` walk. |
| **phenoShared** | `crates/phenotype-error-core/src/error_reporter.rs:14-32` | `/// Report an error through the shared \`tracing\` pipeline.` (function docstring) | The function-level contract. The `# Examples` doctest at lines 24-32 is the simplest call shape (`io::Error` → `report(&err)`). |
| **phenoShared** | `crates/phenotype-error-core/src/error_reporter.rs:33` | `pub fn report<E: std::error::Error>(err: &E)` | The signature. Generic over any `Error`; takes a borrow so the caller keeps ownership. |
| **phenoShared** | `crates/phenotype-error-core/src/error_reporter.rs:36` | `tracing::error!(error = %err, "operation failed")` | The top-level event. Field name `error`, message literal `"operation failed"`. |
| **phenoShared** | `crates/phenotype-error-core/src/error_reporter.rs:42-48` | `let mut depth: usize = 1; let mut cause = err.source(); while let Some(cause_err) = cause { tracing::debug!(error = %cause_err, depth = depth, "error cause"); depth += 1; cause = cause_err.source(); }` | The cause-chain walk. 1-indexed `depth`, stops at the first `None` from `source()`. |
| **phenoShared** | `crates/phenotype-error-core/src/error_reporter.rs:45` | `tracing::debug!(error = %cause_err, depth = depth, "error cause")` | The per-cause event. Reuses the `error` field name; adds `depth` for ordering. |
| **phenoShared** | `crates/phenotype-error-core/src/error_reporter.rs:51-82` | `#[cfg(test)] mod tests` | Inline tests. The single test at lines 70-81 (`report_does_not_panic_on_chained_error`) calls `report` on a chained `OuterError { source: InnerError }` and on a `std::io::Error`, and asserts the function does not panic on either. |
| **phenoShared** | `crates/phenotype-error-core/src/lib.rs:14` | `pub use error_reporter::report;` | The crate-root re-export. Consumers import `phenotype_error_core::report`; the `error_reporter` module itself is `mod error_reporter;` (private). |
| **phenoShared** | `crates/phenotype-error-core/Cargo.toml:14` | `tracing = { workspace = true }` | The only direct dep the function needs. Consumers add `phenotype-error-core` and inherit `tracing` transitively. |

## Migration Checklist (per crate / binary)

1. Add `phenotype-error-core = { path = "../phenotype-error-core" }` to `[dependencies]`.
2. Replace every `eprintln!("Error: {err}")` / `eprintln!("error: {e}")` / `eprintln!("{:?}", err)` with `phenotype_error_core::report(&err);`. Delete the `Error: ` prefix — the field name is the contract, the message is `Display` via `%err`.
3. Replace every `tracing::error!("{err}")` / `tracing::error!("error: {err}")` (with no `error = %err` field) with `phenotype_error_core::report(&err);`. The function emits the top-level event in the canonical shape (`error = %err, "operation failed"`) — do not pass a custom message.
4. Replace every hand-rolled `walk_source` / `format_error_chain` / `→` arrow helper with `phenotype_error_core::report(&err);`. The function walks the chain for you and emits each level as a structured `debug!` event with `error` and `depth` fields.
5. Replace every `log::error!("{err}")` (where `log` was added as a direct dep just to log a single error) with `phenotype_error_core::report(&err);`. Remove the `log` + `env_logger` (or equivalent) direct dep if no other call site uses them.
6. Replace every `panic!("{err}")` at a call site whose only purpose was to surface a recoverable error with `phenotype_error_core::report(&err);` + `return ExitCode::from(1);` (or `return Err(...);` in a `Result`-returning function). Panics are for unrecoverable invariant violations, not for "the user gave us a bad request".
7. Replace every `dbg!(&err)` / `println!("{:#?}", err)` with `phenotype_error_core::report(&err);`. `Debug` is for development; the canonical reporter uses `Display`.
8. If a crate needs to *log* an error from a foreign crate that does not implement `std::error::Error` (a raw `String`, a custom non-standard type), convert it to a typed `thiserror` error first, then call `report(&typed_err)`. Do not extend `report` to accept non-`Error` arguments.
9. If a crate already emits `tracing::info!` / `tracing::debug!` / `tracing::warn!` events at the call site, leave them. `report` is for *errors* only. Adding `tracing` as a direct dep to support the non-error events is correct; the rule is "consumers do not add `tracing` *just* to call `report`".
10. In tests that assert on the emitted events, install a `tracing_subscriber::fmt().with_test_writer()` before calling `report`. The function is a no-op without a subscriber; the assertion is meaningless if the events go nowhere.

## Related Patterns

- [error-handling](error-handling.md) — the *error type* pattern: `thiserror` enums, `#[from]` conversions, the `ErrorEnvelope` wire shape, the `cause` chain on the TS side. `report` walks whatever chain `error-handling` produces; it does not define the chain.
- [logging](logging.md) — the structured-log contract: the `tracing` field names (`error`, `depth`), the stable messages, the severity levels. `report` is the *errors* slice of that contract; `tracing::info!` / `debug!` / `warn!` are the rest.
- [build-info](build-info.md) — the `BuildInfo` struct's four fields are the natural envelope to attach to every error log line. Spread `info.version` / `info.git_sha` / `info.build_profile` / `info.target_triple` as `tracing` fields *alongside* `error`, not in `report`'s body. `report` is field-name stable; the build metadata is a per-caller additive.
- [time](time.md) — the timestamp on the same log line as `error` comes from `phenotype_time::format_iso8601(started)`. Pair them; do not duplicate either. The `error` field is the failure, the `ts` field is the wall clock, the `git_sha` field is the build identity — three fields, three canonical primitives, one log line.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-error-core` is the org's wrapper around `tracing::error!` + `tracing::debug!` + a `source()` walk. Don't reach past it.
- [architecture/hexagonal](architecture/hexagonal.md) — error reporting is a *port*: the rest of the binary depends on `phenotype_error_core::report`, and a `trait Reporter { fn report(&self, err: &dyn Error); }` adapter could swap in a JSON / OpenTelemetry / Sentry sink without changing the call site. The function is the production adapter; the trait is the seam.

## References

- [`std::error::Error` trait](https://doc.rust-lang.org/std/error/trait.Error.html) — the bound on `report`'s generic parameter `E`, and the source of the `source()` method the cause walk uses.
- [`std::error::Error::source` method](https://doc.rust-lang.org/std/error/trait.Error.html#method.source) — the chain walker; returns `Option<&(dyn Error + 'static)>` and is `None` at the bottom of the chain.
- [`tracing::error!` macro](https://docs.rs/tracing/latest/tracing/macro.error.html) — the macro `report` invokes for the top-level event.
- [`tracing::debug!` macro](https://docs.rs/tracing/latest/tracing/macro.debug.html) — the macro `report` invokes for each cause in the chain.
- [`tracing` structured fields](https://docs.rs/tracing/latest/tracing/#recording-fields) — the `error = %err` / `depth = depth` field syntax `report` uses. `%err` is `Display` (the user-facing message); `?err` would be `Debug` (the struct internals) and is the wrong choice.
- [thiserror crate](https://docs.rs/thiserror) — the macro crate that produces the `Error` impls the `source()` walk depends on. Crates that want `report` to walk the chain must derive `Error` with `#[source]` on the inner field, not hand-roll `impl Error`.
- Internal: `phenoShared/crates/phenotype-error-core/src/error_reporter.rs` — the function this page governs. If you change the public API (new function, new field name, new severity, new chain-walk depth cap), update this page in the same PR.
- Internal: `phenoShared/crates/phenotype-error-core/src/lib.rs` — the `pub use error_reporter::report;` re-export. If you rename the re-export, rename it here and in every consumer; the function is the contract, the module is the implementation detail.
- Internal: `phenoShared/crates/phenotype-error-core/Cargo.toml` — the `tracing = { workspace = true }` direct dep. Bumping `tracing` is a coordinated change; the macro syntax `error = %err` is the only place that has to track the `tracing` major version.
