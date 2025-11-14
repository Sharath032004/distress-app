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
        <strong>${c.name}</strong>
        <div class="muted">${c.email}</div>
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

// ==========================
//  MAIN LOGIC
// ==========================
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderContacts();

  // Add contacts
  $('contactForm').onsubmit = e => {
    e.preventDefault();
    const name = $('name').value.trim();
    const email = $('email').value.trim();
    if (!name || !email) return;
    const list = loadContacts();
    list.push({ name, email });
    saveContacts(list);
    $('name').value = '';
    $('email').value = '';
    log('Contact added: ' + name);
  };

  $('clearContacts').onclick = () => {
    if (confirm('Clear all contacts?')) {
      localStorage.removeItem(CONTACTS_KEY);
      renderContacts();
      log('Contacts cleared');
    }
  };

  // Button actions
  $('shareLocBtn').onclick = () => shareLocation(true);
  $('alarmBtn').onclick = () => playAlarm();

  // ==========================
  //  SOS BUTTON (FULLY FIXED)
  // ==========================
  $('sosBtn').onclick = async () => {
    // 1) Wait for location to load completely
    await shareLocation(true);

    // 2) Play alarm
    playAlarm();

    // 3) Prepare sending email
    const contacts = loadContacts();
    if (contacts.length) {
      const emails = contacts.map(c => c.email).join(',');

      const template_params = {
        to_email: emails, 
        from_name: 'SafeWave User',
        message: 'I need help. Please reach out as soon as possible.',
        lat: currentCoords ? currentCoords.lat : 'Not available',
        lon: currentCoords ? currentCoords.lon : 'Not available',
        time: new Date().toLocaleString()
      };

      try {
        await emailjs.send('service_hf9wccx', 'template_7wjlod7', template_params);
        log('Alert sent to contacts');
        alert('✅ Alert emailed to emergency contacts!');
      } catch (err) {
        console.error(err);
        log('Could not send email');
        alert('❌ Failed to send email. Check console.');
      }
    } else {
      log('No contacts');
      alert('Add emergency contacts first.');
    }

    // 4) Log SOS
    log('SOS triggered');
  };

  // Admin View
  $('adminBtn').onclick = () => {
    alert(
      'Event log:\n\n' +
        Array.from(document.querySelectorAll('#logArea div'))
          .map(d => d.textContent)
          .slice(0, 15)
          .join('\n')
    );
  };
});
