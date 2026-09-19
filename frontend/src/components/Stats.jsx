import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'

// ── Color palette ────────────────────────────────────────────────────────────
const C = {
  primary:   '#5B7FA6',
  secondary: '#415A77',
  accent:    '#7AA8C4',
  muted:     '#7A8A96',
  text:      '#D8D9D5',
  grid:      '#404850',
  green:     '#4A8A6A',
}

const RACE_COLORS = ['#5B7FA6', '#7AA8C4', '#4A8A6A', '#8A6AA8', '#C08A45', '#4A8A8A']
const SEX_COLORS = ['#7AA8C4', '#A06878', '#484E54']
const AGE_COLORS = ['#5B7FA6', '#7AA8C4', '#4A8A6A', '#C08A45', '#8A6AA8', '#4A8A8A']
const TYPE_COLORS = {
  'Violent':             '#C0535A',
  'Property':            '#7AA8C4',
  'Drug':                '#4A8A6A',
  'Traffic / DUI':       '#5B7FA6',
  'Court / Supervision': '#8A6AA8',
  'Sex Offense':         '#A06878',
  'Weapons':             '#C08A45',
  'Fraud / Identity':    '#4A8A8A',
  'Order Violations':    '#6A8A5A',
  'Other':               '#5A6A72',
  'Unknown':             '#484E54',
}
const SEV_COLORS = { 'Felony': '#C0535A', 'Gross Misdemeanor': '#C08A45', 'Misdemeanor': '#5B7FA6', 'Unknown': '#484E54' }

function SectionTitle({ children }) {
  return <h3 className="stats-section-title">{children}</h3>
}

function NoData({ msg = 'Insufficient data — check back as records accumulate.' }) {
  return <div className="stats-nodata">{msg}</div>
}

function fmtN(n) { return n != null ? Number(n).toLocaleString() : '—' }

// Custom tooltip so it fits the site aesthetic
function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="stats-tooltip">
      <div className="stats-tooltip-label">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="stats-tooltip-val">
          {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  )
}

