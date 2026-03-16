// ═══════════════════════════════════════════════════════
//  FACEATTEND PRO — app.js
//  Features: Face Recognition + QR Hybrid + Charts
// ═══════════════════════════════════════════════════════

const FACE_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/';
let FACE_THRESHOLD = 0.45;
let COOLDOWN_MS    = 5000;

// ── STATE ───────────────────────────────────────────────
let modelsLoaded = false;
let faceMatcher  = null;

// Streams
let streams = {};       // key: camId, value: MediaStream
let loops   = {};       // key: camId, value: timeout/raf id

// Cooldowns per camera
let cooldowns = {};     // { hybrid:{}, face:{}, qr:{} }

// Charts
let chartWeekly, chartToday, chartHourly;

// ── STORAGE ─────────────────────────────────────────────
const S = {
  get: (k, d=null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};
const getStudents   = ()  => S.get('fp_students', []);
const setStudents   = (s) => S.set('fp_students', s);
const getCreds      = ()  => S.get('fp_creds', { user:'admin', pass:'admin123' });
const setCreds      = (c) => S.set('fp_creds', c);
const getSettings   = ()  => S.get('fp_settings', { scriptUrl:'', sheetUrl:'', threshold:0.45, cooldown:5 });
const setSettingsDb = (s) => S.set('fp_settings', s);
const todayKey      = ()  => 'fp_att_' + new Date().toISOString().slice(0,10);
const getTodayAtt   = ()  => S.get(todayKey(), []);
const setTodayAtt   = (a) => S.set(todayKey(), a);
const getDateAtt    = (d) => S.get('fp_att_' + d, []);
const getAllAttKeys  = ()  => Object.keys(localStorage).filter(k => k.startsWith('fp_att_')).sort();
const getTotalRecs  = ()  => getAllAttKeys().reduce((n,k) => { try { return n + JSON.parse(localStorage[k]).length; } catch { return n; } }, 0);

// ── PARTICLES ───────────────────────────────────────────
function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 60; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + 0.5,
      dx: (Math.random() - 0.5) * 0.3,
      dy: (Math.random() - 0.5) * 0.3,
      o: Math.random() * 0.5 + 0.1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,245,212,${p.o})`;
      ctx.fill();
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0 || p.x > W) p.dx *= -1;
      if (p.y < 0 || p.y > H) p.dy *= -1;
    });
    requestAnimationFrame(draw);
  }
  draw();
}

// ── LOGIN ────────────────────────────────────────────────
function handleLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const c = getCreds();
  if (u === c.user && p === c.pass) {
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('appScreen').classList.add('active');
    document.getElementById('sbUsername').textContent = u;
    document.getElementById('sbAvatar').textContent = u[0].toUpperCase();
    initApp();
  } else {
    const el = document.getElementById('loginError');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }
}

function logout() {
  Object.keys(streams).forEach(k => stopStream(k));
  document.getElementById('appScreen').classList.remove('active');
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('loginPass').value = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('loginScreen').classList.contains('active')) handleLogin();
});

// ── APP INIT ─────────────────────────────────────────────
function initApp() {
  const cfg = getSettings();
  FACE_THRESHOLD = cfg.threshold || 0.45;
  COOLDOWN_MS    = (cfg.cooldown || 5) * 1000;

  updateTopbarDate();
  initCharts();
  updateDashboard();
  loadSettingsUI();
  loadModels();
  setInterval(updateTopbarDate, 60000);
}

function updateTopbarDate() {
  const d = new Date();
  document.getElementById('tbDate').textContent = d.toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
}

// ── SIDEBAR ──────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ── PAGE NAV ─────────────────────────────────────────────
const pageTitles = {
  dashboard: 'Dashboard', register: 'Register Student', hybrid: 'Hybrid Attendance',
  face: 'Face Recognition', qrscan: 'QR Scanner', students: 'Students',
  records: 'Records', settings: 'Settings'
};

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  document.getElementById('tbTitle').textContent = pageTitles[name] || name;

  // Stop unneeded cameras
  if (name !== 'register')  stopStream('reg');
  if (name !== 'hybrid')    stopStream('hybrid');
  if (name !== 'face')      stopStream('face');
  if (name !== 'qrscan')    stopStream('qr');

  // Page-specific init
  if (name === 'dashboard') updateDashboard();
  if (name === 'students')  renderStudents();
  if (name === 'records')   renderRecords();
  if (name === 'settings')  loadSettingsUI();
}

// ── FACE MODELS ──────────────────────────────────────────
async function loadModels() {
  const pill = document.getElementById('modelPill');
  const dot  = document.querySelector('.mp-dot');
  const txt  = document.getElementById('modelText');
  dot.className = 'mp-dot loading';
  txt.textContent = 'Loading AI…';
  try {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_MODELS),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODELS),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS),
    ]);
    modelsLoaded = true;
    dot.className = 'mp-dot ready';
    txt.textContent = 'AI Ready ✓';
    buildFaceMatcher();
  } catch (e) {
    dot.className = 'mp-dot error';
    txt.textContent = 'Model Error';
    console.error('Face model error:', e);
  }
}

function buildFaceMatcher() {
  const students = getStudents().filter(s => s.descriptor);
  if (!students.length) { faceMatcher = null; return; }
  const labeled = students.map(s =>
    new faceapi.LabeledFaceDescriptors(s.id, [new Float32Array(s.descriptor)])
  );
  faceMatcher = new faceapi.FaceMatcher(labeled, FACE_THRESHOLD);
}

// ══════════════════════════════════════════════════════════
//  REGISTRATION
// ══════════════════════════════════════════════════════════
let regDetectRaf;

async function startRegCam() {
  if (!modelsLoaded) { toast('AI models not ready yet', 'err'); return; }
  try {
    const stream = await getCam('reg');
    const video = document.getElementById('regVideo');
    video.srcObject = stream;
    await video.play();
    document.getElementById('regCaptureBtn').disabled = false;
    document.getElementById('regBeam').classList.add('on');
    startRegDetect(video);
  } catch(e) { toast('Camera error: ' + e.message, 'err'); }
}

function startRegDetect(video) {
  const canvas = document.getElementById('regOverlay');
  const pill   = document.getElementById('regFacePill');
  const opts   = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

  async function run() {
    if (!streams['reg']) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const det = await faceapi.detectSingleFace(video, opts).withFaceLandmarks();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (det) {
      faceapi.draw.drawFaceLandmarks(canvas, faceapi.resizeResults(det, { width: video.videoWidth, height: video.videoHeight }));
      pill.textContent = '✓ Face detected — ready to enroll';
      pill.className = 'face-pill ok';
    } else {
      pill.textContent = 'No face detected';
      pill.className = 'face-pill';
    }
    regDetectRaf = requestAnimationFrame(run);
  }
  run();
}

async function doRegister() {
  const name   = document.getElementById('rName').value.trim();
  const id     = document.getElementById('rId').value.trim();
  const cls    = document.getElementById('rClass').value.trim();
  const email  = document.getElementById('rEmail').value.trim();
  const msgEl  = document.getElementById('regMsg');

  if (!name || !id) { showMsg(msgEl, 'Name and Student ID are required.', 'err'); return; }
  if (getStudents().find(s => s.id === id)) { showMsg(msgEl, `ID "${id}" already exists.`, 'err'); return; }
  if (!modelsLoaded) { showMsg(msgEl, 'AI models not loaded.', 'err'); return; }

  const video = document.getElementById('regVideo');
  if (!streams['reg'] || !video.videoWidth) { showMsg(msgEl, 'Start camera first.', 'err'); return; }

  showMsg(msgEl, 'Analyzing face…', 'ok');
  try {
    const det = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
    if (!det) { showMsg(msgEl, 'No face detected. Try better lighting.', 'err'); return; }

    const student = { id, name, class: cls, email, descriptor: Array.from(det.descriptor), registeredAt: new Date().toISOString() };
    const students = getStudents();
    students.push(student);
    setStudents(students);
    buildFaceMatcher();

    // Generate QR
    showQRPreview(student);

    ['rName','rId','rClass','rEmail'].forEach(f => document.getElementById(f).value = '');
    showMsg(msgEl, `✓ ${name} enrolled with face + QR!`, 'ok');
    toast(`${name} registered!`, 'ok');
    updateDashboard();

  } catch(e) { showMsg(msgEl, 'Error: ' + e.message, 'err'); console.error(e); }
}

function showQRPreview(student) {
  const card = document.getElementById('qrPreviewCard');
  const out  = document.getElementById('qrOutput');
  card.style.display = '';
  out.innerHTML = '';
  const canvas = document.createElement('canvas');
  out.appendChild(canvas);
  QRCode.toCanvas(canvas, makeQRData(student), {
    width: 200, margin: 2,
    color: { dark: '#00F5D4', light: '#0D1220' }
  });
  card._student = student;
}

function makeQRData(student) {
  return JSON.stringify({ id: student.id, name: student.name, class: student.class || '', type: 'faceattend' });
}

function downloadQR() {
  const card = document.getElementById('qrPreviewCard');
  const s    = card._student;
  if (!s) return;
  const canvas = document.createElement('canvas');
  QRCode.toCanvas(canvas, makeQRData(s), { width: 400, margin: 3, color: { dark: '#000000', light: '#FFFFFF' } }, () => {
    const a = document.createElement('a');
    a.download = `QR_${s.name}_${s.id}.png`;
    a.href = canvas.toDataURL();
    a.click();
  });
}

// ══════════════════════════════════════════════════════════
//  STREAM HELPERS
// ══════════════════════════════════════════════════════════
async function getCam(id) {
  if (streams[id]) stopStream(id);
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
  streams[id] = stream;
  return stream;
}

function stopStream(id) {
  if (streams[id]) { streams[id].getTracks().forEach(t => t.stop()); delete streams[id]; }
  if (loops[id])   { clearTimeout(loops[id]); cancelAnimationFrame(loops[id]); delete loops[id]; }
}

// ══════════════════════════════════════════════════════════
//  HYBRID ATTENDANCE
// ══════════════════════════════════════════════════════════
let hybridMode = 'auto'; // 'auto' | 'face' | 'qr'

function setHybridMode(mode) {
  hybridMode = mode;
  ['modeAuto','modeFace','modeQr'].forEach(id => document.getElementById(id).classList.remove('active'));
  const map = { auto:'modeAuto', face:'modeFace', qr:'modeQr' };
  document.getElementById(map[mode]).classList.add('active');
  const qrZone = document.getElementById('qrZone');
  qrZone.style.display = (mode === 'qr' || mode === 'auto') ? '' : 'none';
}

async function startHybridCam() {
  if (!modelsLoaded && hybridMode !== 'qr') { toast('AI models not ready', 'err'); return; }
  if (getStudents().length === 0) { toast('No students registered yet!', 'err'); return; }

  try {
    const stream = await getCam('hybrid');
    const video  = document.getElementById('hybridVideo');
    video.srcObject = stream;
    await video.play();
    document.getElementById('hybridStartBtn').style.display = 'none';
    document.getElementById('hybridStopBtn').style.display = '';
    setHybridStatus('scanning', '◎ SCANNING…');
    hybridLoop(video);
  } catch(e) { toast('Camera error: ' + e.message, 'err'); }
}

function stopHybridCam() {
  stopStream('hybrid');
  document.getElementById('hybridStartBtn').style.display = '';
  document.getElementById('hybridStopBtn').style.display = 'none';
  setHybridStatus('idle', '⬡ READY — Start camera to begin');
  document.getElementById('hybridOverlay').getContext('2d').clearRect(0,0,9999,9999);
}

async function hybridLoop(video) {
  if (!streams['hybrid']) return;

  const canvas  = document.getElementById('hybridOverlay');
  canvas.width  = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let recognized = false;

  // ── QR Detection ──
  if (hybridMode === 'auto' || hybridMode === 'qr') {
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width  = video.videoWidth || 640;
      tempCanvas.height = video.videoHeight || 480;
      const tCtx = tempCanvas.getContext('2d');
      tCtx.drawImage(video, 0, 0);
      const imageData = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const qrResult  = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });

      if (qrResult) {
        try {
          const data = JSON.parse(qrResult.data);
          if (data.type === 'faceattend' && data.id) {
            const student = getStudents().find(s => s.id === data.id);
            if (student) {
              const now = Date.now();
              const cd  = cooldowns['hybrid'] || {};
              if (!cd[student.id] || now - cd[student.id] > COOLDOWN_MS) {
                cd[student.id] = now;
                cooldowns['hybrid'] = cd;
                markAttendance(student, 'qr', 'hybrid');
                recognized = true;
              } else {
                setHybridStatus('dup', `✓ ${student.name} — Already Marked`);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  // ── Face Detection ──
  if (!recognized && (hybridMode === 'auto' || hybridMode === 'face') && faceMatcher) {
    try {
      const faceOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
      const dets = await faceapi.detectAllFaces(video, faceOpts).withFaceLandmarks().withFaceDescriptors();

      if (dets && dets.length > 0) {
        const dims = { width: video.videoWidth, height: video.videoHeight };
        const resized = faceapi.resizeResults(dets, dims);

        for (const det of resized) {
          const match = faceMatcher.findBestMatch(det.descriptor);
          const box   = det.detection.box;

          if (match.label !== 'unknown') {
            ctx.strokeStyle = '#00F5D4';
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);
            ctx.fillStyle = 'rgba(0,245,212,0.08)';
            ctx.fillRect(box.x, box.y, box.width, box.height);
            // Name label
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(box.x, box.y - 24, box.width, 24);
            ctx.fillStyle = '#00F5D4';
            ctx.font = 'bold 13px JetBrains Mono, monospace';
            ctx.fillText(match.label, box.x + 4, box.y - 8);

            const student = getStudents().find(s => s.id === match.label);
            if (student) {
              const now = Date.now();
              const cd  = cooldowns['hybrid'] || {};
              if (!cd[student.id] || now - cd[student.id] > COOLDOWN_MS) {
                cd[student.id] = now;
                cooldowns['hybrid'] = cd;
                markAttendance(student, 'face', 'hybrid');
                recognized = true;
              } else {
                setHybridStatus('dup', `✓ ${student.name} — Already Marked`);
              }
            }
          } else {
            ctx.strokeStyle = '#F87171';
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);
          }
        }
        if (!recognized) setHybridStatus('scanning', '◎ SCANNING…');
      } else {
        setHybridStatus('scanning', '◎ SCANNING…');
      }
    } catch {}
  }

  loops['hybrid'] = setTimeout(() => hybridLoop(video), 400);
}

function setHybridStatus(type, msg) {
  document.getElementById('hybridResult').innerHTML = `<div class="ars ${type}">${msg}</div>`;
}

// ══════════════════════════════════════════════════════════
//  FACE ONLY CAM
// ══════════════════════════════════════════════════════════
async function startFaceCam() {
  if (!modelsLoaded) { toast('AI models not ready', 'err'); return; }
  if (getStudents().length === 0) { toast('No students registered!', 'err'); return; }
  try {
    const stream = await getCam('face');
    const video  = document.getElementById('faceVideo');
    video.srcObject = stream;
    await video.play();
    document.getElementById('faceStartBtn').style.display = 'none';
    document.getElementById('faceStopBtn').style.display = '';
    faceLoop(video);
  } catch(e) { toast('Camera error: ' + e.message, 'err'); }
}

function stopFaceCam() {
  stopStream('face');
  document.getElementById('faceStartBtn').style.display = '';
  document.getElementById('faceStopBtn').style.display = 'none';
  document.getElementById('faceResult').innerHTML = `<div class="ars idle">⬡ WAITING</div>`;
}

async function faceLoop(video) {
  if (!streams['face']) return;
  const canvas = document.getElementById('faceOverlay');
  canvas.width  = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (faceMatcher) {
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
    const dets = await faceapi.detectAllFaces(video, opts).withFaceLandmarks().withFaceDescriptors();
    if (dets && dets.length > 0) {
      const resized = faceapi.resizeResults(dets, { width: video.videoWidth, height: video.videoHeight });
      for (const det of resized) {
        const match = faceMatcher.findBestMatch(det.descriptor);
        const box   = det.detection.box;
        if (match.label !== 'unknown') {
          ctx.strokeStyle = '#00F5D4'; ctx.lineWidth = 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
          const student = getStudents().find(s => s.id === match.label);
          if (student) {
            const now = Date.now();
            const cd  = cooldowns['face'] || {};
            if (!cd[student.id] || now - cd[student.id] > COOLDOWN_MS) {
              cd[student.id] = now; cooldowns['face'] = cd;
              markAttendance(student, 'face', 'face');
            } else {
              document.getElementById('faceResult').innerHTML = `<div class="ars dup">✓ ${student.name} — Already Marked</div>`;
            }
          }
        } else {
          ctx.strokeStyle = '#F87171'; ctx.lineWidth = 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
          document.getElementById('faceResult').innerHTML = `<div class="ars err">✗ Face not recognized</div>`;
        }
      }
    } else {
      document.getElementById('faceResult').innerHTML = `<div class="ars scanning">◎ SCANNING…</div>`;
    }
  }
  loops['face'] = setTimeout(() => faceLoop(video), 400);
}

// ══════════════════════════════════════════════════════════
//  QR ONLY CAM
// ══════════════════════════════════════════════════════════
async function startQRCam() {
  try {
    const stream = await getCam('qr');
    const video  = document.getElementById('qrVideo');
    video.srcObject = stream;
    await video.play();
    document.getElementById('qrStartBtn').style.display = 'none';
    document.getElementById('qrStopBtn').style.display = '';
    qrLoop(video);
  } catch(e) { toast('Camera error: ' + e.message, 'err'); }
}

function stopQRCam() {
  stopStream('qr');
  document.getElementById('qrStartBtn').style.display = '';
  document.getElementById('qrStopBtn').style.display = 'none';
  document.getElementById('qrResult').innerHTML = `<div class="ars idle">▣ Point QR code at camera</div>`;
}

function qrLoop(video) {
  if (!streams['qr']) return;
  const canvas = document.getElementById('qrOverlay');
  canvas.width  = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const temp = document.createElement('canvas');
  temp.width = video.videoWidth || 640;
  temp.height = video.videoHeight || 480;
  const tCtx = temp.getContext('2d');
  tCtx.drawImage(video, 0, 0);

  try {
    const imgData = tCtx.getImageData(0, 0, temp.width, temp.height);
    const code    = jsQR(imgData.data, imgData.width, imgData.height);
    if (code) {
      try {
        const data = JSON.parse(code.data);
        if (data.type === 'faceattend' && data.id) {
          const student = getStudents().find(s => s.id === data.id);
          if (student) {
            const now = Date.now();
            const cd  = cooldowns['qr'] || {};
            if (!cd[student.id] || now - cd[student.id] > COOLDOWN_MS) {
              cd[student.id] = now; cooldowns['qr'] = cd;
              markAttendance(student, 'qr', 'qrscan');
            } else {
              document.getElementById('qrResult').innerHTML = `<div class="ars dup">✓ ${student.name} — Already Marked</div>`;
            }
          } else {
            document.getElementById('qrResult').innerHTML = `<div class="ars err">✗ Student not found</div>`;
          }
        }
      } catch {}
    } else {
      document.getElementById('qrResult').innerHTML = `<div class="ars scanning">◎ SCANNING…</div>`;
    }
  } catch {}

  loops['qr'] = setTimeout(() => qrLoop(video), 200);
}

// ══════════════════════════════════════════════════════════
//  MARK ATTENDANCE (shared)
// ══════════════════════════════════════════════════════════
async function markAttendance(student, method, page) {
  const now     = new Date();
  const time    = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const date    = now.toLocaleDateString('en-IN');
  const att     = getTodayAtt();

  // Prevent double marking same student same day
  if (att.find(r => r.id === student.id)) {
    const rstEl = page !== 'qrscan' && page !== 'face' ? 'hybridResult' : page === 'face' ? 'faceResult' : 'qrResult';
    document.getElementById(rstEl).innerHTML = `<div class="ars dup">✓ ${student.name} — Already Marked</div>`;
    return;
  }

  const record = { id: student.id, name: student.name, class: student.class || '', email: student.email || '', method, time, date, timestamp: now.toISOString() };
  att.push(record);
  setTodayAtt(att);

  // Update UI
  const statusEl = page === 'face' ? 'faceResult' : page === 'qrscan' ? 'qrResult' : 'hybridResult';
  document.getElementById(statusEl).innerHTML = `<div class="ars ok">✅ ${student.name} — PRESENT (${method.toUpperCase()})</div>`;

  // Flash
  const flashId = page === 'face' ? 'faceFlash' : page === 'hybrid' ? 'recogFlash' : null;
  if (flashId) {
    const fl = document.getElementById(flashId);
    fl.className = 'recog-flash success';
    setTimeout(() => fl.className = 'recog-flash', 700);
  }

  toast(`✓ ${student.name} marked via ${method.toUpperCase()}`, 'ok');

  // Update logs
  updateLogUI(page, record);
  updateLogUI('hybrid', record); // keep hybrid log synced
  updateDashboard();
  sendToSheet(record);

  // Auto-reset status after 2.5s
  setTimeout(() => {
    if (streams[page] || streams['hybrid']) {
      if (page === 'face') document.getElementById('faceResult').innerHTML = `<div class="ars scanning">◎ SCANNING…</div>`;
      else if (page === 'qrscan') document.getElementById('qrResult').innerHTML = `<div class="ars scanning">◎ SCANNING…</div>`;
      else document.getElementById('hybridResult').innerHTML = `<div class="ars scanning">◎ SCANNING…</div>`;
    }
  }, 2500);
}

function updateLogUI(page, record) {
  const logIds = { hybrid: 'hybridLog', face: 'faceLog', qrscan: 'qrLog' };
  const countIds = { hybrid: 'hybridLogCount', face: 'faceLogCount', qrscan: 'qrLogCount' };
  const logEl   = document.getElementById(logIds[page]);
  const countEl = document.getElementById(countIds[page]);
  if (!logEl) return;

  const att = getTodayAtt();
  if (countEl) countEl.textContent = att.length;
  logEl.innerHTML = [...att].reverse().map(r => `
    <div class="log-item">
      <div class="li-name">${r.name}</div>
      <div class="li-id">${r.id}</div>
      <div class="li-time">${r.time}</div>
      <div class="li-method ${r.method}">${r.method.toUpperCase()}</div>
    </div>`).join('') || '<div class="empty-state">No records yet.</div>';
}

function clearTodayLog() {
  if (!confirm('Clear today\'s attendance?')) return;
  S.del(todayKey());
  ['hybrid','face','qrscan'].forEach(p => updateLogUI(p, null));
  updateDashboard();
  toast('Today\'s log cleared', 'ok');
}

// ══════════════════════════════════════════════════════════
//  DASHBOARD + CHARTS
// ══════════════════════════════════════════════════════════
function updateDashboard() {
  const students = getStudents();
  const todayAtt = getTodayAtt();
  const total    = students.length;
  const present  = todayAtt.length;
  const rate     = total > 0 ? Math.round((present / total) * 100) : 0;
  const records  = getTotalRecs();

  document.getElementById('stTotal').textContent   = total;
  document.getElementById('stPresent').textContent = present;
  document.getElementById('stRate').textContent    = rate + '%';
  document.getElementById('stRecords').textContent = records;

  // Progress bars
  const maxRec = Math.max(records, 1);
  document.getElementById('stTotalBar').style.width   = Math.min(total * 5, 100) + '%';
  document.getElementById('stPresentBar').style.width = (total > 0 ? (present/total)*100 : 0) + '%';
  document.getElementById('stRateBar').style.width    = rate + '%';
  document.getElementById('stRecordsBar').style.width = Math.min((records/100)*100, 100) + '%';

  updateRecentFeed();
  updateCharts();
}

function updateRecentFeed() {
  const att = getTodayAtt();
  const el  = document.getElementById('recentFeed');
  if (!att.length) { el.innerHTML = '<div class="empty-state">No activity today yet.</div>'; return; }
  el.innerHTML = [...att].reverse().slice(0, 8).map(r => `
    <div class="feed-item">
      <div class="fi-dot ${r.method}"></div>
      <div class="fi-name">${r.name}</div>
      <div class="fi-id">${r.id}</div>
      <div class="fi-method ${r.method}">${r.method.toUpperCase()}</div>
      <div class="fi-time">${r.time}</div>
    </div>`).join('');
}

// ── CHART.JS CHARTS ──────────────────────────────────────
function initCharts() {
  Chart.defaults.color = '#94A3B8';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 11;

  // ─ Weekly Bar Chart ─
  const weekCtx = document.getElementById('weeklyChart').getContext('2d');
  chartWeekly = new Chart(weekCtx, {
    type: 'bar',
    data: { labels: [], datasets: [
      { label: 'Present', data: [], backgroundColor: 'rgba(0,245,212,0.7)', borderRadius: 4, borderSkipped: false },
      { label: 'Absent',  data: [], backgroundColor: 'rgba(124,58,237,0.4)', borderRadius: 4, borderSkipped: false },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { mode: 'index' } },
      scales: {
        x: { stacked: false, grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { stacked: false, beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });

  // ─ Today Donut Chart ─
  const todayCtx = document.getElementById('todayChart').getContext('2d');
  chartToday = new Chart(todayCtx, {
    type: 'doughnut',
    data: { labels: ['Present','Absent'], datasets: [{ data: [0, 0], backgroundColor: ['rgba(0,245,212,0.8)','rgba(124,58,237,0.5)'], borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed} students` } } }
    }
  });

  // ─ Hourly Line Chart ─
  const hourCtx = document.getElementById('hourlyChart').getContext('2d');
  chartHourly = new Chart(hourCtx, {
    type: 'line',
    data: { labels: [], datasets: [{
      label: 'Check-ins', data: [],
      borderColor: 'rgba(0,245,212,0.9)',
      backgroundColor: 'rgba(0,245,212,0.08)',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: '#00F5D4',
      tension: 0.4,
      fill: true,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' } } }
    }
  });

  // Set week range label
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6);
  document.getElementById('weekRange').textContent =
    weekStart.toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) + ' – ' +
    now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

  updateCharts();
}

