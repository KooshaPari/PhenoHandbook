# Structured Logging in Go

## Overview

Every Go binary in the Pheno* ecosystem that needs to surface an event to logs (an HTTP server start, an LSP request error, a goroutine that lost its parent process, a JSON-shaped startup banner) goes through one package: the standard library's `log/slog`, configured with `slog.NewJSONHandler` and installed once via `sync.Once`. This page is the canonical place that rule lives; it consolidates the "log this thing" guidance that was previously implicit in the inline `log.Println(...)`, `log.Printf("...: %v", err)`, `fmt.Fprintln(os.Stderr, ...)`, and the hand-rolled `ComponentLogger` + `log.Output` shape in `MCPForge/internal/logging/logger.go:1-342`.

If a Go file needs to write a log line, it imports `"log/slog"` and calls `slog.Info(...)` / `slog.Error(...)` / etc. against the package default. If a `go.mod` adds a third-party logging library (`zap`, `zerolog`, `logrus`, `go.uber.org/zap`) just to get a JSON handler, either fix the file or update this page — don't fork the rule. `log/slog` (added to the standard library in Go 1.21) is the contract: one place to own the JSON handler shape, the `service` attribute, the `Level: slog.LevelInfo` default, the `os.Stderr` sink, and the `sync.Once` guard that prevents the default logger from being re-installed on every `New()` call (which is exactly what the old KWatch behaviour looked like, and exactly what the `loggerInit sync.Once` in `KWatch/server/server.go:13-31` is fixing).

> **Scope note.** This page covers the *call site and one-time setup* — what to call, what not to call, and how to install the default logger exactly once. The *log shape* (which fields are mandatory, what the `service` attribute must be, the severity→log level mapping) is the subject of [observability/logging](observability/logging.md) (when that page lands; for now it lives in the per-service `// Setup the structured logger` block at the top of each `main.go`). If you are adding a new structured field, reach for the same `slog.String(...)` / `slog.Int(...)` / `slog.Any(...)` shape the rest of the fleet uses. If you are about to call `log.Println` for the first time in a file, you are in the right place.

## The Rule

| Context | Use | Package | Why |
|---------|-----|---------|-----|
| A Go file needs to emit any log line (a startup banner, an `Info` event, a `Debug` trace, a fatal error) | `slog.Info(...)`, `slog.Debug(...)`, `slog.Warn(...)`, `slog.Error(...)` against the package default, with structured key/value pairs | `log/slog` (stdlib, Go 1.21+) | The package default is the single global handle every caller shares. It is initialised exactly once per process via `sync.Once` so test re-runs and re-`New()` calls do not churn the handler. |
| A `main.go` or package init needs to install the default JSON handler and `service` attribute | `sync.Once.Do(func() { slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})).With(slog.String("service", "<name>"))) })` | `log/slog` + `sync` (stdlib) | One canonical install path. The `sync.Once` guard means the install is a no-op on the second call, which is what tests and constructors depend on. |
| A library wants to emit log lines against a service-specific logger (a sub-component, a long-lived worker) | `slog.Default().With(slog.String("component", "<name>"))` to derive a child logger; do not call `slog.SetDefault` again | `log/slog` | The `.With(...)` shape appends fields to every subsequent event without mutating the package default. A library that calls `SetDefault` would clobber the host binary's `service` attribute. |
| A test wants to assert on the structured log output (a `slog.Info("started", "port", p)` event) | `slog.New(slog.NewJSONHandler(buf, ...))` and `slog.SetDefault(...)` *inside the test only*, with a `t.Cleanup` to restore | `log/slog` + `bytes.Buffer` | The test owns its own handler; it does not inherit the production handler's `service` tag, and the production process is not affected by the test's handler swap. |
| A caller wants to log a fatal error and exit (an unrecoverable config error, a missing required flag) | `slog.Error("operation failed", "error", err)` followed by `os.Exit(1)` | `log/slog` + `os` | The org does not have a `slog.Fatal` by default. `slog.Error` + `os.Exit(1)` keeps the exit code explicit and lets the caller do cleanup (close files, signal goroutines) before the process dies. |

