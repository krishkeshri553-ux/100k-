// HustleGrowthz Revenue Command Tracker — vanilla JS, no external scripts.
// Every dynamic value is inserted with textContent (never innerHTML) to prevent XSS.

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");
const state = { tab: "overview", metrics: null, leads: [], approvals: null, content: [], reports: [], filters: { q: "", market: "", class: "", stage: "", due: false } };

// ───────────── DOM helpers ─────────────
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v; // CSSOM is allowed under our strict CSP; style attributes are not
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}
const money = (n) => (n === null || n === undefined ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const num = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));
const pct = (n) => (n === null || n === undefined ? "—" : `${n}%`);
const label = (s) => (s || "").replace(/^[A-I]_/, "").replace(/_/g, " ");
const ago = (iso) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return "in " + fmtDur(-s);
  return fmtDur(s) + " ago";
};
const fmtDur = (s) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);
const time = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg, bad = false) {
  $toast.textContent = msg;
  $toast.className = "show" + (bad ? " bad" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.className = ""), 3600);
}

async function api(path, { method = "GET", body, query } = {}) {
  const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "" && v !== false && v !== undefined)).toString() : "";
  const res = await fetch(`/api/${path}${qs}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-hg-csrf": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") { renderLogin(); throw new Error("Signed out"); }
  if (!res.ok) throw new Error(data.error ? data.error + (data.details ? ": " + data.details.join("; ") : "") : `Request failed (${res.status})`);
  return data;
}
async function action(payload, ok = "Saved") {
  try {
    const r = await api("action", { method: "POST", body: payload });
    toast(ok);
    return r.result;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

// ───────────── Login ─────────────
function renderLogin() {
  const input = h("input", { class: "input", type: "password", placeholder: "Passphrase", autocomplete: "current-password", "aria-label": "Passphrase" });
  const err = h("div", { class: "err" });
  const submit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    try {
      await api("login", { method: "POST", body: { passphrase: input.value } });
      boot();
    } catch (x) { err.textContent = x.message; }
  };
  $app.replaceChildren(h("div", { class: "login" }, h("form", { class: "login-card", onsubmit: submit },
    h("div", { class: "mark", style: "margin:0 auto" }, "H"),
    h("h1", {}, "Revenue Command"), h("p", {}, "HustleGrowthz · private"),
    input, h("button", { class: "btn gold", type: "submit" }, "Enter"), err)));
  input.focus();
}

// ───────────── Shell ─────────────
async function boot() {
  try {
    state.metrics = await api("metrics");
  } catch (e) {
    if (e.message !== "Signed out") $app.replaceChildren(h("div", { class: "wrap" }, h("div", { class: "card" }, h("h2", {}, "Tracker unavailable"), h("p", {}, e.message))));
    return;
  }
  render();
  clearInterval(boot.t);
  boot.t = setInterval(async () => { if (document.visibilityState === "visible" && state.tab === "overview") { try { state.metrics = await api("metrics"); render(); } catch {} } }, 60_000);
}

function render() {
  const m = state.metrics;
  const paused = m.health.automation_paused;
  const header = h("div", { class: "top" },
    h("div", { class: "brand" }, h("div", { class: "mark" }, "H"), h("div", {}, h("h1", {}, "Revenue Command"), h("small", {}, `HustleGrowthz · ${m.period.month}`))),
    h("div", { class: "top-actions" },
      m.synthetic_included ? h("span", { class: "badge dev", title: "Development: synthetic demo rows are included" }, `${m.environment} · includes demo data`) : null,
      paused ? h("span", { class: "badge paused" }, "Automation paused") : null,
      h("button", { class: "btn sm" + (paused ? " gold" : " danger"), onclick: togglePause }, paused ? "Resume automation" : "Emergency pause"),
      h("button", { class: "btn sm ghost", onclick: () => switchTab(state.tab, true), "aria-label": "Refresh" }, "↻ Refresh"),
      h("button", { class: "btn sm ghost", onclick: async () => { await api("logout", { method: "POST" }); renderLogin(); } }, "Sign out")));
  const tabs = [["overview", "Overview"], ["leads", "Leads"], ["approvals", "Approvals", m.health.pending_approvals], ["content", "Content"], ["reports", "Reports"]];
  const tabBar = h("nav", { class: "tabs", role: "tablist" }, tabs.map(([id, name, count]) =>
    h("button", { class: "tab" + (state.tab === id ? " on" : ""), role: "tab", "aria-selected": state.tab === id, onclick: () => switchTab(id) }, name, count ? h("span", { class: "count" }, count) : null)));
  const body = h("div", { id: "view" });
  $app.replaceChildren(h("div", { class: "wrap" }, header, topStrip(m), tabBar, body));
  renderView(body);
}

async function switchTab(tab, refresh = false) {
  state.tab = tab;
  try {
    if (tab === "overview" || refresh) state.metrics = await api("metrics");
    if (tab === "leads") await loadLeads();
    if (tab === "approvals") state.approvals = await api("approvals");
    if (tab === "content") state.content = (await api("content")).items;
    if (tab === "reports") state.reports = (await api("reports")).reports;
  } catch (e) { if (e.message !== "Signed out") toast(e.message, true); }
  render();
}
function renderView(el) {
  const v = { overview, leads: leadsView, approvals: approvalsView, content: contentView, reports: reportsView }[state.tab];
  el.replaceChildren(v());
}
async function togglePause() {
  const paused = state.metrics.health.automation_paused;
  if (!paused && !confirm("Pause all outreach, reply and content automation? Reports and backups keep running.")) return;
  await action({ action: paused ? "resume_automation" : "pause_automation" }, paused ? "Automation resumed" : "Automation paused");
  switchTab(state.tab, true);
}

// ───────────── A. Top performance strip ─────────────
function topStrip(m) {
  const t = m.top;
  const kpi = (labelText, value, sub, extra, hero) => h("div", { class: "kpi" + (hero ? " hero" : "") }, h("div", { class: "label" }, labelText), h("div", { class: "value" }, value), sub ? h("div", { class: "sub" }, sub) : null, extra);
  return h("section", { class: "strip", "aria-label": "Top performance" },
    kpi("Collected (verified)", money(t.collected_verified), t.collected_recorded > t.collected_verified ? `${money(t.collected_recorded - t.collected_verified)} recorded, unverified` : `of ${money(t.target_min)}–${money(t.target_max)} target`,
      h("div", { class: "bar" }, h("i", { style: `width:${Math.min(100, t.progress_pct)}%` })), true),
    kpi("Remaining", money(t.remaining_to_min), `to ${money(t.target_min)} · ${money(t.remaining_to_max)} to ${money(t.target_max)}`),
    kpi("Monthly target", `${money(t.target_min)}–${(t.target_max / 1000).toFixed(0)}k`, `${t.progress_pct}% of minimum`),
    kpi("New clients", `${t.clients_closed}`, `of ${t.clients_target} this month`, h("div", { class: "bar" }, h("i", { style: `width:${Math.min(100, (t.clients_closed / Math.max(1, t.clients_target)) * 100)}%` }))),
    kpi("Calls booked", num(t.appointments_booked), "this month"),
    kpi("Qualified leads", num(t.qualified_leads), "hot + high + warm"));
}

// ───────────── Overview (B–H) ─────────────
const stat = (k, v, title) => h("div", { class: "stat", title }, h("span", {}, k), h("b", { class: v === "—" ? "na" : "" }, v));
function card(title, hint, ...content) { return h("section", { class: "card" }, h("h2", {}, title, hint ? h("span", { class: "hint" }, hint) : null), ...content); }

function overview() {
  const m = state.metrics;
  const L = m.leads, O = m.outreach, A = m.appointments, R = m.revenue, C = m.content, H = m.health;
  const noData = L.total === 0;
  return h("div", { class: "grid" },
    noData ? h("section", { class: "card wide" }, h("h2", {}, "Get started"), h("p", { class: "muted" }, "No leads in the database yet. Import your LinkedIn data export (messages.csv / Connections.csv) or a CRM CSV from the Leads tab — the reactivation engine will classify, score and prepare follow-ups for approval.")) : null,
    card("Lead tracker", `${num(L.total)} total`,
      h("div", { class: "stats" }, stat("Qualified", num(L.qualified)), stat("Hot", num(L.hot)), stat("High priority", num(L.high)), stat("Warm", num(L.warm)), stat("Old leads recovered", num(L.old_recovered)), stat("Follow-up due", num(L.follow_up_due)), stat("Awaiting approval", num(L.awaiting_approval)), stat("Do not contact", num(L.do_not_contact))),
      h("div", { class: "section" }, L.by_market.filter((x) => x.count).map((x) => hbar(x.market.toUpperCase(), x.count, L.total, num(x.count))))),
    card("Outreach", "sent = you confirmed",
      h("div", { class: "stats" }, stat("Connection drafts", num(O.connection_drafts)), stat("InMail drafts", num(O.inmail_drafts)), stat("Other drafts", num(O.other_drafts)), stat("Pending approval", num(O.pending_approval)), stat("Approved, not sent", num(O.approved_not_sent)), stat("Sent (confirmed)", num(O.sent_confirmed)), stat("Accepted connections", num(O.connections_accepted)), stat("Replies", num(O.replies)), stat("Positive replies", num(O.positive_replies)), stat("Interested now", num(O.interested))),
      h("div", { class: "form-row", style: "margin-top:10px" }, h("span", { class: "muted" }, "InMail credits (known): ", O.inmail_credits_known === null ? "not set" : String(O.inmail_credits_known)),
        h("button", { class: "btn sm", onclick: async () => { const v = prompt("InMail credits currently shown in Sales Navigator:"); if (v !== null && v.trim() !== "" && !isNaN(+v)) { await action({ action: "set_inmail_credits", credits: Math.round(+v) }, "Credits saved"); switchTab("overview", true); } } }, "Update"))),
    card("Appointments", "this month",
      h("div", { class: "stats" }, stat("Calls booked", num(A.booked_this_month)), stat("Upcoming", num(A.upcoming)), stat("Attended", num(A.attended)), stat("No-shows", num(A.no_shows)), stat("Rescheduled", num(A.rescheduled)), stat("Qualified opps", num(A.qualified_opportunities))),
      A.upcoming_list.length ? h("div", { class: "section" }, h("h4", {}, "Next calls"), A.upcoming_list.map((a) => h("div", { class: "stat" }, h("span", {}, a.prospect), h("b", {}, time(a.start_at))))) : h("div", { class: "empty" }, "No upcoming calls.")),
    h("section", { class: "card wide" }, h("h2", {}, "Revenue", h("span", { class: "hint" }, "pipeline ≠ forecast ≠ signed ≠ collected")),
      h("div", { class: "grid", style: "gap:18px" },
        h("div", {}, h("div", { class: "stats" }, stat("Deals won (month)", num(R.deals_won_this_month)), stat("Cash collected (verified)", money(R.collected_verified)), stat("Signed contract value", money(R.signed_value_this_month)), stat("Pipeline value", money(R.pipeline_value)), stat("Forecast (weighted)", money(R.forecast_value), R.forecast_unweighted_deals ? `${R.forecast_unweighted_deals} open deal(s) have no probability and are excluded` : ""), stat("Outstanding invoices", `${num(R.outstanding_invoices)} · ${money(R.outstanding_amount)}`), stat("Average deal value", money(R.avg_deal_value)))),
        h("div", {}, h("h4", { class: "muted", style: "margin:0 0 6px;font-weight:500" }, "Collected cash, last 6 months"), monthChart(R.monthly)),
        h("div", {}, h("h4", { class: "muted", style: "margin:0 0 6px;font-weight:500" }, "By market · by source (this month)"),
          R.by_market.length ? R.by_market.map((x) => hbar(x.key.toUpperCase(), x.amount, R.collected_recorded, money(x.amount))) : h("div", { class: "empty" }, "No collected revenue this month yet."),
          R.by_source.map((x) => hbar(label(x.key), x.amount, R.collected_recorded, money(x.amount)))))),
    card("Content", "LinkedIn",
      h("div", { class: "stats" }, stat("Ideas", num(C.ideas)), stat("Drafts", num(C.drafted)), stat("Approved", num(C.approved)), stat("Published", num(C.published)), stat("Scheduled", num(C.scheduled)), stat("Posts with metrics", num(C.with_metrics)), stat("Reactions", num(C.reactions)), stat("Comments", num(C.comments)), stat("Impressions", num(C.impressions)), stat("Leads from content", num(C.leads_attributed))),
      C.with_metrics === 0 ? h("div", { class: "empty" }, "Engagement shows only after you enter real numbers for published posts.") : null),
    card("System health", H.automation_paused ? "PAUSED" : "",
      h("div", { class: "stats" }, stat("Last success", H.last_success ? `${H.last_success.workflow} · ${ago(H.last_success.at)}` : "—"), stat("Next run", H.next_scheduled?.at ? `${H.next_scheduled.name} · ${ago(H.next_scheduled.at)}` : "—"), stat("Failed jobs (7d)", num(H.failed_jobs_7d)), stat("Pending approvals", num(H.pending_approvals)), stat("Last sync", H.last_sync ? ago(H.last_sync) : "—"), stat("Last backup", H.last_backup ? ago(H.last_backup) : "—")),
      h("div", { class: "section" }, H.integrations.length ? H.integrations.map((i) => h("div", { class: "stat", title: i.detail || "" }, h("span", {}, h("i", { class: "dot " + ({ connected: "ok", manual_only: "gold", not_configured: "warn", error: "bad" }[i.status] || "") }), label(i.name)), h("b", {}, label(i.status)))) : h("div", { class: "empty" }, "Integration status appears after the first daytime workflow.")),
      H.failures.map((f) => h("div", { class: "flag block" }, `${f.workflow} · ${time(f.at)}: ${f.error}`))),
    h("section", { class: "card wide" }, h("h2", {}, "Live activity", h("span", { class: "hint" }, "newest first")),
      m.feed.length ? h("ul", { class: "feed" }, m.feed.map((e) => h("li", {}, h("time", { datetime: e.at, title: new Date(e.at).toLocaleString() }, ago(e.at)), h("div", {}, h("i", { class: "dot " + feedDot(e.type) }), e.summary, h("span", { class: "src" }, `${e.actor} · ${e.source}`))))) : h("div", { class: "empty" }, "No activity yet.")));
}
const feedDot = (t) => (/won|verified|booked/.test(t) ? "ok" : /failed|do_not_contact|rejected/.test(t) ? "bad" : /draft|approved|content/.test(t) ? "gold" : "");
function hbar(name, value, total, text) {
  return h("div", { class: "hbar" }, h("span", { class: "muted" }, name), h("div", { class: "track" }, h("i", { style: `width:${total ? Math.max(2, (value / total) * 100) : 0}%` })), h("b", {}, text));
}
function monthChart(rows) {
  const W = 320, H = 110, max = Math.max(1, ...rows.map((r) => r.collected));
  const bw = W / rows.length;
  const s = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H + 18}`, role: "img", "aria-label": "Collected cash by month" });
  rows.forEach((r, i) => {
    const bh = r.collected ? Math.max(3, (r.collected / max) * (H - 14)) : 1.5;
    s.append(svg("rect", { x: i * bw + 8, y: H - bh, width: bw - 16, height: bh, rx: 3, fill: i === rows.length - 1 ? "#c9a45c" : "#3a3326" }));
    const t = svg("text", { x: i * bw + bw / 2, y: H + 14, "text-anchor": "middle", fill: "#6f6c66", "font-size": 10 });
    t.textContent = r.month.slice(5);
    s.append(t);
    if (r.collected) {
      const v = svg("text", { x: i * bw + bw / 2, y: H - bh - 4, "text-anchor": "middle", fill: "#a29e94", "font-size": 9 });
      v.textContent = "$" + (r.collected >= 1000 ? (r.collected / 1000).toFixed(1) + "k" : r.collected);
      s.append(v);
    }
  });
  return s;
}

