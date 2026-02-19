// ─── Discord Vault — Backend Server ──────────────────────────────────────────
// Run with: node server.js
// Per-user file storage using Google UID from Firebase Auth
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const fetch    = require('node-fetch');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DISCORD_BOT_TOKEN   = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID  = process.env.DISCORD_CHANNEL;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const PORT                = process.env.PORT || 3001;
const DB_FILE             = path.join(__dirname, 'vault.json');
const CHUNK_SIZE          = 24 * 1024 * 1024; // 24MB per chunk

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID || !FIREBASE_WEB_API_KEY) {
  console.error('❌  Missing environment variables! Check your .env file.');
  console.error('    Required: DISCORD_TOKEN, DISCORD_CHANNEL, FIREBASE_WEB_API_KEY');
  process.exit(1);
}

// ─── LOCAL JSON DATABASE (per-user) ──────────────────────────────────────────
function readDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }));
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // migrate old single-user format
  if (db.files && !db.users) {
    db.users = { _legacy: { files: db.files } };
    delete db.files;
    writeDB(db);
  }
  if (!db.users) db.users = {};
  return db;
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUserFiles(uid) {
  const db = readDB();
  if (!db.users[uid]) db.users[uid] = { files: [] };
  return db.users[uid].files;
}

function addFile(uid, record) {
  const db = readDB();
  if (!db.users[uid]) db.users[uid] = { files: [] };
  record.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  record.timestamp = new Date().toISOString();
  db.users[uid].files.unshift(record);
  writeDB(db);
  return record;
}

function getFile(uid, id) {
  return getUserFiles(uid).find(f => f.id === id) || null;
}

function deleteFile(uid, id) {
  const db = readDB();
  if (db.users[uid]) {
    db.users[uid].files = db.users[uid].files.filter(f => f.id !== id);
    writeDB(db);
  }
}

// ─── VERIFY FIREBASE ID TOKEN ─────────────────────────────────────────────────
async function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      }
    );
    const data = await res.json();
    if (data.error || !data.users?.[0]) return null;
    return {
      uid: data.users[0].localId,
      email: data.users[0].email,
      name: data.users[0].displayName,
    };
  } catch {
    return null;
  }
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const user = await verifyToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Unauthorized — please sign in with Google' });
  req.user = user;
  next();
}

