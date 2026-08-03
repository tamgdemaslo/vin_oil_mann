// ====================================================================
//  screens/home.jsx — Home (owner) + Home (admin/master no shift)
// ====================================================================

function HomeScreen() {
  const [view, setView] = useState('owner'); // owner | no-shift | with-shift

  return (
    <div className="container page">
      {/* View switcher (demo only) */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24}}>
        <div>
          <div className="page-crumbs">Главная</div>
          <h1 className="page-title">
            {view === 'owner' && <>Добрый день, Дмитрий. <span className="muted">Сегодня 23 мая, пятница.</span></>}
            {view === 'no-shift' && <>Привет, Анна. <span className="muted">Смена ещё не открыта.</span></>}
            {view === 'with-shift' && <>Привет, Сергей. <span className="muted">Смена идёт уже 5 ч 42 мин.</span></>}
          </h1>
        </div>
        <div className="seg">
          {[
            {k: 'owner', l: 'Владелец'},
            {k: 'no-shift', l: 'Админ · без смены'},
            {k: 'with-shift', l: 'Мастер · в смене'},
          ].map(o => (
            <button key={o.k} className={`seg-btn ${view === o.k ? 'on' : ''}`} onClick={() => setView(o.k)}>{o.l}</button>
          ))}
        </div>
      </div>

      {view === 'owner' && <OwnerHome />}
      {view === 'no-shift' && <NoShiftHome />}
      {view === 'with-shift' && <WithShiftHome />}
    </div>
  );
}

