// Vercel serverless function: receives a showroom appointment request and emails it via Resend.
// Required environment variables (set in Vercel, Settings, Environment Variables):
//   RESEND_API_KEY    Resend API key
//   APPOINTMENT_TO    address that receives the requests
//   APPOINTMENT_FROM  verified sender, for example "Anamon <showroom@anamon.be>"

const LIMITS = { name: 100, email: 200, phone: 40, date: 10, daypart: 20, postcode: 20, country: 60, message: 2000 };
const DAYPARTS = ["Morning", "Afternoon", "No preference"];

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "object" && req.body !== null ? req.body : {};

  // Honeypot: real visitors never see or fill this field.
  if (clean(body.website, 200)) return res.status(200).json({ ok: true });

  const data = {};
  for (const [key, max] of Object.entries(LIMITS)) data[key] = clean(body[key], max);

  const errors = [];
  if (!data.name) errors.push("name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("email");
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) errors.push("date");
  if (data.daypart && !DAYPARTS.includes(data.daypart)) errors.push("daypart");
  if (errors.length) return res.status(400).json({ error: "Invalid fields", fields: errors });

  const { RESEND_API_KEY, APPOINTMENT_TO, APPOINTMENT_FROM } = process.env;
  if (!RESEND_API_KEY || !APPOINTMENT_TO || !APPOINTMENT_FROM) {
    console.error("Appointment form: missing environment variables");
    return res.status(500).json({ error: "Not configured" });
  }

  const rows = [
    ["Name", data.name],
    ["Email", data.email],
    ["Phone", data.phone],
    ["Preferred date", data.date],
    ["Part of day", data.daypart],
    ["Postcode", data.postcode],
    ["Country", data.country],
    ["Message", data.message]
  ].filter(([, v]) => v);

  const text = rows.map(([k, v]) => k + ": " + v).join("\n");
  const html = "<h2>Showroom appointment request</h2><table>" +
    rows.map(([k, v]) => "<tr><td style=\"padding:4px 12px 4px 0;vertical-align:top\"><strong>" + k +
      "</strong></td><td style=\"padding:4px 0;white-space:pre-wrap\">" + escapeHtml(v) + "</td></tr>").join("") +
    "</table>";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: APPOINTMENT_FROM,
        to: APPOINTMENT_TO.split(",").map(s => s.trim()).filter(Boolean),
        reply_to: data.email,
        subject: "Showroom appointment request: " + data.name.replace(/[\r\n]+/g, " "),
        text,
        html
      })
    });
    if (!r.ok) {
      console.error("Resend error", r.status, await r.text());
      return res.status(502).json({ error: "Send failed" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Resend request failed", err);
    return res.status(502).json({ error: "Send failed" });
  }
};
