// ─── Firebase Setup ────────────────────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// 🔴 Replace these with your actual Firebase config values
// Get them from: Firebase Console → Project Settings → Your Apps → Web App
const firebaseConfig = {
  apiKey: "AIzaSyA0FWGSXLyzQ3GSw7jVzzca4gMbefBuJG4",
  authDomain: "discloud-c2705.firebaseapp.com",
  projectId: "discloud-c2705",
  storageBucket: "discloud-c2705.firebasestorage.app",
  messagingSenderId: "798256936235",
  appId: "1:798256936235:web:589f52a6938d3f0e72016e"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const provider    = new GoogleAuthProvider();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_BASE    = 'https://discord-vault.onrender.com/api';
const MAX_FILE_MB = 500;

// ─── STATE ─────────────────────────────────────────────────────────────────
let currentUser  = null;
let idToken      = null;
let fileQueue    = [];
let galleryItems = [];
let currentFilter = 'all';

// ─── AUTH HELPERS ──────────────────────────────────────────────────────────
async function getToken() {
  if (!currentUser) return null;
  idToken = await currentUser.getIdToken();
  return idToken;
}

function authHeaders() {
  return { Authorization: `Bearer ${idToken}` };
}

// ─── DOM REFS ───────────────────────────────────────────────────────────────
const loginScreen     = document.getElementById('loginScreen');
const appEl           = document.getElementById('app');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const signOutBtn      = document.getElementById('signOutBtn');
const userAvatar      = document.getElementById('userAvatar');
const userNameEl      = document.getElementById('userName');
const dropZone        = document.getElementById('dropZone');
const fileInput       = document.getElementById('fileInput');
const queueEl         = document.getElementById('queue');
const uploadBtn       = document.getElementById('uploadBtn');
const toastEl         = document.getElementById('toast');
const galleryGrid     = document.getElementById('galleryGrid');
const lightbox        = document.getElementById('lightbox');
const lightboxContent = document.getElementById('lightboxContent');
const lightboxInfo    = document.getElementById('lightboxInfo');

// ─── AUTH STATE ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    idToken = await user.getIdToken();

    // Show app, hide login
    loginScreen.style.display = 'none';
    appEl.style.display = 'block';

    // Set user info in header
    userNameEl.textContent = user.displayName?.split(' ')[0] || user.email;
    if (user.photoURL) {
      userAvatar.src = user.photoURL;
      userAvatar.style.display = 'block';
    }
  } else {
    currentUser = null;
    idToken = null;
    loginScreen.style.display = 'flex';
    appEl.style.display = 'none';
  }
});
getRedirectResult(auth).catch(err => console.error('Redirect error:', err));

