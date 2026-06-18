# Structured Logging in Rust

## Overview

Every Rust binary in the Pheno* ecosystem that needs to surface an event to logs (a CLI subcommand start, an HTTP server bind, a NATS subscribe error, a JSON-shaped startup banner) goes through one crate: `tracing`, initialised exactly once at process start via the `phenotype_logging::init_tracing` helper (or its `init_tracing_with_default` / `init_tracing_for_test` siblings). This page is the canonical place that rule lives; it consolidates the "log this thing" guidance that was previously implicit in the inline `tracing_subscriber::fmt().init()` call in `HeliosLab/pheno-cli/src/main.rs:143`, in the `eprintln!("Failed to open database at ...")` line in the same file (line 135), and in the bare `use tracing::{debug, info};` adapter imports in `PhenoRuntime/crates/pheno-nats/src/lib.rs:13` and `PhenoRuntime/crates/pheno-minio/src/lib.rs:11`.

If a Rust file needs to write a log line, it calls `tracing::info!(field = value, "message")` / `tracing::error!(error = %err, "operation failed")` against the macros. If a `Cargo.toml` adds a third-party logging framework (`log`, `env_logger`, `slog`, `fern`, `pretty_env_logger`, `simplelog`) just to get a JSON handler, either fix the file or update this page — don't fork the rule. `tracing` (with `tracing-subscriber` for the fmt/JSON/EnvFilter wiring) is the contract: one place to own the subscriber shape, the `RUST_LOG` env-filter parsing, the `Default = "info"` fallback, the `with_target(false)` fmt layout, and the `try_init` guard that prevents a second `init_tracing()` call from panicking (which is exactly what `tracing_subscriber::fmt().init()` does on its second call, and exactly what the `init_tracing` helper in `phenoShared/crates/phenotype-logging/src/lib.rs:54-103` is fixing).

> **Scope note.** This page covers the *call site and one-time setup* — what macro to call, what not to call, and how to install the global subscriber exactly once. The *log shape* (which fields are mandatory, what the `service` attribute must be, the severity→log level mapping) is the subject of `observability/logging.md` (when that page lands; for now it lives in the per-crate top-of-file `use tracing::{...};` import block). If you are adding a new structured field, reach for the same `field = %value` / `field = ?value` shape the rest of the fleet uses. If you are about to call `println!` for the first time in a file, you are in the right place.

## The Rule

| Context | Use | Crate | Why |
|---------|-----|-------|-----|
| A Rust library crate needs to emit any log line (an `Info` event, a `Debug` trace, a `Warn` retry, an `Error` failure) | `tracing::info!(field = value, "message")`, `tracing::debug!(...)`, `tracing::warn!(...)`, `tracing::error!(error = %err, "operation failed")` against the macros, with **typed fields** | `tracing` | The subscriber attaches typed fields as structured attributes; `tracing::info!("loaded user {}", id)` interpolates them into the message string and the subscriber cannot index them. |
| A Rust binary, integration test, or example's `fn main()` needs to install the global subscriber | `phenotype_logging::init_tracing()` (or `init_tracing_with_default("debug,sqlx=warn")` / `init_tracing_for_test("info")`) | `phenotype-logging` (re-exports `tracing` + `tracing_subscriber`) | One helper, idempotent (`try_init` under the hood), honours `RUST_LOG`, no copy-pasted 7-line `tracing_subscriber::fmt().with_env_filter(...).with_target(false).try_init().ok();` block at the top of every `main.rs`. |
| A library wants to emit log lines against a sub-component / adapter-specific context (a NATS adapter, a MinIO adapter, a Postgres adapter) | A `#[tracing::instrument]` span or a `tracing::info_span!("component", name = "nats")` at the boundary; do not call `tracing_subscriber::fmt().init()` again | `tracing` | The span appends fields to every event inside it without mutating the global subscriber. A library that installs its own subscriber would clobber the host binary's `RUST_LOG` and target settings. |
| A test wants to capture log output from a unit under test | `init_tracing_for_test("debug")` and bind the returned `DefaultGuard` to the test scope (drop restores the previous global subscriber) | `phenotype-logging` | The test owns its own subscriber, it does not inherit the production subscriber's `RUST_LOG` value, and the production process is not affected by the test's subscriber swap. |
| A caller wants to log a fatal error and exit (an unrecoverable config error, a missing required flag) | `tracing::error!(error = %err, "operation failed")` followed by `std::process::exit(1)` | `tracing` + `std::process` | The org does not have a `tracing::fatal!` macro. `tracing::error!` + `std::process::exit(1)` keeps the exit code explicit and lets the caller run cleanup (`Drop` guards, flush OTLP spans, close file handles) before the process dies. |

