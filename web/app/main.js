// OnePager app.
// Flow: (1) target + upload CV or fill form -> (2) Master CV structured and saved in the backend
//       -> (3) one-pager written from the stored Master CV, fit to one page, checked -> download PDF or Word.
import { sb, currentUser, signInWithGoogle, sendEmailCode, verifyEmailCode, signOut, extractMaster, generateResume, openResume, startCheckout, confirmPayment, loadMaster, saveMaster, saveResume, listResumes, track } from "./api.js";
import { fileToText } from "./extract-text.js";
import { renderMasterForm, SECTIONS, clean } from "./master-form.js";
import { DOMAINS, DOMAIN_KEYWORDS } from "./knowledge.js";
import { renderResume, checkFit } from "../resume/render.js";
import { validate, checkFacts } from "../resume/validate.js";
import { downloadPdf, saveBlob } from "../resume/export-pdf.js";
import { buildDocxBlob } from "../resume/export-docx.js";
import { autoFit, needsWork } from "./fit-loop.js";
import { GOOGLE_SIGNIN } from "../config.js";
import { loadSettings } from "./settings.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const S = await loadSettings(); // { paymentsLive, price }
const state = { master: null, source: null, resume: null, resumeId: null, flags: [], fit: null, status: "free", price: S.price, domain: "General", role: "", jd: "" };
const isLocked = () => state.status === "locked";
document.querySelectorAll(".price").forEach((el) => (el.textContent = S.price));

// ---------- helpers ----------
function toast(msg, err = false) {
  const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 12000 : 3000);
}
// Progress overlay with named steps
let busyTimer;
const busy = {
  start(title, steps) {
    $("#busy-t").textContent = title; $("#busy-s").textContent = "";
    $("#busy-steps").innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join(""); $("#busy").hidden = false;
    const t0 = Date.now(); clearInterval(busyTimer);
    const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); $("#busy-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    tick(); busyTimer = setInterval(tick, 1000);
  },
  step(i, note = "") { [...$("#busy-steps").children].forEach((li, j) => (li.className = j < i ? "done" : j === i ? "now" : "")); $("#busy-s").textContent = note; },
  stop() { $("#busy").hidden = true; clearInterval(busyTimer); },
};
function show(step) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== `v-${step}`;
  const order = ["start", "master", "resume"];
  document.querySelectorAll("#steps li").forEach((li) => { const i = order.indexOf(li.dataset.step), c = order.indexOf(step); li.className = i === c ? "on" : i < c ? "done" : ""; });
  // Leave a sign-in link's #access_token in place until Supabase has read it.
  if (!/access_token|error_description/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + `#${step}`);
  window.scrollTo(0, 0);
}
const headerFromMaster = (m) => { const p = m?.personal || {}; return { name: p.name || "", email: p.email || "", phone: p.phone || "", linkedin: p.linkedin || "", portfolio: p.portfolio || "" }; };
const readTarget = () => { state.domain = $("#domain").value || "General"; state.role = $("#role").value.trim(); state.jd = $("#jd").value.trim(); };
const domainLabel = (d) => d.replace("Fo-COS", "Founder's Office");

// ---------- auth ----------
async function requireUser() {
  const u = await currentUser();
  if (u) return u;
  $("#auth").hidden = false;
  return new Promise((resolve) => {
    const { data } = sb.auth.onAuthStateChange((_e, session) => { if (session?.user) { $("#auth").hidden = true; data.subscription.unsubscribe(); resolve(session.user); } });
  });
}
$("#google").onclick = () => signInWithGoogle().catch((e) => ($("#auth-msg").textContent = e.message));
const authError = (e) => /rate limit|too many/i.test(e.message)
  ? (GOOGLE_SIGNIN ? "Too many sign-in emails were sent recently. Use Continue with Google, or try again in a few minutes." : "Too many sign-in emails were sent recently. Please try again in a few minutes.")
  : e.message;
