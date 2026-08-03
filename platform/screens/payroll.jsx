// ====================================================================
//  screens/payroll.jsx — Зарплата (владелец / сотрудник) + правила
// ====================================================================

function PayrollScreen() {
  const [view, setView] = useState('owner'); // owner | employee
  const [tab, setTab] = useState('current'); // current | calendar | rules | log

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><span>Финансы</span><span className="sep">/</span><span className="cur">Зарплата</span></div>
          <h1 className="page-title">Зарплата <span className="muted" style={{fontSize: 16, fontWeight: 500}}>· {PAYROLL.period} · до {PAYROLL.payoutDate}</span></h1>
        </div>
        <div className="seg">
          <button className={`seg-btn ${view === 'owner' ? 'on' : ''}`} onClick={() => setView('owner')}>Владелец</button>
          <button className={`seg-btn ${view === 'employee' ? 'on' : ''}`} onClick={() => setView('employee')}>Сотрудник (Сергей)</button>
        </div>
      </div>

      <div className="tabs" style={{marginBottom: 16}}>
        <button className={`tab ${tab === 'current' ? 'active' : ''}`} onClick={() => setTab('current')}>{view === 'owner' ? 'Все сотрудники' : 'Мои начисления'}<span className="count">{view === 'owner' ? EMPLOYEES.length : 4}</span></button>
        <button className={`tab ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>Рабочие дни</button>
        {view === 'owner' && <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>Правила сдельной<span className="count">{PIECE_RULES.length}</span></button>}
        <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>Бонусы и штрафы<span className="count">{BONUS_PENALTY_LOG.length}</span></button>
      </div>

      {view === 'owner' && tab === 'current' && <OwnerPayrollTable />}
      {view === 'owner' && tab === 'calendar' && <CalendarView />}
      {view === 'owner' && tab === 'rules' && <PieceRulesView />}
      {view === 'owner' && tab === 'log' && <BonusLogView />}

      {view === 'employee' && tab === 'current' && <EmployeePayrollView />}
      {view === 'employee' && tab === 'calendar' && <CalendarView employee="master1" />}
      {view === 'employee' && tab === 'log' && <BonusLogView employee="master1" />}
    </div>
  );
}

/* ============================================================
   Owner: full payroll table
   ============================================================ */
function OwnerPayrollTable() {
  const totalFund = PAYROLL.rows.reduce((s, r) => {
    const emp = EMPLOYEES.find(e => e.id === r.emp);
    const baseShare = Math.round(emp.rate.base * r.daysWorked / PAYROLL.totalDaysInMonth);
    return s + baseShare + r.pieceSum + r.bonus - r.penalty;
  }, 0);

  return (
    <>
      {/* KPI strip */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16}}>
        <Kpi accent="var(--rust)" label="Фонд оплаты · к выплате" value={fmtMoney(totalFund)} sub={`${EMPLOYEES.length} сотрудников · до ${PAYROLL.payoutDate}`} mono />
        <Kpi label="Окладная часть" value={fmtMoney(PAYROLL.rows.reduce((s, r) => s + Math.round(EMPLOYEES.find(e => e.id === r.emp).rate.base * r.daysWorked / PAYROLL.totalDaysInMonth), 0))} mono />
        <Kpi accent="var(--success)" label="Сдельная часть" value={fmtMoney(PAYROLL.rows.reduce((s, r) => s + r.pieceSum, 0))} sub="14 руб/отгрузку в среднем" mono />
        <Kpi label="Бонусы − штрафы" value={fmtMoney(PAYROLL.rows.reduce((s, r) => s + r.bonus - r.penalty, 0))} sub={`${BONUS_PENALTY_LOG.filter(b => b.kind === 'bonus').length} бонусов · ${BONUS_PENALTY_LOG.filter(b => b.kind === 'penalty').length} штрафов`} mono />
      </div>

      {/* Table */}
      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <span className="l-meta">{PAYROLL.rows.length} сотрудников · период {PAYROLL.workingDaysInPeriod} из {PAYROLL.totalDaysInMonth} раб. дней</span>
          <div style={{flex: 1}} />
          <button className="btn sm ghost">{Ic.download} Выгрузка</button>
          <button className="btn sm ghost">{Ic.print} Печать ведомости</button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th className="num">Дней</th>
              <th className="num">Часов</th>
              <th className="num">Отгрузок</th>
              <th className="num">Оклад · доля</th>
              <th className="num">Сдельная</th>
              <th className="num">Бонус</th>
              <th className="num">Штраф</th>
              <th className="num">К выплате</th>
              <th style={{width: 60}}></th>
            </tr>
          </thead>
          <tbody>
            {PAYROLL.rows.map(r => {
              const emp = EMPLOYEES.find(e => e.id === r.emp);
              const baseShare = Math.round(emp.rate.base * r.daysWorked / PAYROLL.totalDaysInMonth);
              const total = baseShare + r.pieceSum + r.bonus - r.penalty;
              return (
                <tr key={r.emp}>
                  <td>
                    <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                      <Avatar initials={emp.initials} size={28} tone="neutral" />
                      <div>
                        <div style={{fontWeight: 600, color: 'var(--ink)'}}>{emp.name}</div>
                        <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{emp.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{r.daysWorked} <span style={{color: 'var(--muted)', fontFamily: 'var(--f-mono)', fontSize: 11}}>/ {PAYROLL.workingDaysInPeriod}</span></td>
                  <td className="num">{r.hoursWorked}</td>
                  <td className="num">{r.shipments > 0 ? r.shipments : '—'}</td>
                  <td className="num">{fmtMoneyPlain(baseShare)} ₽<div className="l-mono" style={{fontSize: 10, color: 'var(--muted)', marginTop: 2}}>из {fmtMoneyPlain(emp.rate.base)}</div></td>
                  <td className="num" style={{color: r.pieceSum > 0 ? 'var(--success)' : 'var(--muted)', fontWeight: 600}}>{r.pieceSum > 0 ? fmtMoneyPlain(r.pieceSum) + ' ₽' : '—'}</td>
                  <td className="num">
                    {r.bonus > 0 ? (
                      <div style={{textAlign: 'right'}}>
                        <div style={{color: 'var(--success)', fontWeight: 700, fontFamily: 'var(--f-mono)'}}>+ {fmtMoneyPlain(r.bonus)}</div>
                        {r.bonusReason && <div style={{fontSize: 10, color: 'var(--muted)', marginTop: 2}}>{r.bonusReason}</div>}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="num">
                    {r.penalty > 0 ? (
                      <div style={{textAlign: 'right'}}>
                        <div style={{color: 'var(--danger)', fontWeight: 700, fontFamily: 'var(--f-mono)'}}>− {fmtMoneyPlain(r.penalty)}</div>
                        {r.penaltyReason && <div style={{fontSize: 10, color: 'var(--muted)', marginTop: 2}}>{r.penaltyReason}</div>}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="num strong" style={{fontSize: 15, fontWeight: 700}}>{fmtMoney(total)}</td>
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
          <tfoot>
            <tr style={{background: 'var(--surface-deep)', fontWeight: 700}}>
              <td colSpan={8} style={{padding: '12px 14px', borderTop: '2px solid var(--ink)'}}>ИТОГО К ВЫПЛАТЕ</td>
              <td className="num" style={{padding: '12px 14px', borderTop: '2px solid var(--ink)', fontSize: 17, fontWeight: 700, fontFamily: 'var(--f-mono)'}}>{fmtMoney(totalFund)}</td>
              <td style={{borderTop: '2px solid var(--ink)'}}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="banner info" style={{marginTop: 16}}>
        <span style={{display: 'flex'}}>{Ic.info}</span>
        <div>
          <div className="b-title">Период считается до {PAYROLL.payoutDate}</div>
          <div className="b-body">
            Зарплата за {PAYROLL.period} закроется автоматически 1 июня в 00:00. Если нужно
            внести бонус/штраф или скорректировать дни — успей до этого. Выплата через банк
            пройдёт по реестру 5 июня.
          </div>
        </div>
      </div>
    </>
  );
}

/* ============================================================
   Employee view — personal payroll
   ============================================================ */
function EmployeePayrollView() {
  const emp = EMPLOYEES.find(e => e.id === 'master1');
  const row = PAYROLL.rows.find(r => r.emp === 'master1');
  const baseShare = Math.round(emp.rate.base * row.daysWorked / PAYROLL.totalDaysInMonth);
  const total = baseShare + row.pieceSum + row.bonus - row.penalty;

  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'flex-start'}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
        {/* Hero card */}
        <div className="card" style={{padding: 24, position: 'relative', overflow: 'hidden'}}>
          <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24}}>
            <div>
              <div className="l-eyebrow accent" style={{marginBottom: 10}}>{PAYROLL.period} · к выплате {PAYROLL.payoutDate}</div>
              <div style={{fontSize: 56, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'var(--f-sans)', fontVariantNumeric: 'tabular-nums'}}>
                {fmtMoney(total)}
              </div>
              <div style={{marginTop: 14, fontSize: 13, color: 'var(--muted)'}}>
                За 16 рабочих дней · 128 часов · 142 отгрузки
              </div>
            </div>
            <Avatar initials={emp.initials} size={56} />
          </div>
        </div>

        {/* Breakdown */}
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Как сложилась сумма</span></div>
          <div style={{padding: 18}}>
            <BreakdownRow k="Оклад · доля за период" detail={`${row.daysWorked} из ${PAYROLL.totalDaysInMonth} раб. дней`} v={`+ ${fmtMoney(baseShare)}`} />
            <BreakdownRow k="Сдельная часть" detail={`${row.shipments} отгрузок · в среднем 130 ₽ / шт`} v={`+ ${fmtMoney(row.pieceSum)}`} tone="success" />
            {row.bonus > 0 && <BreakdownRow k="Бонус" detail={row.bonusReason} v={`+ ${fmtMoney(row.bonus)}`} tone="success" />}
            {row.penalty > 0 && <BreakdownRow k="Штраф" detail={row.penaltyReason} v={`− ${fmtMoney(row.penalty)}`} tone="danger" />}
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 16, borderTop: '2px solid var(--ink)', marginTop: 8}}>
              <span className="l-eyebrow">К выплате</span>
              <span className="l-money" style={{fontSize: 26, fontWeight: 700}}>{fmtMoney(total)}</span>
            </div>
          </div>
        </div>

        {/* Top shipments / piece breakdown */}
        <div className="card" style={{padding: 0}}>
          <div className="card-head">
            <span className="h-h3">Мои отгрузки месяца</span>
            <span className="badge sm">{row.shipments}</span>
          </div>
          <table className="tbl compact">
            <thead>
              <tr><th>Дата</th><th>№</th><th>Услуга</th><th className="num">Сумма заказа</th><th className="num">Моя доля</th></tr>
            </thead>
            <tbody>
              {SHIPMENTS.filter(s => s.master === 'master1').slice(0, 6).map(s => {
                const piece = Math.round(s.sum * 0.12);
                return (
                  <tr key={s.num}>
                    <td className="mono">{s.date.split(' ')[0]}</td>
                    <td className="mono"><Link to={`/shipments/${s.num}`} style={{color: 'var(--ink)', fontWeight: 600}}>{s.num.split('-').pop()}</Link></td>
                    <td>Замена масла / ATF</td>
                    <td className="num">{fmtMoney(s.sum)}</td>
                    <td className="num strong" style={{color: 'var(--success)'}}>+ {fmtMoney(piece)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sidebar */}
      <aside style={{position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h) + 16px)', display: 'flex', flexDirection: 'column', gap: 14}}>
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Профиль</span></div>
          <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
            <Row k="Должность" v={emp.role} />
            <Row k="С нами с" v={emp.since} />
            <Row k="Оклад · месяц" v={fmtMoney(emp.rate.base)} />
            <Row k="Сдельная" v={`${emp.rate.piece}% от ремонта`} />
            <Row k="Период расчёта" v={PAYROLL.period} />
            <Row k="Выплата" v={PAYROLL.payoutDate} />
          </div>
        </div>

        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Правила сдельной</span></div>
          <div style={{padding: '4px 4px 8px'}}>
            {PIECE_RULES.slice(0, 4).map(r => (
              <div key={r.id} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px'}}>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontSize: 12, fontWeight: 500}}>{r.kind}</div>
                  <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{r.note}</div>
                </div>
                <span className="l-mono" style={{fontSize: 13, fontWeight: 700, color: 'var(--rust)'}}>
                  {r.pct > 0 ? `${r.pct}%` : `${r.fixed} ₽`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function BreakdownRow({ k, detail, v, tone }) {
  return (
    <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px dashed var(--line-dashed)'}}>
      <div>
        <div style={{fontSize: 13, fontWeight: 500, color: 'var(--ink)'}}>{k}</div>
        {detail && <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 3}}>{detail}</div>}
      </div>
      <span className="l-money" style={{
        fontSize: 16, fontWeight: 700,
        color: tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--ink)',
      }}>{v}</span>
    </div>
  );
}

/* ============================================================
   Calendar of working days
   ============================================================ */
function CalendarView({ employee = 'master1' }) {
  const emp = EMPLOYEES.find(e => e.id === employee);
  const days = WORKING_DAYS[employee] || {};
  const monthLen = 31; // May has 31 days
  const firstWeekday = 4; // May 1, 2026 is Friday = 4 (0 = Mon)

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ blank: true });
  for (let d = 1; d <= monthLen; d++) cells.push({ d, status: days[d] || 'planned' });

  const tones = {
    worked:   { bg: 'var(--success-tint)',  fg: 'var(--success)', border: 'var(--success-tint-strong)', label: 'Отработан' },
    off:      { bg: 'var(--surface)',       fg: 'var(--muted)',   border: 'var(--line)',                label: 'Выходной' },
    vacation: { bg: 'var(--info-tint)',     fg: 'var(--info)',    border: 'var(--info-tint-strong)',    label: 'Отпуск' },
    sick:     { bg: 'var(--warning-tint)',  fg: 'var(--warning)', border: 'var(--warning-tint-strong)', label: 'Больничный' },
    planned:  { bg: 'var(--surface-sunk)',  fg: 'var(--muted)',   border: 'var(--line)',                label: 'Запланирован' },
  };

  const counts = Object.values(days).reduce((acc, st) => { acc[st] = (acc[st] || 0) + 1; return acc; }, {});

  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'flex-start'}}>
      <div className="card" style={{padding: 0}}>
        <div className="card-head">
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <span className="h-h3">Май 2026 · {emp.name}</span>
            <span className="badge"><span className="dot success" />{counts.worked || 0} отработано</span>
          </div>
          <div style={{display: 'flex', gap: 4}}>
            <IconBtn icon="chevL" kind="ghost" />
            <button className="btn sm">Сегодня</button>
            <IconBtn icon="chevR" kind="ghost" />
          </div>
        </div>
        <div style={{padding: 18}}>
          {/* Week header */}
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8}}>
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d, i) => (
              <div key={d} style={{
                textAlign: 'center', padding: '6px 0',
                fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
                color: i >= 5 ? 'var(--rust)' : 'var(--muted)',
                textTransform: 'uppercase',
              }}>{d}</div>
            ))}
          </div>
          {/* Days */}
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4}}>
            {cells.map((c, i) => {
              if (c.blank) return <div key={i} />;
              const t = tones[c.status];
              const isToday = c.d === 23;
              const isWeekend = ((firstWeekday + c.d - 1) % 7) >= 5;
              return (
                <div key={i} style={{
                  aspectRatio: '1.1', background: t.bg, border: `1px solid ${t.border}`,
                  borderRadius: 4, padding: 6, position: 'relative',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  boxShadow: isToday ? '0 0 0 2px var(--rust)' : 'none',
                }}>
                  <div style={{
                    fontSize: 13, fontWeight: isToday ? 700 : 500,
                    color: isWeekend && c.status === 'off' ? 'var(--rust)' : t.fg,
                    fontFamily: 'var(--f-mono)',
                  }}>{c.d}</div>
                  {c.status === 'worked' && (
                    <div style={{fontSize: 10, color: t.fg, fontWeight: 600, letterSpacing: '0.04em'}}>8ч</div>
                  )}
                  {c.status === 'planned' && (
                    <div style={{fontSize: 10, color: t.fg, fontStyle: 'italic'}}>план</div>
                  )}
                  {isToday && <div style={{position: 'absolute', top: 4, right: 4, width: 4, height: 4, background: 'var(--rust)', borderRadius: '50%'}} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside>
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Сводка</span></div>
          <div style={{padding: '4px 4px 8px'}}>
            {Object.entries(tones).map(([k, t]) => (
              <div key={k} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px'}}>
                <span style={{width: 12, height: 12, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 2}} />
                <span style={{flex: 1, fontSize: 13}}>{t.label}</span>
                <span className="l-mono" style={{fontSize: 13, fontWeight: 600, color: 'var(--ink)'}}>{counts[k] || 0}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{padding: 0, marginTop: 14}}>
          <div className="card-head"><span className="h-h3">Действия</span></div>
          <div style={{padding: 12, display: 'flex', flexDirection: 'column', gap: 6}}>
            <button className="btn sm">{Ic.plus} Отметить выходной</button>
            <button className="btn sm">Запланировать отпуск</button>
            <button className="btn sm">Больничный</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ============================================================
   Piece rules editor
   ============================================================ */
function PieceRulesView() {
  return (
    <div>
      <div className="banner info" style={{marginBottom: 16}}>
        <span style={{display: 'flex'}}>{Ic.info}</span>
        <div>
          <div className="b-title">Как работают правила</div>
          <div className="b-body">
            Сдельная часть начисляется по правилам ниже. Для каждой услуги — диапазон по сумме заказа,
            процент или фиксированная ставка. Правила применяются сверху вниз — первое совпавшее срабатывает.
          </div>
        </div>
      </div>

      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <span className="l-meta">{PIECE_RULES.length} правил</span>
          <div style={{flex: 1}} />
          <button className="btn sm primary">{Ic.plus} Новое правило</button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width: 60}}>#</th>
              <th>Тип услуги</th>
              <th>Диапазон суммы заказа</th>
              <th className="num">Процент</th>
              <th className="num">Фикс. ставка</th>
              <th>Комментарий</th>
              <th style={{width: 80}}></th>
            </tr>
          </thead>
          <tbody>
            {PIECE_RULES.map(r => (
              <tr key={r.id}>
                <td className="mono muted">0{r.id}</td>
                <td className="strong">{r.kind}</td>
                <td>
                  <span className="l-mono">
                    {r.from === 0 && r.to === null && 'любая'}
                    {r.from === 0 && r.to !== null && `до ${fmtMoneyPlain(r.to)} ₽`}
                    {r.from > 0 && r.to !== null && `${fmtMoneyPlain(r.from)} — ${fmtMoneyPlain(r.to)} ₽`}
                    {r.from > 0 && r.to === null && `от ${fmtMoneyPlain(r.from)} ₽`}
                  </span>
                </td>
                <td className="num">{r.pct > 0 ? <span style={{color: 'var(--rust)', fontWeight: 700}}>{r.pct}%</span> : '—'}</td>
                <td className="num">{r.fixed > 0 ? <span style={{fontWeight: 700}}>{fmtMoneyPlain(r.fixed)} ₽</span> : '—'}</td>
                <td className="muted">{r.note || '—'}</td>
                <td>
                  <div className="row-action">
                    <IconBtn icon="edit" kind="ghost" />
                    <IconBtn icon="trash" kind="ghost" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   Bonus / penalty log
   ============================================================ */
function BonusLogView({ employee }) {
  const log = employee ? BONUS_PENALTY_LOG.filter(b => b.emp === employee) : BONUS_PENALTY_LOG;
  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'flex-start'}}>
      <div>
        <div className="tbl-wrap">
          <div className="tbl-toolbar">
            <span className="l-meta">{log.length} событий за {PAYROLL.period}</span>
            <div style={{flex: 1}} />
            {!employee && (
              <>
                <button className="btn sm">{Ic.plus} Бонус</button>
                <button className="btn sm danger">{Ic.plus} Штраф</button>
              </>
            )}
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Сотрудник</th>
                <th>Тип</th>
                <th>Причина</th>
                <th className="num">Сумма</th>
                <th style={{width: 60}}></th>
              </tr>
            </thead>
            <tbody>
              {log.map(b => {
                const emp = EMPLOYEES.find(e => e.id === b.emp);
                return (
                  <tr key={b.id}>
                    <td className="mono">{b.date}</td>
                    <td>
                      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                        <Avatar initials={emp.initials} size={22} tone="neutral" />
                        <span style={{fontSize: 12}}>{emp.name.split(' ')[1]}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${b.kind === 'bonus' ? 'success' : 'danger'} sm`}>
                        <span className={`dot ${b.kind === 'bonus' ? 'success' : 'danger'}`} />
                        {b.kind === 'bonus' ? 'Бонус' : 'Штраф'}
                      </span>
                    </td>
                    <td>{b.reason}</td>
                    <td className="num strong" style={{color: b.kind === 'bonus' ? 'var(--success)' : 'var(--danger)'}}>
                      {b.kind === 'bonus' ? '+ ' : '− '}{fmtMoney(b.amount)}
                    </td>
                    <td>
                      <div className="row-action">
                        <IconBtn icon="edit" kind="ghost" />
                        <IconBtn icon="trash" kind="ghost" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <aside>
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">За {PAYROLL.period}</span></div>
          <div style={{padding: 18, display: 'flex', flexDirection: 'column', gap: 14}}>
            <Kpi accent="var(--success)" label="Бонусы выданы" value={fmtMoney(log.filter(b => b.kind === 'bonus').reduce((s, b) => s + b.amount, 0))} sub={`${log.filter(b => b.kind === 'bonus').length} событий`} mono />
            <Kpi accent="var(--danger)" label="Штрафы наложены" value={fmtMoney(log.filter(b => b.kind === 'penalty').reduce((s, b) => s + b.amount, 0))} sub={`${log.filter(b => b.kind === 'penalty').length} событий`} mono />
            <div className="divider" />
            <div className="banner rust">
              <span style={{display: 'flex'}}>{Ic.info}</span>
              <div>
                <div className="b-title">Соотношение</div>
                <div className="b-body" style={{color: 'inherit'}}>В этом месяце бонусов в {Math.round(log.filter(b => b.kind === 'bonus').reduce((s, b) => s + b.amount, 0) / Math.max(log.filter(b => b.kind === 'penalty').reduce((s, b) => s + b.amount, 0), 1))} раза больше, чем штрафов. Это правильно.</div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

Object.assign(window, { PayrollScreen });
