# Research

## Repo signals

- `package.json` identifies the project as a Node/VitePress documentation repository.
- Available scripts are `docs:dev`, `docs:build`, `docs:preview`, and `test`.
- `docs/guides/tooling.md` documents Bun as the preferred JS runtime/package manager and
  `oxlint` for TypeScript linting, but the repo does not currently ship a lint config.

## Implementation choice

- Use the existing language-detection pattern in `Taskfile.yml`.
- Route `build` to the `docs:build` script and `test` to the `test` script.
- Implement `lint` as Markdown/config validation with transient CLI tools so the task is
  useful even without a dedicated lint script in `package.json`.