// Horizontal bar chart — used for charges, agencies, etc.
function HBar({ data, dataKey = 'count', nameKey = 'label', color = C.rust, colorFn, height }) {
  if (!data?.length) return <NoData />
  const h = height || Math.max(220, data.length * 32)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
        <XAxis type="number" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey={nameKey}
          width={200}
          tick={{ fill: C.text, fontSize: 12, fontFamily: 'Inter, sans-serif' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey={dataKey} fill={color} radius={[0, 2, 2, 0]} maxBarSize={20}>
          {colorFn && data.map((d, i) => <Cell key={i} fill={colorFn(d)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Vertical bar chart — monthly trend
function VBar({ data, dataKey = 'count', nameKey = 'label', colors, color = C.rust }) {
  if (!data?.length) return <NoData />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
        <XAxis
          dataKey={nameKey}
          tick={{ fill: C.text, fontSize: 11, fontFamily: 'Inter, sans-serif' }}
          axisLine={false}
          tickLine={false}
          angle={-30}
          textAnchor="end"
          interval={0}
        />
        <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} maxBarSize={50}>
          {colors && data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Pie chart — for simple categorical breakdowns (race, sex, age, crime type)
function StatPie({ data, dataKey = 'count', nameKey = 'label', colors, colorFn, height = 240 }) {
  if (!data?.length) return <NoData />
  const getColor = colorFn || ((d, i) => colors ? colors[i % colors.length] : C.primary)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={dataKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          outerRadius={height / 2 - 30}
          label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((d, i) => <Cell key={i} fill={getColor(d, i)} />)}
        </Pie>
        <Tooltip content={<DarkTooltip />} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          wrapperStyle={{ fontSize: '0.7rem', color: C.text, fontFamily: 'Inter, sans-serif' }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

export default function Stats() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('./data/stats.json')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="stats-page">
      <div className="stats-header">
        <Link to="/" className="back-link">← Main Page</Link>
        <h2>Jail Statistics</h2>
      </div>
      <div className="loading">Crunching numbers...</div>
    </div>
  )

  if (error) return (
    <div className="stats-page">
      <div className="stats-header">
        <Link to="/" className="back-link">← Main Page</Link>
        <h2>Jail Statistics</h2>
      </div>
      <div className="stats-nodata">Error: {error}</div>
    </div>
  )

  const {
    bookingCounts, gender, race, age, topCharges, stay, bookingsByMonth,
    crimeTypes, severity, avgCharges, bailOnRelease, recidivism,
  } = data

  const total = bookingCounts.total

  return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="back-links">
          <Link to="/" className="back-link">← Main Page</Link>
          <Link to="/deepstats" className="back-link">Deep Stats</Link>
        </div>
        <h2>Jail Statistics</h2>
        <p className="stats-subtitle">
          {total.toLocaleString()} bookings &middot; {bookingCounts.inCustody.toLocaleString()} in custody &middot; {bookingCounts.released.toLocaleString()} released
          {data.generatedAt && (
            <> &middot; {new Date(data.generatedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</>
          )}
        </p>
      </div>

      {/* ── Summary ──────────────────────────────────────────────────────── */}
      <div className="stats-card">
        <SectionTitle>Summary</SectionTitle>
        <div className="stat-boxes">
          <div className="stat-box">
            <div className="stat-box-num">{fmtN(bookingCounts?.total)}</div>
            <div className="stat-box-label">Total Bookings</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-num">{fmtN(bookingCounts?.inCustody)}</div>
            <div className="stat-box-label">In Custody</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-num">{fmtN(bookingCounts?.released)}</div>
            <div className="stat-box-label">Releases Tracked</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-num">{stay?.mean ?? '—'}</div>
            <div className="stat-box-label">Avg Stay (days)</div>
            <div className="stat-box-sub">median {stay?.median ?? '—'}d</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-num">{avgCharges?.mean ?? '—'}</div>
            <div className="stat-box-label">Avg Charges / Inmate</div>
            <div className="stat-box-sub">median {avgCharges?.median ?? '—'}, max {avgCharges?.max ?? '—'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-num">{bailOnRelease?.pct ?? '—'}%</div>
            <div className="stat-box-label">Released w/ Bail Set</div>
            <div className="stat-box-sub">{fmtN(bailOnRelease?.withBail)} of {fmtN(bailOnRelease?.total)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-num">{recidivism?.rate ?? '—'}%</div>
            <div className="stat-box-label">Repeat Booker Rate</div>
            <div className="stat-box-sub">{fmtN(recidivism?.repeatBookerCount)} of {fmtN(recidivism?.totalIndividuals)} individuals</div>
          </div>
        </div>
      </div>

      {/* ── Top Charges ──────────────────────────────────────────────────── */}
      <div className="stats-card">
        <SectionTitle>Top Charge Categories</SectionTitle>
        <p className="stats-card-note">
          Bookings by primary charge category. A single booking may carry multiple charge types.
          FTA/warrant/probation charges are attributed to the underlying offense (from the roster's "Add. Desc." field)
          rather than lumped under "Failure to Appear" — see /deepstats for the FTA-specific breakdown.
        </p>
        <HBar data={topCharges} color={C.primary} />
      </div>

      {/* ── Crime Types + Severity ───────────────────────────────────────── */}
      <div className="stats-grid-2">
        <div className="stats-card">
          <SectionTitle>Crime Types</SectionTitle>
          <p className="stats-card-note">Broad category per booking (deduped). One booking can appear in multiple types.</p>
          <HBar data={crimeTypes} colorFn={d => TYPE_COLORS[d.label] || C.muted} height={Math.max(180, (crimeTypes?.length || 0) * 30)} />
          <table className="stats-table" style={{ marginTop: '0.75rem' }}>
            <tbody>
              {crimeTypes?.map(r => (
                <tr key={r.label}>
                  <td><span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background: TYPE_COLORS[r.label] || C.muted, marginRight:6 }} />{r.label}</td>
                  <td className="stats-table-num">{r.count}</td>
                  <td className="stats-table-pct">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stats-card">
          <SectionTitle>Charge Severity</SectionTitle>
          <p className="stats-card-note">Best-effort classification per individual charge instance (WA state tiers).</p>
          <HBar data={severity} colorFn={d => SEV_COLORS[d.label] || C.muted} height={160} />
          <table className="stats-table" style={{ marginTop: '0.75rem' }}>
            <tbody>
              {severity?.map(r => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="stats-table-num">{r.count}</td>
                  <td className="stats-table-pct">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Demographics ─────────────────────────────────────────────────── */}
      <div className="stats-grid-2">
        <div className="stats-card">
          <SectionTitle>Race</SectionTitle>
          <StatPie data={race} colors={RACE_COLORS} />
          <table className="stats-table">
            <tbody>
              {race.map(r => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="stats-table-num">{r.count.toLocaleString()}</td>
                  <td className="stats-table-pct">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stats-card">
          <SectionTitle>Sex</SectionTitle>
          <StatPie data={gender} colors={SEX_COLORS} />
          <table className="stats-table">
            <tbody>
              {gender.map(g => (
                <tr key={g.label}>
                  <td>{g.label}</td>
                  <td className="stats-table-num">{g.count.toLocaleString()}</td>
                  <td className="stats-table-pct">{g.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Age Distribution ─────────────────────────────────────────────── */}
      {age && (
        <div className="stats-card">
          <SectionTitle>Age Distribution</SectionTitle>
          <div className="stats-age-meta">
            <span>Min {age.min}</span>
            <span>Median {age.median}</span>
            <span>Mean {age.mean}</span>
            <span>Max {age.max}</span>
          </div>
          <StatPie data={age.histogram} colors={AGE_COLORS} />
        </div>
      )}

      {/* ── Bookings Over Time ───────────────────────────────────────────── */}
      {bookingsByMonth?.length > 1 && (
        <div className="stats-card">
          <SectionTitle>Bookings by Month</SectionTitle>
          <VBar data={bookingsByMonth} nameKey="month" color={C.primary} />
        </div>
      )}

      {/* ── Length of Stay (released bookings only) ──────────────────────── */}
      {stay && (
        <div className="stats-card">
          <SectionTitle>Length of Stay</SectionTitle>
          <p className="stats-card-note">Based on {stay.count} completed release{stay.count !== 1 ? 's' : ''}.</p>
          <div className="stats-age-meta">
            <span>Min {stay.min}d</span>
            <span>Median {stay.median}d</span>
            <span>Mean {stay.mean}d</span>
            <span>Max {stay.max}d</span>
          </div>
          <VBar data={stay.histogram} color={C.accent} />
        </div>
      )}
    </div>
  )
}
