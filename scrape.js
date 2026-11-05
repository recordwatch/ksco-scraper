import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { fetchRoster, fetchDetail, fetchRecentReleases, bookingDetailUrl } from './scrapers/kitsap.js';
import { nowPST } from './utils.js';
import { buildStats } from './stats.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STORAGE_DIR = path.join(__dirname, 'data');

// Opt-in escape hatch for a genuine first run on an empty data directory.
const ALLOW_FRESH_START = process.env.ALLOW_FRESH_START === '1';

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const ROSTER_FILE  = path.join(STORAGE_DIR, 'roster.json');
const LOG_FILE     = path.join(STORAGE_DIR, 'change_log.json');
const STATS_FILE   = path.join(STORAGE_DIR, 'stats.json');
const STATUS_FILE  = path.join(STORAGE_DIR, 'status.json');

// data/roster.json and data/change_log.json are the only copy of the booking
// history. A file that is present but unreadable must stop the run: falling back
// to an empty value would make this run rebuild the history from an empty roster
// and then overwrite the stored one. A genuine first run needs ALLOW_FRESH_START=1.
function readState(file, empty) {
  const name = path.basename(file);

  if (!fs.existsSync(file)) {
    if (ALLOW_FRESH_START) {
      console.warn(`${name} not found — starting from empty state (ALLOW_FRESH_START=1).`);
      return empty;
    }
    console.error(`${name} not found. Refusing to start from empty state, which would discard`);
    console.error('the stored history. Set ALLOW_FRESH_START=1 if this really is a first run.');
    process.exit(1);
  }

  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`${name} could not be read as JSON: ${err.message}`);
    console.error('Refusing to continue — starting from empty state would discard the stored history.');
    process.exit(1);
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function run() {
  console.log(`[${nowPST()}] Running scrape...`);

  let roster = readState(ROSTER_FILE, {});
  let log = readState(LOG_FILE, []);

  let inmates;
  try {
    inmates = await fetchRoster();
  } catch (err) {
    console.error('Roster fetch failed:', err.message);
    process.exit(1);
  }

  if (inmates.length === 0) {
    console.log('Got 0 inmates — skipping diff to avoid wiping data.');
  } else {
    const seenBns = new Set();
    const uniqueInmates = inmates.filter(i =>
      i.bookingNumber && !seenBns.has(i.bookingNumber) && seenBns.add(i.bookingNumber)
    );

    const currentIds = new Set(uniqueInmates.map(i => i.bookingNumber));
    const previousIds = new Set(Object.keys(roster));

    const newBookings = uniqueInmates.filter(i => !previousIds.has(i.bookingNumber));
    for (const inmate of newBookings) {
      console.log(`  NEW: ${inmate.lastName}, ${inmate.firstName}`);

      const detail = await fetchDetail(bookingDetailUrl(inmate.bookingNumber));

      const entry = {
        ...inmate,
        ...(detail || {}),
        status: 'in_custody',
        firstSeen: nowPST(),
        releasedAt: null
      };

      roster[inmate.bookingNumber] = entry;

      log.unshift({
        type: 'BOOKED',
        bookingNumber: inmate.bookingNumber,
        name: `${inmate.lastName}, ${inmate.firstName} ${inmate.middleName}`.trim(),
        bookingDate: inmate.bookingDate,
        charges: detail?.charges || [],
        age: detail?.age || null,
        sex: inmate.sex,
        race: inmate.race,
        height: detail?.height || null,
        weight: detail?.weight || null,
        hair: detail?.hair || null,
        eyes: detail?.eyes || null,
        inmateId: detail?.inmateId || null,
        schedRelease: detail?.schedRelease || inmate.schReleaseDate || null,
        firstSeen: nowPST(),
        releasedAt: null,
        status: 'in_custody'
      });
    }

    const released = [...previousIds].filter(id => !currentIds.has(id) && roster[id]?.status === 'in_custody');

    let recentReleases = {};
    if (released.length > 0) {
      recentReleases = await fetchRecentReleases();
    }

    for (const id of released) {
      const inmate = roster[id];
      console.log(`  RELEASED: ${inmate.lastName}, ${inmate.firstName}`);
      const releasedAt = recentReleases[id] || nowPST();
      roster[id].status = 'released';
      roster[id].releasedAt = releasedAt;
      const logEntry = log.find(e => e.bookingNumber === id);
      if (logEntry) {
        logEntry.status = 'released';
        logEntry.releasedAt = releasedAt;
      }

      // Final detail fetch to capture clearance codes and cleared charge status
      const finalDetail = await fetchDetail(bookingDetailUrl(id));
      if (finalDetail?.charges?.length) {
        roster[id].charges = finalDetail.charges;
        if (logEntry) logEntry.charges = finalDetail.charges;
        console.log(`    Captured clearance for ${id}`);
      }
    }

    // ── Detail refresh: re-fetch all existing in-custody inmates ─────────────
    // Skips inmates just processed as new bookings (already fetched above).
    // Keeps existing field values if the fresh fetch returns null/empty,
    // so a flaky page never wipes good data.
    const newBookingNums = new Set(newBookings.map(i => i.bookingNumber));
    const toRefresh = uniqueInmates.filter(i => !newBookingNums.has(i.bookingNumber));
    let refreshed = 0, refreshFailed = 0;

    console.log(`[${nowPST()}] Refreshing detail for ${toRefresh.length} in-custody inmates...`);
    for (const inmate of toRefresh) {
      const detail = await fetchDetail(bookingDetailUrl(inmate.bookingNumber));
      if (!detail) { refreshFailed++; continue; }

      // Update roster entry
      const rosterEntry = roster[inmate.bookingNumber];
      if (rosterEntry) {
        if (detail.age)          rosterEntry.age          = detail.age;
        if (detail.height)       rosterEntry.height       = detail.height;
        if (detail.weight)       rosterEntry.weight       = detail.weight;
        if (detail.hair)         rosterEntry.hair         = detail.hair;
        if (detail.eyes)         rosterEntry.eyes         = detail.eyes;
        if (detail.inmateId)     rosterEntry.inmateId     = detail.inmateId;
        if (detail.schedRelease) rosterEntry.schedRelease = detail.schedRelease;
        else if (inmate.schReleaseDate) rosterEntry.schedRelease = inmate.schReleaseDate;
        if (detail.charges?.length) rosterEntry.charges  = detail.charges;
      }

      // Update log entry
      const logEntry = log.find(e => e.bookingNumber === inmate.bookingNumber && e.status === 'in_custody');
      if (logEntry) {
        if (detail.age)          logEntry.age          = detail.age;
        if (detail.height)       logEntry.height       = detail.height;
        if (detail.weight)       logEntry.weight       = detail.weight;
        if (detail.hair)         logEntry.hair         = detail.hair;
        if (detail.eyes)         logEntry.eyes         = detail.eyes;
        if (detail.inmateId)     logEntry.inmateId     = detail.inmateId;
        if (detail.schedRelease) logEntry.schedRelease = detail.schedRelease;
        else if (inmate.schReleaseDate) logEntry.schedRelease = inmate.schReleaseDate;
        if (detail.charges?.length) logEntry.charges   = detail.charges;
      }

      refreshed++;
    }
    console.log(`[${nowPST()}] Detail refresh done. ${refreshed} updated, ${refreshFailed} failed.`);

    writeJSON(ROSTER_FILE, roster);
    writeJSON(LOG_FILE, log);
    console.log(`[${nowPST()}] Done. ${newBookings.length} new, ${released.length} released.`);
  }

  // Write precomputed stats and status for static frontend
  const inCustody = Object.values(roster).filter(i => i.status === 'in_custody').length;
  writeJSON(STATUS_FILE, { inCustody, lastUpdated: nowPST() });
  writeJSON(STATS_FILE, buildStats(log));
  console.log(`[${nowPST()}] Wrote stats.json and status.json`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
