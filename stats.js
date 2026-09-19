// stats.js
// All aggregation functions. Take the raw log array (change_log.json entries)
// and return structured stat objects ready to serve as JSON.

import { normalizeCharge, normalizeRace, normalizeSex, getChargeSeverity, getCrimeType, resolveEffectiveCategory, MASKING_CATEGORIES } from './chargeMap.js';
import { normalizeReleaseReason } from './releaseReasonMap.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function topN(countMap, n = 10) {
  return Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function countBy(arr, keyFn) {
  const map = {};
  arr.forEach(item => {
    const k = keyFn(item) || 'Unknown';
    map[k] = (map[k] || 0) + 1;
  });
  return map;
}

function stayDays(entry) {
  if (!entry.releasedAt) return null;
  // Use the actual booking date from the roster, not firstSeen (scraper arrival time).
  // bookingDate is MM/DD/YYYY; releasedAt is the scraper-observed release timestamp.
  const start = entry.bookingDate
    ? new Date(entry.bookingDate)   // "08/13/2025" — JS parses MM/DD/YYYY fine
    : new Date(entry.firstSeen);
  const end = new Date(entry.releasedAt);
  if (isNaN(start) || isNaN(end) || end < start) return null;
  return (end - start) / (1000 * 60 * 60 * 24);
}

// Height stored as FII integer (510 = 5'10", 603 = 6'3").
// Must convert to inches for arithmetic, then back for display.
function heightToInches(h) {
  const n = parseInt(h, 10);
  if (!n || isNaN(n)) return null;
  const feet = Math.floor(n / 100);
  const inches = n % 100;
  if (feet < 4 || feet > 7 || inches > 11) return null;
  return feet * 12 + inches;
}

function inchesToDisplay(totalInches) {
  const f = Math.floor(totalInches / 12);
  const i = Math.round(totalInches % 12);
  return `${f}'${i}"`;
}

// ─── Basic Stats ──────────────────────────────────────────────────────────────

/**
 * Total bookings, status breakdown, and simple demographic counts.
 */
export function getBookingCounts(log) {
  const total = log.length;
  const inCustody = log.filter(e => e.status === 'in_custody').length;
  const released = log.filter(e => e.status === 'released').length;

  return { total, inCustody, released };
}

/**
 * Bookings grouped by gender.
 */
export function getGenderBreakdown(log) {
  const counts = countBy(log, e => normalizeSex(e.sex));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: +((count / log.length) * 100).toFixed(1) }));
}

/**
 * Bookings grouped by race.
 */
export function getRaceBreakdown(log) {
  const counts = countBy(log, e => normalizeRace(e.race));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: +((count / log.length) * 100).toFixed(1) }));
}

/**
 * Age distribution: mean, median, min, max, and histogram buckets.
 */
export function getAgeStats(log) {
  const ages = log
    .map(e => parseInt(e.age))
    .filter(a => !isNaN(a) && a > 0 && a < 120);

  if (!ages.length) return null;

  const buckets = {
    '18–25': 0,
    '26–35': 0,
    '36–45': 0,
    '46–55': 0,
    '56–65': 0,
    '65+':   0,
  };
  ages.forEach(a => {
    if (a <= 25)      buckets['18–25']++;
    else if (a <= 35) buckets['26–35']++;
    else if (a <= 45) buckets['36–45']++;
    else if (a <= 55) buckets['46–55']++;
    else if (a <= 65) buckets['56–65']++;
    else              buckets['65+']++;
  });

  return {
    mean: +mean(ages).toFixed(1),
    median: median(ages),
    min: Math.min(...ages),
    max: Math.max(...ages),
    histogram: Object.entries(buckets).map(([label, count]) => ({ label, count })),
  };
}

/**
 * Top charge categories by booking count (a booking can contribute multiple charges).
 * FTA/warrant/probation charges are resolved to the underlying offense named in
 * "Add. Desc." — otherwise they'd inflate a generic "Failure to Appear" bucket
 * and hide what people were actually charged with.
 * Returns top N categories.
 */
