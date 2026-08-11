// Pure journal statistics — no DB access. Every number here is a plain
// aggregation over trades the caller already fetched, never an AI guess
// (AI_ARCHITECTURE.md's determinism boundary: AI may interpret these numbers,
// never compute them).

export type StatTrade = {
  result: string | null;
  rMultiple: number | null;
  setupTag: string | null;
  mistakeTag: string | null;
};

export type JournalStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePct: number | null; // null when there are no decided (win/loss) trades
  avgRMultiple: number | null;
  bestSetupTag: { tag: string; avgR: number } | null;
  worstSetupTag: { tag: string; avgR: number } | null;
  mostCommonMistakeTag: { tag: string; count: number } | null;
};

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function computeJournalStats(trades: StatTrade[]): JournalStats {
  const wins = trades.filter((t) => t.result === "win").length;
  const losses = trades.filter((t) => t.result === "loss").length;
  const breakeven = trades.filter((t) => t.result === "breakeven").length;
  const decided = wins + losses;

  const rMultiples = trades.map((t) => t.rMultiple).filter((r): r is number => r != null);

  const bySetup = new Map<string, number[]>();
  for (const t of trades) {
    if (!t.setupTag || t.rMultiple == null) continue;
    if (!bySetup.has(t.setupTag)) bySetup.set(t.setupTag, []);
    bySetup.get(t.setupTag)!.push(t.rMultiple);
  }
  const setupAverages = Array.from(bySetup.entries())
    .map(([tag, rs]) => ({ tag, avgR: average(rs)! }))
    .sort((a, b) => b.avgR - a.avgR);

  const mistakeCounts = new Map<string, number>();
  for (const t of trades) {
    if (!t.mistakeTag) continue;
    mistakeCounts.set(t.mistakeTag, (mistakeCounts.get(t.mistakeTag) ?? 0) + 1);
  }
  const mostCommonMistake = Array.from(mistakeCounts.entries()).sort((a, b) => b[1] - a[1])[0];

  return {
    totalTrades: trades.length,
    wins,
    losses,
    breakeven,
    winRatePct: decided > 0 ? (wins / decided) * 100 : null,
    avgRMultiple: average(rMultiples),
    bestSetupTag: setupAverages[0] ?? null,
    worstSetupTag: setupAverages.length > 1 ? setupAverages[setupAverages.length - 1] : null,
    mostCommonMistakeTag: mostCommonMistake ? { tag: mostCommonMistake[0], count: mostCommonMistake[1] } : null,
  };
}