function updateCharts() {
  const students = getStudents().length;
  const todayAtt = getTodayAtt();

  // ─ Weekly data (last 7 days) ─
  const labels = [], present = [], absent = [];
  for (let i = 6; i >= 0; i--) {
    const d   = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const att = S.get('fp_att_' + key, []).length;
    labels.push(d.toLocaleDateString('en-IN', { weekday:'short', day:'2-digit' }));
    present.push(att);
    absent.push(Math.max(0, students - att));
  }
  if (chartWeekly) {
    chartWeekly.data.labels = labels;
    chartWeekly.data.datasets[0].data = present;
    chartWeekly.data.datasets[1].data = absent;
    chartWeekly.update('active');
  }

  // ─ Today donut ─
  const p = todayAtt.length;
  const a = Math.max(0, students - p);
  if (chartToday) {
    chartToday.data.datasets[0].data = [p, a];
    chartToday.update('active');
  }
  // Legend
  const legend = document.getElementById('donutLegend');
  legend.innerHTML = `
    <div class="dl-item"><div class="dl-dot" style="background:#00F5D4"></div>Present: <strong>${p}</strong></div>
    <div class="dl-item"><div class="dl-dot" style="background:rgba(124,58,237,0.7)"></div>Absent: <strong>${a}</strong></div>
    <div class="dl-item" style="margin-top:4px;font-size:0.85rem;color:#00F5D4"><strong>${students > 0 ? Math.round((p/students)*100) : 0}%</strong> Rate</div>`;

  // ─ Hourly ─
  const hourMap = {};
  for (let h = 7; h <= 18; h++) hourMap[h] = 0;
  todayAtt.forEach(r => {
    const hr = parseInt(r.time.split(':')[0]);
    if (hourMap[hr] !== undefined) hourMap[hr]++;
    else hourMap[hr] = 1;
  });
  const hLabels = Object.keys(hourMap).map(h => h + ':00');
  const hData   = Object.values(hourMap);
  if (chartHourly) {
    chartHourly.data.labels = hLabels;
    chartHourly.data.datasets[0].data = hData;
    chartHourly.update('active');
  }
}

