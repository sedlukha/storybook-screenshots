# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.3.0
[0.2.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.2.0
[0.1.1]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.1.1
[0.1.0]: https://github.com/sedlukha/storybook-screenshots/releases/tag/v0.1.0