**Hard rule:** `println!("...")`, `eprintln!("...: {}", err)`, `std::process::exit(1)` from inside a panic hook, `panic!("...")`, and any third-party logger (`log`, `env_logger`, `slog`, `fern`, `pretty_env_logger`, `simplelog`) are forbidden at Phenotype Rust call sites. The defaults are wrong for us: `println!` / `eprintln!` write a single text line per call (no structured fields, no severity, no span context, broken on a TTY that expects JSON for a log shipper), the third-party crates fork the `service` / `target` / `span` contract that the rest of the fleet ships, and `panic!` turns a recoverable condition into a process abort and emits no structured `error` field. Use `tracing::info! / tracing::error! / tracing::debug!` and the `try_init`-guarded `init_tracing` from `phenoShared/crates/phenotype-logging/src/lib.rs:54-103`.

## Canonical Pattern

### Install the global subscriber exactly once

```rust
// crates/<name>/src/main.rs
use phenotype_logging::init_tracing;

fn main() {
    // One canonical install path. `try_init` under the hood means the
    // second call (e.g. a test that re-runs `main` via `cmd::main()`)
    // is a no-op, not a panic. `RUST_LOG` is honoured when set; the
    // helper falls back to `Default = "info"` otherwise. The fmt
    // subscriber is `with_target(false)` because the JSON handler adds
    // target as a field automatically and the prefix is noise.
    init_tracing();

    tracing::info!(path = %config_path.display(), "loaded config");
    run(config_path);
}
```

```rust
// crates/<name>/src/main.rs — override the default filter
use phenotype_logging::init_tracing_with_default;

fn main() {
    init_tracing_with_default("debug,sqlx=warn,h2=info");
    // ...
}
```

```rust
// crates/<name>/tests/integration.rs — keep the global subscriber untouched
use phenotype_logging::init_tracing_for_test;

#[test]
fn emits_capture_event() {
    // The returned guard restores the previous global subscriber on
    // drop, so the next test in the same binary gets a clean slate.
    let _guard = init_tracing_for_test("info");
    tracing::info!(request_id = %req_id, "captured for the lifetime of `_guard`");
}
```

Conventions (lifted from `phenoShared/crates/phenotype-logging/src/lib.rs:54-103`):

- `init_tracing` is **idempotent** — it uses `try_init` internally, so a second call in the same process is a no-op (not a panic). This is what makes it safe to call from multiple integration test binaries linked into one test runner, and from a `main` that is re-entered under `cargo test`.
- `RUST_LOG` takes precedence when set; the helper falls back to `DEFAULT_FILTER = "info"` otherwise. The override is on the helper, not on the call site, so the contract is "call `init_tracing()` and the env wins".
- The subscriber is `tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER))).with_target(false).finish()`. `with_target(false)` is intentional — the JSON handler adds `target` as a field automatically; the fmt handler's `module::path::to::event` prefix is noise on a TTY.
- For scoped setup in tests, use `init_tracing_for_test` and bind the returned `DefaultGuard` to the test scope. Drop restores the previous global subscriber. The function is named `init_tracing_for_test`; the contract is "scoped, guard-bound, no process-wide install".

### Emit log lines from any caller

