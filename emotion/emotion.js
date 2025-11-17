// emotion/emotion.js
// Emotion detector using face-api.js
// Dispatches a CustomEvent 'emotionSOS' when a triggering emotion is detected.

const EMOTION_MODEL_PATH = '/models'; // <- where you placed face-api models
const CHECK_INTERVAL = 800; // ms between detections
const SOS_THRESHOLD = 0.65;  // when a target emotion probability >= this, trigger
const CONSENSUS_COUNT = 2;   // how many consecutive frames above threshold to trigger

let videoEl = null;
let running = false;
let consecutive = 0;
let modelsLoaded = false;

// list of expressions reported by face-api: neutral, happy, sad, angry, fearful, disgusted, surprised
const TARGET_EMOTIONS = ['fearful','angry','sad']; // treat these as "distress" candidates

async function loadModels() {
  if (modelsLoaded) return;
  // load tiny face detector + expression model
  await faceapi.nets.tinyFaceDetector.loadFromUri(EMOTION_MODEL_PATH);
  await faceapi.nets.faceExpressionNet.loadFromUri(EMOTION_MODEL_PATH);
  // optionally load tiny landmarks to improve stability
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri(EMOTION_MODEL_PATH);
  modelsLoaded = true;
  console.log('face-api models loaded');
}

function createVideoElement() {
  videoEl = document.createElement('video');
  videoEl.setAttribute('autoplay', '');
  videoEl.setAttribute('muted', '');
  videoEl.setAttribute('playsinline', '');
  videoEl.style.width = '320px';
  videoEl.style.height = '240px';
  videoEl.style.borderRadius = '8px';
  videoEl.style.border = '2px solid rgba(255,255,255,0.06)';
  return videoEl;
}

// start webcam feed + detection
export async function startEmotionWatcher(options = {}) {
  if (running) return;
  if (options.modelPath) {
    // allow override
    // (not used much — keep EMOTION_MODEL_PATH constant to simplify)
  }
  await loadModels();

  if (!videoEl) {
    // try to find placeholder area in DOM
    const container = document.querySelector('body') || document.documentElement;
    videoEl = createVideoElement();
    // append hidden (you can show it if you want)
    videoEl.style.position = 'fixed';
    videoEl.style.right = '12px';
    videoEl.style.bottom = '12px';
    videoEl.style.zIndex = 9999;
    videoEl.style.opacity = 0.02; // nearly invisible by default
    container.appendChild(videoEl);
  }

  // request webcam
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
  } catch (err) {
    console.error('Could not access webcam', err);
    return;
  }

  running = true;
  consecutive = 0;
  detectLoop();
}

export function stopEmotionWatcher() {
  if (!running) return;
  running = false;
  if (videoEl && videoEl.srcObject) {
    for (const track of videoEl.srcObject.getTracks()) track.stop();
    videoEl.remove();
    videoEl = null;
  }
}

// main loop
async function detectLoop() {
  while (running) {
    try {
      if (videoEl && videoEl.readyState >= 2) {
        // tiny face detector options
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 });
        const result = await faceapi.detectSingleFace(videoEl, options).withFaceLandmarks(true).withFaceExpressions();

        if (result && result.expressions) {
          const expressions = result.expressions;
          // find top emotion and its score
          const sorted = Object.keys(expressions).sort((a,b) => expressions[b] - expressions[a]);
          const top = sorted[0];
          const topScore = expressions[top];

          // compute combined distress score from target emotions
          let distressScore = 0;
          TARGET_EMOTIONS.forEach(e => { distressScore = Math.max(distressScore, expressions[e] || 0); });

          // optional: also consider 'surprised' as stress in some cases
          // distressScore = Math.max(distressScore, expressions['surprised'] * 0.6 || 0);

          // log minimal info (for debugging)
          // console.log('expr', expressions);

          // if distress high enough, bump consecutive counter
          if (distressScore >= (options && options.threshold || SOS_THRESHOLD)) {
            consecutive++;
            if (consecutive >= (options && options.consensus || CONSENSUS_COUNT)) {
              // trigger once and reset consecutive to avoid repeated fires
              consecutive = 0;
              triggerSOS({ reason: 'emotion', score: distressScore, top, topScore, expressions });
            }
          } else {
            // decay counter slowly
            consecutive = Math.max(0, consecutive - 1);
          }
        } else {
          // no face — reset
          consecutive = Math.max(0, consecutive - 1);
        }
      }
    } catch (err) {
      console.error('emotion detect error', err);
    }
    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }
}

// dispatch event that can be listened by the main app
function triggerSOS(data = {}) {
  logLocal('Emotion SOS triggered: ' + JSON.stringify({ reason: data.reason, score: data.score?.toFixed?.(2) || data.score }));
  // custom event
  window.dispatchEvent(new CustomEvent('emotionSOS', { detail: data }));
}

// local in-page log helper (keeps silent if no log area)
function logLocal(txt) {
  try {
    const area = document.getElementById('logArea');
    if (area) {
      const t = document.createElement('div');
      t.textContent = `${new Date().toLocaleString()} — ${txt}`;
      area.prepend(t);
    } else {
      console.log(txt);
    }
  } catch (e) { console.log(txt); }
}
