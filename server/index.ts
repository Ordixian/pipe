import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import qrcode from 'qrcode-terminal';
import { dbOps, UPLOADS_DIR } from './db.js';
import { getLocalAddresses } from './network.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB
const COOKIE_NAME = 'pipe_session';

const PAIRING_PIN = crypto.randomInt(1000, 10000).toString();
const rateLimits = new Map<string, { count: number; blockedUntil: number }>();

const SAFE_IMAGE_EXTS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

async function getSafeMimeType(filePath: string): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r');
  const bytes = Buffer.alloc(16);
  try { await handle.read(bytes, 0, bytes.length, 0); } finally { await handle.close(); }
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return SAFE_IMAGE_EXTS['.png'];
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return SAFE_IMAGE_EXTS['.jpg'];
  if (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a') return SAFE_IMAGE_EXTS['.gif'];
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return SAFE_IMAGE_EXTS['.webp'];
  return 'application/octet-stream';
}

const app = Fastify({
  logger: false,
  bodyLimit: 1024 * 1024
});

await app.register(fastifyCookie);
await app.register(fastifyMultipart, {
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 10
  }
});

const clientDist = path.resolve(process.cwd(), 'dist/client');
if (fs.existsSync(clientDist)) {
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: '/'
  });
}

function isAuthenticated(req: FastifyRequest): boolean {
  const token = req.cookies[COOKIE_NAME];
  return dbOps.isValidSession(token);
}

function requireAuth(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!isAuthenticated(req)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  done();
}

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

function broadcast(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

app.server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }

  const cookieHeader = request.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );

  if (!dbOps.isValidSession(cookies[COOKIE_NAME])) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });
});

setInterval(() => {
  const deletedIds = dbOps.purgeExpired();
  for (const id of deletedIds) {
    broadcast({ type: 'item_deleted', id });
  }
}, 60_000);

app.get('/api/auth/status', async (req) => {
  return { authenticated: isAuthenticated(req) };
});

app.post<{ Body: { pin: string } }>('/api/auth/pair', async (req, reply) => {
  const ip = req.ip;
  const now = Date.now();
  const record = rateLimits.get(ip) || { count: 0, blockedUntil: 0 };

  if (now < record.blockedUntil) {
    const waitSec = Math.ceil((record.blockedUntil - now) / 1000);
    return reply.code(429).send({ error: `Too many attempts. Try again in ${waitSec}s.` });
  }

  const submittedPin = String(req.body?.pin || '').trim();
  const pinBuffer = Buffer.from(PAIRING_PIN.padEnd(4, '0'));
  const subBuffer = Buffer.from(submittedPin.padEnd(4, '0').slice(0, 4));

  const isMatch =
    submittedPin.length === 4 && crypto.timingSafeEqual(pinBuffer, subBuffer);

  if (!isMatch) {
    record.count += 1;
    if (record.count >= 5) {
      record.blockedUntil = now + 5 * 60 * 1000;
      record.count = 0;
    }
    rateLimits.set(ip, record);
    return reply.code(401).send({ error: 'Invalid PIN' });
  }

  rateLimits.delete(ip);
  const sessionToken = crypto.randomBytes(32).toString('hex');
  dbOps.createSession(sessionToken);

  reply.setCookie(COOKIE_NAME, sessionToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  });

  return { success: true };
});

app.get('/api/items', { preHandler: requireAuth }, async () => {
  return {
    items: dbOps.getAllItems(),
    retention: dbOps.getRetention()
  };
});

app.post<{ Body: { text: string } }>(
  '/api/items/text',
  { preHandler: requireAuth },
  async (req, reply) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return reply.code(400).send({ error: 'Text cannot be empty' });

    const item = dbOps.insertText(text);
    broadcast({ type: 'item_added', item });
    return item;
  }
);

app.post('/api/items/file', { preHandler: requireAuth }, async (req, reply) => {
  const data = await req.file();
  if (!data) return reply.code(400).send({ error: 'No file uploaded' });

  const originalName = path.basename((data.filename || 'unnamed_file').replace(/\\/g, '/')).slice(0, 255);
  const randomName = `${crypto.randomUUID()}`;
  const destPath = path.join(UPLOADS_DIR, randomName);

  try {
    await pipeline(data.file, fs.createWriteStream(destPath));

    if (data.file.truncated) {
      fs.unlink(destPath, () => {});
      return reply.code(413).send({ error: 'File exceeds 1GB limit' });
    }

    const stats = await fs.promises.stat(destPath);
    const safeMime = await getSafeMimeType(destPath);

    const item = dbOps.insertFile({
      original_name: originalName,
      stored_name: randomName,
      mime_type: safeMime,
      size: stats.size
    });

    broadcast({ type: 'item_added', item });
    return item;
  } catch (err) {
    await fs.promises.rm(destPath, { force: true });
    const tooLarge = data.file.truncated || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE';
    return reply.code(tooLarge ? 413 : 500).send({ error: tooLarge ? 'File exceeds 1GB limit' : 'File upload failed' });
  }
});