/* ---------- Owner home: KPIs, recent shipments, financials ---------- */
function OwnerHome() {
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
      {/* KPI grid */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12}}>
        <Kpi accent="var(--rust)" label="Выручка · май" value="1 247 800 ₽" sub="Цель 1 400 000 ₽" trend={{dir: 'up', value: '+18%'}} mono />
        <Kpi label="Прибыль · май" value="412 400 ₽" sub="Маржа 33%" trend={{dir: 'up', value: '+12%'}} mono />
        <Kpi label="Касса сейчас" value="49 100 ₽" sub="смена открыта · 6 операций" mono />
        <Kpi label="Зарплатный фонд" value="284 600 ₽" sub="к выплате 5 июня" mono />
        <Kpi label="Отгрузок · май" value="438" sub="ср. чек 2 849 ₽" />
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24}}>
        {/* Recent shipments */}
        <div className="card">
          <div className="card-head">
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <span className="h-h3">Последние отгрузки</span>
              <span className="badge sm outline">сегодня</span>
            </div>
            <Link to="/shipments" className="btn sm ghost">Все отгрузки →</Link>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Время</th>
                <th>№ отгрузки</th>
                <th>Клиент / авто</th>
                <th>Мастер</th>
                <th>Статус</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {SHIPMENTS.slice(0, 6).map(s => {
                const c = CLIENTS.find(x => x.id === s.client);
                const m = USERS[s.master];
                return (
                  <tr key={s.num}>
                    <td className="muted mono">{s.date.split(' ')[1]}</td>
                    <td><Link to={`/shipments/${s.num}`} className="mono strong" style={{color: 'var(--ink)'}}>{s.num}</Link></td>
                    <td>
                      <div style={{fontWeight: 500, color: 'var(--ink)'}}>{c.name}</div>
                      <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{c.car} · {c.plate}</div>
                    </td>
                    <td>
                      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                        <Avatar initials={m.initials} size={22} tone="neutral" />
                        <span style={{fontSize: 12}}>{m.name.split(' ')[1]}</span>
                      </div>
                    </td>
                    <td><StatusBadge status={s.status} sm /></td>
                    <td className="num strong">{fmtMoney(s.sum)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right column */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {/* Cash status */}
          <div className="card card-pad" style={{padding: 0}}>
            <div className="card-head">
              <span className="h-h3">Касса смены</span>
              <span className="badge success sm"><span className="dot success" />активна</span>
            </div>
            <div style={{padding: 20, display: 'flex', flexDirection: 'column', gap: 14}}>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14}}>
                <div>
                  <div className="l-eyebrow">Открыто</div>
                  <div className="l-mono" style={{fontSize: 13, marginTop: 6, fontWeight: 500}}>{CASH_SHIFT.openedAt.split('·')[1].trim()}</div>
                </div>
                <div>
                  <div className="l-eyebrow">Стартовый остаток</div>
                  <div className="l-money" style={{fontSize: 13, marginTop: 6, fontWeight: 500}}>{fmtMoney(CASH_SHIFT.startBalance)}</div>
                </div>
              </div>
              <div className="divider-dashed" />
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14}}>
                <KpiInline label="Поступления" value="+ 61 300 ₽" tone="success" />
                <KpiInline label="Изъятия / расходы" value="− 11 200 ₽" tone="warning" />
              </div>
              <div style={{paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span className="l-eyebrow">Ожидаемый остаток</span>
                <span className="l-money" style={{fontSize: 22, fontWeight: 700}}>55 100 ₽</span>
              </div>
              <Link to="/cash" className="btn primary" style={{justifyContent: 'space-between'}}>Открыть кассу <span className="arrow">→</span></Link>
            </div>
          </div>

          {/* Quick actions */}
          <div className="card card-pad" style={{padding: 0}}>
            <div className="card-head">
              <span className="h-h3">Быстрые действия</span>
            </div>
            <div style={{padding: '8px 8px 12px'}}>
              {[
                {to: '/shipments/new', l: 'Новая отгрузка', d: 'VIN → подбор → позиции', i: 'plus', accent: true},
                {to: '/receiving', l: 'Создать приёмку', d: 'товар от поставщика'},
                {to: '/products', l: 'Найти товар', d: '847 артикулов в базе'},
                {to: '/cash', l: 'Закрыть смену', d: 'сверка кассы и AQSI'},
              ].map(a => (
                <Link key={a.to} to={a.to} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  borderRadius: 4, cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 4,
                    background: a.accent ? 'var(--rust-tint)' : 'var(--surface-deep)',
                    color: a.accent ? 'var(--rust)' : 'var(--ink-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{Ic[a.i || 'chevR']}</div>
                  <div style={{flex: 1}}>
                    <div style={{fontSize: 13, fontWeight: 600, color: 'var(--ink)'}}>{a.l}</div>
                    <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{a.d}</div>
                  </div>
                  <span style={{color: 'var(--faint)'}}>{Ic.chevR}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row: payroll + stock + supplier invoices */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24}}>
        <PanelMini
          title="Смены сотрудников · сегодня"
          rows={[
            { l: 'Сергей Игнатенко', s: '09:00 → сейчас', m: '5 ч 42 мин · 3 отгрузки', t: 'success' },
            { l: 'Артём Войтов', s: '10:30 → сейчас', m: '4 ч 12 мин · 2 отгрузки', t: 'success' },
            { l: 'Никита Лебедев', s: '—', m: 'не на смене', t: 'idle' },
            { l: 'Анна Лебедева (адм.)', s: '09:00 → сейчас', m: 'касса открыта', t: 'success' },
          ]}
          link="/cabinet"
        />
        <PanelMini
          title="Склад · обращай внимание"
          rows={[
            { l: 'Bardahl XTC C60 5W-40', s: '2 шт', m: 'осталось < недели — закупить', t: 'danger' },
            { l: 'VAG G 060 162 (ATF DSG)', s: '4 шт', m: 'остаток ниже нормы', t: 'warning' },
            { l: 'Shell Helix Ultra 0W-40', s: '12 шт', m: 'норма · к закупке через 2 нед', t: 'success' },
            { l: 'Mobil 1 0W-20', s: '9 шт', m: 'норма', t: 'success' },
          ]}
          link="/products"
        />
        <PanelMini
          title="Счета поставщиков · к оплате"
          rows={[
            { l: 'Альфа-Ойл', s: '184 200 ₽', m: 'до 28 мая · ещё 5 дней', t: 'warning' },
            { l: 'Mann+Hummel', s: '38 400 ₽', m: 'до 10 июня', t: 'idle' },
            { l: 'BMW Russland', s: '62 100 ₽', m: 'до 5 июня', t: 'idle' },
            { l: 'СК-Ойл', s: '92 800 ₽', m: 'просрочен · 2 дня', t: 'danger' },
          ]}
          link="/finance"
        />
      </div>
    </div>
  );
}

function KpiInline({ label, value, tone }) {
  return (
    <div>
      <div className="l-eyebrow">{label}</div>
      <div className="l-money" style={{fontSize: 16, fontWeight: 700, marginTop: 4, color: tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : 'var(--ink)'}}>{value}</div>
    </div>
  );
}

function PanelMini({ title, rows, link }) {
  return (
    <div className="card" style={{padding: 0}}>
      <div className="card-head">
        <span className="h-h3">{title}</span>
        <Link to={link} className="btn sm ghost">Открыть →</Link>
      </div>
      <div>
        {rows.map((r, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--line)'}}>
            <span className={`dot ${r.t}`} />
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{r.l}</div>
              <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{r.m}</div>
            </div>
            <div className="l-mono" style={{fontSize: 12, color: 'var(--ink-2)', fontWeight: 500}}>{r.s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Admin/master without shift ---------- */
function NoShiftHome() {
  return (
    <div style={{display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24}}>
      {/* Big start-shift card */}
      <div style={{background: 'var(--ink)', color: '#F5F2ED', padding: 40, position: 'relative', overflow: 'hidden', borderRadius: 4}}>
        <div style={{position: 'absolute', inset: 0, opacity: 0.4, backgroundImage: `
          repeating-linear-gradient(60deg, transparent 0 22px, rgba(245,242,237,0.04) 22px 23px),
          repeating-linear-gradient(-60deg, transparent 0 22px, rgba(245,242,237,0.04) 22px 23px)
        `}} />
        <div style={{position: 'relative'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18}}>
            <span className="dot idle" />
            <span style={{fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9A9A9A'}}>Смена ещё не открыта</span>
          </div>
          <div style={{fontSize: 36, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 480}}>
            Открой рабочую смену,<br />
            <span style={{color: '#9A9A9A'}}>чтобы начать день<span style={{color: 'var(--rust)'}}>.</span></span>
          </div>
          <div style={{marginTop: 24, fontSize: 14, color: '#C9C5BD', lineHeight: 1.55, maxWidth: 540}}>
            Пока смена закрыта — заблокированы отгрузки, касса, приёмка и списание.
            Каталог товаров, журнал записей и CRM открыты в режиме просмотра.
          </div>
          <div style={{display: 'flex', gap: 12, marginTop: 32}}>
            <button className="btn primary xl">{Ic.play} Открыть рабочую смену</button>
            <Link to="/cash" className="btn xl" style={{background: 'transparent', color: '#F5F2ED', borderColor: '#3D3D3D'}}>
              Только касса
            </Link>
          </div>
          <div style={{marginTop: 36, paddingTop: 24, borderTop: '1px solid #3D3D3D', display: 'flex', gap: 32, fontFamily: 'var(--f-mono)', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.04em'}}>
            <span>СЕГОДНЯ В 9:00 ОТКРЫЛ СМЕНУ Сергей И.</span>
            <span>·</span>
            <span>ЗА ВЧЕРА: 18 ОТГРУЗОК · 218 400 ₽</span>
          </div>
        </div>
      </div>

      {/* Right: what's allowed / blocked */}
      <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Заблокировано без смены</span></div>
          <div>
            {[
              {l: 'Новая отгрузка', d: 'для записи на масло и оплаты'},
              {l: 'Касса · приём оплаты', d: 'ожидание открытия кассовой смены'},
              {l: 'Приёмка / списание', d: 'движения по складу'},
            ].map((b, i) => (
              <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i === 2 ? 'none' : '1px solid var(--line)'}}>
                <span style={{color: 'var(--faint)', display: 'flex'}}>{Ic.lock}</span>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 13, fontWeight: 500}}>{b.l}</div>
                  <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{b.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Доступно без смены</span></div>
          <div>
            {[
              {l: 'Каталог товаров', d: 'поиск по артикулу и OEM'},
              {l: 'CRM и сделки', d: 'воронка работает в режиме чтения'},
              {l: 'Журнал записей', d: 'но без подтверждения визитов'},
              {l: 'Аналитика клиентов', d: 'только для своих клиентов'},
            ].map((b, i) => (
              <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i === 3 ? 'none' : '1px solid var(--line)'}}>
                <span style={{color: 'var(--success)', display: 'flex'}}>{Ic.check}</span>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 13, fontWeight: 500}}>{b.l}</div>
                  <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{b.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Master with shift ---------- */
function WithShiftHome() {
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
      {/* Shift status banner */}
      <div style={{background: 'var(--success-tint)', border: '1px solid var(--success-tint-strong)', padding: 16, display: 'flex', alignItems: 'center', gap: 18, borderRadius: 4}}>
        <span className="dot success pulse" style={{width: 12, height: 12}} />
        <div style={{flex: 1}}>
          <div style={{fontSize: 13, fontWeight: 600, color: 'var(--success)'}}>Смена активна с 09:00 · идёт уже 5 ч 42 мин</div>
          <div style={{fontSize: 12, color: 'var(--ink-2)', marginTop: 3}}>Завершено 3 отгрузки на 67 270 ₽ · 1 в работе</div>
        </div>
        <button className="btn">Закрыть смену</button>
      </div>

      {/* KPIs for personal stats */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12}}>
        <Kpi label="Моих отгрузок · сегодня" value="3" sub="в работе ещё 1" />
        <Kpi accent="var(--rust)" label="Моя выручка · сегодня" value="67 270 ₽" mono trend={{dir: 'up', value: '+14%'}} />
        <Kpi label="Сдельная часть · май" value="38 400 ₽" sub="до выплаты 13 дней" mono />
        <Kpi label="Ср. время на отгрузку" value="34 мин" sub="норма 40 мин" />
      </div>

      {/* Current + queue */}
      <div style={{display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24}}>
        <div className="card" style={{padding: 0}}>
          <div className="card-head">
            <span className="h-h3">В работе сейчас</span>
            <Link to="/shipments/TGM-2026-0437" className="btn sm">Продолжить →</Link>
          </div>
          <div style={{padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24}}>
            <div>
              <div className="l-eyebrow">№ отгрузки</div>
              <div className="l-mono" style={{fontSize: 18, fontWeight: 700, marginTop: 6, letterSpacing: '0.02em'}}>TGM-2026-0437</div>
              <div style={{marginTop: 18}}>
                <div className="l-eyebrow">Клиент</div>
                <div style={{fontSize: 14, fontWeight: 600, marginTop: 6}}>Игорь Михайлов</div>
                <div style={{fontSize: 12, color: 'var(--muted)', marginTop: 2}}>+7 911 384 12 56</div>
              </div>
              <div style={{marginTop: 18}}>
                <div className="l-eyebrow">Автомобиль</div>
                <div style={{fontSize: 14, fontWeight: 600, marginTop: 6}}>Audi Q7 (4M) 3.0 TDI · М 318 ОР 39</div>
                <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.04em'}}>VIN WAUZZZ4M0KD041318</div>
              </div>
            </div>
            <div>
              <div className="l-eyebrow">Прогресс</div>
              <ul style={{margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8}}>
                {[
                  {l: 'Приёмка машины · VIN сверен', done: true},
                  {l: 'Масло и фильтр подобраны', done: true},
                  {l: 'Замена выполнена', done: true},
                  {l: 'Диагностика 14 пунктов', done: false, active: true},
                  {l: 'Предчек · подпись клиента', done: false},
                ].map((s, i) => (
                  <li key={i} style={{display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: s.done ? 'var(--ink-2)' : (s.active ? 'var(--ink)' : 'var(--muted)')}}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: s.done ? 'var(--success)' : (s.active ? 'var(--rust)' : 'var(--surface-deep)'),
                      color: s.done || s.active ? '#fff' : 'var(--muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, flexShrink: 0,
                    }}>{s.done ? '✓' : (i+1)}</span>
                    {s.l}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="card" style={{padding: 0}}>
          <div className="card-head">
            <span className="h-h3">Записи на сегодня</span>
            <span className="badge sm">2 предстоят</span>
          </div>
          <div>
            {[
              {t: '15:30', n: 'Ольга Дворецкая', c: 'Mercedes E 220 d', s: 'подтверждён'},
              {t: '16:30', n: 'Дмитрий Левин', c: 'Toyota LC 200', s: 'ожидание'},
            ].map(r => (
              <div key={r.t} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line)'}}>
                <div style={{fontFamily: 'var(--f-mono)', fontSize: 14, fontWeight: 700, color: 'var(--ink)', width: 50}}>{r.t}</div>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 13, fontWeight: 500}}>{r.n}</div>
                  <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{r.c}</div>
                </div>
                <span className={`badge sm ${r.s === 'подтверждён' ? 'success' : 'warning'}`}>{r.s}</span>
              </div>
            ))}
            <div style={{padding: 16}}>
              <Link to="/shipments/new" className="btn primary" style={{width: '100%'}}>{Ic.plus} Новая отгрузка прямо сейчас</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomeScreen });
