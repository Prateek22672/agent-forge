import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";

// Live performance console: how the models are ACTUALLY doing, right now.
//
// The design rule here is that nothing on screen is a number you then have to
// interpret. The verdict line says whether we are healthy in words; the
// suggestions say what to do about it; and every table sorts so the thing
// most worth looking at is already at the top. Numbers alone are what the old
// panel had, and nobody reads them.
//
// It refreshes on a timer and keeps a short client-side history of each KPI so
// the sparklines show movement — the server only ever returns a snapshot, and
// a flat number tells you nothing about whether it is getting worse.

const WINDOWS = [
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "6h", value: 360 },
  { label: "24h", value: 1440 },
];
const HISTORY = 30; // samples kept per KPI for the sparklines

const LEVEL = {
  critical: { dot: "bg-red-400", ring: "ring-red-400/30", text: "text-red-300" },
  warn: { dot: "bg-amber-400", ring: "ring-amber-400/30", text: "text-amber-300" },
  good: { dot: "bg-emerald-400", ring: "ring-emerald-400/25", text: "text-emerald-300" },
  info: { dot: "bg-sky-400", ring: "ring-sky-400/25", text: "text-sky-300" },
};

const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v || 0)}ms`);
const ago = (t) => {
  if (!t) return "—";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export default function MetricsDashboard() {
  const [data, setData] = useState(null);
  const [win, setWin] = useState(60);
  const [err, setErr] = useState("");
  const [pulse, setPulse] = useState(false);
  const history = useRef({});

  const load = async () => {
    try {
      const d = await api.adminMetrics(win);
      setData(d);
      setErr("");
      setPulse(true);
      setTimeout(() => setPulse(false), 700);
      const t = d.totals || {};
      const push = (k, v) => {
        const arr = history.current[k] || (history.current[k] = []);
        arr.push(Number(v) || 0);
        if (arr.length > HISTORY) arr.shift();
      };
      push("calls", t.calls);
      push("ok", t.ok_rate);
      push("p50", t.p50_ms);
      push("p95", t.p95_ms);
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  if (err) return <div className="text-red-300 text-sm">{err}</div>;
  if (!data) return <Skeleton />;

  const t = data.totals || {};
  const cfg = data.config || {};
  const suggestions = data.suggestions || [];
  const worst = suggestions.find((s) => s.level === "critical") || suggestions.find((s) => s.level === "warn");
  const verdict = worst || suggestions[0] || { level: "good", title: "Healthy", detail: "" };
  const tone = LEVEL[verdict.level] || LEVEL.info;

  return (
    <div className="space-y-5 animate-[af-rise_.35s_cubic-bezier(.2,.8,.3,1)]">
      {/* verdict + controls */}
      <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 ring-1 ${tone.ring}`}>
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${tone.dot} ${verdict.level !== "good" ? "animate-pulse" : ""}`} />
          <div className="min-w-0 flex-1">
            <div className={`text-[15px] font-semibold ${tone.text}`}>{verdict.title}</div>
            {verdict.detail && <div className="mt-0.5 text-[12.5px] leading-relaxed text-white/55">{verdict.detail}</div>}
          </div>
          <div className="flex flex-none items-center gap-1.5">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWin(w.value)}
                className={`rounded-lg px-2.5 py-1 text-[11.5px] transition ${
                  win === w.value ? "bg-white text-black" : "bg-white/[0.06] text-white/60 hover:text-white"
                }`}
              >
                {w.label}
              </button>
            ))}
            <span
              className={`ml-1 h-1.5 w-1.5 rounded-full transition-opacity duration-500 ${
                pulse ? "bg-emerald-400 opacity-100" : "bg-white/25 opacity-60"
              }`}
              title="Live — refreshes every 10s"
            />
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Calls" value={t.calls ?? 0} series={history.current.calls} />
        <Kpi
          label="Success"
          value={`${(t.ok_rate ?? 100).toFixed(1)}%`}
          series={history.current.ok}
          bad={(t.ok_rate ?? 100) < 97}
        />
        <Kpi label="p50" value={ms(t.p50_ms)} series={history.current.p50} />
        <Kpi label="p95" value={ms(t.p95_ms)} series={history.current.p95} bad={(t.p95_ms || 0) > 3000} />
        <Kpi label="Cache hits" value={`${(t.cache_hit_rate ?? 0).toFixed(0)}%`} />
        <Kpi label="Client errors" value={t.client_errors ?? 0} bad={(t.client_errors || 0) > 0} />
      </div>

      {/* what to do about it */}
      {suggestions.length > 0 && (
        <Section title="What to do" sub="Derived from the window above — rules, not guesses.">
          <div className="space-y-2">
            {suggestions.map((s, i) => {
              const l = LEVEL[s.level] || LEVEL.info;
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3 transition hover:bg-white/[0.05]"
                  style={{ animation: `af-rise .3s cubic-bezier(.2,.8,.3,1) ${i * 40}ms both` }}
                >
                  <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${l.dot}`} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{s.title}</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-white/50">{s.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="By feature" sub="Which part of the product is slow or failing.">
          <Table
            rows={data.by_feature}
            slowest={Math.max(1, ...(data.by_feature || []).map((r) => r.p95_ms || 0))}
          />
        </Section>
        <Section title="By model" sub="Live calls only — cache hits would flatter the numbers.">
          <Table
            rows={data.by_model}
            slowest={Math.max(1, ...(data.by_model || []).map((r) => r.p95_ms || 0))}
          />
        </Section>
      </div>

      <Section title="Key health" sub="Per key, over the whole life of this instance — a pool hides a bad key well.">
        {(data.keys || []).length === 0 ? (
          <Empty>No key has served a call yet.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/8">
            <table className="w-full text-[12px]">
              <thead className="bg-white/[0.04] text-white/45">
                <tr>
                  <Th>Key</Th>
                  <Th right>Calls</Th>
                  <Th right>Failures</Th>
                  <Th right>Rate limited</Th>
                  <Th>Last seen</Th>
                  <Th>Last error</Th>
                </tr>
              </thead>
              <tbody>
                {data.keys.map((k) => (
                  <tr key={k.suffix} className="border-t border-white/[0.06] transition hover:bg-white/[0.03]">
                    <Td>
                      <span className="font-mono">…{k.suffix}</span>
                    </Td>
                    <Td right>{k.calls}</Td>
                    <Td right>
                      <span className={k.failure_rate > 25 ? "text-red-300" : k.failure_rate > 5 ? "text-amber-300" : "text-white/70"}>
                        {k.failures} ({k.failure_rate}%)
                      </span>
                    </Td>
                    <Td right>
                      <span className={k.rate_limited >= 5 ? "text-amber-300" : "text-white/50"}>{k.rate_limited}</span>
                    </Td>
                    <Td>{ago(k.last_seen)}</Td>
                    <Td>
                      <span className="block max-w-[280px] truncate text-white/45" title={k.last_error}>
                        {k.last_error || "—"}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Top errors" sub="Server side, within the window.">
          {(data.top_errors || []).length === 0 ? (
            <Empty>No failures in this window.</Empty>
          ) : (
            <div className="space-y-1.5">
              {data.top_errors.map((e, i) => (
                <div key={i} className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-wide text-white/40">{e.kind}</span>
                    <span className="text-[11px] text-white/40">
                      {e.count}× · {ago(e.last)}
                    </span>
                  </div>
                  <div className="mt-1 break-words text-[12px] text-red-300/90">{e.message}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Reported by the extension"
          sub="Failures the server never sees: timeouts, evicted workers, blocked requests."
        >
          {(data.client_errors || []).length === 0 ? (
            <Empty>Nothing reported from any browser.</Empty>
          ) : (
            <div className="space-y-1.5">
              {data.client_errors.slice(0, 12).map((c, i) => (
                <div key={i} className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-wide text-white/40">
                      {c.kind} {c.version && `· v${c.version}`}
                    </span>
                    <span className="text-[11px] text-white/40">{ago(c.t)}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-white/70">{c.message || c.path}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* what produced these numbers */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[11.5px] text-white/45">
        <Chip label="fast" value={cfg.fast_model} />
        <Chip label="vision" value={cfg.vision_model} />
        <Chip label="agent" value={cfg.agent_model} />
        <Chip label="keys" value={`${cfg.groq_keys ?? 0} groq · ${cfg.gemini_keys ?? 0} gemini`} />
        <Chip label="cached answers" value={cfg.cache_entries ?? 0} />
        <button
          onClick={async () => {
            await api.adminResetMetrics().catch(() => {});
            history.current = {};
            load();
          }}
          className="ml-auto rounded-lg border border-white/10 px-3 py-1 text-white/60 transition hover:bg-white/10 hover:text-white"
          title="Clear the rolling window — useful right after a fix, to see whether it held"
        >
          Reset window
        </button>
      </div>
    </div>
  );
}

function Section({ title, sub, children }) {
  return (
    <div>
      <div className="mb-2">
        <div className="text-[13px] font-semibold">{title}</div>
        {sub && <div className="text-[11.5px] text-white/40">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, series, bad }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:bg-white/[0.06]">
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 text-[19px] font-semibold tabular-nums ${bad ? "text-amber-300" : ""}`}>{value}</div>
      <Spark values={series} bad={bad} />
    </div>
  );
}

// A sparkline drawn from the samples this session has collected — the API only
// returns a snapshot, and the useful question is "is it getting worse".
function Spark({ values, bad }) {
  if (!values || values.length < 2) return <div className="h-5" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${20 - ((v - min) / span) * 18}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="mt-1 h-5 w-full">
      <polyline
        points={pts}
        fill="none"
        stroke={bad ? "rgb(252 211 77)" : "rgb(255 255 255)"}
        strokeOpacity="0.5"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Table({ rows, slowest }) {
  if (!rows || rows.length === 0) return <Empty>Nothing recorded in this window.</Empty>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.name} className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5 transition hover:bg-white/[0.05]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-mono text-[12px]">{r.name}</span>
            <span className="flex-none text-[11.5px] tabular-nums text-white/50">
              {r.calls} calls · {r.ok_rate}% ok
            </span>
          </div>
          {/* latency bar, scaled against the slowest row so the outlier is obvious */}
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                r.p95_ms > 3000 ? "bg-amber-400/70" : "bg-white/45"
              }`}
              style={{ width: `${Math.max(2, Math.min(100, (r.p95_ms / slowest) * 100))}%` }}
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-white/40">
            <span>p50 {ms(r.p50_ms)}</span>
            <span>p95 {ms(r.p95_ms)}</span>
            {r.cached_rate > 0 && <span>{r.cached_rate}% cached</span>}
            {r.fallback_rate > 0 && <span className="text-amber-300/80">{r.fallback_rate}% fell back</span>}
            {r.failures > 0 && <span className="text-red-300/80">{r.failures} failed</span>}
          </div>
          {r.last_error && (
            <div className="mt-1 truncate text-[11px] text-red-300/70" title={r.last_error}>
              {r.last_error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const Th = ({ children, right }) => (
  <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
);
const Td = ({ children, right }) => (
  <td className={`px-3 py-2 ${right ? "text-right tabular-nums" : ""}`}>{children}</td>
);
const Empty = ({ children }) => (
  <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[12px] text-white/35">{children}</div>
);
const Chip = ({ label, value }) => (
  <span className="flex items-center gap-1.5">
    <span className="text-white/30">{label}</span>
    <span className="font-mono text-white/70">{value || "—"}</span>
  </span>
);

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-white/[0.03]" />
    </div>
  );
}
