# HTTP Client Setup Pattern

## Overview

Every Rust crate in the org that needs to make outbound HTTP requests goes through one factory: `phenotype_http_client_core::build_default_client`. This page is the canonical place that rule lives; it consolidates the HTTP-client setup guidance that was previously implicit in the `reqwest::Client::new()` call sites scattered across `phenoShared/crates/phenotype-http-adapter/src/http_client.rs`, `phenotype-nanovms-client`, and the inline client construction in the various `*-adapter` crates.

If a crate needs an HTTP client, it imports `build_default_client`. If a `Cargo.toml` adds `reqwest` directly to build a one-off client, either fix the crate or update this page — don't fork the rule. The `phenotype-http-client-core` crate exists for exactly this reason: one place to own the timeouts, TLS, user-agent, and connection-pool defaults so every caller gets the same behaviour.

## The Rule

| Context | Use | Crate / Function | Why |
|---------|-----|------------------|-----|
| Any Rust crate that needs an outbound `reqwest::Client` | `phenotype_http_client_core::build_default_client()` | `phenotype-http-client-core` | Centralised timeouts, TLS (`rustls`), user-agent, connection pool, redirect policy. One definition, audited once, applied everywhere. |
| Test-only or example-only client | `phenotype_http_client_core::build_default_client()` (or a deliberately isolated mock server) | `phenotype-http-client-core` | Same factory in tests keeps behaviour consistent; if you need a fake, use `wiremock` / `mockito` instead of hand-rolling a client. |
| Ad-hoc one-shot request inside a binary | `phenotype_http_client_core::build_default_client()` (cached in a `OnceLock`) | `phenotype-http-client-core` | Never call `reqwest::Client::new()` with bare defaults; always go through the factory. |

**Hard rule:** `reqwest::Client::new()` and `reqwest::Client::builder().build()` with no configuration are forbidden in Phenotype code. The defaults are wrong for us: no timeouts, no user-agent, no connection-pool tuning, native TLS that pulls in OpenSSL on macOS.

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-http-client-core = { path = "../../phenotype-http-client-core" }

# Note: do NOT add `reqwest` directly unless you are building the
# http-client-core crate itself or wrapping a foreign API. Consumers
# go through `build_default_client()` and never touch `reqwest` types.
```

### Use the factory

```rust
// crates/<name>/src/adapters/<thing>/client.rs
use phenotype_http_client_core::build_default_client;
use crate::error::<Crate>Error;

/// HTTP client wrapper used by the <thing> adapter.
///
/// Holds a shared `reqwest::Client` (cheap to clone — internally `Arc`-backed)
/// and exposes domain-shaped methods that return `<Crate>Error`.
#[derive(Clone)]
pub struct <Thing>HttpClient {
    http: reqwest::Client,
}

impl <Thing>HttpClient {
    /// Build a new client using the org's canonical defaults
    /// (timeouts, TLS, user-agent, connection pool).
    pub fn new() -> Result<Self, <Crate>Error> {
        let http = build_default_client()
            .map_err(<Crate>Error::from)?;
        Ok(Self { http })
    }

