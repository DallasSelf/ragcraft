const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PORT = Number(process.env.DASHBOARD_PORT || 8787)

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
}

function toSafePath(urlPath) {
  const normalized = path.normalize(urlPath).replace(/^([.][.][\\/])+/, '')
  return path.join(ROOT, normalized)
}

function sendNotFound(res) {
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end('Not found')
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0]
  const target = pathname === '/'
    ? path.join(ROOT, 'rag', 'eval', 'dashboard', 'index.html')
    : toSafePath(pathname)

  if (!target.startsWith(ROOT)) {
    res.statusCode = 400
    res.end('Invalid path')
    return
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    sendNotFound(res)
    return
  }

  const ext = path.extname(target).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream')
  fs.createReadStream(target).pipe(res)
})

server.listen(PORT, () => {
  console.log(`Dashboard server running at http://localhost:${PORT}`)
  console.log('Open /rag/eval/dashboard/index.html if you need a direct path.')
})
