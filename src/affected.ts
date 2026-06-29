import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

/** Outcome of working out which stories a change set can affect. */
export interface AffectedResult {
  /** When true, every story is affected — capture them all. */
  all: boolean
  /** Story IDs to capture. Meaningful only when `all` is false. */
  storyIds: string[]
  /** Human-readable explanation of the decision (for logs). */
  reason: string
}

export interface ComputeAffectedOptions {
  /** Git repo root the diff runs in. */
  rootDir: string
  /** Base ref to diff against, e.g. `origin/master`. */
  baseRef: string
  /** Path to the Storybook module-graph stats (`preview-stats.json`). */
  statsPath: string
  /** Path to the Storybook `index.json`. */
  indexPath: string
  /**
   * Globs that force a full run when any matching file changes — inputs that
   * affect rendering globally or that the graph cannot trace.
   */
  globalDeps: string[]
}

interface StatsModule {
  name?: string
  id?: string
  reasons?: { moduleName?: string }[]
}

interface IndexEntry {
  id: string
  type: string
  importPath?: string
}

/** Inputs that change how everything renders, or that the graph can't trace. */
export const DEFAULT_GLOBAL_DEPS = [
  "**/storybook-screenshots.config.*",
  ".storybook/**",
  "**/package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "**/tailwind.config.*",
  "**/postcss.config.*",
]

/** Normalize a module/file path: drop a leading `./` and any `?query` suffix. */
function norm(path: string): string {
  return path.replace(/\?.*$/, "").replace(/^\.\//, "")
}

function globToRegExp(glob: string): RegExp {
  let re = ""
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?"
        i += 3
      } else {
        re += ".*"
        i += 2
      }
    } else if (c === "*") {
      re += "[^/]*"
      i += 1
    } else if (c === "?") {
      re += "[^/]"
      i += 1
    } else {
      if ("\\^$+.()|{}[]".includes(c as string)) {
        re += "\\"
      }
      re += c
      i += 1
    }
  }
  return new RegExp(`^${re}$`)
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(path))
}

/**
 * Work out which stories a change set since `baseRef` can affect, by reverse-
 * tracing the Storybook module graph. Errs toward `all: true` whenever the
 * answer is uncertain (no stats, git failure, a global dependency changed), so
 * a real visual change is never silently skipped.
 */
export function computeAffected(opts: ComputeAffectedOptions): AffectedResult {
  let changed: string[]
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", `${opts.baseRef}...HEAD`],
      { cwd: opts.rootDir, encoding: "utf8" }
    )
    changed = out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  } catch (error) {
    return {
      all: true,
      storyIds: [],
      reason: `git diff against ${opts.baseRef} failed: ${String(error)}`,
    }
  }

  if (changed.length === 0) {
    return { all: false, storyIds: [], reason: "no files changed" }
  }

  const globalPatterns = opts.globalDeps.map(globToRegExp)
  const globalHit = changed.find((file) => matchesAny(file, globalPatterns))
  if (globalHit) {
    return {
      all: true,
      storyIds: [],
      reason: `global dependency changed: ${globalHit}`,
    }
  }

  if (!existsSync(opts.statsPath)) {
    return {
      all: true,
      storyIds: [],
      reason: `no stats file at ${opts.statsPath} (build with --stats-json)`,
    }
  }

  const stats = JSON.parse(readFileSync(opts.statsPath, "utf8")) as {
    modules: StatsModule[]
  }
  const nodeNames = new Set<string>()
  // module name -> the modules that import it (graph reverse edges).
  const importers = new Map<string, string[]>()
  for (const mod of stats.modules) {
    const name = norm(mod.name ?? mod.id ?? "")
    if (!name) {
      continue
    }
    nodeNames.add(name)
    importers.set(
      name,
      (mod.reasons ?? [])
        .map((reason) => norm(reason.moduleName ?? ""))
        .filter(Boolean)
    )
  }

  const index = JSON.parse(readFileSync(opts.indexPath, "utf8")) as {
    entries: Record<string, IndexEntry>
  }
  // story-file module name -> story IDs declared in it.
  const storyFileToIds = new Map<string, string[]>()
  for (const entry of Object.values(index.entries)) {
    if (entry.type !== "story" || !entry.importPath) {
      continue
    }
    const file = norm(entry.importPath)
    const ids = storyFileToIds.get(file) ?? []
    ids.push(entry.id)
    storyFileToIds.set(file, ids)
  }

  // Only changed files that are graph nodes can affect anything. A changed file
  // absent from the graph is imported by no story (global ones were caught
  // above), so it cannot move a pixel.
  const changedNodes = changed.map(norm).filter((name) => nodeNames.has(name))

  const affectedStoryFiles = new Set<string>()
  const seen = new Set<string>()
  const stack: string[] = []
  for (const node of changedNodes) {
    stack.push(node)
    if (storyFileToIds.has(node)) {
      affectedStoryFiles.add(node)
    }
  }
  while (stack.length > 0) {
    const node = stack.pop() as string
    if (seen.has(node)) {
      continue
    }
    seen.add(node)
    for (const importer of importers.get(node) ?? []) {
      if (storyFileToIds.has(importer)) {
        affectedStoryFiles.add(importer)
      }
      if (!seen.has(importer)) {
        stack.push(importer)
      }
    }
  }

  const storyIds = [
    ...new Set(
      [...affectedStoryFiles].flatMap((file) => storyFileToIds.get(file) ?? [])
    ),
  ].sort()

  return {
    all: false,
    storyIds,
    reason: `${changedNodes.length} changed module(s) → ${storyIds.length} affected stor${storyIds.length === 1 ? "y" : "ies"}`,
  }
}
