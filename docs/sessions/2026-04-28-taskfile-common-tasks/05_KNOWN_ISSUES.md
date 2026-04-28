# Known Issues

- `task lint` now passes on the focused core config set used by the Taskfile.
- `task test` passes with the current Node install.
- `task build` is still blocked by preexisting handbook content issues in the docs tree:
  dead links during VitePress validation and Markdown files with HTML-style tag parsing
  problems, including `CLAUDE.md`.