**Hard rule:** `log.Println(...)`, `log.Printf("...: %v", err)`, `log.Fatal(err)`, `fmt.Println(...)`, `fmt.Fprintln(os.Stderr, ...)`, `panic("...")`, and any third-party logger (`zap`, `zerolog`, `logrus`, `go-kit/log`) are forbidden at Phenotype Go call sites. The defaults are wrong for us: stdlib `log` writes a single text line per call (no JSON, no fields, no severity), `fmt.Fprintln(os.Stderr, ...)` bypasses the structured handler entirely, `log.Fatal` writes the line and exits without a graceful-shutdown hook, and a third-party logger forks the `service` attribute contract and the JSON shape the rest of the fleet ships to the log shipper. Use `slog.Info / slog.Error / slog.Debug` and the `sync.Once`-guarded `setupLogger` from `KWatch/server/server.go:13-31`.

## Canonical Pattern

### Install the default logger exactly once

```go
// <package>/logger.go (or at the top of main.go for a single-binary repo)
package server

import (
    "log/slog"
    "os"
    "sync"
)

// loggerInit guards one-time installation of the default slog handler so
// repeated calls to New() (e.g. in tests) don't churn the global logger.
var loggerInit sync.Once

// setupLogger installs a JSON-based slog handler on the package's default
// logger. Output goes to stderr to preserve the historical log.Printf
// destination. The handler is tagged with a "service" attribute so log
// shippers can route KWatch events alongside the rest of the phenotype
// fleet. Safe to call multiple times.
func setupLogger() {
    loggerInit.Do(func() {
        handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
            Level: slog.LevelInfo,
        })
        slog.SetDefault(slog.New(handler).With(
            slog.String("service", "<service-name>"),
        ))
    })
}
```

Conventions (lifted from `KWatch/server/server.go:13-31`):

