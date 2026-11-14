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
  const ic = (n) => {
    const NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg"), u = document.createElementNS(NS, "use");
    s.setAttribute("class", "ic"); s.setAttribute("aria-hidden", "true"); u.setAttribute("href", "#i-" + n); s.append(u); return s;
  };
  const btn = (label, fn, cls = "", icon) => h("button", { type: "button", class: "btn " + cls, onclick: fn }, icon && ic(icon), label);
  const tile = (n) => h("div", { class: "tile" }, ic(n));
  const loading = () => h("div", { class: "load" }, h("span", { class: "spin" }), "جارٍ التحميل…");
  const num = (n) => Number(n).toLocaleString("en-US");
  const tag = (on) => h("span", { class: "tag" + (on ? "" : " off") }, on ? "نشط" : "متوقف");
  const head = (title, ...extra) => h("div", { class: "head" }, h("h1", {}, title), extra);
  const toast = (msg, bad) => {
    const t = h("div", { class: "toast" + (bad ? " bad" : ""), role: "status" }, ic(bad ? "inbox" : "check"), msg);
    document.body.append(t); setTimeout(() => t.remove(), 4000);
  };
  const dbErr = (e) => ({
    23505: "الاسم مستخدم مسبقاً داخل نفس الموقع.",
    23514: "قيمة غير مقبولة. تأكد من السعر والتخفيض والمدة.",
    42501: "لا تملك صلاحية تنفيذ هذه العملية."
  })[e.code] || "حدث خطأ: " + e.message;
  const tbl = (cols, rows, onAdd, addLabel) => rows.length
    ? h("div", { class: "tw" }, h("table", {},
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
        h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))))
    : h("div", { class: "card empty" }, tile("inbox"), h("p", {}, "لا توجد بيانات بعد."), onAdd && btn(addLabel, onAdd, "pri", "plus"));

  // generic modal form. save(values) returns an error message, or null on success.
  function modal(title, fields, init, save) {
    const inputs = {}, err = h("p", { class: "err", role: "alert" });
    const body = fields.map((f) => {
      if (f.t === "node") { inputs[f.k] = f; return f.node; }
      const v = init[f.k] ?? "";
      let el;
      if (f.t === "area") el = h("textarea", { rows: f.rows || 3, dir: f.dir }, v);
      else if (f.t === "select") el = h("select", { disabled: f.lock }, f.opts.map(([o, l]) => h("option", { value: o, selected: o === v }, l)));
      else if (f.t === "check") el = h("input", { type: "checkbox", checked: !!v });
      else el = h("input", { type: f.t || "text", value: v, step: f.t === "number" ? "any" : null, dir: f.dir, maxlength: f.max, disabled: f.lock });
      inputs[f.k] = el;
      return h("label", { class: f.t === "check" ? "chk" : "" }, f.l, el, f.hint && h("small", {}, f.hint));
    });
    const dlg = h("dialog", { class: "modal" }, h("h1", {}, title), body, err);
    const ok = btn("حفظ", async () => {
      const vals = {};
      fields.forEach((f) => { const e = inputs[f.k]; vals[f.k] = f.t === "node" ? f.get() : f.t === "check" ? e.checked : e.value.trim(); });
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
    if (!confirm((on ? "تفعيل" : "إيقاف") + " «" + (row.name || row.label) + "»؟" + warn)) return;
    const { data, error } = await sb.from(table).update({ is_active: on }).eq("id", row.id).select("id");
    if (error || !data.length) return toast(error ? dbErr(error) : "لم يتم التنفيذ. تحقق من صلاحياتك.", true);
    toast("تم التحديث"); nav();
  }
  const actions = (table, row, edit) => h("span", { class: "acts0" },
    btn("تعديل", edit, "sm", "edit"), btn(row.is_active ? "إيقاف" : "تفعيل", () => setActive(table, row, !row.is_active), "sm", "power"));

  // ---------- Home / statistics ----------
  async function pageHome(el) {
    const { data: ss, error: e1 } = await sb.from("sites").select("id,name").order("name");
    if (e1) return el.append(h("p", { class: "err" }, dbErr(e1)));
    const site = h("select", { "aria-label": "الموقع" }, h("option", { value: "" }, "كل المواقع"), ss.map((s) => h("option", { value: s.id }, s.name)));
    const per = h("select", { "aria-label": "فترة الإيرادات" }, [["30", "آخر 30 يوماً"], ["7", "آخر 7 أيام"], ["90", "آخر 90 يوماً"], ["", "كل الفترات"]].map(([v, l]) => h("option", { value: v }, l)));
    const out = h("div", { class: "cards" });
    const card = (l, v, i) => h("div", { class: "card" }, tile(i), h("div", {}, h("b", {}, v), h("span", {}, l)));
    async function load() {
      out.replaceChildren(loading());
      const from = per.value ? new Date(Date.now() - per.value * 864e5).toISOString() : null;
      const { data, error } = await sb.rpc("admin_stats", { p_site: site.value || null, p_from: from, p_to: null });
      if (error) return out.replaceChildren(h("p", { class: "err" }, error.code === "PGRST202" ? "شغّل ملف 03_stats.sql أولاً في SQL Editor." : dbErr(error)));
      const rev = Object.entries(data.revenue).map(([c, t]) => num(t) + " " + c).join(" | ") || "0";
      out.replaceChildren(
        card("المواقع المسجلة", num(data.sites_total), "globe"), card("المواقع النشطة", num(data.sites_active), "check"),
        card("إجمالي المشتركين", num(data.subscribers), "users"), card("الاشتراكات النشطة", num(data.active), "check"),
        card("الاشتراكات المنتهية", num(data.expired), "clock"),
        card("الإيرادات (" + per.selectedOptions[0].text + ")", rev, "wallet"));
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
    el.append(head("المواقع", canEdit && btn("موقع جديد", () => siteForm(), "pri", "plus")),
      tbl(cols, data.map((s) => [s.name, s.domain || "-", String(s.allowed_origins.length), tag(s.is_active)]
        .concat(canEdit ? [actions("sites", s, () => siteForm(s))] : [])), canEdit && (() => siteForm()), "موقع جديد"));
  }

  // ---------- Plans ----------
  const PERIODS = [["subscription", "مدة الاشتراك"], ["month", "شهرياً"], ["day", "يومياً"], ["never", "دائم"]];
  function matrix(feats, rows) {
    const by = Object.fromEntries(rows.map((r) => [r.feature_id, r])), st = {};
    const list = feats.map((f) => {
      const r = by[f.id];
      const on = h("input", { type: "checkbox", checked: !!r });
      const lim = h("input", { type: "number", min: "0", placeholder: "غير محدود", value: r && r.limit_value });
      const per = h("select", {}, PERIODS.map(([v, l]) => h("option", { value: v, selected: v === (r ? r.reset_period : "subscription") }, l)));
      st[f.id] = { f, on, lim, per };
      return h("div", { class: "mrow" }, h("label", { class: "chk" }, on, f.label),
        f.kind === "limit" && h("div", { class: "mlim" }, lim, h("span", {}, f.unit || ""), per));
    });
    const node = h("div", { class: "matrix" }, h("h2", {}, "ميزات الباقة"),
      feats.length ? list : h("p", { class: "muted" }, "لا توجد ميزات نشطة لهذا الموقع. استوردها من صفحة الميزات."));
    const get = () => Object.values(st).filter((x) => x.on.checked).map((x) => ({
      feature_id: x.f.id, reset_period: x.per.value,
      limit_value: x.f.kind === "limit" && x.lim.value !== "" ? Number(x.lim.value) : null }));
    return { node, get };
  }
  async function savePF(planId, siteId, rows, listed) {
    const keep = rows.map((r) => r.feature_id), drop = listed.filter((i) => !keep.includes(i));
    if (drop.length) {
      const { error } = await sb.from("plan_features").delete().eq("plan_id", planId).in("feature_id", drop);
      if (error) return error;
    }
    if (!rows.length) return null;
    const { error } = await sb.from("plan_features").upsert(
      rows.map((r) => ({ ...r, plan_id: planId, site_id: siteId })), { onConflict: "plan_id,feature_id" });
    return error;
  }
  async function planForm(p, sites, siteId) {
    const sid = p.site_id || siteId;
    const [fe, pf] = await Promise.all([
      sb.from("features").select("id,label,kind,unit").eq("site_id", sid).eq("is_active", true).order("sort_order"),
      p.id ? sb.from("plan_features").select("feature_id,limit_value,reset_period").eq("plan_id", p.id) : { data: [] }]);
    if (fe.error || pf.error) return toast(dbErr(fe.error || pf.error), true);
    const mx = matrix(fe.data, pf.data);
    const init = { ...p, site_id: sid, currency: p.currency || "DZD",
      duration_value: p.duration_value ?? 1, duration_unit: p.duration_unit || "month",
      discount_type: p.discount_type || "none", discount_value: p.discount_value ?? 0,
      sort_order: p.sort_order ?? 0, is_active: p.is_active ?? true };
    modal(p.id ? "تعديل الباقة" : "باقة جديدة", [
      { k: "site_id", l: "الموقع", t: "select", opts: sites.map((s) => [s.id, s.name]), lock: true },
      { k: "name", l: "اسم الباقة", max: 120 },
      { k: "description", l: "الوصف", t: "area", rows: 2 },
      { k: "price", l: "السعر", t: "number" },
      { k: "currency", l: "العملة", dir: "ltr", max: 3 },
      { k: "duration_value", l: "مدة الاشتراك", t: "number" },
      { k: "duration_unit", l: "وحدة المدة", t: "select", opts: Object.entries(UNIT) },
      { k: "discount_type", l: "نوع التخفيض", t: "select", opts: [["none", "لا يوجد"], ["percent", "نسبة مئوية"], ["fixed", "مبلغ ثابت"]] },
      { k: "discount_value", l: "قيمة التخفيض", t: "number" },
      { k: "sort_order", l: "ترتيب الظهور (الأصغر أولاً)", t: "number" },
      { k: "is_active", l: "الباقة نشطة", t: "check" },
      { k: "_mx", t: "node", node: mx.node, get: mx.get }
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
      if (v._mx.some((r) => r.limit_value !== null && (!Number.isInteger(r.limit_value) || r.limit_value < 0))) return "حد الميزة عدد صحيح موجب، أو اتركه فارغاً (غير محدود).";
      const row = { name: v.name, description: v.description || null, price, currency: cur, duration_value: dur,
        duration_unit: v.duration_unit, discount_type: v.discount_type, discount_value: disc, sort_order: so, is_active: v.is_active };
      const q = p.id ? sb.from("plans").update(row).eq("id", p.id) : sb.from("plans").insert({ ...row, site_id: sid });
      const { data, error } = await q.select("id");
      if (error) return dbErr(error);
      if (!data.length) return "لم يتم الحفظ. تحقق من صلاحياتك.";
      const e2 = await savePF(p.id || data[0].id, sid, v._mx, fe.data.map((f) => f.id));
      if (e2) return "حُفظت الباقة لكن تعذّر حفظ ميزاتها: " + dbErr(e2);
      toast("تم الحفظ"); nav(); return null;
    });
  }
  async function pagePlans(el) {
    const [a, b, c] = await Promise.all([
      sb.from("sites").select("id,name").order("name"),
      sb.from("plans").select("*").order("sort_order"),
      sb.from("plan_features").select("plan_id")]);
    if (a.error || b.error || c.error) return el.append(h("p", { class: "err" }, dbErr(a.error || b.error || c.error)));
    const sites = a.data, plans = b.data, cnt = {};
    c.data.forEach((x) => (cnt[x.plan_id] = (cnt[x.plan_id] || 0) + 1));
    el.append(head("الباقات"));
    if (!sites.length) return el.append(h("div", { class: "card empty" }, tile("globe"), h("p", {}, "أضف موقعاً أولاً لتتمكن من إنشاء الباقات."), h("a", { class: "btn pri", href: "#/sites" }, "إلى المواقع")));
    const cols = ["الباقة", "السعر", "بعد التخفيض", "المدة", "الميزات", "الحالة"].concat(canEdit ? ["إجراءات"] : []);
    for (const s of sites) {
      const mine = plans.filter((p) => p.site_id === s.id);
      el.append(h("div", { class: "head" }, h("h2", {}, s.name),
        canEdit && btn("باقة جديدة", () => planForm({}, sites, s.id), "pri", "plus")),
        tbl(cols, mine.map((p) => [p.name, num(p.price) + " " + p.currency,
          p.discount_type === "none" ? "-" : num(p.final_price) + " " + p.currency,
          p.duration_value + " " + UNIT[p.duration_unit], String(cnt[p.id] || 0), tag(p.is_active)]
          .concat(canEdit ? [actions("plans", p, () => planForm(p, sites, s.id))] : [])), canEdit && (() => planForm({}, sites, s.id)), "باقة جديدة"));
    }
  }


  // ---------- Features ----------
  let curSite = "";
  const FREE = { locked: "مقفلة", open: "مفتوحة" };
  function featureForm(f, siteId) {
    const init = { ...f, kind: f.kind || "toggle", free_access: f.free_access || "locked", sort_order: f.sort_order ?? 0, is_active: f.is_active ?? true };
    modal(f.id ? "تعديل الميزة" : "ميزة جديدة", [
      { k: "key", l: "المفتاح", dir: "ltr", lock: !!f.id, hint: "حروف إنجليزية صغيرة وأرقام و_ مثل export_pdf. لا يتغير بعد الإنشاء." },
      { k: "label", l: "اسم الميزة", max: 160 },
      { k: "description", l: "الوصف", t: "area", rows: 2 },
      { k: "group_name", l: "المجموعة" },
      { k: "kind", l: "النوع", t: "select", opts: [["toggle", "تشغيل / إيقاف"], ["limit", "حد عددي"]] },
      { k: "unit", l: "وحدة الحد", hint: "للنوع العددي فقط، مثل document أو file" },
      { k: "free_access", l: "بدون اشتراك", t: "select", opts: [["locked", "مقفلة"], ["open", "مفتوحة"], ["limited", "مفتوحة بحد (للعددي)"]] },
      { k: "free_limit", l: "الحد المجاني", t: "number" },
      { k: "sort_order", l: "ترتيب الظهور", t: "number" },
      { k: "is_active", l: "الميزة نشطة", t: "check" }
    ], init, async (v) => {
      const so = Number(v.sort_order || 0), fl = Number(v.free_limit);
      if (!RE.perm.test(v.key)) return "المفتاح: حروف إنجليزية صغيرة وأرقام و_ فقط، ويبدأ بحرف.";
      if (!v.label) return "اسم الميزة مطلوب.";
      if (!Number.isInteger(so)) return "الترتيب عدد صحيح.";
      if (v.kind === "limit" && !v.unit) return "اكتب وحدة الحد للميزة العددية.";
      if (v.free_access === "limited" && (v.kind !== "limit" || v.free_limit === "" || !Number.isInteger(fl) || fl < 0)) return "الحد المجاني للميزات العددية فقط، وبعدد صحيح موجب.";
      const row = { label: v.label, description: v.description || null, group_name: v.group_name || null, kind: v.kind,
        unit: v.kind === "limit" ? v.unit : null, free_access: v.free_access,
        free_limit: v.free_access === "limited" ? fl : null, sort_order: so, is_active: v.is_active };
      const q = f.id ? sb.from("features").update(row).eq("id", f.id) : sb.from("features").insert({ ...row, key: v.key, site_id: siteId });
      const { data, error } = await q.select("id");
      if (error) return dbErr(error);
      if (!data.length) return "لم يتم الحفظ. تحقق من صلاحياتك.";
      toast("تم الحفظ"); nav(); return null;
    });
  }
  async function importFeatures(file, site) {
    try {
      if (file.size > 1e6) throw 0;
      const list = JSON.parse(await file.text()).features;
      const rows = list.map((x, i) => {
        if (!RE.perm.test(x.key) || typeof x.label !== "string" || !x.label.trim() || !["toggle", "limit"].includes(x.type)) throw 0;
        return { site_id: site.id, key: x.key, label: x.label.trim().slice(0, 160), description: x.description || null,
          group_name: x.group || null, kind: x.type, unit: x.type === "limit" ? x.unit || null : null, sort_order: i };
      });
      if (!rows.length || new Set(rows.map((r) => r.key)).size !== rows.length) throw 0;
      if (!confirm("استيراد " + rows.length + " ميزة إلى «" + site.name + "»؟\nالميزات الموجودة بنفس المفتاح تتحدّث بياناتها فقط، وإعدادات الإتاحة لا تتغير.")) return;
      const { data, error } = await sb.from("features").upsert(rows, { onConflict: "site_id,key" }).select("id");
      if (error || !data.length) return toast(error ? dbErr(error) : "لم يتم الاستيراد. تحقق من صلاحياتك.", true);
      toast("تم استيراد " + data.length + " ميزة"); nav();
    } catch (e) { toast("الملف غير صالح. استخدم ملف features.json بالصيغة المتفق عليها.", true); }
  }
  async function pageFeatures(el) {
    const { data: ss, error: e1 } = await sb.from("sites").select("id,name").order("name");
    if (e1) return el.append(h("p", { class: "err" }, dbErr(e1)));
    if (!ss.length) return el.append(head("الميزات"), h("div", { class: "card empty" }, tile("globe"), h("p", {}, "أضف موقعاً أولاً لتتمكن من إدارة ميزاته."), h("a", { class: "btn pri", href: "#/sites" }, "إلى المواقع")));
    if (!ss.some((s) => s.id === curSite)) curSite = ss[0].id;
    const site = ss.find((s) => s.id === curSite);
    const sel = h("select", { "aria-label": "الموقع", onchange: (e) => { curSite = e.target.value; nav(); } },
      ss.map((s) => h("option", { value: s.id, selected: s.id === curSite }, s.name)));
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFeatures(f, site); } });
    const [f, pl, pf] = await Promise.all([
      sb.from("features").select("*").eq("site_id", curSite).order("sort_order"),
      sb.from("plans").select("id,name").eq("site_id", curSite).order("sort_order"),
      sb.from("plan_features").select("plan_id,feature_id,limit_value").eq("site_id", curSite)]);
    if (f.error || pl.error || pf.error) return el.append(h("p", { class: "err" }, dbErr(f.error || pl.error || pf.error)));
    const inPlans = (x) => pl.data.map((p) => { const r = pf.data.find((q) => q.plan_id === p.id && q.feature_id === x.id);
      return r && p.name + (x.kind === "limit" ? " (" + (r.limit_value === null ? "∞" : r.limit_value) + ")" : ""); }).filter(Boolean).join("، ") || "-";
    const cols = ["الميزة", "المجموعة", "النوع", "بدون اشتراك", "الباقات", "الحالة"].concat(canEdit ? ["إجراءات"] : []);
    el.append(head("الميزات", h("span", { class: "acts0" }, canEdit && btn("استيراد", () => file.click(), "", "plus"), canEdit && btn("ميزة جديدة", () => featureForm({}, curSite), "pri", "plus"), file)),
      h("div", { class: "filters" }, sel),
      tbl(cols, f.data.map((x) => [h("span", {}, x.label, h("br"), h("span", { class: "key" }, x.key)), x.group_name || "-",
        x.kind === "limit" ? "حد عددي (" + (x.unit || "") + ")" : "تشغيل/إيقاف",
        x.free_access === "limited" ? "حد " + x.free_limit : FREE[x.free_access], inPlans(x), tag(x.is_active)]
        .concat(canEdit ? [actions("features", x, () => featureForm(x, curSite))] : [])),
        canEdit && (() => file.click()), "استيراد الميزات"));
  }

  // ---------- Subscribers ----------
  const ST = { active: "نشط", expired: "منتهي", suspended: "موقوف", canceled: "ملغى" };
  const eff = (s) => (s.status === "active" && new Date(s.ends_at) <= new Date() ? "expired" : s.status);
  const fmt = (d) => new Date(d).toLocaleDateString("en-GB");
  const subErr = (e) => (e.code === "23505" ? "لهذا العميل اشتراك نشط آخر بالفعل. استخدم «تمديد» عليه." : dbErr(e));
  const stTag = (st) => h("span", { class: "tag" + (st === "active" ? "" : st === "suspended" ? " warn" : " off") }, ST[st]);
  function addDur(from, n, unit) {
    const d = new Date(from);
    if (unit === "day") d.setUTCDate(d.getUTCDate() + n);
    else {
      const day = d.getUTCDate(); d.setUTCDate(1);
      if (unit === "month") d.setUTCMonth(d.getUTCMonth() + n); else d.setUTCFullYear(d.getUTCFullYear() + n);
      d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
    }
    return d;
  }
  async function audit(action, id, details) {
    const { data: { session } } = await sb.auth.getSession();
    const { error } = await sb.from("audit_log").insert({ admin_id: session.user.id, action, target_type: "subscription", target_id: id, details });
    if (error) toast("تم التنفيذ لكن تعذّر تسجيله في سجل التدقيق.", true);
  }
  async function subUpdate(row, patch, action, label) {
    if (!confirm(label + "؟")) return;
    const { data, error } = await sb.from("subscriptions").update(patch).eq("id", row.id).select("id");
    if (error || !data.length) return toast(error ? subErr(error) : "لم يتم التنفيذ. تحقق من صلاحياتك.", true);
    await audit(action, row.id, { from: { status: row.status, ends_at: row.ends_at }, to: patch });
    toast("تم التنفيذ"); nav();
  }
  function extendForm(row, who) {
    modal("تمديد اشتراك " + who, [
      { k: "n", l: "المدة المضافة", t: "number" },
      { k: "unit", l: "الوحدة", t: "select", opts: Object.entries(UNIT) }
    ], { n: 1, unit: "month" }, async (v) => {
      const n = Number(v.n);
      if (!Number.isInteger(n) || n < 1) return "المدة عدد صحيح أكبر من صفر.";
      const base = new Date(Math.max(new Date(row.ends_at), new Date()));
      const patch = { status: "active", ends_at: addDur(base, n, v.unit).toISOString() };
      const { data, error } = await sb.from("subscriptions").update(patch).eq("id", row.id).select("id");
      if (error) return subErr(error);
      if (!data.length) return "لم يتم التنفيذ. تحقق من صلاحياتك.";
      await audit("subscription.extend", row.id, { from: { status: row.status, ends_at: row.ends_at }, to: patch, added: n + " " + v.unit });
      toast("تم التمديد"); nav(); return null;
    });
  }
  function manualForm(plans, sites) {
    const sn = Object.fromEntries(sites.map((s) => [s.id, s.name]));
    modal("اشتراك يدوي", [
      { k: "plan", l: "الباقة", t: "select", opts: plans.filter((p) => p.is_active).map((p) => [p.id, sn[p.site_id] + " / " + p.name]) },
      { k: "name", l: "اسم العميل", max: 160 },
      { k: "email", l: "البريد الإلكتروني", dir: "ltr" },
      { k: "phone", l: "الهاتف (اختياري)", dir: "ltr" },
      { k: "n", l: "المدة", t: "number", hint: "اتركها فارغة لاستعمال مدة الباقة نفسها" },
      { k: "unit", l: "وحدة المدة", t: "select", opts: Object.entries(UNIT) },
      { k: "note", l: "ملاحظة (مثل: دفع CCP رقم الوصل…)", t: "area", rows: 2 }
    ], { unit: "month" }, async (v) => {
      const plan = plans.find((p) => p.id === v.plan), email = v.email.toLowerCase();
      if (!plan) return "اختر الباقة.";
      if (!v.name) return "اسم العميل مطلوب.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "البريد الإلكتروني غير صالح.";
      const custom = v.n !== "", n = custom ? Number(v.n) : plan.duration_value, unit = custom ? v.unit : plan.duration_unit;
      if (!Number.isInteger(n) || n < 1) return "المدة عدد صحيح أكبر من صفر.";
      const ex = await sb.from("customers").select("id").eq("site_id", plan.site_id).eq("email", email).maybeSingle();
      if (ex.error) return dbErr(ex.error);
      let cid = ex.data && ex.data.id;
      if (!cid) {
        const c = await sb.from("customers").insert({ site_id: plan.site_id, full_name: v.name, email, phone: v.phone || null }).select("id");
        if (c.error) return dbErr(c.error);
        cid = c.data[0].id;
      }
      const start = new Date(), row = { site_id: plan.site_id, customer_id: cid, plan_id: plan.id, status: "active",
        starts_at: start.toISOString(), ends_at: addDur(start, n, unit).toISOString(), source: "manual", note: v.note || null };
      const { data, error } = await sb.from("subscriptions").insert(row).select("id");
      if (error) return subErr(error);
      await audit("subscription.create", data[0].id, { plan: plan.name, email, ends_at: row.ends_at });
      toast("تم إنشاء الاشتراك"); nav(); return null;
    });
  }
  async function pageSubscribers(el) {
    const [s, c, p, ss] = await Promise.all([
      sb.from("subscriptions").select("*").order("ends_at", { ascending: false }).limit(500),
      sb.from("customers").select("id,full_name,email").limit(1000),
      sb.from("plans").select("id,name,site_id,is_active,duration_value,duration_unit"),
      sb.from("sites").select("id,name").order("name")]);
    const err = s.error || c.error || p.error || ss.error;
    if (err) return el.append(h("p", { class: "err" }, dbErr(err)));
    const cm = Object.fromEntries(c.data.map((x) => [x.id, x])), pm = Object.fromEntries(p.data.map((x) => [x.id, x])), sm = Object.fromEntries(ss.data.map((x) => [x.id, x.name]));
    const site = h("select", { "aria-label": "الموقع" }, h("option", { value: "" }, "كل المواقع"), ss.data.map((x) => h("option", { value: x.id }, x.name)));
    const stat = h("select", { "aria-label": "الحالة" }, h("option", { value: "" }, "كل الحالات"), Object.entries(ST).map(([k, l]) => h("option", { value: k }, l)));
    const q = h("input", { type: "search", placeholder: "بحث بالاسم أو البريد", "aria-label": "بحث" });
    const out = h("div");
    function render() {
      const term = q.value.trim().toLowerCase();
      const rows = s.data.filter((x) => {
        const cu = cm[x.customer_id] || {};
        return (!site.value || x.site_id === site.value) && (!stat.value || eff(x) === stat.value) &&
          (!term || (cu.full_name || "").toLowerCase().includes(term) || (cu.email || "").includes(term));
      }).map((x) => {
        const cu = cm[x.customer_id] || {}, st = eff(x), who = cu.full_name || "";
        const r = [h("span", {}, who, h("br"), h("span", { class: "key" }, cu.email || "")), sm[x.site_id] || "-", (pm[x.plan_id] || {}).name || "-",
          fmt(x.starts_at), fmt(x.ends_at), stTag(st), x.source === "manual" ? "يدوي" : "دفع"];
        if (canEdit) r.push(h("span", { class: "acts0" },
          btn("تمديد", () => extendForm(x, who), "sm", "plus"),
          st === "active" && btn("إيقاف", () => subUpdate(x, { status: "suspended" }, "subscription.suspend", "إيقاف اشتراك " + who), "sm", "power"),
          st === "suspended" && new Date(x.ends_at) > new Date() && btn("تفعيل", () => subUpdate(x, { status: "active" }, "subscription.activate", "تفعيل اشتراك " + who), "sm", "power"),
          (st === "active" || st === "suspended") && btn("إلغاء", () => subUpdate(x, { status: "canceled" }, "subscription.cancel", "إلغاء اشتراك " + who + " نهائياً"), "sm")));
        return r;
      });
      const cols = ["العميل", "الموقع", "الباقة", "البداية", "الانتهاء", "الحالة", "المصدر"].concat(canEdit ? ["إجراءات"] : []);
      out.replaceChildren(tbl(cols, rows, canEdit && (() => manualForm(p.data, ss.data)), "اشتراك يدوي"),
        s.data.length >= 500 ? h("p", { class: "muted" }, "يعرض آخر 500 اشتراك فقط.") : "");
    }
    [site, stat].forEach((x) => x.addEventListener("change", render)); q.addEventListener("input", render);
    el.append(head("المشتركون", canEdit && btn("اشتراك يدوي", () => manualForm(p.data, ss.data), "pri", "plus")),
      h("div", { class: "filters" }, site, stat, q), out);
    render();
  }

  // ---------- Router ----------
  const PAGES = { home: pageHome, subscribers: pageSubscribers, sites: pageSites, features: pageFeatures, plans: pagePlans };
  async function nav() {
    if ($("dash").hidden) return;
    const m = location.hash.match(/^#\/(\w+)/), key = m && PAGES[m[1]] ? m[1] : "home";
    document.querySelectorAll("#nav a").forEach((a) =>
      a.getAttribute("href") === "#/" + key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    const mine = ++token, el = h("div");
    $("page").replaceChildren(loading());
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
