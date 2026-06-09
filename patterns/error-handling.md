# Error Handling Pattern

## Overview

The org's Rust code follows one rule for the **`enum` style and derive macro**, and one rule for the **`anyhow` style in binaries and tests**. This page is the canonical place that rule lives; it consolidates the `thiserror` / `anyhow` guidance that was previously spread between `SPEC.md` (Guidelines Catalog), `patterns/async/event-driven.md` (retry / DLQ), and the implicit `*Error` enums inlined in `patterns/architecture/hexagonal.md`, `docs/patterns/architecture/cqrs.md`, `docs/patterns/auth/jwt.md`, `docs/patterns/auth/oauth-pkce.md`, `docs/patterns/async/outbox.md`, `docs/patterns/caching/cache-aside.md`, and `docs/patterns/async/saga.md`.

If a pattern file needs to talk about errors, it links here. If a crate's `error.rs` is shaped differently from this page, either fix the crate or update this page — don't fork the rule.

## The Rule

| Context | Use | Crate | Why |
|---------|-----|-------|-----|
| Library / framework crate (anything a sibling crate will `use`) | `enum *Error` derived with `thiserror::Error` | `thiserror` | Callers can `match` on variants, the error is `Send + Sync + 'static`, and `#[from]` gives free `?` conversion. |
| Binary crate, integration test, examples, scripts | `anyhow::Result<T>` | `anyhow` | Context strings are fine; you only need to bubble the error to `main` and log it. |
| Domain logic inside a library | `enum DomainError` with `thiserror`, **`#[from]` adapter variants** for I/O / DB / network errors, **no `anyhow`** | `thiserror` | The domain layer (per [hexagonal.md](architecture/hexagonal.md)) must depend on the standard library only. |

This is the same rule as `SPEC.md:2217-2254` (GUIDELINE-RUST-001) — promoted to a first-class pattern doc and indexed here so it is discoverable without grepping the spec.

## Canonical Shape

### Library error (the shape every crate's `error.rs` follows)

```rust
// crates/<name>/src/error.rs
use thiserror::Error;

/// Errors that can occur during <crate responsibility>.
#[derive(Error, Debug)]
pub enum <Crate>Error {
    #[error("Failed to parse input: {0}")]
    ParseError(String),

    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Invalid value for {field}: {message}")]
    InvalidValue { field: String, message: String },

    /// I/O / DB / network — wrap the source so `?` works.
    #[error("Storage error: {0}")]
    Storage(#[from] std::io::Error),
}

/// Crate-local `Result` alias so signatures stay short.
pub type Result<T> = std::result::Result<T, <Crate>Error>;
```

Conventions:

- One `enum <Crate>Error` per crate, in `src/error.rs`.
- Variants are **data, not strings** — prefer `MissingField(String)` over `MissingField(&'static str)` so the error carries the offending value.
- Wrap third-party errors with `#[from]` so the caller can `?` without manual `.map_err`.
- Do not implement `Display` by hand unless you must; `thiserror`'s `#[error("...")]` covers it.
- Implement `From` for sibling-crate errors at the boundary crate, not inside the source crate, to keep the dependency graph acyclic.

### Application / binary error (CLI entry points, tests, scripts)

```rust
use anyhow::{Context, Result};

fn process_file(path: &Path) -> Result<()> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let data = parse(&content).context("Failed to parse file content")?;
    save(data).context("Failed to save processed data")?;
    Ok(())
}
```

Conventions:

- `anyhow::Result<T>` only in `main`, integration tests, and one-off scripts.
- `.context(...)` (lowercase) or `.with_context(|| ...)` at every `?` that crosses a human-meaningful boundary.
- Never `unwrap()` / `expect()` in production paths; reserve them for invariants the type system cannot prove.

## Variant Naming

`<Crate>Error` variants follow three groups:

| Group | Shape | Examples |
|-------|-------|----------|
| Validation | Carry the offending value as a typed field | `InvalidEmail(String)`, `MissingField(&'static str)`, `OutOfRange { got: u64, max: u64 }` |
| I/O wrap | `#[from]` over a foreign error | `Repository(#[from] sqlx::Error)`, `Storage(#[from] std::io::Error)`, `Broker(#[from] nats::Error)` |
| Domain rule | Unit variant or typed payload, no foreign wrap | `CannotCancelShipped`, `InsufficientStock { requested: u32, available: u32 }` |

Avoid the two anti-patterns:

- ❌ A single `Internal(String)` variant that swallows all errors.
- ❌ A `Box<dyn std::error::Error>` variant — loses variant matching and `Send + Sync` in async.

## Layering (Hexagonal)

The hexagonal pattern ([architecture/hexagonal.md](architecture/hexagonal.md)) defines three error layers:

| Layer | Example | Lives in |
|-------|---------|----------|
| `DomainError` | `UserNotFound(UserId)`, `InvalidEmail(String)` | `crates/<name>/src/domain/error.rs` — **no foreign deps** |
| `ApplicationError` | `UseCase(UserNotFound)`, `Persistence(#[from] RepositoryError)` | `crates/<name>/src/application/error.rs` — wraps domain + port errors |
| Adapter / port error | `Repository(#[from] sqlx::Error)`, `Broker(#[from] nats::Error)` | `crates/<name>/src/adapters/.../error.rs` — wraps infra errors |

