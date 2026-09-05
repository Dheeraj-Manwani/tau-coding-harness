import { CREDIT_PACKS } from "../services/billing.service";
import {
  PRICING,
  PRO_MONTHLY_ALLOTMENT_MICRO,
  PRO_MONTHLY_PRICE_INR,
  toCredits,
} from "@/lib/pricing";

const providerRates = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    cacheHitUsd: 0.014,
    inputUsd: 0.44,
    outputUsd: 1.32,
    note: "Peak rate",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    cacheHitUsd: 0.044,
    inputUsd: 1.32,
    outputUsd: 3.96,
    note: "Peak rate",
  },
  {
    id: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    cacheHitUsd: 0.19,
    inputUsd: 0.95,
    outputUsd: 4,
    note: "Published rate",
  },
] as const;

const products = [
  {
    id: "pro",
    label: "PRO monthly",
    grossInr: PRO_MONTHLY_PRICE_INR,
    credits: toCredits(PRO_MONTHLY_ALLOTMENT_MICRO),
  },
  ...CREDIT_PACKS.map((pack) => ({
    id: pack.id,
    label: `${pack.credits.toLocaleString("en-IN")} credit pack`,
    grossInr: pack.amount / 100,
    credits: pack.credits,
  })),
];

const models = providerRates.map((provider) => {
  const pricing = PRICING[provider.id];
  if (!pricing) throw new Error(`Missing Tau pricing for ${provider.id}`);
  return {
    ...provider,
    inputCreditsPerM: Number(pricing.inputPerM) / 1_000_000,
    outputCreditsPerM: Number(pricing.outputPerM) / 1_000_000,
  };
});

/**
 * Interactive unit-economics calculator for the protected ops surface.
 * Provider prices are a dated snapshot and intentionally editable in-browser;
 * Tau plan and credit defaults come from the live catalog above.
 */
