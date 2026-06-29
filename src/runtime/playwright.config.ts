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

// One Playwright project per browser × viewport × theme. The project name
// becomes the snapshot folder, so every combination gets its own baseline.
const themeList: (ScreenshotTheme | null)[] =
  options.themes.length > 0 ? options.themes : [null]

const projects = options.browsers.flatMap((browser) =>
  options.viewports.flatMap((viewport) =>
    themeList.map((theme) => {
      const segments = [browser, viewport.name]
      if (theme) {
        segments.push(theme.name)
      }
      const device = devices[DEVICE_BY_BROWSER[browser]] ?? {}
      return {
        name: segments.join("-"),
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
        metadata: { theme },
      }
    })
  )
)

export default defineConfig({
  testDir: runtimeDir,
  testMatch: /stories\.spec\.(js|ts)$/,
  // Absolute template so baselines land in the consumer repo, not node_modules.
  snapshotPathTemplate: `${options.snapshotDir}/{projectName}/{arg}{ext}`,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  maxFailures: options.failFast ? 1 : undefined,
  retries: process.env.CI ? options.retries : 0,
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
