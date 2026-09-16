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
  hourlyProfile,
  parseMt5Export,
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

  report(label, hourlyProfile(result.bars, point, HORIZONS));
}

main();