export function getTopCharges(log, n = 15) {
  const counts = {};
  log.forEach(entry => {
    const seen = new Set(); // dedupe per booking so one booking = one count per category
    (entry.charges || []).forEach(c => {
      const cat = resolveEffectiveCategory(c.violation, c.addDesc);
      if (!seen.has(cat)) {
        counts[cat] = (counts[cat] || 0) + 1;
        seen.add(cat);
      }
    });
  });
  return topN(counts, n);
}

/**
 * Top arresting agencies.
 */
export function getTopAgencies(log, n = 10) {
  const counts = {};
  log.forEach(entry => {
    (entry.charges || []).forEach(c => {
      if (c.arrestAgency) {
        const agency = c.arrestAgency.trim();
        counts[agency] = (counts[agency] || 0) + 1;
      }
    });
  });
  return topN(counts, n);
}

/**
 * Bail / bond amount statistics.
 * Returns null if no data available.
 */
export function getBailStats(log) {
  const amounts = [];
  log.forEach(entry => {
    (entry.charges || []).forEach(c => {
      // bondAmount/cashAmount stored as numbers by the scraper
      if (c.bondAmount > 0) amounts.push(c.bondAmount);
      if (c.cashAmount > 0) amounts.push(c.cashAmount);
    });
  });

  if (!amounts.length) return null;

  return {
    mean: +mean(amounts).toFixed(2),
    median: +median(amounts).toFixed(2),
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    count: amounts.length,
  };
}

/**
 * Length-of-stay statistics (days), for released bookings only.
 */
export function getStayStats(log) {
  const stays = log
    .filter(e => e.status === 'released')
    .map(stayDays)
    .filter(d => d !== null);

  if (!stays.length) return null;

  // Histogram buckets
  const buckets = {
    '< 1 day':    0,
    '1–3 days':   0,
    '4–7 days':   0,
    '1–2 weeks':  0,
    '2–4 weeks':  0,
    '1–3 months': 0,
    '3+ months':  0,
  };
  stays.forEach(d => {
    if (d < 1)        buckets['< 1 day']++;
    else if (d <= 3)  buckets['1–3 days']++;
    else if (d <= 7)  buckets['4–7 days']++;
    else if (d <= 14) buckets['1–2 weeks']++;
    else if (d <= 30) buckets['2–4 weeks']++;
    else if (d <= 90) buckets['1–3 months']++;
    else              buckets['3+ months']++;
  });

  return {
    mean: +mean(stays).toFixed(1),
    median: +median(stays).toFixed(1),
    min: +Math.min(...stays).toFixed(1),
    max: +Math.max(...stays).toFixed(1),
    count: stays.length,
    histogram: Object.entries(buckets).map(([label, count]) => ({ label, count })),
  };
}

// ─── Deep Stats ───────────────────────────────────────────────────────────────

/**
 * Median bail amount by charge category.
 * Returns array of { category, medianBail, count } sorted by medianBail desc.
 */
export function getBailByCharge(log) {
  const byCategory = {};
  log.forEach(entry => {
    (entry.charges || []).forEach(c => {
      const cat = resolveEffectiveCategory(c.violation, c.addDesc);
      const b = (c.bondAmount > 0 ? c.bondAmount : null) || (c.cashAmount > 0 ? c.cashAmount : null);
      if (b) {
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(b);
      }
    });
  });

  return Object.entries(byCategory)
    .map(([category, amounts]) => ({
      category,
      medianBail: +median(amounts).toFixed(2),
      meanBail: +mean(amounts).toFixed(2),
      count: amounts.length,
    }))
    .sort((a, b) => b.medianBail - a.medianBail);
}

/**
 * Charge category breakdown by race.
 * Returns { race: { category: count } } — useful for grouped bar charts.
 */
