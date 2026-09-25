// Recomputes the paper's supplementary §V-A correlation from the raw per-run
// metrics in this bundle: for each of the 20 sealed Haiku runs, the number of
// exported handlers in its frozen snapshot vs. held-out obligations passed.
// Spearman's rho as the Pearson correlation of average ranks (ties share the
// mean of their ranks). Writes handler-table.csv next to this file.
//
//   node evidence/compute-handler-correlation.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runsDir = join(here, 'runs', 'sealed-haiku');

const rows = readdirSync(runsDir)
  .sort()
  .map((rep) => {
    const m = JSON.parse(readFileSync(join(runsDir, rep, 'review-metrics.json'), 'utf-8'));
    return {
      rep,
      arm: m.arm,
      handlers: m.snapshotCounts.exportedHandlers,
      heldOutPassed: m.heldOutObligationsPassed,
      heldOutTotal: m.heldOutObligationsTotal,
      visible: `${m.visiblePass}/${m.visibleTotal}`,
      batchIntervals: m.batchIntervalCount,
    };
  });

function averageRanks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = rank;
    i = j + 1;
  }
  return ranks;
}

function pearson(x, y) {
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

const rho = pearson(averageRanks(rows.map((r) => r.handlers)), averageRanks(rows.map((r) => r.heldOutPassed)));

const header = 'rep,arm,exported_handlers,heldout_passed,heldout_total,visible,batch_intervals';
const lines = rows.map((r) => [r.rep, r.arm, r.handlers, r.heldOutPassed, r.heldOutTotal, r.visible, r.batchIntervals].join(','));
writeFileSync(join(here, 'handler-table.csv'), [header, ...lines].join('\n') + '\n');

console.log(`${rows.length} runs`);
console.log(`Spearman rho (average ranks) = ${rho.toFixed(10)}`);
