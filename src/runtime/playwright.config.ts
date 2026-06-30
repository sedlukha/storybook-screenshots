import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"
import type { ScreenshotBrowser, ScreenshotTheme } from "../config.js"
import { readRuntimeOptions } from "./options.js"

const options = readRuntimeOptions()

const DEVICE_BY_BROWSER: Record<ScreenshotBrowser, string> = {
  chromium: "Desktop Chrome",
  firefox: "Desktop Firefox",
  webkit: "Desktop Safari",
}

const runtimeDir = fileURLToPath(new URL(".", import.meta.url))

// One Playwright project per browser × viewport × theme. Each project carries
// the snapshot folder + filename suffix for its baselines (see below).
const themeList: (ScreenshotTheme | null)[] =
  options.themes.length > 0 ? options.themes : [null]

const projects = options.browsers.flatMap((browser) =>
  options.viewports.flatMap((viewport) =>
    themeList.map((theme) => {
      // Folder = browser-viewport[-group|-name]; a grouped theme's name moves to
      // a filename suffix so its variants (light/dark) share one folder. The
      // project name keeps group AND name so it stays unique for Playwright.
      const folderSegments = [browser, viewport.name]
      const nameSegments = [browser, viewport.name]
      let snapshotSuffix = ""
      if (theme) {
        if (theme.group) {
          folderSegments.push(theme.group)
          nameSegments.push(theme.group, theme.name)
          snapshotSuffix = `-${theme.name}`
        } else {
          folderSegments.push(theme.name)
          nameSegments.push(theme.name)
        }
      }
      const device = devices[DEVICE_BY_BROWSER[browser]] ?? {}
      return {
        name: nameSegments.join("-"),
        use: {
          ...device,
          viewport: { width: viewport.width, height: viewport.height },
          // Per-viewport device emulation. Only spread keys the config set, so
          // the browser device profile's defaults stay intact otherwise.
          ...(viewport.deviceScaleFactor !== undefined
            ? { deviceScaleFactor: viewport.deviceScaleFactor }
            : {}),
          ...(viewport.isMobile !== undefined
            ? { isMobile: viewport.isMobile }
            : {}),
          ...(viewport.hasTouch !== undefined
            ? { hasTouch: viewport.hasTouch }
            : {}),
        },
        metadata: {
          theme,
          snapshotFolder: folderSegments.join("-"),
          snapshotSuffix,
        },
      }
    })
  )
)

export default defineConfig({
  testDir: runtimeDir,
  testMatch: /stories\.spec\.(js|ts)$/,
  // Absolute template so baselines land in the consumer repo, not node_modules.
  // {arg} carries the full folder/file path the spec builds from project metadata
  // (so grouped themes can share a folder), not the unique project name. In
  // colocate mode the base is the repo root and {arg} starts from each story's
  // source directory.
  snapshotPathTemplate: `${options.colocate ? options.rootDir : options.snapshotDir}/{arg}{ext}`,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  maxFailures: options.failFast ? 1 : undefined,
  retries: process.env.CI ? options.retries : 0,
  ...(options.workers != null ? { workers: options.workers } : {}),
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: options.maxDiffPixelRatio,
      scale: "css",
    },
  },
  use: {
    baseURL: options.baseURL,
  },
  projects,
})
