// Supabase Edge Function: send-email
// Sends application confirmation + status-change emails through Resend (https://resend.com).
//
// Secrets to set (supabase secrets set ...):
//   RESEND_API_KEY   your Resend API key
//   MAIL_FROM        e.g.  "BIPS <admissions@yourdomain.com>"  (domain must be verified in Resend)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function layout(title: string, bodyHtml: string, s: Record<string, string>) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6fa;padding:24px">
  <div style="max-width:580px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e3e8f0">
    <div style="background:#0B2A5B;color:#fff;padding:20px 24px">
      <div style="font-size:18px;font-weight:bold">Bingwa Institute of Professional Studies</div>
      <div style="color:#E8A317;font-size:13px;margin-top:2px">Kuwa Bingwa – Become a Champion</div>
    </div>
    <div style="padding:24px;color:#1b2540;line-height:1.55;font-size:15px">
      <h2 style="margin:0 0 12px;color:#0B2A5B;font-size:20px">${esc(title)}</h2>${bodyHtml}
    </div>
    <div style="background:#f4f6fa;padding:16px 24px;font-size:12px;color:#5b6682">
      ${esc(s.phone || "")} ${s.phone && s.email ? "·" : ""} ${esc(s.email || "")}<br>${esc(s.address || "")}<br>
      <b>Your Future, Our Priority.</b>
    </div></div></div>`;
}

async function sendMail(to: string, subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, reason: "RESEND_API_KEY is not set" };
  const from = Deno.env.get("MAIL_FROM") || "BIPS <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) return { ok: false, reason: await r.text() };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows } = await svc.from("site_settings").select("key,value");
    const s: Record<string, string> = {};
    (rows || []).forEach((r) => (s[r.key] = r.value || ""));

    if (body.type === "confirmation") {
      const { data: a } = await svc.from("applications").select("*")
        .eq("reference_number", String(body.reference_number || "").toUpperCase())
        .eq("email", String(body.email || "").toLowerCase()).maybeSingle();
      if (!a) return json({ sent: false, reason: "not found" }, 404);
      if (a.confirmation_sent) return json({ sent: false, reason: "already sent" });
      const html = layout("We have received your application",
        `<p>Dear ${esc(a.full_name)},</p>
         <p>Thank you for applying to BIPS. Your application for <b>${esc(a.course_name)}</b> was received successfully.</p>
         <p style="background:#fff7e0;border-left:4px solid #E8A317;padding:12px 14px;margin:16px 0">
           Your reference number<br><b style="font-size:20px;color:#0B2A5B;letter-spacing:1px">${esc(a.reference_number)}</b></p>
         <p>Keep this number safe. You can track your application any time on our website using this reference number and your email address.</p>
         <p>Our admissions team will review your application and contact you.</p>`, s);
      const r = await sendMail(a.email, `BIPS application received – ${a.reference_number}`, html, s.email);
      if (r.ok) await svc.from("applications").update({ confirmation_sent: true }).eq("id", a.id);
      return json({ sent: r.ok, reason: r.reason });
    }

    if (body.type === "status") {
      // caller must be a signed-in admin
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      const { data: u } = await userClient.auth.getUser();
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      const { data: adm } = await svc.from("admin_users").select("user_id").eq("user_id", u.user.id).maybeSingle();
      if (!adm) return json({ error: "Forbidden" }, 403);

      const { data: a } = await svc.from("applications").select("*").eq("id", body.application_id).maybeSingle();
      if (!a) return json({ error: "Application not found" }, 404);

      const colors: Record<string, string> = { Approved: "#1a7f37", Rejected: "#b42318", "Under Review": "#b7791f", Pending: "#5b6682" };
      const intro: Record<string, string> = {
        Approved: "Congratulations! We are pleased to inform you that your application has been <b>approved</b>.",
        Rejected: "Thank you for your interest in BIPS. After review, we are unable to offer you admission for this course at this time.",
        "Under Review": "Your application is now <b>under review</b> by our admissions team.",
        Pending: "Your application status has been updated.",
      };
      const comment = a.admin_comments
        ? `<div style="background:#f4f6fa;border-radius:8px;padding:12px 14px;margin:16px 0"><b>Message from admissions:</b><br>${esc(a.admin_comments).replace(/\n/g, "<br>")}</div>` : "";
      const html = layout(`Application ${a.status}`,
        `<p>Dear ${esc(a.full_name)},</p><p>${intro[a.status] || intro.Pending}</p>
         <p>Course: <b>${esc(a.course_name)}</b><br>Reference: <b>${esc(a.reference_number)}</b><br>
         Status: <b style="color:${colors[a.status] || "#0B2A5B"}">${esc(a.status)}</b></p>${comment}
         <p>You can check your status any time on our website using your reference number and email.</p>`, s);
      const r = await sendMail(a.email, `BIPS application ${a.status} – ${a.reference_number}`, html, s.email);
      return json({ sent: r.ok, reason: r.reason });
    }
    return json({ error: "Unknown type" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