export function getChargesByRace(log) {
  const result = {};
  log.forEach(entry => {
    const race = normalizeRace(entry.race);
    if (!result[race]) result[race] = {};
    const seen = new Set();
    (entry.charges || []).forEach(c => {
      const cat = resolveEffectiveCategory(c.violation, c.addDesc);
      if (!seen.has(cat)) {
        result[race][cat] = (result[race][cat] || 0) + 1;
        seen.add(cat);
      }
    });
  });
  return result;
}

/**
 * Charge category breakdown by sex.
 */
export function getChargesBySex(log) {
  const result = {};
  log.forEach(entry => {
    const sex = normalizeSex(entry.sex);
    if (!result[sex]) result[sex] = {};
    const seen = new Set();
    (entry.charges || []).forEach(c => {
      const cat = resolveEffectiveCategory(c.violation, c.addDesc);
      if (!seen.has(cat)) {
        result[sex][cat] = (result[sex][cat] || 0) + 1;
        seen.add(cat);
      }
    });
  });
  return result;
}

/**
 * Release reason breakdown for all released bookings.
 */
export function getReleaseReasonBreakdown(log) {
  const released = log.filter(e => e.status === 'released');
  const counts = countBy(released, e => normalizeReleaseReason(e));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

/**
 * Recidivism: individuals booked more than once (matched by normalized name).
 * Returns { rate, repeatBookers: [{ name, count, bookings }] }
 */
export function getRecidivism(log) {
  const byName = {};
  log.forEach(entry => {
    const name = (entry.name || '').trim().toUpperCase();
    if (!name) return;
    if (!byName[name]) byName[name] = [];
    byName[name].push({
      bookingNumber: entry.bookingNumber,
      firstSeen: entry.firstSeen,
      status: entry.status,
    });
  });

  const repeats = Object.entries(byName)
    .filter(([, bookings]) => {
      // Only count as recidivism if there are multiple distinct booking numbers
      const uniqueBns = new Set(bookings.map(b => b.bookingNumber));
      return uniqueBns.size > 1;
    })
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, bookings]) => ({ name, count: bookings.length, bookings }));

  const totalIndividuals = Object.keys(byName).length;
  const rate = totalIndividuals > 0
    ? +((repeats.length / totalIndividuals) * 100).toFixed(1)
    : 0;

  return { rate, repeatBookerCount: repeats.length, totalIndividuals, repeatBookers: repeats.slice(0, 20) };
}

/**
 * Bookings over time, grouped by month (YYYY-MM).
 */
