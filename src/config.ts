import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DEFAULT_GLOBAL_DEPS } from "./affected.js"

export type ScreenshotBrowser = "chromium" | "firefox" | "webkit"

export interface ScreenshotViewport {
  /** Label used as a snapshot path segment (part of the project name). */
  name: string
  /** Layout width in CSS pixels. */
  width: number
  /** Layout height in CSS pixels. */
  height: number
  /**
   * Device pixel ratio. Default: `1`. Raise it (e.g. `2` or `3`) to render at a
   * high-density "retina" scale, exercising `srcset`/DPR-conditional styles.
   * Note: with `scale: "css"` the captured PNG stays at 1 px per CSS pixel, so
   * baselines remain OS-independent — this only changes what the page renders.
   */
  deviceScaleFactor?: number
  /**
   * Emulate a mobile device: applies the mobile meta viewport and enables touch.
   * Default: `false`. Chromium only — Playwright rejects it for firefox/webkit.
   */
  isMobile?: boolean
  /**
   * Emulate touch events. Default: follows `isMobile`. Set explicitly to add
   * touch to a desktop viewport, or to strip it from a mobile one.
   */
  hasTouch?: boolean
}

export interface ScreenshotTheme {
  /** Label used as a snapshot path segment. */
  name: string
  /**
   * Storybook globals applied via the iframe `globals` query param,
   * e.g. `{ theme: "dark" }` → `&globals=theme:dark`.
   */
  globals: Record<string, string>
}

export interface StorybookScreenshotsConfig {
  /**
   * Command that builds Storybook into `storybookDir`. Omit if you build
   * Storybook yourself before running (then `storybookDir` must already exist).
   */
  buildCommand?: string
  /** Built Storybook directory (must contain `index.json`). Default: `storybook-static`. */
  storybookDir?: string
  /** Directory where baseline PNGs are written and compared. Default: `__screenshots__`. */
  snapshotDir?: string
  /** Browsers to capture. Default: `["chromium"]`. */
  browsers?: ScreenshotBrowser[]
  /** Viewports to capture. Default: `[{ name: "desktop", width: 1280, height: 800 }]`. */
  viewports?: ScreenshotViewport[]
  /** Themes to capture via Storybook globals. Default: `[]` (one capture, no override). */
  themes?: ScreenshotTheme[]
  /** Skip stories carrying any of these Storybook tags. Default: `["!screenshot"]`. */
  skipTags?: string[]
  /** Capture the full scrollable page. Default: `true`. */
  fullPage?: boolean
  /** Allowed differing-pixel ratio before a story fails. Default: `0.01`. */
  maxDiffPixelRatio?: number
  /** Stop the whole run on the first failing story. Default: `true`. */
  failFast?: boolean
  /** Retry count (applied on CI). Default: `2`. */
  retries?: number
  /**
   * Parallel worker processes. A number, or a Playwright percentage string like
   * `"100%"` (use all cores). Default: Playwright's own (half the cores). Pair
   * this with the CLI `--shard` flag to also split work across CI runners.
   */
  workers?: number | string
  /**
   * Storybook module-graph stats used by incremental mode (`--changed` /
   * `affected`). Build Storybook with `--stats-json` to produce it. Default:
   * `<storybookDir>/preview-stats.json`.
   */
  statsFile?: string
  /**
   * Globs (relative to the repo root) that force capturing every story when a
   * matching file changes — inputs that affect rendering globally or that the
   * module graph can't trace (config, `.storybook/**`, lockfiles, tailwind…).
   * Default: a conservative built-in list (see `DEFAULT_GLOBAL_DEPS`).
   */
  globalDeps?: string[]
  /** Port for the built-in static server. Default: `6007`. */
  port?: number
}

/** Identity helper that gives autocomplete and type-checking in the config file. */
export function defineConfig(
  config: StorybookScreenshotsConfig
): StorybookScreenshotsConfig {
  return config
}

/** Config with every default applied and every path made absolute. */
export interface ResolvedConfig {
  buildCommand: string | null
  storybookDir: string
  snapshotDir: string
  browsers: ScreenshotBrowser[]
  viewports: ScreenshotViewport[]
  themes: ScreenshotTheme[]
  skipTags: string[]
  fullPage: boolean
  maxDiffPixelRatio: number
  failFast: boolean
  retries: number
  workers: number | string | null
  statsFile: string
  globalDeps: string[]
  port: number
}

const CONFIG_NAMES = [
  "storybook-screenshots.config.mjs",
  "storybook-screenshots.config.js",
]

/** Walk up from `startDir` looking for a config file. Returns its absolute path. */
export function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) {
        return candidate
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
}

export async function loadConfig(
  configPath: string
): Promise<StorybookScreenshotsConfig> {
  const imported = (await import(pathToFileURL(configPath).href)) as {
    default?: StorybookScreenshotsConfig
  }
  if (!imported.default) {
    throw new Error(
      `${configPath} must \`export default\` a storybook-screenshots config.`
    )
  }
  return imported.default
}

/** Apply defaults and resolve paths relative to `rootDir` (the consumer repo root). */
export function resolveConfig(
  config: StorybookScreenshotsConfig,
  rootDir: string
): ResolvedConfig {
  const toAbs = (p: string) => (isAbsolute(p) ? p : resolve(rootDir, p))
  const storybookDir = toAbs(config.storybookDir ?? "storybook-static")
  return {
    buildCommand: config.buildCommand ?? null,
    storybookDir,
    snapshotDir: toAbs(config.snapshotDir ?? "__screenshots__"),
    browsers: config.browsers ?? ["chromium"],
    viewports: config.viewports ?? [
      { name: "desktop", width: 1280, height: 800 },
    ],
    themes: config.themes ?? [],
    skipTags: config.skipTags ?? ["!screenshot"],
    fullPage: config.fullPage ?? true,
    maxDiffPixelRatio: config.maxDiffPixelRatio ?? 0.01,
    failFast: config.failFast ?? true,
    retries: config.retries ?? 2,
    workers: config.workers ?? null,
    statsFile: toAbs(config.statsFile ?? join(storybookDir, "preview-stats.json")),
    globalDeps: config.globalDeps ?? DEFAULT_GLOBAL_DEPS,
    port: config.port ?? 6007,
  }
}
