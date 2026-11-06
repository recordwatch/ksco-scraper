// Stored timestamps look like "MM/DD/YYYY, HH:MM:SS" (Pacific) or "MM/DD/YYYY".
// Before the scraper switched to hourCycle h23, midnight was written as hour 24
// of the same date ("10/25/2026, 24:35:00" means 00:35 on 10/25). No browser
// parses hour 24, and Safari doesn't reliably parse this format at all, so read
// the fields directly instead of handing the string to new Date().
const STORED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

export function parseDate(str) {
  if (!str) return null
  const m = STORED.exec(str.trim())
  if (!m) {
    const d = new Date(str)
    return isNaN(d) ? null : d
  }
  const [month, day, year] = [+m[1], +m[2], +m[3]]
  const hour = m[4] === '24' ? 0 : +(m[4] || 0)
  const min = +(m[5] || 0), sec = +(m[6] || 0)
  const d = new Date(year, month - 1, day, hour, min, sec)
  // new Date() rolls 13/45 over into a later date; treat out-of-range fields as unparseable
  if (d.getMonth() !== month - 1 || d.getDate() !== day || hour > 23 || min > 59 || sec > 59) return null
  return d
}

// For showing a stored timestamp as text: hour 24 becomes 00.
export function fixMidnight(str) {
  return str ? str.replace(/, 24:/, ', 00:') : str
}

// Sort helper: newest first, unparseable values last.
export function newestFirst(a, b) {
  const ta = parseDate(a)?.getTime() ?? -Infinity
  const tb = parseDate(b)?.getTime() ?? -Infinity
  return tb - ta || 0
}
