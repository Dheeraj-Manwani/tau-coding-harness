/**
 * The admin console: one server-rendered page, no build step, no coupling to
 * the web app — so it still works when the frontend is broken, which is exactly
 * when you need it.
 *
 * It ships no data. Everything on screen is fetched from the guarded `/admin/*`
 * endpoints using the session cookie, which is why the shell itself can be
 * served unauthenticated.
 */
export function renderAdminConsole(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>tau — ops</title>
<style>
  :root {
    --bg: #0b0d10; --panel: #14171c; --line: #232830; --fg: #e6e9ef;
    --dim: #8b94a3; --ok: #3fb950; --warn: #d29922; --bad: #f85149;
    --accent: #58a6ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  header {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 12px 16px; border-bottom: 1px solid var(--line); position: sticky;
    top: 0; background: var(--bg); z-index: 10;
  }
  h1 { font-size: 14px; margin: 0; letter-spacing: .08em; text-transform: uppercase; }
  main { padding: 16px; }
  .strip { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
  .stat {
    background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
    padding: 8px 12px; min-width: 104px;
  }
  .stat .k { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .stat .v { font-size: 19px; margin-top: 2px; }
  .stat.bad .v { color: var(--bad); }
  .stat.warn .v { color: var(--warn); }
  .stat.ok .v { color: var(--ok); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  tbody tr:hover { background: #171b21; }
  .wrap { overflow-x: auto; }
  button, select, input {
    background: var(--panel); color: var(--fg); border: 1px solid var(--line);
    border-radius: 5px; padding: 5px 10px; font: inherit; cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  button.danger:hover { border-color: var(--bad); color: var(--bad); }
  .pill { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); font-size: 11px; }
  .QUEUED, .provisioning { color: var(--warn); }
  .RUNNING, .llm { color: var(--accent); }
  .COMPLETED { color: var(--ok); }
  .FAILED, .stuck { color: var(--bad); }
  .CANCELLED { color: var(--dim); }
  .dim { color: var(--dim); }
  pre {
    background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
    padding: 12px; overflow: auto; max-height: 70vh; font-size: 12px;
  }
  dialog {
    background: var(--bg); color: var(--fg); border: 1px solid var(--line);
    border-radius: 8px; width: min(1000px, 92vw); padding: 16px;
  }
  dialog::backdrop { background: rgba(0,0,0,.65); }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; }
  #login { max-width: 380px; margin: 12vh auto; }
  .hide { display: none !important; }
  .err { color: var(--bad); }
</style>
</head>
<body>

<div id="login">
  <h1>tau ops</h1>
  <p class="dim">Sign in with an account whose role is ADMIN (8 hour session).</p>
  <form id="loginForm">
    <div class="row" style="margin-bottom:8px">
      <input id="email" type="email" autocomplete="username" placeholder="email" class="grow" required />
    </div>
    <div class="row">
      <input id="password" type="password" autocomplete="current-password" placeholder="password" class="grow" required />
      <button type="submit" id="signin">Sign in</button>
    </div>
  </form>
  <p id="loginErr" class="err"></p>
</div>

<div id="app" class="hide">
  <header>
    <h1>tau ops</h1>
    <a href="/admin/costs" style="color:var(--accent);text-decoration:none">cost calculator</a>
    <a href="/admin/promo-codes" style="color:var(--accent);text-decoration:none">promo codes</a>
    <a href="/admin/feedback/ui" style="color:var(--accent);text-decoration:none">feedback</a>
    <div class="row grow">
      <select id="statusFilter">
        <option value="active">active (default)</option>
        <option value="all">all</option>
        <option value="RUNNING">running</option>
        <option value="QUEUED">queued</option>
        <option value="FAILED">failed</option>
        <option value="COMPLETED">completed</option>
        <option value="CANCELLED">cancelled</option>
      </select>
      <button id="refresh">refresh</button>
      <button id="reconcile">reconcile stuck</button>
      <label class="dim"><input type="checkbox" id="auto" style="cursor:pointer" /> auto 5s</label>
      <span id="updated" class="dim"></span>
    </div>
    <button id="signout">sign out</button>
  </header>

  <main>
    <div class="strip" id="health"></div>

    <div class="wrap">
      <table>
        <thead><tr>
          <th>job</th><th>status</th><th>phase</th><th>turn</th><th>effort</th>
          <th>age</th><th>hb</th><th>tokens</th><th>credits</th><th>finish</th><th></th>
        </tr></thead>
        <tbody id="jobs"></tbody>
      </table>
    </div>

    <h1 style="margin:26px 0 10px">metrics</h1>
    <div class="wrap"><table>
      <thead><tr>
        <th>window</th><th>jobs</th><th>success</th><th>p50</th><th>p95</th>
        <th>turns</th><th>credits/job</th><th>tool fail</th><th>sandbox fail</th>
      </tr></thead>
      <tbody id="metrics"></tbody>
    </table></div>
  </main>
</div>

<dialog id="detail"><div class="row"><h1 class="grow" id="detailTitle">job</h1>
<button id="closeDetail">close</button></div><pre id="detailBody"></pre></dialog>

<script>
const $ = (id) => document.getElementById(id);
const api = async (path, opts) => {
  const r = await fetch("/admin" + path, { credentials: "same-origin", ...opts });
  // 401 = the cookie lapsed. 403 = it is still valid but the account no longer
  // holds the ADMIN role, since the role is re-read on every request rather
  // than baked into the session.
  if (r.status === 401 || r.status === 403) {
    showLogin(r.status === 403 ? "Admin access revoked." : "Session expired.");
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const fmtAge = (s) => s == null ? "—"
  : s < 60 ? s + "s"
  : s < 3600 ? Math.floor(s / 60) + "m"
  : s < 86400 ? Math.floor(s / 3600) + "h"
  : Math.floor(s / 86400) + "d";
const pct = (v) => v == null ? "—" : (v * 100).toFixed(1) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function showLogin(msg) {
  $("app").classList.add("hide");
  $("login").classList.remove("hide");
  $("loginErr").textContent = msg || "";
}
function showApp() {
  $("login").classList.add("hide");
  $("app").classList.remove("hide");
  refresh();
}

$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch("/admin/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: $("email").value, password: $("password").value }),
  });
  $("password").value = "";
  if (r.ok) { showApp(); return; }
  // 403 means the credentials were right and the role is not ADMIN — worth
  // saying plainly, or an operator retypes a correct password forever.
  $("loginErr").textContent =
    r.status === 403 ? "That account is not an admin."
    : r.status === 429 ? "Too many attempts. Try again later."
    : "Rejected.";
};
$("signout").onclick = async () => {
  await fetch("/admin/session/end", { method: "POST", credentials: "same-origin" });
  showLogin("Signed out.");
};

function renderHealth(h) {
  const cell = (k, v, cls) =>
    '<div class="stat ' + (cls || "") + '"><div class="k">' + k +
    '</div><div class="v">' + v + "</div></div>";
  $("health").innerHTML = [
    cell("status", h.ok ? "ok" : "degraded", h.ok ? "ok" : "bad"),
    cell("stuck jobs", h.stuckJobs, h.stuckJobs ? "bad" : ""),
    cell("orphan holds", h.orphanHolds, h.orphanHolds ? "bad" : ""),
    cell("active", h.active + "/" + h.concurrency),
    cell("queued", h.queueDepth, h.queueDepth ? "warn" : ""),
    cell("resident", h.residentJobs),
    cell("holds", h.activeHolds),
    cell("uptime", fmtAge(h.uptimeSeconds)),
    cell("rss", h.memoryMB + "mb"),
  ].join("");
}

function renderJobs(rows) {
  $("jobs").innerHTML = rows.map((j) => {
    const phase = j.live ? j.live.phase : (j.stuck ? "stuck" : "—");
    const cls = j.stuck ? "stuck" : (j.live ? j.live.phase.split(":")[0] : j.status);
    return "<tr>" +
      '<td><a href="#" class="dim" data-job="' + j.id + '">' + j.id.slice(0, 8) + "</a></td>" +
      '<td class="' + j.status + '">' + j.status + "</td>" +
      '<td class="' + esc(cls) + '">' + esc(phase) +
        (j.live ? ' <span class="dim">' + fmtAge(j.live.phaseAgeSeconds) + "</span>" : "") + "</td>" +
      "<td>" + j.currentTurn + "</td>" +
      "<td>" + j.effort + "</td>" +
      "<td>" + fmtAge(j.ageSeconds) + "</td>" +
      '<td class="' + (j.stuck ? "stuck" : "") + '">' + fmtAge(j.heartbeatAgeSeconds) + "</td>" +
      '<td class="dim">' + (j.inputTokens + j.outputTokens).toLocaleString() + "</td>" +
      "<td>" + j.credits.toFixed(2) + "</td>" +
      '<td class="dim">' + esc(j.finishReason || "—") + "</td>" +
      "<td>" + (j.status === "QUEUED" || j.status === "RUNNING"
        ? '<button class="danger" data-kill="' + j.id + '">kill</button>' : "") + "</td>" +
      "</tr>";
  }).join("") || '<tr><td colspan="11" class="dim">nothing here</td></tr>';

  $("jobs").querySelectorAll("[data-kill]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Force-terminate this job?")) return;
      await api("/jobs/" + b.dataset.kill + "/kill", { method: "POST" });
      refresh();
    };
  });
  $("jobs").querySelectorAll("[data-job]").forEach((a) => {
    a.onclick = async (e) => {
      e.preventDefault();
      const d = await api("/jobs/" + a.dataset.job);
      $("detailTitle").textContent = "job " + a.dataset.job;
      $("detailBody").textContent = JSON.stringify(d, null, 2);
      $("detail").showModal();
    };
  });
}

