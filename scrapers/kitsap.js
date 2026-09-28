import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://incustody.kitsap.gov';
const ROSTER_URL = `${BASE_URL}/Home/BookingSearchResult`;
const DETAIL_BASE_URL = `${BASE_URL}/Home/BookingSearchDetail`;
const RELEASES_XML_URL = 'https://www.kitsap.gov/sheriff/InCustody/ReleasedLast24Hours.xml';

// Returns the permanent, booking-number-keyed detail URL.
// Works for both in-custody and recently released inmates.
export function bookingDetailUrl(bookingNumber) {
  return `${DETAIL_BASE_URL}?BookingNumber=${bookingNumber}`;
}
const HEADERS = {
  'Referer': 'https://incustody.kitsap.gov/Home/BookingSearchQuery?Length=4',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
};

// Per-request cap. Sheriff's site occasionally accepts a TCP connection then
// stalls indefinitely; without this the whole scrape can hang for hours.
const REQUEST_TIMEOUT_MS = 30_000;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry wrapper for critical requests. Backoff: 2s, 5s, 10s.
async function getWithRetry(url, config = {}, attempts = 3) {
  const backoff = [2000, 5000, 10000];
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.get(url, { timeout: REQUEST_TIMEOUT_MS, ...config });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.error(`  Request failed (attempt ${i + 1}/${attempts}): ${err.message} — retrying in ${backoff[i] / 1000}s`);
        await delay(backoff[i]);
      }
    }
  }
  throw lastErr;
}

export async function fetchRoster() {
  const inmates = [];
  let page = 1;

  while (true) {
    const response = await getWithRetry(ROSTER_URL, {
      params: {
        LastName: '%',
        FirstName: '',
        BookingFrom: '',
        BookingTo: '',
        ValidSearch: '',
        sort: 'BookingDate',
        sortdir: 'DESC',
        page: page
      },
      headers: HEADERS
    });

    const $ = cheerio.load(response.data);
    const rows = $('table.table tbody tr');

    if (rows.length === 0) break;

    rows.each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return;
      const viewLink = $(cells[0]).find('a').attr('href') || '';
      inmates.push({
        bookingNumber:  $(cells[1]).text().trim(),
        firstName:      $(cells[2]).text().trim(),
        lastName:       $(cells[3]).text().trim(),
        middleName:     $(cells[4]).text().trim(),
        race:           $(cells[5]).text().trim(),
        sex:            $(cells[6]).text().trim(),
        bookingDate:    $(cells[7]).text().trim(),
        releaseDate:    $(cells[8]).text().trim(),
        schReleaseDate: $(cells[9]).text().trim(),
        detailUrl:      viewLink ? `${BASE_URL}${viewLink}` : null
      });
    });

    if (rows.length < 15) break;
    page++;
    if (page > 100) {
      console.error(`  Roster pagination exceeded 100 pages — bailing to prevent runaway loop.`);
      break;
    }
    await delay(300);
  }

  return inmates;
}

