import { useState } from 'react'
import { parseDate, fixMidnight } from '../dates'

function formatHeight(raw) {
  if (!raw) return 'N/A'
  const str = String(raw)
  if (str.length === 3) return `${str[0]}'${str.slice(1)}"`
  if (str.length === 4) return `${str.slice(0,2)}'${str.slice(2)}"`
  return raw
}

function formatMoney(n) {
  if (n == null) return 'N/A'
  return '$' + Number(n).toLocaleString('en-US')
}

const CLEARANCE_LABELS = {
  POST: 'Bail Posted',
  RF:   'Released — No Bail',
  PR:   'Personal Recognizance',
  TIME: 'Time Served',
  TRANS:'Transferred',
  NOBD: 'No Bond Required',
}

function formatClearance(code) {
  if (!code) return null
  return CLEARANCE_LABELS[code.toUpperCase()] || code
}

function formatRace(code) {
  const map = { W: 'White', B: 'Black', H: 'Hispanic', A: 'Asian', I: 'Native American', U: 'Unknown' }
  return map[code] || code || 'N/A'
}

function calcTimeHeld(start, end) {
  const s = parseDate(start)
  const e = parseDate(end)
  if (!s || !e) return null
  const ms = e - s
  if (ms <= 0) return null
  const totalMins = Math.floor(ms / 60000)
  const days  = Math.floor(totalMins / 1440)
  const hours = Math.floor((totalMins % 1440) / 60)
  const mins  = totalMins % 60
  if (days > 0)  return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export default function BookingCard({ entry }) {
  const [open, setOpen] = useState(false)

  const isReleased = entry.status === 'released'
  const timeHeld = isReleased ? calcTimeHeld(entry.firstSeen, entry.releasedAt) : null

  return (
    <div className={`card ${isReleased ? 'card-released' : 'card-custody'}`}>
      <div className="card-header" onClick={() => setOpen(!open)}>
        <div className="card-left">
          <div className="card-name">{entry.name}</div>
          <div className="card-meta">
            Booking #{entry.bookingNumber} &nbsp;·&nbsp; Booked: {entry.bookingDate || fixMidnight(entry.firstSeen)}
            {timeHeld && <span className="card-time-held"> &nbsp;·&nbsp; Held: {timeHeld}</span>}
          </div>
        </div>
        <div className="card-right">
          <span className={`badge ${isReleased ? 'badge-released' : 'badge-custody'}`}>
            {isReleased ? 'Released' : 'In Custody'}
          </span>
          <span className="card-toggle">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="card-body">
          {isReleased && entry.releasedAt && (
            <div className="card-release-row">
              Released: {fixMidnight(entry.releasedAt)}{timeHeld && <span className="card-time-held-detail"> &nbsp;·&nbsp; Time held: {timeHeld}</span>}
            </div>
          )}
          {entry.schedRelease && !isReleased && (
            <div className="card-release-row">
              Scheduled Release: {entry.schedRelease}
            </div>
          )}

          <div className="card-description">
            <div className="desc-row">
              <span>Age</span><span>{entry.age || 'N/A'}</span>
            </div>
            <div className="desc-row">
              <span>Sex</span><span>{entry.sex || 'N/A'}</span>
            </div>
            <div className="desc-row">
              <span>Race</span><span>{formatRace(entry.race)}</span>
            </div>
            <div className="desc-row">
              <span>Height</span><span>{formatHeight(entry.height)}</span>
            </div>
            <div className="desc-row">
              <span>Weight</span><span>{entry.weight ? `${entry.weight} lbs` : 'N/A'}</span>
            </div>
            <div className="desc-row">
              <span>Hair</span><span>{entry.hair || 'N/A'}</span>
            </div>
            <div className="desc-row">
              <span>Eyes</span><span>{entry.eyes || 'N/A'}</span>
            </div>
          </div>

          {entry.charges && entry.charges.length > 0 && (
            <div className="card-charges">
              <div className="charges-title">Charges ({entry.charges.length})</div>
              {entry.charges.map((c, i) => (
                <div key={i} className="charge-row">
                  <div className="charge-violation">
                    {c.violation}
                    {c.addDesc && <span className="charge-add-desc"> — {c.addDesc}</span>}
                    {c.cleared && <span className="charge-cleared"> ✓ Cleared</span>}
                  </div>
                  {c.clearance && (
                    <div className="charge-clearance">Release: {formatClearance(c.clearance)}</div>
                  )}
                  {(c.bondAmount > 0 || c.cashAmount > 0) && (
                    <div className="charge-bail">
                      Bond: {formatMoney(c.bondAmount)} &nbsp;·&nbsp; Cash: {formatMoney(c.cashAmount)}
                    </div>
                  )}
                  {c.nextCourtDate && (
                    <div className="charge-court">Next court: {c.nextCourtDate}</div>
                  )}
                  {c.arrestAgency && (
                    <div className="charge-agency">Arrested by: {c.arrestAgency}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}