// ══════════════════════════════════════════════════════════
//  STUDENTS PAGE
// ══════════════════════════════════════════════════════════
function renderStudents(list) {
  const students = list || getStudents();
  const grid = document.getElementById('stuGrid');
  document.getElementById('stuCount').textContent = students.length + ' student' + (students.length !== 1 ? 's' : '');

  if (!students.length) {
    grid.innerHTML = '<div class="empty-state wide">No students registered yet.</div>';
    return;
  }

  grid.innerHTML = students.map(s => `
    <div class="stu-card">
      <div class="sa-row">
        <div class="sa-av">${s.name[0].toUpperCase()}</div>
        <button class="sa-del" onclick="deleteStu('${s.id}')" title="Delete">✕</button>
      </div>
      <div class="sa-name">${s.name}</div>
      <div class="sa-id">${s.id}</div>
      ${s.class ? `<div class="sa-class">${s.class}</div>` : ''}
      <div class="sa-tags">
        ${s.descriptor ? '<span class="sa-tag tag-face">◎ FACE</span>' : ''}
        <span class="sa-tag tag-qr">▣ QR</span>
      </div>
      <div class="sa-qr" id="sqr-${s.id}"></div>
    </div>`).join('');

  // Render small QR codes
  setTimeout(() => {
    students.forEach(s => {
      const el = document.getElementById('sqr-' + s.id);
      if (!el) return;
      const c = document.createElement('canvas');
      el.appendChild(c);
      try { QRCode.toCanvas(c, makeQRData(s), { width: 60, margin: 1, color: { dark: '#00F5D4', light: '#111827' } }); } catch {}
    });
  }, 0);
}

