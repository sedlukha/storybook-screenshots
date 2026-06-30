# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-06-30

### Added

- Theme folder grouping. A theme can set `group` to share one baseline folder
  with other themes in the same group, told apart by a `-<name>` filename suffix.
  Baselines go to `<snapshotDir>/<browser>-<viewport>-<group>/<story>-<name>.png`
  instead of a separate `…-<name>` folder per theme — e.g. light/dark variants of
  a brand sit together. Themes without `group` are unchanged.
- `colocate` option to keep each story's baselines next to its source file:
  `<story dir>/__screenshots__/<browser>-<viewport>[-<theme>]/<story>.png`
  instead of a single `snapshotDir` tree. The path is derived from the story's
  `importPath`. `snapshotDir` still holds the manifest by default.

## [0.6.0] - 2026-06-30

### Added

- Wait for the play function before capturing. Interactive stories (a play that
  opens a dialog, hovers to reveal a tooltip) are now shot in their settled,
  post-interaction state instead of the initial render — the runner waits for the
  Storybook render to reach a terminal phase. Best-effort: a story that never
  settles is still captured rather than failing the run.
- Per-story capture delay, on top of the play wait, for content that appears late
  for other reasons. Declared via Storybook parameters, read at runtime:
  `screenshot.delay` (this tool) or `chromatic.delay` (Chromatic-compatible), in
  milliseconds. Unset → no extra wait.

## [0.5.0] - 2026-06-30

### Changed

- Incremental mode now uses a committed **fingerprint manifest** instead of a git
  diff. For each story it hashes the transitive source it renders from (npm deps
  by their versioned module path, source files by content) plus a global
  fingerprint (config, `.storybook`, tool versions), and compares against the
  committed `manifest.json`. Benefits over the git approach:
  - No base ref or `git fetch` — works the same on PRs and on push to the default
    branch (after a merge, fingerprints match → nothing re-runs).
  - A dependency bump re-captures only the stories that actually use it (the
    version lives in the module path); a theme/config/global change re-captures all.
- `--changed` is now a boolean flag (no ref argument); `affected` no longer takes
  `--base`. The `affected` subcommand refreshes `manifest.json` and writes the
  `--only` allowlist. New `manifestFile` config; `globalDeps` is now a list of
  paths/dirs folded into the global fingerprint (default `[".storybook"]`).
- API: `computeAffected` signature changed; added `buildManifest`, `Manifest`,
  and `ManifestOptions` exports.

## [0.4.1] - 2026-06-29

### Fixed

- Baselines no longer churn on non-visual changes. `--update` now runs Playwright
  with `--update-snapshots=changed` instead of `all`: `all` compares baselines
  byte-for-byte and rewrites on any difference, so PNG-encoding drift (a couple of
  bytes with identical pixels) produced a fresh diff every run. `changed` compares
  pixels within `maxDiffPixelRatio` and only rewrites real changes, while still
  creating missing baselines and passing (exit 0) when it writes.

## [0.4.0] - 2026-06-29

### Added

- Incremental mode — capture only the stories a change set can affect, reusing
  committed baselines for the rest. Reads the Storybook module-graph stats
  (`preview-stats.json`, emitted by `storybook build --stats-json`), diffs
  against a git base ref, and reverse-traces the graph to the affected story IDs,
  so a change to a shared component also re-captures every story that renders it.
  - `--changed <ref>` runs build → compute → capture in one process.
  - `affected --base <ref> --out <file>` writes the allowlist for a sharded run
    to consume via `--only <file>`.
  - `globalDeps` config — globs that force a full run when matched (config,
    `.storybook/**`, lockfiles, `package.json`, tailwind/postcss by default), and
    `statsFile` to point at the stats. Errs toward a full run on any uncertainty.
  - Exposes `computeAffected`, `DEFAULT_GLOBAL_DEPS`, and `affected` from the API.

## [0.3.0] - 2026-06-29

### Added

- `--shard <i/N>` CLI flag (passthrough to Playwright) to split a capture run
  across multiple CI runners, plus `--no-build` to screenshot an already-built
  `storybookDir` (e.g. a shared build artifact each shard reuses).
- `workers` config option (a number or a Playwright percentage string like
  `"100%"`) to control in-process parallelism per run. Combine with `--shard`
  to parallelize both within and across runners.

## [0.2.0] - 2026-06-29

### Added

- Device-type emulation per viewport. `ScreenshotViewport` now accepts optional
  `deviceScaleFactor`, `isMobile`, and `hasTouch`, so a single matrix can cover
  desktop, tablet, and mobile form factors (retina density, mobile meta viewport,
  touch). Each viewport remains its own Playwright project and baseline folder.

## [0.1.1] - 2026-06-29

### Changed

- Dropped the `prepare` build script. The published tarball already ships
  `dist`, so installing from npm no longer trips pnpm's build-script approval
  (`ERR_PNPM_IGNORED_BUILDS`). `prepublishOnly` still builds before release.

## [0.1.0] - 2026-06-29

### Added

- Initial release.
- CLI `storybook-screenshots` that builds Storybook, serves it with a built-in
  static server, and screenshots every story with Playwright.
- Config file (`storybook-screenshots.config.mjs`) with `buildCommand`,
  `storybookDir`, `snapshotDir`, `browsers`, `viewports`, `themes`, `skipTags`,
  `fullPage`, `maxDiffPixelRatio`, `failFast`, `retries`, `port`.
- `defineConfig` helper and exported config types.
- `--update` flag to write/refresh baselines; `--config` to point at a config.
- Per-story tests across a browser × viewport × theme matrix, themes applied via
  Storybook globals.

[0.7.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.7.0
[0.6.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.6.0
[0.5.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.5.0
[0.4.1]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.4.1
[0.4.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.4.0
[0.3.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.3.0
[0.2.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.2.0
[0.1.1]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.1.1
[0.1.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.1.0
