import type {
  ScreenshotBrowser,
  ScreenshotTheme,
  ScreenshotViewport,
} from "../config.js"

/** Resolved options the CLI hands to the Playwright runtime via an env var. */
export interface RuntimeOptions {
  storybookDir: string
  snapshotDir: string
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
