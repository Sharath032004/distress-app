// app.js (updated - drop into your site; keep same IDs in index.html)
// ==========================
//  Configuration
// ==========================
const CALL_FUNCTION_URL = '/.netlify/functions/call'; // change if your call function is on another host

// ==========================
//  EmailJS Initialization
// ==========================
(function () {
  if (window.emailjs) {
    try { emailjs.init('RR9SIRs9g99ygpLBQ'); } catch (e) { console.warn('EmailJS init failed', e); }
  }
})();

// ==========================
//  Helpers
// ==========================
const $ = id => document.getElementById(id);
function qsel(sel) { try { return document.querySelector(sel); } catch(e){ return null; } }

const log = (text) => {
  try {
    const area = $('logArea');
    if (!area) {
      // fallback console
      console.log('[LOG]', text);
      return;
    }
    const t = document.createElement('div');
    t.textContent = `${new Date().toLocaleString()} — ${text}`;
    area.prepend(t);
  } catch (e) {
    console.log('[LOG-ERR]', e, text);
  }
};

// safe JSON parse
function safeParse(raw, fallback = []) {
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

// sanitize for rendering
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ==========================
//  STATE
// ==========================
const CONTACTS_KEY = 'safe_contacts';
let map = null;
let marker = null;
let currentCoords = null;
let sosTimer = null;
let sosInProgress = false;

// ==========================
//  MAP
// ==========================
function initMap() {
  try {
    if (!qsel('#map')) return;
    map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  } catch (e) {
    console.warn('initMap error', e);
  }
}

// ==========================
//  GEOLOCATION
// ==========================
function shareLocation(showOnMap = true) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      alert('Geolocation not supported');
      log('Geolocation not supported');
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        currentCoords = { lat: latitude, lon: longitude };
        const coordsEl = $('coords');
        if (coordsEl) coordsEl.textContent = `Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        log('Location shared');
        if (showOnMap && map) {
          if (marker) map.removeLayer(marker);
          marker = L.marker([latitude, longitude]).addTo(map).bindPopup('You are here').openPopup();
          map.setView([latitude, longitude], 16);
        }
        resolve(currentCoords);
      },
      err => {
        alert('Could not get location: ' + err.message);
        log('Location error: ' + err.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

// ==========================
//  ALARM AUDIO
// ==========================
function playAlarm() {
  try {
    const audio = $('alarmAudio');
    if (audio) { audio.currentTime = 0; audio.play().catch(()=>{}); }
    log('Alarm sounded');
  } catch(e){ console.warn(e); }
}
function stopAlarm() {
  try { const audio = $('alarmAudio'); if (audio) { audio.pause(); audio.currentTime = 0; } } catch(e){}
}

// ==========================
//  CONTACTS (localStorage)
// ==========================
function loadContacts() {
  const raw = localStorage.getItem(CONTACTS_KEY);
  return raw ? safeParse(raw, []) : [];
}
function saveContacts(list) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(list));
  renderContacts();
}
function renderContacts() {
  const ul = $('contactsList');
  if (!ul) return;
  ul.innerHTML = '';
  const list = loadContacts();
  list.forEach((c, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        <div class="muted">Email: ${c.email ? escapeHtml(c.email) : '—'}</div>
        <div class="muted">Phone: ${c.phone ? escapeHtml(c.phone) : '—'}</div>
      </div>
      <div>
        <button data-i="${i}" class="ghost removeBtn">Remove</button>
      </div>
    `;
    ul.appendChild(li);
  });
  Array.from(document.getElementsByClassName('removeBtn')).forEach(btn=>{
    btn.onclick = (e) => {
      const i = Number(e.target.dataset.i);
      const l = loadContacts();
      l.splice(i,1);
      saveContacts(l);
      log('Contact removed');
    };
  });
}

