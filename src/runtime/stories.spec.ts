import { readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import type { ScreenshotTheme } from "../config.js"
import { readRuntimeOptions } from "./options.js"

interface StoryEntry {
  id: string
  type: "docs" | "story"
  tags?: string[]
  /** Story source file, relative to the repo root (e.g. `./button/button.stories.tsx`). */
  importPath?: string
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

// Render phases that mean the play function has finished (or failed). Once the
// render reaches one of these the DOM reflects the post-interaction state.
const PLAY_DONE_PHASES = [
  "played",
  "completing",
  "completed",
  "afterEach",
  "finished",
  "errored",
  "aborted",
]

// Wait for Storybook's play function to finish before capturing, so interactive
// stories (a play opening a dialog, a hover revealing a tooltip) are shot in
// their settled state — not the initial pre-interaction render. Best-effort: if
// the render never reports a terminal phase, capture anyway rather than fail.
async function waitForPlayFinished(page: Page) {
  await page
    .waitForFunction(
      (donePhases: string[]) => {
        const preview = (
          window as unknown as {
            __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } }
          }
        ).__STORYBOOK_PREVIEW__
        if (!preview) {
          return true
        }
        const render = preview.currentRender
        if (!render) {
          return false
        }
        return render.phase === undefined || donePhases.includes(render.phase)
      },
      PLAY_DONE_PHASES,
      { timeout: 15_000 }
    )
    .catch(() => {
      // Captured anyway — a story that never settles still yields a baseline.
    })
}

// Per-story pause before capturing, for stories that settle asynchronously
// (a play function opening a dialog, a delayed reveal…). Reads Storybook
// parameters at runtime: `screenshot.delay` (this tool) or `chromatic.delay`
// (Chromatic-compatible), in milliseconds. Returns 0 when unset/unavailable.
async function readDelayMs(page: Page, storyId: string): Promise<number> {
  const delay = await page
    .evaluate(async (id) => {
      const preview = (
        window as unknown as {
          __STORYBOOK_PREVIEW__?: {
            loadStory?: (opts: { storyId: string }) => Promise<{
              parameters?: {
                screenshot?: { delay?: number }
                chromatic?: { delay?: number }
              }
            }>
          }
        }
      ).__STORYBOOK_PREVIEW__
      const story = await preview?.loadStory?.({ storyId: id })
      const params = story?.parameters
      const value = params?.screenshot?.delay ?? params?.chromatic?.delay
      return typeof value === "number" ? value : 0
    }, storyId)
    .catch(() => 0)
  return delay > 0 ? delay : 0
}

test.describe("storybook stories", () => {
  for (const story of stories) {
    test(story.id, async ({ page }, testInfo) => {
      const meta = testInfo.project.metadata as {
        theme?: ScreenshotTheme
        snapshotFolder: string
        snapshotSuffix: string
      }
      const theme = meta.theme ?? null
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
      await waitForPlayFinished(page)
      const delayMs = await readDelayMs(page, story.id)
      if (delayMs > 0) {
        await page.waitForTimeout(delayMs)
      }
      // <folder>/<story>[-<theme>].png, optionally co-located under the story's
      // own source directory (…/__screenshots__/…) instead of the snapshotDir.
      const baseName = `${meta.snapshotFolder}/${story.id}${meta.snapshotSuffix}.png`
      const snapshotName =
        options.colocate && story.importPath
          ? `${posix.dirname(story.importPath.replace(/^\.\//, ""))}/__screenshots__/${baseName}`
          : baseName
      await expect(page).toHaveScreenshot(snapshotName, {
        fullPage: options.fullPage,
      })
    })
  }
})
