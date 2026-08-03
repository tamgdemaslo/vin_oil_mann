// ====================================================================
//  screens/crm.jsx — Воронка (kanban) + карточка сделки
// ====================================================================

function CrmKanbanScreen() {
  const [scope, setScope] = useState('all'); // all | mine
  const [responsible, setResponsible] = useState('all');
  const [source, setSource] = useState('all');

  const filtered = DEALS.filter(d => {
    if (scope === 'mine' && d.responsible !== 'admin') return false;
    if (responsible !== 'all' && d.responsible !== responsible) return false;
    if (source !== 'all' && d.source !== source) return false;
    return true;
  });

  const totalSum = filtered.reduce((s, d) => s + d.sum, 0);
  const conversion = filtered.length ? Math.round(filtered.filter(d => d.stage === 'won').length / filtered.length * 100) : 0;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><span>CRM</span><span className="sep">/</span><span className="cur">Воронка</span></div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Воронка продаж</h1>
            <span className="badge">{filtered.length} сделок</span>
            <span className="badge outline">{fmtMoney(totalSum)}</span>
            <span className="badge success"><span className="dot success" />конверсия {conversion}%</span>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <Link to="/journal" className="btn">{Ic.user} Журнал записей →</Link>
          <button className="btn primary">{Ic.plus} Новая сделка</button>
        </div>
      </div>

      {/* Filter strip */}
      <div style={{display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap'}}>
        <div className="seg">
          <button className={`seg-btn ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>Все сделки</button>
          <button className={`seg-btn ${scope === 'mine' ? 'on' : ''}`} onClick={() => setScope('mine')}>Только мои</button>
        </div>
        <div className="inp-wrap" style={{width: 240}}>
          <span className="lead">{Ic.search}</span>
          <input className="inp" placeholder="Имя, телефон, № сделки…" />
        </div>
        <DropdownSelect
          label="Период"
          value="Май 2026"
          options={['Сегодня', 'Эта неделя', 'Май 2026', 'Апрель 2026', 'Всё время']}
        />
        <DropdownSelect
          label="Ответственный"
          value={responsible === 'all' ? 'Все' : USERS[responsible]?.name.split(' ')[1] || 'Все'}
          options={[{k: 'all', l: 'Все'}, {k: 'admin', l: 'Анна Л.'}, {k: 'master1', l: 'Сергей И.'}, {k: 'master2', l: 'Артём В.'}]}
          onPick={v => setResponsible(typeof v === 'object' ? v.k : v)}
        />
        <DropdownSelect
          label="Источник"
          value={source === 'all' ? 'Все' : SOURCES[source]?.label || 'Все'}
          options={[{k: 'all', l: 'Все'}, ...Object.entries(SOURCES).map(([k, v]) => ({k, l: v.label}))]}
          onPick={v => setSource(typeof v === 'object' ? v.k : v)}
        />
        <div style={{flex: 1}} />
        <div className="seg">
          <button className="seg-btn on">Канбан</button>
          <button className="seg-btn">Список</button>
        </div>
      </div>

      {/* Kanban board */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${DEAL_STAGES.length}, minmax(260px, 1fr))`,
        gap: 12, alignItems: 'start',
      }}>
        {DEAL_STAGES.map(stage => {
          const deals = filtered.filter(d => d.stage === stage.id);
          const stageSum = deals.reduce((s, d) => s + d.sum, 0);
          return (
            <div key={stage.id} style={{
              background: 'var(--surface-sunk)', border: '1px solid var(--line)',
              borderTop: `3px solid ${stage.color}`,
              minHeight: 400, display: 'flex', flexDirection: 'column',
            }}>
              {/* Column header */}
              <div style={{padding: '12px 14px 10px', borderBottom: '1px solid var(--line)', background: 'var(--surface)', position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h))'}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: 'var(--ink)',
                    }}>{stage.label}</span>
                    <span style={{
                      fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--muted)',
                      padding: '1px 6px', background: 'var(--surface-deep)', borderRadius: 2,
                    }}>{deals.length}</span>
                  </div>
                  <IconBtn icon="plus" kind="ghost" />
                </div>
                <div className="l-money" style={{fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginTop: 6}}>{fmtMoney(stageSum)}</div>
              </div>

              {/* Cards */}
              <div style={{padding: 8, display: 'flex', flexDirection: 'column', gap: 8, flex: 1}}>
                {deals.map(d => <DealCard key={d.id} deal={d} stage={stage} />)}
                {deals.length === 0 && (
                  <div style={{
                    border: '1px dashed var(--line-strong)', borderRadius: 4,
                    padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12,
                  }}>Пусто</div>
                )}
              </div>

              {/* Footer add */}
              <button style={{
                padding: '10px', background: 'transparent', border: 'none',
                color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
                borderTop: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>{Ic.plus} Сделка</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DealCard({ deal, stage }) {
  const c = CLIENTS.find(x => x.id === deal.client);
  const r = USERS[deal.responsible];
  const source = SOURCES[deal.source];
  const isWon = stage.id === 'won';
  const isLost = stage.id === 'lost';
  return (
    <Link to={`/crm/${deal.id}`}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4,
        padding: '12px 12px 10px', cursor: 'pointer',
        opacity: isLost ? 0.7 : 1,
        boxShadow: deal.overdue ? '0 0 0 1px var(--danger) inset' : 'var(--shadow-sm)',
      }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ink-3)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>
        {/* Top: id + days */}
        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 8}}>
          <span className="l-mono" style={{fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em'}}>{deal.id}</span>
          {!isWon && !isLost && (
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 10,
              color: deal.daysInStage >= 3 ? 'var(--warning)' : 'var(--muted)',
              fontWeight: deal.daysInStage >= 3 ? 600 : 400,
            }}>
              {deal.daysInStage === 0 ? 'сегодня' : `${deal.daysInStage} ${deal.daysInStage === 1 ? 'день' : 'дн.'}`}
            </span>
          )}
        </div>

        {/* Client */}
        <div style={{fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2}}>{c.name}</div>
        <div style={{fontSize: 11, color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4}}>
          <span style={{display: 'inline-flex', color: 'var(--faint)'}}>{Ic.car}</span>
          {c.car.split(' (')[0]}
        </div>

        {/* Service / comment */}
        <div style={{fontSize: 12, color: 'var(--ink-2)', marginBottom: 10, lineHeight: 1.35}}>{deal.service}</div>

        {/* Sum */}
        {deal.sum > 0 && (
          <div className="l-money" style={{
            fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 10,
          }}>{fmtMoney(deal.sum)}</div>
        )}

        {/* Footer: source + responsible + next contact */}
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px dashed var(--line-dashed)', gap: 8}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 6, minWidth: 0}}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: source.color, flexShrink: 0,
            }} />
            <span style={{fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{source.label}</span>
          </div>
          <Avatar initials={r.initials} size={18} tone="neutral" />
        </div>

        {!isWon && !isLost && deal.nextContact !== '—' && (
          <div style={{
            marginTop: 8, padding: '6px 8px',
            background: deal.overdue ? 'var(--danger-tint)' : 'var(--surface-sunk)',
            border: '1px solid ' + (deal.overdue ? 'var(--danger-tint-strong)' : 'var(--line)'),
            borderRadius: 2,
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11,
            color: deal.overdue ? 'var(--danger)' : 'var(--ink-2)',
          }}>
            <span style={{display: 'inline-flex'}}>{deal.overdue ? Ic.alert : Ic.bell}</span>
            <span style={{fontWeight: deal.overdue ? 600 : 500}}>
              {deal.overdue ? 'Просрочен контакт' : 'Связаться'}
            </span>
            <span style={{marginLeft: 'auto', fontFamily: 'var(--f-mono)'}}>{deal.nextContact}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

/* ----- Tiny dropdown-select used in filters ----- */
function DropdownSelect({ label, value, options, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  return (
    <div ref={ref} style={{position: 'relative'}}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          height: 32, padding: '0 12px', background: 'var(--surface)',
          border: '1px solid var(--line-strong)', borderRadius: 4,
          fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer',
        }}
      >
        <span style={{color: 'var(--muted)'}}>{label}:</span>
        <span style={{fontWeight: 600, color: 'var(--ink)'}}>{value}</span>
        <span style={{color: 'var(--faint)'}}>{Ic.chevD}</span>
      </button>
      {open && (
        <div className="dropdown" style={{minWidth: 200}}>
          {options.map(o => {
            const label = typeof o === 'object' ? o.l : o;
            return (
              <div key={label} className="dropdown-item" onClick={() => { onPick && onPick(o); setOpen(false); }}>{label}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Deal detail page
   ============================================================ */
function DealDetailScreen() {
  const r = useRoute();
  const id = (r.params && r.params.id) || 'D-2026-0068';
  const deal = DEALS.find(d => d.id === id) || DEALS[3];
  const stage = DEAL_STAGES.find(s => s.id === deal.stage);
  const c = CLIENTS.find(x => x.id === deal.client);
  const resp = USERS[deal.responsible];
  const source = SOURCES[deal.source];

  const [comment, setComment] = useState('');

  // For stage indicator (mini progress)
  const stageIdx = DEAL_STAGES.findIndex(s => s.id === deal.stage);

  // Mock activity timeline
  const activity = [
    { t: '14:48', who: 'Анна Л.', a: 'Открыла сделку из inbound с Instagram-DM' },
    { t: '14:50', who: 'Анна Л.', a: 'Уточнила марку машины — Audi Q7 4M' },
    { t: '14:55', who: 'Анна Л.', a: 'Переместила в стадию «В работе»' },
    { t: '15:02', who: 'Анна Л.', a: 'Создала запись на 16:00 (master2)' },
    { t: '—',     who: deal.overdue ? 'Просрочено' : 'Следующий контакт', a: deal.nextContact, future: true, warn: deal.overdue },
  ];

  return (
    <div className="container page" style={{paddingBottom: 100}}>
      <div className="page-head">
        <div>
          <div className="page-crumbs">
            <Link to="/home">Главная</Link><span className="sep">/</span>
            <Link to="/crm">CRM</Link><span className="sep">/</span>
            <span className="cur l-mono">{deal.id}</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">{deal.service}</h1>
            <span className={`badge ${stage.tone}`}><span className={`dot ${stage.tone}`} />{stage.label}</span>
            {deal.overdue && <span className="badge danger"><span className="dot danger" />просрочен контакт</span>}
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn ghost">{Ic.copy} Копия</button>
          <button className="btn">{Ic.user} Профиль клиента</button>
          <button className="btn primary">Создать отгрузку →</button>
        </div>
      </div>

      {/* Stage progress bar */}
      <div className="card card-pad" style={{marginBottom: 16}}>
        <div className="l-eyebrow muted" style={{marginBottom: 14}}>Стадия воронки</div>
        <div style={{display: 'flex', gap: 4}}>
          {DEAL_STAGES.map((s, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <div key={s.id} style={{flex: 1}}>
                <div style={{
                  height: 4, background: active ? s.color : done ? 'var(--ink-3)' : 'var(--surface-deep)',
                }} />
                <div style={{
                  marginTop: 8, fontSize: 11, fontWeight: active ? 700 : done ? 500 : 400,
                  color: active ? s.color : done ? 'var(--ink-2)' : 'var(--muted)',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>{s.label}</div>
              </div>
            );
          })}
        </div>
        <div style={{display: 'flex', gap: 8, marginTop: 14}}>
          {stageIdx > 0 && <button className="btn sm">← Назад в «{DEAL_STAGES[stageIdx-1].label}»</button>}
          {stageIdx < DEAL_STAGES.length - 1 && stage.id !== 'won' && stage.id !== 'lost' && (
            <button className="btn primary sm">В «{DEAL_STAGES[stageIdx+1].label}» →</button>
          )}
          {stage.id !== 'won' && stage.id !== 'lost' && (
            <>
              <div style={{flex: 1}} />
              <button className="btn sm">Завершить как «Завершено»</button>
              <button className="btn danger sm">Потерять</button>
            </>
          )}
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'flex-start'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {/* Client + Car */}
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Клиент и автомобиль</span><button className="btn sm ghost">{Ic.edit} Изменить</button></div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--line)'}}>
              <div style={{background: 'var(--surface)', padding: 18}}>
                <div className="l-eyebrow">Клиент</div>
                <div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 10}}>
                  <Avatar initials={c.name.split(' ').map(x => x[0]).join('')} size={40} />
                  <div>
                    <div style={{fontSize: 15, fontWeight: 600}}>{c.name}</div>
                    <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{c.phone}</div>
                  </div>
                </div>
                <div style={{marginTop: 14, display: 'flex', gap: 12, fontSize: 11, color: 'var(--muted)'}}>
                  <span>{c.visits} визитов</span>
                  <span>·</span>
                  <span>с окт. 2024</span>
                  <span>·</span>
                  <span>средний чек 12 400 ₽</span>
                </div>
              </div>
              <div style={{background: 'var(--surface)', padding: 18}}>
                <div className="l-eyebrow">Автомобиль</div>
                <div style={{fontSize: 15, fontWeight: 600, marginTop: 10}}>{c.car}</div>
                <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.06em'}}>{c.plate} · VIN {c.vin}</div>
              </div>
            </div>
          </div>

          {/* Service / comment */}
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Услуга и комментарий</span></div>
            <div style={{padding: 18}}>
              <div className="l-eyebrow muted" style={{marginBottom: 6}}>Услуга</div>
              <div style={{fontSize: 15, fontWeight: 600, marginBottom: 14}}>{deal.service}</div>
              <div className="l-eyebrow muted" style={{marginBottom: 6}}>Комментарий</div>
              <div style={{fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, padding: 12, background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 4}}>
                {deal.comment}
              </div>
            </div>
          </div>

          {/* Activity */}
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Активность</span><span className="badge sm">{activity.length}</span></div>
            <div style={{padding: '4px 0 0'}}>
              {activity.map((h, i) => (
                <div key={i} style={{display: 'flex', gap: 16, padding: '10px 16px', borderBottom: i === activity.length - 1 ? 'none' : '1px solid var(--line)', alignItems: 'baseline', opacity: h.future ? 0.85 : 1}}>
                  <span className="l-mono" style={{fontSize: 12, color: 'var(--muted)', minWidth: 50}}>{h.t}</span>
                  <span style={{fontSize: 12, fontWeight: 600, minWidth: 110, color: h.warn ? 'var(--danger)' : 'var(--ink)'}}>{h.who}</span>
                  <span style={{fontSize: 12.5, color: h.warn ? 'var(--danger)' : 'var(--ink-2)', fontFamily: h.future ? 'var(--f-mono)' : 'var(--f-sans)'}}>{h.a}</span>
                </div>
              ))}
            </div>
            <div style={{padding: 12, borderTop: '1px solid var(--line)', display: 'flex', gap: 8}}>
              <input
                className="inp"
                placeholder="Записать комментарий по сделке…"
                value={comment}
                onChange={e => setComment(e.target.value)}
                style={{flex: 1}}
              />
              <button className="btn primary" disabled={!comment.trim()}>Добавить</button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside style={{position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h) + 16px)', display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Сделка</span></div>
            <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
              <Row k="Сумма" v={deal.sum > 0 ? fmtMoney(deal.sum) : '— уточняется —'} />
              <Row k="Источник" v={<span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}><span style={{width: 6, height: 6, borderRadius: '50%', background: source.color}} />{source.label}</span>} />
              <Row k="Создана" v={deal.createdAt} />
              <Row k="В стадии" v={deal.daysInStage === 0 ? 'сегодня' : `${deal.daysInStage} ${deal.daysInStage === 1 ? 'день' : 'дней'}`} />
              <Row k="Последняя активность" v={deal.activity} />
              <div className="divider-dashed" />
              <Row k="Ответственный" v={
                <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                  <Avatar initials={resp.initials} size={18} tone="neutral" />
                  {resp.name.split(' ')[1]}
                </span>
              } />
              <Row k="Следующий контакт" v={
                <span style={{
                  fontFamily: 'var(--f-mono)',
                  color: deal.overdue ? 'var(--danger)' : 'var(--ink)',
                  fontWeight: deal.overdue ? 700 : 600,
                }}>{deal.nextContact}</span>
              } />
            </div>
            <div className="panel-foot">
              <button className="btn sm">{Ic.edit} Изменить</button>
              <button className="btn sm">{Ic.bell} Напомнить</button>
            </div>
          </div>

          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Действия</span></div>
            <div style={{padding: '4px 4px 8px'}}>
              {[
                { l: 'Записать на сервис', d: 'создать запись в журнале', i: 'plus', accent: true, to: '/journal' },
                { l: 'Открыть в Telegram',  d: '@tamgdemaslo',             i: 'chevR' },
                { l: 'Позвонить клиенту',   d: c.phone,                    i: 'chevR' },
                { l: 'Создать счёт',        d: 'для юр. лица',             i: 'chevR' },
              ].map((a, i) => (
                <Link key={i} to={a.to || '#'} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderRadius: 4}}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 4,
                    background: a.accent ? 'var(--rust-tint)' : 'var(--surface-deep)',
                    color: a.accent ? 'var(--rust)' : 'var(--ink-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>{Ic[a.i]}</span>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div style={{fontSize: 12.5, fontWeight: 500}}>{a.l}</div>
                    <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{a.d}</div>
                  </div>
                  <span style={{color: 'var(--faint)'}}>{Ic.chevR}</span>
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { CrmKanbanScreen, DealDetailScreen, DropdownSelect });