app.post('/api/share-target', async (req, reply) => {
  if (!isAuthenticated(req)) {
    return reply.redirect('/');
  }

  const parts = req.parts();
  const sharedTextParts: string[] = [];

  for await (const part of parts) {
    if (part.type === 'file' && part.filename) {
      const originalName = path.basename(part.filename.replace(/\\/g, '/')).slice(0, 255);
      const randomName = `${crypto.randomUUID()}`;
      const destPath = path.join(UPLOADS_DIR, randomName);
      try {
        await pipeline(part.file, fs.createWriteStream(destPath));
        if (part.file.truncated) throw new Error('File exceeds 1GB limit');
      } catch {
        await fs.promises.rm(destPath, { force: true });
        return reply.code(413).send({ error: 'File upload failed or exceeds 1GB limit' });
      }
      const stats = await fs.promises.stat(destPath);
      const item = dbOps.insertFile({
        original_name: originalName,
        stored_name: randomName,
        mime_type: await getSafeMimeType(destPath),
        size: stats.size
      });
      broadcast({ type: 'item_added', item });
    } else if (part.type === 'field' && typeof part.value === 'string' && part.value.trim()) {
      sharedTextParts.push(part.value.trim());
    }
  }

  if (sharedTextParts.length > 0) {
    const item = dbOps.insertText(sharedTextParts.join('\n'));
    broadcast({ type: 'item_added', item });
  }

  return reply.redirect('/');
});

app.get<{ Params: { id: string }; Querystring: { preview?: string } }>(
  '/api/files/:id',
  { preHandler: requireAuth },
  async (req, reply) => {
    const item = dbOps.getItemById(Number(req.params.id));
    if (!item || item.type !== 'file' || !item.stored_name) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const filePath = path.join(UPLOADS_DIR, item.stored_name);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'File missing on disk' });
    }

    const safeName = (item.original_name || 'download').replace(/["\\\r\n]/g, '_');
    const isImage = item.mime_type?.startsWith('image/');
    const disposition =
      req.query.preview === '1' && isImage
        ? `inline; filename="${safeName}"`
        : `attachment; filename="${safeName}"`;

    reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Type', item.mime_type || 'application/octet-stream');
    reply.header('Content-Length', item.size || 0);
    reply.header('Content-Disposition', disposition);

    return reply.send(fs.createReadStream(filePath));
  }
);

app.delete<{ Params: { id: string } }>(
  '/api/items/:id',
  { preHandler: requireAuth },
  async (req, reply) => {
    const id = Number(req.params.id);
    const deleted = dbOps.deleteItem(id);
    if (!deleted) return reply.code(404).send({ error: 'Not found' });

    broadcast({ type: 'item_deleted', id });
    return { success: true };
  }
);

app.delete('/api/items', { preHandler: requireAuth }, async () => {
  dbOps.clearAll();
  broadcast({ type: 'items_cleared' });
  return { success: true };
});

app.put<{ Body: { retention: 'never' | '24h' | '7d' } }>(
  '/api/settings/retention',
  { preHandler: requireAuth },
  async (req, reply) => {
    const val = req.body?.retention;
    if (val !== 'never' && val !== '24h' && val !== '7d') {
      return reply.code(400).send({ error: 'Invalid retention setting' });
    }
    dbOps.setRetention(val);
    for (const id of dbOps.purgeExpired()) broadcast({ type: 'item_deleted', id });
    broadcast({ type: 'retention_updated', retention: val });
    return { retention: val };
  }
);

await app.listen({ port: PORT, host: HOST });

const addresses = getLocalAddresses();
console.clear();
console.log('\x1b[32m%s\x1b[0m', '============================================================');
console.log('\x1b[1m\x1b[32m   PIPE — LOCAL REAL-TIME TEXT & FILE SYNC\x1b[0m');
console.log('\x1b[32m%s\x1b[0m', '============================================================');
console.log(`\n   🔑  PAIRING PIN: \x1b[1m\x1b[42m\x1b[30m  ${PAIRING_PIN}  \x1b[0m\n`);
console.log(`   💻  Laptop Local: http://localhost:${PORT}`);

if (addresses.length === 0) {
  console.log('\n   ⚠️  No active external network interfaces detected.');
  console.log('      Connect to Wi-Fi, turn on phone hotspot, or enable Bluetooth tethering.\n');
} else {
  console.log('\n   📱  Scan a QR code below with your phone camera to connect:\n');
  for (const addr of addresses) {
    const url = `http://${addr.ip}:${PORT}`;
    console.log(`   ▸ \x1b[1m${addr.type}\x1b[0m (${addr.interfaceName}): \x1b[36m${url}\x1b[0m`);
    qrcode.generate(url, { small: true }, (qr) => {
      const indented = qr
        .split('\n')
        .map((line) => '     ' + line)
        .join('\n');
      console.log(indented);
    });
  }
}
