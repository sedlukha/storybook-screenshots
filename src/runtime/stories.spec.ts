import { readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { errors, expect, type Page, test } from "@playwright/test"
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
// their settled state. A play still running at `timeout` fails the story, and
// so does a play that threw: either capture would write a broken baseline.
async function waitForPlayFinished(page: Page, timeout: number) {
  try {
    await page.waitForFunction(
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
      { timeout }
    )
  } catch (error) {
    // Any other error, such as a page closed by a failed neighbour, is not slowness.
    if (!(error instanceof errors.TimeoutError)) {
      throw error
    }
    const { phase } = await readPlayEnd(page)
    throw new Error(
      `The play function did not finish in ${timeout} ms (render phase: ${phase}). ` +
        "The story was not captured. Raise the limit for this story with " +
        "`parameters.screenshot.playTimeout`, or for all stories with " +
        "`playTimeout` in the config file."
    )
  }
  const end = await readPlayEnd(page)
  if (end.playError !== null) {
    throw new Error(
      `The play function failed: ${end.playError}\nThe story was not captured.`
    )
  }
}

/** The page global that holds the message of a play function that threw. */
const PLAY_ERROR_KEY = "__storybookScreenshotsPlayError__"

// A play that threw can still end in `finished`: with
// `throwPlayFunctionExceptions: false` Storybook only logs it. Its channel event
// is the one sure signal, so this runs in the page before Storybook does.
function watchPlayErrors(key: string) {
  type Channel = {
    on?: (event: string, listener: (error?: { message?: string }) => void) => void
  }
  let channel: Channel | undefined
  // Storybook sets this global with a plain assignment, so the setter sees it.
  Object.defineProperty(window, "__STORYBOOK_ADDONS_CHANNEL__", {
    configurable: true,
    get: () => channel,
    set: (value: Channel) => {
      channel = value
      value?.on?.("playFunctionThrewException", (error) => {
        Object.assign(window, { [key]: error?.message ?? "no message" })
      })
    },
  })
}

// The render phase, and the message of a play that threw, as the page has them.
async function readPlayEnd(page: Page) {
  return await page
    .evaluate((key) => {
      const win = window as unknown as Record<string, unknown> & {
        __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } }
      }
      const playError = win[key]
      return {
        phase: win.__STORYBOOK_PREVIEW__?.currentRender?.phase ?? "none",
        playError: typeof playError === "string" ? playError : null,
      }
    }, PLAY_ERROR_KEY)
    .catch(() => ({ phase: "unknown", playError: null }))
}

// Make the viewport as tall as the page, so a plain capture holds all of it.
// The width stays, so text wraps the same way. A `vh` length grows with it.
// A page wider than the viewport is left alone, because a plain capture would
// cut its right side. Returns true when the viewport now holds the page.
async function growToPageHeight(page: Page): Promise<boolean> {
  const size = page.viewportSize()
  const scroll = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
  }))
  if (!size || scroll.width > size.width) {
    return false
  }
  if (scroll.height > size.height) {
    await page.setViewportSize({ height: scroll.height, width: size.width })
  }
  return true
}

interface StoryScreenshotParams {
  /** Pause before capturing (ms). */
  delay: number
  /** CSS selectors to mask (hide) before capturing — for dynamic content. */
  mask: string[]
  /** Per-story override of `fullPage`. */
  fullPage?: boolean
  /** Per-story override of `maxDiffPixelRatio`. */
  maxDiffPixelRatio?: number
  /** Per-story override of `threshold`. */
  threshold?: number
  /** Restrict this story to these viewport names. */
  viewports?: string[]
  /** Per-story override of `playTimeout`. */
  playTimeout?: number
}

const DEFAULT_PARAMS: StoryScreenshotParams = { delay: 0, mask: [] }

