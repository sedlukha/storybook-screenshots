#!/usr/bin/env node
import { run } from "../run.js"

const argv = process.argv.slice(2)

function flagValue(...names: string[]): string | undefined {
  const index = argv.findIndex((arg) => names.includes(arg))
  return index === -1 ? undefined : argv[index + 1]
}

const update = argv.includes("--update") || argv.includes("-u")
const configPath = flagValue("--config", "-c")
// Split the work across CI runners: `--shard 2/4` captures the 2nd of 4 slices.
const shard = flagValue("--shard")
// Skip the build step and screenshot a Storybook built elsewhere (e.g. a shared
// CI artifact reused by every shard). `storybookDir` must already exist.
const skipBuild = argv.includes("--no-build")

run({ configPath, shard, skipBuild, update })
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
