// ====================================================================
//  screens/journal.jsx — Журнал записей (календарь-таймлайн)
//  Переработано: без багов sticky-шапки, явные «свободные окна»,
//  каждый мастер видит ближайшее окно сверху колонки.
// ====================================================================

const DAY_START_MIN = 9 * 60;   // 09:00
const DAY_END_MIN = 20 * 60;    // 20:00
const ROW_H = 36;               // px per 30-min slot
const NOW_MIN = 14 * 60 + 48;   // demo "now"

/* ---------- helpers ---------- */
function minutesOf(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
function formatMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
function durationLabel(min) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h} ${h === 1 ? 'час' : h < 5 ? 'часа' : 'часов'}`;
  return `${h} ч ${m} мин`;
}
function freeSlotsFor(masterKey) {
  const my = APPOINTMENTS.filter(a => a.master === masterKey && a.status !== 'cancelled');
  const intervals = my.map(a => {
    const start = minutesOf(a.time);
    return { start, end: start + a.duration };
  }).sort((a, b) => a.start - b.start);
  // merge overlapping
  const merged = [];
  for (const iv of intervals) {
    if (merged.length && iv.start < merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  const slots = [];
  let cursor = DAY_START_MIN;
  for (const iv of merged) {
    if (iv.start - cursor >= 30) slots.push({ start: cursor, end: iv.start });
    cursor = Math.max(cursor, iv.end);
  }
  if (DAY_END_MIN - cursor >= 30) slots.push({ start: cursor, end: DAY_END_MIN });
  return slots;
}
function nextFreeAfter(slots, fromMin) {
  return slots.find(s => s.end > fromMin && s.end - Math.max(s.start, fromMin) >= 30);
}

/* ============================================================
   Top screen
   ============================================================ */
function JournalScreen() {
  const [view, setView] = useState('timeline'); // 'timeline' | 'list'
  const [editing, setEditing] = useState(null); // appointment id, 'new', or prefilled obj

  const masters = [
    { key: 'master1', user: USERS.master1 },
    { key: 'master2', user: USERS.master2 },
  ];

  const counts = Object.keys(APPT_STATUS).reduce((acc, k) => {
    acc[k] = APPOINTMENTS.filter(a => a.status === k).length;
    return acc;
  }, {});

  // Pre-compute slots once
  const slotsByMaster = masters.reduce((acc, m) => {
    acc[m.key] = freeSlotsFor(m.key);
    return acc;
  }, {});

  function openNew(prefill) {
    setEditing({ kind: 'new', ...prefill });
  }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><span>CRM</span><span className="sep">/</span><span className="cur">Журнал записей</span></div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Журнал записей</h1>
            <span className="badge"><span className="dot success" />YCLIENTS · 14:49</span>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <Link to="/crm" className="btn">← К воронке</Link>
          <button className="btn primary" onClick={() => openNew({})}>{Ic.plus} Новая запись</button>
        </div>
      </div>

      {/* Day navigator strip */}
      <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 4, padding: 2, height: 36}}>
          <IconBtn icon="chevL" kind="ghost" />
          <div style={{padding: '0 14px', textAlign: 'center', minWidth: 150}}>
            <div style={{fontSize: 13, fontWeight: 600, lineHeight: 1.1}}>23 мая 2026 · Пт</div>
            <div style={{fontSize: 9, color: 'var(--rust)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2}}>сегодня</div>
          </div>
          <IconBtn icon="chevR" kind="ghost" />
        </div>
        <button className="btn">Сегодня</button>
        <button className="btn">Эта неделя</button>

        <div style={{flex: 1}} />

        {/* Status legend */}
        <div style={{display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap'}}>
          {Object.entries(APPT_STATUS).map(([k, v]) => (
            counts[k] > 0 && (
              <div key={k} style={{display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-2)'}}>
                <span className={`dot ${v.tone}`} />
                {v.label}
                <span style={{fontFamily: 'var(--f-mono)', color: 'var(--muted)', fontSize: 10, fontWeight: 600}}>{counts[k]}</span>
              </div>
            )
          ))}
        </div>

        <div className="seg">
          <button className={`seg-btn ${view === 'timeline' ? 'on' : ''}`} onClick={() => setView('timeline')}>Таймлайн</button>
          <button className={`seg-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>Список</button>
        </div>
      </div>

      {/* Quick "next-free" strip per master — at-a-glance window finder */}
      {view === 'timeline' && <NextFreeStrip masters={masters} slotsByMaster={slotsByMaster} onPick={openNew} />}

      {view === 'timeline' && (
        <div style={{display: 'grid', gridTemplateColumns: editing ? '1fr 380px' : '1fr', gap: 16, alignItems: 'flex-start'}}>
          <TimelineGrid
            masters={masters}
            slotsByMaster={slotsByMaster}
            editingId={typeof editing === 'string' ? editing : null}
            onPick={(id) => setEditing(id)}
            onPickFree={openNew}
          />
          {editing && <AppointmentSidePanel item={editing} onClose={() => setEditing(null)} />}
        </div>
      )}

      {view === 'list' && <AppointmentsList onPick={(id) => setEditing(id)} />}
    </div>
  );
}

