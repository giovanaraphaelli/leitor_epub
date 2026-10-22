import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import sirv from 'sirv'
import { readAuthConfig, type AuthConfig } from './auth/config.ts'
import { routeApi } from './auth/routes.ts'
import { sendResponse, toRequest } from './http.ts'

// Without the Google credentials the app is still served; only /api answers
// 503, which keeps the Drive button hidden.
function loadConfig(): AuthConfig | null {
  try {
    return readAuthConfig()
  } catch (error) {
    console.error(`Login do Google Drive desligado: ${(error as Error).message}`)
    return null
  }
}

const config = loadConfig()
const serveFiles = sirv('dist', {
  etag: true,
  setHeaders: (res, pathname) => {
    // Files in /assets carry a content hash and never change; index.html,
    // sw.js and the manifest are checked again on every load.
    res.setHeader(
      'Cache-Control',
      pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    )
  },
})

// What isn't a file is one of the app's own routes and gets index.html; under
// /assets a missing file is a 404, not HTML where a script was expected. Done
// here rather than with sirv's `single` option, whose default "has an
// extension" regex backtracks exponentially: a URL like /a.a.a.a.a… freezes
// the whole server.
function serveApp(req: IncomingMessage, res: ServerResponse) {
  serveFiles(req, res, () => {
    if (req.url?.startsWith('/assets/')) {
      res.statusCode = 404
      res.end()
      return
    }
    req.url = '/index.html'
    serveFiles(req, res)
  })
}

const port = Number(process.env.PORT ?? 3000)

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    // toRequest is inside the chain on purpose: it throws on what Node accepts
    // but the Fetch API doesn't (a TRACE method, a malformed Host), and an
    // exception escaping this callback would take the whole server down.
    Promise.resolve()
      .then(() => routeApi(toRequest(req), config))
      .then((response) => sendResponse(res, response ?? new Response(null, { status: 404 })))
      .catch((error: unknown) => {
        console.error(error)
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    return
  }
  // sirv throws synchronously on some malformed requests (a Range such as
  // bytes=5-2), and the headers may already be out by then.
  try {
    serveApp(req, res)
  } catch (error) {
    console.error(error)
    res.destroy()
  }
}).listen(port, () => {
  console.log(`E-books em http://localhost:${port}`)
})