- `var loggerInit sync.Once` is a package-level guard. It is *not* a `var once sync.Once` inside `setupLogger` (the function-local form re-allocates a fresh `Once` per call and re-runs the install; the package-level form is the one that actually deduplicates). The variable name is `loggerInit` in KWatch; any `<package>Init` form that follows the same shape is fine — the contract is "package-level, named, guarded".
- `slog.SetDefault` is called *inside* `loggerInit.Do(...)`, never at package init time (a `func init() { slog.SetDefault(...) }` in a library would clobber the host binary's default and silently break every other library that emits a `slog.Info` call against the same process). The install is a function the host calls explicitly, and the `sync.Once` makes the call idempotent.
- `slog.NewJSONHandler` writes one JSON object per line to `os.Stderr`. `os.Stderr` (not `os.Stdout`) is the contract — error and operational output mixes with the historical `log` destination, and stdout is reserved for actual program output (`cmd | jq`, `cmd | grep`) that would silently break if a `slog.Info(...)` line appeared in the middle of a JSON response.
- `&slog.HandlerOptions{Level: slog.LevelInfo}` is the default. Override per-binary via `slog.LevelDebug` for a dev build, but the test harness and the production binary both use `LevelInfo` so the JSON shape is identical across environments — only the *amount* of output changes.
- `slog.New(handler).With(slog.String("service", "<name>"))` attaches the `service` attribute to every event the default logger emits. The service name is the binary's repo slug (`"kwatch"`, `"mcpforge"`, `"pheno"`, etc.) so the log shipper can route by `service=...` filter. The `.With(...)` shape appends fields without mutating the handler — every subsequent `slog.Info(...)` call automatically includes `service=<name>` as a top-level JSON key.
- The function is named `setupLogger` in KWatch. The name is descriptive, not contractual; the contract is "package-level `sync.Once`, `slog.NewJSONHandler(os.Stderr, ...)`, `slog.String(\"service\", ...)`, and the `slog.SetDefault` call lives *inside* the `Do(...)`". Rename the function per-package as long as the shape is the same.

### Emit log lines from any caller

```go
// <package>/server.go
package server

import (
    "context"
    "errors"
    "log/slog"
    "net/http"
)

func (s *Server) Start(ctx context.Context) error {
    // Ensure structured logging is wired up before any slog call.
    setupLogger()

    // slog.Info("message", "key", value, "key2", value2, ...) — every
    // key/value pair becomes a top-level field in the JSON line. The
    // `service` attribute is attached automatically by the .With(...)
    // call in setupLogger; callers do not pass it again.
    slog.Info("starting HTTP server",
        "host", s.config.Host,
        "port", s.config.Port,
    )
    slog.Info("monitoring directory", "dir", s.config.WorkingDir)

    // slog.Error is for error events. Pair it with the `"error", err`
    // field so the log shipper can route on the field. Do not call
    // log.Fatal — that writes a non-JSON line and skips the shutdown
    // hook. The caller decides when to os.Exit(1).
    if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
        slog.Error("HTTP server failed", "error", err)
        return err
    }
    return nil
}
```

Conventions:

- Every key/value pair uses the `"key", value` alternating form. `slog.Info("msg", "host", h, "port", p)` is canonical; `slog.Info("msg", slog.String("host", h), slog.String("port", p))` is also accepted and slightly faster on the hot path, but the alternating form is more readable and is the default for any non-hot-path call. Use the `slog.String(...)` form only when a profiler points at the alternating form as a bottleneck.
- The error field name is the literal string `"error"`. The shape is `slog.Error("operation failed", "error", err)`. Do not rename it to `"err"` / `"e"` / `"message"` / `"reason"` — the `error` field is the org-wide contract for "this is the error value" in structured log queries, the same way `error = %err` is the contract in the Rust `phenotype-error-core` reporter (see [error-reporting](error-reporting.md)).
- The message string is a stable, generic description (`"starting HTTP server"`, `"operation failed"`, `"HTTP server failed"`). The actual error context lives in the `error` field, not in the message. Stable message + structured field lets log scrapers filter on the field and operators filter on the message — the same split the Rust side enforces.
- `slog.Info` / `slog.Debug` / `slog.Warn` / `slog.Error` are the only severities. There is no `slog.Fatal`; an unrecoverable error is `slog.Error("...", "error", err)` followed by `os.Exit(1)` at the call site so the caller can `defer` close hooks, drain channels, and emit a final `slog.Info("shutdown complete")` line before the process dies.

### Derive a child logger for a sub-component

```go
// <package>/worker.go
package worker

import (
    "log/slog"
    "time"
)

// workerLogger is a derived child of the package default. The
// `component=watcher` attribute is attached to every event workerLogger
// emits, alongside the `service=<name>` attribute the default already
// carries. A library must NEVER call slog.SetDefault with a child
// logger — that would clobber the host binary's `service` tag and
// every other library's log events.
var workerLogger = slog.Default().With(slog.String("component", "watcher"))

func (w *Watcher) poll() {
    workerLogger.Debug("starting poll", "interval", w.interval)
    for {
        select {
        case <-w.done:
            workerLogger.Info("watcher stopping")
            return
        case ev := <-w.events:
            // The "component=watcher" field is present on every line
            // automatically; the per-event fields ("path", "kind") are
            // appended to the same JSON object.
            workerLogger.Info("file event", "path", ev.Path, "kind", ev.Kind.String())
        case <-time.After(w.interval):
            workerLogger.Debug("poll tick")
        }
    }
}
```

Conventions:

- A child logger is `slog.Default().With(slog.String("component", "<name>"))` and lives at package scope. The name follows the component constants in `MCPForge/internal/logging/logger.go:50-64` (`core`, `lsp`, `lsp-wire`, `lsp-process`, `watcher`, `tools`) for components that already exist there; new components get a kebab-case slug (`"http-server"`, `"rate-limiter"`, `"retry-policy"`).
- A child logger never calls `slog.SetDefault`. The `.With(...)` call returns a new `*slog.Logger` that already carries the parent's `service` attribute; reassigning the package default would wipe that field for every other caller in the process.
- The child logger does not re-install the handler. The handler is the package default's job, and the host binary's `setupLogger` runs once at process start. A test that needs a different handler for assertions swaps the *default* with a `t.Cleanup` to restore — see the test shape below.

### Test against a captured handler

```go
// <package>/server_test.go
package server

import (
    "bytes"
    "encoding/json"
    "log/slog"
    "testing"
)

func TestSetupLoggerIsIdempotent(t *testing.T) {
    // The test owns its own handler. We swap the package default for
    // a JSON handler writing to a buffer, run setupLogger twice, and
    // assert the second call did not re-install a handler (the buffer
    // still contains exactly one install-shaped line, not two).
    var buf bytes.Buffer
    prev := slog.Default()
    slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
    t.Cleanup(func() { slog.SetDefault(prev) })

    setupLogger()
    setupLogger() // second call: sync.Once.Do is a no-op, handler unchanged

    // The default after setupLogger carries service=<name> AND the
    // test's JSONHandler sink, because setupLogger's sync.Once.Do ran
    // exactly once. The assertion is on the side effect: the swap
    // from the test's "no service" handler to the production-shaped
    // handler happened on the first call and stayed put on the second.
    if got := slog.Default().With(slog.String("probe", "x")); !json.Valid(mustEncode(got, "test")) {
        t.Fatalf("slog output is not valid JSON: %s", buf.String())
    }
}

func mustEncode(l *slog.Logger, msg string) []byte {
    var buf bytes.Buffer
    handler := slog.NewJSONHandler(&buf, nil)
    l.Handler().Handle(nil, slog.NewRecord(time.Now(), slog.LevelInfo, msg, 0))
    _ = handler // handler is the production shape; the captured buffer is the assertion target
    return buf.Bytes()
}
```

(Reduce this to whatever shape your test harness needs; the contract is "the test owns its own handler, restores the previous default in `t.Cleanup`, and asserts on the JSON shape via `json.Valid` or a `json.Decoder` round-trip — not via string `Contains`.")

## What the Pattern Configures

The `setupLogger` function in `KWatch/server/server.go:13-31` is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Handler | `slog.NewJSONHandler(...)` (`server.go:24`) | One JSON object per line, parseable by every log shipper in the fleet. The default `slog.NewTextHandler` would emit a key=value text shape that no downstream parser is configured to read. |
| Output sink | `os.Stderr` (`server.go:24`) | The historical `log` destination. `os.Stdout` is reserved for program output (`cmd | jq`); a `slog.Info` line in stdout would silently corrupt the output stream. |
| Default level | `slog.LevelInfo` (`server.go:25`) | Production default. Debug builds override via `slog.LevelDebug` at the same call site; the test harness and the production binary emit the same JSON shape, only the verbosity differs. |
| Service attribute | `slog.String("service", "<name>")` (`server.go:28`) | The org-wide routing key. The log shipper filters on `service` to route KWatch events to the KWatch dashboard, MCPForge events to the MCPForge dashboard, etc. A missing `service` field means the event is dropped by the shipper's first-pass filter. |
| Install guard | `var loggerInit sync.Once` at package scope (`server.go:15`); `slog.SetDefault` lives inside `loggerInit.Do(...)` (`server.go:23-30`) | A package-level `sync.Once` deduplicates the install across every `New()` call (a constructor can call `setupLogger` on every test re-run without churning the handler). A function-local `sync.Once` (declared inside `setupLogger`) would re-allocate on every call and re-run the install — the same bug the package-level form is fixing. |
| Install trigger | An explicit `setupLogger()` call from the binary's `main` (or the first public constructor, e.g. `server.New(config, runner)` in `server.go:40`) | Libraries must not install the default from a `func init() { ... }`. A library `init` would clobber the host binary's `service` tag the moment the library is imported, silently breaking every other library's structured log output. The binary owns the install. |
| `log/slog` minimum version | Go 1.21+ (stdlib, no `go.mod` dep) | `log/slog` is part of the standard library since Go 1.21. No third-party dep, no `replace` directive, no `go.sum` entry. The repo's `go.mod` must declare `go 1.21` (or later) for the import to resolve. |
| Public surface | The `setupLogger` function is unexported (`setupLogger`, not `SetupLogger`) and the `loggerInit` `sync.Once` is unexported; the *contract* is "call `setupLogger` once before any `slog.Info` call, or call it from the binary's first public constructor" | The setup is an implementation detail of the package. Consumers reach for `slog.Info(...)` directly; the `setupLogger` call is the host binary's responsibility. The function name is descriptive, not contractual — rename per-package as long as the shape is the same. |
| Panic safety | The function does not `panic`, does not call `os.Exit`, does not block on I/O (`server.go:23-30`) | A `setupLogger` that panics would crash the host binary at the first `slog.Info` call. The body is two function calls and a struct literal — nothing to panic on, nothing to fail. |
| Return type | `()` (unit) — never `error`, never `*slog.Logger` | The function configures a global; the caller does not need a return value to use the default. A return-value design would force `_, _ = setupLogger()` at every call site, which is worse than a unit return. |

If a caller needs different behaviour (a different level, a different sink, a different service tag, a `slog.Handler` middleware that redacts PII), the seam is the same function: add a new field next to the existing ones and have the caller reach for the new option. Do not fork `setupLogger` at the call site.

## Anti-Patterns

- ❌ `log.Println("starting")` / `log.Printf("started: %v", err)` at a call site — emits a single text line per call, no JSON, no fields, no severity, no `service` tag. The log shipper's `service` filter drops the event, and the operator has no way to filter by severity in the dashboard. Use `slog.Info("starting", ...)` with structured fields.
- ❌ `log.Fatal(err)` / `log.Fatalf("...: %v", err)` — writes a non-JSON line (`log.Fatal` calls `log.Output` then `os.Exit(1)`), skips every `defer` close hook, and emits no structured `error` field. Use `slog.Error("operation failed", "error", err)` followed by `os.Exit(1)` at the call site so `defer` cleanup runs.
- ❌ `fmt.Println("starting")` / `fmt.Fprintln(os.Stderr, "starting")` at a call site — bypasses the `slog` handler entirely, writes to stdout (not stderr) in the `fmt.Println` case, and emits no JSON. The log shipper sees a plain text line it cannot parse. Use `slog.Info("starting", ...)`.
- ❌ `fmt.Sprintf("server started on %s:%d", host, port)` then `slog.Info(formatted)` — the structured fields are baked into the message string. The log shipper sees `"msg":"server started on localhost:3737"` and cannot route on `host=localhost` or `port=3737` as separate fields. Use `slog.Info("server started", "host", host, "port", port)` so each value is its own JSON key.
- ❌ `panic("invariant violated: ...") / log.Panic("...")` in a call site that handles errors — turns a recoverable condition into a process abort and emits a non-JSON line. The Go runtime's panic message is unstructured text; the org's recovery path is `slog.Error("invariant violated", "error", err)` + propagate / exit, not `panic`.
- ❌ Adding `go.uber.org/zap` / `github.com/rs/zerolog` / `github.com/sirupsen/logrus` as a `go.mod` dep just to get a JSON handler — forks the `service` attribute contract (each library has its own `With(...)` shape), forks the JSON layout (zap uses `"msg"` and `"level"`, zerolog uses `"message"` and `"level"`), and forces the log shipper to maintain a per-library parser. `log/slog` is the contract.
- ❌ A second `slog.SetDefault(...)` call from a library's `func init() { ... }` — clobbers the host binary's `service` tag the moment the library is imported. Every `slog.Info(...)` from every other library now goes out with the library's `service` value, silently breaking the log shipper's routing. Libraries call `slog.Default().With(...)` to derive a child logger; they never call `SetDefault`.
- ❌ `slog.Info("...", slog.String("error", err.Error()))` (passing the error's `Display` form as a string) — strips the error type, the wrapping context, and any structured fields the error type carries. The log shipper sees `"error":"connection refused"` with no way to filter by error type. Use `slog.Error("...", "error", err)` and let the handler render the error's `Error()` string.
- ❌ A hand-rolled `var logger = log.New(os.Stderr, "...", log.LstdFlags)` at the top of `main.go` — duplicates the `slog` setup, drops the `service` tag, emits a non-JSON line, and forces every other file in the binary to either reuse the `logger` variable (drift across files) or fall back to `slog` (two parallel log streams in the same process). Use `setupLogger` + `slog.Info(...)`.
- ❌ `slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))` in a library or test — emits a `key=value` text shape that no production log shipper in the fleet is configured to parse. The production binary is fine (it uses `NewJSONHandler`); the test (or the library) goes off-shape and the operator sees a different line format in the test environment than in production. Use `slog.NewJSONHandler` everywhere.
- ❌ `var once sync.Once` declared *inside* `setupLogger` (function-local) — a fresh `sync.Once` is allocated on every call, the `Do(...)` body runs every time, and the install churns the handler on every `New()` call. The package-level `var loggerInit sync.Once` in `KWatch/server/server.go:15` is the deduplicated form; the function-local form is the bug the package-level form is fixing.
- ❌ Calling `setupLogger` from a `func init() { ... }` in a library — the install runs the moment the library is imported, before the host binary has a chance to set its own `service` tag. The library's `init` clobbers whatever the host had configured (or the host's later `SetDefault` clobbers the library's). The install must be a regular function the host calls explicitly from `main` (or from the binary's first public constructor).
- ❌ `slog.Info("starting")` with no structured fields at all — emits a JSON line with just `{"time":..., "level":"INFO", "msg":"starting", "service":"<name>"}` and no per-event context. Every line is identical except for the message string; the log shipper cannot route on `host`, `port`, `dir`, etc. Pass at least one structured field per event so the JSON line is filterable.

## Reference

The canonical install lives at `KWatch/server/server.go:13-31` (the `loggerInit sync.Once` package-level guard, the `setupLogger` function, the `slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})` shape, the `slog.String("service", "kwatch")` attribute, and the `slog.SetDefault` call inside `loggerInit.Do(...)`). Every Go binary in the Pheno* ecosystem should follow this shape; the function name, the `service` tag, and the package name change per-binary, but the contract does not.

The "before" state — what we are migrating away from — is `MCPForge/main.go:21` (a `var coreLogger = logging.NewLogger(logging.Core)` against the custom `MCPForge/internal/logging/logger.go:1-342` package, which wraps stdlib `log` with a hand-rolled `LogLevel` enum, a `Component` enum, a `ComponentLevels` map, an `init()`-time `log.SetOutput(Writer)` + `log.SetFlags(...)` call, a `logMu sync.Mutex` around every emit, and a `jsonMode` boolean that toggles a manual `json.Marshal` + `fmt.Fprintln` path). The custom package predates `log/slog` (Go 1.21) and re-implements the JSON handler, the level enum, the structured field set, and the per-component filter as a parallel universe. The migration is `MCPForge/internal/logging/logger.go` → `slog.NewJSONHandler` + a single `setupLogger` in `MCPForge/main.go:21`'s place, then `coreLogger.Info("...")` → `slog.Info("...")` (or `slog.Default().With(slog.String("component", "core")).Info("...")` for the per-component shape) at every call site in `MCPForge/main.go:21-244`. The custom package's `Component` constants (`logging.Core`, `logging.LSP`, `logging.LSPWire`, `logging.LSPProcess`, `logging.Watcher`, `logging.Tools` in `MCPForge/internal/logging/logger.go:50-64`) become `slog.String("component", "core" / "lsp" / "lsp-wire" / "lsp-process" / "watcher" / "tools")` attributes on the same child loggers.
