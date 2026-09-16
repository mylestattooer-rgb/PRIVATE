#!/usr/bin/env tsx
/**
 * Import a MetaTrader 5 history export.
 *
 *   npm run import-mt5 -- --file XAUUSD_Daily.csv --symbol XAUUSD
 *   npm run import-mt5 -- --file EURUSD_D1.csv --symbol EURUSD --server-offset 2 --point 0.00001
 *
 * Writes data/<SYMBOL>_1d.csv in the same shape as the vendor data, so the
 * research and evidence runners pick it up with no other change.
 *
 * The reason to prefer this over vendor data is the <SPREAD> column: it is the
 * operator's own broker's measured cost, which every study so far has had to
 * assume. Prices are the broker's own too, so a backtest runs against quotes
 * that would actually have been available.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseMt5Export, spreadPointsToBps } from "../app/lib/domains/research";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function main(): void {
  const file = arg("file");
  const symbol = arg("symbol");
  if (!file || !symbol) {
    console.error(
      "Usage: npm run import-mt5 -- --file <export.csv> --symbol <SYMBOL> [--server-offset <hours>] [--point <size>]\n\n" +
        "In MT5: View -> Symbols -> pick the symbol -> Bars tab -> Export,\n" +
        "or right-click a chart -> Save As. Daily (D1) bars, as far back as it offers.",
    );
    process.exit(1);
  }

  const serverOffsetHours = Number(arg("server-offset") ?? 0);
  const pointSize = arg("point") === null ? null : Number(arg("point"));

  const result = parseMt5Export(readFileSync(file, "utf8"), { serverOffsetHours });

  console.log(`\n  ${symbol} — ${file}`);
  console.log(`  columns: ${result.columns.join(", ")}`);
  console.log(`  ${result.bars.length} bars accepted, ${result.rejected.length} rejected`);

  if (result.bars.length === 0) {
    console.error("  nothing to import");
    process.exit(1);
  }

  for (const r of result.rejected.slice(0, 10)) console.log(`    line ${r.line}: ${r.reason}`);
  if (result.rejected.length > 10) console.log(`    ... and ${result.rejected.length - 10} more`);

  console.log(`  range: ${result.bars[0].time.slice(0, 10)} -> ${result.bars[result.bars.length - 1].time.slice(0, 10)}`);

  // A daily bar is a trading DAY, not a timestamp. Shifting it by a server
  // offset moves the date label backwards and silently misaligns this series
  // against every other daily series. The offset is for intraday data.
  const looksDaily = result.bars.length > 1 &&
    Date.parse(result.bars[1].time) - Date.parse(result.bars[0].time) >= 20 * 3_600_000;
  if (looksDaily && serverOffsetHours !== 0) {
    console.log(
      `\n  WARNING: these look like daily bars and --server-offset ${serverOffsetHours} shifted\n` +
        `  every date label backwards. A daily bar is a trading day, not a timestamp —\n` +
        `  re-run without --server-offset unless you know you want this.`,
    );
  }

  if (result.spread) {
    const s = result.spread;
    console.log(`\n  MEASURED SPREAD (points, from the broker's own export)`);
    console.log(`    median ${s.medianPoints}   mean ${s.meanPoints.toFixed(1)}   p95 ${s.p95Points}   max ${s.maxPoints}`);
    if (pointSize !== null && Number.isFinite(pointSize)) {
      const lastPrice = result.bars[result.bars.length - 1].close;
      console.log(
        `    at a point size of ${pointSize} and a price of ${lastPrice}:\n` +
          `      median ${spreadPointsToBps(s.medianPoints, pointSize, lastPrice).toFixed(3)} bps   ` +
          `p95 ${spreadPointsToBps(s.p95Points, pointSize, lastPrice).toFixed(3)} bps`,
      );
      console.log(`\n    Use the MEDIAN as the half-spread in the cost models, not the mean —`);
      console.log(`    spread distributions have a long tail and the mean reports a cost`);
      console.log(`    you rarely actually pay.`);
    } else {
      console.log(`    pass --point <size> (0.00001 for 5-digit FX, 0.01 for gold) to convert to bps`);
    }
  } else {
    console.log(`\n  No <SPREAD> column in this export — re-export from the Symbols window if possible,`);
    console.log(`  since that column is the most valuable part of the file.`);
  }

  const out = `data/${symbol}_1d.csv`;
  const lines = ["date,open,high,low,close,volume"];
  for (const b of result.bars) {
    lines.push(`${b.time.slice(0, 10)},${b.open},${b.high},${b.low},${b.close},${b.volume}`);
  }
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`\n  wrote ${out}\n`);
}

main();
