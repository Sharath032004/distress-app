// functions/call.js  (Netlify function) - with CORS handling
const Twilio = require('twilio');

const defaultCors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '3600'
});

exports.handler = async function(event, context) {
  // Always handle preflight OPTIONS
  const originHeader = event.headers.origin || event.headers.Origin || '*';
  const allowedOrigin = process.env.ALLOWED_ORIGIN || originHeader || '*';
  const CORS_HEADERS = defaultCors(allowedOrigin);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Basic origin check (optional; allow if ALLOWED_ORIGIN is '*' or matches request)
  if (process.env.ALLOWED_ORIGIN && process.env.ALLOWED_ORIGIN !== '*') {
    const reqOrigin = originHeader || '';
    if (reqOrigin !== process.env.ALLOWED_ORIGIN) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Origin not allowed', origin: reqOrigin })
      };
    }
  }

  let body;
  try { body = JSON.parse(event.body); } catch (e) { body = {}; }

  const { to = [], message = '', from_name = '' } = body;
  if (!Array.isArray(to) || to.length === 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'No recipients' })
    };
  }

  const accountSid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_TOKEN;
  const fromNumber = process.env.TWILIO_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Twilio not configured' })
    };
  }

  const client = Twilio(accountSid, authToken);
  const sayText = `${from_name || 'A user'} has triggered an emergency. ${message || 'Please respond.'} This is an automated alert.`;

  try {
    const results = [];
    for (const toNumber of to) {
      const cleaned = (toNumber || '').toString().replace(/\s+/g, '');
      if (!/^\+?\d+$/.test(cleaned)) {
        results.push({ to: toNumber, error: 'Invalid phone format' });
        continue;
      }
      const call = await client.calls.create({
        to: cleaned,
        from: fromNumber,
        twiml: `<Response><Say voice="alice">${sayText}</Say></Response>`
      });
      results.push({ to: cleaned, sid: call.sid, status: call.status });
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, results })
    };
  } catch (err) {
    console.error('Twilio error', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message || err })
    };
  }
};