$("#send-link").onclick = async () => {
  const email = $("#email").value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { $("#auth-msg").textContent = "Enter a valid email address."; return; }
  const btn = $("#send-link"); btn.disabled = true;
  try {
    await sendEmailCode(email);
    $("#code-step").hidden = false; $("#code").focus();
    $("#auth-msg").textContent = `We emailed a code to ${email}. Enter it above, or open the link in the email on this device.`;
    btn.textContent = "Resend code"; track("auth_code_sent");
    setTimeout(() => (btn.disabled = false), 60000); // Supabase allows one email per address per minute
  } catch (e) { $("#auth-msg").textContent = authError(e); btn.disabled = false; }
};
$("#verify-code").onclick = async () => {
  const email = $("#email").value.trim(), code = $("#code").value.replace(/\s/g, "");
  if (!/^\d{6,10}$/.test(code)) { $("#auth-msg").textContent = "Enter the code from the email (numbers only)."; return; }
  try { await verifyEmailCode(email, code); $("#auth-msg").textContent = ""; track("auth_code_verified"); }
  catch (e) { $("#auth-msg").textContent = /expired|invalid/i.test(e.message) ? "That code is wrong or has expired. Check the latest email, or resend." : authError(e); }
};
$("#code").onkeydown = (e) => { if (e.key === "Enter") $("#verify-code").click(); };
async function paintWho(u) {
  if (u === undefined) u = await currentUser();
  $("#who").innerHTML = u ? `<span class="email" title="${esc(u.email || "")}">${esc(u.email || "Signed in")}</span><button class="link" id="out" type="button">Sign out</button>`
    : `<button class="btn ghost sm" id="signin" type="button">Sign in</button>`;
  if (!u) $("#signin").onclick = () => requireUser().then(() => paintSaved().catch(() => {}));
  if (u) $("#out").onclick = async () => { await signOut(); location.reload(); };
}
// Never call Supabase inside the auth listener itself (supabase-js holds a lock there and the page would hang):
// defer the work to the next tick.
sb.auth.onAuthStateChange((event, session) => {
  setTimeout(() => {
    paintWho(session?.user ?? null);
    if (event === "SIGNED_IN") paintSaved().catch(() => {});
  }, 0);
});