export function getBookingsByMonth(log) {
  const counts = {};
  log.forEach(entry => {
    if (!entry.firstSeen) return;
    const d = new Date(entry.firstSeen);
    if (isNaN(d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, count]) => ({ month, count }));
}

// ─── Deep Stats ++ ─────────────────────────────────────────────────────────────

/** Normalize raw arrest agency strings to known department names. */
function normalizeAgency(raw) {
  if (!raw) return 'Unknown';
  const r = raw.toUpperCase().replace(/[.,]/g, '').trim();
  if (/SUQUAMISH/.test(r)) return 'Suquamish Tribal Police';
  if (/POULSBO/.test(r)) return 'Poulsbo PD';
  if (/GIG HARBOR/.test(r)) return 'Gig Harbor PD';
  if (/PORT ORCHARD/.test(r)) return 'Port Orchard PD';
  if (/BREMERTON/.test(r)) return 'Bremerton PD';
  if (/KITSAP/.test(r)) return 'Kitsap County Sheriff';
  if (/DEPARTMENT OF CORRECTIONS|^DOC$/.test(r)) return 'DOC';
  return raw.trim();
}

/**
 * Broad crime-type breakdown (Violent, Property, Drug, etc.) with percentages.
 * Deduped per booking so a DV+Assault booking counts once under Violent.
 */
export function getCrimeTypeBreakdown(log) {
  const counts = {};
  let total = 0;
  log.forEach(entry => {
    const seen = new Set();
    (entry.charges || []).forEach(c => {
      const type = getCrimeType(resolveEffectiveCategory(c.violation, c.addDesc));
      if (!seen.has(type)) { counts[type] = (counts[type] || 0) + 1; seen.add(type); total++; }
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: total > 0 ? +((count / total) * 100).toFixed(1) : 0 }));
}

/**
 * Charge severity breakdown (Felony / Gross Misdemeanor / Misdemeanor / Unknown).
 * Counts individual charge instances, not bookings.
 */
export function getChargeSeverityBreakdown(log) {
  const counts = {};
  let total = 0;
  log.forEach(entry => {
    (entry.charges || []).forEach(c => {
      const sev = getChargeSeverity(c.violation);
      counts[sev] = (counts[sev] || 0) + 1;
      total++;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: total > 0 ? +((count / total) * 100).toFixed(1) : 0 }));
}

/**
 * Average and median number of charges per booking.
 */
export function getAvgChargesPerInmate(log) {
  const counts = log.map(e => (e.charges || []).length).filter(n => n > 0);
  if (!counts.length) return null;
  return { mean: +mean(counts).toFixed(1), median: median(counts), max: Math.max(...counts) };
}

/**
 * Average length of stay (days) broken down by charge category.
 * Only includes released bookings with ≥3 data points per category.
 */
export function getAvgStayByChargeType(log) {
  const stays = {};
  log.filter(e => e.status === 'released').forEach(entry => {
    const days = stayDays(entry);
    if (days === null) return;

    // Dedupe charge categories for this booking (FTA resolves to underlying)
    const cats = [...new Set((entry.charges || []).map(c => resolveEffectiveCategory(c.violation, c.addDesc)))];

    // Only attribute stay to a charge if it's the sole category on the booking.
    // Multi-charge bookings can't be cleanly attributed — e.g. a DOC Warrant +
    // Stalking booking would falsely inflate DOC Warrant average stay.
    if (cats.length !== 1) return;

    const cat = cats[0];
    if (!stays[cat]) stays[cat] = [];
    stays[cat].push(days);
  });
  return Object.entries(stays)
    .filter(([, arr]) => arr.length >= 3)
    .map(([category, arr]) => ({
      category,
      avgDays: +mean(arr).toFixed(1),
      medianDays: +median(arr).toFixed(1),
      count: arr.length,
    }))
    .sort((a, b) => b.avgDays - a.avgDays)
    .slice(0, 15);
}

/**
 * Per-agency breakdown: charge count, top charge, top-5 charge distribution.
 */
export function getAgencyBreakdown(log) {
  const agencies = {};
  log.forEach(entry => {
    (entry.charges || []).forEach(c => {
      if (!c.arrestAgency) return;
      const name = normalizeAgency(c.arrestAgency);
      if (!agencies[name]) agencies[name] = { name, count: 0, charges: {} };
      agencies[name].count++;
      const cat = resolveEffectiveCategory(c.violation, c.addDesc);
      agencies[name].charges[cat] = (agencies[name].charges[cat] || 0) + 1;
    });
  });
  return Object.values(agencies)
    .map(a => ({
      name: a.name,
      count: a.count,
      topCharge: Object.entries(a.charges).sort((x, y) => y[1] - x[1])[0]?.[0] || 'Unknown',
      chargeBreakdown: Object.entries(a.charges)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count })),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * How many released bookings had any bail amount set.
 */
export function getBailOnReleaseStats(log) {
  const released = log.filter(e => e.status === 'released');
  const withBail = released.filter(e => (e.charges || []).some(c => c.bondAmount > 0 || c.cashAmount > 0));
  return {
    total: released.length,
    withBail: withBail.length,
    pct: released.length > 0 ? +((withBail.length / released.length) * 100).toFixed(1) : 0,
  };
}

/**
 * Top 5 charge categories per age group.
 */
export function getChargesByAgeGroup(log) {
  const groups = { '18–25': {}, '26–35': {}, '36–45': {}, '46–55': {}, '56–65': {}, '65+': {} };
  log.forEach(entry => {
    const age = parseInt(entry.age);
    if (isNaN(age) || age < 1 || age > 120) return;
    const bucket = age <= 25 ? '18–25' : age <= 35 ? '26–35' : age <= 45 ? '36–45'
                 : age <= 55 ? '46–55' : age <= 65 ? '56–65' : '65+';
    const seen = new Set();
    (entry.charges || []).forEach(c => {
      const cat = resolveEffectiveCategory(c.violation, c.addDesc);
      if (!seen.has(cat)) { groups[bucket][cat] = (groups[bucket][cat] || 0) + 1; seen.add(cat); }
    });
  });
  return Object.entries(groups).map(([group, charges]) => ({
    group,
    topCharges: Object.entries(charges).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([label, count]) => ({ label, count })),
  }));
}

/**
 * Crime-type (Violent, Property, Drug, DUI, etc.) breakdown per age group.
 * Uses resolveEffectiveCategory so FTA/warrant charges are attributed to the
 * underlying offense's crime type rather than lumped into Court / Supervision.
 */
export function getCrimeTypeByAgeGroup(log) {
  const groups = { '18–25': {}, '26–35': {}, '36–45': {}, '46–55': {}, '56–65': {}, '65+': {} };
  log.forEach(entry => {
    const age = parseInt(entry.age);
    if (isNaN(age) || age < 1 || age > 120) return;
    const bucket = age <= 25 ? '18–25' : age <= 35 ? '26–35' : age <= 45 ? '36–45'
                 : age <= 55 ? '46–55' : age <= 65 ? '56–65' : '65+';
    const seen = new Set();
    (entry.charges || []).forEach(c => {
      const type = getCrimeType(resolveEffectiveCategory(c.violation, c.addDesc));
      if (!seen.has(type)) { groups[bucket][type] = (groups[bucket][type] || 0) + 1; seen.add(type); }
    });
  });
  return Object.entries(groups).map(([group, types]) => ({
    group,
    crimeTypes: Object.entries(types).sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
  }));
}

/**
 * Average weight, height, and most common race per charge category, split by sex.
 * Entries with fewer than 3 data points are omitted.
 */
export function getPhysicalProfileByCharge(log) {
  const data = {};
  log.forEach(entry => {
    const sex = normalizeSex(entry.sex);
    if (!sex || sex === 'Unknown') return;
    const weight = parseFloat(entry.weight);
    const height = parseInt(entry.height);
    const race   = normalizeRace(entry.race);
    const seen   = new Set();
    (entry.charges || []).forEach(c => {
      const cat = resolveEffectiveCategory(c.violation, c.addDesc);
      if (seen.has(cat)) return;
      seen.add(cat);
      const key = `${sex}|||${cat}`;
      if (!data[key]) data[key] = { sex, charge: cat, weights: [], heights: [], races: {} };
      if (!isNaN(weight) && weight > 50 && weight < 500) data[key].weights.push(weight);
      const hi = heightToInches(height);
      if (hi) data[key].heights.push(hi);
      if (race && race !== 'Unknown') data[key].races[race] = (data[key].races[race] || 0) + 1;
    });
  });
  const bySex = {};
  Object.values(data).forEach(d => {
    const n = Math.max(
      d.weights.length, d.heights.length,
      Object.values(d.races).reduce((s, v) => s + v, 0)
    );
    if (n < 3) return;
    if (!bySex[d.sex]) bySex[d.sex] = [];
    const topRace    = Object.entries(d.races).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const avgWeight  = d.weights.length ? Math.round(mean(d.weights)) : null;
    const avgHeight  = d.heights.length ? inchesToDisplay(mean(d.heights)) : null;
    bySex[d.sex].push({ charge: d.charge, avgWeight, avgHeight, topRace, n });
  });
  Object.keys(bySex).forEach(sex => bySex[sex].sort((a, b) => b.n - a.n));
  return bySex;
}

/**
 * What is the original charge behind Failure to Appear bookings?
 * FTA is a procedural charge — the roster's "Add. Desc." field usually names
 * the underlying offense the person failed to appear for. Returns the
 * resolved breakdown plus how much of it we can actually account for.
 */
export function getFtaOriginalCharges(log, n = 12) {
  const counts = {};
  let ftaTotal = 0;
  let resolved = 0;
  log.forEach(entry => {
    const seen = new Set();
    (entry.charges || []).forEach(c => {
      if (normalizeCharge(c.violation) !== 'Failure to Appear') return;
      if (seen.has('fta')) return; // dedupe multiple FTA charges per booking
      seen.add('fta');
      ftaTotal++;
      const underlying = c.addDesc ? normalizeCharge(c.addDesc) : null;
      if (underlying && underlying !== 'Other' && underlying !== 'Unknown' && !MASKING_CATEGORIES.has(underlying)) {
        counts[underlying] = (counts[underlying] || 0) + 1;
        resolved++;
      }
    });
  });
  return {
    ftaTotal,
    resolved,
    unresolved: ftaTotal - resolved,
    pctResolved: ftaTotal > 0 ? +((resolved / ftaTotal) * 100).toFixed(1) : 0,
    topOriginalCharges: topN(counts, n),
  };
}

/**
 * Bookings grouped by year.
 */
export function getBookingsByYear(log) {
  const counts = {};
  log.forEach(entry => {
    if (!entry.firstSeen) return;
    const d = new Date(entry.firstSeen);
    if (isNaN(d)) return;
    const year = String(d.getFullYear());
    counts[year] = (counts[year] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => ({ year, count }));
}

// ─── Master aggregation ───────────────────────────────────────────────────────

/**
 * Run all aggregations and return a single stats object.
 * @param {Array} log - the full change_log array
 */
export function buildStats(log) {
  // Dedupe by bookingNumber — keep the latest entry (first in the array,
  // since log is ordered newest-first). This prevents double-counting when
  // the scraper re-adds existing bookings after a server restart.
  const seen = new Set();
  log = log.filter(e => {
    if (!e.bookingNumber || seen.has(e.bookingNumber)) return false;
    seen.add(e.bookingNumber);
    return true;
  });

  return {
    generatedAt: new Date().toISOString(),
    bookingCounts: getBookingCounts(log),
    gender: getGenderBreakdown(log),
    race: getRaceBreakdown(log),
    age: getAgeStats(log),
    topCharges: getTopCharges(log, 15),
    topAgencies: getTopAgencies(log, 10),
    bail: getBailStats(log),
    stay: getStayStats(log),
    // deep
    bailByCharge: getBailByCharge(log),
    chargesByRace: getChargesByRace(log),
    chargesBySex: getChargesBySex(log),
    releaseReasons: getReleaseReasonBreakdown(log),
    recidivism: getRecidivism(log),
    bookingsByMonth: getBookingsByMonth(log),
    // deep ++
    crimeTypes: getCrimeTypeBreakdown(log),
    severity: getChargeSeverityBreakdown(log),
    avgCharges: getAvgChargesPerInmate(log),
    stayByCharge: getAvgStayByChargeType(log),
    agencyBreakdown: getAgencyBreakdown(log),
    bailOnRelease: getBailOnReleaseStats(log),
    chargesByAgeGroup: getChargesByAgeGroup(log),
    crimeTypeByAgeGroup: getCrimeTypeByAgeGroup(log),
    physicalProfile: getPhysicalProfileByCharge(log),
    bookingsByYear: getBookingsByYear(log),
    ftaOriginalCharges: getFtaOriginalCharges(log),
  };
}