// ─── SIGN IN / OUT ────────────────────────────────────────────────────────
googleSignInBtn.addEventListener('click', async () => {
  try {
    googleSignInBtn.textContent = 'Signing in...';
    googleSignInBtn.disabled = true;
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    if (isMobile) {
      await signInWithRedirect(auth, provider);
    } else {
      await signInWithPopup(auth, provider);
    }
  } catch (err) {
    console.error(err);
    googleSignInBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/><path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/></svg> Sign in with Google`;
    googleSignInBtn.disabled = false;
    showToast('Sign in failed. Try again.', 'error');
  }
});

signOutBtn.addEventListener('click', async () => {
  await signOut(auth);
  fileQueue = [];
  galleryItems = [];
  queueEl.innerHTML = '';
  galleryGrid.innerHTML = '';
});

// ─── TABS ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'gallery') loadGallery();
  });
});

// ─── DRAG & DROP ─────────────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); addFiles([...e.dataTransfer.files]); });
fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });

// ─── FILE QUEUE ───────────────────────────────────────────────────────────────
function addFiles(files) {
  const valid = files.filter(f => {
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      showToast(`${f.name}: only images & videos`, 'error'); return false;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      showToast(`${f.name}: max ${MAX_FILE_MB}MB`, 'error'); return false;
    }
    return true;
  });

  valid.forEach(file => {
    const id = Date.now() + Math.random();
    fileQueue.push({ file, id, status: 'pending' });
    renderQueueItem({ file, id });
  });

  uploadBtn.disabled = fileQueue.length === 0;
}

function renderQueueItem(item) {
  const div = document.createElement('div');
  div.className = 'queue-item';
  div.dataset.id = item.id;
  const isVideo = item.file.type.startsWith('video/');

  if (isVideo) {
    div.innerHTML = `
      <div class="queue-thumb video-thumb">▶</div>
      <div class="queue-info">
        <div class="queue-name">${item.file.name}</div>
        <div class="queue-size">${formatSize(item.file.size)}</div>
      </div>
      <span class="queue-status pending">pending</span>
      <button class="queue-remove" data-id="${item.id}">✕</button>`;
  } else {
    const img = document.createElement('img');
    img.className = 'queue-thumb';
    img.src = URL.createObjectURL(item.file);
    div.innerHTML = `
      <div class="queue-info">
        <div class="queue-name">${item.file.name}</div>
        <div class="queue-size">${formatSize(item.file.size)}</div>
      </div>
      <span class="queue-status pending">pending</span>
      <button class="queue-remove" data-id="${item.id}">✕</button>`;
    div.insertBefore(img, div.firstChild);
  }

  queueEl.appendChild(div);
  div.querySelector('.queue-remove').addEventListener('click', () => {
    fileQueue = fileQueue.filter(i => i.id !== item.id);
    div.remove();
    uploadBtn.disabled = fileQueue.length === 0;
  });
}

function setItemStatus(id, status, label) {
  const div = queueEl.querySelector(`[data-id="${id}"]`);
  if (!div) return;
  const s = div.querySelector('.queue-status');
  s.className = `queue-status ${status}`;
  s.textContent = label;
  const btn = div.querySelector('.queue-remove');
  if (btn && status === 'uploading') btn.style.display = 'none';
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
uploadBtn.addEventListener('click', async () => {
  if (fileQueue.length === 0) return;
  await getToken(); // refresh token
  uploadBtn.disabled = true;
  uploadBtn.querySelector('span').textContent = 'Uploading...';
  let successCount = 0;

  for (const item of fileQueue) {
    setItemStatus(item.id, 'uploading', 'uploading…');
    try {
      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('filename', item.file.name);
      formData.append('type', item.file.type.startsWith('video/') ? 'video' : 'image');

      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setItemStatus(item.id, 'done', data.chunked ? `✓ ${data.chunks} chunks` : '✓ saved');
      successCount++;
    } catch (err) {
      setItemStatus(item.id, 'error', '✗ failed');
      console.error(err);
    }
  }

  fileQueue = [];
  uploadBtn.querySelector('span').textContent = 'Upload to Vault';
  uploadBtn.disabled = true;
  if (successCount > 0) showToast(`${successCount} file(s) saved to vault ✓`, 'success');
  setTimeout(() => { queueEl.innerHTML = ''; }, 3000);
});

// ─── GALLERY ─────────────────────────────────────────────────────────────────
async function loadGallery() {
  galleryGrid.innerHTML = '<div class="empty-state"><span class="empty-icon">⬡</span><p>Loading vault…</p></div>';
  await getToken();
  try {
    const res = await fetch(`${API_BASE}/list`, { headers: authHeaders() });
    const data = await res.json();
    galleryItems = data.files || [];
    renderGallery();
  } catch (err) {
    galleryGrid.innerHTML = '<div class="empty-state"><span class="empty-icon">⬡</span><p>Could not load vault.<br>Is the backend running?</p></div>';
  }
}

function renderGallery() {
  const filtered = currentFilter === 'all' ? galleryItems : galleryItems.filter(i => i.type === currentFilter);
  galleryGrid.innerHTML = '';

  if (filtered.length === 0) {
    galleryGrid.innerHTML = `<div class="empty-state"><span class="empty-icon">⬡</span><p>${currentFilter === 'all' ? 'Your vault is empty.<br>Upload some files first.' : `No ${currentFilter}s found.`}</p></div>`;
    return;
  }

  filtered.forEach(item => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    const badge = `<span class="gallery-type-badge badge-${item.type}">${item.type}</span>`;
    const chunkBadge = item.chunked ? `<span class="gallery-type-badge" style="background:rgba(255,189,46,0.15);color:#ffbd2e">${item.totalChunks} chunks</span>` : '';
    const date = new Date(item.timestamp).toLocaleDateString();
    const downloadUrl = item.chunked ? `${API_BASE}/download/${item.id}` : item.url;

    if (item.type === 'image') {
      div.innerHTML = `
        <img class="gallery-thumb" src="${downloadUrl}" alt="${item.filename}" loading="lazy" />
        <div class="gallery-meta">${badge}${chunkBadge}
          <div class="gallery-name">${item.filename}</div>
          <div class="gallery-date">${date} · ${formatSize(item.size)}</div>
        </div>`;
    } else {
      div.innerHTML = `
        <div class="gallery-thumb-video">▶</div>
        <div class="gallery-meta">${badge}${chunkBadge}
          <div class="gallery-name">${item.filename}</div>
          <div class="gallery-date">${date} · ${formatSize(item.size)}</div>
        </div>`;
    }

    div.addEventListener('click', () => openLightbox(item, downloadUrl));
    galleryGrid.appendChild(div);
  });
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderGallery();
  });
});

document.getElementById('refreshBtn').addEventListener('click', loadGallery);

// ─── LIGHTBOX ─────────────────────────────────────────────────────────────────
function openLightbox(item, downloadUrl) {
  lightboxContent.innerHTML = item.type === 'image'
    ? `<img src="${downloadUrl}" alt="${item.filename}" />`
    : `<video src="${downloadUrl}" controls autoplay muted></video>`;

  const chunkInfo = item.chunked ? `<div style="color:#ffbd2e;margin-top:0.3rem">Split into ${item.totalChunks} chunks of 24MB in Discord</div>` : '';
  lightboxInfo.innerHTML = `
    <div>${item.filename} · ${formatSize(item.size)} · ${new Date(item.timestamp).toLocaleString()}</div>
    ${chunkInfo}
    <a href="${downloadUrl}" target="_blank" rel="noopener" download="${item.filename}">↓ Download</a>`;

  lightbox.classList.add('open');
}

document.getElementById('lightboxClose').addEventListener('click', () => { lightbox.classList.remove('open'); lightboxContent.innerHTML = ''; });
lightbox.addEventListener('click', e => { if (e.target === lightbox) { lightbox.classList.remove('open'); lightboxContent.innerHTML = ''; } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { lightbox.classList.remove('open'); lightboxContent.innerHTML = ''; } });

// ─── UTILS ───────────────────────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${type}`;
  setTimeout(() => toastEl.className = 'toast', 3000);
}