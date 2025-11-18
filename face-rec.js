// face-rec.js — improved, robust face-expression detector + auto-SOS
// Place this AFTER the face-api script include in index.html and after app.js (so startCancelableSOS exist).

/* ===== CONFIG ===== */
const MODEL_PATH = '/models';                // where models are served from
const SCORE_THRESHOLD = 0.25;               // per-frame threshold
const REQUIRED_CONSECUTIVE_SECONDS = 1.0;   // seconds above threshold to trigger
const MIN_FPS = 3;                          // lower bound for analysis frequency
const MAX_WAIT_FACEAPI_MS = 8000;           // wait up to 8s for faceapi to load
const INPUT_SIZE = 256;                     // tiny face detector inputSize (128/256/416)

/* ===== STATE ===== */
let modelsLoaded = false;
let monitoring = false;
let videoEl = null;
let overlayEl = null;
let statusDotEl = null;
let detectorContainer = null;
let lastFrameTime = 0;
let aboveThresholdAccum = 0; // seconds
let rafId = null;

/* ===== Helpers ===== */
function fdlog(...args) { try { console.log('[face-rec]', ...args); } catch(e){} }

function ensureDetectorContainer() {
  if (detectorContainer) return detectorContainer;
  // try to find sos panel
  const panel = document.querySelector('.panel.sos-card') || document.querySelector('.sos-card');
  if (panel) {
    // look for existing placeholder
    let existing = panel.querySelector('#detectorContainer');
    if (existing) { detectorContainer = existing; return detectorContainer; }
    // create container and insert near the top of the panel content
    const box = document.createElement('div');
    box.id = 'detectorContainer';
    box.style.width = '100%';
    box.style.height = '320px';
    box.style.borderRadius = '12px';
    box.style.overflow = 'hidden';
    box.style.position = 'relative';
    box.style.background = '#000';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    box.style.color = 'rgba(255,255,255,0.5)';
    box.textContent = 'Camera preview will appear here once allowed';
    // Insert at top of panel content after heading
    const heading = panel.querySelector('h2, h3, .muted');
    if (heading && heading.parentNode) {
      heading.parentNode.insertBefore(box, heading.nextSibling);
    } else {
      panel.insertBefore(box, panel.firstChild);
    }
    detectorContainer = box;
    return detectorContainer;
  }

  // fallback -> append to body fixed corner
  fdlog('detectorContainer not found in page; appending fallback container');
  const fallback = document.createElement('div');
  fallback.id = 'detectorContainer';
  fallback.style.position = 'fixed';
  fallback.style.right = '18px';
  fallback.style.bottom = '18px';
  fallback.style.width = '320px';
  fallback.style.height = '200px';
  fallback.style.borderRadius = '12px';
  fallback.style.background = 'rgba(0,0,0,0.6)';
  fallback.style.zIndex = '9999';
  fallback.style.display = 'flex';
  fallback.style.alignItems = 'center';
  fallback.style.justifyContent = 'center';
  fallback.style.color = '#fff';
  fallback.textContent = 'Camera preview';
  document.body.appendChild(fallback);
  detectorContainer = fallback;
  return detectorContainer;
}

function createVideoElements() {
  if (!detectorContainer) throw new Error('detectorContainer missing');
  // remove placeholder text
  detectorContainer.innerHTML = '';

  // video element
  videoEl = document.createElement('video');
  videoEl.id = 'faceVideo';
  videoEl.autoplay = true;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.style.width = '100%';
  videoEl.style.height = '100%';
  videoEl.style.objectFit = 'cover';
  detectorContainer.appendChild(videoEl);

  // overlay
  overlayEl = document.createElement('div');
  overlayEl.id = 'faceOverlay';
  overlayEl.style.position = 'absolute';
  overlayEl.style.left = '12px';
  overlayEl.style.bottom = '12px';
  overlayEl.style.padding = '8px 10px';
  overlayEl.style.background = 'rgba(0,0,0,0.6)';
  overlayEl.style.color = '#fff';
  overlayEl.style.borderRadius = '8px';
  overlayEl.style.fontWeight = '600';
  overlayEl.style.zIndex = '20';
  overlayEl.style.display = 'none';
  detectorContainer.appendChild(overlayEl);

  // status dot
  statusDotEl = document.createElement('div');
  statusDotEl.id = 'faceStatusDot';
  statusDotEl.style.position = 'absolute';
  statusDotEl.style.right = '12px';
  statusDotEl.style.top = '12px';
  statusDotEl.style.width = '12px';
  statusDotEl.style.height = '12px';
  statusDotEl.style.borderRadius = '50%';
  statusDotEl.style.background = 'rgba(150,150,150,0.4)';
  statusDotEl.style.zIndex = '20';
  detectorContainer.appendChild(statusDotEl);
}