```rust
// crates/<name>/src/adapter.rs
use tracing::{debug, error, info, instrument};

#[instrument(skip_all, fields(adapter = "nats", stream = %stream_name))]
pub async fn subscribe(stream_name: &str) -> Result<Subscription, SubscribeError> {
    info!(stream = %stream_name, "opening JetStream consumer");
    let stream = jetstream::get_stream(stream_name).await.map_err(|e| {
        error!(error = %e, stream = %stream_name, "stream lookup failed");
        SubscribeError::Stream(e.to_string())
    })?;
    debug!(messages = %stream.info().await?.messages, "stream metadata");
    Ok(stream)
}
```

Conventions:

- Every event uses the `field = value, "message"` form. `tracing::info!(path = %path, "loaded config")` is canonical; `tracing::info!("loaded config at {}", path.display())` is forbidden — the path is inlined into the message and the subscriber cannot index it. The `%` prefix renders via `Display` (`path = %path`); the `?` prefix renders via `Debug` (`error = ?err`); numeric / bool / `&'static str` use neither (`retries = 3`, `dry_run = true`).
- The error field name is the literal string `"error"`. The shape is `tracing::error!(error = %err, "operation failed")` and is the same wire shape `phenotype_error_core::report(&err)` emits (see [error-reporting](error-reporting.md)). Do not rename it to `"err"` / `"e"` / `"reason"` — the `error` field is the org-wide contract for "this is the error value" in structured log queries.
- The message string is a stable, generic description (`"loaded config"`, `"operation failed"`, `"stream lookup failed"`). The actual error context lives in the `error` field, not in the message. Stable message + structured field lets log scrapers filter on the field and operators filter on the message — the same split the Go side enforces (see [logging-go](logging-go.md)).
- `tracing::info!` / `tracing::debug!` / `tracing::warn!` / `tracing::error!` are the only severities. There is no `tracing::fatal!`; an unrecoverable error is `tracing::error!(error = %err, "operation failed")` followed by `std::process::exit(1)` at the call site so the caller can run `Drop` guards and flush OTLP spans before the process dies.

### Carry sub-component context via `#[instrument]` / `info_span!`

```rust
// crates/<name>/src/minio.rs
use tracing::{debug, info, instrument, info_span};
use tracing::Instrument;

#[instrument(skip_all, fields(bucket = %bucket, key = %key))]
pub async fn upload(bucket: &str, key: &str, bytes: Bytes) -> Result<(), MinioError> {
    // The `bucket` and `key` fields are attached to every event this
    // function emits (and to the span that wraps the call), without
    // the call site having to remember to pass them.
    let client = client_for(bucket)?;
    debug!(size = bytes.len(), "starting upload");
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(bytes.into())
        .send()
        .await
        .map_err(|e| {
            info_span!("minio.put_object", bucket = %bucket, key = %key)
                .in_scope(|| info!(error = %e, "put_object failed"));
            MinioError::Upload(e.to_string())
        })?;
    info!(bucket = %bucket, key = %key, "upload complete");
    Ok(())
}
```

Conventions:

- Sub-component context is a `#[tracing::instrument]` attribute on the function or a `tracing::info_span!("<component>", <field> = <value>)` at the boundary. The fields attached to the span show up on every event emitted inside it, with no per-event boilerplate.
- A span is never a re-install of the global subscriber. The subscriber is the `init_tracing` call's job, and the host binary's `init_tracing()` runs once at process start. A library that calls `tracing_subscriber::fmt().init()` would clobber the host binary's `RUST_LOG` and target settings — the same bug the `try_init` guard in `init_tracing` is fixing.
- Span field names follow the kebab-case convention used in adapter identifiers: `"nats"`, `"minio"`, `"postgres"`, `"redis"`, `"http-server"`, `"rate-limiter"`, `"retry-policy"`. Field names are stable; renaming a field is a breaking change for the log shipper's `field=...` filters.

## What the Pattern Configures