function renderMetrics(rows) {
  $("metrics").innerHTML = rows.map((m) =>
    "<tr><td>" + m.window + "</td><td>" + m.jobs + "</td><td>" + pct(m.successRate) +
    "</td><td>" + fmtAge(m.p50DurationSeconds == null ? null : Math.round(m.p50DurationSeconds)) +
    "</td><td>" + fmtAge(m.p95DurationSeconds == null ? null : Math.round(m.p95DurationSeconds)) +
    "</td><td>" + (m.avgTurns ?? "—") + "</td><td>" + (m.creditsPerJob ?? "—") +
    "</td><td>" + pct(m.toolFailureRate) + "</td><td>" +
    pct(m.sandboxProvisionFailureRate) + "</td></tr>").join("");
}

async function refresh() {
  try {
    const [h, jobs, m] = await Promise.all([
      api("/health"),
      api("/jobs?limit=100&status=" + encodeURIComponent($("statusFilter").value)),
      api("/metrics"),
    ]);
    renderHealth(h);
    renderJobs(jobs);
    renderMetrics(m);
    $("updated").textContent = "updated " + new Date().toLocaleTimeString();
  } catch (e) { /* showLogin already handled 403 */ }
}

$("refresh").onclick = refresh;
$("statusFilter").onchange = refresh;
$("closeDetail").onclick = () => $("detail").close();
$("reconcile").onclick = async () => {
  const r = await api("/jobs/reconcile-stuck", { method: "POST" });
  alert("reaped " + r.reaped + (r.errors.length ? " (" + r.errors.length + " errors)" : ""));
  refresh();
};

// Off by default: every tick re-runs the 7-day metrics scan against the same
// database users are on. Opt in during an incident. Only polls while signed in
// — a hidden login box means the cookie is gone and every tick would just 403.
setInterval(() => {
  if ($("auto").checked && $("login").classList.contains("hide")) refresh();
}, 5000);

// Probe the session: if the cookie is still good we go straight in.
api("/health").then(showApp).catch(() => showLogin());
</script>
</body>
</html>`;
}
