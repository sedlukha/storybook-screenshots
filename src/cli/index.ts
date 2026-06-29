#!/usr/bin/env node
import { run } from "../run.js"

const argv = process.argv.slice(2)
const update = argv.includes("--update") || argv.includes("-u")
const configFlag = argv.findIndex((arg) => arg === "--config" || arg === "-c")
const configPath = configFlag === -1 ? undefined : argv[configFlag + 1]

run({ configPath, update })
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