function filterStudents() {
  const q = document.getElementById('stuSearch').value.toLowerCase();
  renderStudents(getStudents().filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.id.toLowerCase().includes(q) ||
    (s.class || '').toLowerCase().includes(q)
  ));
}

function deleteStu(id) {
  if (!confirm('Delete this student? Face data will be removed.')) return;
  setStudents(getStudents().filter(s => s.id !== id));
  buildFaceMatcher();
  renderStudents();
  updateDashboard();
  toast('Student removed', 'ok');
}

// ══════════════════════════════════════════════════════════
//  RECORDS PAGE
// ══════════════════════════════════════════════════════════
function renderRecords(dateFilter) {
  const today = new Date().toISOString().slice(0, 10);
  const key   = dateFilter || today;
  document.getElementById('recDate').value = key;

  const records = getDateAtt(key);
  const tbody   = document.getElementById('recordsBody');
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No records for this date.</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(r => `
    <tr>
      <td>${r.date}</td>
      <td style="font-family:var(--mono)">${r.time}</td>
      <td><strong>${r.name}</strong></td>
      <td style="font-family:var(--mono);color:var(--txt2)">${r.id}</td>
      <td style="color:var(--txt2)">${r.class || '—'}</td>
      <td><span class="method-badge ${r.method}" style="${r.method==='face'?'background:rgba(0,245,212,0.1);color:#00F5D4':'background:rgba(124,58,237,0.1);color:#7C3AED'}">${r.method.toUpperCase()}</span></td>
    </tr>`).join('');
}

