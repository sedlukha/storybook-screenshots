import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { chromium, firefox, webkit } from "@playwright/test"
import type { ScreenshotBrowser } from "./config.js"
import { findConfigFile, loadConfig, resolveConfig } from "./config.js"
import { startStaticServer } from "./runtime/serve.js"

export interface SmokeOptions {
  /** Explicit config path. Defaults to the nearest storybook-screenshots.config file. */
  configPath?: string
  /** Skip `buildCommand` and use an already-built `storybookDir`. */
  skipBuild?: boolean
  /** Restrict the check to these story IDs. */
  only?: string[]
  /** Milliseconds one story may take to load. Default: `30000`. */
  timeout?: number
}

/** One story whose module failed to load in the built Storybook. */
export interface SmokeFailure {
  storyId: string
  /** Story source file, as the index records it. */
  importPath?: string
  message: string
}

export interface SmokeResult {
  /** Stories the run tried to load. */
  total: number
  failures: SmokeFailure[]
}

interface StoryEntry {
  id: string
  type: "docs" | "story"
  importPath?: string
}

interface StorybookIndex {
  entries: Record<string, StoryEntry>
}

const BROWSERS = { chromium, firefox, webkit }

const DEFAULT_TIMEOUT = 30_000

/** How long the preview may take to boot before the run gives up. */
const BOOT_TIMEOUT = 30_000

/**
 * Load every story module from a built Storybook and report the ones that
 * throw. This is a smoke check, not a render pass: it opens ONE page and asks
 * Storybook's own preview to import each story, so nothing is rendered and no
 * baseline is read or written.
 *
 * The gap it fills: a Storybook build is silent about runtime errors, and a
 * story test runner (vitest, for example) renders from its own module graph,
 * not from the built files. So a server-only import that reaches the browser
 * bundle passes both, and only fails later, in whatever job opens the build.
 * Here it fails in seconds.
 *
 * Every story in the index is loaded, `skipTags` included: a story that is not
 * worth a screenshot must still not break the bundle.
 */
export async function smoke(opts: SmokeOptions = {}): Promise<SmokeResult> {
  const cwd = process.cwd()
  const configPath = opts.configPath
    ? resolve(cwd, opts.configPath)
    : findConfigFile(cwd)
  if (!configPath) {
    throw new Error(
      "No storybook-screenshots.config.mjs (or .js) found in this directory or any parent."
    )
  }

  const rootDir = dirname(configPath)
  const config = resolveConfig(await loadConfig(configPath), rootDir)

  if (config.buildCommand && !opts.skipBuild) {
    console.log(`▶ ${config.buildCommand}`)
    execSync(config.buildCommand, { cwd: rootDir, stdio: "inherit" })
  }

  const indexPath = join(config.storybookDir, "index.json")
  if (!existsSync(indexPath)) {
    throw new Error(
      `No index.json in ${config.storybookDir}. Build Storybook first (set "buildCommand") or point "storybookDir" at a built Storybook.`
    )
  }

  const index = JSON.parse(readFileSync(indexPath, "utf8")) as StorybookIndex
  const only = opts.only ? new Set(opts.only) : null
  const stories = Object.values(index.entries).filter(
    (entry) => entry.type === "story" && (only ? only.has(entry.id) : true)
  )
  if (stories.length === 0) {
    console.log("✔ no stories to load.")
    return { total: 0, failures: [] }
  }

  const timeout = opts.timeout ?? DEFAULT_TIMEOUT
  const browserName: ScreenshotBrowser = config.browsers[0] ?? "chromium"
  const server = await startStaticServer(config.storybookDir, config.port)
  const browser = await BROWSERS[browserName].launch()
  try {
    return await loadEveryStory({
      browser,
      baseURL: server.url,
      stories,
      timeout,
    })
  } finally {
    await browser.close()
    await server.close()
  }
}

type Browser = Awaited<ReturnType<(typeof chromium)["launch"]>>

/**
 * The whole check runs in one page. Storybook keeps an ES module registry per
 * page, so a story file is fetched and evaluated once no matter how many
 * stories it holds — the reason this costs seconds and a render pass costs
 * minutes.
 */
async function loadEveryStory(args: {
  browser: Browser
  baseURL: string
  stories: StoryEntry[]
  timeout: number
}): Promise<SmokeResult> {
  const { browser, baseURL, stories, timeout } = args
  const page = await browser.newPage()
  // Errors the page reports on its own. A module that throws while the preview
  // boots never reaches the loop below, so without these the run would only be
  // able to say "the preview never appeared".
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text())
    }
  })

  // No story id, so Storybook boots the preview and shows its "no story
  // selected" screen. Nothing renders.
  await page.goto(`${baseURL}/iframe.html`, { waitUntil: "domcontentloaded" })
  try {
    await page.waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __STORYBOOK_PREVIEW__?: unknown })
            .__STORYBOOK_PREVIEW__
        ),
      undefined,
      { timeout: BOOT_TIMEOUT }
    )
  } catch {
    throw new Error(
      "Storybook's preview never booted in the built files.\n" +
        `page errors:\n  ${pageErrors.join("\n  ") || "none"}`
    )
  }

  const failures = await page.evaluate(
    async (input: {
      stories: { id: string; importPath?: string }[]
      timeout: number
    }) => {
      const preview = (
        window as unknown as {
          __STORYBOOK_PREVIEW__: {
            loadStory?: (opts: { storyId: string }) => Promise<unknown>
            importFn?: (path: string) => Promise<unknown>
          }
        }
      ).__STORYBOOK_PREVIEW__

      const load = (story: { id: string; importPath?: string }) => {
        if (typeof preview.loadStory === "function") {
          return preview.loadStory({ storyId: story.id })
        }
        // Older previews expose no loadStory. Importing the file catches the
        // same class of error, it just cannot see a broken meta or decorator.
        if (typeof preview.importFn === "function" && story.importPath) {
          return preview.importFn(story.importPath)
        }
        return Promise.reject(
          new Error(
            "This Storybook preview exposes neither loadStory nor importFn."
          )
        )
      }

      const out: { storyId: string; importPath?: string; message: string }[] = []
      for (const story of input.stories) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            load(story),
            new Promise((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error(`still loading after ${input.timeout} ms`)),
                input.timeout
              )
            }),
          ])
        } catch (error) {
          out.push({
            storyId: story.id,
            importPath: story.importPath,
            message: error instanceof Error ? error.message : String(error),
          })
        } finally {
          clearTimeout(timer)
        }
      }
      return out
    },
    {
      stories: stories.map((story) => ({
        id: story.id,
        importPath: story.importPath,
      })),
      timeout,
    }
  )

  await page.close()
  return { total: stories.length, failures }
}

/** Print the result the way the CLI reports it, and answer with an exit code. */
export function reportSmoke(result: SmokeResult): number {
  const counted = `${result.total} ${result.total === 1 ? "story" : "stories"}`
  if (result.failures.length === 0) {
    console.log(`✔ ${counted} loaded from the built Storybook.`)
    return 0
  }
  console.error(
    `✖ ${result.failures.length} of ${counted} failed to load from the built Storybook:\n`
  )
  for (const failure of result.failures) {
    const where = failure.importPath ? `  ${failure.importPath}` : ""
    console.error(`  ${failure.storyId}${where}`)
    console.error(`    ${failure.message}\n`)
  }
  console.error(
    "These stories build without a word and break in the browser. A common cause\n" +
      "is server-only code that reached the browser bundle."
  )
  return 1
}