export function renderAdminCostCalculator(): string {
  const seed = JSON.stringify({ products, models }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>tau — cost calculator</title>
<style>
  :root {
    --bg:#0b0d10; --panel:#14171c; --panel2:#191d24; --line:#29303a;
    --fg:#e6e9ef; --dim:#929baa; --accent:#58a6ff; --ok:#3fb950;
    --warn:#d29922; --bad:#f85149;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  header { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:16px; padding:12px 18px; border-bottom:1px solid var(--line); background:var(--bg); }
  h1,h2,h3 { margin:0; font-weight:600; }
  h1 { font-size:14px; letter-spacing:.08em; text-transform:uppercase; }
  h2 { margin-bottom:10px; font-size:14px; }
  h3 { font-size:12px; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; }
  a { color:var(--accent); text-decoration:none; }
  main { max-width:1500px; margin:auto; padding:18px; }
  .grid { display:grid; gap:14px; grid-template-columns:repeat(12,minmax(0,1fr)); }
  .span4 { grid-column:span 4; } .span5 { grid-column:span 5; } .span7 { grid-column:span 7; } .span8 { grid-column:span 8; } .span12 { grid-column:1/-1; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .inputs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px 12px; }
  label { display:grid; gap:4px; color:var(--dim); font-size:11px; }
  input,select { width:100%; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:5px; padding:7px 8px; font:inherit; }
  input:focus,select:focus { outline:1px solid var(--accent); border-color:var(--accent); }
  .stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
  .stat { background:var(--panel2); border-radius:6px; padding:10px; }
  .stat .k { color:var(--dim); font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
  .stat .v { font-size:20px; margin-top:3px; font-variant-numeric:tabular-nums; }
  .ok { color:var(--ok); } .bad { color:var(--bad); } .warn { color:var(--warn); } .dim { color:var(--dim); }
  .wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:7px 8px; text-align:right; border-bottom:1px solid var(--line); white-space:nowrap; }
  th:first-child,td:first-child { text-align:left; }
  th { color:var(--dim); font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:500; }
  td input { min-width:88px; text-align:right; padding:5px 6px; }
  .bar { height:7px; background:var(--panel2); border-radius:99px; overflow:hidden; margin-top:6px; }
  .bar > i { display:block; height:100%; background:var(--accent); }
  .formula { padding:9px; border-left:2px solid var(--accent); background:var(--panel2); color:var(--dim); }
  .callout { border-color:color-mix(in srgb,var(--warn) 45%,var(--line)); }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .grow { flex:1; }
  .badge { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:1px 7px; color:var(--dim); font-size:10px; }
  @media(max-width:900px){ .span4,.span5,.span7,.span8 { grid-column:1/-1; } .stats { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <h1>tau cost calculator</h1>
  <a href="/admin/ui">← ops console</a>
  <a href="/admin/promo-codes">promo codes</a>
  <span class="grow"></span>
  <span class="dim">provider snapshot: 28 Aug 2026</span>
</header>
<main>
  <div class="grid">
    <section class="card span4">
      <h2>Commercial assumptions</h2>
      <div class="inputs">
        <label class="span12">Product<select id="product"></select></label>
        <label>Price paid (₹)<input id="gross" type="number" min="0" step="1" /></label>
        <label>Credits granted<input id="credits" type="number" min="1" step="1" /></label>
        <label>GST included (%)<input id="gst" type="number" min="0" step="0.1" value="18" /></label>
        <label>Gateway fee (%)<input id="fee" type="number" min="0" step="0.1" value="2" /></label>
        <label>GST on gateway fee (%)<input id="feeGst" type="number" min="0" step="0.1" value="18" /></label>
        <label>USD → INR<input id="fx" type="number" min="1" step="0.0001" value="95.5131" /></label>
        <label>Target AI gross margin (%)<input id="target" type="number" min="0" max="99" step="1" value="60" /></label>
        <label>Flash workload share (%)<input id="flashMix" type="number" min="0" max="100" step="1" value="50" /></label>
        <label>Input-token share (%)<input id="inputMix" type="number" min="0" max="100" step="1" value="80" /></label>
      </div>
    </section>

    <section class="card span8">
      <h2>Revenue waterfall</h2>
      <div class="stats">
        <div class="stat"><div class="k">Customer pays</div><div class="v" id="grossStat"></div></div>
        <div class="stat"><div class="k">GST liability</div><div class="v warn" id="taxStat"></div></div>
        <div class="stat"><div class="k">Gateway + fee GST</div><div class="v warn" id="feeStat"></div></div>
        <div class="stat"><div class="k">Net before AI</div><div class="v" id="netStat"></div></div>
        <div class="stat"><div class="k">Net per credit</div><div class="v" id="perCreditStat"></div></div>
        <div class="stat"><div class="k">AI budget at target</div><div class="v ok" id="budgetStat"></div></div>
      </div>
      <div style="margin-top:14px">
        <div class="row"><span class="dim">Share of collected price left before AI</span><span class="grow"></span><b id="netPct"></b></div>
        <div class="bar"><i id="netBar"></i></div>
      </div>
    </section>

    <section class="card span12">
      <div class="row"><h2 class="grow">Provider prices and Tau metering</h2><span class="badge">all values editable</span></div>
      <div class="wrap"><table>
        <thead><tr><th>Model</th><th>Cache hit $/1M</th><th>Input miss $/1M</th><th>Output $/1M</th><th>Tau input cr/1M</th><th>Tau output cr/1M</th></tr></thead>
        <tbody id="rateRows"></tbody>
      </table></div>
      <p class="dim">DeepSeek uses peak pricing for a conservative ceiling. Kimi K2.7 is included for planning; Tau's current main build loop uses DeepSeek, while Kimi K2.6 handles attachment extraction.</p>
    </section>

    <section class="card span12 callout">
      <h2>Full-credit utilization stress test</h2>
      <div class="wrap"><table>
        <thead><tr><th>Model / token side</th><th>Provider cost per Tau credit</th><th>Provider account bears</th><th>Left after provider</th><th>Gross margin</th><th>Provider share</th><th>Required cr/1M for target</th></tr></thead>
        <tbody id="stressRows"></tbody>
      </table></div>
    </section>

    <section class="card span12">
      <div class="row"><h2 class="grow">Averaged margin — current settings</h2><span class="badge" id="averageAssumption"></span></div>
      <div class="wrap"><table>
        <thead><tr><th>Product</th><th>Net before AI</th><th>Average provider cost</th><th>Margin left (₹)</th><th>Margin left (%)</th><th>Provider share</th></tr></thead>
        <tbody id="averageRows"></tbody>
      </table></div>
      <p class="dim">Weighted across the current DeepSeek Flash/Pro and input/output assumptions above. This excludes Kimi attachment extraction, E2B, R2, database, support and refunds.</p>
    </section>

    <section class="card span5">
      <h2>What the formula means</h2>
      <div class="formula">net = price ÷ (1 + GST) − price × gateway fee × (1 + fee GST)</div>
      <div class="formula" style="margin-top:8px">provider burden = granted credits × provider ₹/1M ÷ Tau credits/1M</div>
      <div class="formula" style="margin-top:8px">required credits/1M = provider ₹/1M ÷ allowed provider ₹ per credit</div>
    </section>
    <section class="card span7">
      <h2>Reading the result</h2>
      <p><b>Provider account bears</b> is the amount deducted from the DeepSeek or Kimi account if every granted Tau credit is consumed in that scenario.</p>
      <p><b>Left after provider</b> is what remains for E2B, R2, database, support and profit. Negative means Tau subsidizes usage.</p>
      <p><b>Required credits/1M</b> is the minimum metering rate needed to preserve the selected AI-only target margin. Round it upward and add an FX/provider-price buffer before shipping.</p>
    </section>
  </div>
</main>
<script>
const seed = ${seed};
const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:2 }).format(n);
const pct = (n) => Number.isFinite(n) ? n.toFixed(1) + "%" : "—";
const num = (id) => Math.max(0, Number($(id).value) || 0);
const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

$("product").innerHTML = seed.products.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>').join("");
$("rateRows").innerHTML = seed.models.map((m, i) => '<tr>' +
  '<td>' + esc(m.label) + '<br><span class="dim">' + esc(m.note) + '</span></td>' +
  '<td><input data-rate="cacheHitUsd" data-i="' + i + '" type="number" min="0" step="0.001" value="' + m.cacheHitUsd + '"></td>' +
  '<td><input data-rate="inputUsd" data-i="' + i + '" type="number" min="0" step="0.01" value="' + m.inputUsd + '"></td>' +
  '<td><input data-rate="outputUsd" data-i="' + i + '" type="number" min="0" step="0.01" value="' + m.outputUsd + '"></td>' +
  '<td><input data-rate="inputCreditsPerM" data-i="' + i + '" type="number" min="0.000001" step="1" value="' + m.inputCreditsPerM + '"></td>' +
  '<td><input data-rate="outputCreditsPerM" data-i="' + i + '" type="number" min="0.000001" step="1" value="' + m.outputCreditsPerM + '"></td></tr>'
).join("");

function loadProduct() {
  const p = seed.products.find((x) => x.id === $("product").value) || seed.products[0];
  $("gross").value = p.grossInr;
  $("credits").value = p.credits;
  calculate();
}

function readModels() {
  return seed.models.map((m, i) => {
    const copy = { ...m };
    document.querySelectorAll('[data-i="' + i + '"]').forEach((el) => { copy[el.dataset.rate] = Math.max(0.000001, Number(el.value) || 0); });
    return copy;
  });
}

function calculate() {
  const gross = num("gross"), credits = Math.max(1, num("credits"));
  const gst = num("gst") / 100, fee = num("fee") / 100, feeGst = num("feeGst") / 100;
  const fx = num("fx"), target = Math.min(0.99, num("target") / 100);
  const exTax = gross / (1 + gst), tax = gross - exTax;
  const gateway = gross * fee * (1 + feeGst);
  const net = exTax - gateway, netPerCredit = net / credits;
  const allowedPerCredit = netPerCredit * (1 - target);

  $("grossStat").textContent = money(gross);
  $("taxStat").textContent = "−" + money(tax);
  $("feeStat").textContent = "−" + money(gateway);
  $("netStat").textContent = money(net);
  $("perCreditStat").textContent = money(netPerCredit);
  $("budgetStat").textContent = money(net * (1 - target));
  const netShare = gross > 0 ? net / gross * 100 : 0;
  $("netPct").textContent = pct(netShare);
  $("netBar").style.width = Math.max(0, Math.min(100, netShare)) + "%";

  const rows = [];
  readModels().forEach((m) => {
    [
      { side:"input cache hit", usd:m.cacheHitUsd, tau:m.inputCreditsPerM },
      { side:"input miss", usd:m.inputUsd, tau:m.inputCreditsPerM },
      { side:"output", usd:m.outputUsd, tau:m.outputCreditsPerM },
    ].forEach((s) => {
      const providerPerM = s.usd * fx;
      const providerPerCredit = providerPerM / s.tau;
      const burden = providerPerCredit * credits;
      const left = net - burden;
      const margin = net > 0 ? left / net * 100 : -Infinity;
      const share = net > 0 ? burden / net * 100 : Infinity;
      const required = allowedPerCredit > 0 ? Math.ceil(providerPerM / allowedPerCredit) : Infinity;
      const cls = margin >= Number($("target").value) ? "ok" : margin >= 0 ? "warn" : "bad";
      rows.push('<tr><td>' + esc(m.label) + ' · ' + s.side + '</td>' +
        '<td>' + money(providerPerCredit) + '</td><td>' + money(burden) + '</td>' +
        '<td class="' + cls + '">' + money(left) + '</td><td class="' + cls + '">' + pct(margin) + '</td>' +
        '<td>' + pct(share) + '</td><td>' + (Number.isFinite(required) ? required.toLocaleString("en-IN") : "—") + '</td></tr>');
    });
  });
  $("stressRows").innerHTML = rows.join("");

  // Planning average for the products Tau currently sells. The two weights are
  // explicit inputs so this never masquerades as observed production usage.
  const modelRows = readModels();
  const flash = modelRows.find((m) => m.id === "deepseek-v4-flash");
  const pro = modelRows.find((m) => m.id === "deepseek-v4-pro");
  const flashShare = Math.min(1, num("flashMix") / 100);
  const inputShare = Math.min(1, num("inputMix") / 100);
  const costPerCredit = (m) => inputShare * (m.inputUsd * fx / m.inputCreditsPerM) +
    (1 - inputShare) * (m.outputUsd * fx / m.outputCreditsPerM);
  const averageProviderPerCredit = flashShare * costPerCredit(flash) +
    (1 - flashShare) * costPerCredit(pro);
  $("averageAssumption").textContent = Math.round(flashShare * 100) + "% Flash · " +
    Math.round((1 - flashShare) * 100) + "% Pro · " + Math.round(inputShare * 100) + "% input";

  $("averageRows").innerHTML = seed.products.map((p) => {
    const selected = p.id === $("product").value;
    const productGross = selected ? gross : p.grossInr;
    const productCredits = selected ? credits : p.credits;
    const productExTax = productGross / (1 + gst);
    const productGateway = productGross * fee * (1 + feeGst);
    const productNet = productExTax - productGateway;
    const providerCost = averageProviderPerCredit * productCredits;
    const marginInr = productNet - providerCost;
    const marginPct = productNet > 0 ? marginInr / productNet * 100 : -Infinity;
    const providerShare = productNet > 0 ? providerCost / productNet * 100 : Infinity;
    const cls = marginPct >= Number($("target").value) ? "ok" : marginPct >= 0 ? "warn" : "bad";
    return '<tr><td>' + esc(p.label) + (selected ? ' <span class="badge">selected / edited</span>' : '') + '</td>' +
      '<td>' + money(productNet) + '</td><td>' + money(providerCost) + '</td>' +
      '<td class="' + cls + '"><b>' + money(marginInr) + '</b></td>' +
      '<td class="' + cls + '"><b>' + pct(marginPct) + '</b></td><td>' + pct(providerShare) + '</td></tr>';
  }).join("");
}

$("product").onchange = loadProduct;
document.querySelectorAll("input").forEach((el) => el.addEventListener("input", calculate));
loadProduct();
</script>
</body>
</html>`;
}
