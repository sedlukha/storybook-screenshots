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
storybook-screenshots            # build + serve + compare
storybook-screenshots --update   # write/refresh baselines
storybook-screenshots --config ./path/to/config.mjs
```

The CLI looks for the nearest `storybook-screenshots.config.mjs` (or `.js`),
walking up from the current directory.

## Config

| Option              | Type                                   | Default                                      | Description                                                              |
| ------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `buildCommand`      | `string`                               | —                                            | Command that builds Storybook into `storybookDir`. Omit if pre-built.    |
| `storybookDir`      | `string`                               | `"storybook-static"`                         | Built Storybook directory (must contain `index.json`).                   |
| `snapshotDir`       | `string`                               | `"__screenshots__"`                          | Where baseline PNGs are written/compared.                                |
| `browsers`          | `("chromium"\|"firefox"\|"webkit")[]`  | `["chromium"]`                               | Browsers to capture.                                                     |
| `viewports`         | `ScreenshotViewport[]`                 | `[{ name: "desktop", width: 1280, height: 800 }]` | Viewports/devices to capture (see [Device types](#device-types)). |
| `themes`            | `{ name, globals }[]`                  | `[]`                                         | Themes applied via Storybook globals (`?globals=theme:dark`).            |
| `skipTags`          | `string[]`                             | `["!screenshot"]`                            | Skip stories carrying any of these Storybook tags.                       |
| `fullPage`          | `boolean`                              | `true`                                       | Capture the full scrollable page.                                        |
| `maxDiffPixelRatio` | `number`                               | `0.01`                                       | Allowed differing-pixel ratio before a story fails.                      |
| `failFast`          | `boolean`                              | `true`                                       | Stop the whole run on the first failing story.                           |
| `retries`           | `number`                               | `2`                                          | Retry count (applied on CI).                                             |
| `port`              | `number`                               | `6007`                                       | Port for the built-in static server.                                     |

Baselines are written to `<snapshotDir>/<browser>-<viewport>[-<theme>]/<story-id>.png`.

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

## How it works

1. Builds Storybook (`buildCommand`) or uses an existing `storybookDir`.
2. Serves the static build over a local HTTP server (no extra dependency).
3. Reads `index.json` and creates one Playwright test per story.
4. Loads each story's iframe, waits for Storybook's `sb-show-main` signal, then
   `toHaveScreenshot`. A render failure surfaces the Storybook error and console
   output instead of a blind timeout.

## License

MIT © Arthur Sedlukha