`ApplicationError` converts to `DomainError` (or vice versa) at the port boundary so the domain layer stays free of `sqlx` / `nats` / `reqwest` types. This is the same shape you see inlined in `patterns/architecture/hexagonal.md:56-93` and `docs/patterns/architecture/cqrs.md:110-141`.

## Async & Messaging

The event-driven pattern ([async/event-driven.md](async/event-driven.md)) adds three error-specific enums on top of the rule above:

- `EventError` — failure to publish / serialize (returns `Result<(), EventError>` from `EventPublisher::publish`).
- `HandlerError` — failure to process a delivered event (returns `Result<(), HandlerError>` from `EventHandler::handle`).
- `RelayError` / `PublishError` — outbox relay failures ([async/outbox.md](../../docs/patterns/async/outbox.md)).

All three follow the same `#[derive(Error, Debug)] pub enum` shape, with `RetryPolicy` + `DeadLetterQueue` ([async/event-driven.md:174-191](async/event-driven.md)) deciding what happens **after** the typed error is constructed. Handler errors are *not* panics; they are *not* swallowed; they are typed so the relay can `match` on them and route to DLQ.

## Test & Example Errors

Tests and examples **may** use a private `enum TestError` (still `thiserror`) for setup failures that should never reach the assertion. They must **not** use `anyhow` — assertions need `match` to distinguish "setup broke" from "behavior wrong."

## Reference Implementations (2+ example repos)

| Repo | File | Variants | Pattern |
|------|------|----------|---------|
| **HeliosCLI** | `crates/harness_spec/src/error.rs:6-35` | `SpecError { ParseError, JsonParseError, MissingField, InvalidValue { field, message }, ValidationError, VersionNotFound, UnsupportedFormat }` | One `SpecError` enum, every variant has a typed payload, `Result<T>` alias at the bottom. |
| **HeliosCLI** | `crates/harness_checkpoint/src/error.rs:6-35` | `CheckpointError { GitError, RepositoryNotFound, CheckpointNotFound, CreateFailed, RestoreFailed, StorageError, ConfigError }` | Same shape — used as the inline example above. |
| **thegent** | `crates/thegent-policy/src/errors.rs:3-16` | `PolicyError { ConfigLoadError, ConfigParseError, RuleNotFound, EvaluationError }` | Smaller, four-variant minimum-viable shape; useful template for new crates. |
| **thegent** | `crates/thegent-memory/src/error.rs`, `crates/thegent-wasm-tools/src/error.rs`, `crates/thegent-zmx-interop/src/error.rs`, `crates/thegent-subprocess/src/lib.rs` | One `*Error` per crate | Demonstrates the "one enum per crate, in `src/error.rs`" rule at scale across a workspace. |
| **AuthKit** | `rust/phenotype-security-aggregator/src/lib.rs`, `rust/phenotype-content-hash/src/lib.rs` | `SecurityError`, `ContentHashError` | Same shape inside an embedded-crate workspace (`rust/`). |
| **Civis** *(in-progress)* | `crates/engine/src/integrity.rs:11-26` | `IntegrityError { HashChainMismatch, Invariant(InvariantError) }` | Hand-rolled `Display` + `std::error::Error` impl. Functional, but migrate to `thiserror` per this pattern. |
| **Civis** *(in-progress)* | `crates/engine/src/replay.rs`, `crates/server/src/jsonrpc.rs`, `crates/laws/src/lib.rs` | `ReplayError`, `JsonRpcError`, `LawError` | Mixed: some hand-rolled, some `thiserror`. Migration candidate. |

The "X repos do this, Y repos do that" picture (see `SPEC.md:2489-2499` for the wider pattern-compliance matrix) is concrete here:

- ✅ **HeliosCLI, thegent, AuthKit** — fully on `thiserror`, one `enum *Error` per crate.
- ⚠️ **Civis** — partially migrated; several `enum *Error` types are still hand-rolled with `impl Display` + `impl std::error::Error`. Track migration in the engine crate audit, do not duplicate the rule in `Civis/docs/`.

## Anti-Patterns

- ❌ `Box<dyn std::error::Error>` in a public return type — silently erases variants.
- ❌ A single `Internal(String)` variant for "everything else" — always grows into a junk drawer.
- ❌ `anyhow::Error` in a library's public API — forces every caller into the same `anyhow` choice.
- ❌ Implementing `std::error::Error` by hand when `#[derive(Error)]` would do — adds maintenance for no benefit.
- ❌ `.unwrap()` / `.expect()` in production code paths (binaries included) — `.context()` exists.
- ❌ Two `enum *Error` types in one crate that wrap each other — pick a layer and stop.

## Related Patterns

- [architecture/hexagonal.md](architecture/hexagonal.md) — domain / application / adapter layering of errors.
- [async/event-driven.md](async/event-driven.md) — retry / DLQ on top of typed handler errors.
- [methodology/xdd.md](methodology/xdd.md) — TDD discipline for testing `Err` paths, not just `Ok`.
- `SPEC.md:2217-2254` (GUIDELINE-RUST-001) — the original Guidelines Catalog entry this page promotes to a standalone pattern.

## References

- [thiserror docs](https://docs.rs/thiserror) — derive macro reference.
- [anyhow docs](https://docs.rs/anyhow) — `Context` / `Result` reference.
- Internal: `SPEC.md:2489-2499` Pattern Compliance by Repository (the wider adoption matrix).
