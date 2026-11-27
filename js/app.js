/* BIPS shared helpers: Supabase client, header/footer, settings, course cards */
(function () {
  const C = window.BIPS_CONFIG || {};
  window.CONFIGURED = !!(C.SUPABASE_URL && !C.SUPABASE_URL.includes("YOUR-PROJECT") && C.SUPABASE_ANON_KEY && !C.SUPABASE_ANON_KEY.includes("YOUR-ANON"));
  window.sb = window.supabase.createClient(
    CONFIGURED ? C.SUPABASE_URL : "https://placeholder.supabase.co",
    CONFIGURED ? C.SUPABASE_ANON_KEY : "placeholder"
  );

  window.$ = (s, r = document) => r.querySelector(s);
  window.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  window.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  window.money = (n) => (n === null || n === undefined || n === "" ? null : "KES " + Number(n).toLocaleString("en-KE"));
  window.fmtDate = (d, time) => {
    if (!d) return "";
    const o = { day: "numeric", month: "short", year: "numeric" };
    if (time) { o.hour = "2-digit"; o.minute = "2-digit"; }
    return new Date(d).toLocaleString("en-KE", o);
  };
  window.lines = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);

  window.toast = (msg, type = "") => {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast " + type; t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), type === "err" ? 6500 : 4000);
  };
  window.loadingHTML = (m = "Loading…") => `<div class="loading"><div class="spinner"></div>${esc(m)}</div>`;

  window.KENYA_COUNTIES = ["Baringo","Bomet","Bungoma","Busia","Elgeyo-Marakwet","Embu","Garissa","Homa Bay","Isiolo","Kajiado","Kakamega","Kericho","Kiambu","Kilifi","Kirinyaga","Kisii","Kisumu","Kitui","Kwale","Laikipia","Lamu","Machakos","Makueni","Mandera","Marsabit","Meru","Migori","Mombasa","Murang'a","Nairobi","Nakuru","Nandi","Narok","Nyamira","Nyandarua","Nyeri","Samburu","Siaya","Taita-Taveta","Tana River","Tharaka-Nithi","Trans Nzoia","Turkana","Uasin Gishu","Vihiga","Wajir","West Pokot","Other (outside Kenya)"];

  // ---------- settings ----------
  let _settings = null;
  window.getSettings = async () => {
    if (_settings) return _settings;
    _settings = {};
    if (!CONFIGURED) return _settings;
    try {
      const { data } = await sb.from("site_settings").select("key,value");
      (data || []).forEach((r) => (_settings[r.key] = r.value || ""));
    } catch (e) { console.warn(e); }
    return _settings;
  };

  const NAV = [
    ["index.html", "Home"], ["about.html", "About"], ["courses.html", "Courses"],
    ["admissions.html", "Admissions"], ["departments.html", "Departments"],
    ["fees.html", "Fees"], ["news.html", "News"], ["contact.html", "Contact"], ["status.html", "Check Status"],
  ];

  function header(active, s) {
    return `
    <div class="topbar"><div class="container">
      <span class="gold">Learn · Skill · Excel</span>
      <span>
        ${s.phone ? `<a href="tel:${esc(s.phone.replace(/\s/g, ""))}">📞 ${esc(s.phone)}</a> &nbsp;·&nbsp; ` : ""}
        ${s.email ? `<a href="mailto:${esc(s.email)}">✉ ${esc(s.email)}</a>` : ""}
      </span>
    </div></div>
    <header class="site-header"><div class="container nav">
      <a class="brand" href="index.html"><img src="assets/logo.png" alt="BIPS logo">
        <span><b>Bingwa Institute</b><small>of Professional Studies</small></span></a>
      <button class="burger" aria-label="Menu" onclick="document.getElementById('menu').classList.toggle('open')">☰</button>
      <ul class="menu" id="menu">
        ${NAV.map(([h, t]) => `<li><a href="${h}" class="${active === h ? "active" : ""}">${t}</a></li>`).join("")}
        <li><a class="btn btn-gold btn-sm" href="apply.html">Apply Now</a></li>
      </ul>
    </div></header>`;
  }

  function footer(s) {
    const soc = [["facebook", "Facebook"], ["instagram", "Instagram"], ["twitter", "X / Twitter"], ["tiktok", "TikTok"], ["youtube", "YouTube"]]
      .filter(([k]) => /^https?:\/\//i.test(s[k] || ""))
      .map(([k, n]) => `<a href="${esc(s[k])}" target="_blank" rel="noopener">${n}</a>`).join("");
    return `
    <footer class="site-footer"><div class="container">
      <div class="cols">
        <div>
          <div class="foot-brand"><img src="assets/logo.png" alt="BIPS"><span><b>Bingwa Institute<br>of Professional Studies</b><small>Kuwa Bingwa – Become a Champion</small></span></div>
          <p>Learn. Skill. Excel.</p>
          <span class="promise">Your Future, Our Priority.</span>
          ${soc ? `<div class="socials">${soc}</div>` : ""}
        </div>
        <div><h4>Quick Links</h4><ul>
          ${NAV.map(([h, t]) => `<li><a href="${h}">${t}</a></li>`).join("")}
          <li><a href="apply.html">Apply Online</a></li></ul></div>
        <div><h4>Contact Us</h4><ul>
          ${s.phone ? `<li>📞 <a href="tel:${esc(s.phone.replace(/\s/g, ""))}">${esc(s.phone)}</a></li>` : ""}
          ${s.email ? `<li>✉ <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>` : ""}
          ${s.address ? `<li>📍 ${esc(s.address)}</li>` : ""}
          ${s.office_hours ? `<li>🕘 ${esc(s.office_hours)}</li>` : ""}
        </ul></div>
      </div>
      <div class="copy">© ${new Date().getFullYear()} Bingwa Institute of Professional Studies (BIPS). All rights reserved.
        <a href="admin.html" style="opacity:.45;margin-left:8px">Staff</a></div>
    </div></footer>
    ${s.whatsapp ? `<a class="wa" id="waBtn" target="_blank" rel="noopener" href="https://wa.me/${esc(s.whatsapp.replace(/\D/g, ""))}">💬 WhatsApp</a>` : ""}`;
  }

  window.pageInit = async (active) => {
    const s = await getSettings();
    $("#site-header").innerHTML = header(active, s);
    $("#site-footer").innerHTML = footer(s);
    const wa = $("#waBtn"); if (wa) wa.style.display = "block";
    $$("[data-setting]").forEach((el) => {
      const v = s[el.dataset.setting];
      if (v) el.textContent = v;
    });
    if (!CONFIGURED) {
      const b = document.createElement("div");
      b.className = "alert alert-err"; b.style.cssText = "margin:0;border-radius:0;text-align:center";
      b.innerHTML = "<b>Setup needed:</b> add your Supabase URL and anon key in <code>js/config.js</code> (see README).";
      document.body.prepend(b);
    }
    return s;
  };

  // ---------- course card ----------
  window.courseCard = (c, deptName) => {
    const fee = money(c.fee);
    return `
    <article class="card course-card">
      ${c.is_featured ? `<span class="badge badge-feat">★ Featured</span>` : ""}
      <div class="card-body">
        <span class="dept">${esc(deptName || "")}${c.subcategory ? " · " + esc(c.subcategory) : ""}</span>
        <h3>${esc(c.name)}</h3>
        <div><span class="badge ${c.level === "Short Course" ? "badge-short" : "badge-level"}">${esc(c.level)}</span></div>
        <p class="desc">${esc(c.description || "")}</p>
        <div class="meta">
          <span>⏱ <b>${esc(c.duration || "Duration to be confirmed")}</b></span>
        </div>
        <div class="meta"><span>📋 ${esc(c.entry_requirements || "Open to all interested learners")}</span></div>
        <div class="fee">${fee ? esc(fee) : "Fee to be confirmed"} ${fee ? "<small>tuition</small>" : ""}</div>
        <a class="btn btn-gold btn-sm" href="apply.html?course=${encodeURIComponent(c.id)}">Apply Now</a>
      </div>
    </article>`;
  };
})();
