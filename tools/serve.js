// Winziger Entwicklungsserver: liefert die statischen Dateien aus und haelt
// eine In-Memory-Bestenliste unter /api/records bereit, damit sich das Spiel
// ohne Cloudflare lokal testen laesst.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = new URL('../public/', import.meta.url).pathname
const PORT = Number(process.env.PORT || 8787)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** @type {Array<object>} */
const records = []

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/api/records' && req.method === 'GET') {
    const mode = url.searchParams.get('mode')
    const goal = url.searchParams.get('goal')
    const size = url.searchParams.get('size')
    const list = records
      .filter(r => (!mode || r.mode === mode) && (!goal || r.goal === goal) && (!size || String(r.size) === size))
      .sort((a, b) => a.moves - b.moves || a.seconds - b.seconds)
      .slice(0, 20)
    res.writeHead(200, { 'content-type': TYPES['.json'] })
    return res.end(JSON.stringify({ ok: true, records: list }))
  }

  if (url.pathname === '/api/records' && req.method === 'POST') {
    let body
    try { body = JSON.parse(await readBody(req)) } catch { body = null }
    if (!body) {
      res.writeHead(400, { 'content-type': TYPES['.json'] })
      return res.end(JSON.stringify({ ok: false, error: 'ungueltiges JSON' }))
    }
    const rec = { ...body, created_at: new Date().toISOString(), rank: 0 }
    records.push(rec)
    res.writeHead(201, { 'content-type': TYPES['.json'] })
    return res.end(JSON.stringify({ ok: true, record: rec }))
  }

  let path = normalize(url.pathname)
  if (path === '/' || path.endsWith('/')) path += 'index.html'
  const file = join(ROOT, path)
  if (!file.startsWith(ROOT)) {
    res.writeHead(403)
    return res.end('verboten')
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('kein File')
    const data = await readFile(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('nicht gefunden: ' + path)
  }
})

server.listen(PORT, () => console.log(`Pfeilspiel-Dev-Server auf http://localhost:${PORT}`))