The `init_tracing` function in `phenoShared/crates/phenotype-logging/src/lib.rs:54-103` is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Subscriber | `tracing_subscriber::fmt().with_env_filter(...).with_target(false).finish()` | One canonical install path. The `fmt` subscriber is human-readable on a TTY; the JSON handler (or OTLP handler, in an observability build) is the same shape with `.json()` swapped in. |
| Env filter | `EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER))` where `DEFAULT_FILTER = "info"` | `RUST_LOG` wins when set; the `info` fallback matches the Go side's `slog.LevelInfo` default (see [logging-go](logging-go.md)). Override per-binary via `init_tracing_with_default("debug,sqlx=warn")` for a dev build; the production binary stays on the default. |
| Target prefix | `with_target(false)` | The fmt subscriber's `module::path::to::event` prefix is noise on a TTY; the JSON handler adds `target` as a structured field automatically. Forcing `with_target(false)` keeps the two layouts consistent. |
| Install guard | `tracing_subscriber::fmt().try_init().ok()` under the hood | A second `init_tracing()` call in the same process is a no-op (not a panic). This is what makes the helper safe to call from multiple integration test binaries linked into one test runner, and from a `main` that is re-entered under `cargo test`. A raw `tracing_subscriber::fmt().init()` would panic on the second call — the bug the `try_init` guard is fixing. |
| Install trigger | An explicit `init_tracing()` call from the binary's `fn main()` (or from the first test that needs it via `init_tracing_for_test`) | Libraries must not install the global subscriber from a `ctor`-time hook or a `Lazy::new(|| { tracing_subscriber::fmt().init(); ... })`. A library `ctor` would clobber the host binary's `RUST_LOG` the moment the library is loaded, silently breaking every other library's structured log output. The binary owns the install. |
| `tracing` minimum version | `0.1` (latest 0.1.x); `tracing-subscriber` `0.3` | The crates' current major versions. The `phenotype-logging` `Cargo.toml` pins both and re-exports them so consumers do not need a direct dep on `tracing-subscriber` for the install path. |
| Public surface | `init_tracing`, `init_tracing_with_default`, `init_tracing_for_test`, plus re-exports of `tracing` and `tracing_subscriber` (where needed) | The `init_tracing` function is the only thing the binary's `main` calls. Consumers reach for `tracing::info!` etc. directly via the re-exports; the install is the host binary's responsibility. The function names are descriptive, not contractual — rename per-crate as long as the shape (`try_init`, `EnvFilter`, `with_target(false)`, no `ctor` install) is the same. |
| Panic safety | The function does not `panic`, does not call `std::process::exit`, does not block on I/O | An `init_tracing` that panics would crash the host binary at the first `tracing::info!` call. The body is two function calls and a `try_init().ok()` — nothing to panic on, nothing to fail. |
| Return type | `()` (unit) — never `Result<(), _>`, never `bool` | The function configures a global; the caller does not need a return value to use the macros. A `Result` design would force `let _ = init_tracing();` at every call site, which is worse than a unit return. The `try_init().ok()` swallows the `Err(SetGlobalDefaultError)` silently — the only realistic cause is a second call from a library `ctor`, which is a bug elsewhere. |

If a caller needs different behaviour (a different default filter, a different subscriber shape, a `tracing_subscriber::fmt().json()` JSON handler, a `tracing_opentelemetry` OTLP layer), the seam is the same function family: `init_tracing_with_default("debug")` for the filter, and the new `init_tracing_with_otlp(...)` / `init_tracing_with_json(...)` siblings for the handler shape. Do not fork `init_tracing` at the call site.

## Anti-Patterns

