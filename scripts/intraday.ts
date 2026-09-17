/**
 * Intraday feasibility screen.
 *
 *   npx tsx scripts/intraday.ts --file <mt5 M1 export> --point 0.01 --server-offset 3
 *
 * Reports, for every hour of the day, the broker's measured spread and the
 * directional hit rate a strategy would need just to break even against it at
 * several horizons.
 *
 * It measures no returns and proposes no strategy. Its output is a screen:
 * which (hour, horizon) cells are arithmetically closed, and which are merely
 * hard. See app/lib/domains/research/intraday.ts for why that is the useful
 * question and what the thresholds mean.
 */

import { readFileSync } from "node:fs";
import {
  breakEvenHitRate,
  classify,
  detectableEdge,
  hourlyProfile,
  independentSamples,
  parseMt5Export,
  requiredSamples,
  type Feasibility,
  type HourProfile,
} from "../app/lib/domains/research";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? null : process.argv[i + 1];
}

const MARK: Record<Feasibility, string> = {
  affordable: "ok  ",
  demanding: "hard",
  implausible: "no  ",
  impossible: "XXXX",
};

const HORIZONS = [1, 5, 15, 60];

function report(label: string, profile: HourProfile[]): void {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`${label} — required break-even hit rate by hour and horizon`);
  console.log("=".repeat(78));
  console.log(
    `\n${"UTC".padStart(4)} ${"bars".padStart(6)} ${"spr".padStart(7)} ${"miss".padStart(6)} |` +
      HORIZONS.map((h) => `${`${h}m`.padStart(9)}`).join("") +
      "  | verdict",
  );
  console.log("-".repeat(78));

  const tally: Record<Feasibility, number> = {
    affordable: 0,
    demanding: 0,
    implausible: 0,
    impossible: 0,
  };

  for (const hour of profile) {
    const cells = HORIZONS.map((h) => {
      const stat = hour.horizons.find((s) => s.horizon === h);
      if (!stat || stat.samples === 0) return { text: "     —   ", verdict: null };
      const required = breakEvenHitRate(hour.medianSpreadBps, stat.meanAbsMoveBps);
      const verdict = classify(required);
      tally[verdict] += 1;
      const shown = Number.isFinite(required) && required <= 9.99 ? `${(required * 100).toFixed(1)}%` : ">999%";
      return { text: shown.padStart(9), verdict };
    });

    const worstAtShortest = cells.find((c) => c.verdict !== null)?.verdict ?? "impossible";
    const flag = hour.missingSpreadShare > 0.4 ? " *" : "";

    console.log(
      `${String(hour.hour).padStart(4)} ${String(hour.bars).padStart(6)} ` +
        `${hour.medianSpreadBps.toFixed(3).padStart(7)} ` +
        `${`${(hour.missingSpreadShare * 100).toFixed(0)}%`.padStart(6)} |` +
        cells.map((c) => c.text).join("") +
        `  | ${MARK[worstAtShortest]}${flag}`,
    );
  }

  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  console.log(
    `\n  cells: ${tally.affordable} affordable, ${tally.demanding} demanding, ` +
      `${tally.implausible} implausible, ${tally.impossible} arithmetically impossible ` +
      `(of ${total})`,
  );
  const starred = profile.filter((h) => h.missingSpreadShare > 0.4).length;
  if (starred > 0) {
    console.log(
      `  * ${starred} hours are missing over 40% of their spread readings. Those medians\n` +
        `    describe the bars that reported, and the non-reporting bars are the WIDER\n` +
        `    ones — so those rows understate cost and flatter the screen.`,
    );
  }
}

/**
 * The companion question to the screen, and the one that decides whether a
 * hypothesis is worth writing: given the observations available in a window,
 * how large an edge could this data actually detect?
 *
 * Run second and reported second, but it can veto what the screen permits. A
 * window with affordable costs and too few observations cannot produce a
 * result — only a number.
 */