/* Wait for faceapi to be available */
function waitForFaceApi(timeoutMs = MAX_WAIT_FACEAPI_MS) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      if (window.faceapi) return resolve(window.faceapi);
      if (Date.now() - start > timeoutMs) return reject(new Error('faceapi not available after timeout'));
      setTimeout(check, 150);
    }
    check();
  });
}

/* Load models */
async function loadModels() {
  if (!window.faceapi) throw new Error('faceapi missing');
  fdlog('loading models from', MODEL_PATH);
  // check files by attempting to fetch manifest (fail early)
  const manifestPaths = [
    `${MODEL_PATH}/tiny_face_detector/tiny_face_detector_model-weights_manifest.json`,
    `${MODEL_PATH}/face_expression/face_expression_model-weights_manifest.json`,
    `${MODEL_PATH}/face_landmark_68/face_landmark_68_model-weights_manifest.json`
  ];
  for (const p of manifestPaths) {
    try {
      const r = await fetch(p, { method: 'GET' });
      if (!r.ok) throw new Error(`model manifest not found: ${p} (status ${r.status})`);
    } catch (err) {
      throw new Error('Required Face-API model manifest missing: ' + err.message);
    }
  }

  // load networks
  await faceapi.nets.tinyFaceDetector.loadFromUri(`${MODEL_PATH}/tiny_face_detector`);
  await faceapi.nets.faceExpressionNet.loadFromUri(`${MODEL_PATH}/face_expression`);
  await faceapi.nets.faceLandmark68Net.loadFromUri(`${MODEL_PATH}/face_landmark_68`);
  modelsLoaded = true;
  fdlog('models loaded');
}

/* start camera */
async function initCamera() {
  if (!videoEl) createVideoElements();
  try {
    const constraints = { video: { facingMode: 'user' }, audio: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();
    overlayEl.style.display = 'block';
    overlayEl.textContent = 'Camera started';
    statusDotEl.style.background = '#0f0';
    fdlog('camera started');
    return true;
  } catch (err) {
    fdlog('camera error', err);
    if (overlayEl) { overlayEl.style.display = 'block'; overlayEl.textContent = 'Camera access denied or error'; }
    statusDotEl.style.background = '#f33';
    throw err;
  }
}

/* helper: dominant expression */
function dominantExpression(expressions) {
  if (!expressions) return { name:'unknown', score:0 };
  let best = { name: null, score: -1 };
  Object.entries(expressions).forEach(([k,v]) => { if (v > best.score) best = { name:k, score:v }; });
  return best;
}

/* detection frame (time-based smoothing) */
async function processFrame(nowMs) {
  try {
    if (!modelsLoaded || !videoEl || videoEl.paused || videoEl.ended) return;
    const dt = lastFrameTime ? Math.max(0, (nowMs - lastFrameTime)/1000) : 0.1;
    lastFrameTime = nowMs;

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: INPUT_SIZE, scoreThreshold: 0.5 });
    const res = await faceapi.detectSingleFace(videoEl, options).withFaceLandmarks().withFaceExpressions();

    if (!res) {
      overlayEl.style.display = 'block';
      overlayEl.textContent = 'No face';
      statusDotEl.style.background = 'rgba(150,150,150,0.4)';
      aboveThresholdAccum = 0;
      return;
    }

    const expr = res.expressions || {};
    const dom = dominantExpression(expr);
    overlayEl.style.display = 'block';
    overlayEl.textContent = `${dom.name} ${dom.score.toFixed(2)}`;

    // compute trigger condition: fear OR (sad + angry) OR angry alone
    const fear = expr.fear || 0;
    const sad = expr.sad || 0;
    const angry = expr.angry || 0;
    const combined = sad + angry;

    const triggeredFrame = (fear >= SCORE_THRESHOLD) || (combined >= SCORE_THRESHOLD) || (angry >= SCORE_THRESHOLD);

    if (triggeredFrame) {
      // add dt to accumulator
      aboveThresholdAccum += dt;
      statusDotEl.style.background = '#ff6b6b';
      fdlog('above threshold', { fear, sad, angry, combined, aboveThresholdAccum });
    } else {
      // decay accumulator gradually (prevents single blips triggering)
      aboveThresholdAccum = Math.max(0, aboveThresholdAccum - dt * 2.0);
      statusDotEl.style.background = '#0f0';
    }

    // ======= Trigger logic with debounce/suppression (your requested block) =======
    if (aboveThresholdAccum >= REQUIRED_CONSECUTIVE_SECONDS) {
      fdlog('Sustained distress detected; preparing to trigger SOS');

      // reset accumulator so it won't immediately re-trigger
      aboveThresholdAccum = 0;

      // small debounce guard (avoid re-trigger for a few seconds)
      if (window.__faceRecRecentlyTriggered) {
        fdlog('trigger suppressed (recent)');
      } else {
        // mark as recently triggered and clear after 5s
        window.__faceRecRecentlyTriggered = true;
        setTimeout(()=>{ window.__faceRecRecentlyTriggered = false; }, 5000);

        // prefer startCancelableSOS if available
        if (typeof window.startCancelableSOS === 'function') {
          try {
            window.startCancelableSOS();
            fdlog('startCancelableSOS called');
          } catch (e) {
            fdlog('error calling startCancelableSOS', e);
            // fallback to performAlertSequence if defined
            if (typeof window.performAlertSequence === 'function') {
              try { window.performAlertSequence(); fdlog('performAlertSequence called as fallback'); } catch(e2){ fdlog('fallback also failed', e2); }
            }
          }
        } else if (typeof window.performAlertSequence === 'function') {
          try {
            window.performAlertSequence();
            fdlog('performAlertSequence called');
          } catch (e) {
            fdlog('error calling performAlertSequence', e);
          }
        } else {
          fdlog('No SOS functions found on window. Expose startCancelableSOS or performAlertSequence in app.js');
        }
      }

      // brief pause to avoid immediate re-trigger while function runs
      await new Promise(r => setTimeout(r, 3000));
    }
    // ==============================================================================

  } catch (err) {
    fdlog('detection error', err);
    if (overlayEl) { overlayEl.style.display = 'block'; overlayEl.textContent = 'Detection error'; }
    aboveThresholdAccum = 0;
  }
}

