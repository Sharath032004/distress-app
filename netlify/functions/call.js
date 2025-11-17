exports.handler = async (event) => {
  // Preflight support
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    };
  }

  try {
    const { to, message } = JSON.parse(event.body);

    if (!process.env.TWILIO_SID ||
        !process.env.TWILIO_TOKEN ||
        !process.env.TWILIO_FROM) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Twilio not configured" })
      };
    }

    const client = require("twilio")(
      process.env.TWILIO_SID,
      process.env.TWILIO_TOKEN
    );

    const results = [];

    for (const number of to) {
      const call = await client.calls.create({
        to: number,
        from: process.env.TWILIO_FROM,
        twiml: `<Response><Say>
                Emergency alert! ${message}
                </Say></Response>`
      });
      results.push(call.sid);
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: true, results })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