function filterRecords() {
  renderRecords(document.getElementById('recDate').value);
}

// ══════════════════════════════════════════════════════════
//  EXPORT CSV
// ══════════════════════════════════════════════════════════
function downloadTodayCSV() {
  const att = getTodayAtt();
  if (!att.length) { toast('No records to export', 'err'); return; }
  const header = 'Date,Time,Name,Student ID,Class,Method\n';
  const rows   = att.map(r => `${r.date},${r.time},${r.name},${r.id},${r.class||''},${r.method}`).join('\n');
  const blob   = new Blob([header + rows], { type: 'text/csv' });
  const a      = document.createElement('a');
  a.href       = URL.createObjectURL(blob);
  a.download   = `attendance_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('CSV downloaded!', 'ok');
}

// ══════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════
function loadSettingsUI() {
  const s = getSettings();
  const c = getCreds();
  document.getElementById('setScriptUrl').value = s.scriptUrl || '';
  document.getElementById('setSheetUrl').value  = s.sheetUrl  || '';
  document.getElementById('setUser').value = c.user;
  document.getElementById('setThresh').value = s.threshold || 0.45;
  document.getElementById('threshVal').textContent = s.threshold || 0.45;
  document.getElementById('setCooldown').value = s.cooldown || 5;
}

function updateThreshLabel(v) {
  document.getElementById('threshVal').textContent = parseFloat(v).toFixed(2);
}

function saveSettings() {
  const s = getSettings();
  s.scriptUrl = document.getElementById('setScriptUrl').value.trim();
  s.sheetUrl  = document.getElementById('setSheetUrl').value.trim();
  setSettingsDb(s);
  showMsg(document.getElementById('setMsg'), '✓ Saved!', 'ok');
  toast('Settings saved!', 'ok');
}

function saveRecogSettings() {
  const s = getSettings();
  s.threshold = parseFloat(document.getElementById('setThresh').value);
  s.cooldown  = parseInt(document.getElementById('setCooldown').value) || 5;
  FACE_THRESHOLD = s.threshold;
  COOLDOWN_MS    = s.cooldown * 1000;
  setSettingsDb(s);
  buildFaceMatcher();
  toast('Recognition settings saved!', 'ok');
}

function updateCreds() {
  const u = document.getElementById('setUser').value.trim();
  const p = document.getElementById('setPass').value;
  const c = document.getElementById('setPassC').value;
  const el = document.getElementById('credMsg');
  if (!u) { showMsg(el, 'Username required', 'err'); return; }
  if (p && p.length < 6) { showMsg(el, 'Password min 6 chars', 'err'); return; }
  if (p !== c) { showMsg(el, 'Passwords don\'t match', 'err'); return; }
  const cur = getCreds();
  setCreds({ user: u, pass: p || cur.pass });
  document.getElementById('sbUsername').textContent = u;
  document.getElementById('sbAvatar').textContent   = u[0].toUpperCase();
  showMsg(el, '✓ Credentials updated!', 'ok');
  document.getElementById('setPass').value  = '';
  document.getElementById('setPassC').value = '';
  toast('Credentials updated!', 'ok');
}

function clearAllStudents() {
  if (!confirm('Delete ALL students permanently?')) return;
  setStudents([]);
  buildFaceMatcher();
  updateDashboard();
  toast('All students deleted', 'ok');
}

function clearAllData() {
  if (!confirm('WIPE ALL DATA? This cannot be undone.')) return;
  if (!confirm('Final confirmation — wipe everything?')) return;
  const keys = Object.keys(localStorage).filter(k => k.startsWith('fp_'));
  keys.forEach(k => localStorage.removeItem(k));
  location.reload();
}

// ══════════════════════════════════════════════════════════
//  GOOGLE SHEETS SYNC
// ══════════════════════════════════════════════════════════
function openSheet() {
  const s = getSettings();
  if (s.sheetUrl) window.open(s.sheetUrl, '_blank');
  else toast('Google Sheet URL not configured', 'err');
}

async function sendToSheet(record) {
  const s = getSettings();
  if (!s.scriptUrl) return;
  try {
    await fetch(s.scriptUrl, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'markAttendance', ...record }),
    });
  } catch(e) { console.warn('Sheet sync failed:', e); }
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function showMsg(el, msg, type) {
  el.textContent = msg;
  el.className = 'msg-box ' + type;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

let toastTmr;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast ' + type;
  el.classList.remove('hidden');
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => el.classList.add('hidden'), 3200);
}

// ══════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
});
