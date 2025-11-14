// api/call.js  (Vercel serverless function)
const Twilio = require('twilio');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // Basic origin check (optional)
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*'; // set to your site origin in production
  if (allowedOrigin !== '*' && req.headers.origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const { to = [], message = '', from_name = '' } = req.body;
  if (!Array.isArray(to) || to.length === 0) return res.status(400).json({ error: 'No recipients' });

  const accountSid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_TOKEN;
  const fromNumber = process.env.TWILIO_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    return res.status(500).json({ error: 'Twilio not configured on server' });
  }

  const client = Twilio(accountSid, authToken);

  const sayText = `${from_name || 'A user'} has triggered an emergency. ${message || 'Please respond.'} This is an automated alert.`;

  try {
    const results = [];
    for (const toNumber of to) {
      // basic validation: ensure starts with + and digits
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
    return res.json({ ok: true, results });
  } catch (err) {
    console.error('Twilio error', err);
    return res.status(500).json({ error: err.message || err });
  }
};
