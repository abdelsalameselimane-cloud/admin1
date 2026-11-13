window.Admin = (() => {
  "use strict";
  const SITE_COLS = "id,name,domain,allowed_origins,api_key_prefix,branding,success_url,cancel_url,is_active";
  const UNIT = { day: "يوم", month: "شهر", year: "سنة" };
  const RE = {
    origin: /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i, url: /^https?:\/\/\S+$/i, https: /^https:\/\/\S+$/i,
    hex: /^#[0-9a-f]{6}$/i, domain: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i, perm: /^[a-z][a-z0-9_]*$/
  };
  let sb, canEdit = false, wired = false, token = 0;
  const $ = (id) => document.getElementById(id);

  // tiny DOM builder: text is always inserted as text (no innerHTML => no XSS)
  const h = (tag, a = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(a)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    kids.flat(2).forEach((c) => { if (c !== false && c != null) el.append(c instanceof Node ? c : String(c)); });
    return el;
  };
  const btn = (label, fn, cls = "") => h("button", { type: "button", class: "btn " + cls, onclick: fn }, label);
  const num = (n) => Number(n).toLocaleString("en-US");
  const tag = (on) => h("span", { class: "tag" + (on ? "" : " off") }, on ? "نشط" : "متوقف");
  const head = (title, ...extra) => h("div", { class: "head" }, h("h1", {}, title), extra);
  const toast = (msg, bad) => {
    const t = h("div", { class: "toast" + (bad ? " bad" : ""), role: "status" }, msg);
    document.body.append(t); setTimeout(() => t.remove(), 4000);
  };
  const dbErr = (e) => ({
    23505: "الاسم مستخدم مسبقاً داخل نفس الموقع.",
    23514: "قيمة غير مقبولة. تأكد من السعر والتخفيض والمدة.",
    42501: "لا تملك صلاحية تنفيذ هذه العملية."
  })[e.code] || "حدث خطأ: " + e.message;
  const tbl = (cols, rows) => rows.length
    ? h("div", { class: "tw" }, h("table", {},
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
        h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))))
    : h("p", { class: "muted" }, "لا توجد بيانات بعد.");

  // generic modal form. save(values) returns an error message, or null on success.
  function modal(title, fields, init, save) {
    const inputs = {}, err = h("p", { class: "err", role: "alert" });
    const body = fields.map((f) => {
      const v = init[f.k] ?? "";
      let el;
      if (f.t === "area") el = h("textarea", { rows: f.rows || 3, dir: f.dir }, v);
      else if (f.t === "select") el = h("select", { disabled: f.lock }, f.opts.map(([o, l]) => h("option", { value: o, selected: o === v }, l)));
      else if (f.t === "check") el = h("input", { type: "checkbox", checked: !!v });
      else el = h("input", { type: f.t || "text", value: v, step: f.t === "number" ? "any" : null, dir: f.dir, maxlength: f.max });
      inputs[f.k] = el;
      return h("label", { class: f.t === "check" ? "chk" : "" }, f.l, el, f.hint && h("small", {}, f.hint));
    });
    const dlg = h("dialog", { class: "modal" }, h("h1", {}, title), body, err);
    const ok = btn("حفظ", async () => {
      const vals = {};
      fields.forEach((f) => { const e = inputs[f.k]; vals[f.k] = f.t === "check" ? e.checked : e.value.trim(); });
      ok.disabled = true; err.textContent = "";
      const msg = await save(vals);
      ok.disabled = false;
      if (msg) err.textContent = msg; else dlg.close();
    }, "pri");
    dlg.append(h("div", { class: "acts" }, btn("إلغاء", () => dlg.close()), ok));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  async function setActive(table, row, on) {
    const warn = !on && table === "sites" ? "\nسيختفي الموقع وباقاته عن الزوار." : "";
    if (!confirm((on ? "تفعيل" : "إيقاف") + " «" + row.name + "»؟" + warn)) return;
    const { data, error } = await sb.from(table).update({ is_active: on }).eq("id", row.id).select("id");
    if (error || !data.length) return toast(error ? dbErr(error) : "لم يتم التنفيذ. تحقق من صلاحياتك.", true);
    toast("تم التحديث"); nav();
  }
  const actions = (table, row, edit) => h("span", { class: "acts0" },
    btn("تعديل", edit), btn(row.is_active ? "إيقاف" : "تفعيل", () => setActive(table, row, !row.is_active)));

  // ---------- Home / statistics ----------
  async function pageHome(el) {
    const { data: ss, error: e1 } = await sb.from("sites").select("id,name").order("name");
    if (e1) return el.append(h("p", { class: "err" }, dbErr(e1)));
    const site = h("select", { "aria-label": "الموقع" }, h("option", { value: "" }, "كل المواقع"), ss.map((s) => h("option", { value: s.id }, s.name)));
    const per = h("select", { "aria-label": "فترة الإيرادات" }, [["30", "آخر 30 يوماً"], ["7", "آخر 7 أيام"], ["90", "آخر 90 يوماً"], ["", "كل الفترات"]].map(([v, l]) => h("option", { value: v }, l)));
    const out = h("div", { class: "cards" });
    const card = (l, v) => h("div", { class: "card" }, h("b", {}, v), h("span", {}, l));
    async function load() {
      out.replaceChildren(h("p", {}, "جارٍ التحميل…"));
      const from = per.value ? new Date(Date.now() - per.value * 864e5).toISOString() : null;
      const { data, error } = await sb.rpc("admin_stats", { p_site: site.value || null, p_from: from, p_to: null });
      if (error) return out.replaceChildren(h("p", { class: "err" }, error.code === "PGRST202" ? "شغّل ملف 03_stats.sql أولاً في SQL Editor." : dbErr(error)));
      const rev = Object.entries(data.revenue).map(([c, t]) => num(t) + " " + c).join(" | ") || "0";
      out.replaceChildren(
        card("المواقع المسجلة", num(data.sites_total)), card("المواقع النشطة", num(data.sites_active)),
        card("إجمالي المشتركين", num(data.subscribers)), card("الاشتراكات النشطة", num(data.active)),
        card("الاشتراكات المنتهية", num(data.expired)),
        card("الإيرادات (" + per.selectedOptions[0].text + ")", rev));
    }
    site.addEventListener("change", load); per.addEventListener("change", load);
    el.append(head("الرئيسية"), h("div", { class: "filters" }, site, per), out);
    load();
  }

  // ---------- Sites ----------
  function siteForm(s = {}) {
    const b = s.branding || {};
    const init = {
      name: s.name, domain: s.domain, origins: (s.allowed_origins || []).join("\n"),
      b_name: b.display_name, b_color: b.primary_color || "#0b5d57", b_logo: b.logo_url,
      success_url: s.success_url, cancel_url: s.cancel_url, is_active: s.is_active ?? true
    };
    modal(s.id ? "تعديل الموقع" : "موقع جديد", [
      { k: "name", l: "اسم الموقع", max: 120 },
      { k: "domain", l: "النطاق", dir: "ltr", hint: "مثال: example.com" },
      { k: "origins", l: "النطاقات المسموحة (allowed_origins)", t: "area", dir: "ltr", hint: "كل نطاق في سطر، مثل https://example.com (بدون مسار)" },
      { k: "b_name", l: "اسم العرض (الهوية)" },
      { k: "b_color", l: "اللون الأساسي", t: "color" },
      { k: "b_logo", l: "رابط الشعار (https)", dir: "ltr" },
      { k: "success_url", l: "رابط النجاح", dir: "ltr" },
      { k: "cancel_url", l: "رابط الإلغاء", dir: "ltr" },
      { k: "is_active", l: "الموقع نشط", t: "check" }
    ], init, async (v) => {
      if (!v.name) return "اسم الموقع مطلوب.";
      if (v.domain && !RE.domain.test(v.domain)) return "النطاق غير صالح (مثال: example.com).";
      const origins = [...new Set(v.origins.split(/\s+/).filter(Boolean).map((o) => o.replace(/\/$/, "").toLowerCase()))];
      if (origins.some((o) => !RE.origin.test(o))) return "النطاقات المسموحة بصيغة https://example.com فقط، بلا مسار أو نجمة.";
      if (!RE.hex.test(v.b_color)) return "اللون غير صالح.";
      if (v.b_logo && !RE.https.test(v.b_logo)) return "رابط الشعار يجب أن يبدأ بـ https://";
      for (const u of [v.success_url, v.cancel_url]) if (u && !RE.url.test(u)) return "رابط النجاح/الإلغاء يجب أن يبدأ بـ http:// أو https://";
      const branding = { ...b, primary_color: v.b_color };
      if (v.b_name) branding.display_name = v.b_name; else delete branding.display_name;
      if (v.b_logo) branding.logo_url = v.b_logo; else delete branding.logo_url;
      const row = { name: v.name, domain: v.domain.toLowerCase() || null, allowed_origins: origins, branding,
        success_url: v.success_url || null, cancel_url: v.cancel_url || null, is_active: v.is_active };
      const q = s.id ? sb.from("sites").update(row).eq("id", s.id) : sb.from("sites").insert(row);
      const { data, error } = await q.select("id");
      if (error) return dbErr(error);
      if (!data.length) return "لم يتم الحفظ. تحقق من صلاحياتك.";
      toast("تم الحفظ"); nav(); return null;
    });
  }
  async function pageSites(el) {
    const { data, error } = await sb.from("sites").select(SITE_COLS).order("created_at");
    if (error) return el.append(h("p", { class: "err" }, dbErr(error)));
    const cols = ["الموقع", "النطاق", "النطاقات المسموحة", "الحالة"].concat(canEdit ? ["إجراءات"] : []);
    el.append(head("المواقع", canEdit && btn("+ موقع جديد", () => siteForm(), "pri")),
      tbl(cols, data.map((s) => [s.name, s.domain || "-", String(s.allowed_origins.length), tag(s.is_active)]
        .concat(canEdit ? [actions("sites", s, () => siteForm(s))] : []))));
  }

  // ---------- Plans ----------
  function planForm(p, sites, allPerms, siteId) {
    const init = { ...p, site_id: p.site_id || siteId, features: (p.features || []).join("\n"),
      permissions: (p.permissions || []).join("\n"), currency: p.currency || "DZD",
      duration_value: p.duration_value ?? 1, duration_unit: p.duration_unit || "month",
      discount_type: p.discount_type || "none", discount_value: p.discount_value ?? 0,
      sort_order: p.sort_order ?? 0, is_active: p.is_active ?? true };
    modal(p.id ? "تعديل الباقة" : "باقة جديدة", [
      { k: "site_id", l: "الموقع", t: "select", opts: sites.map((s) => [s.id, s.name]), lock: !!p.id },
      { k: "name", l: "اسم الباقة", max: 120 },
      { k: "description", l: "الوصف", t: "area", rows: 2 },
      { k: "price", l: "السعر", t: "number" },
      { k: "currency", l: "العملة", dir: "ltr", max: 3 },
      { k: "duration_value", l: "مدة الاشتراك", t: "number" },
      { k: "duration_unit", l: "وحدة المدة", t: "select", opts: Object.entries(UNIT) },
      { k: "features", l: "المزايا (للعرض)", t: "area", rows: 4, hint: "كل ميزة في سطر" },
      { k: "permissions", l: "الصلاحيات", t: "area", dir: "ltr", hint: "كل صلاحية في سطر، حروف إنجليزية صغيرة و_ مثل export" + (allPerms.length ? " — مستخدمة سابقاً: " + allPerms.join(", ") : "") },
      { k: "discount_type", l: "نوع التخفيض", t: "select", opts: [["none", "لا يوجد"], ["percent", "نسبة مئوية"], ["fixed", "مبلغ ثابت"]] },
      { k: "discount_value", l: "قيمة التخفيض", t: "number" },
      { k: "sort_order", l: "ترتيب الظهور (الأصغر أولاً)", t: "number" },
      { k: "is_active", l: "الباقة نشطة", t: "check" }
    ], init, async (v) => {
      const price = Number(v.price), dur = Number(v.duration_value), so = Number(v.sort_order || 0), cur = v.currency.toUpperCase();
      let disc = Number(v.discount_value || 0);
      if (!v.name) return "اسم الباقة مطلوب.";
      if (v.price === "" || !(price >= 0)) return "السعر غير صالح.";
      if (!Number.isInteger(dur) || dur < 1) return "المدة عدد صحيح أكبر من صفر.";
      if (!/^[A-Z]{3}$/.test(cur)) return "العملة 3 أحرف مثل DZD.";
      if (!Number.isInteger(so)) return "الترتيب عدد صحيح.";
      if (v.discount_type === "none") disc = 0;
      else if (!(disc > 0) || (v.discount_type === "percent" && disc > 100) || (v.discount_type === "fixed" && disc > price)) return "قيمة التخفيض غير صالحة (النسبة حتى 100، والمبلغ الثابت لا يتجاوز السعر).";
      const perms = [...new Set(v.permissions.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))];
      if (perms.some((x) => !RE.perm.test(x))) return "الصلاحيات: حروف إنجليزية صغيرة وأرقام و_ فقط، وتبدأ بحرف.";
      const row = { name: v.name, description: v.description || null, price, currency: cur, duration_value: dur,
        duration_unit: v.duration_unit, features: v.features.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
        permissions: perms, discount_type: v.discount_type, discount_value: disc, sort_order: so, is_active: v.is_active };
      const q = p.id ? sb.from("plans").update(row).eq("id", p.id) : sb.from("plans").insert({ ...row, site_id: v.site_id });
      const { data, error } = await q.select("id");
      if (error) return dbErr(error);
      if (!data.length) return "لم يتم الحفظ. تحقق من صلاحياتك.";
      toast("تم الحفظ"); nav(); return null;
    });
  }
  async function pagePlans(el) {
    const [a, b] = await Promise.all([
      sb.from("sites").select("id,name").order("name"),
      sb.from("plans").select("*").order("sort_order")]);
    if (a.error || b.error) return el.append(h("p", { class: "err" }, dbErr(a.error || b.error)));
    const sites = a.data, plans = b.data, allPerms = [...new Set(plans.flatMap((p) => p.permissions))].sort();
    el.append(head("الباقات"));
    if (!sites.length) return el.append(h("p", { class: "muted" }, "أضف موقعاً أولاً من صفحة المواقع."));
    const cols = ["الباقة", "السعر", "بعد التخفيض", "المدة", "الصلاحيات", "الحالة"].concat(canEdit ? ["إجراءات"] : []);
    for (const s of sites) {
      const mine = plans.filter((p) => p.site_id === s.id);
      el.append(h("div", { class: "head" }, h("h2", {}, s.name),
        canEdit && btn("+ باقة جديدة", () => planForm({}, sites, allPerms, s.id), "pri")),
        tbl(cols, mine.map((p) => [p.name, num(p.price) + " " + p.currency,
          p.discount_type === "none" ? "-" : num(p.final_price) + " " + p.currency,
          p.duration_value + " " + UNIT[p.duration_unit], p.permissions.join(", ") || "-", tag(p.is_active)]
          .concat(canEdit ? [actions("plans", p, () => planForm(p, sites, allPerms, s.id))] : []))));
    }
  }

  // ---------- Router ----------
  const PAGES = { home: pageHome, sites: pageSites, plans: pagePlans };
  async function nav() {
    if ($("dash").hidden) return;
    const m = location.hash.match(/^#\/(\w+)/), key = m && PAGES[m[1]] ? m[1] : "home";
    document.querySelectorAll("#nav a").forEach((a) =>
      a.getAttribute("href") === "#/" + key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    const mine = ++token, el = h("div");
    $("page").replaceChildren(h("p", {}, "جارٍ التحميل…"));
    try { await PAGES[key](el); } catch (e) { el.append(h("p", { class: "err" }, "تعذّر تحميل الصفحة.")); }
    if (mine === token) $("page").replaceChildren(el);
  }
  function start(client, role) {
    sb = client; canEdit = role !== "viewer";
    if (!wired) { addEventListener("hashchange", nav); wired = true; }
    if (/^#\/\w+/.test(location.hash)) nav(); else location.hash = "#/home";
  }
  return { start };
})();
