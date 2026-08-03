// ====================================================================
//  screens/shipments.jsx — List + New + Detail + Precheck
// ====================================================================

/* ============================================================
   Shipments list
   ============================================================ */
function ShipmentsListScreen() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [density, setDensity] = useState('comfortable');

  const tabs = [
    {k: 'all', l: 'Все', n: SHIPMENTS.length},
    {k: 'draft', l: 'Черновики', n: SHIPMENTS.filter(s => s.status === 'draft').length},
    {k: 'in-progress', l: 'В работе', n: SHIPMENTS.filter(s => s.status === 'in-progress').length},
    {k: 'completed', l: 'Завершено', n: SHIPMENTS.filter(s => s.status === 'completed').length},
    {k: 'returned', l: 'Возвраты', n: SHIPMENTS.filter(s => s.status === 'returned').length},
  ];
  const list = SHIPMENTS.filter(s => tab === 'all' || s.status === tab);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs">
            <Link to="/home">Главная</Link>
            <span className="sep">/</span>
            <span className="cur">Операции / Отгрузки</span>
          </div>
          <h1 className="page-title">Отгрузки</h1>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn">{Ic.download} Выгрузить</button>
          <Link to="/shipments/new" className="btn primary">{Ic.plus} Новая отгрузка</Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{marginBottom: 16}}>
        {tabs.map(t => (
          <button key={t.k} className={`tab ${tab === t.k ? 'active' : ''}`} onClick={() => setTab(t.k)}>
            {t.l}<span className="count">{t.n}</span>
          </button>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap'}}>
        <div className="inp-wrap" style={{width: 280}}>
          <span className="lead">{Ic.search}</span>
          <input className="inp" placeholder="№, клиент, телефон, VIN…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="pill">Период · 23 мая</button>
        <button className="pill on">Мастер: Сергей И. <span className="x">{Ic.x}</span></button>
        <button className="pill">Клиент</button>
        <button className="pill">Сумма от</button>
        <button className="pill" style={{borderStyle: 'dashed'}}>{Ic.plus} Ещё фильтр</button>
        <div style={{flex: 1}} />
        <div className="seg">
          <button className={`seg-btn ${density === 'comfortable' ? 'on' : ''}`} onClick={() => setDensity('comfortable')}>Comfortable</button>
          <button className={`seg-btn ${density === 'compact' ? 'on' : ''}`} onClick={() => setDensity('compact')}>Compact</button>
        </div>
      </div>

      {/* Table */}
      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <span className="l-meta">{list.length} строк · сумма {fmtMoney(list.reduce((s, x) => s + x.sum, 0))}</span>
          <div style={{flex: 1}} />
          <button className="btn sm ghost">{Ic.print} Печать списка</button>
          <button className="btn sm ghost">Колонки</button>
        </div>
        <table className={`tbl ${density === 'compact' ? 'compact' : ''}`}>
          <thead>
            <tr>
              <th style={{width: 36}}><span className="chk" /></th>
              <th>№ / дата</th>
              <th>Клиент</th>
              <th>Авто / VIN</th>
              <th>Мастер</th>
              <th className="num">Поз.</th>
              <th>Статус</th>
              <th>Оплата</th>
              <th className="num">Сумма</th>
              <th style={{width: 80}}></th>
            </tr>
          </thead>
          <tbody>
            {list.map(s => {
              const c = CLIENTS.find(x => x.id === s.client);
              const m = USERS[s.master];
              const paymentTone = s.paid >= s.sum ? 'success' : s.paid > 0 ? 'warning' : 'danger';
              const paymentLabel = s.paid >= s.sum ? 'Оплачено' : s.paid > 0 ? `Частично · ${fmtMoneyPlain(s.paid)}` : 'Не оплачено';
              return (
                <tr key={s.num}>
                  <td><span className="chk" /></td>
                  <td>
                    <Link to={`/shipments/${s.num}`} className="mono strong" style={{color: 'var(--ink)'}}>{s.num}</Link>
                    <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--f-mono)', letterSpacing: '0.02em'}}>{s.date}</div>
                  </td>
                  <td>
                    <div style={{fontWeight: 500, color: 'var(--ink)'}}>{c.name}</div>
                    <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--f-mono)'}}>{c.phone}</div>
                  </td>
                  <td>
                    <div style={{fontSize: 13}}>{c.car}</div>
                    <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--f-mono)', letterSpacing: '0.04em'}}>{c.plate} · VIN {s.vin.slice(-8)}</div>
                  </td>
                  <td>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                      <Avatar initials={m.initials} size={22} tone="neutral" />
                      <span style={{fontSize: 12}}>{m.name.split(' ')[1]}</span>
                    </div>
                  </td>
                  <td className="num">{s.items}</td>
                  <td><StatusBadge status={s.status} sm /></td>
                  <td><span className={`badge ${paymentTone} sm`}><span className={`dot ${paymentTone}`} />{paymentLabel}</span></td>
                  <td className="num strong">{fmtMoney(s.sum)}</td>
                  <td>
                    <div className="row-action">
                      <IconBtn icon="edit" kind="ghost" />
                      <IconBtn icon="print" kind="ghost" />
                      <IconBtn icon="more" kind="ghost" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', fontSize: 12, color: 'var(--muted)'}}>
        <span>Показано 8 из 438</span>
        <div style={{display: 'flex', gap: 4}}>
          <IconBtn icon="chevL" kind="ghost" />
          {['1', '2', '3', '…', '55'].map((p, i) => (
            <button key={i} className="btn sm" style={{width: 32, padding: 0, ...(p === '1' ? {background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)'} : {})}}>{p}</button>
          ))}
          <IconBtn icon="chevR" kind="ghost" />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   New shipment — multi-pane: client, VIN, picker, items, totals
   ============================================================ */
function NewShipmentScreen() {
  const [step, setStep] = useState('vin'); // 'vin' | 'decoded' | 'items'
  const [vin, setVin] = useState('');
  const [chosenClientId, setChosenClientId] = useState('');
  const [plan, setPlan] = useState('оптимальный');
  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [diagStatus, setDiagStatus] = useState('none'); // none | progress | done | skip

  const decoded = vin.length === 17 ? VIN_DECODE[vin] : null;
  const chosen = decoded ? decoded.plans.find(p => p.tier === plan) : null;

  // Auto-build items from chosen plan
  useEffect(() => {
    if (!decoded || !chosen) return;
    const oil = PRODUCTS.find(p => p.sku === chosen.oil.sku);
    const filter = PRODUCTS.find(p => p.sku === chosen.filter.sku);
    const drain = PRODUCTS.find(p => p.sku === chosen.drain);
    setItems([
      { ...oil, qty: 2 },
      { ...filter, qty: 1 },
      { ...drain, qty: 1 },
    ]);
  }, [chosen, decoded]);

  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const total = subtotal * (1 - discount / 100);
  const cost = items.reduce((s, it) => s + it.cost * it.qty, 0);
  const margin = subtotal - cost;

  return (
    <div className="container page" style={{paddingBottom: 100}}>
      <div className="page-head">
        <div>
          <div className="page-crumbs">
            <Link to="/home">Главная</Link><span className="sep">/</span>
            <Link to="/shipments">Отгрузки</Link><span className="sep">/</span>
            <span className="cur">Новая отгрузка</span>
          </div>
          <h1 className="page-title">
            Новая отгрузка <span className="muted l-mono" style={{fontSize: 16, fontWeight: 500}}>· TGM-2026-0439 · черновик</span>
          </h1>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn">Сохранить черновик</button>
          <Link to="/shipments" className="btn">Отмена</Link>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'flex-start'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {/* Client */}
          <ClientPicker chosenClientId={chosenClientId} onChoose={setChosenClientId} />

          {/* VIN */}
          <VinCard vin={vin} setVin={setVin} decoded={decoded} step={step} setStep={setStep} />

          {/* Plans */}
          {decoded && (
            <div className="card">
              <div className="card-head">
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <span className="h-h3">Подбор: эконом / оптимальный / премиум</span>
                  <span className="badge rust sm"><span className="dot rust" />OpenAI · 0.8 сек</span>
                </div>
                <button className="btn sm ghost">{Ic.refresh} Пересчитать</button>
              </div>
              <div style={{padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12}}>
                {decoded.plans.map(p => {
                  const active = p.tier === plan;
                  return (
                    <button key={p.tier} onClick={() => setPlan(p.tier)} style={{
                      textAlign: 'left', background: active ? 'var(--surface)' : 'var(--surface-sunk)',
                      border: active ? '2px solid var(--rust)' : '1px solid var(--line)',
                      padding: 16, cursor: 'pointer', position: 'relative', borderRadius: 4,
                    }}>
                      {p.recommended && <span style={{position: 'absolute', top: -8, right: 12, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', background: 'var(--rust)', color: '#fff'}}>Рекомендуем</span>}
                      <div className="l-eyebrow" style={{color: active ? 'var(--rust)' : 'var(--muted)'}}>{p.tier}</div>
                      <div style={{fontSize: 24, fontWeight: 700, marginTop: 8, fontFamily: 'var(--f-mono)', letterSpacing: '-0.01em'}}>{fmtMoney(p.total)}</div>
                      <div style={{marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-2)'}}>
                        <div><span style={{color: 'var(--muted)', fontSize: 11}}>Масло:</span> {p.oil.label}</div>
                        <div><span style={{color: 'var(--muted)', fontSize: 11}}>Фильтр:</span> {p.filter.label}</div>
                        <div><span style={{color: 'var(--muted)', fontSize: 11}}>+ Сливная пробка</span></div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Items */}
          {decoded && (
            <div className="card" style={{padding: 0}}>
              <div className="card-head">
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <span className="h-h3">Позиции отгрузки</span>
                  <span className="badge sm">{items.length}</span>
                </div>
                <div style={{display: 'flex', gap: 6}}>
                  <button className="btn sm">{Ic.search} Найти товар</button>
                  <button className="btn sm">{Ic.plus} Услугу</button>
                </div>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{width: 40}}>#</th>
                    <th>Артикул / название</th>
                    <th>Ячейка</th>
                    <th className="num">Кол-во</th>
                    <th className="num">Закуп.</th>
                    <th className="num">Цена</th>
                    <th className="num">Сумма</th>
                    <th style={{width: 60}}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.sku}>
                      <td className="muted mono">{(i+1).toString().padStart(2,'0')}</td>
                      <td>
                        <div style={{fontWeight: 500, color: 'var(--ink)'}}>{it.name}</div>
                        <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.04em'}}>{it.sku} · OEM {it.oem}</div>
                      </td>
                      <td className="mono">{it.cell}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num muted">{fmtMoneyPlain(it.cost)} ₽</td>
                      <td className="num">{fmtMoneyPlain(it.price)} ₽</td>
                      <td className="num strong">{fmtMoney(it.price * it.qty)}</td>
                      <td><div className="row-action"><IconBtn icon="trash" kind="ghost" /></div></td>
                    </tr>
                  ))}
                  <tr>
                    <td className="muted mono">{(items.length + 1).toString().padStart(2,'0')}</td>
                    <td colSpan={6}>
                      <button style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'transparent', border: 'none', color: 'var(--rust)',
                        fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '4px 0',
                      }}>{Ic.plus} Добавить позицию</button>
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Diagnostics — entry point into the fullscreen 14-point card */}
          {decoded && (
            <DiagnosticsBlock status={diagStatus} setStatus={setDiagStatus} shipNum="TGM-2026-0439" />
          )}
        </div>

        {/* Totals sidebar */}
        <aside style={{position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h) + 16px)', display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Итого</span><span className="badge sm">черновик</span></div>
            <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
              <Row k="Подытог" v={fmtMoney(subtotal)} />
              <Row k="Скидка" v={discount + '%'} edit />
              {discount > 0 && <Row k={`Скидка ${discount}%`} v={`− ${fmtMoney(subtotal * discount / 100)}`} tone="success" />}
              <div className="divider-dashed" />
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontSize: 13, color: 'var(--muted)'}}>К оплате</span>
                <span className="l-money" style={{fontSize: 26, fontWeight: 700}}>{fmtMoney(total)}</span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)'}}>
                <span>Себестоимость</span>
                <span className="l-mono">{fmtMoney(cost)}</span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--success)', fontWeight: 600}}>
                <span>Маржа</span>
                <span className="l-mono">{fmtMoney(margin)} · {Math.round(margin / subtotal * 100)}%</span>
              </div>
            </div>
            <div className="panel-foot" style={{flexDirection: 'column', gap: 8, alignItems: 'stretch'}}>
              <button className="btn primary lg" disabled={!decoded}>Сохранить и в предчек {Ic.chevR}</button>
              <div style={{display: 'flex', gap: 8}}>
                <button className="btn" style={{flex: 1}}>{Ic.print} Заказ-наряд</button>
                <button className="btn" style={{flex: 1}}>{Ic.print} Под капот</button>
              </div>
            </div>
          </div>

          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Контекст</span></div>
            <div style={{padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12}}>
              <div className="flex justify-between"><span className="muted">Создал</span><span>Сергей Игнатенко · сейчас</span></div>
              <div className="flex justify-between"><span className="muted">Источник</span><span>Инстаграм</span></div>
              <div className="flex justify-between"><span className="muted">Запись</span><span>14:30 · подтверждена</span></div>
              <div className="flex justify-between"><span className="muted">Касса</span><span><span className="dot success" /> открыта</span></div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v, edit, tone }) {
  return (
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <span style={{fontSize: 12, color: 'var(--muted)'}}>{k}</span>
      <span className="l-money" style={{fontSize: 13, fontWeight: 600, color: tone === 'success' ? 'var(--success)' : 'var(--ink)'}}>
        {v} {edit && <span style={{color: 'var(--rust)', fontSize: 11, marginLeft: 4, fontFamily: 'var(--f-sans)', fontWeight: 500, cursor: 'pointer'}}>изменить</span>}
      </span>
    </div>
  );
}

function ClientPicker({ chosenClientId, onChoose }) {
  const [open, setOpen] = useState(false);
  const c = CLIENTS.find(x => x.id === chosenClientId);
  return (
    <div className="card" style={{padding: 0}}>
      <div className="card-head">
        <span className="h-h3">Клиент</span>
        {c && <span className="badge sm">{c.visits === 1 ? '1 визит' : c.visits + ' визита'}</span>}
      </div>
      <div style={{padding: 16}}>
        {!c ? (
          <div style={{display: 'flex', gap: 8, alignItems: 'flex-end'}}>
            <div className="field" style={{flex: 1}}>
              <label className="field-label">Найти по имени / телефону / номеру</label>
              <div className="inp-wrap">
                <span className="lead">{Ic.search}</span>
                <input className="inp" placeholder="Например, +7 911…" />
              </div>
            </div>
            <button className="btn primary">{Ic.plus} Новый клиент</button>
            <button className="btn ghost" onClick={() => onChoose('c-247')}>Подставить демо →</button>
          </div>
        ) : (
          <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
            <Avatar initials={c.name.split(' ').map(s => s[0]).join('')} size={48} />
            <div style={{flex: 1}}>
              <div style={{fontSize: 16, fontWeight: 600}}>{c.name}</div>
              <div style={{display: 'flex', gap: 14, marginTop: 4, fontSize: 12, color: 'var(--muted)'}}>
                <span className="l-mono">{c.phone}</span>
                <span>·</span>
                <span>{c.visits} {c.visits === 1 ? 'визит' : 'визита'}</span>
                <span>·</span>
                <span>с октября 2024</span>
              </div>
            </div>
            <button className="btn">{Ic.user} Открыть карточку</button>
            <button className="btn ghost" onClick={() => onChoose('')}>Сменить</button>
          </div>
        )}
      </div>
    </div>
  );
}

function VinCard({ vin, setVin, decoded, step, setStep }) {
  return (
    <div className="card" style={{padding: 0}}>
      <div className="card-head">
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <span className="h-h3">Автомобиль · подбор по VIN</span>
          {decoded && <span className="badge success sm"><span className="dot success" />Найдено</span>}
        </div>
        {decoded && <button className="btn sm ghost">{Ic.edit} Изменить</button>}
      </div>
      <div style={{padding: 16}}>
        <div style={{display: 'grid', gridTemplateColumns: decoded ? '320px 1fr' : '1fr', gap: 20}}>
          <div className="field">
            <label className="field-label">VIN · 17 знаков</label>
            <div className="inp-wrap has-trail">
              <input
                className="inp mono lg"
                placeholder="WBABA91070AL55203"
                maxLength={17}
                value={vin}
                onChange={e => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                style={{letterSpacing: '0.12em'}}
              />
              <span className="trail">
                {vin.length === 17
                  ? <span style={{color: 'var(--success)', display: 'flex'}}>{Ic.check}</span>
                  : <span className="l-meta" style={{fontSize: 10}}>{vin.length}/17</span>}
              </span>
            </div>
            {!decoded && <div className="field-help">Введи 17 символов · или <a style={{color: 'var(--rust)', cursor: 'pointer'}} onClick={() => setVin('WBABA91070AL55203')}>подставить демо</a></div>}
            {!decoded && vin.length === 17 && (
              <div className="banner danger" style={{padding: 10, marginTop: 8}}>
                <span style={{display: 'flex'}}>{Ic.alert}</span>
                <div>
                  <div className="b-title">VIN не найден в базе</div>
                  <div className="b-body">Заполни данные вручную или попробуй ещё раз.</div>
                </div>
              </div>
            )}
          </div>
          {decoded && (
            <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
              <div style={{fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em'}}>
                {decoded.brand} {decoded.model} · {decoded.generation} · {decoded.year}
              </div>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', marginTop: 8, fontSize: 12}}>
                <SpecRow k="Двигатель" v={decoded.engine} />
                <SpecRow k="Тип кузова" v={`${decoded.body} · ${decoded.drive}`} />
                <SpecRow k="Коробка" v={decoded.transmission} />
                <SpecRow k="Интервал" v={decoded.interval} />
                <SpecRow k="Заводская спец." v={decoded.oilSpec} />
                <SpecRow k="Объём заливки" v={decoded.oilCapacity} />
                <SpecRow k="Фильтр" v={decoded.filter} mono />
                <SpecRow k="Сливная пробка" v={decoded.drainPlug} mono />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SpecRow({ k, v, mono }) {
  return (
    <div style={{display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px dashed var(--line-dashed)', paddingBottom: 4}}>
      <span style={{color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--f-mono)', letterSpacing: '0.04em', textTransform: 'uppercase'}}>{k}</span>
      <span style={{color: 'var(--ink)', fontFamily: mono ? 'var(--f-mono)' : 'inherit', fontSize: 12, fontWeight: mono ? 500 : 500, textAlign: 'right'}}>{v}</span>
    </div>
  );
}

/* ============================================================
   Diagnostics block — adaptive entry point on the new-shipment page.
   Covers all lifecycle states: none / progress / done / skip.
   The actual filling happens in the fullscreen DiagnosticsScreen.
   ============================================================ */
function DiagnosticsBlock({ status, setStatus, shipNum }) {
  // numbers derived from the real diagnostic structure / demo state
  const allItems = DIAG_BLOCKS.flatMap(b => b.items);
  const progressTotal = allItems.length;
  const progressDone = Math.round(progressTotal * 0.6);
  const counts = ['good', 'warn', 'crit'].reduce((a, k) => {
    a[k] = allItems.filter(it => (DIAG_STATE.items[it.id]?.status) === k).length; return a;
  }, {});
  const recCount = counts.warn + counts.crit;

  const states = [
    { k: 'none', l: 'Не начата' },
    { k: 'progress', l: 'В работе' },
    { k: 'done', l: 'Готова' },
    { k: 'skip', l: 'Не требуется' },
  ];

  return (
    <div className="card" style={{padding: 0}}>
      <div className="card-head">
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <span style={{color: 'var(--muted)', display: 'flex'}}>{Ic.chart}</span>
          <span className="h-h3">Диагностика {progressTotal} пунктов</span>
          {status === 'progress' && <span className="badge info sm"><span className="dot info" />{progressDone}/{progressTotal}</span>}
          {status === 'done' && <span className="badge success sm"><span className="dot success" />Готова</span>}
          {status === 'skip' && <span className="badge sm">не требуется</span>}
        </div>
        {/* state preview switch — prototype helper to walk through scenarios */}
        <div className="seg">
          {states.map(s => (
            <button key={s.k} className={`seg-btn ${status === s.k ? 'on' : ''}`} onClick={() => setStatus(s.k)}>{s.l}</button>
          ))}
        </div>
      </div>

      {/* NONE — not started yet */}
      {status === 'none' && (
        <div style={{padding: 16, display: 'flex', alignItems: 'center', gap: 18}}>
          <div style={{flex: 1}}>
            <div style={{fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5}}>
              Мастер заполняет карту на планшете в яме: жидкости, тормоза, шины, подвеска.
              Результат уходит клиенту публичным отчётом и попадает в заказ-наряд.
            </div>
            <div style={{marginTop: 8, fontSize: 12, color: 'var(--muted)'}}>
              Входит в заказ · фикс. ставка мастеру 300 ₽ · ~10 минут
            </div>
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0}}>
            <Link to={`/diagnostics/${shipNum}`} className="btn primary">{Ic.chart} Запустить карту {Ic.chevR}</Link>
            <button className="btn ghost sm" onClick={() => setStatus('skip')}>Не требуется для этой отгрузки</button>
          </div>
        </div>
      )}

      {/* PROGRESS — being filled on a tablet */}
      {status === 'progress' && (
        <div style={{padding: 16}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <div style={{flex: 1}}>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6}}>
                <span style={{fontSize: 12, color: 'var(--muted)'}}>Заполняет <strong style={{color: 'var(--ink)', fontWeight: 600}}>Артём Войтов</strong> · планшет №2</span>
                <span className="l-mono" style={{fontSize: 12, fontWeight: 600}}>{progressDone}/{progressTotal}</span>
              </div>
              <div style={{height: 8, background: 'var(--surface-deep)', borderRadius: 4, overflow: 'hidden'}}>
                <div style={{width: `${progressDone / progressTotal * 100}%`, height: '100%', background: 'var(--rust)'}} />
              </div>
            </div>
            <Link to={`/diagnostics/${shipNum}`} className="btn primary" style={{flexShrink: 0}}>Продолжить {Ic.chevR}</Link>
          </div>
        </div>
      )}

      {/* DONE — completed, ready to send */}
      {status === 'done' && (
        <div style={{padding: 16}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div style={{display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap'}}>
              {[['good', 'Хорошо', counts.good], ['warn', 'Внимание', counts.warn], ['crit', 'Критично', counts.crit]].map(([t, l, n]) => (
                <div key={t} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 4}}>
                  <span className={`dot ${t === 'good' ? 'success' : t === 'warn' ? 'warning' : 'danger'}`} />
                  <span style={{fontSize: 12, color: 'var(--muted)'}}>{l}</span>
                  <span className="l-mono" style={{fontSize: 14, fontWeight: 700, color: t === 'good' ? 'var(--success)' : t === 'warn' ? 'var(--warning)' : 'var(--danger)'}}>{n}</span>
                </div>
              ))}
            </div>
            <div style={{display: 'flex', gap: 6, flexShrink: 0}}>
              <Link to={`/diagnostics/${shipNum}`} className="btn">Открыть карту</Link>
              <button className="btn primary">Отправить клиенту</button>
            </div>
          </div>
          {recCount > 0 && (
            <div className="banner warning" style={{padding: 10, marginTop: 12}}>
              <span style={{display: 'flex'}}>{Ic.alert}</span>
              <div>
                <div className="b-title">{recCount} {recCount === 1 ? 'рекомендация' : 'рекомендации'} для клиента</div>
                <div className="b-body">Можно добавить в эту отгрузку отдельными позициями или предложить на следующий визит.</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SKIP — explicitly not needed */}
      {status === 'skip' && (
        <div style={{padding: 16, display: 'flex', alignItems: 'center', gap: 16}}>
          <span style={{fontSize: 13, color: 'var(--muted)', flex: 1}}>Диагностика не требуется для этой отгрузки (например, простая доливка).</span>
          <button className="btn ghost" onClick={() => setStatus('none')}>Вернуть диагностику</button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Shipment detail + Precheck preview
   ============================================================ */
function ShipmentDetailScreen() {
  const r = useRoute();
  const num = (r.params && r.params.id) || 'TGM-2026-0436';
  const s = SHIPMENTS.find(x => x.num === num) || SHIPMENTS[2];
  const c = CLIENTS.find(x => x.id === s.client);
  const m = USERS[s.master];
  const [tab, setTab] = useState('items');

  // demo items
  const demoItems = [
    { sku: 'ZFL-LG8-1L', name: 'ZF LifeGuard 8 (ATF)', cell: 'C-02', qty: 9.5, price: 1990, cost: 1280, kind: 'товар' },
    { sku: 'ZF-OF-0501', name: 'Фильтр ZF 0501 219 824 (оригинал)', cell: 'B-12', qty: 1, price: 4800, cost: 2840, kind: 'товар' },
    { sku: 'ZF-PAN-0501', name: 'Прокладка поддона ZF 0501 216 243', cell: 'B-12', qty: 1, price: 1200, cost: 560, kind: 'товар' },
    { sku: 'SRV-ATF-FULL', name: 'Услуга: полная аппаратная замена ATF', cell: '—', qty: 1, price: 7500, cost: 0, kind: 'услуга' },
    { sku: 'SRV-DIAG', name: 'Диагностика по чек-листу', cell: '—', qty: 1, price: 0, cost: 0, kind: 'услуга' },
  ];
  const subtotal = demoItems.reduce((sum, it) => sum + it.price * it.qty, 0);

  return (
    <div className="container page" style={{paddingBottom: 100}}>
      <div className="page-head">
        <div>
          <div className="page-crumbs">
            <Link to="/home">Главная</Link><span className="sep">/</span>
            <Link to="/shipments">Отгрузки</Link><span className="sep">/</span>
            <span className="cur l-mono">{s.num}</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Отгрузка <span className="l-mono" style={{fontWeight: 700}}>{s.num}</span></h1>
            <StatusBadge status={s.status} />
            <span className="badge success sm"><span className="dot success" />Оплачено</span>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn ghost">{Ic.copy} Копировать</button>
          <button className="btn">{Ic.print} Заказ-наряд</button>
          <button className="btn">{Ic.print} Наклейка</button>
          <button className="btn primary">Открыть предчек {Ic.chevR}</button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'flex-start'}}>
        {/* Main pane */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {/* Header card with car + client */}
          <div className="card" style={{padding: 0}}>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--line)'}}>
              <div style={{background: 'var(--surface)', padding: 18}}>
                <div className="l-eyebrow">Клиент</div>
                <div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 10}}>
                  <Avatar initials={c.name.split(' ').map(x => x[0]).join('')} size={44} />
                  <div>
                    <div style={{fontSize: 16, fontWeight: 600}}>{c.name}</div>
                    <div className="l-mono" style={{fontSize: 12, color: 'var(--muted)', marginTop: 2}}>{c.phone} · {c.visits} {c.visits === 1 ? 'визит' : 'визита'}</div>
                  </div>
                </div>
              </div>
              <div style={{background: 'var(--surface)', padding: 18}}>
                <div className="l-eyebrow">Автомобиль</div>
                <div style={{fontSize: 16, fontWeight: 600, marginTop: 10}}>{c.car}</div>
                <div className="l-mono" style={{fontSize: 12, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.06em'}}>{c.plate} · VIN {s.vin}</div>
                <div style={{marginTop: 8, display: 'flex', gap: 12, fontSize: 11, color: 'var(--muted)'}}>
                  <span>Пробег <span style={{color: 'var(--ink)', fontWeight: 600, fontFamily: 'var(--f-mono)'}}>189 300 км</span></span>
                  <span>·</span>
                  <span>Год <span style={{color: 'var(--ink)', fontWeight: 600}}>2016</span></span>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div>
            <div className="tabs">
              <button className={`tab ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>Позиции<span className="count">{demoItems.length}</span></button>
              <button className={`tab ${tab === 'diag' ? 'active' : ''}`} onClick={() => setTab('diag')}>Диагностика<span className="count">{DIAG_BLOCKS.flatMap(b => b.items).length}</span></button>
              <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>История изменений<span className="count">8</span></button>
              <button className={`tab ${tab === 'precheck' ? 'active' : ''}`} onClick={() => setTab('precheck')}>Предчек</button>
            </div>

            {tab === 'items' && (
              <div className="tbl-wrap" style={{marginTop: 16}}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{width: 36}}>#</th>
                      <th>Артикул / название</th>
                      <th>Ячейка</th>
                      <th>Тип</th>
                      <th className="num">Кол.</th>
                      <th className="num">Цена</th>
                      <th className="num">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demoItems.map((it, i) => (
                      <tr key={i}>
                        <td className="muted mono">{(i+1).toString().padStart(2,'0')}</td>
                        <td>
                          <div style={{fontWeight: 500, color: 'var(--ink)'}}>{it.name}</div>
                          <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{it.sku}</div>
                        </td>
                        <td className="mono">{it.cell}</td>
                        <td><span className="badge sm outline">{it.kind}</span></td>
                        <td className="num">{it.qty}</td>
                        <td className="num">{fmtMoneyPlain(it.price)} ₽</td>
                        <td className="num strong">{fmtMoney(it.price * it.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'precheck' && <PrecheckPreview num={s.num} c={c} items={demoItems} subtotal={subtotal} />}

            {tab === 'diag' && (
              <div className="card card-pad" style={{marginTop: 16}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14}}>
                  <div className="banner info" style={{flex: 1}}>
                    <span style={{display: 'flex'}}>{Ic.info}</span>
                    <div>
                      <div className="b-title">Диагностика {DIAG_BLOCKS.flatMap(b => b.items).length} пунктов завершена</div>
                      <div className="b-body">Все блоки проверены. Рекомендации сформированы. Публичный отчёт отправлен клиенту в Telegram.</div>
                    </div>
                  </div>
                  <div style={{display: 'flex', gap: 6, flexShrink: 0}}>
                    <a href={`#/diag-print/${s.num}`} className="btn">{Ic.print} Печать карты</a>
                    <Link to={`/diagnostics/${s.num}`} className="btn">Открыть карту</Link>
                  </div>
                </div>
                {DIAG_BLOCKS.map(b => (
                  <div key={b.id} style={{marginBottom: 16}}>
                    <div className="l-eyebrow" style={{marginBottom: 8}}>{b.title}</div>
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8}}>
                      {b.items.map(it => {
                        const st = DIAG_STATE.items[it.id] || { status: 'unchecked' };
                        const ds = DIAG_STATUS[st.status] || DIAG_STATUS.unchecked;
                        return (
                          <div key={it.id} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface-sunk)', borderRadius: 4}}>
                            <span className="dot" style={{background: ds.color}} />
                            <span style={{fontSize: 12, flex: 1}}>{it.label}</span>
                            {st.value && <span className="l-mono" style={{fontSize: 11, color: 'var(--muted)'}}>{st.value}</span>}
                            <span style={{fontSize: 10, fontWeight: 600, color: ds.color, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 78, textAlign: 'right'}}>
                              {ds.short || ds.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'history' && (
              <div className="card" style={{marginTop: 16, padding: 0}}>
                {[
                  {t: '11:47', who: 'Сергей И.', a: 'Отгрузка завершена · статус → Завершено'},
                  {t: '11:42', who: 'Сергей И.', a: 'Оплачено картой через AQSI · 32 400 ₽'},
                  {t: '11:38', who: 'Сергей И.', a: 'Добавлена услуга «Полная аппаратная замена ATF» · 7 500 ₽'},
                  {t: '11:24', who: 'Сергей И.', a: 'Скидка изменена 0% → 0%'},
                  {t: '10:15', who: 'Сергей И.', a: 'Добавлены позиции (3 шт): ZF LifeGuard 8, фильтр, прокладка'},
                  {t: '10:12', who: 'Сергей И.', a: 'VIN сверен · WP1AB2A28GLA21104'},
                  {t: '10:00', who: 'Анна Л.', a: 'Создан черновик отгрузки'},
                  {t: '09:48', who: 'Анна Л.', a: 'Клиент подтвердил запись на 10:00'},
                ].map((h, i) => (
                  <div key={i} style={{display: 'flex', gap: 16, padding: '10px 16px', borderBottom: i === 7 ? 'none' : '1px solid var(--line)', alignItems: 'baseline'}}>
                    <span className="l-mono" style={{fontSize: 12, color: 'var(--muted)', minWidth: 50}}>{h.t}</span>
                    <span style={{fontSize: 12, fontWeight: 600, minWidth: 90}}>{h.who}</span>
                    <span style={{fontSize: 12.5, color: 'var(--ink-2)'}}>{h.a}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Totals sidebar */}
        <aside style={{position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h) + 16px)', display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Сумма</span><span className="badge success sm">оплачено</span></div>
            <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
              <Row k="Подытог" v={fmtMoney(subtotal)} />
              <Row k="Скидка" v="0%" />
              <div className="divider-dashed" />
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontSize: 13, color: 'var(--muted)'}}>Итого</span>
                <span className="l-money" style={{fontSize: 26, fontWeight: 700}}>{fmtMoney(s.sum)}</span>
              </div>
              <div className="divider-dashed" />
              <Row k="Оплачено картой" v={fmtMoney(s.sum)} tone="success" />
              <Row k="через AQSI · 11:42" v="" />
            </div>
          </div>

          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Связи</span></div>
            <div style={{padding: '4px 4px 8px'}}>
              {[
                {l: 'Запись клиента', v: 'YCLIENTS · подтверждён', i: 'user'},
                {l: 'Расход со склада', v: 'СПС-2026-0289 · 5 поз.', i: 'box'},
                {l: 'Чек AQSI', v: 'AQ-78422', i: 'cash'},
                {l: 'Отчёт диагностики', v: 'tgm.report/4Vh2P', i: 'chart'},
              ].map((l, i) => (
                <a key={i} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderRadius: 4}}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{color: 'var(--muted)', display: 'flex'}}>{Ic[l.i]}</span>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div style={{fontSize: 12.5, fontWeight: 500}}>{l.l}</div>
                    <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{l.v}</div>
                  </div>
                  <span style={{color: 'var(--faint)'}}>{Ic.chevR}</span>
                </a>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PrecheckPreview({ num, c, items, subtotal }) {
  return (
    <div style={{marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 400px', gap: 16, alignItems: 'flex-start'}}>
      <div className="card card-pad">
        <div className="banner info">
          <span style={{display: 'flex'}}>{Ic.info}</span>
          <div>
            <div className="b-title">Превью предчека</div>
            <div className="b-body">Передай клиенту до фискализации. Подпись клиента и общая сумма обязательны.</div>
          </div>
        </div>

        <div style={{display: 'flex', gap: 8, marginTop: 16}}>
          <button className="btn primary">{Ic.print} Печать предчека</button>
          <button className="btn">Отправить в Telegram</button>
          <button className="btn">Отправить в SMS</button>
          <button className="btn ghost">Скачать PDF</button>
        </div>

        <div style={{marginTop: 16}}>
          <div className="l-eyebrow muted" style={{marginBottom: 8}}>Предпросмотр документа · 80 мм</div>
          <div className="receipt" style={{maxWidth: 320, margin: '0 auto'}}>
            <div style={{textAlign: 'center'}}>
              <h1>ТАМ ГДЕ МАСЛО.</h1>
              <div style={{fontSize: 10, color: 'var(--muted)'}}>КАЛИНИНГРАД · МОСКОВСКИЙ 244</div>
              <div style={{fontSize: 10, color: 'var(--muted)'}}>+7 (4012) 77-22-11</div>
            </div>
            <div className="sep" />
            <div className="row"><span>ПРЕДЧЕК</span><span>{num}</span></div>
            <div className="row"><span>ДАТА</span><span>23.05.2026 14:48</span></div>
            <div className="row"><span>МАСТЕР</span><span>СЕРГЕЙ И.</span></div>
            <div className="row"><span>КЛИЕНТ</span><span>{c.name}</span></div>
            <div className="row"><span>АВТО</span><span>{c.car.split(' (')[0]}</span></div>
            <div className="row"><span>VIN</span><span>{c.vin.slice(-8)}</span></div>
            <div className="sep" />
            {items.map((it, i) => (
              <div key={i} style={{marginBottom: 6}}>
                <div style={{fontWeight: 600, fontSize: 10}}>{it.name}</div>
                <div className="row" style={{fontSize: 10, color: 'var(--muted)'}}>
                  <span>{it.qty} × {fmtMoneyPlain(it.price)}</span>
                  <span style={{color: 'var(--ink)'}}>{fmtMoney(it.price * it.qty)}</span>
                </div>
              </div>
            ))}
            <div className="sep" />
            <div className="row" style={{fontSize: 14}}><span>ИТОГО</span><span>{fmtMoney(subtotal)}</span></div>
            <div className="row" style={{fontSize: 9, color: 'var(--muted)'}}><span>в т.ч. НДС 20%</span><span>{fmtMoney(subtotal * 0.2 / 1.2)}</span></div>
            <div className="sep" />
            <div style={{textAlign: 'center', fontSize: 9, color: 'var(--muted)', marginTop: 8}}>
              Не является фискальным документом.<br />
              Чек выдаётся при оплате через AQSI.
            </div>
            <div style={{textAlign: 'center', marginTop: 14, fontFamily: 'var(--f-mono)', fontSize: 10}}>
              ___________________________<br />
              ПОДПИСЬ КЛИЕНТА
            </div>
          </div>
        </div>
      </div>

      {/* Right: actions log */}
      <div className="card" style={{padding: 0}}>
        <div className="card-head"><span className="h-h3">Перед фискализацией</span></div>
        <div style={{padding: '8px 0 16px'}}>
          {[
            {l: 'Сверь сумму с клиентом', d: '32 400 ₽ · карта/наличные/СБП', done: true},
            {l: 'Получи подпись клиента', d: 'на бумаге или в Telegram-боте', done: true},
            {l: 'Выбери метод оплаты', d: 'AQSI: терминал #2 готов', done: false, active: true},
            {l: 'Фискализируй через AQSI', d: 'чек уйдёт автоматически', done: false},
            {l: 'Распечатай наклейку под капот', d: '50 × 80 мм', done: false},
          ].map((s, i) => (
            <div key={i} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px'}}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                background: s.done ? 'var(--success)' : (s.active ? 'var(--rust)' : 'var(--surface-deep)'),
                color: s.done || s.active ? '#fff' : 'var(--muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>{s.done ? '✓' : (i+1)}</span>
              <div style={{flex: 1}}>
                <div style={{fontSize: 12.5, fontWeight: 500, color: s.done ? 'var(--ink-2)' : 'var(--ink)'}}>{s.l}</div>
                <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 1}}>{s.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-foot">
          <button className="btn">Назад</button>
          <button className="btn primary">К оплате через AQSI {Ic.chevR}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ShipmentsListScreen, NewShipmentScreen, ShipmentDetailScreen });
