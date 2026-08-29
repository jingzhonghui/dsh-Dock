import { createServer, type Server } from 'node:http'

export interface FakeServer {
  server: Server
  url: string
  port: number
}

/** A minimal HTTP server that mimics the DSH web root page markers. */
export function createFakeDshServer(port = 0): Promise<FakeServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          '<!doctype html><html><head><title>DeepSeek Harness</title></head>' +
            '<body><script>window.__ModuleLoader__={mode:"queue"};window.__DSH_BOOT__={}</script>' +
            '<div id="app"></div></body></html>'
        )
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
      }
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const p = (server.address() as { port: number }).port
      resolve({ server, url: `http://127.0.0.1:${p}`, port: p })
    })
  })
}

/** A plain HTML server that is reachable but NOT the DSH UI. */
export function createPlainServer(port = 0): Promise<FakeServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body><h1>hello</h1></body></html>')
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const p = (server.address() as { port: number }).port
      resolve({ server, url: `http://127.0.0.1:${p}`, port: p })
    })
  })
}

export async function closeAll(servers: Server[]): Promise<void> {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve())
        })
    )
  )
}
