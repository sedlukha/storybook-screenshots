import type {
  PathSegment,
  ScreenshotBrowser,
  ScreenshotTheme,
  ScreenshotViewport,
} from "../config.js"

/** Resolved options the CLI hands to the Playwright runtime via an env var. */
export interface RuntimeOptions {
  storybookDir: string
  snapshotDir: string
  /** Repo root — base for co-located baseline paths. */
  rootDir: string
  /** Place baselines next to each story's source file. */
  colocate: boolean
  pathSegments: PathSegment[]
  nestedFolders: boolean
  baseURL: string
  browsers: ScreenshotBrowser[]
  viewports: ScreenshotViewport[]
  themes: ScreenshotTheme[]
  skipTags: string[]
  fullPage: boolean
  maxDiffPixelRatio: number
  failFast: boolean
  retries: number
  workers: number | string | null
  /** Restrict the run to these story IDs (incremental mode). `null` = all. */
  only: string[] | null
}

export const RUNTIME_ENV_KEY = "STORYBOOK_SCREENSHOTS_OPTIONS"

export function readRuntimeOptions(): RuntimeOptions {
  const raw = process.env[RUNTIME_ENV_KEY]
  if (!raw) {
    throw new Error(
      `${RUNTIME_ENV_KEY} is not set. Run the bundled config through the storybook-screenshots CLI, not 'playwright test' directly.`
    )
  }
  return JSON.parse(raw) as RuntimeOptions
}