// ---------- 1. start ----------
// Target domain as a row of chips (a radio group); the value lives in the hidden #domain input.
function setDomain(d) {
  $("#domain").value = d;
  document.querySelectorAll(".domain-chip").forEach((b) => { const on = b.dataset.domain === d; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
}
$("#domain-chips").innerHTML = ["General", ...DOMAINS].map((d) =>
  `<button type="button" class="domain-chip" role="radio" aria-checked="false" data-domain="${esc(d)}">${esc(d === "General" ? "Not sure yet" : domainLabel(d))}</button>`).join("");
$("#domain-chips").onclick = (e) => { const b = e.target.closest(".domain-chip"); if (b) setDomain(b.dataset.domain); };
$("#domain-chips").onkeydown = (e) => {
  const chips = [...document.querySelectorAll(".domain-chip")], i = chips.indexOf(document.activeElement);
  if (i < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
  e.preventDefault(); const n = chips[(i + (/Right|Down/.test(e.key) ? 1 : chips.length - 1)) % chips.length]; setDomain(n.dataset.domain); n.focus();
};
setDomain("General");
paintOffer([]);
if (GOOGLE_SIGNIN) { $("#google").hidden = false; $("#or").hidden = false; }

function wireDrop(labelSel, inputSel) {
  const label = $(labelSel), input = $(inputSel);
  label.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
  label.ondragover = (e) => { e.preventDefault(); label.classList.add("over"); };
  label.ondragleave = () => label.classList.remove("over");
  label.ondrop = (e) => { e.preventDefault(); label.classList.remove("over"); if (e.dataTransfer.files[0]) fromUpload(e.dataTransfer.files[0]); };
  input.onchange = () => { if (input.files[0]) fromUpload(input.files[0]); input.value = ""; };
}
wireDrop("#drop-cv", "#file-cv");

// Upload path: file -> text -> Master CV (structured + saved by the backend) -> one-pager
async function fromUpload(file) {
  readTarget();
  await requireUser();
  if (!(await confirmPaidRun())) return;
  const steps = ["Reading your CV", "Structuring it into your Master CV", "Writing your one-pager", "Fitting it to one page"];
  busy.start("Building your one-pager", steps);
  try {
    busy.step(0, file.name);
    const text = await fileToText(file);
    busy.step(1, "Sorting everything into your Master CV sections and saving it to your account.");
    const { master } = await extractMaster(text);
    state.master = master; state.source = "upload";
    track("master_saved", { source: "upload", type: file.name.split(".").pop() });
    await writeOnePager(2);
  } catch (e) { toast(e.message, true); }
  finally { busy.stop(); }
}

$("#go-form").onclick = async () => { readTarget(); await requireUser(); state.source = state.source || "form"; openMaster(); };

async function paintSaved() {
  const u = await currentUser(); if (!u) return;
  const [m, list] = await Promise.all([loadMaster(), listResumes()]);
  const items = [];
  if (m?.data && Object.keys(m.data).length) items.push(`<li><span><b>Master CV</b> · saved ${new Date(m.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span><span style="display:flex;gap:8px"><button class="btn secondary" data-edit-master type="button">Edit</button><button class="btn" data-use-master type="button">Create one-pager from it</button></span></li>`);
  const pill = (st) => !S.paymentsLive ? "" : st === "locked" ? `<span class="pill mid">Locked · ${S.price}</span>` : st === "paid" ? `<span class="pill ok">Paid</span>` : `<span class="pill ok">Free</span>`;
  for (const r of list) items.push(`<li><span><b>${esc(r.domain === "General" ? "General" : domainLabel(r.domain))} one-pager</b>${r.target_role ? " · " + esc(r.target_role) : ""} · ${new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${pill(r.status)}</span><button class="btn secondary" data-open-resume="${r.id}" type="button">${r.status === "locked" ? "View &amp; unlock" : "Open"}</button></li>`);
  paintOffer(list);
  $("#saved").hidden = !items.length; $("#saved-list").innerHTML = items.join("");
  $("#saved-list").onclick = async (e) => {
    if (e.target.closest("[data-edit-master]")) { readTarget(); state.master = m.data; state.source = m.source; openMaster(); }
    if (e.target.closest("[data-use-master]")) { readTarget(); state.master = m.data; fromStored(); }
    const id = e.target.closest("[data-open-resume]")?.dataset.openResume;
    if (id) {
      try { state.master = m?.data || {}; useView(await openResume(id)); openResume_(); }
      catch (err) { toast(err.message, true); }
    }
  };
}

// Free-first notice: the server decides, this only tells the student what to expect.
// The server keeps one 'free' one-pager per student; everything after it is paid.
function usedFreeIn(list) { return (list || []).some((r) => r.status === "free"); }
function paintOffer(list) {
  const usedFree = usedFreeIn(list);
  const el = $("#offer");
  el.hidden = !S.paymentsLive;
  el.classList.toggle("paid", usedFree);
  el.innerHTML = usedFree
    ? `<b>${esc(S.price)}</b> <span>You've used your free one-pager. Each new one-pager is ${esc(S.price)}, paid only after you see it's ready.</span>`
    : `<b>FREE</b> <span>Your first one-page resume is free.</span>`;
}
// Popup before a paid run: shown when payments are on and this student's free one-pager is used.
async function confirmPaidRun() {
  if (!S.paymentsLive) return true;
  let list = [];
  try { list = await listResumes(); } catch { return true; }
  if (!usedFreeIn(list)) return true;
  track("paid_notice_shown");
  const box = $("#paynote");
  box.hidden = false; $("#pn-go").focus();
  return new Promise((resolve) => {
    const done = (ok) => { box.hidden = true; document.removeEventListener("keydown", onKey); track(ok ? "paid_notice_continue" : "paid_notice_cancel"); resolve(ok); };
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    $("#pn-go").onclick = () => done(true);
    $("#pn-cancel").onclick = () => done(false);
    box.onclick = (e) => { if (e.target === box) done(false); };
  });
}
// Apply a one-pager as returned by the server (scrambled when locked).
function useView(v) {
  state.resume = v.resume; state.flags = v.flags || []; state.resumeId = v.id; state.status = v.status;
  state.domain = v.domain || state.domain; state.role = v.role ?? state.role; state.price = v.price || S.price;
}

// ---------- 2. Master CV form ----------
let form, saveTimer;
function openMaster() {
  show("master");
  form = renderMasterForm($("#master-form"), state.master || {}, (m) => {
    state.master = m; $("#master-note").textContent = "Saving…";
    clearTimeout(saveTimer); saveTimer = setTimeout(async () => { await saveMaster(m, state.source || "form"); $("#master-note").textContent = "Saved to your account"; }, 900);
  });
  $("#toc").innerHTML = SECTIONS.map((s) => `<a href="#sec-${s.key}">${esc(s.title)}</a>`).join("");
}
$("#create").onclick = async () => {
  const m = clean(form.get());
  const p = m.personal || {};
  const missing = [["name", "your name"], ["email", "your email"], ["phone", "your phone number"], ["linkedin", "your LinkedIn URL"]].filter(([k]) => !String(p[k] || "").trim()).map(([, l]) => l);
  if (missing.length) { toast(`Add ${missing.join(", ")} in Personal details. They go on the top of your resume.`, true); document.getElementById(`f-personal-${missing[0] === "your name" ? "name" : "email"}`)?.focus(); return; }
  if (!(m.education || []).length) { toast("Add at least one education entry.", true); return; }
  state.master = m;
  clearTimeout(saveTimer);
  if (!(await confirmPaidRun())) return;
  busy.start("Building your one-pager", ["Saving your Master CV", "Writing your one-pager", "Fitting it to one page"]);
  try {
    busy.step(0);
    await saveMaster(m, state.source || "form");
    track("master_saved", { source: state.source || "form" });
    await writeOnePager(1);
  } catch (e) { toast(e.message, true); }
  finally { busy.stop(); }
};

// From an already-saved Master CV
async function fromStored(rewriteId) {
  await requireUser();
  if (!rewriteId && !(await confirmPaidRun())) return;
  busy.start(rewriteId ? "Rewriting your one-pager" : "Building your one-pager", ["Writing your one-pager", "Fitting it to one page"]);
  try { await writeOnePager(0, rewriteId); } catch (e) { toast(e.message, true); } finally { busy.stop(); }
}

// ---------- 3. one-pager (backend reads the stored Master CV) ----------
async function writeOnePager(stepIdx, rewriteId) {
  busy.step(stepIdx, `Applying the resume rules and ${state.domain === "General" ? "general" : domainLabel(state.domain)} keywords. About 30–60 seconds.`);
  track("generate_start", { domain: state.domain });
  const out = await generateResume({ id: rewriteId, domain: state.domain, keywords: DOMAIN_KEYWORDS[state.domain] || [], role: state.role, jd: state.jd });
  useView(out);
  paintSaved();
  show("resume");
  if (isLocked()) {
    track("generate_done", { domain: state.domain, locked: true });
    openResume_();
    return;
  }
  await fitAndSave(stepIdx + 1);
  track("generate_done", { domain: state.domain, fits: state.fit?.fits });
  openResume_();
}
// Fit an unlocked one-pager to the page (AI tightens lines), then save it.
async function fitAndSave(stepIdx) {
  busy.step(stepIdx, "Measuring every line and tightening bullets that spill over.");
  const res = await autoFit({ id: state.resumeId, resume: state.resume, domain: state.domain, header: headerFromMaster(state.master), container: $("#paper"), rounds: 3,
    onStep: (i) => busy.step(stepIdx, `Pass ${i}: tightening lines that don't fit`) });
  state.resume = res.resume; state.fit = res.fit;
  await saveResume({ id: state.resumeId, data: state.resume, flags: state.flags }).catch(() => {});
  if (res.error) toast(/busy/i.test(res.error.message)
    ? "Your one-pager is ready, but the AI is busy so a few lines aren't tightened yet. Click \"Auto-fix fit\" on the right in a minute, or edit those lines yourself."
    : `Your one-pager is ready, but fitting stopped early: ${res.error.message}`, true);
}

function scalePaper() {
  const wrap = $("#paper-wrap"), sc = $("#paper-scale"), page = $("#paper .op-page"); if (!page) return;
  const pad = parseFloat(getComputedStyle(wrap).paddingLeft) * 2;
  const w = wrap.clientWidth - pad, pw = page.offsetWidth;
  const s = Math.min(1.25, w / pw); sc.style.transform = `scale(${s})`; sc.style.height = `${page.offsetHeight * s}px`;
}
window.addEventListener("resize", scalePaper);

const fullResume = () => ({ ...state.resume, header: headerFromMaster(state.master) });
function paint() {
  const page = renderResume(fullResume(), $("#paper"));
  state.fit = checkFit(page); scalePaper(); paintChecks();
}
// Checks grouped by resume section: must-fix items first, then the rest, each group collapsible.
const cap = (t) => String(t || "General").replace(/^\w/, (c) => c.toUpperCase());
function groupIssues(all) {
  const groups = new Map();
  for (const i of [...all].sort((a, b) => (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1))) {
    const k = cap(i.section); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i);
  }
  return [...groups].map(([sec, items], gi) => {
    const errs = items.filter((i) => i.level === "error").length;
    return `<details class="igroup"${gi < 2 || errs ? " open" : ""}><summary><span>${esc(sec)}</span><span class="pill ${errs ? "bad" : "mid"}">${items.length}</span></summary>
      <ul class="issues">${items.map((i) => `<li class="${i.level}">${esc(i.message)}</li>`).join("")}</ul></details>`;
  }).join("");
}
function paintChecks() {
  const f = state.fit;
  const wraps = f.bullets.filter((b) => b.lines > 1).length, shorts = f.bullets.filter((b) => b.lines === 1 && b.fill < 0.72).length;
  $("#fit-card").innerHTML = `<h3>Page fit</h3>
    <div class="stat"><span class="pill ${f.fits ? "ok" : "bad"}">${f.fits ? "1 page" : `${Math.ceil(f.overflowPt / 9.9)} lines over`}</span>
    <span class="pill ${wraps ? "bad" : "ok"}">${wraps} spill over</span><span class="pill ${shorts ? "mid" : "ok"}">${shorts} short</span>
    <span class="pill ${f.freeLines > 2 ? "mid" : "ok"}">${Math.max(0, f.freeLines)} free lines</span></div>
    ${needsWork(f) ? `<p class="hint" style="margin:8px 0 0">Red lines spill onto a 2nd line; amber ones leave the line half empty.</p><button class="btn secondary" id="refit" type="button" style="margin-top:8px">Auto-fix fit</button>` : `<p class="hint" style="margin:8px 0 0">Every bullet fills exactly one line.</p>`}`;
  $("#refit")?.addEventListener("click", refit);
  const issues = [...validate(fullResume()), ...checkFacts(state.resume, state.master)];
  const flags = (state.flags || []).filter((fl) => !/^header$/i.test(fl.section)).map((fl) => ({ level: "warn", section: fl.section, message: fl.ask || fl.issue }));
  const all = [...issues, ...flags];
  const errs = all.filter((i) => i.level === "error").length;
  $("#tab-checks").innerHTML = (all.length
    ? `<div class="check-sum">${errs ? `<span class="pill bad">${errs} must fix</span>` : `<span class="pill ok">No must-fix items</span>`}${all.length - errs ? `<span class="pill mid">${all.length - errs} to review</span>` : ""}</div>`
      + groupIssues(all)
    : `<p class="stat"><span class="pill ok">All resume checks pass</span></p>`)
    + (errs ? `<button class="btn secondary" type="button" id="fix-master" style="margin-top:10px">Fix in Master CV</button>` : "");
  $("#fix-master")?.addEventListener("click", () => openMaster());
}
async function refit() {
  busy.start("Fitting it to one page", ["Tightening lines that don't fit"]);
  try {
    busy.step(0);
    const res = await autoFit({ id: state.resumeId, resume: state.resume, domain: state.domain, header: headerFromMaster(state.master), container: $("#paper"), rounds: 3 });
    state.resume = res.resume; await saveResume({ id: state.resumeId, data: state.resume, flags: state.flags }); paint(); paintEditor();
    if (res.error) toast(/busy/i.test(res.error.message) ? "The AI is still busy. Try Auto-fix fit again in a minute, or edit the red lines yourself." : res.error.message, true);
  } catch (e) { toast(e.message, true); } finally { busy.stop(); }
}

// Text editor: every bullet/summary line, live re-render + re-check
function paintEditor() {
  const r = state.resume, blocks = [];
  blocks.push(`<div class="blk"><label for="e-summary">Professional summary</label><textarea id="e-summary" data-path="summary" rows="5">${esc(r.summary)}</textarea></div>`);
  for (const [key, label] of [["experience", "Experience"], ["internships", "Internships"], ["projects", "Projects"], ["leadership", "Leadership"], ["social_impact", "Social impact"]]) {
    (r[key] || []).forEach((e, i) => {
      const rows = (e.groups || []).flatMap((g, gi) => (g.bullets || []).map((b, bi) => `<textarea data-path="${key}.${i}.groups.${gi}.bullets.${bi}" rows="2">${esc(b)}</textarea>`));
      blocks.push(`<div class="blk"><label>${label}: ${esc(e.org)}</label>${rows.join("")}</div>`);
    });
  }
  for (const [key, label] of [["achievements", "Achievements"], ["extracurricular", "Extra-curricular"]])
    if ((r[key] || []).length) blocks.push(`<div class="blk"><label>${label}</label>${r[key].map((b, i) => `<textarea data-path="${key}.${i}" rows="2">${esc(b)}</textarea>`).join("")}</div>`);
  $("#tab-edit").innerHTML = `<p class="hint" style="margin:0 0 8px">Wrap words in **double asterisks** to make them bold. Changes save automatically.</p><div class="editor">${blocks.join("")}</div>`;
}
let editTimer;
$("#tab-edit").oninput = (e) => {
  const path = e.target.dataset.path; if (!path) return;
  const keys = path.split("."); let o = state.resume;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys.at(-1)] = e.target.value;
  paint();
  clearTimeout(editTimer); editTimer = setTimeout(() => saveResume({ id: state.resumeId, data: state.resume, flags: state.flags }).catch((err) => toast(err.message, true)), 1200);
};
document.querySelector(".tabs").onclick = (e) => {
  const t = e.target.closest("[data-tab]"); if (!t) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b === t));
  $("#tab-checks").hidden = t.dataset.tab !== "checks"; $("#tab-edit").hidden = t.dataset.tab !== "edit";
};