export async function fetchDetail(detailUrl) {
  try {
    await delay(500);
    const response = await axios.get(detailUrl, { headers: HEADERS, timeout: REQUEST_TIMEOUT_MS });
    const $ = cheerio.load(response.data);

    // Physical description — pull from full body text
    const bodyText = $('body').text();
    const age =      bodyText.match(/Age:\s*(\d+)/)?.[1] || null;
    const height =   bodyText.match(/Height:\s*(\d+)/)?.[1] || null;
    const weight =   bodyText.match(/Weight:\s*(\d+)/)?.[1] || null;
    const hair =     bodyText.match(/Hair:\s*([A-Z]+)/i)?.[1] || null;
    const eyes =     bodyText.match(/Eyes:\s*([A-Z]+)/i)?.[1] || null;
    const inmateId = bodyText.match(/Inmate\s*ID:\s*(\d+)/)?.[1] || null;
    const schedRelease = bodyText.match(/Sched\.?\s*Release:\s*([\d\/]+)/i)?.[1]?.trim() || null;

    // Parse charges by walking all table rows in document order.
    //
    // Page structure (repeats for each charge):
    //   [N]                                      ← charge number row (single td, digits only)
    //   [Violation: TEXT]  [Level: X]
    //   [Add. Desc.: ...]  [OBTS #: ...]
    //   [War.#: ...]       [End Of Sentence Date: ...]  [Clearance: ...]
    //   [Arrest Information]                     ← section header
    //   [Arrest Agency: ...]  [Case #: ...]  [Arrest Date: MM/DD/YYYY]
    //   []                                       ← empty spacer
    //   [Court & Bail/Bond Information]          ← section header
    //   [Court Type: X]  [Court Case #: ...]  [Next Court Date MM/DD/YYYY]
    //   [Req. Bond/Bail: ...]  [Bond Group #: ...]  []
    //   [Req. Bond Amt: $X]  [Req. Cash Amt: $X]  [Bond Co. #: ...]

    const rows = $('table tr').toArray();
    const charges = [];
    let cur = null;

    function parseDollars(text) {
      const m = text.match(/\$\s*([\d,]+\.?\d*)/);
      if (!m) return null;
      const v = parseFloat(m[1].replace(/,/g, ''));
      return v > 0 ? v : null;
    }

    for (const row of rows) {
      const tds = $(row).find('td').map((_, td) => $(td).text().trim()).get();
      if (!tds.length) continue;
      const first = tds[0];

      // Charge number boundary: single td containing only digits
      if (tds.length === 1 && /^\d+$/.test(first)) {
        if (cur) charges.push(cur);
        cur = null;
        continue;
      }

      // Violation row — starts a new charge block
      if (/^Violation:/i.test(first)) {
        if (cur) charges.push(cur);
        const rawViolation = first.replace(/^Violation:\s*/i, '').trim();
        const cleared = /\(Cleared\)/i.test(rawViolation);
        cur = {
          violation:     rawViolation.replace(/\s*\(Cleared\)/i, '').trim(),
          cleared,
          addDesc:       null,
          clearance:     null,
          bondBailType:  null,
          bondAmount:    null,
          cashAmount:    null,
          courtCase:     null,
          nextCourtDate: null,
          arrestAgency:  null,
          arrestDate:    null,
          courtType:     null,
        };
        continue;
      }

      if (!cur) continue;

      // Add. Desc. row (sits between Violation and Arrest Info)
      if (/^Add\.?\s*Desc\.?:/i.test(first)) {
        const val = first.replace(/^Add\.?\s*Desc\.?:\s*/i, '').trim();
        cur.addDesc = val || null;
        continue;
      }

      // War.# / End Of Sentence / Clearance row
      if (/^War\.?#?:/i.test(first)) {
        for (const td of tds) {
          if (/^Clearance:/i.test(td)) {
            const val = td.replace(/^Clearance:\s*/i, '').trim();
            cur.clearance = val || null;
          }
        }
        continue;
      }

      // Req. Bond/Bail type row (e.g. "C/B", "RF", "NOBD", "PR")
      if (/^Req\.?\s*Bond\/Bail:/i.test(first)) {
        const val = first.replace(/^Req\.?\s*Bond\/Bail:\s*/i, '').trim();
        cur.bondBailType = val || null;
        continue;
      }

      // Arrest info row
      if (/^Arrest Agency:/i.test(first)) {
        for (const td of tds) {
          if (/^Arrest Agency:/i.test(td))
            cur.arrestAgency = td.replace(/^Arrest Agency:\s*/i, '').trim() || null;
          else if (/^Arrest Date:/i.test(td))
            cur.arrestDate = td.replace(/^Arrest Date:\s*/i, '').trim() || null;
        }
        continue;
      }

      // Court type / court case / next court date row
      if (/^Court Type:/i.test(first)) {
        for (const td of tds) {
          if (/^Court Type:/i.test(td))
            cur.courtType = td.replace(/^Court Type:\s*/i, '').trim() || null;
          else if (/^Court Case\s*#:/i.test(td))
            cur.courtCase = td.replace(/^Court Case\s*#:\s*/i, '').trim() || null;
          else if (/^Next Court Date/i.test(td)) {
            const m = td.match(/Next Court Date\s*([\d\/]+)/i);
            if (m) cur.nextCourtDate = m[1].trim();
          }
        }
        continue;
      }

      // Bond amounts row
      if (/^Req\.?\s*Bond\s*Amt/i.test(first)) {
        for (const td of tds) {
          if (/^Req\.?\s*Bond\s*Amt/i.test(td))  cur.bondAmount = parseDollars(td);
          if (/^Req\.?\s*Cash\s*Amt/i.test(td))  cur.cashAmount = parseDollars(td);
        }
        continue;
      }
    }

    if (cur) charges.push(cur);

    const totalBond = charges.reduce((s, c) => s + (c.bondAmount || 0) + (c.cashAmount || 0), 0);

    return {
      inmateId,
      schedRelease,
      age,
      height,
      weight,
      hair,
      eyes,
      charges,
      totalBond: totalBond > 0 ? totalBond : null,
    };

  } catch (err) {
    console.error(`Failed to fetch detail for ${detailUrl}:`, err.message);
    return null;
  }
}

// Returns a map of bookingNumber -> formatted release datetime string
// sourced from the sheriff's released-last-24-hours XML feed.
export async function fetchRecentReleases() {
  try {
    const response = await axios.get(RELEASES_XML_URL, { headers: HEADERS, timeout: REQUEST_TIMEOUT_MS });
    const $ = cheerio.load(response.data, { xmlMode: true });
    const releases = {};

    $('RELEASE').each((_, el) => {
      const bookNum = $(el).find('BOOK_NUM').text().trim();
      const raw     = $(el).find('RELEASEDATE').text().trim();
      if (!bookNum || !raw) return;

      // Parse "03/19/2026  3:40PM" → JS Date
      const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(AM|PM)$/i);
      if (!m) return;
      const [, month, day, year, hourStr, min, ampm] = m;
      let hour = parseInt(hourStr, 10);
      if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour, parseInt(min), 0);

      // Format consistently with nowPST()
      releases[bookNum] = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      }).format(date);
    });

    return releases;
  } catch (err) {
    console.error('Failed to fetch releases XML:', err.message);
    return {};
  }
}