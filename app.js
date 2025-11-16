// ==========================
//  Configuration
// ==========================
const CALL_FUNCTION_URL = 'https://saheli-the-distress-sos.netlify.app/.netlify/functions/call'; 
// If your function is on the same Netlify site, you may use '/.netlify/functions/call'

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
let sosTimer = null;
let sosInProgress = false;

// ==========================
//  MAP SETUP
// ==========================
function initMap() {
  try {
    map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);
  } catch (e) {
    console.warn('Leaflet not loaded or map container missing', e);
  }
}

// ==========================
//  LOCATION (promise)
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
//  ALARM
// ==========================
function playAlarm() {
  const audio = $('alarmAudio');
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {/* autoplay blocked */});
  log('Alarm sounded');
}
function stopAlarm() {
  const audio = $('alarmAudio');
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

// ==========================
//  CONTACTS (localStorage)
// ==========================
const CONTACTS_KEY = 'safe_contacts';

function loadContacts() {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load contacts', e);
    return [];
  }
}

function saveContacts(list) {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(list));
    renderContacts();
  } catch (e) {
    console.error('Failed to save contacts', e);
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderContacts() {
  const ul = $('contactsList');
  if (!ul) return;
  ul.innerHTML = '';
  const list = loadContacts();

  list.forEach((c, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="contact-meta">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="sub">Phone: ${c.phone ? escapeHtml(c.phone) : '—'}</div>
        <div class="sub">Email: ${c.email ? escapeHtml(c.email) : '—'}</div>
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
      if (i >= 0 && i < l.length) {
        const removed = l.splice(i, 1);
        saveContacts(l);
        log('Contact removed: ' + (removed[0] && removed[0].name ? removed[0].name : 'unknown'));
      }
    };
  });
}

// ==========================
//  CALL TRIGGER (Netlify -> Twilio)
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

    const json = await resp.json().catch(()=>({ error: 'invalid json response' }));
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
//  ALERT FLOW (Email + Calls)
// ==========================
async function performAlertSequence() {
  // ensure we tried to get location
  await shareLocation(true);

  // sound alarm
  playAlarm();

  // email part
  const contacts = loadContacts();
  const emails = contacts.map(c => c.email).filter(Boolean);
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
      log('Alert emailed to: ' + emailsStr);
    } catch (err) {
      console.error('EmailJS error', err);
      log('Email send failed');
    }
  } else {
    log('No email contacts to notify');
  }

  // calls part
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

  log('SOS sequence completed');
}

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
//  TEST CALL HELPER
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
    const json = await resp.json().catch(()=>({ error: 'invalid json' }));
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
//  DOM Ready — wire events
// ==========================
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderContacts();

  // Add contact
  const contactForm = $('contactForm');
  if (contactForm) {
    contactForm.onsubmit = e => {
      e.preventDefault();
      const name = $('name').value.trim();
      const email = $('email').value.trim();
      const phone = $('phone').value.trim();

      if (!name) { alert('Please enter a name'); return; }
      if (!phone) { alert('Please enter a phone number'); return; }

      // simple validation for phone
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
  }

  // Clear contacts
  const clearBtn = $('clearContacts');
  if (clearBtn) clearBtn.onclick = () => {
    if (confirm('Clear all contacts?')) {
      localStorage.removeItem(CONTACTS_KEY);
      renderContacts();
      log('Contacts cleared');
    }
  };

  // Buttons
  const shareBtn = $('shareLocBtn');
  if (shareBtn) shareBtn.onclick = () => shareLocation(true);

  const alarmBtn = $('alarmBtn');
  if (alarmBtn) alarmBtn.onclick = () => playAlarm();

  const sosBtn = $('sosBtn');
  if (sosBtn) sosBtn.onclick = () => startCancelableSOS();

  const cancelBtn = $('cancelBtn');
  if (cancelBtn) cancelBtn.onclick = () => cancelSOS();

  // Test call button
  const testBtn = $('testCallBtn');
  if (testBtn) {
    testBtn.onclick = async () => {
      const num = prompt('Enter phone number to test (E.164, e.g. +919876543210):');
      if (!num) return;
      await triggerTestCall(num.trim());
    };
  }

  // Admin logs
  const adminBtn = $('adminBtn');
  if (adminBtn) {
    adminBtn.onclick = () => {
      alert(
        'Event log:\n\n' +
        Array.from(document.querySelectorAll('#logArea div'))
          .map(d => d.textContent)
          .slice(0, 50)
          .join('\n')
      );
    };
  }
});
