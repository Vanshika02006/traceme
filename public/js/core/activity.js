// Temporal fingerprinting: public activity timestamps reveal a daily rhythm,
// and the longest quiet stretch (sleep) gives away an approximate timezone.

export function analyzeActivity(timestamps) {
  const dates = timestamps.map((t) => new Date(t)).filter((d) => !Number.isNaN(d.getTime()));
  const histogram = new Array(24).fill(0);
  let weekend = 0;
  dates.forEach((d) => {
    histogram[d.getUTCHours()]++;
    if ([0, 6].includes(d.getUTCDay())) weekend++;
  });
  const result = { events: dates.length, histogramUtc: histogram, weekendShare: dates.length ? weekend / dates.length : 0 };
  if (dates.length < 15) return { ...result, inferred: null };

  // Quietest 6-hour circular window ~ sleep.
  const W = 6;
  let best = Infinity, bestStart = 0;
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let k = 0; k < W; k++) sum += histogram[(s + k) % 24];
    if (sum < best) { best = sum; bestStart = s; }
  }
  const quietMidUtc = (bestStart + W / 2) % 24;
  // People typically sleep around 01:00–07:00 local, midpoint ≈ 04:00.
  let offset = 4 - quietMidUtc;
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  const peakUtc = histogram.indexOf(Math.max(...histogram));
  const fmt = (o) => `UTC${o >= 0 ? '+' : '−'}${Math.abs(o)}`;
  return {
    ...result,
    inferred: {
      utcOffset: offset,
      label: `${fmt(offset - 2)} to ${fmt(offset + 2)}`,
      quietWindowUtc: [bestStart, (bestStart + W) % 24],
      peakHourUtc: peakUtc,
      quietShare: best / dates.length,
    },
  };
}
