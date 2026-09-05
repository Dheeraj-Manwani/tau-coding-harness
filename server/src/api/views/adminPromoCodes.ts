/** Admin-only form for issuing promotional credit codes. */
export function renderAdminPromoCodes(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>tau — promo codes</title>
<style>
  :root { color-scheme:dark; --bg:#0b0d10; --panel:#14171c; --line:#29303a; --fg:#e6e9ef; --dim:#929baa; --accent:#58a6ff; --ok:#3fb950; --bad:#f85149; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  header { display:flex; align-items:center; gap:16px; padding:12px 18px; border-bottom:1px solid var(--line); }
  h1 { margin:0; font-size:14px; letter-spacing:.08em; text-transform:uppercase; }
  h2 { margin:0 0 14px; font-size:15px; }
  a { color:var(--accent); text-decoration:none; }
  main { width:min(760px,100%); margin:0 auto; padding:24px 18px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .wide { grid-column:1/-1; }
  label { display:grid; gap:5px; color:var(--dim); font-size:11px; }
  .label-title { color:var(--fg); font-size:12px; font-weight:600; }
  .help { min-height:32px; color:var(--dim); line-height:1.35; }
  input,textarea,button { width:100%; border:1px solid var(--line); border-radius:5px; background:var(--bg); color:var(--fg); padding:8px 9px; font:inherit; }
  textarea { resize:vertical; min-height:72px; }
  input:focus,textarea:focus { outline:1px solid var(--accent); border-color:var(--accent); }
  button { width:auto; cursor:pointer; background:var(--accent); border-color:var(--accent); color:#07111d; font-weight:700; }
  button:disabled { opacity:.55; cursor:wait; }
  .row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .grow { flex:1; }
  .dim { color:var(--dim); }
  .ok { color:var(--ok); }
  .err { color:var(--bad); white-space:pre-wrap; }
  pre { margin:14px 0 0; padding:12px; overflow:auto; border:1px solid var(--line); border-radius:6px; background:var(--bg); }
  @media(max-width:600px) { .grid { grid-template-columns:1fr; } .wide { grid-column:auto; } }
</style>
</head>
<body>
<header>
  <h1>tau promo codes</h1>
  <a href="/admin/ui">← ops console</a>
  <a href="/admin/costs">cost calculator</a>
</header>
<main>
  <section class="card">
    <h2>Create a promo code</h2>
    <form id="promoForm" class="grid" autocomplete="off">
      <label class="wide"><span class="label-title">Promo code</span>
        <span class="help">What customers enter on the billing page. It is automatically uppercased and cannot contain spaces.</span>
        <input id="code" maxlength="64" placeholder="LAUNCH200" required />
      </label>
      <label><span class="label-title">Credits per redemption</span>
        <span class="help">Credits added to a customer's non-expiring bonus balance each time the code is redeemed.</span>
        <input id="credits" type="number" min="0.000001" step="any" placeholder="200" required />
      </label>
      <label><span class="label-title">Redemptions per user</span>
        <span class="help">How many times one account may use this code. Use 1 for a standard one-use promotion.</span>
        <input id="perUserLimit" type="number" min="1" step="1" value="1" required />
      </label>
      <label><span class="label-title">Total redemption limit</span>
        <span class="help">Maximum successful redemptions across all accounts. Leave blank for no global limit.</span>
        <input id="maxRedemptions" type="number" min="1" step="1" placeholder="100" />
      </label>
      <label><span class="label-title">Expiration date and time</span>
        <span class="help">Interpreted in your device's local timezone. Leave blank to keep the code valid indefinitely.</span>
        <input id="expiresAt" type="datetime-local" step="60" />
        <span id="expiryPreview" class="dim">No expiration.</span>
      </label>
      <label class="wide"><span class="label-title">Internal description</span>
        <span class="help">Optional note explaining the campaign or intended audience. Customers do not need this to redeem the code.</span>
        <textarea id="description" placeholder="Launch promotion"></textarea>
      </label>
      <div class="wide row">
        <button id="submit" type="submit">Create promo code</button>
        <span id="status" aria-live="polite"></span>
      </div>
    </form>
    <pre id="result" hidden></pre>
  </section>
</main>
<script>
const byId = (id) => document.getElementById(id);
const optionalInt = (id) => {
  const value = byId(id).value.trim();
  return value === "" ? undefined : Number(value);
};

const pad = (value) => String(value).padStart(2, "0");
const toLocalInputValue = (date) =>
  date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
  "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());

// Parse datetime-local component-by-component. Direct string date parsing
// is interpreted inconsistently by older browsers, which made expiry silently
// fail or shift timezone. The API always receives an unambiguous UTC ISO value.
const expiryToIso = (value) => {
  if (!value) return undefined;
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid expiration date and time.");
  if (date.getTime() <= Date.now()) throw new Error("Expiration must be in the future.");
  return date.toISOString();
};

const expiryInput = byId("expiresAt");
const setExpiryMinimum = () => {
  const minimum = new Date(Date.now() + 60_000);
  expiryInput.min = toLocalInputValue(minimum);
};
const updateExpiryPreview = () => {
  if (!expiryInput.value) {
    byId("expiryPreview").textContent = "No expiration.";
    return;
  }
  try {
    const iso = expiryToIso(expiryInput.value);
    byId("expiryPreview").textContent = "Stored as " + iso + " (UTC).";
  } catch (error) {
    byId("expiryPreview").textContent = error instanceof Error ? error.message : "Invalid expiration.";
  }
};
setExpiryMinimum();
expiryInput.addEventListener("input", updateExpiryPreview);

byId("code").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/\\s+/g, "");
});

byId("promoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = byId("submit");
  const status = byId("status");
  const result = byId("result");
  submit.disabled = true;
  status.className = "dim";
  status.textContent = "Creating…";
  result.hidden = true;

  try {
    const body = {
      code: byId("code").value,
      credits: Number(byId("credits").value),
      description: byId("description").value.trim() || undefined,
      maxRedemptions: optionalInt("maxRedemptions"),
      perUserLimit: Number(byId("perUserLimit").value),
      expiresAt: expiryToIso(expiryInput.value),
    };
    const response = await fetch("/admin/promo-codes", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || "Promo code could not be created.";
      throw new Error(response.status === 409 ? "That promo code already exists." : message);
    }

    status.className = "ok";
    status.textContent = "Created " + payload.code + ".";
    result.textContent = JSON.stringify(payload, null, 2);
    result.hidden = false;
    byId("code").value = "";
    byId("code").focus();
  } catch (error) {
    status.className = "err";
    status.textContent = error instanceof Error ? error.message : "Promo code could not be created.";
  } finally {
    submit.disabled = false;
  }
});
</script>
</body>
</html>`;
}
