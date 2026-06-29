// Make the compiled CLI executable so `storybook-screenshots` runs from the bin
// shim. tsc does not preserve the +x bit.
import { chmodSync, existsSync } from "node:fs"

const cliPath = new URL("../dist/cli/index.js", import.meta.url)

if (existsSync(cliPath)) {
  chmodSync(cliPath, 0o755)
}