// ─── EXPRESS SETUP ────────────────────────────────────────────────────────────
const app = express();
app.use(cors({
  origin: [
    'https://discloud-c2705.web.app',
    'https://discord-vault.onrender.com',
    'http://localhost:3001',
    'http://192.168.1.6:3001',
  ]
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function splitBuffer(buffer, chunkSize) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    chunks.push(buffer.slice(offset, offset + chunkSize));
    offset += chunkSize;
  }
  return chunks;
}

async function uploadChunkToDiscord(buffer, filename, contentType, label) {
  const form = new FormData();
  form.append('file', buffer, { filename, contentType });
  form.append('content', label);
  const res = await fetch(
    `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, ...form.getHeaders() },
      body: form,
    }
  );
  if (!res.ok) throw new Error(`Discord upload failed: ${await res.text()}`);
  const data = await res.json();
  const attachment = data.attachments?.[0];
  if (!attachment) throw new Error('No attachment returned by Discord');
  return { messageId: data.id, url: attachment.url };
}

async function deleteDiscordMessage(messageId) {
  await fetch(
    `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${messageId}`,
    { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
  );
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const uid       = req.user.uid;
    const filename  = req.body.filename || req.file.originalname;
    const type      = req.body.type || (req.file.mimetype.startsWith('video/') ? 'video' : 'image');
    const buffer    = req.file.buffer;
    const mimetype  = req.file.mimetype;
    const totalSize = buffer.length;
    const isChunked = totalSize > CHUNK_SIZE;
    let record;

    if (!isChunked) {
      console.log(`📤 [${req.user.email}] Uploading ${filename} (${(totalSize/1024/1024).toFixed(1)}MB)...`);
      const label = `📁 **${filename}** | user: \`${req.user.email}\` | size: \`${(totalSize/1024/1024).toFixed(1)}MB\` | ${new Date().toISOString()}`;
      const { messageId, url } = await uploadChunkToDiscord(buffer, filename, mimetype, label);
      record = { filename, type, url, discordMessageId: messageId, size: totalSize, mimetype, chunked: false };
    } else {
      const chunks = splitBuffer(buffer, CHUNK_SIZE);
      const total  = chunks.length;
      console.log(`📦 [${req.user.email}] Uploading ${filename} in ${total} chunks...`);
      const chunkRecords = [];
      for (let i = 0; i < total; i++) {
        console.log(`   chunk ${i+1}/${total}...`);
        const chunkFilename = `${filename}.part${String(i+1).padStart(3,'0')}of${total}`;
        const label = `📦 **${filename}** | user: \`${req.user.email}\` | chunk \`${i+1}/${total}\``;
        const { messageId, url } = await uploadChunkToDiscord(chunks[i], chunkFilename, 'application/octet-stream', label);
        chunkRecords.push({ index: i, messageId, url, size: chunks[i].length });
      }
      const manifestText =
        `📋 **MANIFEST: ${filename}** | user: \`${req.user.email}\`\n` +
        `total: \`${(totalSize/1024/1024).toFixed(1)}MB\` | chunks: \`${total}\`\n` +
        chunkRecords.map(c => `  chunk ${c.index+1}: ${c.url}`).join('\n');
      const manifestRes = await fetch(
        `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: manifestText.slice(0, 2000) }),
        }
      );
      const manifestData = await manifestRes.json();
      record = { filename, type, url: null, discordMessageId: manifestData.id, size: totalSize, mimetype, chunked: true, totalChunks: total, chunks: chunkRecords };
    }

    const saved = addFile(uid, record);
    console.log(`✅ [${req.user.email}] ${filename} saved (id: ${saved.id})`);
    return res.json({ success: true, id: saved.id, chunked: isChunked, chunks: isChunked ? record.totalChunks : 1, filename });
  } catch (err) {
    console.error('❌ Upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── LIST ─────────────────────────────────────────────────────────────────────
app.get('/api/list', requireAuth, (req, res) => {
  try {
    const files = getUserFiles(req.user.uid).map(f => ({
      id: f.id, filename: f.filename, type: f.type, url: f.url,
      size: f.size, mimetype: f.mimetype,
      chunked: f.chunked || false, totalChunks: f.totalChunks || 1,
      chunks: f.chunks || null, timestamp: f.timestamp,
    }));
    return res.json({ files });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
app.get('/api/download/:id', requireAuth, async (req, res) => {
  try {
    const file = getFile(req.user.uid, req.params.id);
    if (!file) return res.status(404).json({ error: 'Not found' });
    if (!file.chunked) return res.redirect(file.url);
    console.log(`🔧 Reassembling ${file.filename} from ${file.totalChunks} chunks...`);
    const sorted  = [...file.chunks].sort((a, b) => a.index - b.index);
    const buffers = [];
    for (const chunk of sorted) {
      const r = await fetch(chunk.url);
      if (!r.ok) throw new Error(`Failed to fetch chunk ${chunk.index}`);
      buffers.push(Buffer.from(await r.arrayBuffer()));
    }
    const assembled = Buffer.concat(buffers);
    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', assembled.length);
    return res.send(assembled);
  } catch (err) {
    console.error('❌ Download error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
app.delete('/api/delete/:id', requireAuth, async (req, res) => {
  try {
    const file = getFile(req.user.uid, req.params.id);
    if (!file) return res.status(404).json({ error: 'Not found' });
    if (!file.chunked) {
      await deleteDiscordMessage(file.discordMessageId);
    } else {
      await Promise.all([
        ...file.chunks.map(c => deleteDiscordMessage(c.messageId)),
        deleteDiscordMessage(file.discordMessageId),
      ]);
    }
    deleteFile(req.user.uid, req.params.id);
    console.log(`🗑️  [${req.user.email}] Deleted ${file.filename}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Delete error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║       Discord Vault — Running!       ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Local:  http://localhost:${PORT}       ║`);
  console.log('║  Press Ctrl+C to stop                ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});