function openResume_() {
  show("resume");
  const locked = isLocked();
  const what = `${state.domain === "General" ? "General" : domainLabel(state.domain)} one-pager${state.role ? " for " + state.role : ""}`;
  $("#r-sub").textContent = locked ? `${what}. Written, fitted and checked. Unlock it to see and download it.`
    : state.status === "free" && S.paymentsLive ? `${what}. This one is free. Each new one-pager after it is ${S.price}.`
    : `${what}. Review the checks, then download.`;
  $("#paper-wrap").classList.toggle("locked", locked);
  $("#paywall").hidden = !locked;
  $("#lock-card").hidden = !locked;
  $("#fit-card").hidden = locked;
  $("#fit-card").nextElementSibling.hidden = locked; // checks + editor card
  for (const id of ["#regen", "#dl-pdf", "#dl-docx"]) $(id).hidden = locked;
  $("#pay-top").hidden = !locked;
  $("#pay-msg").textContent = `One-time payment for this one-pager · Secure checkout by Dodo Payments`;
  document.querySelectorAll(".price").forEach((el) => (el.textContent = state.price));
  if (locked) { renderResume(fullResume(), $("#paper")); scalePaper(); $("#paper").setAttribute("aria-hidden", "true"); track("paywall_shown", { domain: state.domain }); }
  else { $("#paper").removeAttribute("aria-hidden"); paint(); paintEditor(); }
}
$("#edit-master").onclick = () => openMaster();
$("#regen").onclick = () => fromStored(state.resumeId);

