import { execSync, spawn } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { type AffectedResult, computeAffected } from "./affected.js"
import { findConfigFile, loadConfig, resolveConfig } from "./config.js"
import { RUNTIME_ENV_KEY, type RuntimeOptions } from "./runtime/options.js"
import { startStaticServer } from "./runtime/serve.js"

export interface RunOptions {
  /** Write changed/missing baselines instead of failing (Playwright --update-snapshots=changed). */
  update?: boolean
  /** Explicit config path. Defaults to the nearest storybook-screenshots.config file. */
  configPath?: string
  /** Playwright shard, e.g. `"2/4"` — capture only this slice of the stories. */
  shard?: string
  /** Skip `buildCommand` and screenshot an already-built `storybookDir`. */
  skipBuild?: boolean
  /** Restrict the run to these story IDs (a precomputed allowlist). */
  only?: string[]
  /**
   * Incremental mode: diff against this git ref, then capture only the stories
   * the change set can affect (reuses committed baselines for the rest).
   */
  changed?: string
}

export async function run(opts: RunOptions = {}): Promise<number> {
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

  if (!existsSync(join(config.storybookDir, "index.json"))) {
    throw new Error(
      `No index.json in ${config.storybookDir}. Build Storybook first (set "buildCommand") or point "storybookDir" at a built Storybook.`
    )
  }

  // Resolve the story allowlist: an explicit --only list, or compute it from a
  // --changed diff. `null` means "every story".
  let only: string[] | null = opts.only ?? null
  if (opts.changed) {
    const result = computeAffected({
      rootDir,
      baseRef: opts.changed,
      statsPath: config.statsFile,
      indexPath: join(config.storybookDir, "index.json"),
      globalDeps: config.globalDeps,
    })
    console.log(`▶ incremental: ${result.reason}`)
    only = result.all ? null : result.storyIds
  }
  if (only && only.length === 0) {
    console.log("✔ no affected stories — nothing to capture.")
    return 0
  }

  const server = await startStaticServer(config.storybookDir, config.port)
  try {
    const runtimeOptions: RuntimeOptions = {
      storybookDir: config.storybookDir,
      snapshotDir: config.snapshotDir,
      baseURL: server.url,
      browsers: config.browsers,
      viewports: config.viewports,
      themes: config.themes,
      skipTags: config.skipTags,
      fullPage: config.fullPage,
      maxDiffPixelRatio: config.maxDiffPixelRatio,
      failFast: config.failFast,
      retries: config.retries,
      workers: config.workers,
      only,
    }
    return await runPlaywright(rootDir, !!opts.update, runtimeOptions, opts.shard)
  } finally {
    await server.close()
  }
}

/**
 * Compute which stories a change set since `baseRef` affects and, optionally,
 * write the allowlist to `out` as `{ all, storyIds }` for a sharded CI run to
 * consume via `--only`.
 */
export async function affected(opts: {
  baseRef: string
  configPath?: string
  out?: string
}): Promise<AffectedResult> {
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
  const result = computeAffected({
    rootDir,
    baseRef: opts.baseRef,
    statsPath: config.statsFile,
    indexPath: join(config.storybookDir, "index.json"),
    globalDeps: config.globalDeps,
  })
  if (opts.out) {
    writeFileSync(
      resolve(rootDir, opts.out),
      `${JSON.stringify({ all: result.all, storyIds: result.storyIds }, null, 2)}\n`
    )
  }
  return result
}

function bundledConfigPath(): string {
  for (const ext of ["js", "ts"]) {
    const candidate = fileURLToPath(
      new URL(`./runtime/playwright.config.${ext}`, import.meta.url)
    )
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error("Bundled Playwright config not found — is the package built?")
}

function runPlaywright(
  rootDir: string,
  update: boolean,
  runtimeOptions: RuntimeOptions,
  shard?: string
): Promise<number> {
  const args = ["test", "--config", bundledConfigPath()]
  if (update) {
    // `changed`, not `all`: `all` compares baselines byte-for-byte and rewrites
    // on any difference, so non-visual PNG-encoding drift churns baselines every
    // run. `changed` compares pixels (within maxDiffPixelRatio) and only rewrites
    // real changes — while still creating missing baselines and passing on write.
    args.push("--update-snapshots=changed")
  }
  if (shard) {
    args.push(`--shard=${shard}`)
  }

  // Prefer the consumer's locally installed Playwright; fall back to npx.
  const localBin = join(rootDir, "node_modules", ".bin", "playwright")
  const command = existsSync(localBin) ? localBin : "npx"
  const commandArgs = existsSync(localBin)
    ? args
    : ["--no-install", "playwright", ...args]

  return new Promise((resolvePromise) => {
    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        [RUNTIME_ENV_KEY]: JSON.stringify(runtimeOptions),
      },
    })
    child.on("exit", (code) => resolvePromise(code ?? 1))
    child.on("error", (error) => {
      console.error(error)
      resolvePromise(1)
    })
  })
}