- ❌ `println!("starting")` / `eprintln!("...: {}", err)` at a call site — emits a single text line per call, no structured fields, no severity, no span context, no `RUST_LOG` honour. The log shipper's `field=...` filters drop the event, and the operator has no way to filter by span or severity in the dashboard. Use `tracing::info!(field = value, "starting")` with structured fields.
- ❌ `tracing_subscriber::fmt().init()` inlined into a `fn main()` — duplicates the `init_tracing` helper, drifts from the `RUST_LOG` semantics, and panics on a second call in the same process. Use `phenotype_logging::init_tracing`.
- ❌ `tracing_subscriber::fmt().with_env_filter("info").with_target(false).try_init().ok();` inlined into a `fn main()` — same bug, but copy-pasted from the helper's source. The org-wide contract is "call `init_tracing`, do not rebuild the subscriber". If the call site needs a different default filter, use `init_tracing_with_default("debug,sqlx=warn")`.
- ❌ `tracing::info!("loaded user {user}")` / `tracing::info!("loaded user {}", user.id)` — context is inlined into the message; the subscriber cannot index it. Always pass fields: `tracing::info!(user_id = %user.id, tenant = %user.tenant, "loaded user")`.
- ❌ `eprintln!("Failed to open database at {}: {e}", path.display())` in a library or binary — bypasses the `tracing` subscriber entirely, writes to stderr without span context, and emits no structured `error` field. Use `tracing::error!(error = %e, path = %path.display(), "failed to open database")` (see `HeliosLab/pheno-cli/src/main.rs:135` for the in-repo anti-pattern, currently slated for migration to `init_tracing` + structured fields).
- ❌ Adding `log` / `env_logger` / `slog` / `fern` / `pretty_env_logger` / `simplelog` as a `Cargo.toml` dep just to get a `RUST_LOG` handler — forks the field / target / span contract (each crate has its own `with_target` shape), forks the JSON layout (`log` uses a single `module=... msg=...` text line, `slog` uses its own `kv!` macro), and forces the log shipper to maintain a per-crate parser. `tracing` is the contract.
- ❌ A second `tracing_subscriber::fmt().init()` (or `.try_init()`) call from a library's `ctor` / `Lazy::new` / `static INIT: Once = Once::new()` — clobbers the host binary's `RUST_LOG` and target settings the moment the library is loaded. Every `tracing::info!` from every other library now goes out with the library's settings, silently breaking the log shipper's routing. Libraries call `tracing::info!` / `tracing::error!` directly; they never call the install path.
- ❌ `tracing::info!(error = err.to_string())` (passing the error's `Display` form as a `&str`) — strips the error type, the wrapping context, and any structured fields the error type carries. The log shipper sees `"error":"connection refused"` with no way to filter by error type. Use `tracing::error!(error = %err, "operation failed")` and let the `%` prefix call the error's `Display` impl.
- ❌ `panic!("invariant violated: ...")` in a call site that handles errors — turns a recoverable condition into a process abort and emits a non-structured `panic` message. The org's recovery path is `tracing::error!(error = %err, "invariant violated")` + propagate / exit, not `panic!`. Reserve `panic!` for "this should be impossible, the program is corrupted" (a `BTreeMap` invariant violation, a slice bounds check that the type system missed).
- ❌ `tracing::info!("starting")` with no structured fields at all — emits a JSON line with just `{"timestamp":..., "level":"INFO", "fields":{"message":"starting"}}` and no per-event context. Every line is identical except for the message string; the log shipper cannot route on `host`, `port`, `path`, etc. Pass at least one structured field per event so the JSON line is filterable.
- ❌ `std::process::exit(1)` from inside a `Drop` impl or a panic hook without first emitting a `tracing::error!` — the process dies with no structured log line; the operator sees the exit code but no error context. Emit `tracing::error!(error = %err, "operation failed")` *before* the `std::process::exit(1)`, and let `Drop` guards run on the way out (which is why `Drop` impls must not block).

## Reference

The canonical install lives at `phenoShared/crates/phenotype-logging/src/lib.rs:54-103` (the `init_tracing` / `init_tracing_with_default` / `init_tracing_for_test` helpers, the `try_init` guard, the `EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER))` shape, the `with_target(false)` fmt layout, and the re-exports of `tracing` + `tracing_subscriber`). Every Rust binary in the Pheno* ecosystem should follow this shape; the function name, the `DEFAULT_FILTER` value, and the crate name change per-binary, but the contract does not.

The "before" state — what we are migrating away from — is `HeliosLab/pheno-cli/src/main.rs:143` (a `tracing_subscriber::fmt::init();` call against the bare subscriber, which panics on a second invocation, and an `eprintln!("Failed to open database at {}: {e}", path.display())` on line 135 that bypasses `tracing` entirely). The migration is `HeliosLab/pheno-cli/src/main.rs:143` → `phenotype_logging::init_tracing()` (and a `phenotype-logging` dep in `HeliosLab/Cargo.toml`), then `eprintln!("...")` → `tracing::error!(error = %e, ...)` at every call site, then `tracing::info!("loaded config at {}", path)` → `tracing::info!(path = %path.display(), "loaded config")` to restore the structured-field shape. The "good" call sites — `PhenoRuntime/crates/pheno-nats/src/lib.rs:13` and `PhenoRuntime/crates/pheno-minio/src/lib.rs:11` (both `use tracing::{debug, info};` at the top of the adapter, with structured fields on every event) — are the target shape; the rest of the fleet should reach for the same `#[tracing::instrument]` / `info_span!` / typed-field pattern.

The five Pheno* repos that consume (or should consume) `phenotype-logging` as the single source of the install path and the structured-field contract:

| # | Repo | File | Status |
|---|------|------|--------|
| 1 | **pheno** | `crates/phenotype-logging/src/lib.rs` | The reference crate. Vendors `phenotype-logging` in its workspace; the canonical install path lives in this repo's `crates/phenotype-logging` (and is mirrored into `phenoShared/crates/phenotype-logging`). |
| 2 | **HeliosLab** | `pheno-cli/src/main.rs:143` | Anti-pattern: `tracing_subscriber::fmt::init()` inlined into `main`; `eprintln!` at line 135. Migration candidate — see [Anti-Patterns](#anti-patterns). |
| 3 | **PhenoRuntime** | `crates/pheno-nats/src/lib.rs:13`, `crates/pheno-minio/src/lib.rs:11` | Good: `use tracing::{debug, info};` at the top of every infra adapter; macros called with typed fields, not `format!`. The target shape for the rest of the fleet. |
| 4 | **HexaKit** | `crates/phenotype-logging/Cargo.toml` | Vendors the helper at `crates/phenotype-logging` with real deps (`tracing`, `tracing-subscriber`, `opentelemetry`, `opentelemetry-otlp`). The OTLP wiring is a documented extension point; see `init_tracing_with_otlp(...)` when that sibling lands. |
| 5 | **PhenoDevOps** | `crates/phenotype-logging/Cargo.toml` | Vendors the helper at `crates/phenotype-logging`. Same `tracing` / `tracing-subscriber` dep shape as `HexaKit`; the install is called from each CLI binary's `fn main()`. |

The "X repos do this, Y repos do that" picture (see `SPEC.md` Observability section for the wider pattern-compliance matrix) is concrete here:

- ✅ **pheno, HexaKit, PhenoDevOps** — `phenotype-logging` vendored in the workspace; the install path is the helper.
- ✅ **PhenoRuntime** — `tracing` macros with typed fields; `#[tracing::instrument]` on the infra adapters; no third-party logger, no `println!` in the production path.
- ⚠️ **HeliosLab (`pheno-cli`)** — partially migrated; `tracing_subscriber::fmt().init()` inlined at `main.rs:143` (the bug the `try_init` guard is fixing) and `eprintln!` at `main.rs:135` (bypasses the subscriber entirely). Track in the HeliosLab observability audit; do not duplicate the inline-subscriber shape in new repos.

## Related Patterns

- [error-reporting](error-reporting.md) — `phenotype_error_core::report(&err)` emits the error at `tracing::error!` with the stable message `"operation failed"`; this page covers the install path and the typed-field call site, that page covers the cause-chain walk.
- [logging-go](logging-go.md) — the Go side of the same contract (`slog.NewJSONHandler` + `sync.Once` + `slog.String("service", ...)`). The two pages are sibling; renaming one is a breaking change for the other.
- [shared-primitive-reuse](shared-primitive-reuse.md) — `phenotype-logging` is one of the nine `phenoShared` primitives. The rule is "if `phenoShared` ships a crate for a primitive, consume it; do not re-implement".
- [architecture/hexagonal](architecture/hexagonal.md) — adapter logs carry the adapter's `port_name` so log shippers can route by component; domain code logs without knowing the adapter exists.
- `SPEC.md` Observability section — the original Guidelines Catalog entries this page promotes to a standalone pattern.