// Read per-story capture options from Storybook `parameters.screenshot` (with
// `chromatic.delay` honored for the delay), at runtime via the preview API.
async function readScreenshotParams(
  page: Page,
  storyId: string
): Promise<StoryScreenshotParams> {
  return await page
    .evaluate(async (id) => {
      const preview = (
        window as unknown as {
          __STORYBOOK_PREVIEW__?: {
            loadStory?: (opts: { storyId: string }) => Promise<{
              parameters?: {
                screenshot?: {
                  delay?: number
                  mask?: string[]
                  fullPage?: boolean
                  maxDiffPixelRatio?: number
                  threshold?: number
                  viewports?: string[]
                  playTimeout?: number
                }
                chromatic?: { delay?: number }
              }
            }>
          }
        }
      ).__STORYBOOK_PREVIEW__
      const params = (await preview?.loadStory?.({ storyId: id }))?.parameters
      const shot = params?.screenshot ?? {}
      const delay = shot.delay ?? params?.chromatic?.delay
      return {
        delay: typeof delay === "number" ? delay : 0,
        mask: Array.isArray(shot.mask) ? shot.mask : [],
        fullPage: typeof shot.fullPage === "boolean" ? shot.fullPage : undefined,
        maxDiffPixelRatio:
          typeof shot.maxDiffPixelRatio === "number"
            ? shot.maxDiffPixelRatio
            : undefined,
        threshold:
          typeof shot.threshold === "number" ? shot.threshold : undefined,
        viewports: Array.isArray(shot.viewports) ? shot.viewports : undefined,
        playTimeout:
          typeof shot.playTimeout === "number" ? shot.playTimeout : undefined,
      } satisfies StoryScreenshotParams
    }, storyId)
    .catch(() => DEFAULT_PARAMS)
}

test.describe("storybook stories", () => {
  for (const story of stories) {
    test(story.id, async ({ page }, testInfo) => {
      const meta = testInfo.project.metadata as {
        theme?: ScreenshotTheme
        snapshotFolder: string
        snapshotSuffix: string
        viewportName: string
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

      await page.addInitScript(watchPlayErrors, PLAY_ERROR_KEY)
      await page.goto(
        `/iframe.html?id=${story.id}&viewMode=story${globalsParam(theme)}`,
        { waitUntil: "domcontentloaded" }
      )
      await waitForStoryReady(page, captured)
      // Read before the play wait: the wait takes its length from here. The
      // read only finds the story. It does not touch a running play.
      const params = await readScreenshotParams(page, story.id)
      // Per-story viewport allowlist: skip this story in unlisted viewports.
      test.skip(
        params.viewports !== undefined &&
          !params.viewports.includes(meta.viewportName),
        `story limited to viewports: ${params.viewports?.join(", ")}`
      )
      const playTimeout = params.playTimeout ?? options.playTimeout
      // The play wait has its own limit, so the test limit must not end it early.
      testInfo.setTimeout(testInfo.timeout + playTimeout)
      await waitForPlayFinished(page, playTimeout)
      if (params.delay > 0) {
        await page.waitForTimeout(params.delay)
      }
      // <folder>/<story>[-<theme>].png, optionally co-located under the story's
      // own source directory (…/__screenshots__/…) instead of the snapshotDir.
      const baseName = `${meta.snapshotFolder}/${story.id}${meta.snapshotSuffix}.png`
      const snapshotName =
        options.colocate && story.importPath
          ? `${posix.dirname(story.importPath.replace(/^\.\//, ""))}/__screenshots__/${baseName}`
          : baseName
      // Pass the path as segments, not a joined string. Playwright runs
      // `sanitizeForFilePath` on a string name, which turns every `/` (and `_`)
      // into `-` — flattening the nested layout into one file at the repo root.
      // An array is joined verbatim, so the `__stories__/…/__screenshots__/…`
      // folders survive.
      const fullPage = params.fullPage ?? options.fullPage
      // A full-page capture in Chromium turns touch emulation off for good.
      // The page then matches `any-pointer: fine` and `hover: hover`. So on a
      // touch viewport, grow the viewport to the page height and take a plain
      // capture instead. A page wider than the viewport keeps the full-page
      // capture.
      const grown =
        fullPage &&
        testInfo.project.use.hasTouch === true &&
        (await growToPageHeight(page))
      await expect(page).toHaveScreenshot(snapshotName.split("/"), {
        fullPage: fullPage && !grown,
        ...(params.mask.length > 0
          ? { mask: params.mask.map((selector) => page.locator(selector)) }
          : {}),
        ...(params.maxDiffPixelRatio !== undefined
          ? { maxDiffPixelRatio: params.maxDiffPixelRatio }
          : {}),
        ...(params.threshold !== undefined
          ? { threshold: params.threshold }
          : {}),
      })
    })
  }
})
