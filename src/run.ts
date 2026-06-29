import { execSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { findConfigFile, loadConfig, resolveConfig } from "./config.js"
import { RUNTIME_ENV_KEY, type RuntimeOptions } from "./runtime/options.js"
import { startStaticServer } from "./runtime/serve.js"

export interface RunOptions {
  /** Write/overwrite baselines instead of comparing (Playwright --update-snapshots=all). */
  update?: boolean
  /** Explicit config path. Defaults to the nearest storybook-screenshots.config file. */
  configPath?: string
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

  if (config.buildCommand) {
    console.log(`▶ ${config.buildCommand}`)
    execSync(config.buildCommand, { cwd: rootDir, stdio: "inherit" })
  }

  if (!existsSync(join(config.storybookDir, "index.json"))) {
    throw new Error(
      `No index.json in ${config.storybookDir}. Build Storybook first (set "buildCommand") or point "storybookDir" at a built Storybook.`
    )
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
    }
    return await runPlaywright(rootDir, !!opts.update, runtimeOptions)
  } finally {
    await server.close()
  }
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
  runtimeOptions: RuntimeOptions
): Promise<number> {
  const args = ["test", "--config", bundledConfigPath()]
  if (update) {
    args.push("--update-snapshots=all")
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
