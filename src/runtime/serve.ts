import { createReadStream, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, sep } from "node:path"

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
}

export interface StaticServer {
  url: string
  close: () => Promise<void>
}

/** Serve `rootDir` over HTTP on 127.0.0.1:`port`. Static files only, no SPA fallback. */
export function startStaticServer(
  rootDir: string,
  port: number
): Promise<StaticServer> {
  const server = createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/")
    const relative = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "")
    // Resolve inside rootDir and reject path traversal.
    const filePath = normalize(join(rootDir, relative))
    if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
      res.statusCode = 403
      res.end("Forbidden")
      return
    }

    let target = filePath
    try {
      if (statSync(target).isDirectory()) {
        target = join(target, "index.html")
      }
    } catch {
      res.statusCode = 404
      res.end("Not found")
      return
    }

    let size: number
    try {
      size = statSync(target).size
    } catch {
      res.statusCode = 404
      res.end("Not found")
      return
    }

    res.statusCode = 200
    res.setHeader(
      "Content-Type",
      CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream"
    )
    res.setHeader("Content-Length", size)
    res.setHeader("Cache-Control", "no-store")
    createReadStream(target)
      .on("error", () => {
        res.statusCode = 500
        res.end("Read error")
      })
      .pipe(res)
  })

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => {
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}
