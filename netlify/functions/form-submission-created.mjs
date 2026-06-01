/**
 * Netlify Function: form-submission-created
 *
 * Triggered automatically when a Netlify Form is submitted.
 *
 * For audit-request: forwards to the Python audit service (which handles emails).
 * For playbook-request + talk-to-us: sends Resend emails directly via fetch.
 *
 * Pure ESM JavaScript — no npm install required. Uses native fetch only.
 *
 * Required env vars (Netlify dashboard):
 *   RESEND_API_KEY     — for playbook + talk-to-us
 *   AUDIT_SERVICE_URL  — e.g. https://aeobox-audit.onrender.com
 */

const RESEND_KEY = process.env.RESEND_API_KEY || "";
const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || "";

const FROM_USER = "Sophie at AEObox <sophie@aeobox.ai>";
const FROM_INTERNAL = "AEObox Forms <noreply@aeobox.ai>";
const NOTIFY_TO = "sophie@aeobox.ai";

// Tiny Resend client — no npm dep
async function sendEmail({ from, to, replyTo, subject, html }) {
  if (!RESEND_KEY) {
    console.warn("[resend] RESEND_API_KEY not set — email skipped");
    return null;
  }
  const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
  if (replyTo) body.reply_to = replyTo;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    console.error(`[resend] ${r.status}: ${text}`);
  } else {
    console.log(`[resend] sent to ${to} (status ${r.status})`);
  }
  return r;
}

export default async (req) => {
  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const formName = payload?.payload?.form_name;
  const data = payload?.payload?.data || {};
  const userEmail = data.email;

  console.log(`[form] received submission: ${formName}`, JSON.stringify(data));

  if (!userEmail) {
    return new Response("Missing email", { status: 400 });
  }

  try {
    // ===================== AUDIT REQUEST =====================
    if (formName === "audit-request") {
      const domain = (data.domain || "your brand").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

      if (AUDIT_SERVICE_URL) {
        const auditPayload = {
          domain,
          email: userEmail,
          name: data.name || "",
          company: data.company || "",
          source: data.source || "audit",
          goals: Array.isArray(data.goal) ? data.goal : (data.goal ? [data.goal] : []),
          context: data.context || data.message || "",
        };
        console.log(`[audit-service] forwarding for ${domain} → ${AUDIT_SERVICE_URL}/audit`);
        const auditResp = await fetch(`${AUDIT_SERVICE_URL}/audit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(auditPayload),
        });
        const respText = await auditResp.text();
        console.log(`[audit-service] response ${auditResp.status}: ${respText}`);
        if (!auditResp.ok) {
          console.error(`[audit-service] non-OK response`);
        }
      } else {
        console.error(`[audit-service] AUDIT_SERVICE_URL not configured — sending manual handoff`);
        await sendEmail({
          from: FROM_INTERNAL,
          to: NOTIFY_TO,
          subject: `🎯 Manual audit needed: ${domain}`,
          html: `<h3>Manual audit needed</h3>
            <p>AUDIT_SERVICE_URL not set. Run audit manually for <strong>${domain}</strong>.</p>
            <p>Email: <a href="mailto:${userEmail}">${userEmail}</a></p>`,
        });
      }
    }

    // ===================== PLAYBOOK REQUEST =====================
    else if (formName === "playbook-request") {
      // Branded playbook delivery — inline HTML (template would need npm import)
      await sendEmail({
        from: FROM_USER,
        to: userEmail,
        replyTo: "sophie@aeobox.ai",
        subject: "Your 2026 GEO Playbook is here",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a2e;">
            <h2 style="color: #7C5CFF; margin-top: 0;">Your 2026 GEO Playbook</h2>
            <p>Hi —</p>
            <p>Thanks for grabbing the playbook. Here's what's inside:</p>
            <ul>
              <li>The 14-check AEO audit framework we use on $8K Concierge clients</li>
              <li>10 schema patterns that get cited by ChatGPT (with examples)</li>
              <li>The owned-media checklist for AI visibility</li>
            </ul>
            <p>I'll send a download link in the next email. In the meantime, hit reply if you want me to run a free audit on your site — I'll send back the score within 24h.</p>
            <p>— Sophie<br/>AEObox · DRLAMBDA</p>
          </div>`,
      });
      await sendEmail({
        from: FROM_INTERNAL,
        to: NOTIFY_TO,
        subject: `📘 New playbook request: ${userEmail}`,
        html: `<h3>New playbook request</h3>
          <p><strong>Email:</strong> <a href="mailto:${userEmail}">${userEmail}</a></p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
      });
    }

    // ===================== TALK TO US / STRATEGY CALL =====================
    else if (formName === "talk-to-us") {
      const source = data.source || "general";
      const goals = Array.isArray(data.goal) ? data.goal.join(", ") : (data.goal || "");
      const subject = source === "strategy-call"
        ? `📞 Strategy Call: ${data.company || userEmail}`
        : `💬 Inquiry: ${data.company || userEmail}`;

      await sendEmail({
        from: FROM_INTERNAL,
        to: NOTIFY_TO,
        replyTo: userEmail,
        subject,
        html: `
          <h3>${source === 'strategy-call' ? '📞 Strategy Call request' : '💬 New inquiry'}</h3>
          <table style="border-collapse:collapse; font-family:sans-serif;">
            <tr><td style="padding:5px 14px 5px 0;"><strong>Name:</strong></td><td>${data.name || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Email:</strong></td><td><a href="mailto:${userEmail}">${userEmail}</a></td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Company:</strong></td><td>${data.company || '—'} (${data.company_size || '—'})</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Website:</strong></td><td>${data.website || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Phone:</strong></td><td>${data.phone || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Source:</strong></td><td><code>${source}</code></td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Goals:</strong></td><td>${goals || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0; vertical-align:top;"><strong>Notes:</strong></td><td>${data.context || '—'}</td></tr>
          </table>`,
      });

      await sendEmail({
        from: FROM_USER,
        to: userEmail,
        replyTo: "sophie@aeobox.ai",
        subject: source === "strategy-call" ? "Your Strategy Call request is in" : "Got your message — Sophie is on it",
        html: `
          <p>Hi ${data.name || 'there'} —</p>
          <p>Thanks for reaching out. I'll personally read your message and reply within <strong>4 business hours</strong> (M–F Pacific).</p>
          ${source === 'strategy-call' ? '<p>For the Strategy Call: I will send 2-3 time slots based on your preference. Once you confirm a time, the $800 invoice goes out and we book the call.</p>' : ''}
          <p>— Sophie<br/>AEObox · DRLAMBDA</p>`,
      });
    }

    return new Response(JSON.stringify({ ok: true, formName }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[form] error:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