// ==========================
//  CALL TRIGGER (Netlify function -> Twilio)
// ==========================
async function triggerCalls(phoneRecipients = [], currentCoordsParam = null) {
  if (!phoneRecipients || phoneRecipients.length === 0) {
    log('No phone numbers to call');
    return { ok: false, error: 'no recipients' };
  }
  try {
    const body = {
      to: phoneRecipients,
      message: `I need help. Location: ${currentCoordsParam ? currentCoordsParam.lat + ',' + currentCoordsParam.lon : 'Not available'}`,
      from_name: 'SafeWave User'
    };
    const resp = await fetch(CALL_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await resp.json().catch(()=>({}));
    if (resp.ok) {
      log(`Call requests sent to ${phoneRecipients.length} number(s)`);
      return json;
    } else {
      log('Call function returned error: ' + (json.error || resp.status));
      return json;
    }
  } catch (err) {
    console.error('Call error', err);
    log('Call request failed: see console');
    return { ok: false, error: err.message || err };
  }
}

// ==========================
//  SOS SEQUENCE
// ==========================
async function performAlertSequence() {
  // share location first
  await shareLocation(true);
  // alarm
  playAlarm();

  // email via EmailJS if configured
  try {
    const contacts = loadContacts();
    const emails = contacts.map(c => c.email).filter(Boolean);
    if (emails.length && window.emailjs) {
      const emailsStr = emails.join(',');
      const template_params = {
        to_email: emailsStr,
        from_name: 'SafeWave User',
        message: 'I need help. Please reach out as soon as possible.',
        lat: currentCoords ? currentCoords.lat : 'Not available',
        lon: currentCoords ? currentCoords.lon : 'Not available',
        time: new Date().toLocaleString()
      };
      try {
        await emailjs.send('service_hf9wccx','template_7wjlod7', template_params);
        log('Alert emailed to: ' + emailsStr);
      } catch (err) {
        console.error('EmailJS send error', err);
        log('Alert email failed');
      }
    } else {
      log('No emails configured or EmailJS not available');
    }
  } catch (e){ console.error(e); }

  // phone calls
  try {
    const contacts = loadContacts();
    const phoneRecipients = contacts.map(c => c.phone).filter(Boolean);
    if (phoneRecipients.length) {
      const callResult = await triggerCalls(phoneRecipients, currentCoords);
      if (callResult && callResult.ok) {
        log('Call(s) initiated successfully');
      } else {
        log('Call(s) failed: ' + (callResult && callResult.error ? callResult.error : 'unknown'));
      }
    } else {
      log('No phone numbers saved to call');
    }
  } catch (e) { console.error(e); }

  log('SOS sequence completed');
}

// expose performAlertSequence for face detection script
window.performAlertSequence = performAlertSequence;

// ==========================
//  CANCELABLE SOS (5s)
// ==========================
function startCancelableSOS() {
  if (sosInProgress) return;
  sosInProgress = true;
  const sosBtn = $('sosBtn');
  const cancelBtn = $('cancelBtn');
  if (sosBtn) sosBtn.disabled = true;
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  log('SOS initiated — you have 5 seconds to cancel');

  if (sosTimer) clearTimeout(sosTimer);
  sosTimer = setTimeout(async () => {
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (sosBtn) sosBtn.disabled = false;
    sosInProgress = false;
    await performAlertSequence();
  }, 5000);
}
window.startCancelableSOS = startCancelableSOS; // expose so face-rec.js can call it

function cancelSOS() {
  if (!sosInProgress) return;
  clearTimeout(sosTimer);
  sosTimer = null;
  sosInProgress = false;
  const sosBtn = $('sosBtn');
  const cancelBtn = $('cancelBtn');
  if (sosBtn) sosBtn.disabled = false;
  if (cancelBtn) cancelBtn.style.display = 'none';
  log('SOS canceled by user');
}

// ==========================
//  Test call helper
// ==========================
async function triggerTestCall(number) {
  if (!number) return;
  try {
    const resp = await fetch(CALL_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: [number], message: 'Test call from SafeWave', from_name: 'SafeWave Demo' })
    });
    const json = await resp.json().catch(()=>({}));
    console.log('CALL RESPONSE', json);
    alert('Test call response: ' + (json.ok ? 'Sent' : (json.error || 'Failed')));
    log('Test call result: ' + (json.ok ? 'OK' : (json.error || 'Failed')));
  } catch (err) {
    console.error('Test call error', err);
    alert('Test call failed (see console)');
    log('Test call failed');
  }
}

// ==========================
//  DOM READY - hookup UI
// ==========================
document.addEventListener('DOMContentLoaded', () => {
  // init map & contacts UI
  initMap();
  renderContacts();

  // Contact form
  const contactForm = $('contactForm');
  if (contactForm) {
    contactForm.onsubmit = (e) => {
      e.preventDefault();
      const name = $('name') ? $('name').value.trim() : '';
      const email = $('email') ? $('email').value.trim() : '';
      const phone = $('phone') ? $('phone').value.trim() : '';
      if (!name) { alert('Please enter name'); return; }
      if (!phone) { alert('Please enter phone in +countryformat'); return; }
      if (!/^\+?\d{7,15}$/.test(phone.replace(/\s+/g, ''))) {
        alert('Please enter a valid phone number with country code (e.g. +919876543210)');
        return;
      }
      const list = loadContacts();
      list.push({ name, email, phone });
      saveContacts(list);
      if ($('name')) $('name').value = '';
      if ($('email')) $('email').value = '';
      if ($('phone')) $('phone').value = '';
      log('Contact added: ' + name);
    };
  }

  // Clear contacts
  const clearContactsBtn = $('clearContacts');
  if (clearContactsBtn) {
    clearContactsBtn.onclick = () => {
      if (confirm('Clear all contacts?')) {
        localStorage.removeItem(CONTACTS_KEY);
        renderContacts();
        log('Contacts cleared');
      }
    };
  }

  // basic buttons
  const shareLocBtn = $('shareLocBtn');
  if (shareLocBtn) shareLocBtn.onclick = () => shareLocation(true);
  const alarmBtn = $('alarmBtn');
  if (alarmBtn) alarmBtn.onclick = () => playAlarm();

  // SOS & Cancel buttons
  const sosBtn = $('sosBtn');
  if (sosBtn) sosBtn.onclick = () => startCancelableSOS();
  const cancelBtn = $('cancelBtn');
  if (cancelBtn) cancelBtn.onclick = () => cancelSOS();

  // Test call button (header); use event only if present
  const testBtn = $('testCallBtn') || qsel('#testCallBtn');
  if (testBtn) {
    testBtn.onclick = async () => {
      const num = prompt('Enter phone number to test (E.164, e.g. +919876543210):');
      if (!num) return;
      await triggerTestCall(num.trim());
    };
  }

  // Admin logs button
  const adminBtn = $('adminBtn') || qsel('#adminBtn');
  if (adminBtn) {
    adminBtn.onclick = () => {
      alert(
        'Event log:\n\n' +
          Array.from(document.querySelectorAll('#logArea div')).map(d => d.textContent).slice(0, 30).join('\n')
      );
    };
  }

  // small helpful log
  log('UI ready');
});
