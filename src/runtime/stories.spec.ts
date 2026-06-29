import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import type { ScreenshotTheme } from "../config.js"
import { readRuntimeOptions } from "./options.js"

interface StoryEntry {
  id: string
  type: "docs" | "story"
  tags?: string[]
}

interface StorybookIndex {
  entries: Record<string, StoryEntry>
}

const options = readRuntimeOptions()

const index = JSON.parse(
  readFileSync(join(options.storybookDir, "index.json"), "utf8")
) as StorybookIndex

const only = options.only ? new Set(options.only) : null
const stories = Object.values(index.entries).filter(
  (entry) =>
    entry.type === "story" &&
    !entry.tags?.some((tag) => options.skipTags.includes(tag)) &&
    (only ? only.has(entry.id) : true)
)

function globalsParam(theme: ScreenshotTheme | null): string {
  if (!theme) {
    return ""
  }
  const pairs = Object.entries(theme.globals).map(
    ([key, value]) => `${key}:${value}`
  )
  return pairs.length > 0 ? `&globals=${pairs.join(";")}` : ""
}

interface Captured {
  errors: string[]
}

// Wait for Storybook's own "story shown" signal. Portal components (dialog,
// sheet, tooltip rendered open) mount into document.body, leaving
// #storybook-root empty, so checking the root would falsely time out. A real
// render error sets sb-show-errordisplay instead, so this still times out and
// the diagnostics below name the cause.
async function waitForStoryReady(page: Page, captured: Captured) {
  try {
    await page.waitForFunction(
      () => {
        const body = document.body
        return (
          body.classList.contains("sb-show-main") &&
          !body.classList.contains("sb-show-preparing")
        )
      },
      undefined,
      { timeout: 20_000 }
    )
  } catch {
    const diagnostics = await page
      .evaluate(() => {
        const errorText = ["#error-message", "#error-stack", "#sb-resetwrapper"]
          .map((selector) => document.querySelector(selector)?.textContent?.trim())
          .filter(Boolean)
          .join("\n---\n")
        return {
          bodyClass: document.body.className,
          bodyText: document.body.innerText.slice(0, 1500),
          errorText: errorText.slice(0, 4000),
        }
      })
      .catch((error) => ({ evalFailed: String(error) }))
    throw new Error(
      "Story never reached Storybook's shown state (sb-show-main).\n" +
        `diagnostics=${JSON.stringify(diagnostics, null, 2)}\n` +
        `console=${captured.errors.length > 0 ? captured.errors.join("\n  ") : "none"}`
    )
  }
  // Hold for web fonts so text metrics are stable across runs.
  await page.evaluate(() => document.fonts.ready)
}

test.describe("storybook stories", () => {
  for (const story of stories) {
    test(story.id, async ({ page }, testInfo) => {
      const theme = (testInfo.project.metadata as { theme?: ScreenshotTheme })
        .theme ?? null
      const captured: Captured = { errors: [] }
      page.on("console", (message) => {
        const type = message.type()
        if (type === "error" || type === "warning") {
          captured.errors.push(`[${type}] ${message.text()}`)
        }
      })
      page.on("pageerror", (error) =>
        captured.errors.push(`[pageerror] ${error.stack ?? error.message}`)
      )

      await page.goto(
        `/iframe.html?id=${story.id}&viewMode=story${globalsParam(theme)}`,
        { waitUntil: "domcontentloaded" }
      )
      await waitForStoryReady(page, captured)
      await expect(page).toHaveScreenshot(`${story.id}.png`, {
        fullPage: options.fullPage,
      })
    })
  }
})
