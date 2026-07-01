# storybook-screenshots

[![npm](https://img.shields.io/npm/v/storybook-screenshots.svg)](https://www.npmjs.com/package/storybook-screenshots)
[![license](https://img.shields.io/npm/l/storybook-screenshots.svg)](./LICENSE)

Screenshot every Storybook story with Playwright. Drop a config file in your
repo, run one command — it builds Storybook, serves it, walks the story index,
and captures a baseline per story across the browsers, viewports, and themes you
declare.

## Why?

Storybook is already an inventory of every UI state you care about. This turns
that inventory into pixel baselines for visual-regression testing, without you
writing a test per component. Framework-agnostic: any Storybook 8 / 9 / 10.

## Install

```sh
npm i -D storybook-screenshots @playwright/test
npx playwright install --with-deps chromium
```

`@playwright/test` is a peer dependency. Node ≥ 22.

## Quick start

Add a config to your repo root:

```js
// storybook-screenshots.config.mjs
/** @type {import('storybook-screenshots').StorybookScreenshotsConfig} */
export default {
  buildCommand: "npm run build-storybook",
  snapshotDir: "screenshots/__screenshots__",
  themes: [
    { name: "light", globals: { theme: "light" } },
    { name: "dark", globals: { theme: "dark" } },
  ],
}
```

Add scripts and run:

```jsonc
// package.json
{
  "scripts": {
    "screenshots": "storybook-screenshots",
    "screenshots:update": "storybook-screenshots --update"
  }
}
```

```sh
npm run screenshots:update   # write baselines (first run / intentional changes)
npm run screenshots          # compare against committed baselines
```

Commit the generated PNGs. On later runs a changed story fails the command with
a Playwright diff.

## CLI

```sh
storybook-screenshots                 # build + serve + compare
storybook-screenshots --update        # write/refresh baselines
storybook-screenshots --config ./path/to/config.mjs
storybook-screenshots --shard 2/4     # capture only the 2nd of 4 slices
storybook-screenshots --no-build      # skip buildCommand, use an existing build
storybook-screenshots --update --changed         # capture only changed stories
storybook-screenshots affected --out affected.json
storybook-screenshots --update --only affected.json
```

The CLI looks for the nearest `storybook-screenshots.config.mjs` (or `.js`),
walking up from the current directory.

| Flag             | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `--update`, `-u` | Write/overwrite baselines instead of comparing.                             |
| `--config`, `-c` | Path to the config file (otherwise the nearest one is used).                |
| `--shard <i/N>`  | Capture only slice `i` of `N` — split a run across CI runners.              |
| `--no-build`     | Skip `buildCommand` and screenshot the existing `storybookDir`.             |
| `--changed`      | Incremental: capture only stories whose fingerprint changed.                |
| `--only <v>`     | Restrict to an allowlist — an `affected` JSON file or a comma list of IDs.  |

Plus an `affected` subcommand that refreshes the manifest and writes the
changed-story allowlist without capturing:
`storybook-screenshots affected [--out file.json]`.

## Config

| Option              | Type                                   | Default                                      | Description                                                              |
| ------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `buildCommand`      | `string`                               | —                                            | Command that builds Storybook into `storybookDir`. Omit if pre-built.    |
| `storybookDir`      | `string`                               | `"storybook-static"`                         | Built Storybook directory (must contain `index.json`).                   |
| `snapshotDir`       | `string`                               | `"__screenshots__"`                          | Where baseline PNGs are written/compared (holds the manifest under `colocate`). |
| `colocate`          | `boolean`                              | `false`                                      | Store baselines next to each story's source file (see [Co-location](#co-location)). |
| `pathSegments`      | `("browser"\|"viewport"\|"theme")[]`   | `["browser","viewport","theme"]`             | Order of the folder segments in a baseline path.                          |
| `nestedFolders`     | `boolean`                              | `false`                                      | Nest segments as folders (`browser/theme/viewport/`) vs `-`-joined.       |
| `browsers`          | `("chromium"\|"firefox"\|"webkit")[]`  | `["chromium"]`                               | Browsers to capture.                                                     |
| `viewports`         | `ScreenshotViewport[]`                 | `[{ name: "desktop", width: 1280, height: 800 }]` | Viewports/devices to capture (see [Device types](#device-types)). |
| `themes`            | `{ name, globals, group? }[]`          | `[]`                                         | Themes applied via Storybook globals (`?globals=theme:dark`).            |
| `skipTags`          | `string[]`                             | `["!screenshot"]`                            | Skip stories carrying any of these Storybook tags.                       |
| `fullPage`          | `boolean`                              | `true`                                       | Capture the full scrollable page.                                        |
| `maxDiffPixelRatio` | `number`                               | `0.01`                                       | Allowed differing-pixel ratio before a story fails.                      |
| `failFast`          | `boolean`                              | `true`                                       | Stop the whole run on the first failing story.                           |
| `retries`           | `number`                               | `2`                                          | Retry count (applied on CI).                                             |
| `workers`           | `number \| string`                     | Playwright default (½ cores)                 | Parallel workers; a count or a percentage string like `"100%"`.          |
| `statsFile`         | `string`                               | `<storybookDir>/preview-stats.json`          | Module-graph stats for incremental mode (build with `--stats-json`).      |
| `manifestFile`      | `string`                               | `<snapshotDir>/manifest.json`                | Committed fingerprint manifest for incremental mode.                      |
| `globalDeps`        | `string[]`                             | `[".storybook"]`                             | Paths folded into the global fingerprint; a change re-captures all.       |
| `port`              | `number`                               | `6007`                                       | Port for the built-in static server.                                     |

Baselines are written to `<snapshotDir>/<browser>-<viewport>[-<theme>]/<story-id>.png`.
With theme `group`s, the group is the folder and the theme name becomes a filename
suffix: `<snapshotDir>/<browser>-<viewport>-<group>/<story-id>-<name>.png` (see
[Themes](#themes)). Reorder the segments with `pathSegments` and nest them as
directories with `nestedFolders` — e.g. `pathSegments: ["browser","theme","viewport"]`
+ `nestedFolders: true` →
`<snapshotDir>/<browser>/<group>/<viewport>/<story-id>-<name>.png`.

## Device types

A viewport is more than a width and height — `ScreenshotViewport` carries
optional device-emulation fields so one matrix can cover desktop, tablet, and
mobile form factors:

| Field               | Type      | Default          | Description                                                              |
| ------------------- | --------- | ---------------- | ------------------------------------------------------------------------ |
| `name`              | `string`  | —                | Snapshot path segment (part of the project name).                        |
| `width` / `height`  | `number`  | —                | Layout size in CSS pixels.                                               |
| `deviceScaleFactor` | `number`  | `1`              | Device pixel ratio. Raise to render at retina density (`srcset`, DPR styles). |
| `isMobile`          | `boolean` | `false`          | Mobile meta viewport + touch. **Chromium only.**                         |
| `hasTouch`          | `boolean` | follows `isMobile` | Touch events; set independently of `isMobile`.                         |

```js
viewports: [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024, deviceScaleFactor: 2 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
]
```

Each viewport becomes its own Playwright project and baseline folder, multiplied
by every browser and theme. With `scale: "css"` the captured PNG stays at 1 px
per CSS pixel, so a higher `deviceScaleFactor` changes what the page *renders*
(media queries, image sources) while keeping baselines OS-independent.

## Themes

Each theme maps to Storybook globals applied through the preview iframe, so it
works with whatever theming your Storybook already exposes (a `theme` global, a
toolbar, decorators…). `{ name: "dark", globals: { theme: "dark" } }` loads each
story with `?globals=theme:dark` and stores its baselines under a `…-dark`
folder.

Set `group` to make related themes share one folder, distinguished by a filename
suffix instead of a separate folder each — handy for keeping a brand's light and
dark variants together:

```js
themes: [
  { name: "light", group: "acme",   globals: { theme: "acme-light" } },
  { name: "dark",  group: "acme",   globals: { theme: "acme-dark" } },
  { name: "light", group: "globex", globals: { theme: "globex-light" } },
  { name: "dark",  group: "globex", globals: { theme: "globex-dark" } },
]
// → <browser>-<viewport>-acme/<story>-light.png   + …-acme/<story>-dark.png
//   <browser>-<viewport>-globex/<story>-light.png + …-globex/<story>-dark.png
```

## Co-location

Set `colocate: true` to store each story's baselines next to its source file
instead of in one `snapshotDir` tree. The folder is derived from the story's
`importPath`:

```
src/button/
  button.stories.tsx
  __screenshots__/
    chromium-desktop/button--default.png
```

Combine with theme `group`s and a snapshot glob that matches the new location
(e.g. `src/**/__screenshots__/**`). The manifest is a single file and still lives
under `snapshotDir` (or set `manifestFile`).

## Interactive stories

Stories with a play function (opening a dialog, hovering to reveal a tooltip) are
captured in their **settled, post-interaction state**: the runner waits for the
play function to finish before screenshotting. No per-story config needed. If a
story never settles it is captured anyway rather than failing the run.

## Per-story options

Stories can tune their own capture via Storybook `parameters.screenshot`, read at
runtime (type them with the exported `ScreenshotParameters`):

```ts
import type { ScreenshotParameters } from "storybook-screenshots"

export const Notifications = {
  parameters: {
    screenshot: {
      delay: 500,                       // extra pause before capture (ms)
      mask: ["[data-testid=avatar]", ".timestamp"], // hide dynamic content
      fullPage: false,                  // override the global fullPage
      maxDiffPixelRatio: 0.02,          // looser threshold for this story
      viewports: ["mobile"],            // capture only in these viewports
    } satisfies ScreenshotParameters,
  },
}
```

- **`mask`** — CSS selectors painted over before the screenshot; the go-to for
  app stories with timestamps, avatars, or other unavoidable churn.
- **`fullPage` / `maxDiffPixelRatio`** — per-story overrides of the global config.
- **`viewports`** — restrict the story to the listed viewport names.
- **`delay`** — pause before capture; `chromatic.delay` is honored as a fallback,
  so stories already annotated for
  [Chromatic](https://www.chromatic.com/docs/delay/) work unchanged. The delay is
  applied *after* the play-function wait (animations are already disabled).

## CI

Generate baselines on one OS (CI) so they are deterministic — font rendering
differs across platforms. To turn a CI run's baseline changes into a reviewable
pull request automatically, pair this with
[`sedlukha/snapshot-autofix-pr`](https://github.com/sedlukha/snapshot-autofix-pr):

```yaml
- run: npx playwright install --with-deps chromium
- run: npm run screenshots:update
- uses: sedlukha/snapshot-autofix-pr@v1
  with:
    token: ${{ secrets.PAT_TOKEN || secrets.GITHUB_TOKEN }}
    snapshot-glob: "screenshots/__screenshots__/**"
```

### Sharding across runners

A big matrix (browsers × viewports × themes × stories) is slow on one runner.
Capture is render-bound, so the fix is parallelism, not caching. Two levers:

- **`workers`** — use every core on a single runner (`workers: "100%"`).
- **`--shard i/N`** — split the run across N runners, then merge the slices.

A sharded pipeline: build Storybook once and share it as an artifact, fan out
the capture across N runners, then combine the slices into one auto-fix PR.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build-storybook
      - uses: actions/upload-artifact@v4
        with: { name: storybook-static, path: storybook-static }

  screenshots:
    needs: build
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: { shard: [1, 2, 3, 4] }
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - uses: actions/download-artifact@v4
        with: { name: storybook-static, path: storybook-static }
      # --no-build reuses the shared build; --shard captures this slice only.
      - run: npx storybook-screenshots --update --no-build --shard ${{ matrix.shard }}/4
      # Upload only the baselines this shard touched (slices are disjoint).
      - run: |
          git add -A screenshots/__screenshots__
          git diff --cached --name-only | tar -czf shard.tgz -T -
      - uses: actions/upload-artifact@v4
        with: { name: shots-${{ matrix.shard }}, path: shard.tgz }

  pr:
    needs: screenshots
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with: { pattern: shots-*, path: shards }
      - run: for f in shards/*/shard.tgz; do tar -xzf "$f"; done
      - uses: sedlukha/snapshot-autofix-pr@v1
        with:
          token: ${{ secrets.PAT_TOKEN || secrets.GITHUB_TOKEN }}
          snapshot-glob: "screenshots/__screenshots__/**"
```

### Incremental capture (changed stories only)

Even sharded, capturing every story on every PR is wasteful when a change touches
one component. Incremental mode captures only the stories a change set can
affect; the committed baselines are the cache for the rest.

It works like Chromatic's TurboSnap, but tracks changes with a committed
**fingerprint manifest** instead of a git diff — so it needs no base ref and
behaves the same on PRs and on push to the default branch. Build Storybook with
`--stats-json` to emit a module-dependency graph
(`storybook-static/preview-stats.json`), then:

1. For each story, hash everything it renders from — its transitive modules from
   the graph (npm deps by their **versioned module path**, source files by
   **content**) — plus a global fingerprint (`globalDeps`, the config, and the
   `storybook-screenshots` / `@playwright/test` versions).
2. Compare against the committed `manifest.json` (under `snapshotDir`):
   - no manifest, or the global fingerprint changed → **every** story runs;
   - otherwise only stories whose hash changed run.
3. The refreshed manifest is committed next to the baselines, so after a merge
   the fingerprints match and nothing re-runs.

A dependency bump re-captures only the stories that use it (the version is in the
module path); a theme/config/global change re-captures everything. Granularity is
the story file — all stories in a file share its imports.

```sh
storybook build --stats-json
# build is already done, so add --no-build
storybook-screenshots --update --no-build --changed
```

In a sharded pipeline, compute the allowlist once and pass it to every shard.
`affected` also rewrites `manifest.json`, which must be committed with the
baselines (it lives under `snapshotDir`, so the snapshot glob already covers it):

```yaml
# in the build job, after `storybook build --stats-json`:
- run: npx storybook-screenshots affected --out affected.json
- uses: actions/upload-artifact@v4
  with: { name: affected, path: affected.json }
- uses: actions/upload-artifact@v4
  with: { name: manifest, path: screenshots/__screenshots__/manifest.json }

# in each shard, after downloading storybook-static + affected:
- run: npx storybook-screenshots --update --no-build --shard ${{ matrix.shard }}/4 --only affected.json

# in the pr job, restore the manifest next to the baselines before opening the PR.
```

An `affected.json` of `{ "all": true }` (a global change, or any uncertainty —
missing stats or manifest) means `--only` runs everything. When no story is
affected, the run captures nothing and exits cleanly.

## How it works

1. Builds Storybook (`buildCommand`) or uses an existing `storybookDir`.
2. Serves the static build over a local HTTP server (no extra dependency).
3. Reads `index.json` and creates one Playwright test per story.
4. Loads each story's iframe, waits for Storybook's `sb-show-main` signal, then
   `toHaveScreenshot`. A render failure surfaces the Storybook error and console
   output instead of a blind timeout.

## License

MIT © Arthur Sedlukha
