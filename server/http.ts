import type { IncomingMessage, ServerResponse } from 'node:http'

// The first value of a header that may repeat or carry a comma list.
function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim()
}

// Behind Coolify's proxy the public scheme and host arrive in X-Forwarded-*,
// and the login routes need them to know which origin the reader is on. Only
// the cookie header is carried over: it's all the routes read.
export function toRequest(req: IncomingMessage): Request {
  const proto = firstHeader(req, 'x-forwarded-proto') ?? 'http'
  const host = firstHeader(req, 'x-forwarded-host') ?? req.headers.host ?? 'localhost'
  const headers = new Headers()
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie)
  return new Request(`${proto}://${host}${req.url ?? '/'}`, { method: req.method, headers })
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[name] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers)
  res.end(Buffer.from(await response.arrayBuffer()))
}
