import { Link } from 'react-router-dom'
import { parseDate, newestFirst } from '../dates'

const UNKNOWN_DATE = 'Date unknown'

function formatDate(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return UNKNOWN_DATE
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const year = String(d.getFullYear()).slice(-2)
  return `${month}/${day}/${year}`
}

function formatTime(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return ''
  let hours = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  hours = hours ? hours : 12
  return `${hours}:${minutes} ${ampm}`
}

function calculateTimeServed(booked, released) {
  const start = parseDate(booked)
  const end = parseDate(released)
  if (!start || !end) return null
  const diffMs = end - start
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  return `${diffDays}d${diffHours}h${diffMins}m`
}

function getReleaseReason(entry) {
  if (!entry.charges || entry.charges.length === 0) return ''
  const firstCharge = entry.charges[0].violation || ''
  if (firstCharge.includes('Warrant')) return 'Warrant Arrest'
  if (firstCharge.includes('Failure to Appear')) return 'Failure to Appear'
  if (firstCharge.includes('Probation') || firstCharge.includes('Parole')) return 'Probation, Parole Violation'
  if (firstCharge.includes('Time served')) return 'Time Served'
  if (firstCharge.includes('ROA')) return 'ROA'
  if (firstCharge.includes('RCC')) return 'RCC'
  if (firstCharge.includes('RPR')) return 'RPR'
  return 'Other'
}

export default function HistoryLog({ entries, search = '' }) {
  // Filter by name if search is active
  const filtered = search
    ? entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : entries

  if (filtered.length === 0 && search) {
    return <div className="empty">No records match your search.</div>
  }

  // Group by date - each person appears only once
  const grouped = {}

  filtered.forEach(entry => {
    const bookedDate = formatDate(entry.bookingDate || entry.firstSeen)
    if (!grouped[bookedDate]) grouped[bookedDate] = { booked: [], released: [] }

    // Released people only show in RELEASED section on their release date
    // In-custody people show in BOOKED section on their booking date
    if (entry.releasedAt) {
      const releasedDate = formatDate(entry.releasedAt)
      if (!grouped[releasedDate]) grouped[releasedDate] = { booked: [], released: [] }
      grouped[releasedDate].released.push(entry)
    } else {
      // Only show in-custody under BOOKED
      grouped[bookedDate].booked.push({ ...entry, type: 'BOOKED' })
    }
  })

  // Sort dates descending
  // Keys are MM/DD/YY; anything that didn't parse goes last instead of breaking the sort
  const fullYear = key => key.replace(/\/(\d\d)$/, '/20$1')
  const sortedDates = Object.keys(grouped).sort((a, b) => newestFirst(fullYear(a), fullYear(b)))

  return (
    <div className="history-log">
      <div className="history-header">
        <Link to="/" className="back-link">← Main Page</Link>
        <h2>Booked and Released Log</h2>
        <p className="history-subtitle">Record of all Bookings and Releases, with newest first</p>
      </div>
      
      {sortedDates.map(date => {
        const dayData = grouped[date]
        const bookedCount = dayData.booked.length
        const releasedCount = dayData.released.length
        
        if (bookedCount === 0 && releasedCount === 0) return null
        
        return (
          <div key={date} className="history-day">
            <div className="history-date">{date}</div>
            
            {bookedCount > 0 && (
              <div className="history-section">
                <div className="history-section-title">BOOKED ({bookedCount})</div>
                <ul className="history-list">
                  {dayData.booked.map(entry => (
                    <li key={entry.bookingNumber} className="history-item">
                      <span className="history-name">{entry.name}</span>
                      <span className="history-meta">
                        Booked: {formatTime(entry.bookingDate || entry.firstSeen)}
                        {entry.charges && entry.charges.length > 0 && (
                          <span className="history-charges"> | Charges: {entry.charges.map(c => c.violation).join(', ')}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {releasedCount > 0 && (
              <div className="history-section">
                <div className="history-section-title">RELEASED ({releasedCount})</div>
                <ul className="history-list">
                  {dayData.released.map(entry => {
                    const timeServed = calculateTimeServed(entry.bookingDate || entry.firstSeen, entry.releasedAt)
                    const reason = getReleaseReason(entry)
                    return (
                      <li key={entry.bookingNumber} className="history-item">
                        <span className="history-name">{entry.name}</span>
                        <span className="history-meta">
                          Released: {formatTime(entry.releasedAt)}
                          {timeServed && (
                            <span className="history-time-served"> | Time served: {timeServed} ({reason})</span>
                          )}
                          {entry.charges && entry.charges.length > 0 && (
                            <span className="history-charges"> | Charges: {entry.charges.map(c => c.violation).join(', ')}</span>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
