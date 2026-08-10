/* Local-only QA server for the customer booking flow.
   It serves the real site while replacing the live n8n URLs with deterministic
   same-origin fakes, so browser tests cannot create calendar events. */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const PORT = Number(process.env.GMM_QA_PORT || 4174);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function offeredDays() {
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  const days = [];
  while (days.length < 6) {
    if ([0, 1, 2, 3].includes(cursor.getDay())) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const days = offeredDays();

  if (url.pathname === '/test-availability') {
    const referer = new URL(req.headers.referer || `http://${req.headers.host}/`);
    const scenario = referer.searchParams.get('scenario');
    if (scenario === 'fail') return json(res, 503, { ok: false });
    if (scenario === 'none') return json(res, 200, { ok: true, open: [] });
    return json(res, 200, { ok: true, open: days.slice(1), taken: [days[0]] });
  }

  if (url.pathname === '/test-booking' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      if (payload.requestedDay === days[1]) {
        return json(res, 409, {
          ok: false,
          reason: 'day_taken',
          requestedDay: days[1],
          open: days.slice(2),
        });
      }
      return json(res, 200, {
        ok: true,
        calendarHeld: true,
        requestedDay: payload.requestedDay,
      });
    });
    return;
  }

  const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(ROOT, '.' + requestPath);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let content = fs.readFileSync(file);
  if (requestPath === '/assets/site.js') {
    content = Buffer.from(content.toString('utf8')
      .replace('https://tggai.app.n8n.cloud/webhook/gmm-booking', '/test-booking')
      .replace('https://tggai.app.n8n.cloud/webhook/gmm-availability', '/test-availability'));
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(content);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`GMM booking QA server: http://127.0.0.1:${PORT}/`);
});