/* ============================================================
   Top strip — ближайшее окно для каждого мастера
   ============================================================ */
function NextFreeStrip({ masters, slotsByMaster, onPick }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${masters.length}, 1fr)`, gap: 12,
      marginBottom: 14,
    }}>
      {masters.map(m => {
        const slots = slotsByMaster[m.key];
        const next = nextFreeAfter(slots, NOW_MIN);
        const todayFree = slots.filter(s => s.end > NOW_MIN);
        const totalFreeMin = todayFree.reduce((s, sl) => s + (sl.end - Math.max(sl.start, NOW_MIN)), 0);

        return (
          <div key={m.key} style={{
            background: next ? 'var(--success-tint)' : 'var(--surface-deep)',
            border: '1px solid ' + (next ? 'var(--success-tint-strong)' : 'var(--line)'),
            borderLeft: '3px solid ' + (next ? 'var(--success)' : 'var(--muted)'),
            borderRadius: 4, padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <Avatar initials={m.user.initials} size={32} tone="neutral" />
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 12, fontWeight: 600, color: 'var(--ink)'}}>{m.user.name}</div>
              {next ? (
                <div style={{fontSize: 12, color: 'var(--ink-2)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                  <span>Ближайшее окно</span>
                  <span className="l-mono" style={{fontWeight: 700, color: 'var(--success)'}}>{formatMin(Math.max(next.start, NOW_MIN))} — {formatMin(next.end)}</span>
                  <span style={{color: 'var(--muted)'}}>·</span>
                  <span style={{color: 'var(--muted)'}}>{durationLabel(next.end - Math.max(next.start, NOW_MIN))}</span>
                  <span style={{color: 'var(--muted)'}}>· до конца дня свободно {durationLabel(totalFreeMin)}</span>
                </div>
              ) : (
                <div style={{fontSize: 12, color: 'var(--muted)', marginTop: 3}}>Свободных окон больше нет</div>
              )}
            </div>
            <button
              className="btn sm primary"
              disabled={!next}
              onClick={() => next && onPick({
                master: m.key,
                time: formatMin(Math.max(next.start, NOW_MIN)),
                duration: Math.min(60, next.end - Math.max(next.start, NOW_MIN)),
              })}
            >
              {Ic.plus} Записать
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Timeline grid
   ============================================================ */
function TimelineGrid({ masters, slotsByMaster, editingId, onPick, onPickFree }) {
  const TIME_COL_W = 80;
  // Half-hour rows
  const totalRows = (DAY_END_MIN - DAY_START_MIN) / 30;
  const gridH = totalRows * ROW_H;
  const nowOffset = ((NOW_MIN - DAY_START_MIN) / 30) * ROW_H;

  return (
    <div className="card" style={{padding: 0, overflow: 'hidden'}}>
      {/* Master columns header (NOT sticky — was causing the overlap bug) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${TIME_COL_W}px repeat(${masters.length}, 1fr)`,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line-strong)',
      }}>
        <div style={{padding: '14px 14px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase'}}>Время</div>
        {masters.map(m => {
          const myAppts = APPOINTMENTS.filter(a => a.master === m.key);
          const stats = {
            done: myAppts.filter(a => a.status === 'done').length,
            future: myAppts.filter(a => ['wait', 'confirmed'].includes(a.status)).length,
            active: myAppts.filter(a => a.status === 'in-work').length,
            noshow: myAppts.filter(a => a.status === 'no-show').length,
          };
          return (
            <div key={m.key} style={{
              padding: '12px 16px', borderLeft: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <Avatar initials={m.user.initials} size={32} />
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontSize: 13, fontWeight: 600, lineHeight: 1.1}}>{m.user.name}</div>
                <div style={{fontSize: 10, color: 'var(--muted)', marginTop: 3, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600}}>{m.user.roleLabel}</div>
              </div>
              <div style={{display: 'flex', gap: 6, fontSize: 10, fontFamily: 'var(--f-mono)'}}>
                {stats.active > 0 && <span style={{padding: '2px 5px', background: 'var(--rust-tint)', color: 'var(--rust)', fontWeight: 700, borderRadius: 2}}>{stats.active}↻</span>}
                <span style={{padding: '2px 5px', background: 'var(--success-tint)', color: 'var(--success)', fontWeight: 700, borderRadius: 2}}>{stats.done}✓</span>
                <span style={{padding: '2px 5px', background: 'var(--info-tint)', color: 'var(--info)', fontWeight: 700, borderRadius: 2}}>{stats.future}↑</span>
                {stats.noshow > 0 && <span style={{padding: '2px 5px', background: 'var(--danger-tint)', color: 'var(--danger)', fontWeight: 700, borderRadius: 2}}>{stats.noshow}×</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid body */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${TIME_COL_W}px repeat(${masters.length}, 1fr)`,
        position: 'relative',
      }}>
        {/* Time column */}
        <div>
          {Array.from({length: totalRows}).map((_, i) => {
            const min = DAY_START_MIN + i * 30;
            const isHour = min % 60 === 0;
            return (
              <div key={i} style={{
                height: ROW_H,
                padding: '6px 14px 0',
                borderBottom: '1px solid ' + (isHour ? 'var(--line-strong)' : 'transparent'),
              }}>
                {isHour && (
                  <span className="l-mono" style={{fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', letterSpacing: '0.04em'}}>{formatMin(min)}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Master columns */}
        {masters.map(m => (
          <MasterColumn
            key={m.key}
            masterKey={m.key}
            slots={slotsByMaster[m.key]}
            gridH={gridH}
            editingId={editingId}
            onPick={onPick}
            onPickFree={(slot) => onPickFree({
              master: m.key,
              time: formatMin(slot.start),
              duration: Math.min(60, slot.end - slot.start),
            })}
          />
        ))}

        {/* "Now" line — across master columns only */}
        <div style={{
          position: 'absolute', left: TIME_COL_W, right: 0, top: nowOffset, height: 0,
          borderTop: '1.5px solid var(--rust)', pointerEvents: 'none', zIndex: 2,
        }}>
          <div style={{
            position: 'absolute', top: -10, left: -2,
            padding: '2px 7px', background: 'var(--rust)', color: '#fff',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            fontFamily: 'var(--f-mono)', borderRadius: 2,
          }}>NOW · {formatMin(NOW_MIN)}</div>
        </div>
      </div>
    </div>
  );
}

function MasterColumn({ masterKey, slots, gridH, editingId, onPick, onPickFree }) {
  const myAppts = APPOINTMENTS.filter(a => a.master === masterKey);

  return (
    <div style={{
      position: 'relative',
      borderLeft: '1px solid var(--line)',
      height: gridH,
      background: 'var(--surface-sunk)',
    }}>
      {/* Background half-hour grid */}
      {Array.from({length: gridH / ROW_H}).map((_, i) => {
        const isHour = i % 2 === 0;
        return (
          <div key={i} style={{
            height: ROW_H,
            borderBottom: '1px solid ' + (isHour ? 'var(--line-strong)' : 'var(--line-dashed)'),
            background: isHour ? 'var(--surface)' : 'var(--surface-sunk)',
          }} />
        );
      })}

      {/* Free slots — clickable, prefilled new appointment */}
      {slots.map((s, i) => {
        const isPast = s.end <= NOW_MIN;
        const top = ((s.start - DAY_START_MIN) / 30) * ROW_H;
        const height = ((s.end - s.start) / 30) * ROW_H;
        return (
          <button
            key={i}
            onClick={() => !isPast && onPickFree(s)}
            disabled={isPast}
            style={{
              position: 'absolute', top: top + 2, left: 6, right: 6, height: height - 4,
              background: isPast ? 'transparent' : 'rgba(21,128,61,0.04)',
              border: '1px dashed ' + (isPast ? 'var(--line)' : 'var(--success-tint-strong)'),
              borderRadius: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              color: isPast ? 'var(--faint)' : 'var(--success)',
              fontSize: 11, fontWeight: 600,
              cursor: isPast ? 'default' : 'pointer',
              overflow: 'hidden', padding: '0 8px',
              transition: 'background 100ms, border-color 100ms',
            }}
            onMouseEnter={e => { if (!isPast) { e.currentTarget.style.background = 'var(--success-tint)'; e.currentTarget.style.borderColor = 'var(--success)'; } }}
            onMouseLeave={e => { if (!isPast) { e.currentTarget.style.background = 'rgba(21,128,61,0.04)'; e.currentTarget.style.borderColor = 'var(--success-tint-strong)'; } }}
          >
            {height >= 30 && (
              <>
                {!isPast && <span style={{fontSize: 14, lineHeight: 1}}>+</span>}
                <span className="l-mono">
                  {formatMin(s.start)}—{formatMin(s.end)}
                </span>
                {height >= 50 && <span style={{color: 'var(--muted)', fontWeight: 500}}>· {isPast ? 'было свободно' : `свободно ${durationLabel(s.end - s.start)}`}</span>}
              </>
            )}
          </button>
        );
      })}

      {/* Appointments */}
      {myAppts.map(a => (
        <AppointmentBlock key={a.id} a={a} active={editingId === a.id} onPick={() => onPick(a.id)} />
      ))}
    </div>
  );
}

/* ============================================================
   Appointment block
   ============================================================ */
function AppointmentBlock({ a, active, onPick }) {
  const start = minutesOf(a.time);
  const top = ((start - DAY_START_MIN) / 30) * ROW_H;
  const height = (a.duration / 30) * ROW_H - 3;

  const c = CLIENTS.find(x => x.id === a.client);
  const status = APPT_STATUS[a.status];
  const isPast = start + a.duration <= NOW_MIN && a.status !== 'in-work';

  const toneColor = {
    success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
    info: 'var(--info)', rust: 'var(--rust)', neutral: 'var(--muted)',
  }[status.tone];
  const toneBg = {
    success: 'var(--success-tint)', warning: 'var(--warning-tint)', danger: 'var(--danger-tint)',
    info: 'var(--info-tint)', rust: 'var(--rust-tint)', neutral: 'var(--surface-deep)',
  }[status.tone];

  const compact = a.duration <= 30;

  // Compact (30-min) cards: single-row layout "time · client · status" — no clipping
  if (compact) {
    return (
      <button
        onClick={onPick}
        style={{
          position: 'absolute', top: top + 2, left: 6, right: 6, height,
          background: 'var(--surface)',
          border: `1px solid ${active ? 'var(--ink)' : 'var(--line-strong)'}`,
          borderLeft: `3px solid ${toneColor}`,
          borderRadius: 3,
          padding: '0 8px',
          cursor: 'pointer', overflow: 'hidden', textAlign: 'left',
          boxShadow: active ? '0 0 0 2px var(--rust-tint)' : 'var(--shadow-sm)',
          opacity: isPast && a.status !== 'no-show' ? 0.85 : 1,
          zIndex: 1,
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span className="l-mono" style={{fontSize: 11, fontWeight: 700, color: 'var(--ink)', flexShrink: 0}}>{a.time}</span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
        }}>{c.name}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 2,
          background: toneBg, color: toneColor, letterSpacing: '0.04em',
          textTransform: 'uppercase', whiteSpace: 'nowrap', lineHeight: 1.4, flexShrink: 0,
        }}>{status.label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onPick}
      style={{
        position: 'absolute', top: top + 2, left: 6, right: 6, height,
        background: 'var(--surface)',
        border: `1px solid ${active ? 'var(--ink)' : 'var(--line-strong)'}`,
        borderLeft: `3px solid ${toneColor}`,
        borderRadius: 3,
        padding: '6px 10px',
        cursor: 'pointer', overflow: 'hidden', textAlign: 'left',
        boxShadow: active ? '0 0 0 2px var(--rust-tint)' : 'var(--shadow-sm)',
        opacity: isPast && a.status !== 'no-show' ? 0.85 : 1,
        zIndex: 1,
        display: 'flex', flexDirection: 'column', gap: 3,
      }}
    >
      {/* Top row: time + status pill */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexShrink: 0}}>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0}}>
          <span className="l-mono" style={{fontSize: 11, fontWeight: 700, color: 'var(--ink)'}}>{a.time}</span>
          <span style={{fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--f-mono)', fontWeight: 500}}>{a.duration} мин</span>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 2,
          background: toneBg, color: toneColor, letterSpacing: '0.04em',
          textTransform: 'uppercase', whiteSpace: 'nowrap', lineHeight: 1.4,
        }}>{status.label}</span>
      </div>

      <div style={{
        fontSize: 12, fontWeight: 600, color: 'var(--ink)', flexShrink: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{c.name}</div>

      <div style={{fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0}}>
        {c.car.split(' (')[0]} · <span className="l-mono">{c.plate}</span>
      </div>
      {height > 80 && (
        <div style={{fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2}}>{a.service}</div>
      )}
    </button>
  );
}

/* ============================================================
   Side panel — appointment editor / detail
   ============================================================ */
function AppointmentSidePanel({ item, onClose }) {
  const isNew = item === 'new' || (item && item.kind === 'new');
  const prefill = (item && item.kind === 'new') ? item : null;
  const a = !isNew ? APPOINTMENTS.find(x => x.id === item) : {
    time: prefill?.time || '15:00',
    duration: prefill?.duration || 60,
    master: prefill?.master || 'master1',
    client: '',
    service: '',
    status: 'wait',
    source: 'phone',
  };
  const c = !isNew && a ? CLIENTS.find(x => x.id === a.client) : null;
  const status = !isNew ? APPT_STATUS[a.status] : null;

  return (
    <aside style={{
      position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h) + 16px)',
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4,
      maxHeight: 'calc(100vh - var(--topbar-h) - var(--substrip-h) - 32px)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div className="panel-head">
        <div>
          <div className="l-eyebrow muted">{isNew ? 'Новая запись' : `Запись ${a.id}`}</div>
          <div className="h-h3" style={{marginTop: 2}}>{isNew ? 'Заполни данные' : c?.name}</div>
        </div>
        <IconBtn icon="x" kind="ghost" onClick={onClose} />
      </div>

      <div style={{padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14}}>
        {!isNew && (
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
            <span className={`badge ${status.tone}`}><span className={`dot ${status.tone}`} />{status.label}</span>
            <span className="badge outline">
              <span style={{display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: SOURCES[a.source].color, marginRight: 4}} />
              {SOURCES[a.source].label}
            </span>
          </div>
        )}

        {isNew && prefill && (
          <div className="banner info">
            <span style={{display: 'flex'}}>{Ic.info}</span>
            <div>
              <div className="b-title">Окно подставлено автоматически</div>
              <div className="b-body">
                {USERS[prefill.master]?.name} · {prefill.time} · {durationLabel(prefill.duration)}.
                Меняй любые поля.
              </div>
            </div>
          </div>
        )}

        <div className="form-grid cols-2">
          <div className="field">
            <label className="field-label">Дата</label>
            <input className="inp" defaultValue="23.05.2026" />
          </div>
          <div className="field">
            <label className="field-label">Время</label>
            <input className="inp mono" defaultValue={a.time} />
          </div>
        </div>

        <div className="form-grid cols-2">
          <div className="field">
            <label className="field-label">Длительность</label>
            <select className="inp" defaultValue={a.duration}>
              <option value="30">30 мин</option>
              <option value="60">1 час</option>
              <option value="90">1.5 часа</option>
              <option value="120">2 часа</option>
              <option value="180">3 часа</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Мастер</label>
            <select className="inp" defaultValue={a.master}>
              <option value="master1">Сергей Игнатенко</option>
              <option value="master2">Артём Войтов</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label">Клиент</label>
          {c ? (
            <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 4}}>
              <Avatar initials={c.name.split(' ').map(s => s[0]).join('')} size={32} />
              <div style={{flex: 1}}>
                <div style={{fontSize: 13, fontWeight: 600}}>{c.name}</div>
                <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)'}}>{c.phone} · {c.visits} визитов</div>
              </div>
              <button className="btn sm ghost">Сменить</button>
            </div>
          ) : (
            <div className="inp-wrap">
              <span className="lead">{Ic.search}</span>
              <input className="inp" placeholder="Имя или телефон…" />
            </div>
          )}
        </div>

        {c && (
          <div className="field">
            <label className="field-label">Автомобиль</label>
            <div style={{padding: 10, background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 4}}>
              <div style={{fontSize: 13, fontWeight: 600}}>{c.car}</div>
              <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 4}}>{c.plate} · VIN {c.vin}</div>
            </div>
          </div>
        )}

        <div className="field">
          <label className="field-label">Услуга</label>
          <input className="inp" defaultValue={a.service || ''} placeholder="Что будем делать" />
        </div>

        <div className="field">
          <label className="field-label">Источник</label>
          <select className="inp" defaultValue={a.source}>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {!isNew && (
          <div className="field">
            <label className="field-label">Статус</label>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4}}>
              {Object.entries(APPT_STATUS).map(([k, v]) => (
                <button key={k} className={`btn sm ${k === a.status ? '' : 'ghost'}`} style={{
                  height: 30, fontSize: 11, padding: '0 8px', justifyContent: 'flex-start',
                  ...(k === a.status ? {background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)'} : {}),
                }}>
                  <span className={`dot ${v.tone}`} />
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label className="field-label">Комментарий</label>
          <textarea
            className="inp" rows="3"
            style={{height: 'auto', padding: 10, fontFamily: 'var(--f-sans)'}}
            placeholder="Например: просил приехать пораньше, машина греется"
          />
        </div>

        {!isNew && (
          <div className="banner info">
            <span style={{display: 'flex'}}>{Ic.info}</span>
            <div>
              <div className="b-title">Синхронизация с YCLIENTS</div>
              <div className="b-body">Запись синхронизируется с YCLIENTS · подтверждение клиенту уйдёт автоматически через 5 минут.</div>
            </div>
          </div>
        )}
      </div>

      <div className="panel-foot">
        {!isNew && <button className="btn danger sm">{Ic.trash} Удалить</button>}
        <div style={{flex: 1}} />
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn primary">{isNew ? 'Создать запись' : 'Сохранить'}</button>
      </div>
    </aside>
  );
}

/* ============================================================
   List view (alternative)
   ============================================================ */
function AppointmentsList({ onPick }) {
  const sorted = [...APPOINTMENTS].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Время</th>
            <th>Клиент</th>
            <th>Авто</th>
            <th>Услуга</th>
            <th>Мастер</th>
            <th>Источник</th>
            <th>Статус</th>
            <th style={{width: 80}}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(a => {
            const c = CLIENTS.find(x => x.id === a.client);
            const m = USERS[a.master];
            const status = APPT_STATUS[a.status];
            const source = SOURCES[a.source];
            return (
              <tr key={a.id} onClick={() => onPick(a.id)} style={{cursor: 'pointer'}}>
                <td>
                  <div className="l-mono" style={{fontSize: 14, fontWeight: 700}}>{a.time}</div>
                  <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{a.duration} мин</div>
                </td>
                <td>
                  <div style={{fontWeight: 500, color: 'var(--ink)'}}>{c.name}</div>
                  <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{c.phone}</div>
                </td>
                <td>{c.car} · <span className="l-mono">{c.plate}</span></td>
                <td>{a.service}</td>
                <td>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <Avatar initials={m.initials} size={22} tone="neutral" />
                    <span style={{fontSize: 12}}>{m.name.split(' ')[1]}</span>
                  </div>
                </td>
                <td>
                  <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12}}>
                    <span style={{width: 6, height: 6, borderRadius: '50%', background: source.color}} />
                    {source.label}
                  </span>
                </td>
                <td><span className={`badge ${status.tone} sm`}><span className={`dot ${status.tone}`} />{status.label}</span></td>
                <td>
                  <div className="row-action">
                    <IconBtn icon="edit" kind="ghost" />
                    <IconBtn icon="more" kind="ghost" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

Object.assign(window, { JournalScreen });