// ---------- payment (Dodo) ----------
async function pay() {
  const btns = document.querySelectorAll(".btn.pay"); btns.forEach((b) => (b.disabled = true));
  $("#pay-msg").textContent = "Opening secure checkout…";
  try {
    track("checkout_start", { domain: state.domain });
    const out = await startCheckout(state.resumeId, location.origin + location.pathname);
    if (out.checkout_url) { location.href = out.checkout_url; return; }
    if (out.status && out.status !== "locked") { useView(await openResume(state.resumeId)); await unlockFlow(); return; } // already paid
    throw new Error("Could not start checkout. Please try again.");
  } catch (e) {
    $("#pay-msg").textContent = e.message; toast(e.message, true);
    btns.forEach((b) => (b.disabled = false));
  }
}
$("#pay").onclick = pay;
$("#pay-top").onclick = pay;

// Back from Dodo: ?resume=<id>&payment_id=...&status=...
async function handleReturn(params) {
  const id = params.get("resume"), paymentId = params.get("payment_id"), dodoStatus = params.get("status");
  history.replaceState(null, "", location.pathname + "#resume");
  await requireUser();
  if (!state.master) { const m = await loadMaster(); if (m?.data) { state.master = m.data; state.source = m.source; } }
  busy.start("Unlocking your one-pager", ["Confirming your payment", "Fitting it to one page"]);
  try {
    busy.step(0, "Checking with Dodo Payments. This takes a few seconds.");
    let status = "locked";
    for (let i = 0; i < 10; i++) {
      ({ status } = await confirmPayment(id, paymentId));
      if (!["locked", "processing"].includes(status)) break;
      if (i === 0 && ["failed", "cancelled"].includes(dodoStatus) && status === "locked") break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    useView(await openResume(id));
    if (!isLocked()) {
      track("payment_success", { domain: state.domain });
      await unlockFlow(1);
      toast("Payment received. Your one-pager is unlocked.");
    } else {
      openResume_();
      const msg = status === "processing" ? "Your payment is still processing. Refresh this page in a minute."
        : ["failed", "cancelled"].includes(status) || ["failed", "cancelled"].includes(dodoStatus) ? "The payment didn't go through. You can try again."
        : "We couldn't confirm your payment yet. If you were charged, refresh this page in a minute.";
      $("#pay-msg").textContent = msg; toast(msg, true);
      track("payment_not_confirmed", { status, dodoStatus });
    }
  } catch (e) { toast(e.message, true); }
  finally { busy.stop(); }
}
// After unlocking: fit the real content to the page (it wasn't fitted while locked), then show it.
async function unlockFlow(stepIdx = 0) {
  show("resume");
  $("#paper-wrap").classList.remove("locked"); $("#paywall").hidden = true;
  try { await fitAndSave(stepIdx); } catch (e) { toast(e.message, true); }
  openResume_();
}

// ---------- downloads ----------
function readyToDownload() {
  if (isLocked()) { pay(); return false; }
  const errors = validate(fullResume()).filter((i) => i.level === "error");
  if (errors.length) { toast(`Fix ${errors.length} must-fix item${errors.length > 1 ? "s" : ""} first (see Resume checks).`, true); return false; }
  if (!state.fit?.fits) { toast("The resume is longer than one page. Use Auto-fix fit or shorten it first.", true); return false; }
  return true;
}
const fileBase = () => `${(state.master?.personal?.name || "Resume").trim().replace(/\s+/g, "_")}_OnePager`;
$("#dl-pdf").onclick = async () => {
  if (!readyToDownload()) return;
  try { await downloadPdf($("#paper .op-page"), `${fileBase()}.pdf`); track("download", { format: "pdf", domain: state.domain }); }
  catch (e) { toast(e.message, true); }
};
$("#dl-docx").onclick = async () => {
  if (!readyToDownload()) return;
  try { saveBlob(await buildDocxBlob(fullResume(), fileBase()), `${fileBase()}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); track("download", { format: "docx", domain: state.domain }); }
  catch (e) { toast(e.message, true); }
};

// ---------- boot ----------
(async function boot() {
  // Show the start screen straight away; account data fills in after.
  const params = new URLSearchParams(location.search);
  const wantMaster = location.hash === "#master";
  show("start");
  try {
    const u = await currentUser();
    paintWho(u);
    if (u) {
      const m = await loadMaster();
      if (m?.data) { state.master = m.data; state.source = m.source; }
      paintSaved().catch(() => {});
    }
    if (params.get("resume")) return handleReturn(params);
    if (wantMaster && state.master) openMaster();
  } catch (e) { toast("Couldn't load your account: " + e.message, true); }
})();
