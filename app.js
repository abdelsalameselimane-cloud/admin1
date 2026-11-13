(() => {
  "use strict";

  if (!window.CONFIG || CONFIG.SUPABASE_URL.includes("YOUR-PROJECT")) {
    document.body.textContent = "افتح الملف config.js وضع فيه رابط المشروع والمفتاح العام.";
    return;
  }

  const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const VIEWS = ["loading", "login", "enroll", "verify", "dash"];
  const show = (name) => {
    VIEWS.forEach((v) => ($(v).hidden = v !== name));
    $("main").hidden = name === "dash";
    document.body.classList.toggle("in", name === "dash");
    if (name !== "dash") $("page").replaceChildren();
  };
  const say = (id, text) => { $(id).textContent = text || ""; };
  const busy = (form, on) => form.querySelectorAll("button").forEach((b) => (b.disabled = on));

  const ROLES = { owner: "مالك", admin: "أدمن", viewer: "مشاهد فقط" };

  async function route() {
    show("loading");
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return show("login");

    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return kick("تعذّر التحقق من الجلسة. سجّل الدخول من جديد.");

    if (aal.currentLevel === "aal2") return enterDashboard(session);
    if (aal.nextLevel === "aal2") return show("verify");
    return startEnroll();
  }

  async function kick(message) {
    await sb.auth.signOut();
    show("login");
    say("loginErr", message);
  }

  async function startEnroll() {
    say("enrollErr", "");
    // remove abandoned, never-verified factors so enrollment can be retried
    const { data: list } = await sb.auth.mfa.listFactors();
    for (const f of (list && list.all) || []) {
      if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Admin " + Date.now()
    });
    if (error) return kick("تعذّر بدء تفعيل التحقق بخطوتين: " + error.message);

    $("qr").src = data.totp.qr_code;
    $("secret").textContent = data.totp.secret;
    $("enrollForm").dataset.factor = data.id;
    $("enrollCode").value = "";
    show("enroll");
    $("enrollCode").focus();
  }

  async function enterDashboard(session) {
    const { data, error } = await sb
      .from("admin_profiles")
      .select("full_name, role, is_active")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !data || !data.is_active) {
      return kick("هذا الحساب ليس أدمن أو تم إيقافه.");
    }
    $("dName").textContent = data.full_name || "-";
    $("dEmail").textContent = session.user.email;
    $("dRole").textContent = ROLES[data.role] || data.role;
    show("dash");
    Admin.start(sb, data.role);
  }

  async function submitCode(form, factorId, errId) {
    const code = form.querySelector("input").value.trim();
    if (!/^\d{6}$/.test(code)) return say(errId, "اكتب رمزاً من 6 أرقام.");
    busy(form, true);
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    busy(form, false);
    if (error) return say(errId, "الرمز غير صحيح أو منتهي. جرّب الرمز الحالي في التطبيق.");
    say(errId, "");
    route();
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    say("loginErr", "");
    busy(form, true);
    const { error } = await sb.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    busy(form, false);
    if (error) return say("loginErr", "البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    $("password").value = "";
    route();
  });

  $("enrollForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitCode(e.currentTarget, e.currentTarget.dataset.factor, "enrollErr");
  });

  $("verifyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { data, error } = await sb.auth.mfa.listFactors();
    const factor = !error && data.totp && data.totp[0];
    if (!factor) return say("verifyErr", "لا يوجد جهاز تحقق مسجّل. سجّل الخروج وأعد المحاولة.");
    submitCode(form, factor.id, "verifyErr");
  });

  document.querySelectorAll("[data-logout]").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.auth.signOut();
      show("login");
    })
  );

  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") show("login");
  });

  route();
})();
