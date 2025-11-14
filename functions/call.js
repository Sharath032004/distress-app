// functions/call.js  (Netlify function)
const Twilio = require('twilio');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  const origin = event.headers.origin || event.headers.Origin;
  if (allowedOrigin !== '*' && origin !== allowedOrigin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Origin not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch (e) { body = {}; }

  const { to = [], message = '', from_name = '' } = body;
  if (!Array.isArray(to) || to.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No recipients' }) };
  }

  const accountSid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_TOKEN;
  const fromNumber = process.env.TWILIO_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Twilio not configured' }) };
  }

  const client = Twilio(accountSid, authToken);
  const sayText = `${from_name || 'A user'} has triggered an emergency. ${message || 'Please respond.'} This is an automated alert.`;

  try {
    const results = [];
    for (const toNumber of to) {
      if (typeof toNumber !== 'string' || !/^\+?\d+$/.test(toNumber.replace(/\s+/g, ''))) {
        results.push({ to: toNumber, error: 'Invalid phone format' });
        continue;
      }
      const call = await client.calls.create({
        to: toNumber,
        from: fromNumber,
        twiml: `<Response><Say voice="alice">${sayText}</Say></Response>`
      });
      results.push({ to: toNumber, sid: call.sid, status: call.status });
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, results }) };
  } catch (err) {
    console.error('Twilio error', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || err }) };
  }
};