// ───────────── Leads ─────────────
async function loadLeads() {
  const f = state.filters;
  state.leads = (await api("leads", { query: { q: f.q, market: f.market, class: f.class, stage: f.stage, due: f.due ? "1" : "" } })).leads;
}
function leadsView() {
  const f = state.filters;
  const sel = (key, options) => h("select", { class: "input", "aria-label": key, onchange: async (e) => { f[key] = e.target.value; await loadLeads(); renderView(document.getElementById("view")); } },
    options.map(([v, t]) => h("option", { value: v, selected: f[key] === v }, t)));
  let timer;
  const search = h("input", { class: "input search", type: "search", placeholder: "Search name, company, title, location…", value: f.q, oninput: (e) => { clearTimeout(timer); timer = setTimeout(async () => { f.q = e.target.value; await loadLeads(); const keep = document.activeElement === search; renderView(document.getElementById("view")); if (keep) { const s = document.querySelector(".search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250); } });
  const fileInput = h("input", { type: "file", accept: ".csv,text/csv", style: "display:none", onchange: importCsv });
  return h("div", {},
    h("div", { class: "toolbar" }, search,
      sel("market", [["", "All markets"], ["dubai", "Dubai / UAE"], ["usa", "USA"], ["uk", "UK"], ["other", "Other"], ["unknown", "Unknown"]]),
      sel("class", [["", "All scores"], ["hot", "Hot"], ["high", "High priority"], ["warm", "Warm"], ["low", "Low"], ["not_qualified", "Not qualified"]]),
      sel("stage", [["", "All stages"], ...state.metrics.leads.by_stage.map((s) => [s.stage, `${s.label} (${s.count})`])]),
      h("label", { class: "btn sm ghost" }, h("input", { type: "checkbox", checked: f.due, onchange: async (e) => { f.due = e.target.checked; await loadLeads(); renderView(document.getElementById("view")); } }), " Due"),
      h("button", { class: "btn sm", onclick: () => fileInput.click() }, "Import CSV"), fileInput,
      h("button", { class: "btn sm gold", onclick: addProspectForm }, "+ Prospect")),
    state.leads.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Score", "Prospect", "Market", "Stage", "Category", "Next action"].map((t, i) => h("th", { class: i === 4 ? "hide-sm" : "" }, t)))),
      h("tbody", {}, state.leads.map((p) => h("tr", { onclick: () => openLead(p.id) },
        h("td", {}, h("span", { class: "score" }, p.score ?? "—"), " ", p.score_class ? h("span", { class: "pill " + p.score_class }, label(p.score_class)) : null),
        h("td", {}, h("div", {}, h("strong", {}, p.full_name)), h("div", { class: "faint" }, [p.title, p.company].filter(Boolean).join(" · ") || "—")),
        h("td", {}, p.market.toUpperCase()),
        h("td", {}, label(p.stage)),
        h("td", { class: "hide-sm" }, p.contact_status !== "ok" ? h("span", { class: "pill dnc" }, label(p.contact_status)) : label(p.lead_category) || "—"),
        h("td", {}, p.next_action || "—", p.next_action_due ? h("div", { class: "faint" }, "due " + p.next_action_due) : null)))))) :
      h("div", { class: "card" }, h("div", { class: "empty" }, state.leads.length === 0 && (f.q || f.market || f.class || f.stage || f.due) ? "No leads match these filters." : "No leads yet. Import a CSV or add a prospect from Sales Navigator.")));
}
async function importCsv(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3_900_000) return toast("File too large for one upload (max ~3.9 MB). Split it, or use the CLI import.", true);
  const csv = await file.text();
  const r = await action({ action: "import_csv", csv }, "Import complete");
  toast(`Imported ${r.format}: ${r.prospects_created} new, ${r.prospects_merged} merged, ${r.messages_added} messages, ${r.messages_skipped_duplicate} duplicates skipped`);
  await switchTab("leads", true);
}
function addProspectForm() {
  const f = {};
  const field = (k, ph) => (f[k] = h("input", { class: "input", placeholder: ph }));
  openDrawer(h("div", {}, h("h3", {}, "Add prospect"), h("p", { class: "muted" }, "From your own Sales Navigator / LinkedIn browsing. Only add what you can see — unknowns stay unknown."),
    h("div", { class: "section" }, field("full_name", "Full name *"), h("div", { style: "height:8px" }), field("linkedin_url", "LinkedIn or Sales Navigator URL"), h("div", { style: "height:8px" }), field("title", "Title"), h("div", { style: "height:8px" }), field("company", "Company"), h("div", { style: "height:8px" }), field("location", "Location (e.g. Dubai, UAE)"), h("div", { style: "height:8px" }), field("headline", "Headline"), h("div", { style: "height:8px" }),
      (f.notes = h("textarea", { class: "input", placeholder: "Research notes: recent posts, content gaps, why now…" })),
      h("div", { class: "actions" }, h("button", { class: "btn gold", onclick: async () => {
        const payload = { action: "add_prospect" };
        for (const [k, el] of Object.entries(f)) if (el.value.trim()) payload[k] = el.value.trim();
        if (!payload.full_name) return toast("Name is required", true);
        const p = await action(payload, "Prospect saved and scored");
        closeDrawer(); await switchTab("leads", true); openLead(p.id);
      } }, "Save & score")))));
}

// ───────────── Lead drawer ─────────────
function openDrawer(content) {
  closeDrawer();
  const scrim = h("div", { class: "scrim", onclick: closeDrawer });
  const d = h("aside", { class: "drawer", role: "dialog", "aria-modal": "true" }, h("button", { class: "btn sm ghost", style: "float:right", onclick: closeDrawer, "aria-label": "Close" }, "✕"), content);
  document.body.append(scrim, d);
  document.addEventListener("keydown", escClose);
}
function closeDrawer() { document.querySelectorAll(".scrim,.drawer").forEach((x) => x.remove()); document.removeEventListener("keydown", escClose); }
function escClose(e) { if (e.key === "Escape") closeDrawer(); }

async function openLead(id) {
  let d;
  try { d = await api("lead", { query: { id } }); } catch (e) { return toast(e.message, true); }
  const p = d.prospect;
  const refresh = () => openLead(id);
  const dnc = p.contact_status !== "ok";
  const research = p.research || {};
  const r = {};
  const replyText = h("textarea", { class: "input", placeholder: "Paste their reply (optional) so the AI can analyse it…", style: "min-height:70px" });
  const stageSel = h("select", { class: "input" }, state.metrics.leads.by_stage.map((s) => h("option", { value: s.stage, selected: s.stage === p.stage }, s.label)));

  openDrawer(h("div", {},
    h("h3", {}, p.full_name), h("div", { class: "muted" }, [p.title, p.company, p.location].filter(Boolean).join(" · ") || "No profile details yet"),
    h("div", { class: "form-row", style: "margin-top:10px" },
      h("span", { class: "score" }, p.score ?? "—"), p.score_class ? h("span", { class: "pill " + p.score_class }, label(p.score_class)) : null,
      p.score_confidence !== null ? h("span", { class: "faint" }, `confidence ${Math.round(p.score_confidence * 100)}%`) : null,
      dnc ? h("span", { class: "pill dnc" }, label(p.contact_status)) : null,
      p.linkedin_url ? h("a", { href: p.linkedin_url, target: "_blank", rel: "noopener noreferrer" }, "Open LinkedIn ↗") : null),
    h("div", { class: "section" }, h("h4", {}, "Next action"), h("div", {}, p.next_action || "—", p.next_action_due ? h("span", { class: "faint" }, ` · due ${p.next_action_due}`) : null), p.conversation_summary ? h("p", { class: "muted" }, p.conversation_summary) : null),
    h("div", { class: "section" }, h("h4", {}, "Details"), h("dl", { class: "kv" },
      ...[["Market", p.market.toUpperCase()], ["Stage", label(p.stage)], ["Category", label(p.lead_category) || "—"], ["Interest", p.interest_level || "unknown"], ["Offer fit", p.offer_fit || "unknown"], ["Objection", p.previous_objection || "—"], ["Last interaction", p.last_interaction_at ? time(p.last_interaction_at) : "—"], ["Deal value est.", money(p.deal_value_estimate)], ["Source", label(p.source)], ["Email", p.email || "—"]].flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))),
    p.score_breakdown ? h("div", { class: "section breakdown" }, h("h4", {}, "Why this score"), p.score_breakdown.map((b) => h("div", { class: b.value === null ? "unknown" : "" }, h("span", {}, `${label(b.dimension)} (${b.weight}) — ${b.reason}`), h("b", { style: "text-align:right" }, b.points)))) : null,
    h("div", { class: "section" }, h("h4", {}, "Owner actions"),
      h("div", { class: "form-row" }, stageSel, h("button", { class: "btn sm", onclick: async () => { await action({ action: "set_stage", prospect_id: id, stage: stageSel.value }, "Stage updated"); refresh(); } }, "Set stage")),
      h("div", { class: "form-row" }, replyText),
      h("div", { class: "actions" },
        ["positive", "neutral", "negative"].map((s) => h("button", { class: "btn sm", disabled: dnc, onclick: async () => { await action({ action: "mark_replied", prospect_id: id, text: replyText.value || undefined, sentiment: s }, "Reply recorded"); refresh(); } }, `Mark replied · ${s}`)),
        h("button", { class: "btn sm", disabled: dnc, onclick: async () => { const r = await action({ action: "generate_drafts", prospect_id: id }, "Drafting…"); toast(r.created.length ? `${r.created.length} draft(s) added to approvals` : r.skipped || "Nothing new to draft"); refresh(); } }, "Prepare outreach"),
        h("button", { class: "btn sm", onclick: async () => { const r = await action({ action: "reanalyse", prospect_id: id }, "Re-analysed"); refresh(); void r; } }, "Re-analyse"),
        h("button", { class: "btn sm", disabled: dnc, onclick: () => bookFlow(p) }, "Book call"),
        h("button", { class: "btn sm", onclick: () => dealFlow(p) }, "Deal / invoice"),
        h("button", { class: "btn sm", disabled: dnc, onclick: async () => { const until = prompt("Snooze this prospect until (YYYY-MM-DD):"); if (until) { await action({ action: "snooze_prospect", prospect_id: id, until }, "Snoozed"); refresh(); } } }, "Snooze"),
        h("button", { class: "btn sm danger", disabled: dnc, onclick: async () => { const reason = prompt("Do not contact — reason:", "Asked not to be contacted"); if (reason !== null) { await action({ action: "do_not_contact", prospect_id: id, reason }, "Marked do-not-contact"); refresh(); } } }, "Do not contact"))),
    h("div", { class: "section" }, h("h4", {}, "Research (only what you verified)"),
      h("div", { class: "form-row" },
        (r.posting_frequency = h("select", { class: "input" }, [["", "Posting: unknown"], ["none", "Not posting"], ["irregular", "Irregular"], ["regular", "Regular"], ["high", "High volume"]].map(([v, t]) => h("option", { value: v, selected: (research.posting_frequency || "") === v }, t)))),
        (r.has_video = h("select", { class: "input" }, [["", "Video: unknown"], ["yes", "Uses video"], ["no", "No video"]].map(([v, t]) => h("option", { value: v, selected: (research.has_video === true ? "yes" : research.has_video === false ? "no" : "") === v }, t)))),
        (r.ability_to_invest = h("select", { class: "input" }, [["", "Budget: unknown"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]].map(([v, t]) => h("option", { value: v, selected: (research.ability_to_invest || "") === v }, t))))),
      h("div", { class: "form-row" }, (r.recent_post_at = h("input", { class: "input", type: "date", value: (research.recent_post_at || "").slice(0, 10), title: "Most recent post date" })), (r.headcount = h("input", { class: "input", type: "number", min: 0, placeholder: "Team size", value: research.headcount ?? "" }))),
      (r.content_gap_notes = h("textarea", { class: "input", placeholder: "Content gap you observed…", style: "min-height:60px", value: research.content_gap_notes || "" })),
      h("div", { class: "actions" }, h("button", { class: "btn sm gold", onclick: async () => {
        const v = { posting_frequency: r.posting_frequency.value || null, has_video: r.has_video.value === "" ? null : r.has_video.value === "yes", ability_to_invest: r.ability_to_invest.value || null, recent_post_at: r.recent_post_at.value || null, headcount: r.headcount.value === "" ? null : +r.headcount.value, content_gap_notes: r.content_gap_notes.value || null };
        await action({ action: "update_research", prospect_id: id, research: v }, "Research saved, score updated"); refresh();
      } }, "Save research & rescore"))),
    d.appointments.length ? h("div", { class: "section" }, h("h4", {}, "Appointments"), d.appointments.map((a) => h("div", { class: "stat" }, h("span", {}, `${time(a.start_at)} · ${label(a.status)}`), a.status === "confirmed" ? h("span", { class: "actions", style: "margin:0" },
      h("button", { class: "btn sm", onclick: async () => { const q = confirm("Was this a qualified opportunity?"); await action({ action: "attendance", appointment_id: a.id, outcome: "attended", qualified: q }, "Attendance saved"); refresh(); } }, "Attended"),
      h("button", { class: "btn sm", onclick: async () => { await action({ action: "attendance", appointment_id: a.id, outcome: "no_show" }, "No-show recorded"); refresh(); } }, "No-show"),
      h("button", { class: "btn sm danger", onclick: async () => { const reason = prompt("Cancellation reason:"); if (reason) { await action({ action: "cancel_appointment", appointment_id: a.id, reason }, "Cancelled"); refresh(); } } }, "Cancel")) : null))) : null,
    d.deals.length ? h("div", { class: "section" }, h("h4", {}, "Deals & invoices"), d.deals.map((dl) => h("div", {},
      h("div", { class: "stat" }, h("span", {}, `${dl.title} · ${label(dl.status)}`), h("b", {}, money(dl.contract_value))),
      d.payments.filter((x) => x.deal_id === dl.id).map((pay) => h("div", { class: "stat" }, h("span", { class: "muted" }, `Invoice ${pay.invoice_ref || ""} · ${pay.status}${pay.status === "paid" ? (pay.verified ? " · verified" : " · unverified") : ""}`), h("span", {}, money(pay.amount), " ",
        pay.status === "outstanding" ? h("button", { class: "btn sm", onclick: async () => { const v = confirm("Have you confirmed the money is in your bank account? (OK = verified, Cancel = record as unverified)"); await action({ action: "mark_paid", payment_id: pay.id, verified: v }, v ? "Collection verified" : "Recorded as unverified"); refresh(); } }, "Mark paid") : null,
        pay.status === "paid" && !pay.verified ? h("button", { class: "btn sm", onclick: async () => { await action({ action: "mark_paid", payment_id: pay.id, verified: true }, "Collection verified"); refresh(); } }, "Verify") : null)))))) : null,
    h("div", { class: "section" }, h("h4", {}, `Conversation (${d.messages.length})`), d.messages.length ? h("div", { class: "timeline" }, d.messages.map((m) => h("div", { class: "msg " + (m.direction === "inbound" ? "in" : "out") }, h("div", { class: "who" }, `${m.direction === "inbound" ? p.first_name || "Prospect" : "You"} · ${time(m.sent_at)} · ${label(m.channel)}${m.source === "owner_confirmed" ? " · confirmed" : ""}`), h("p", {}, m.body)))) : h("div", { class: "empty" }, "No messages on record.")),
    d.drafts.length ? h("div", { class: "section" }, h("h4", {}, "Drafts"), d.drafts.map((x) => h("div", { class: "stat" }, h("span", {}, `${label(x.kind)} · ${time(x.created_at)}`), h("b", {}, label(x.status))))) : null,
    h("div", { class: "section" }, h("h4", {}, "History"), d.events.length ? h("ul", { class: "feed" }, d.events.map((e) => h("li", {}, h("time", {}, ago(e.occurred_at)), h("div", {}, e.summary)))) : h("div", { class: "empty" }, "No events."))));
}

async function bookFlow(p) {
  let slots = [];
  try { slots = await action({ action: "suggest_times", prospect_id: p.id }, "Availability loaded"); } catch { return; }
  const confirmation = h("textarea", { class: "input", placeholder: "Paste the prospect's confirmation, e.g. “Tuesday 2pm works”", style: "min-height:60px" });
  const email = h("input", { class: "input", type: "email", placeholder: "Prospect email for the invite (optional)", value: p.email || "" });
  let chosen = null;
  const list = h("div", { class: "actions" }, slots.length ? slots.map((s) => h("button", { class: "btn sm", onclick: (e) => { chosen = s.start; list.querySelectorAll("button").forEach((b) => b.classList.remove("gold")); e.target.classList.add("gold"); } }, s.owner_label + (s.prospect_label ? ` · them: ${s.prospect_label}` : ""))) : h("div", { class: "empty" }, "No free slots in the lookahead window."));
  openDrawer(h("div", {}, h("h3", {}, `Book call · ${p.full_name}`), h("p", { class: "muted" }, "Only book after the prospect has explicitly confirmed the time."), h("div", { class: "section" }, h("h4", {}, "Suggested times"), list), h("div", { class: "section" }, confirmation, h("div", { style: "height:8px" }), email,
    h("div", { class: "actions" }, h("button", { class: "btn gold", onclick: async () => {
      if (!chosen) return toast("Pick a time", true);
      await action({ action: "book", prospect_id: p.id, start: chosen, confirmation: confirmation.value, attendee_email: email.value || null }, "Call booked");
      closeDrawer(); openLead(p.id);
    } }, "Book confirmed call")))));
}

function dealFlow(p) {
  const value = h("input", { class: "input", type: "number", min: 0, step: "1", placeholder: "Contract value (USD)", value: "999" });
  const plan = h("select", { class: "input" }, [["monthly", "Monthly — $999"], ["annual", "Annual — $5,999"], ["custom", "Custom (owner-approved)"]].map(([v, t]) => h("option", { value: v }, t)));
  plan.onchange = () => { if (plan.value === "monthly") value.value = "999"; if (plan.value === "annual") value.value = "5999"; };
  const prob = h("input", { class: "input", type: "number", min: 0, max: 100, placeholder: "Win probability % (for forecast)" });
  const invAmt = h("input", { class: "input", type: "number", min: 1, placeholder: "Invoice amount (USD)" });
  const invRef = h("input", { class: "input", placeholder: "Invoice ref" });
  const invDue = h("input", { class: "input", type: "date" });
  openDrawer(h("div", {}, h("h3", {}, `Deal · ${p.full_name}`),
    h("div", { class: "section" }, h("h4", {}, "New deal"), h("div", { class: "form-row" }, plan, value, prob),
      h("div", { class: "actions" },
        h("button", { class: "btn", onclick: () => saveDeal("open") }, "Open deal"), h("button", { class: "btn", onclick: () => saveDeal("proposal") }, "Proposal sent"))),
    h("div", { class: "section" }, h("h4", {}, "Existing deals"), h("div", { id: "deals" }, h("div", { class: "empty" }, "Loading…")))));
  async function saveDeal(status) {
    await action({ action: "create_deal", prospect_id: p.id, contract_value: +value.value, plan: plan.value, probability: prob.value === "" ? null : +prob.value / 100, status }, "Deal saved");
    dealFlow(p);
  }
  api("lead", { query: { id: p.id } }).then((d) => {
    const el = document.getElementById("deals");
    if (!el) return;
    el.replaceChildren(...(d.deals.length ? d.deals.map((dl) => h("div", { class: "draft" },
      h("header", {}, h("strong", {}, `${dl.title}`), h("span", { class: "pill" }, label(dl.status))), h("div", { class: "meta" }, `${money(dl.contract_value)} · probability ${dl.probability === null ? "not set" : Math.round(dl.probability * 100) + "%"}`),
      h("div", { class: "actions" },
        dl.status !== "won" ? h("button", { class: "btn sm gold", onclick: async () => { await action({ action: "deal_status", deal_id: dl.id, status: "won" }, "Client won 🎉"); dealFlow(p); } }, "Mark won") : null,
        dl.status !== "lost" && dl.status !== "won" ? h("button", { class: "btn sm danger", onclick: async () => { const r = prompt("Lost reason:"); if (r !== null) { await action({ action: "deal_status", deal_id: dl.id, status: "lost", lost_reason: r }, "Marked lost"); dealFlow(p); } } }, "Mark lost") : null),
      h("div", { class: "form-row" }, invAmt.cloneNode(), invRef.cloneNode(), invDue.cloneNode(), h("button", { class: "btn sm", onclick: async (e) => {
        const [a, r, dd] = e.target.parentElement.querySelectorAll("input");
        if (!a.value) return toast("Amount required", true);
        await action({ action: "add_invoice", deal_id: dl.id, amount: +a.value, invoice_ref: r.value || null, due_at: dd.value || null }, "Invoice added"); dealFlow(p);
      } }, "Add invoice")))) : [h("div", { class: "empty" }, "No deals yet.")]));
  }).catch(() => {});
}

// ───────────── Approvals ─────────────
function approvalsView() {
  const a = state.approvals;
  if (!a) return h("div", { class: "empty" }, "Loading…");
  return h("div", {},
    h("div", { class: "card", style: "margin-bottom:14px" }, h("p", { class: "muted", style: "margin:0" }, "Nothing is ever sent automatically. Approve a draft, copy it into LinkedIn yourself, then mark it as sent. Only your confirmation counts as “sent”.")),
    h("h2", { class: "muted", style: "font-size:13px;letter-spacing:.08em;text-transform:uppercase" }, `Awaiting approval (${a.drafts.length})`),
    a.drafts.length ? h("div", { class: "queue" }, a.drafts.map(draftCard)) : h("div", { class: "card" }, h("div", { class: "empty" }, "Approval queue is empty.")),
    h("h2", { class: "muted", style: "font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin-top:24px" }, `Approved — send manually (${a.approved.length})`),
    a.approved.length ? h("div", { class: "queue" }, a.approved.map(approvedCard)) : h("div", { class: "card" }, h("div", { class: "empty" }, "No approved messages waiting to be sent.")),
    a.content.length ? h("div", {}, h("h2", { class: "muted", style: "font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin-top:24px" }, `Content awaiting approval (${a.content.length})`), h("div", { class: "queue" }, a.content.map(contentCard))) : null);
}
function draftCard(d) {
  const subject = d.kind === "inmail" ? h("input", { class: "input", value: d.subject || "", placeholder: "InMail subject", style: "width:100%;margin-bottom:8px" }) : null;
  const body = h("textarea", { class: "input", value: d.body });
  const counter = h("span", { class: "faint" }, `${d.body.length} chars`);
  body.oninput = () => (counter.textContent = `${body.value.length} chars`);
  const blocks = d.guardrail_flags.filter((f) => f.severity === "block");
  const overridable = new Set(["discount", "contract_commitment", "unapproved_price", "generic_duplicate", "repeats_previous"]);
  const reload = async () => { state.approvals = await api("approvals"); state.metrics = await api("metrics"); render(); };
  return h("article", { class: "draft" + (d.status === "blocked" ? " blocked" : "") },
    h("header", {}, h("div", {}, h("strong", {}, d.prospect.name), h("span", { class: "faint" }, ` · ${d.prospect.market.toUpperCase()} · score ${d.prospect.score ?? "—"}`)), h("span", { class: "pill" + (d.status === "blocked" ? " dnc" : "") }, `${label(d.kind)}${d.status === "blocked" ? " · blocked" : ""}`)),
    d.observation ? h("div", { class: "meta" }, "Observation: ", d.observation) : null,
    d.rationale ? h("div", { class: "meta" }, "Why: ", d.rationale, d.follow_up_in_days ? ` · follow up in ${d.follow_up_in_days} days` : "") : null,
    d.guardrail_flags.length ? h("div", { class: "flags" }, d.guardrail_flags.map((f) => h("div", { class: "flag " + f.severity }, f.message))) : null,
    subject, body, counter,
    h("div", { class: "actions" },
      h("button", { class: "btn sm gold", onclick: async () => {
        const ack = blocks.filter((f) => overridable.has(f.code)).map((f) => f.code);
        if (ack.length && !confirm(`This draft contains: ${ack.join(", ")}. Approve as an owner decision?`)) return;
        await action({ action: "approve_draft", id: d.id, body: body.value, subject: subject ? subject.value : undefined, acknowledge: ack }, "Approved — ready to send manually"); reload();
      } }, "Approve"),
      h("button", { class: "btn sm", onclick: async () => { await action({ action: "edit_draft", id: d.id, body: body.value, subject: subject ? subject.value : undefined }, "Edit saved, guardrails re-checked"); reload(); } }, "Save edit"),
      h("button", { class: "btn sm", onclick: async () => { const until = prompt("Snooze until (YYYY-MM-DD):", new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)); if (until) { await action({ action: "snooze_draft", id: d.id, until }, "Snoozed"); reload(); } } }, "Snooze"),
      h("button", { class: "btn sm danger", onclick: async () => { await action({ action: "reject_draft", id: d.id }, "Rejected"); reload(); } }, "Reject"),
      h("button", { class: "btn sm ghost", onclick: () => openLead(d.prospect_id) }, "View lead")));
}
function approvedCard(d) {
  const reload = async () => { state.approvals = await api("approvals"); state.metrics = await api("metrics"); render(); };
  return h("article", { class: "draft" },
    h("header", {}, h("strong", {}, d.prospect.name), h("span", { class: "pill high" }, label(d.kind))),
    d.subject ? h("div", { class: "meta" }, "Subject: ", d.subject) : null,
    h("p", { style: "white-space:pre-wrap;margin:6px 0" }, d.body),
    h("div", { class: "actions" },
      h("button", { class: "btn sm gold", onclick: async () => { try { await navigator.clipboard.writeText((d.subject ? d.subject + "\n\n" : "") + d.body); toast("Copied — paste it into LinkedIn"); } catch { toast("Copy failed — select the text manually", true); } if (d.prospect.linkedin_url) window.open(d.prospect.linkedin_url, "_blank", "noopener,noreferrer"); } }, "Copy & open LinkedIn"),
      h("button", { class: "btn sm", onclick: async () => { if (!confirm("Confirm you personally sent this message on LinkedIn?")) return; await action({ action: "mark_sent", id: d.id }, "Marked as sent"); reload(); } }, "I sent it")));
}

// ───────────── Content ─────────────
function slidePreview(assets) {
  const slides = (assets || []).filter((a) => a.svg);
  return slides.length ? h("div", { class: "slides" }, slides.map((s) => h("img", { alt: s.name, src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s.svg) }))) : null;
}
function contentCard(c) {
  const reload = async () => { state.content = (await api("content")).items; if (state.tab === "approvals") state.approvals = await api("approvals"); state.metrics = await api("metrics"); render(); };
  const body = h("textarea", { class: "input", value: c.body || "" });
  const metrics = c.metrics || {};
  const mi = {};
  return h("article", { class: "draft" },
    h("header", {}, h("div", {}, h("strong", {}, c.topic), h("div", { class: "faint" }, [c.pillar, c.format, c.objective, c.scheduled_for ? "scheduled " + c.scheduled_for : null].filter(Boolean).join(" · "))), h("span", { class: "pill" }, label(c.status))),
    c.hook ? h("div", { class: "meta" }, "Hook: ", c.hook) : null,
    c.audience ? h("div", { class: "meta" }, "Audience: ", c.audience, c.cta ? ` · CTA: ${c.cta}` : "") : null,
    c.reasoning ? h("div", { class: "meta" }, "Why: ", c.reasoning) : null,
    c.suggested_visual ? h("div", { class: "meta" }, "Visual: ", c.suggested_visual) : null,
    slidePreview(c.assets),
    ["idea", "pending_approval", "draft", "rejected"].includes(c.status) ? body : h("p", { style: "white-space:pre-wrap" }, c.body || ""),
    h("div", { class: "actions" },
      c.status === "idea" ? h("button", { class: "btn sm gold", onclick: async () => { await action({ action: "content_draft", id: c.id }, "Draft written"); reload(); } }, "Write full draft") : null,
      c.status === "pending_approval" ? h("button", { class: "btn sm gold", onclick: async () => { await action({ action: "content_status", id: c.id, status: "edit", body: body.value }); await action({ action: "content_status", id: c.id, status: "approve" }, "Approved"); reload(); } }, "Approve") : null,
      ["pending_approval", "idea"].includes(c.status) ? h("button", { class: "btn sm", onclick: async () => { await action({ action: "content_status", id: c.id, status: "edit", body: body.value }, "Saved"); reload(); } }, "Save edit") : null,
      ["pending_approval", "idea"].includes(c.status) ? h("button", { class: "btn sm danger", onclick: async () => { await action({ action: "content_status", id: c.id, status: "reject" }, "Rejected"); reload(); } }, "Reject") : null,
      c.status === "approved" ? h("button", { class: "btn sm", onclick: async () => { try { await navigator.clipboard.writeText(c.body || ""); toast("Copied — publish on LinkedIn"); } catch { toast("Copy failed", true); } } }, "Copy post") : null,
      c.status === "approved" ? h("button", { class: "btn sm gold", onclick: async () => { const url = prompt("LinkedIn post URL (optional):"); if (url === null) return; await action({ action: "content_published", id: c.id, url: url || null }, "Marked published"); reload(); } }, "I published it") : null),
    c.status === "published" ? h("div", { class: "section" }, h("h4", {}, "Real metrics (from LinkedIn analytics)"),
      h("div", { class: "form-row" }, ["impressions", "reactions", "comments", "reposts", "profile_views", "dms"].map((k) => (mi[k] = h("input", { class: "input", type: "number", min: 0, placeholder: label(k), value: metrics[k] ?? "", title: label(k) })))),
      h("div", { class: "actions" }, h("button", { class: "btn sm", onclick: async () => { const payload = { action: "content_metrics", id: c.id }; for (const [k, el] of Object.entries(mi)) if (el.value !== "") payload[k] = +el.value; await action(payload, "Metrics saved"); reload(); } }, "Save metrics"),
        h("span", { class: "faint" }, `Leads attributed: ${c.leads_attributed}`), c.published_url ? h("a", { href: c.published_url, target: "_blank", rel: "noopener noreferrer" }, "View post ↗") : null)) : null);
}
function contentView() {
  const groups = [["pending_approval", "Awaiting approval"], ["approved", "Approved — ready to publish"], ["idea", "Ideas"], ["published", "Published"]];
  if (!state.content.length) return h("div", { class: "card" }, h("div", { class: "empty" }, "No content yet. The content workflow generates ideas Mon–Sat once Claude is connected."));
  return h("div", {}, groups.map(([s, t]) => {
    const items = state.content.filter((c) => c.status === s);
    return items.length ? h("div", { style: "margin-bottom:22px" }, h("h2", { class: "muted", style: "font-size:13px;letter-spacing:.08em;text-transform:uppercase" }, `${t} (${items.length})`), h("div", { class: "queue" }, items.map(contentCard))) : null;
  }));
}

// ───────────── Reports ─────────────
function md(text) {
  // Minimal, safe markdown → DOM (headings, tables, bullets, bold). No HTML passthrough.
  const root = h("div", { class: "report" });
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = rows.filter((r) => !/^\|\s*-/.test(r)).map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
      root.append(h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, cells[0].map((c) => h("th", {}, inline(c))))), h("tbody", {}, cells.slice(1).map((r) => h("tr", {}, r.map((c) => h("td", {}, inline(c)))))))));
    } else if (/^#{1,3} /.test(l)) root.append(h(l.startsWith("# ") ? "h1" : "h2", {}, l.replace(/^#+ /, "")));
    else if (/^- /.test(l)) root.append(h("div", { style: "padding:2px 0 2px 12px" }, "• ", inline(l.slice(2))));
    else if (l.trim()) root.append(h("p", {}, inline(l)));
  }
  return root;
}
function inline(s) {
  const parts = s.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g).filter(Boolean);
  return parts.map((p) => (p.startsWith("**") ? h("strong", {}, p.slice(2, -2)) : p.startsWith("_") && p.endsWith("_") ? h("em", { class: "muted" }, p.slice(1, -1)) : p.startsWith("`") ? h("code", {}, p.slice(1, -1)) : p));
}
function reportsView() {
  if (!state.reports.length) return h("div", { class: "card" }, h("div", { class: "empty" }, "No reports yet. The evening workflow writes a daily report; Sunday’s workflow writes the weekly intelligence report."));
  return h("div", { class: "queue" }, state.reports.map((r) => h("details", { class: "card" }, h("summary", { style: "cursor:pointer" }, h("strong", {}, `${r.kind === "weekly" ? "Weekly" : "Daily"} · ${r.period_start}${r.period_end !== r.period_start ? " → " + r.period_end : ""}`)), md(r.body_md))));
}

boot();
