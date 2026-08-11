import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/db";
import { computeJournalStats } from "@/app/lib/domains/journal/stats";
import { MIN_TRADES_FOR_INSIGHT } from "@/app/lib/domains/journal/insights";
import { createTradeAction, deleteTradeAction, generateInsightAction } from "./actions";

export default async function StudentJournalPage() {
  // redirect() must be called directly in this component's body, not via an
  // awaited cross-module helper — see SECURITY.md "Known Next.js 16 redirect
  // quirk".
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const [trades, insights] = await Promise.all([
    prisma.journalTrade.findMany({ where: { studentId: session.sub }, orderBy: { tradedAt: "desc" } }),
    prisma.aiInsight.findMany({
      where: { studentId: session.sub },
      include: { _count: { select: { trades: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const stats = computeJournalStats(trades);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-neutral-50">Trading Journal</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Your own trade log — private to you. AI-generated pattern observations (below) are kept
        separate from your own notes and never overwrite them.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Trades</p>
          <p className="mt-1 text-lg font-semibold text-neutral-50">{stats.totalTrades}</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Win rate</p>
          <p className="mt-1 text-lg font-semibold text-neutral-50">
            {stats.winRatePct != null ? `${stats.winRatePct.toFixed(0)}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Avg R</p>
          <p className="mt-1 text-lg font-semibold text-neutral-50">
            {stats.avgRMultiple != null ? stats.avgRMultiple.toFixed(2) : "—"}
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">AI Insights</h2>
      {insights.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No insights yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {insights.map((i) => (
            <li key={i.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <p className="text-sm text-neutral-200">{i.summary}</p>
              <p className="mt-1 text-xs text-neutral-500">
                Based on {i._count.trades} trade{i._count.trades === 1 ? "" : "s"} · {i.createdAt.toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form action={generateInsightAction} className="mt-2">
        <button
          type="submit"
          disabled={stats.totalTrades < MIN_TRADES_FOR_INSIGHT}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Generate insight
        </button>
        {stats.totalTrades < MIN_TRADES_FOR_INSIGHT && (
          <span className="ml-2 text-xs text-neutral-600">
            Needs at least {MIN_TRADES_FOR_INSIGHT} trades ({stats.totalTrades} so far)
          </span>
        )}
      </form>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Trades</h2>
      {trades.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No trades logged yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {trades.map((t) => (
            <li key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-100">
                  {t.symbol} · {t.direction}
                  {t.result && (
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        t.result === "win"
                          ? "bg-emerald-900 text-emerald-300"
                          : t.result === "loss"
                            ? "bg-red-900 text-red-300"
                            : "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {t.result}
                    </span>
                  )}
                </span>
                <form action={deleteTradeAction}>
                  <input type="hidden" name="tradeId" value={t.id} />
                  <button type="submit" className="text-xs text-red-400 hover:text-red-300">
                    Delete
                  </button>
                </form>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {t.tradedAt.toLocaleDateString()}
                {t.rMultiple != null ? ` · ${t.rMultiple}R` : ""}
                {t.setupTag ? ` · ${t.setupTag}` : ""}
                {t.mistakeTag ? ` · mistake: ${t.mistakeTag}` : ""}
              </p>
              {t.notes && <p className="mt-1 text-sm text-neutral-300">{t.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Log a trade</h2>
      <form action={createTradeAction} className="mt-2 space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid grid-cols-2 gap-2">
          <input
            name="symbol"
            required
            placeholder="Symbol (e.g. XAUUSD)"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          <select
            name="direction"
            required
            defaultValue=""
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          >
            <option value="" disabled>
              Direction
            </option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <input
          name="tradedAt"
          type="date"
          required
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        <div className="grid grid-cols-3 gap-2">
          <select
            name="result"
            defaultValue=""
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          >
            <option value="">Result</option>
            <option value="win">Win</option>
            <option value="loss">Loss</option>
            <option value="breakeven">Breakeven</option>
          </select>
          <input
            name="rMultiple"
            type="number"
            step="0.1"
            placeholder="R multiple"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          <input
            name="setupTag"
            placeholder="Setup tag"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
        </div>
        <input
          name="mistakeTag"
          placeholder="Mistake tag (optional)"
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        <textarea
          name="notes"
          rows={3}
          placeholder="Notes — reasoning, emotional state, lessons learned..."
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
        >
          Add trade
        </button>
      </form>
    </div>
  );
}
