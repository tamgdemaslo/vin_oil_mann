// ====================================================================
//  platform/components.jsx — shared UI primitives
// ====================================================================
const { useState, useEffect, useRef, useMemo, createContext, useContext } = React;

/* ---------- formatting ---------- */
const fmtMoney = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const fmtMoneyPlain = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n));
const fmtNum = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n));

/* ---------- Icon set (inline SVG) ---------- */
const Ic = {
  search:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  chevD:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>,
  chevR:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>,
  chevL:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>,
  plus:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>,
  x:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  filter:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h18l-7 9v5l-4 2v-7L3 5z" /></svg>,
  print:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>,
  download:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>,
  more:    <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>,
  edit:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20h4l11-11-4-4L4 16v4z" /></svg>,
  trash:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" /></svg>,
  check:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>,
  copy:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="1" /><path d="M5 15V5a1 1 0 011-1h10" /></svg>,
  alert:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg>,
  info:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></svg>,
  lock:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>,
  play:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5z" /></svg>,
  pause:   <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>,
  user:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>,
  car:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 14h18M5 14v3a1 1 0 001 1h1a1 1 0 001-1v-1M16 14v3a1 1 0 001 1h1a1 1 0 001-1v-3M5 14l2-6h10l2 6M8 17h8" /></svg>,
  cash:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="1" /><circle cx="12" cy="12" r="3" /></svg>,
  box:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4M21 7v10l-9 4" /></svg>,
  chart:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V4M4 20h16M8 16V11M12 16V8M16 16v-3" /></svg>,
  bell:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 1112 0v5l2 3H4l2-3V8zM10 19a2 2 0 004 0" /></svg>,
  refresh: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 11A8 8 0 006.5 5.5L4 8M4 4v4h4M4 13a8 8 0 0013.5 5.5L20 16M20 20v-4h-4" /></svg>,
  cmd:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6h12v12H6zM6 10h12M10 6v12" /></svg>,
};

function IconBtn({ icon, kind, ...rest }) {
  return <button className={`icon-btn ${kind || ''}`} {...rest}>{Ic[icon]}</button>;
}

/* ---------- Badge with status mapping ---------- */
function StatusBadge({ status, sm }) {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return <span className={`badge ${s.tone} ${sm ? 'sm' : ''}`}><span className={`dot ${s.tone}`} />{s.label}</span>;
}

/* ---------- KPI ---------- */
function Kpi({ label, value, sub, trend, accent, mono }) {
  return (
    <div className="kpi">
      {accent && <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent}} />}
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${mono ? 'mono' : ''}`}>{value}</div>
      {(sub || trend) && (
        <div className="kpi-sub">
          {trend && <span className={`trend ${trend.dir}`}>{trend.dir === 'up' ? '↗' : '↘'} {trend.value}</span>}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}

/* ---------- Avatar ---------- */
function Avatar({ initials, size = 28, tone = 'rust' }) {
  const bg = tone === 'rust' ? 'var(--rust-tint)' : 'var(--surface-deep)';
  const fg = tone === 'rust' ? 'var(--rust)' : 'var(--ink-2)';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color: fg,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size <= 24 ? 10 : 11, fontWeight: 600, letterSpacing: '0.02em',
      flexShrink: 0,
    }}>{initials}</div>
  );
}

/* ---------- Brand mark (small for topbar) ---------- */
function BrandMark({ subtitle = 'Эко-платформа' }) {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
      <img src={(window.__resources && window.__resources.logoBlack) || "../assets/logo-wordmark-black.svg"} alt="Там где масло." style={{height: 18, display: 'block', width: 'auto'}} />
      <span style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--rust)', borderLeft: '1px solid var(--line)', paddingLeft: 12,
      }}>{subtitle}</span>
    </div>
  );
}

/* ---------- Dropdown (controlled open) ---------- */
function useOutsideClose(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open, onClose]);
  return ref;
}

function NavDropdown({ label, active, children }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  return (
    <div ref={ref} style={{position: 'relative'}}>
      <button className={`nav-link ${active ? 'active' : ''}`} onClick={() => setOpen(o => !o)} style={{border: 'none', background: open ? 'var(--surface-sunk)' : (active ? 'var(--surface-sunk)' : 'transparent')}}>
        {label} <span className="chev">{Ic.chevD}</span>
      </button>
      {open && <div className="dropdown" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

/* ---------- Router ---------- */
const RouterCtx = createContext(null);
function useRoute() { return useContext(RouterCtx); }
function Link({ to, children, ...rest }) {
  const r = useRoute();
  return <a href={'#' + to} onClick={e => { e.preventDefault(); r.go(to); }} {...rest}>{children}</a>;
}

Object.assign(window, {
  fmtMoney, fmtMoneyPlain, fmtNum,
  Ic, IconBtn, StatusBadge, Kpi, Avatar, BrandMark,
  NavDropdown, RouterCtx, useRoute, Link, useOutsideClose,
});