/* rAF loop */
async function loopTick(ts) {
  await processFrame(ts);
  if (monitoring) rafId = requestAnimationFrame(loopTick);
}

/* start/stop monitoring functions (exposed) */
async function startFaceMonitor() {
  if (monitoring) return fdlog('monitor already running');
  try {
    ensureDetectorContainer();
    createVideoElements();
    // wait for faceapi
    try {
      await waitForFaceApi();
    } catch (err) {
      fdlog('faceapi not ready', err);
      if (overlayEl) { overlayEl.style.display='block'; overlayEl.textContent = 'face-api not loaded'; }
      return;
    }
    // load models if needed
    if (!modelsLoaded) {
      try {
        await loadModels();
      } catch (err) {
        fdlog('Error loading models', err);
        if (overlayEl) { overlayEl.style.display='block'; overlayEl.textContent = 'Model load failed'; }
        return;
      }
    }
    // init camera
    try {
      await initCamera();
    } catch (err) {
      fdlog('camera init failed', err);
      return;
    }
    // start loop
    monitoring = true;
    lastFrameTime = 0;
    aboveThresholdAccum = 0;
    rafId = requestAnimationFrame(loopTick);
    fdlog('face monitor started');
  } catch (err) {
    fdlog('startFaceMonitor error', err);
  }
}

function stopFaceMonitor() {
  monitoring = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  // stop camera tracks
  try {
    if (videoEl && videoEl.srcObject) {
      const tracks = videoEl.srcObject.getTracks() || [];
      tracks.forEach(t => { try { t.stop(); } catch(e){} });
      videoEl.srcObject = null;
    }
  } catch(e){}
  fdlog('face monitor stopped');
}

/* bootstrap automatically on DOMContentLoaded */
(function bootstrapOnReady() {
  function go() {
    try {
      ensureDetectorContainer();
      // auto-start monitor (you can change to manual start if preferred)
      startFaceMonitor().catch(e => fdlog('auto start failed', e));
    } catch (err) {
      fdlog('bootstrap error', err);
    }
  }
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => { setTimeout(go, 50); });
  } else {
    setTimeout(go, 50);
  }
})();

/* Expose control for debugging */
window.faceRec = {
  start: startFaceMonitor,
  stop: stopFaceMonitor,
  isRunning: () => monitoring,
  config: {
    MODEL_PATH, SCORE_THRESHOLD, REQUIRED_CONSECUTIVE_SECONDS, INPUT_SIZE
  }
};
