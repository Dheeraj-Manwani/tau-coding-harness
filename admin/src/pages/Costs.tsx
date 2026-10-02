import { useMemo, useState } from "react";
import { useApi } from "@/lib/useApi";
import type { CostSeed } from "@/types";
import { Badge, Card, ErrorBox, Loading, PageHeader, Section, Table, Td, inputClass, type Tone } from "@/components/ui";

/**
 * Unit economics: what a rupee of revenue leaves after GST, the payment fee and
 * the LLM provider, per product and per model. tau's side (plan price, packs,
 * credits per million tokens) is seeded from the live catalog; provider prices
 * are a dated snapshot. Everything is editable and nothing is saved, so
 * this is a planning tool, not a record.
 */
export default function Costs() {
  const { data, error, loading } = useApi<CostSeed>("/costs");
  return (
    <>
      <PageHeader
        title="Costs"
        subtitle={
          data
            ? `Margins per product and model · provider prices as of ${data.providerPricesAsOf} · every value is editable here`
            : "Unit economics"
        }
      />
      {error && <ErrorBox message={error} />}
      {!data && loading && <Loading />}
      {data && <Calculator seed={data} />}
    </>
  );
}

type Model = CostSeed["models"][number];

const inr = (n: number) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n)
    : "—";
const pctText = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)}%` : "—");
const nonNeg = (v: string) => Math.max(0, Number(v) || 0);

function marginTone(marginPct: number, target: number): Tone {
  if (marginPct >= target) return "good";
  if (marginPct >= 0) return "warning";
  return "critical";
}

function Calculator({ seed }: { seed: CostSeed }) {
  const first = seed.products[0]!;
  const [productId, setProductId] = useState(first.id);
  const [form, setForm] = useState({
    gross: String(first.grossInr),
    credits: String(first.credits),
    gst: "18",
    fee: "2",
    feeGst: "18",
    fx: "95.5131",
    target: "60",
    flashMix: "50",
    inputMix: "80",
  });
  const [models, setModels] = useState<Model[]>(seed.models);

  const pickProduct = (id: string) => {
    const p = seed.products.find((x) => x.id === id) ?? first;
    setProductId(p.id);
    setForm((f) => ({ ...f, gross: String(p.grossInr), credits: String(p.credits) }));
  };
  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const setRate = (i: number, k: keyof Model) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setModels((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: Math.max(0.000001, Number(e.target.value) || 0) } : m)));

  const calc = useMemo(() => {
    const gross = nonNeg(form.gross);
    const credits = Math.max(1, nonNeg(form.credits));
    const gst = nonNeg(form.gst) / 100;
    const fee = nonNeg(form.fee) / 100;
    const feeGst = nonNeg(form.feeGst) / 100;
    const fx = nonNeg(form.fx);
    const targetPct = nonNeg(form.target);
    const target = Math.min(0.99, targetPct / 100);

    const netOf = (price: number) => price / (1 + gst) - price * fee * (1 + feeGst);
    const exTax = gross / (1 + gst);
    const tax = gross - exTax;
    const gateway = gross * fee * (1 + feeGst);
    const net = netOf(gross);
    const netPerCredit = net / credits;
    const allowedPerCredit = netPerCredit * (1 - target);

    const stress = models.flatMap((m) =>
      [
        { side: "input, cache hit", usd: m.cacheHitUsd, tau: m.inputCreditsPerM },
        { side: "input, cache miss", usd: m.inputUsd, tau: m.inputCreditsPerM },
        { side: "output", usd: m.outputUsd, tau: m.outputCreditsPerM },
      ].map((s) => {
        const providerPerM = s.usd * fx;
        const providerPerCredit = providerPerM / s.tau;
        const burden = providerPerCredit * credits;
        const left = net - burden;
        return {
          key: `${m.id}:${s.side}`,
          label: `${m.label} · ${s.side}`,
          providerPerCredit,
          burden,
          left,
          margin: net > 0 ? (left / net) * 100 : -Infinity,
          share: net > 0 ? (burden / net) * 100 : Infinity,
          required: allowedPerCredit > 0 ? Math.ceil(providerPerM / allowedPerCredit) : Infinity,
        };
      }),
    );

    // Planning average across what tau sells. Both weights are explicit inputs
    // so this never passes itself off as observed production usage.
    const flash = models.find((m) => m.id === "deepseek-v4-flash");
    const pro = models.find((m) => m.id === "deepseek-v4-pro");
    const flashShare = Math.min(1, nonNeg(form.flashMix) / 100);
    const inputShare = Math.min(1, nonNeg(form.inputMix) / 100);
    const costPerCredit = (m: Model) =>
      inputShare * ((m.inputUsd * fx) / m.inputCreditsPerM) + (1 - inputShare) * ((m.outputUsd * fx) / m.outputCreditsPerM);
    const avgPerCredit = flash && pro ? flashShare * costPerCredit(flash) + (1 - flashShare) * costPerCredit(pro) : NaN;

    const average = seed.products.map((p) => {
      const selected = p.id === productId;
      const pGross = selected ? gross : p.grossInr;
      const pCredits = selected ? credits : p.credits;
      const pNet = netOf(pGross);
      const providerCost = avgPerCredit * pCredits;
      const marginInr = pNet - providerCost;
      return {
        id: p.id,
        label: p.label,
        selected,
        net: pNet,
        providerCost,
        marginInr,
        marginPct: pNet > 0 ? (marginInr / pNet) * 100 : -Infinity,
        share: pNet > 0 ? (providerCost / pNet) * 100 : Infinity,
      };
    });

    return {
      gross, tax, gateway, net, netPerCredit, targetPct,
      budget: net * (1 - target),
      netShare: gross > 0 ? (net / gross) * 100 : 0,
      stress, average,
      mix: `${Math.round(flashShare * 100)}% Flash · ${Math.round((1 - flashShare) * 100)}% Pro · ${Math.round(inputShare * 100)}% input`,
    };
  }, [form, models, productId, seed.products]);

  const field = (labelText: string, k: keyof typeof form, step = "1") => (
    <label className="block text-xs text-fg-2">
      {labelText}
      <input type="number" min="0" step={step} className={`${inputClass} mt-1 w-full num`} value={form[k]} onChange={setField(k)} />
    </label>
  );

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="Commercial assumptions">
          <label className="mb-3 block text-xs text-fg-2">
            Product
            <select className={`${inputClass} mt-1 w-full`} value={productId} onChange={(e) => pickProduct(e.target.value)}>
              {seed.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {field("Price paid (₹)", "gross")}
            {field("Credits granted", "credits")}
            {field("GST included (%)", "gst", "0.1")}
            {field("Gateway fee (%)", "fee", "0.1")}
            {field("GST on gateway fee (%)", "feeGst", "0.1")}
            {field("USD → INR", "fx", "0.0001")}
            {field("Target AI gross margin (%)", "target")}
            {field("Flash share of work (%)", "flashMix")}
            {field("Input-token share (%)", "inputMix")}
          </div>
        </Card>

        <Card title="Revenue waterfall">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label="Customer pays" value={inr(calc.gross)} />
            <Figure label="GST liability" value={`−${inr(calc.tax)}`} />
            <Figure label="Gateway fee + its GST" value={`−${inr(calc.gateway)}`} />
            <Figure label="Net before AI" value={inr(calc.net)} />
            <Figure label="Net per credit" value={inr(calc.netPerCredit)} />
            <Figure label={`AI budget at ${calc.targetPct}% margin`} value={inr(calc.budget)} />
          </div>
          <div className="mt-5">
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="text-fg-2">Share of the price left before AI</span>
              <span className="num text-fg">{pctText(calc.netShare)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-accent-soft">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, calc.netShare))}%` }} />
            </div>
          </div>
        </Card>
      </div>

      <Section
        title="Provider prices and tau metering"
        description="USD per million tokens (provider) against tau credits per million tokens (what users are charged). DeepSeek uses peak pricing as a conservative ceiling."
      >
        <Table head={["Model", "Cache hit $/1M", "Input miss $/1M", "Output $/1M", "tau input cr/1M", "tau output cr/1M"]}>
          {models.map((m, i) => (
            <tr key={m.id}>
              <Td>
                <div className="font-medium">{m.label}</div>
                <div className="text-xs text-fg-3">{m.note}</div>
              </Td>
              {(["cacheHitUsd", "inputUsd", "outputUsd", "inputCreditsPerM", "outputCreditsPerM"] as const).map((k) => (
                <Td key={k}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={`${inputClass} num w-28 text-right`}
                    value={m[k]}
                    onChange={setRate(i, k)}
                    aria-label={`${m.label} ${k}`}
                  />
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="Full-usage stress test"
        description="If every granted credit is spent on one model and token type: what the provider bills, and what's left."
      >
        <Table head={["Model / token type", "Provider cost per credit", "Provider bills", "Left after provider", "Margin", "Provider share", `Credits/1M needed for ${calc.targetPct}%`]}>
          {calc.stress.map((r) => (
            <tr key={r.key}>
              <Td>{r.label}</Td>
              <Td num>{inr(r.providerPerCredit)}</Td>
              <Td num>{inr(r.burden)}</Td>
              <Td num>{inr(r.left)}</Td>
              <Td>
                <Badge tone={marginTone(r.margin, calc.targetPct)}>{pctText(r.margin)}</Badge>
              </Td>
              <Td num>{pctText(r.share)}</Td>
              <Td num>{Number.isFinite(r.required) ? r.required.toLocaleString("en-IN") : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Average margin per product" description={`Weighted by ${calc.mix}. Excludes Kimi extraction, E2B, R2, database, support and refunds.`}>
        <Table head={["Product", "Net before AI", "Average provider cost", "Margin (₹)", "Margin (%)", "Provider share"]}>
          {calc.average.map((r) => (
            <tr key={r.id}>
              <Td>
                {r.label}
                {r.selected && (
                  <span className="ml-2">
                    <Badge tone="info" icon={false}>
                      edited
                    </Badge>
                  </span>
                )}
              </Td>
              <Td num>{inr(r.net)}</Td>
              <Td num>{inr(r.providerCost)}</Td>
              <Td num className="font-medium">{inr(r.marginInr)}</Td>
              <Td>
                <Badge tone={marginTone(r.marginPct, calc.targetPct)}>{pctText(r.marginPct)}</Badge>
              </Td>
              <Td num>{pctText(r.share)}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="How it's calculated">
        <div className="grid gap-3 md:grid-cols-3">
          <Formula title="Net" body="price ÷ (1 + GST) − price × gateway fee × (1 + fee GST)" />
          <Formula title="What the provider bills" body="granted credits × provider ₹ per 1M ÷ tau credits per 1M" />
          <Formula title="Credits per 1M needed" body="provider ₹ per 1M ÷ provider ₹ allowed per credit at the target margin. Round up, and leave room for FX and price changes." />
        </div>
      </Section>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-3 py-2.5">
      <div className="text-xs text-fg-2">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Formula({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line border-l-2 border-l-accent bg-surface p-4">
      <div className="text-xs font-medium text-fg">{title}</div>
      <p className="mt-1 font-mono text-xs leading-relaxed text-fg-2">{body}</p>
    </div>
  );
}