function power(profile: HourProfile[], windows: { label: string; hours: number[] }[]): void {
  console.log(`\n${"=".repeat(78)}`);
  console.log("Could this data detect an edge, where cost permits one to survive?");
  console.log("=".repeat(78));
  console.log(
    `\n${"window".padEnd(32)}${"horizon".padStart(8)}${"indep n".padStart(10)}` +
      `${"break-even".padStart(12)}${"detectable".padStart(12)}${"n for +2pt".padStart(12)}`,
  );
  console.log("-".repeat(78));

  for (const { label, hours } of windows) {
    for (const horizon of [15, 60]) {
      const rows = profile.filter((p) => hours.includes(p.hour));
      // Hours with no window of this length — the session edge — contribute no
      // observations and must not contribute a break-even rate either. Pooling
      // an Infinity through a weighted mean poisons the whole row.
      const usable = rows.filter((r) => {
        const stat = r.horizons.find((h) => h.horizon === horizon);
        return stat !== undefined && stat.samples > 0 && stat.meanAbsMoveBps > 0;
      });
      const barsIn = usable.reduce((sum, r) => sum + r.bars, 0);
      if (barsIn === 0) continue;

      const samples = independentSamples(barsIn, horizon);
      const breakEven =
        usable.reduce((sum, r) => {
          const stat = r.horizons.find((h) => h.horizon === horizon)!;
          return sum + breakEvenHitRate(r.medianSpreadBps, stat.meanAbsMoveBps) * r.bars;
        }, 0) / barsIn;

      const edge = detectableEdge(samples, breakEven);
      const needed = requiredSamples({ baseline: breakEven, target: breakEven + 0.02 });
      const verdict = samples >= needed ? "" : `   <- underpowered ${(needed / samples).toFixed(1)}x`;

      console.log(
        label.padEnd(32) +
          `${horizon}m`.padStart(8) +
          samples.toLocaleString().padStart(10) +
          `${(breakEven * 100).toFixed(2)}%`.padStart(12) +
          `+${(edge * 100).toFixed(2)}%`.padStart(12) +
          (Number.isFinite(needed) ? needed.toLocaleString() : "—").padStart(12) +
          verdict,
      );
    }
  }

  console.log(
    `\n  "detectable" is the smallest edge over break-even this many observations` +
      `\n  could distinguish from noise, one-sided at alpha .05 with 80% power.` +
      `\n  "n for +2pt" is what it would take to find a signal hitting two points` +
      `\n  above break-even — already better than either hypothesis tested here.` +
      `\n\n  Observations are NON-OVERLAPPING. A 15-minute horizon gets four per hour,` +
      `\n  not sixty; counting every bar would claim fifteen times the information.`,
  );
}

function main(): void {
  const file = arg("file");
  const point = Number(arg("point"));
  const offset = Number(arg("server-offset") ?? 0);

  if (!file || !Number.isFinite(point) || point <= 0) {
    console.error(
      "usage: npx tsx scripts/intraday.ts --file <export.csv> --point <size> [--server-offset <hours>]\n" +
        "  --point is the instrument's price increment: 0.01 for gold at two decimals,\n" +
        "  0.00001 for a 5-digit FX pair. It comes from the MT5 symbol specification.",
    );
    process.exit(1);
  }

  const result = parseMt5Export(readFileSync(file, "utf8"), { serverOffsetHours: offset });
  if (result.bars.length === 0) {
    console.error(`no bars parsed from ${file}`);
    process.exit(1);
  }

  const label = file.split("/").pop() ?? file;
  console.log(
    `\n${result.bars.length.toLocaleString()} bars, ` +
      `${result.bars[0].time.slice(0, 10)} -> ${result.bars[result.bars.length - 1].time.slice(0, 10)} UTC` +
      (result.spread ? `, spread reported on ${result.spread.samples.toLocaleString()} of them` : ""),
  );
  console.log(
    `\nREAD THIS AS A SCREEN, NOT A RESULT. A cell that clears it is not an edge —\n` +
      `it is an hour where an edge would not be immediately eaten. The two hypotheses\n` +
      `tested in this repo reached 48.3% and about a coin flip, so most cells marked\n` +
      `"ok" below would still fail. The cells marked XXXX are the useful output: there,\n` +
      `the spread exceeds the typical move and no signal of any quality can pay for it.`,
  );

  const profile = hourlyProfile(result.bars, point, HORIZONS);
  report(label, profile);

  // The cheapest contiguous three hours, and everything, so the trade-off
  // between affordable cost and adequate sample is visible in one place.
  const cheapest = [...profile]
    .filter((p) => p.medianSpreadBps > 0)
    .sort((a, b) => a.medianSpreadBps - b.medianSpreadBps)
    .slice(0, 3)
    .map((p) => p.hour)
    .sort((a, b) => a - b);

  power(profile, [
    { label: `cheapest hours (${cheapest.join(", ")} UTC)`, hours: cheapest },
    { label: "all hours pooled", hours: profile.map((p) => p.hour) },
  ]);
}

main();
