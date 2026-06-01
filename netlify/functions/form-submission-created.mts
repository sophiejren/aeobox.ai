/**
 * Netlify Function: form-submission-created
 *
 * Triggered automatically when a Netlify Form is submitted.
 *
 * For audit-request: forwards to the Python audit service which runs
 * the real audit + emails the branded report via Resend.
 *
 * For playbook-request + talk-to-us: sends Resend emails directly.
 *
 * Required env vars (Netlify dashboard):
 *   RESEND_API_KEY     — for playbook + talk-to-us
 *   AUDIT_SERVICE_URL  — for audit-request, e.g. https://aeobox-audit.onrender.com
 */

import type { Context } from "@netlify/functions";
import { Resend } from "resend";
import { readFileSync } from "fs";
import { join } from "path";

const resend = new Resend(process.env.RESEND_API_KEY);
const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || "";

const FROM_USER = "Sophie at AEObox <sophie@aeobox.ai>";
const FROM_INTERNAL = "AEObox Forms <noreply@aeobox.ai>";
const NOTIFY_TO = "sophie@aeobox.ai";

// Load HTML templates at build time
function loadTemplate(name: string): string {
  try {
    return readFileSync(join(process.cwd(), "emails", name), "utf-8");
  } catch (e) {
    console.error(`Template ${name} not found`, e);
    return "";
  }
}

export default async (req: Request, context: Context) => {
  let payload: any;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const formName = payload?.payload?.form_name;
  const data = payload?.payload?.data || {};
  const userEmail = data.email;

  console.log(`[form] received submission: ${formName}`, data);

  if (!userEmail) {
    return new Response("Missing email", { status: 400 });
  }

  try {
    // ===================== PLAYBOOK REQUEST =====================
    if (formName === "playbook-request") {
      const html = loadTemplate("playbook.html");

      // To user — branded playbook delivery
      await resend.emails.send({
        from: FROM_USER,
        to: userEmail,
        replyTo: "sophie@aeobox.ai",
        subject: "Your 2026 GEO Playbook is here",
        html: html,
      });

      // Internal notification
      await resend.emails.send({
        from: FROM_INTERNAL,
        to: NOTIFY_TO,
        subject: `📘 New playbook request: ${userEmail}`,
        html: `
          <h3>New playbook request</h3>
          <p><strong>Email:</strong> <a href="mailto:${userEmail}">${userEmail}</a></p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <p>Branded playbook delivery email auto-sent. Reply to <a href="mailto:${userEmail}?subject=Following%20up%20on%20the%20GEO%20Playbook">follow up</a>.</p>
        `,
      });
    }

    // ===================== AUDIT REQUEST =====================
    if (formName === "audit-request") {
      const domain = data.domain || "your brand";

      // Forward to Python audit service — it runs the real audit + emails the branded report
      if (AUDIT_SERVICE_URL) {
        try {
          const auditPayload = {
            domain: domain,
            email: userEmail,
            name: data.name || "",
            company: data.company || "",
            source: data.source || "audit",
            goals: Array.isArray(data.goal) ? data.goal : (data.goal ? [data.goal] : []),
            context: data.context || data.message || "",
          };
          const auditResp = await fetch(`${AUDIT_SERVICE_URL}/audit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(auditPayload),
          });
          console.log(`[audit-service] forwarded for ${domain}, status ${auditResp.status}`);
        } catch (e) {
          console.error("[audit-service] forward failed, falling back to manual:", e);
          // Fall through to manual handoff below
        }
      } else {
        // No audit service configured — send queued email + manual handoff to Sophie
        const html = loadTemplate("audit-confirmation.html").replace(/\{\{domain\}\}/g, domain);
        await resend.emails.send({
          from: FROM_USER,
          to: userEmail,
          replyTo: "sophie@aeobox.ai",
          subject: `Your AEObox audit for ${domain} is queued`,
          html: html,
        });
        await resend.emails.send({
          from: FROM_INTERNAL,
          to: NOTIFY_TO,
          subject: `🎯 Manual audit: ${domain}`,
          html: `<h3>Manual audit needed</h3>
            <p>AUDIT_SERVICE_URL not configured. Run audit manually for <strong>${domain}</strong>.</p>
            <p>Email: <a href="mailto:${userEmail}">${userEmail}</a></p>`,
        });
      }
    }

    // ===================== TALK TO US / STRATEGY CALL =====================
    if (formName === "talk-to-us") {
      const source = data.source || "general";
      const goals = Array.isArray(data.goal) ? data.goal.join(", ") : (data.goal || "");
      const subject = source === "strategy-call"
        ? `📞 Strategy Call: ${data.company || userEmail}`
        : `💬 Inquiry: ${data.company || userEmail}`;

      await resend.emails.send({
        from: FROM_INTERNAL,
        to: NOTIFY_TO,
        replyTo: userEmail,
        subject: subject,
        html: `
          <h3>${source === 'strategy-call' ? '📞 Strategy Call request' : '💬 New inquiry'}</h3>
          <table style="border-collapse:collapse; font-family:sans-serif;">
            <tr><td style="padding:5px 14px 5px 0;"><strong>Name:</strong></td><td>${data.name || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Email:</strong></td><td><a href="mailto:${userEmail}">${userEmail}</a></td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Company:</strong></td><td>${data.company || '—'} (${data.company_size || '—'})</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Website:</strong></td><td><a href="https://${data.website}">${data.website || '—'}</a></td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Phone:</strong></td><td>${data.phone || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Source:</strong></td><td><code>${source}</code></td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Goals:</strong></td><td>${goals || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0;"><strong>Time pref:</strong></td><td>${data.preferred_time || '—'}</td></tr>
            <tr><td style="padding:5px 14px 5px 0; vertical-align:top;"><strong>Notes:</strong></td><td>${data.context || '—'}</td></tr>
          </table>
          <p style="margin-top:18px;">
            <a href="mailto:${userEmail}?subject=Re:%20your%20message%20to%20AEObox" style="display:inline-block; padding:9px 16px; background:#7C5CFF; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">Reply to ${data.name || 'them'} →</a>
          </p>
        `,
      });

      await resend.emails.send({
        from: FROM_USER,
        to: userEmail,
        replyTo: "sophie@aeobox.ai",
        subject: source === "strategy-call" ? "Your Strategy Call request is in" : "Got your message — Sophie is on it",
        html: `
          <p>Hi ${data.name || 'there'} —</p>
          <p>Thanks for reaching out. I'll personally read your message and reply within <strong>4 business hours</strong> (M–F Pacific).</p>
          ${source === 'strategy-call' ? '<p>For the Strategy Call: I will send 2-3 time slots based on your preference. Once you confirm a time, the $800 invoice goes out and we book the call.</p>' : ''}
          <p>— Sophie<br/>AEObox · DRLAMBDA</p>
        `,
      });
    }

    return new Response(JSON.stringify({ ok: true, formName }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[form] error:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
