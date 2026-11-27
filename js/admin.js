/* BIPS admin dashboard logic */
(() => {
  const PAGE = 15;
  const STATUSES = ["Pending", "Under Review", "Approved", "Rejected"];
  const DOC_LABEL = { id_copy: "ID / Passport copy", certificates: "Certificates / results slip", passport_photo: "Passport photo" };
  const S = { user: null, role: null, name: "", view: "dashboard", F: { search: "", status: "", course: "", from: "", to: "", page: 0 }, courses: [], depts: [] };
  const isSuper = () => S.role === "super_admin";
  const view = () => $("#view");

  // ---------- modal helpers ----------
  function openModal(html, wide) {
    const m = document.createElement("div");
    m.className = "modal-back";
    m.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${html}</div>`;
    m.addEventListener("mousedown", (e) => { if (e.target === m) m.remove(); });
    m.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) m.remove(); });
    document.body.appendChild(m);
    return m;
  }
  function fieldHTML(f, v) {
    const val = v ?? f.default ?? "";
    const req = f.required ? `<span class="req">*</span>` : "";
    let input = "";
    if (f.type === "textarea") input = `<textarea name="${f.key}" ${f.required ? "required" : ""}>${esc(val)}</textarea>`;
    else if (f.type === "select") input = `<select name="${f.key}" ${f.required ? "required" : ""}>${f.options.map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? "selected" : ""}>${esc(ol)}</option>`; }).join("")}</select>`;
    else if (f.type === "checkbox") return `<div class="fld"><label class="check"><input type="checkbox" name="${f.key}" ${v ?? f.default ? "checked" : ""}><span>${esc(f.label)}</span></label></div>`;
    else if (f.type === "file") input = `<input type="file" name="${f.key}" accept="${f.accept || ""}">${val ? `<span class="hint">Current: <a href="${esc(val)}" target="_blank" rel="noopener">view image</a></span>` : ""}`;
    else input = `<input type="${f.type || "text"}" name="${f.key}" value="${esc(val)}" ${f.required ? "required" : ""} ${f.step ? `step="${f.step}"` : ""} ${f.type === "number" ? 'min="0"' : ""}>`;
    return `<div class="fld"><label>${esc(f.label)} ${req}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</div>`;
  }
  function formModal({ title, fields, values = {}, submitLabel = "Save", onSubmit }) {
    const m = openModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="x" data-close>&times;</button></div>
      <form class="modal-body" novalidate><div class="alert alert-err" style="display:none" id="fmErr"></div>${fields.map((f) => fieldHTML(f, values[f.key])).join("")}
      <div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-navy">${esc(submitLabel)}</button></div></form>`);
    const form = $("form", m);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.key];
        if (f.type === "checkbox") out[f.key] = el.checked;
        else if (f.type === "file") out[f.key] = el.files[0] || null;
        else if (f.type === "number") out[f.key] = el.value === "" ? null : Number(el.value);
        else out[f.key] = el.value.trim();
        if (f.required && (out[f.key] === "" || out[f.key] === null)) { showErr(f.label + " is required."); return; }
      }
      const btn = $(".btn-navy", form); btn.disabled = true; const t = btn.textContent; btn.textContent = "Saving…";
      try { await onSubmit(out); m.remove(); }
      catch (err) { showErr(err.message || String(err)); btn.disabled = false; btn.textContent = t; }
    });
    const showErr = (t) => { const b = $("#fmErr", m); b.textContent = t; b.style.display = "block"; };
    return m;
  }
  const confirmBox = (msg) => window.confirm(msg);
  const errToast = (e) => toast(e.message || String(e), "err");

  // ---------- auth ----------
  async function verifyAdmin(session) {
    const { data, error } = await sb.from("admin_users").select("role,full_name").eq("user_id", session.user.id).maybeSingle();
    if (error || !data) return false;
    S.user = session.user; S.role = data.role; S.name = data.full_name || session.user.email;
    return true;
  }
  async function boot() {
    if (!CONFIGURED) {
      $("#loginView").style.display = "grid";
      $("#loginAlert").innerHTML = `<div class="alert alert-err">Add your Supabase keys in <code>js/config.js</code> first.</div>`; return;
    }
    const { data: { session } } = await sb.auth.getSession();
    if (session && (await verifyAdmin(session))) return startApp();
    if (session) { await sb.auth.signOut(); }
    $("#loginView").style.display = "grid"; $("#appView").style.display = "none";
  }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#lEmail").value.trim(), password = $("#lPass").value;
    if (!email || !password) { $("#loginAlert").innerHTML = `<div class="alert alert-err">Enter your email and password.</div>`; return; }
    const btn = $("#lBtn"); btn.disabled = true; btn.textContent = "Signing in…";
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = "Sign in";
    if (error) { $("#loginAlert").innerHTML = `<div class="alert alert-err">${esc(error.message)}</div>`; return; }
    if (!(await verifyAdmin(data.session))) {
      await sb.auth.signOut();
      $("#loginAlert").innerHTML = `<div class="alert alert-err">This account does not have admin access.</div>`; return;
    }
    $("#loginAlert").innerHTML = ""; $("#lPass").value = ""; startApp();
  });
  $("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  // ---------- shell ----------
  let channel = null;
  function startApp() {
    $("#loginView").style.display = "none"; $("#appView").style.display = "block";
    $("#meEmail").textContent = S.user.email;
    $("#meRole").textContent = isSuper() ? "Super Admin" : "Admissions Officer";
    const items = [["dashboard", "📊", "Dashboard"], ["applications", "📝", "Applications"], ["courses", "🎓", "Courses"], ["departments", "🏛", "Departments"],
      ["announcements", "📣", "Announcements"], ["messages", "✉", "Messages"], ["settings", "⚙", "Settings & Contacts"]];
    if (isSuper()) items.push(["admins", "👥", "Admin Users"]);
    $("#nav").innerHTML = items.map(([k, i, l]) => `<a data-v="${k}"><span>${i}</span>${l}<span class="n" id="n-${k}"></span></a>`).join("");
    $("#nav").addEventListener("click", (e) => { const a = e.target.closest("a[data-v]"); if (a) { location.hash = a.dataset.v; $("#side").classList.remove("open"); } });
    window.addEventListener("hashchange", route);
    // realtime: new applications appear immediately
    channel = sb.channel("apps-live").on("postgres_changes", { event: "*", schema: "public", table: "applications" }, (p) => {
      if (p.eventType === "INSERT") toast("New application: " + (p.new.full_name || "") + " – " + (p.new.reference_number || ""), "ok");
      if (!$(".modal-back") && ["dashboard", "applications"].includes(S.view)) route(true);
      badges();
    }).subscribe();
    route(); badges();
  }
  async function badges() {
    const [{ count: p }, { count: m }] = await Promise.all([
      sb.from("applications").select("*", { count: "exact", head: true }).eq("status", "Pending"),
      sb.from("contact_messages").select("*", { count: "exact", head: true }).eq("is_read", false),
    ]);
    const set = (id, n) => { const el = $("#" + id); if (el) { el.textContent = n; el.style.display = n ? "inline" : "none"; } };
    set("n-applications", p || 0); set("n-messages", m || 0);
  }
  async function loadRefs() {
    const [{ data: c }, { data: d }] = await Promise.all([
      sb.from("courses").select("id,name,department_id").order("name"),
      sb.from("departments").select("id,name,slug").order("sort_order"),
    ]);
    S.courses = c || []; S.depts = d || [];
  }
  async function route(silent) {
    const v = (location.hash || "#dashboard").slice(1);
    const views = { dashboard, applications, courses, departments, announcements, messages, settings, admins };
    S.view = views[v] && !(v === "admins" && !isSuper()) ? v : "dashboard";
    $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.v === S.view));
    if (!silent) view().innerHTML = loadingHTML();
    try { await loadRefs(); await views[S.view](); } catch (e) { view().innerHTML = `<div class="alert alert-err">${esc(e.message || e)}</div>`; }
  }
  const head = (t, right = "") => `<div class="topline"><h1>${t}</h1><div>${right}</div></div>`;
  const stBadge = (s) => `<span class="badge st-${esc(s)}">${esc(s)}</span>`;

  // ---------- dashboard ----------
  async function dashboard() {
    const cnt = (st) => { let q = sb.from("applications").select("*", { count: "exact", head: true }); if (st) q = q.eq("status", st); return q; };
    const [t, p, r, a, x, { data: recent }, { data: all }] = await Promise.all([
      cnt(), cnt("Pending"), cnt("Under Review"), cnt("Approved"), cnt("Rejected"),
      sb.from("applications").select("id,reference_number,full_name,course_name,status,created_at").order("created_at", { ascending: false }).limit(8),
      sb.from("applications").select("course_name").limit(5000),
    ]);
    const per = {}; (all || []).forEach((r) => { const k = r.course_name || "(deleted course)"; per[k] = (per[k] || 0) + 1; });
    const rows = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 10), max = rows[0]?.[1] || 1;
    view().innerHTML = head("Dashboard", `<a class="btn btn-gold btn-sm" href="#applications">View all applications</a>`) + `
      <div class="stats">
        <div class="stat" data-st=""><b>${t.count ?? 0}</b><span>Total applicants</span></div>
        <div class="stat pending" data-st="Pending"><b>${p.count ?? 0}</b><span>Pending</span></div>
        <div class="stat review" data-st="Under Review"><b>${r.count ?? 0}</b><span>Under review</span></div>
        <div class="stat ok" data-st="Approved"><b>${a.count ?? 0}</b><span>Approved</span></div>
        <div class="stat bad" data-st="Rejected"><b>${x.count ?? 0}</b><span>Rejected</span></div>
      </div>
      <div class="two">
        <div class="panel"><h3>Applications per course (top 10)</h3>
          ${rows.map(([n, c]) => `<div class="hbar"><span title="${esc(n)}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n)}</span><div class="tr"><i style="width:${(c / max) * 100}%"></i></div><b>${c}</b></div>`).join("") || `<div class="empty">No applications yet.</div>`}</div>
        <div class="panel"><h3>Recent applications</h3>
          ${(recent || []).map((a) => `<div class="doc clk" data-open="${a.id}" style="cursor:pointer"><div><b>${esc(a.full_name)}</b><br><small class="muted">${esc(a.course_name || "")} · ${esc(a.reference_number)}</small></div>${stBadge(a.status)}</div>`).join("") || `<div class="empty">Nothing yet.</div>`}</div>
      </div>`;
    $$(".stat", view()).forEach((s) => s.onclick = () => { S.F = { ...S.F, status: s.dataset.st, page: 0 }; location.hash = "applications"; });
    $$("[data-open]", view()).forEach((s) => s.onclick = () => openApp(s.dataset.open));
  }

  // ---------- applications ----------
  function appQuery(sel = "*", opts) {
    const F = S.F;
    let q = sb.from("applications").select(sel, opts).order("created_at", { ascending: false });
    if (F.status) q = q.eq("status", F.status);
    if (F.course) q = q.eq("course_id", F.course);
    if (F.from) q = q.gte("created_at", F.from);
    if (F.to) q = q.lte("created_at", F.to + "T23:59:59");
    const s = F.search.replace(/[%,()*\\]/g, " ").trim();
    if (s) q = q.or(`full_name.ilike.%${s}%,reference_number.ilike.%${s}%,course_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
    return q;
  }
  async function applications() {
    const F = S.F;
    view().innerHTML = head("Applications", `<button class="btn btn-navy btn-sm" id="exp">⬇ Export CSV / Excel</button>`) + `
      <div class="panel">
        <div class="toolbar">
          <input type="search" id="fs" placeholder="Search name, course, reference, email, phone…" value="${esc(F.search)}">
          <select id="fst"><option value="">All statuses</option>${STATUSES.map((s) => `<option ${F.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <select id="fc"><option value="">All courses</option>${S.courses.map((c) => `<option value="${c.id}" ${F.course === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <input type="date" id="ff" value="${F.from}" title="From date"><input type="date" id="ft" value="${F.to}" title="To date">
          <button class="btn btn-outline btn-sm" id="fr">Reset</button>
        </div>
        <div id="tbl">${loadingHTML()}</div>
      </div>`;
    let tm;
    $("#fs").oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { F.search = e.target.value; F.page = 0; load(); }, 350); };
    $("#fst").onchange = (e) => { F.status = e.target.value; F.page = 0; load(); };
    $("#fc").onchange = (e) => { F.course = e.target.value; F.page = 0; load(); };
    $("#ff").onchange = (e) => { F.from = e.target.value; F.page = 0; load(); };
    $("#ft").onchange = (e) => { F.to = e.target.value; F.page = 0; load(); };
    $("#fr").onclick = () => { Object.assign(F, { search: "", status: "", course: "", from: "", to: "", page: 0 }); applications(); };
    $("#exp").onclick = exportCSV;
    load();
    async function load() {
      const from = F.page * PAGE;
      const { data, count, error } = await appQuery("*", { count: "exact" }).range(from, from + PAGE - 1);
      if (error) { $("#tbl").innerHTML = `<div class="alert alert-err">${esc(error.message)}</div>`; return; }
      const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
      $("#tbl").innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Reference</th><th>Applicant</th><th>Course</th><th>Phone</th><th>Applied</th><th>Status</th></tr></thead><tbody>
        ${(data || []).map((a) => `<tr class="clk" data-id="${a.id}"><td><b>${esc(a.reference_number)}</b></td><td>${esc(a.full_name)}<br><small class="muted">${esc(a.email)}</small></td><td>${esc(a.course_name || "")}</td><td>${esc(a.phone)}</td><td>${fmtDate(a.created_at)}</td><td>${stBadge(a.status)}</td></tr>`).join("") || `<tr><td colspan="6" class="center muted" style="padding:30px">No applications found.</td></tr>`}
        </tbody></table></div>
        <div class="pager"><span>${count || 0} application${count === 1 ? "" : "s"} · page ${F.page + 1} of ${pages}</span>
          <span><button class="btn btn-outline btn-sm" id="pp" ${F.page === 0 ? "disabled" : ""}>← Prev</button> <button class="btn btn-outline btn-sm" id="pn" ${F.page + 1 >= pages ? "disabled" : ""}>Next →</button></span></div>`;
      $$("tr[data-id]", $("#tbl")).forEach((r) => r.onclick = () => openApp(r.dataset.id));
      $("#pp").onclick = () => { F.page--; load(); }; $("#pn").onclick = () => { F.page++; load(); };
    }
  }

  async function exportCSV() {
    const btn = $("#exp"); btn.disabled = true; btn.textContent = "Exporting…";
    try {
      let rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await appQuery("*").range(from, from + 999);
        if (error) throw error; rows = rows.concat(data); if (data.length < 1000) break;
      }
      if (!rows.length) { toast("Nothing to export with the current filters.", "err"); return; }
      const cols = [["reference_number", "Reference"], ["created_at", "Applied on"], ["status", "Status"], ["full_name", "Full name"], ["gender", "Gender"], ["date_of_birth", "Date of birth"],
        ["email", "Email"], ["phone", "Phone"], ["nationality", "Nationality"], ["id_number", "ID/Passport"], ["county", "County"], ["address", "Address"], ["course_name", "Course"],
        ["study_mode", "Study mode"], ["highest_qualification", "Highest qualification"], ["kcse_grade", "KCSE grade"], ["previous_institution", "Previous institution"],
        ["next_of_kin_name", "Next of kin"], ["next_of_kin_phone", "Next of kin phone"], ["heard_about", "Heard about BIPS"], ["admin_comments", "Admin comments"]];
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const csv = "﻿" + [cols.map((c) => cell(c[1])).join(",")].concat(rows.map((r) => cols.map(([k]) => cell(k === "created_at" ? fmtDate(r[k], true) : r[k])).join(","))).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `BIPS-applicants-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
      toast(`Exported ${rows.length} applicant(s). Open the file in Excel.`, "ok");
    } catch (e) { errToast(e); } finally { btn.disabled = false; btn.textContent = "⬇ Export CSV / Excel"; }
  }

  async function openApp(id) {
    const m = openModal(`<div class="modal-head"><h3>Application</h3><button class="x" data-close>&times;</button></div><div class="modal-body">${loadingHTML()}</div>`, true);
    const [{ data: a, error }, { data: docs }, { data: hist }] = await Promise.all([
      sb.from("applications").select("*").eq("id", id).maybeSingle(),
      sb.from("application_documents").select("*").eq("application_id", id).order("created_at"),
      sb.from("application_status_history").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    ]);
    if (error || !a) { $(".modal-body", m).innerHTML = `<div class="alert alert-err">${esc(error?.message || "Application not found.")}</div>`; return; }
    let status = a.status;
    const kv = (k, v) => `<div><small>${k}</small>${esc(v || "—")}</div>`;
    $(".modal-head h3", m).textContent = a.reference_number + " · " + a.full_name;
    $(".modal-body", m).innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">${stBadge(a.status)}<span class="muted">Applied ${fmtDate(a.created_at, true)}</span></div>
      <div class="kv">${kv("Course", a.course_name)}${kv("Study mode", a.study_mode)}${kv("Full name", a.full_name)}${kv("Gender", a.gender)}
        ${kv("Date of birth", a.date_of_birth && fmtDate(a.date_of_birth))}${kv("Nationality", a.nationality)}${kv("Email", a.email)}${kv("Phone", a.phone)}
        ${kv("ID / Passport", a.id_number)}${kv("County", a.county)}${kv("Address", a.address)}${kv("Highest qualification", a.highest_qualification)}
        ${kv("KCSE grade", a.kcse_grade)}${kv("Previous institution", a.previous_institution)}${kv("Next of kin", a.next_of_kin_name)}${kv("Next of kin phone", a.next_of_kin_phone)}
        ${kv("Heard about BIPS", a.heard_about)}</div>
      <h3 style="margin-top:18px">Uploaded documents</h3>
      <div class="docs">${(docs || []).map((d) => `<div class="doc"><span>📄 <b>${esc(DOC_LABEL[d.doc_type] || d.doc_type)}</b><br><small class="muted">${esc(d.file_name || "")} ${d.file_size ? "· " + (d.file_size / 1024).toFixed(0) + " KB" : ""}</small></span>
        <span class="rowact"><button class="btn btn-outline btn-sm" data-view="${esc(d.file_path)}">View</button><button class="btn btn-navy btn-sm" data-dl="${esc(d.file_path)}" data-name="${esc(d.file_name || "document")}">Download</button></span></div>`).join("") || `<div class="muted">No documents uploaded.</div>`}</div>
      <h3>Decision</h3>
      <div class="statusbtns" id="sb">
        <button class="btn btn-gray" data-s="Pending">Pending</button><button class="btn btn-warn" data-s="Under Review">Under Review</button>
        <button class="btn btn-ok" data-s="Approved">Approve</button><button class="btn btn-danger" data-s="Rejected">Reject</button></div>
      <div class="fld"><label>Comments / admission instructions <span class="hint">(visible to the student)</span></label><textarea id="cmt" placeholder="e.g. Report on 6 January 2027 with original certificates and fee payment slip…">${esc(a.admin_comments || "")}</textarea></div>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="notify" checked><span>Email the student about this update</span></label>
      <div class="modal-foot" style="justify-content:space-between;flex-wrap:wrap">
        <span>${isSuper() ? `<button class="btn btn-danger btn-sm" id="del">Delete application</button>` : ""}</span>
        <span style="display:flex;gap:10px"><button class="btn btn-outline" data-close>Close</button><button class="btn btn-navy" id="save">Save changes</button></span></div>
      <h3 style="margin-top:20px">History</h3>
      ${(hist || []).map((h) => `<div class="hist"><b>${esc(h.old_status || "—")} → ${esc(h.new_status || "")}</b> <small>${fmtDate(h.created_at, true)}</small>${h.comment ? `<br>${esc(h.comment)}` : ""}</div>`).join("") || `<div class="muted">No changes recorded yet.</div>`}`;
    const mark = () => $$("#sb .btn", m).forEach((b) => b.classList.toggle("sel", b.dataset.s === status));
    mark();
    $("#sb", m).onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) { status = b.dataset.s; mark(); } };
    const signed = async (path, download) => {
      const w = window.open("", "_blank");
      const { data, error } = await sb.storage.from("documents").createSignedUrl(path, 300, download ? { download } : undefined);
      if (error) { if (w) w.close(); errToast(error); return; }
      if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
    };
    $$("[data-view]", m).forEach((b) => b.onclick = () => signed(b.dataset.view));
    $$("[data-dl]", m).forEach((b) => b.onclick = () => signed(b.dataset.dl, b.dataset.name));
    $("#save", m).onclick = async () => {
      const btn = $("#save", m); btn.disabled = true; btn.textContent = "Saving…";
      const comment = $("#cmt", m).value.trim();
      const { error: e1 } = await sb.from("applications").update({ status, admin_comments: comment || null }).eq("id", id);
      if (e1) { errToast(e1); btn.disabled = false; btn.textContent = "Save changes"; return; }
      let msg = "Application updated.";
      if ($("#notify", m).checked && (status !== a.status || comment !== (a.admin_comments || ""))) {
        const { data: r, error: e2 } = await sb.functions.invoke("send-email", { body: { type: "status", application_id: id } });
        msg += e2 || !r?.sent ? " (Email not sent: " + (r?.reason || e2?.message || "check the email function setup") + ")" : " Email sent to student.";
      }
      toast(msg, "ok"); m.remove(); route(true); badges();
    };
    const del = $("#del", m);
    if (del) del.onclick = async () => {
      if (!confirmBox(`Permanently delete application ${a.reference_number} (${a.full_name}) and its documents? This cannot be undone.`)) return;
      del.disabled = true;
      if (docs?.length) await sb.storage.from("documents").remove(docs.map((d) => d.file_path));
      const { error: e } = await sb.from("applications").delete().eq("id", id);
      if (e) { errToast(e); del.disabled = false; return; }
      toast("Application deleted.", "ok"); m.remove(); route(true); badges();
    };
  }

  // ---------- courses ----------
  async function courses() {
    const { data } = await sb.from("courses").select("*").order("name");
    const dn = Object.fromEntries(S.depts.map((d) => [d.id, d.name]));
    view().innerHTML = head("Courses", `<button class="btn btn-gold btn-sm" id="add">+ Add course</button>`) + `
      <div class="panel"><div class="toolbar"><input type="search" id="cq" placeholder="Search courses…"></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Course</th><th>Department</th><th>Level</th><th>Duration</th><th>Fee (KES)</th><th>Status</th><th></th></tr></thead><tbody id="cb"></tbody></table></div></div>`;
    const fields = (v = {}) => [
      { key: "name", label: "Course name", required: true },
      { key: "department_id", label: "Department", type: "select", required: true, options: S.depts.map((d) => [d.id, d.name]) },
      { key: "subcategory", label: "Sub-category (for short courses)", hint: "e.g. Beauty, Hairdressing and Personal Care" },
      { key: "level", label: "Level", type: "select", options: ["Short Course", "Certificate", "Diploma", "Higher Diploma"] },
      { key: "duration", label: "Duration", hint: "e.g. 3 months, 6 weeks, 2 years" },
      { key: "fee", label: "Tuition fee (KES)", type: "number", step: "1" },
      { key: "entry_requirements", label: "Minimum entry requirements", type: "textarea" },
      { key: "description", label: "Course description", type: "textarea" },
      { key: "is_featured", label: "Featured on homepage", type: "checkbox" },
      { key: "is_active", label: "Active (visible and open for applications)", type: "checkbox", default: true },
    ];
    const render = () => {
      const q = $("#cq").value.toLowerCase();
      $("#cb").innerHTML = (data || []).filter((c) => c.name.toLowerCase().includes(q)).map((c) => `<tr><td><b>${esc(c.name)}</b>${c.is_featured ? " ★" : ""}</td><td>${esc(dn[c.department_id] || "")}${c.subcategory ? `<br><small class="muted">${esc(c.subcategory)}</small>` : ""}</td><td>${esc(c.level)}</td><td>${esc(c.duration || "—")}</td><td>${c.fee != null ? Number(c.fee).toLocaleString() : "—"}</td>
        <td><span class="${c.is_active ? "tag-on" : "tag-off"}">${c.is_active ? "Active" : "Hidden"}</span></td>
        <td><div class="rowact"><button class="btn btn-outline btn-sm" data-e="${c.id}">Edit</button><button class="btn btn-danger btn-sm" data-d="${c.id}">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="7" class="center muted">No courses.</td></tr>`;
    };
    render(); $("#cq").oninput = render;
    const save = (id) => async (v) => {
      v.updated_at = new Date().toISOString();
      const { error } = id ? await sb.from("courses").update(v).eq("id", id) : await sb.from("courses").insert(v);
      if (error) throw error; toast("Course saved.", "ok"); route(true);
    };
    $("#add").onclick = () => formModal({ title: "Add course", fields: fields(), onSubmit: save(null) });
    view().onclick = (e) => {
      const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]");
      if (ed) { const c = data.find((x) => x.id === ed.dataset.e); formModal({ title: "Edit course", fields: fields(), values: c, onSubmit: save(c.id) }); }
      if (dl) { const c = data.find((x) => x.id === dl.dataset.d);
        if (!confirmBox(`Delete "${c.name}"? Existing applications keep the course name. (Tip: untick "Active" to hide it instead.)`)) return;
        sb.from("courses").delete().eq("id", c.id).then(({ error }) => { if (error) errToast(error); else { toast("Course deleted.", "ok"); route(true); } }); }
    };
  }

  // ---------- departments ----------
  async function departments() {
    const { data } = await sb.from("departments").select("*").order("sort_order");
    view().innerHTML = head("Departments", `<button class="btn btn-gold btn-sm" id="add">+ Add department</button>`) + `
      <div class="panel"><div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Name</th><th>Description</th><th></th></tr></thead><tbody>
      ${(data || []).map((d) => `<tr><td>${d.sort_order}</td><td><b>${esc(d.name)}</b></td><td>${esc(d.description || "")}</td><td><div class="rowact"><button class="btn btn-outline btn-sm" data-e="${d.id}">Edit</button><button class="btn btn-danger btn-sm" data-d="${d.id}">Delete</button></div></td></tr>`).join("")}</tbody></table></div></div>`;
    const fields = [{ key: "name", label: "Name", required: true }, { key: "description", label: "Description", type: "textarea" }, { key: "sort_order", label: "Display order", type: "number", default: 0 }];
    const save = (id) => async (v) => {
      v.sort_order = v.sort_order ?? 0;
      if (!id) v.slug = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 6);
      const { error } = id ? await sb.from("departments").update(v).eq("id", id) : await sb.from("departments").insert(v);
      if (error) throw error; toast("Department saved.", "ok"); route(true);
    };
    $("#add").onclick = () => formModal({ title: "Add department", fields, onSubmit: save(null) });
    view().onclick = (e) => {
      const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]");
      if (ed) { const d = data.find((x) => x.id === ed.dataset.e); formModal({ title: "Edit department", fields, values: d, onSubmit: save(d.id) }); }
      if (dl) { const d = data.find((x) => x.id === dl.dataset.d); if (!confirmBox(`Delete "${d.name}"?`)) return;
        sb.from("departments").delete().eq("id", d.id).then(({ error }) => { if (error) toast(error.code === "23503" ? "This department still has courses. Move or delete them first." : error.message, "err"); else { toast("Department deleted.", "ok"); route(true); } }); }
    };
  }

  // ---------- announcements ----------
  async function announcements() {
    const { data } = await sb.from("announcements").select("*").order("created_at", { ascending: false });
    view().innerHTML = head("News & Announcements", `<button class="btn btn-gold btn-sm" id="add">+ Post announcement</button>`) + `
      <div class="panel"><div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Title</th><th>Status</th><th></th></tr></thead><tbody>
      ${(data || []).map((n) => `<tr><td>${fmtDate(n.created_at)}</td><td><b>${esc(n.title)}</b><br><small class="muted">${esc((n.body || "").slice(0, 90))}</small></td><td><span class="${n.published ? "tag-on" : "tag-off"}">${n.published ? "Published" : "Draft"}</span></td>
      <td><div class="rowact"><button class="btn btn-outline btn-sm" data-e="${n.id}">Edit</button><button class="btn btn-danger btn-sm" data-d="${n.id}">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="4" class="center muted">No announcements.</td></tr>`}</tbody></table></div></div>`;
    const fields = [{ key: "title", label: "Title", required: true }, { key: "body", label: "Message", type: "textarea", required: true },
      { key: "image_file", label: "Image (optional, JPG/PNG/WebP, max 3 MB)", type: "file", accept: "image/jpeg,image/png,image/webp" }, { key: "published", label: "Published", type: "checkbox", default: true }];
    const save = (id, oldImg) => async (v) => {
      const row = { title: v.title, body: v.body, published: v.published, image_url: oldImg || null };
      if (v.image_file) {
        if (v.image_file.size > 3145728) throw new Error("Image is larger than 3 MB.");
        const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[v.image_file.type]; if (!ext) throw new Error("Use a JPG, PNG or WebP image.");
        const path = `news/${crypto.randomUUID()}.${ext}`;
        const { error: ue } = await sb.storage.from("site-images").upload(path, v.image_file, { contentType: v.image_file.type }); if (ue) throw ue;
        row.image_url = sb.storage.from("site-images").getPublicUrl(path).data.publicUrl;
      }
      const { error } = id ? await sb.from("announcements").update(row).eq("id", id) : await sb.from("announcements").insert(row);
      if (error) throw error; toast("Announcement saved.", "ok"); route(true);
    };
    $("#add").onclick = () => formModal({ title: "Post announcement", fields, onSubmit: save(null) });
    view().onclick = (e) => {
      const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]");
      if (ed) { const n = data.find((x) => x.id === ed.dataset.e); formModal({ title: "Edit announcement", fields, values: { ...n, image_file: n.image_url }, onSubmit: save(n.id, n.image_url) }); }
      if (dl) { if (!confirmBox("Delete this announcement?")) return; sb.from("announcements").delete().eq("id", dl.dataset.d).then(({ error }) => { if (error) errToast(error); else { toast("Deleted.", "ok"); route(true); } }); }
    };
  }

  // ---------- messages ----------
  async function messages() {
    const { data } = await sb.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(200);
    view().innerHTML = head("Contact Messages") + `<div class="panel"><div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>From</th><th>Message</th><th></th></tr></thead><tbody>
      ${(data || []).map((m) => `<tr class="${m.is_read ? "" : "unread"}"><td>${fmtDate(m.created_at, true)}</td><td>${esc(m.name)}<br><small><a href="mailto:${esc(m.email)}">${esc(m.email)}</a>${m.phone ? " · " + esc(m.phone) : ""}</small></td><td style="white-space:pre-line;max-width:420px">${esc(m.message)}</td>
      <td><div class="rowact">${m.is_read ? "" : `<button class="btn btn-outline btn-sm" data-r="${m.id}">Mark read</button>`}<button class="btn btn-danger btn-sm" data-d="${m.id}">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="4" class="center muted" style="padding:30px">No messages yet.</td></tr>`}</tbody></table></div></div>`;
    view().onclick = async (e) => {
      const r = e.target.closest("[data-r]"), d = e.target.closest("[data-d]");
      if (r) { await sb.from("contact_messages").update({ is_read: true }).eq("id", r.dataset.r); route(true); badges(); }
      if (d && confirmBox("Delete this message?")) { await sb.from("contact_messages").delete().eq("id", d.dataset.d); route(true); badges(); }
    };
  }

  // ---------- settings (contact details etc.) ----------
  async function settings() {
    const { data } = await sb.from("site_settings").select("key,value");
    const s = Object.fromEntries((data || []).map((r) => [r.key, r.value || ""]));
    const inp = (k, label, hint = "", type = "text") => `<div class="fld"><label>${label}</label><input type="${type}" name="${k}" value="${esc(s[k])}">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
    const ta = (k, label, hint = "") => `<div class="fld"><label>${label}</label><textarea name="${k}" style="min-height:120px">${esc(s[k])}</textarea>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
    view().innerHTML = head("Settings & Contact Details") + `<form id="sf" class="panel" novalidate>
      <h3>Contact details <span class="hint">(shown in the website header, footer and Contact page)</span></h3>
      <div class="row">${inp("phone", "Phone number")}${inp("whatsapp", "WhatsApp number", "With country code, e.g. 254712345678. Leave blank to hide the WhatsApp button.")}</div>
      <div class="row">${inp("email", "Email address", "", "email")}${inp("office_hours", "Office hours")}</div>
      ${inp("address", "Physical address / location")}
      ${inp("map_embed_url", "Google Maps embed link", "Google Maps > Share > Embed a map > copy the HTML. You can paste the whole iframe code or just the src link.")}
      <h3 style="margin-top:20px">Social media <span class="hint">(full links starting with https://)</span></h3>
      <div class="row">${inp("facebook", "Facebook")}${inp("instagram", "Instagram")}</div><div class="row">${inp("twitter", "X / Twitter")}${inp("tiktok", "TikTok")}</div>${inp("youtube", "YouTube")}
      <h3 style="margin-top:20px">Website content</h3>
      ${ta("fees_note", "Fees page note")}
      ${ta("admission_requirements", "Admission requirements", "One item per line.")}
      ${ta("entry_qualifications", "Entry qualifications / who can apply", "One item per line.")}
      <button class="btn btn-navy" id="ssave">Save settings</button></form>`;
    $("#sf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target)); const rows = [];
      let map = (fd.map_embed_url || "").trim(); const mm = map.match(/src=["']([^"']+)["']/i); if (mm) map = mm[1];
      if (map && !/^https:\/\/(www\.google\.com|maps\.google\.com)\/maps/i.test(map)) { toast("The map link must be a Google Maps embed link.", "err"); return; }
      fd.map_embed_url = map;
      for (const k of ["facebook", "instagram", "twitter", "tiktok", "youtube"]) if (fd[k] && !/^https?:\/\//i.test(fd[k])) { toast(`${k}: link must start with https://`, "err"); return; }
      for (const [key, value] of Object.entries(fd)) rows.push({ key, value: String(value).trim(), updated_at: new Date().toISOString() });
      const btn = $("#ssave"); btn.disabled = true; btn.textContent = "Saving…";
      const { error } = await sb.from("site_settings").upsert(rows, { onConflict: "key" });
      btn.disabled = false; btn.textContent = "Save settings";
      if (error) errToast(error); else toast("Settings saved. The website now shows your new details.", "ok");
    });
  }

  // ---------- admin users ----------
  async function admins() {
    const { data, error } = await sb.rpc("list_admins"); if (error) throw error;
    view().innerHTML = head("Admin Users", `<button class="btn btn-gold btn-sm" id="add">+ Add admin</button>`) + `
      <div class="alert alert-info">To add an admin, first create their account in Supabase (Authentication &gt; Users &gt; Add user) or have them sign up on the Status page, then add their email here.</div>
      <div class="panel"><div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Since</th><th></th></tr></thead><tbody>
      ${(data || []).map((a) => `<tr><td><b>${esc(a.full_name || "—")}</b></td><td>${esc(a.email)}</td><td>${a.role === "super_admin" ? "Super Admin" : "Admissions Officer"}</td><td>${fmtDate(a.created_at)}</td>
      <td><div class="rowact"><button class="btn btn-outline btn-sm" data-e="${a.user_id}">Edit role</button>${a.user_id === S.user.id ? "" : `<button class="btn btn-danger btn-sm" data-d="${a.user_id}">Remove</button>`}</div></td></tr>`).join("")}</tbody></table></div></div>`;
    const roles = [["admissions_officer", "Admissions Officer (view, approve/reject, manage content)"], ["super_admin", "Super Admin (everything, incl. delete & admin users)"]];
    const grant = (v) => sb.rpc("grant_admin", { p_email: v.email, p_name: v.full_name, p_role: v.role }).then(({ error }) => { if (error) throw error; toast("Admin saved.", "ok"); route(true); });
    $("#add").onclick = () => formModal({ title: "Add admin", fields: [{ key: "email", label: "Account email", type: "email", required: true }, { key: "full_name", label: "Full name", required: true }, { key: "role", label: "Role", type: "select", options: roles }], onSubmit: grant });
    view().onclick = (e) => {
      const ed = e.target.closest("[data-e]"), dl = e.target.closest("[data-d]");
      if (ed) { const a = data.find((x) => x.user_id === ed.dataset.e); formModal({ title: "Edit admin", fields: [{ key: "full_name", label: "Full name", required: true }, { key: "role", label: "Role", type: "select", options: roles }], values: a, onSubmit: (v) => grant({ ...v, email: a.email }) }); }
      if (dl && confirmBox("Remove this admin's access?")) sb.rpc("revoke_admin", { p_user_id: dl.dataset.d }).then(({ error }) => { if (error) errToast(error); else { toast("Admin removed.", "ok"); route(true); } });
    };
  }

  boot();
})();
