/* Pocketwise dashboard: a small client for the Expense Tracker REST API. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  let token = null;
  try { token = sessionStorage.getItem("pw_token"); } catch (e) { /* storage blocked */ }
  let user = null, currency = "LKR", categories = [], page = 1, charts = {};
  const money = (n) => new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const short = (n) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

  // ------------------------------------------------------------ API helper
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && token) { signOut(); throw new Error("Your session ended. Sign in again."); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error || {};
      const details = (e.details || []).map((d) => d.message).join(" · ");
      throw new Error(details ? `${e.message}: ${details}` : e.message || "Request failed");
    }
    return data;
  }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 2600);
  }

  // ------------------------------------------------------------ auth
  let mode = "login";
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  function setMode(m) {
    mode = m;
    document.querySelectorAll(".tab").forEach((b) => { b.classList.toggle("active", b.dataset.mode === m); b.setAttribute("aria-selected", b.dataset.mode === m); });
    document.querySelectorAll(".reg-only").forEach((el) => (el.hidden = m !== "register"));
    $("#auth-title").textContent = m === "login" ? "Welcome back" : "Create your account";
    $("#auth-submit").textContent = m === "login" ? "Sign in" : "Create account";
    $("#auth-form [name=password]").autocomplete = m === "login" ? "current-password" : "new-password";
    $("#auth-error").hidden = true;
  }
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { email: f.get("email"), password: f.get("password") };
    if (mode === "register") body.name = f.get("name");
    const btn = $("#auth-submit"); btn.disabled = true;
    try {
      const r = await api(`/api/auth/${mode}`, { method: "POST", body });
      token = r.token;
      try { sessionStorage.setItem("pw_token", token); } catch (err) { /* ignore */ }
      start();
    } catch (err) { $("#auth-error").textContent = err.message; $("#auth-error").hidden = false; }
    finally { btn.disabled = false; }
  });
  $("#demo").addEventListener("click", () => {
    setMode("login");
    $("#auth-form [name=email]").value = "demo@expense.app";
    $("#auth-form [name=password]").value = "Demo2026!";
    $("#auth-form").requestSubmit();
  });
  function signOut() {
    token = null; try { sessionStorage.removeItem("pw_token"); } catch (e) { /* ignore */ }
    $("#app").hidden = true; $("#auth").hidden = false;
  }
  $("#logout").addEventListener("click", signOut);

  // ------------------------------------------------------------ start
  async function start() {
    const me = await api("/api/auth/me");
    user = me.user; currency = user.currency;
    $("#auth").hidden = true; $("#app").hidden = false;
    $("#username").textContent = user.name;
    $("#avatar").textContent = user.name.trim()[0].toUpperCase();
    const h = new Date().getHours();
    $("#greeting").textContent = `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${user.name.split(" ")[0]}`;
    if (!$("#month").value) $("#month").value = today().slice(0, 7);
    await loadCategories();
    await refresh();
  }
  $("#month").addEventListener("change", () => { page = 1; refresh(); });

  async function loadCategories() {
    categories = (await api("/api/categories")).data;
    const opts = categories.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join("");
    $("#cat-filter").innerHTML = `<option value="">All categories</option>${opts}`;
    $("#expense-form [name=categoryId]").innerHTML = opts;
    $("#budget-form [name=categoryId]").innerHTML = `<option value="">Whole month (all categories)</option>${opts}`;
  }

  async function refresh() {
    const month = $("#month").value;
    const [y, m] = month.split("-").map(Number);
    $("#period-label").textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) + " at a glance";
    const [summary, budgets, monthly] = await Promise.all([
      api(`/api/reports/summary?month=${month}`), api(`/api/budgets?month=${month}`), api("/api/reports/monthly?months=6"),
    ]);
    renderKpis(summary, budgets, monthly, month);
    renderBudgets(budgets);
    renderDonut(summary);
    renderMonthly(monthly);
    renderDaily(summary, month);
    await loadExpenses();
  }

  // ------------------------------------------------------------ KPIs
  function renderKpis(s, b, mo, month) {
    $("#k-spent").textContent = money(s.total);
    const cur = mo.data.find((x) => x.month === month);
    const ch = cur && cur.changeFromPreviousPercent;
    const sub = $("#k-spent-sub");
    sub.className = ch == null ? "" : ch > 0 ? "up" : "down";
    sub.textContent = ch == null ? `${s.count} expenses` : `${ch > 0 ? "▲" : "▼"} ${Math.abs(ch)}% vs last month`;
    const overall = b.data.find((x) => !x.category);
    if (overall) {
      $("#k-left").textContent = money(overall.remaining);
      $("#k-left-sub").textContent = `${overall.percentUsed}% of ${money(overall.limit)} used`;
    } else { $("#k-left").textContent = "No budget"; $("#k-left-sub").textContent = "Set a monthly budget"; }
    $("#k-avg").textContent = money(Math.round(s.averagePerActiveDay));
    $("#k-avg-sub").textContent = `${s.daily.length} ${s.daily.length === 1 ? "day" : "days"} with spending`;
    const top = s.topExpenses[0];
    $("#k-top").textContent = top ? money(top.amount) : "–";
    $("#k-top-sub").textContent = top ? `${top.description} · ${top.category}` : "No expenses yet";
  }

  // ------------------------------------------------------------ budgets
  const COLOR = { ok: "#0f9d7a", warning: "#f59e0b", over: "#e5484d" };
  const LABEL = { ok: "On track", warning: "Close to limit", over: "Over budget" };
  function renderBudgets(b) {
    if (!b.data.length) { $("#budgets").innerHTML = '<div class="empty">No budgets for this month yet. Use “Set budget” to add one.</div>'; return; }
    $("#budgets").innerHTML = b.data.map((x) => {
      const name = x.category ? `${esc(x.category.icon)} ${esc(x.category.name)}` : "🗓️ Whole month";
      const note = x.status === "over"
        ? `${money(x.spent - x.limit)} over the limit`
        : x.onTrack ? `${money(x.remaining)} left` : `${money(x.remaining)} left · at this pace you will spend ${money(x.projectedSpend)}`;
      return `<div class="budget-row">
        <div class="budget-top"><b>${name}<span class="badge ${x.status}">${LABEL[x.status]}</span></b><span>${money(x.spent)} / ${money(x.limit)}</span></div>
        <div class="bar" role="progressbar" aria-valuenow="${x.percentUsed}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(x.category ? x.category.name : "Whole month")} budget used"><i style="width:${Math.min(100, x.percentUsed)}%;background:${COLOR[x.status]}"></i></div>
        <div class="budget-note">${note}</div></div>`;
    }).join("");
  }

  // ------------------------------------------------------------ charts
  if (window.Chart) {
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.color = "#5b6d66";
    Chart.defaults.plugins.tooltip.callbacks.label = (c) => " " + money(c.parsed.y ?? c.parsed);
  }
  function chart(id, config) {
    if (!window.Chart) return;
    charts[id]?.destroy();
    charts[id] = new Chart(document.getElementById(id), config);
  }
  function renderDonut(s) {
    const rows = s.byCategory;
    $("#donut-legend").innerHTML = rows.length
      ? rows.map((c) => `<div><i style="background:${c.color}"></i><span>${esc(c.icon)} ${esc(c.name)} <span class="muted">${c.share}%</span></span><b>${money(c.total)}</b></div>`).join("")
      : '<div class="empty">No spending this month.</div>';
    chart("donut", {
      type: "doughnut",
      data: { labels: rows.map((c) => c.name), datasets: [{ data: rows.map((c) => c.total), backgroundColor: rows.map((c) => c.color), borderWidth: 3, borderColor: "#fff", hoverOffset: 6 }] },
      options: { cutout: "68%", plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  }
  function renderMonthly(mo) {
    chart("monthly", {
      type: "bar",
      data: {
        labels: mo.data.map((x) => new Date(x.month + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })),
        datasets: [{ data: mo.data.map((x) => x.total), backgroundColor: mo.data.map((x, i) => (i === mo.data.length - 1 ? "#0f9d7a" : "#b9e9d9")), borderRadius: 8, maxBarThickness: 46 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { grid: { color: "#eef2f0" }, ticks: { callback: short } }, x: { grid: { display: false } } }, maintainAspectRatio: false },
    });
  }
  function renderDaily(s, month) {
    const [y, m] = month.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const map = Object.fromEntries(s.daily.map((d) => [d.date, d.total]));
    const labels = [], vals = [];
    for (let d = 1; d <= days; d++) { const k = `${month}-${String(d).padStart(2, "0")}`; labels.push(d); vals.push(map[k] || 0); }
    chart("daily", {
      type: "line",
      data: { labels, datasets: [{ data: vals, borderColor: "#5b5bd6", backgroundColor: "rgba(91,91,214,.12)", fill: true, cubicInterpolationMode: "monotone", pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { grid: { color: "#eef2f0" }, ticks: { callback: short } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } }, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" } },
    });
  }

  // ------------------------------------------------------------ expenses table
  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>';
  const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  let lastRows = [];
  function query() {
    const month = $("#month").value;
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const p = new URLSearchParams({ from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, page, limit: 10 });
    if ($("#search").value.trim()) p.set("q", $("#search").value.trim());
    if ($("#cat-filter").value) p.set("categoryId", $("#cat-filter").value);
    return p;
  }
  async function loadExpenses() {
    const r = await api("/api/expenses?" + query());
    lastRows = r.data;
    $("#rows").innerHTML = r.data.length ? r.data.map((x) => `
      <tr>
        <td>${new Date(x.spentOn + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</td>
        <td><b>${esc(x.description)}</b>${x.note ? `<div class="muted" style="font-size:13px">${esc(x.note)}</div>` : ""}</td>
        <td><span class="chip" style="background:${x.category.color}1f;color:${x.category.color}">${esc(x.category.icon)} ${esc(x.category.name)}</span></td>
        <td class="method">${esc(x.paymentMethod)}</td>
        <td class="num amount">${money(x.amount)}</td>
        <td><div class="row-actions"><button class="icon-btn" data-edit="${x.id}" aria-label="Edit ${esc(x.description)}">${ICON_EDIT}</button><button class="icon-btn danger" data-del="${x.id}" aria-label="Delete ${esc(x.description)}">${ICON_DEL}</button></div></td>
      </tr>`).join("") : `<tr><td colspan="6"><div class="empty">No expenses match. Add one with “+ Add expense”.</div></td></tr>`;
    const m = r.meta;
    $("#page-info").textContent = m.total ? `${(m.page - 1) * m.limit + 1}–${Math.min(m.total, m.page * m.limit)} of ${m.total} · total ${money(m.totalAmount)}` : "";
    $("#prev").disabled = m.page <= 1; $("#next").disabled = m.page >= m.totalPages;
  }
  let t;
  $("#search").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { page = 1; loadExpenses(); }, 250); });
  $("#cat-filter").addEventListener("change", () => { page = 1; loadExpenses(); });
  $("#prev").addEventListener("click", () => { page--; loadExpenses(); });
  $("#next").addEventListener("click", () => { page++; loadExpenses(); });
  $("#rows").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (edit) openExpense(lastRows.find((x) => x.id === +edit.dataset.edit));
    if (del) {
      const x = lastRows.find((r) => r.id === +del.dataset.del);
      if (!confirmDelete(x)) return;
      await api(`/api/expenses/${x.id}`, { method: "DELETE" });
      toast("Expense deleted"); refresh();
    }
  });
  // a second click within 3 seconds confirms, so no blocking browser dialog is needed
  let pendingDelete = null;
  function confirmDelete(x) {
    if (pendingDelete === x.id) { pendingDelete = null; return true; }
    pendingDelete = x.id; toast(`Click delete again to remove “${x.description}”`);
    setTimeout(() => { if (pendingDelete === x.id) pendingDelete = null; }, 3000);
    return false;
  }
  $("#export").addEventListener("click", async (e) => {
    e.preventDefault();
    const p = query(); p.delete("page"); p.delete("limit");
    const res = await fetch("/api/expenses/export.csv?" + p, { headers: { Authorization: "Bearer " + token } });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `expenses-${$("#month").value}.csv` });
    a.click(); URL.revokeObjectURL(url);
  });

  // ------------------------------------------------------------ dialogs
  let editing = null;
  function openExpense(x) {
    editing = x || null;
    const f = $("#expense-form");
    f.reset(); $("#expense-error").hidden = true;
    $("#expense-title").textContent = x ? "Edit expense" : "Add expense";
    $("#expense-save").textContent = x ? "Save changes" : "Save expense";
    f.spentOn.max = today();
    f.spentOn.value = x ? x.spentOn : today();
    if (x) { f.description.value = x.description; f.amount.value = x.amount; f.categoryId.value = x.category.id; f.paymentMethod.value = x.paymentMethod; f.note.value = x.note || ""; }
    $("#expense-dialog").showModal(); f.description.focus();
  }
  $("#add-btn").addEventListener("click", () => openExpense());
  $("#expense-form").addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    e.preventDefault();
    const f = e.target;
    const body = { description: f.description.value, amount: Number(f.amount.value), categoryId: Number(f.categoryId.value), spentOn: f.spentOn.value, paymentMethod: f.paymentMethod.value, note: f.note.value || null };
    try {
      await api(editing ? `/api/expenses/${editing.id}` : "/api/expenses", { method: editing ? "PATCH" : "POST", body });
      $("#expense-dialog").close(); toast(editing ? "Expense updated" : "Expense added"); refresh();
    } catch (err) { $("#expense-error").textContent = err.message; $("#expense-error").hidden = false; }
  });
  $("#budget-btn").addEventListener("click", () => { $("#budget-form").reset(); $("#budget-error").hidden = true; $("#budget-dialog").showModal(); });
  $("#budget-form").addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    e.preventDefault();
    const f = e.target;
    try {
      await api("/api/budgets", { method: "PUT", body: { month: $("#month").value, categoryId: f.categoryId.value ? Number(f.categoryId.value) : null, limit: Number(f.limit.value) } });
      $("#budget-dialog").close(); toast("Budget saved"); refresh();
    } catch (err) { $("#budget-error").textContent = err.message; $("#budget-error").hidden = false; }
  });

  // ------------------------------------------------------------ boot
  if (token) start().catch(() => signOut()); else $("#auth").hidden = false;
})();
