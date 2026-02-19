# Discord Vault — Local Setup Guide

Store photos & videos in your Discord server, retrieve them from a clean web UI.
No cloud subscription needed — runs entirely on your machine.

---

## File Structure

```
discord-vault/
├── public/          ← Frontend (opened in browser)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js        ← Local backend server (run this!)
├── package.json     ← Node dependencies
├── .env             ← Your secret tokens (never share this)
├── .gitignore
└── vault.json       ← Auto-created when you first upload a file
```

---

## Step 1 — Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should say v20.x.x
```

---

## Step 2 — Install dependencies

```bash
cd discord-vault
npm install
```

---

## Step 3 — Add your Discord credentials to .env

Open the `.env` file:
```bash
nano .env
```

Fill in your values:
```
DISCORD_TOKEN=your_bot_token_here
DISCORD_CHANNEL=your_channel_id_here
PORT=3001
```

Save: Ctrl+O → Enter → Ctrl+X

### How to get your Bot Token:
1. Go to https://discord.com/developers/applications
2. Click New Application → name it "Vault Bot"
3. Go to Bot tab → Reset Token → copy it
4. Enable "Message Content Intent" under Privileged Gateway Intents
5. Go to OAuth2 → URL Generator → Scopes: bot
6. Bot Permissions: Send Messages, Attach Files, Read Message History, Manage Messages
7. Copy the URL, open in browser, invite bot to your server

### How to get your Channel ID:
1. Discord Settings → Advanced → Enable Developer Mode
2. Right-click the channel → Copy Channel ID

---

## Step 4 — Start the server

```bash
node server.js
```

You'll see:
```
╔══════════════════════════════════════╗
║       Discord Vault — Running!       ║
╠══════════════════════════════════════╣
║  Local:  http://localhost:3001       ║
║  Press Ctrl+C to stop                ║
╚══════════════════════════════════════╝
```

---

## Step 5 — Open the website

Open your browser and go to:
```
http://localhost:3001
```

---

## How it works

- Upload a file → server sends it to Discord → saves URL in vault.json
- Files > 24MB → auto-split into chunks → reassembled on download
- Gallery tab → reads vault.json → shows all your files with previews
- Everything is stored locally in vault.json — no cloud DB needed

---

## Common Issues

**"Cannot find module"** → Run `npm install` in the discord-vault folder

**"Missing DISCORD_TOKEN"** → Check your .env file has no extra spaces around the = sign

**"Discord 401"** → Your bot token is wrong. Regenerate it in the Discord developer portal.

**"Discord 403"** → Bot doesn't have permission to post in that channel. Check bot role permissions.

**Page won't load** → Make sure `node server.js` is running in a terminal