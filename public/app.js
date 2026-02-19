// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_BASE = 'https://discord-vault.onrender.com/api';
const MAX_FILE_MB = 500;

// ─── STATE ─────────────────────────────────────────────────────────────────
let fileQueue = []; // { file, id, status }
let galleryItems = [];
let currentFilter = 'all';

// ─── DOM REFS ───────────────────────────────────────────────────────────────
const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const queueEl     = document.getElementById('queue');
const uploadBtn   = document.getElementById('uploadBtn');
const toastEl     = document.getElementById('toast');
const galleryGrid = document.getElementById('galleryGrid');
const emptyState  = document.getElementById('emptyState');
const lightbox    = document.getElementById('lightbox');
const lightboxContent = document.getElementById('lightboxContent');
const lightboxInfo    = document.getElementById('lightboxInfo');

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

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addFiles([...e.dataTransfer.files]);
});

fileInput.addEventListener('change', () => {
  addFiles([...fileInput.files]);
  fileInput.value = '';
});

// ─── FILE QUEUE ───────────────────────────────────────────────────────────────
function addFiles(files) {
  const valid = files.filter(f => {
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      showToast(`${f.name}: only images & videos`, 'error');
      return false;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      showToast(`${f.name}: max ${MAX_FILE_MB}MB`, 'error');
      return false;
    }
    return true;
  });

  valid.forEach(file => {
    const id = Date.now() + Math.random();
    fileQueue.push({ file, id, status: 'pending' });
    renderQueueItem({ file, id, status: 'pending' });
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
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      if (data.chunked) {
        setItemStatus(item.id, 'done', `✓ ${data.chunks} chunks`);
      } else {
        setItemStatus(item.id, 'done', '✓ saved');
      }
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

  setTimeout(() => {
    queueEl.innerHTML = '';
  }, 3000);
});

// ─── GALLERY ─────────────────────────────────────────────────────────────────
async function loadGallery() {
  galleryGrid.innerHTML = '<div class="empty-state"><span class="empty-icon">⬡</span><p>Loading vault…</p></div>';

  try {
    const res = await fetch(`${API_BASE}/list`);
    const data = await res.json();
    galleryItems = data.files || [];
    renderGallery();
  } catch (err) {
    galleryGrid.innerHTML = '<div class="empty-state"><span class="empty-icon">⬡</span><p>Could not load vault.<br>Is the backend running?</p></div>';
    console.error(err);
  }
}

function renderGallery() {
  const filtered = currentFilter === 'all'
    ? galleryItems
    : galleryItems.filter(i => i.type === currentFilter);

  galleryGrid.innerHTML = '';

  if (filtered.length === 0) {
    galleryGrid.innerHTML = `<div class="empty-state"><span class="empty-icon">⬡</span><p>${currentFilter === 'all' ? 'Your vault is empty.<br>Upload some files first.' : `No ${currentFilter}s found.`}</p></div>`;
    return;
  }

  filtered.forEach(item => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.dataset.type = item.type;

    const badge = `<span class="gallery-type-badge badge-${item.type}">${item.type}</span>`;
    const chunkBadge = item.chunked
      ? `<span class="gallery-type-badge" style="background:rgba(255,189,46,0.15);color:#ffbd2e">${item.totalChunks} chunks</span>`
      : '';
    const date = new Date(item.timestamp).toLocaleDateString();
    // Chunked files must go through /download/:id to be reassembled server-side
    const downloadUrl = item.chunked ? `${API_BASE}/download/${item.id}` : item.url;

    if (item.type === 'image') {
      div.innerHTML = `
        <img class="gallery-thumb" src="${downloadUrl}" alt="${item.filename}" loading="lazy" />
        <div class="gallery-meta">
          ${badge}${chunkBadge}
          <div class="gallery-name">${item.filename}</div>
          <div class="gallery-date">${date} · ${formatSize(item.size)}</div>
        </div>`;
    } else {
      div.innerHTML = `
        <div class="gallery-thumb-video">▶</div>
        <div class="gallery-meta">
          ${badge}${chunkBadge}
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

  const chunkInfo = item.chunked
    ? `<div style="color:#ffbd2e;margin-top:0.3rem">Split into ${item.totalChunks} chunks of 24MB in Discord</div>`
    : '';

  lightboxInfo.innerHTML = `
    <div>${item.filename} · ${formatSize(item.size)} · ${new Date(item.timestamp).toLocaleString()}</div>
    ${chunkInfo}
    <a href="${downloadUrl}" target="_blank" rel="noopener" download="${item.filename}">↓ Download</a>`;

  lightbox.classList.add('open');
}

document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

function closeLightbox() {
  lightbox.classList.remove('open');
  lightboxContent.innerHTML = '';
}

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
