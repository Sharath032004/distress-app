// ==========================
//  Configuration
// ==========================
// Default uses a relative path so the function call originates from the same origin
// (this avoids CORS issues if your function is deployed on the same Netlify site).
// If your function is hosted on another Netlify site, replace with the full URL:
// e.g. 'https://spiffy-beijinho-aed172.netlify.app/.netlify/functions/call'
const CALL_FUNCTION_URL = '/.netlify/functions/call';

// ==========================
//  EmailJS Initialization
// ==========================
(function () {
  if (window.emailjs) emailjs.init('RR9SIRs9g99ygpLBQ');
})();

// ==========================
//  Helper Functions
// ==========================
const $ = id => document.getElementById(id);
const log = (text) => {
  const area = $('logArea');
  const t = document.createElement('div');
  t.textContent = `${new Date().toLocaleString()} — ${text}`;
  area.prepend(t);
};

// ==========================
//  State
// ==========================
let map, marker;
let currentCoords = null;
let sosTimer = null;        // cancelable timer
let sosInProgress = false;

// ==========================
//  MAP SETUP
// ==========================
function initMap() {
  map = L.map('map').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
}

// ==========================
//  GET LOCATION (PROMISE)
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

        $('coords').textContent = `Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        log('Location shared');

        if (showOnMap) {
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
//  ALARM
// ==========================
function playAlarm() {
  const audio = $('alarmAudio');
  audio.currentTime = 0;
  audio.play().catch(() => {});
  log('Alarm sounded');
}
function stopAlarm() {
  const audio = $('alarmAudio');
  audio.pause();
  audio.currentTime = 0;
}

// ==========================
//  CONTACTS MANAGEMENT
// ==========================
const CONTACTS_KEY = 'safe_contacts';

function loadContacts() {
  const raw = localStorage.getItem(CONTACTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveContacts(list) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(list));
  renderContacts();
}

function renderContacts() {
  const ul = $('contactsList');
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

  document.querySelectorAll('.removeBtn').forEach(btn => {
    btn.onclick = e => {
      const i = Number(e.target.dataset.i);
      const l = loadContacts();
      l.splice(i, 1);
      saveContacts(l);
      log('Contact removed');
    };
  });
}

// small helper to avoid accidental HTML injection in rendered values
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ==========================
//  TRIGGER CALLS (Netlify -> Twilio)
// ==========================
async function triggerCalls(phoneRecipients, currentCoordsParam) {
  if (!phoneRecipients || phoneRecipients.length === 0) {
    log('No phone numbers to call');
    return { ok: false, error: 'no recipients' };
  }

  try {
    const resp = await fetch(CALL_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phoneRecipients,
        message: `I need help. Location: ${currentCoordsParam ? currentCoordsParam.lat + ',' + currentCoordsParam.lon : 'Not available'}`,
        from_name: 'SafeWave User'
      })
    });

    // handle non-JSON or bad responses gracefully
    let json;
    try { json = await resp.json(); } catch (e) { json = null; }

    if (resp.ok) {
      log(`Call requests sent to ${phoneRecipients.length} number(s)`);
      return json || { ok: true };
    } else {
      // Friendly error messages for common failure modes
      const bodyError = (json && json.error) ? json.error : `HTTP ${resp.status}`;
      log('Call function returned error: ' + bodyError);

      // Common helpful guidance
      if (resp.status === 403 || /Origin not allowed/i.test(bodyError)) {
        const origin = location.origin;
        log(`CORS/Origin issue. Ensure the Netlify env var ALLOWED_ORIGIN on the function host includes: ${origin}`);
      }

      return json || { ok: false, error: bodyError };
    }
  } catch (err) {
    console.error('Call error', err);
    log('Call request failed: see console');
    return { ok: false, error: err.message || String(err) };
  }
}

// ==========================
//  SOS FLOW
// ==========================
async function performAlertSequence() {
  // 1) Wait for location (already done prior to calling this in most flows, but ensure)
  await shareLocation(true);

  // 2) Play alarm (visual + audio)
  playAlarm();

  // 3) Email
  const contacts = loadContacts();
  let emails = contacts.map(c => c.email).filter(Boolean);
  if (emails.length) {
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
      await emailjs.send('service_hf9wccx', 'template_7wjlod7', template_params);
      log('Alert emailed to contacts: ' + emailsStr);
    } catch (err) {
      console.error('EmailJS error', err);
      log('Email send failed');
    }
  } else {
    log('No emails saved to notify');
  }

  // 4) Calls (Twilio via Netlify function) - phone numbers in E.164
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

  // 5) Final log entry
  log('SOS sequence completed');
}

// ==========================
//  CANCELABLE SOS (5s window)
// ==========================
function startCancelableSOS() {
  if (sosInProgress) return;
  sosInProgress = true;
  $('sosBtn').disabled = true;
  $('cancelBtn').style.display = 'inline-block';
  log('SOS initiated — you have 5 seconds to cancel');

  // clear any existing timer
  if (sosTimer) clearTimeout(sosTimer);

  sosTimer = setTimeout(async () => {
    $('cancelBtn').style.display = 'none';
    $('sosBtn').disabled = false;
    sosInProgress = false;
    await performAlertSequence();
  }, 5000); // 5 seconds
}

function cancelSOS() {
  if (!sosInProgress) return;
  clearTimeout(sosTimer);
  sosTimer = null;
  sosInProgress = false;
  $('sosBtn').disabled = false;
  $('cancelBtn').style.display = 'none';
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
      body: JSON.stringify({
        to: [number],
        message: 'Test call from SafeWave',
        from_name: 'SafeWave Demo'
      })
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
//  MAIN LOGIC (DOM READY)
// ==========================
document.addEventListener('DOMContentLoaded', () => {
  // initialize map and contacts UI
  initMap();
  renderContacts();

  // Contact form submit -> save name, email, phone
  $('contactForm').onsubmit = e => {
    e.preventDefault();
    const name = $('name').value.trim();
    const email = $('email').value.trim();
    const phone = $('phone').value.trim();

    // basic validation
    if (!name) { alert('Please enter name'); return; }
    if (!phone) { alert('Please enter phone in +countryformat'); return; }
    // simple E.164-ish check (not exhaustive)
    if (!/^\+?\d{7,15}$/.test(phone.replace(/\s+/g, ''))) {
      alert('Please enter a valid phone number with country code (e.g. +919876543210)');
      return;
    }

    const list = loadContacts();
    list.push({ name, email, phone });
    saveContacts(list);

    $('name').value = '';
    $('email').value = '';
    $('phone').value = '';

    log('Contact added: ' + name);
  };

  // Clear contacts
  $('clearContacts').onclick = () => {
    if (confirm('Clear all contacts?')) {
      localStorage.removeItem(CONTACTS_KEY);
      renderContacts();
      log('Contacts cleared');
    }
  };

  // Buttons: share location & alarm
  $('shareLocBtn').onclick = () => shareLocation(true);
  $('alarmBtn').onclick = () => playAlarm();

  // SOS flow: start cancelable SOS (5s window)
  $('sosBtn').onclick = () => startCancelableSOS();
  $('cancelBtn').onclick = () => cancelSOS();

  // Test call button (in header)
  const testBtn = $('testCallBtn');
  if (testBtn) {
    testBtn.onclick = async () => {
      const num = prompt('Enter phone number to test (E.164, e.g. +919876543210):');
      if (!num) return;
      await triggerTestCall(num.trim());
    };
  }

  // Admin view for logs
  $('adminBtn').onclick = () => {
    alert(
      'Event log:\n\n' +
        Array.from(document.querySelectorAll('#logArea div'))
          .map(d => d.textContent)
          .slice(0, 30)
          .join('\n')
    );
  };
});
