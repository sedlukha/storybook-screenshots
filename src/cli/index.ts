#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { affected, run } from "../run.js"

const argv = process.argv.slice(2)

function flagValue(...names: string[]): string | undefined {
  const index = argv.findIndex((arg) => names.includes(arg))
  return index === -1 ? undefined : argv[index + 1]
}

/**
 * Resolve a `--only` value: a path to an `affected` JSON file (`{ all, storyIds }`),
 * or a comma-separated list of story IDs. A file marked `all: true` means "no
 * restriction" (run everything).
 */
function resolveOnly(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined
  }
  if (existsSync(value)) {
    const parsed = JSON.parse(readFileSync(value, "utf8")) as {
      all?: boolean
      storyIds?: string[]
    }
    return parsed.all ? undefined : (parsed.storyIds ?? [])
  }
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
}

const configPath = flagValue("--config", "-c")

// `affected` subcommand: compute the changed-story allowlist and print/write it.
if (argv[0] === "affected") {
  const baseRef = flagValue("--base") ?? "origin/master"
  const out = flagValue("--out")
  affected({ baseRef, configPath, out })
    .then((result) => {
      console.log(
        result.all
          ? `all stories (${result.reason})`
          : `${result.storyIds.length} affected stories (${result.reason})`
      )
      process.exit(0)
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
} else {
  const update = argv.includes("--update") || argv.includes("-u")
  // Split the work across CI runners: `--shard 2/4` captures the 2nd of 4 slices.
  const shard = flagValue("--shard")
  // Skip the build and screenshot a Storybook built elsewhere (e.g. a shared CI
  // artifact reused by every shard). `storybookDir` must already exist.
  const skipBuild = argv.includes("--no-build")
  // Incremental: diff against this ref and capture only affected stories.
  const changed = flagValue("--changed")
  // Run a precomputed allowlist (file or comma list) — pairs with `affected`.
  const only = resolveOnly(flagValue("--only"))

  run({ changed, configPath, only, shard, skipBuild, update })
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
}