    pub async fn fetch(&self, url: &str) -> Result<Thing, <Crate>Error> {
        let response = self.http
            .get(url)
            .send()
            .await
            .map_err(<Crate>Error::from)?
            .error_for_status()
            .map_err(<Crate>Error::from)?;
        let body = response
            .json::<Thing>()
            .await
            .map_err(<Crate>Error::from)?;
        Ok(body)
    }
}
```

### In a binary or long-lived service

```rust
// crates/<name>/src/main.rs (binary)
use std::sync::OnceLock;
use phenotype_http_client_core::build_default_client;

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        build_default_client().expect("default HTTP client must build")
    })
}
```

Cache the client in a `OnceLock` (or pass it through your DI container) — `Client` is `Clone` and intended to be reused; constructing one per request defeats the connection pool.

## What `build_default_client` Configures

The factory is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Connect timeout | 5 s | Fail fast on dead hosts; surface to retry/DLQ rather than hanging. |
| Request timeout | 30 s | Bound any single call so a slow downstream cannot stall a worker. |
| TLS backend | `rustls` (default features off) | Avoid the OpenSSL system dependency on macOS / Linux. |
| User-agent | `phenotype/<crate-version> (<target-triple>)` | Identifies us in downstream access logs and to CDNs. |
| Connection pool | `pool_max_idle_per_host(16)` | Reuse keep-alive connections; matches typical fan-out. |
| Redirect policy | At most 5 follows | Same as `reqwest` default but pinned; a future bump is one PR in one crate. |
| Cookie store | Disabled | We do not send cookies to downstream APIs by default. |
| HTTP/2 | Adaptive | Lets `reqwest` negotiate; do not force h2-only on the client side. |

If a downstream needs different timeouts (e.g. a long-poll endpoint), construct a **second** client from a *second* factory in the same crate (`build_long_poll_client` or similar) — do not override settings on a default client at the call site.

## Anti-Patterns

- ❌ `reqwest::Client::new()` — bare defaults, no timeouts, no user-agent, no pool tuning. This is the exact thing the pattern forbids.
- ❌ `reqwest::Client::builder().build()` with no `.timeout(...)` / `.user_agent(...)` / `.tls_built_in_...` calls — same as `::new()`.
- ❌ Adding `reqwest` as a direct dependency in a consumer crate when you only need a client. Depend on `phenotype-http-client-core` instead.
- ❌ Building a new `Client` per request — defeats the connection pool and leaks file descriptors.
- ❌ Patching timeouts / user-agent on a client you got from the factory — fork the factory, don't mutate.
- ❌ Forcing `native-tls` to pick up OpenSSL — use the default `rustls` configured by the factory.
- ❌ Hand-rolling a client because "it's just a quick script" — scripts are binaries; binaries follow the rule.

## Reference Implementation

The single source of truth for the factory:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-http-client-core/src/lib.rs` | `pub fn build_default_client() -> Result<reqwest::Client, HttpClientBuildError>` | Defines timeouts, TLS, user-agent, pool size, redirect policy. Returns a typed error (`thiserror`) so the caller can `?` it into the crate-local error. |
| **phenoShared** | `crates/phenotype-http-client-core/src/error.rs` | `HttpClientBuildError` | `thiserror` enum; `#[from]` adapter for `reqwest::Error`. Follows the [error-handling](error-handling.md) pattern. |

The legacy client (a migration candidate, not a reference for new code):

| Repo | Path | Issue |
|------|------|-------|
| **phenoShared** | `crates/phenotype-http-adapter/src/http_client.rs:20-26` | Calls `Client::new()` with bare defaults inside `ReqwestHttpClient::new`. Migrate to `build_default_client()`; track in the http-adapter audit. |
| **phenoShared** | `crates/phenotype-nanovms-client/src/...` (any `reqwest::Client::new` / `.builder().build()` call site) | Same migration target. |

## Migration Checklist (per crate)

1. Remove `reqwest` from `[dependencies]` (keep it as a transitive dep via `phenotype-http-client-core` if you need the `reqwest::Response` / `reqwest::Client` types in your signatures; re-export the types you need from the adapter rather than depending on `reqwest` directly).
2. Add `phenotype-http-client-core = { path = "..." }`.
3. Replace `Client::new()` / `Client::builder().build()` with `build_default_client()`.
4. Convert the factory's `Result<Client, HttpClientBuildError>` into your crate-local error via `#[from]` (see [error-handling](error-handling.md)).
5. Cache the resulting `Client` — never construct per request.
6. If your crate exposes the `Client` in a public API, take a `reqwest::Client` parameter (built by the factory in `main`) rather than constructing it inside.

## Related Patterns

- [error-handling](error-handling.md) — how to wrap `HttpClientBuildError` into a crate-local `<Crate>Error` via `#[from]`.
- [architecture/hexagonal](architecture/hexagonal.md) — the HTTP client is an *adapter*; the domain layer must not depend on `reqwest` types. Use the factory in the adapter and pass primitives across the port boundary.
- [async/event-driven](async/event-driven.md) — timeout and retry behaviour on top of the client; retry lives in the publisher / outbox relay, not in the HTTP client itself.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-http-client-core` is the org's wrapper around `reqwest`. Don't reach past it.

## References

- [reqwest docs](https://docs.rs/reqwest) — the underlying client (`Client`, `ClientBuilder`).
- [rustls](https://docs.rs/rustls) — TLS backend used by the factory.
- Internal: `phenoShared/crates/phenotype-http-client-core/build_default_client` — the factory this page governs.
