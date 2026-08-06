// ====================================================================
//  screens/inventory.jsx — Products list + Receiving + Write-off
// ====================================================================

/* ============================================================
   Products / catalog
   ============================================================ */
function ProductsScreen() {
  const [q, setQ] = useState('');
  const [brands, setBrands] = useState(new Set());
  const [cats, setCats] = useState(new Set(['Моторное масло']));
  const [saes, setSaes] = useState(new Set());
  const [stockFilter, setStockFilter] = useState('all'); // all | in | low | out

  const allBrands = [...new Set(PRODUCTS.map(p => p.brand))];
  const allCats = [...new Set(PRODUCTS.map(p => p.cat))];
  const allSaes = [...new Set(PRODUCTS.map(p => p.sae).filter(s => s !== '—'))];

  const toggle = (set, setter, v) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    setter(n);
  };

  const filtered = PRODUCTS.filter(p => {
    if (q) {
      const Q = q.toLowerCase();
      if (![p.name, p.sku, p.oem, p.brand].some(s => s.toLowerCase().includes(Q))) return false;
    }
    if (brands.size && !brands.has(p.brand)) return false;
    if (cats.size && !cats.has(p.cat)) return false;
    if (saes.size && !saes.has(p.sae)) return false;
    if (stockFilter === 'in' && p.stock < 5) return false;
    if (stockFilter === 'low' && (p.stock >= 5 || p.stock === 0)) return false;
    if (stockFilter === 'out' && p.stock > 0) return false;
    return true;
  });

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><span>Склад</span><span className="sep">/</span><span className="cur">Товары</span></div>
          <h1 className="page-title">Товары <span className="muted" style={{fontWeight: 500, fontSize: 16}}>· {filtered.length} из {PRODUCTS.length}</span></h1>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn">{Ic.download} Выгрузить</button>
          <button className="btn primary">{Ic.plus} Новый товар</button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'flex-start'}}>
        {/* Filter rail */}
        <div className="filter-rail">
          <div className="filter-group">
            <div className="filter-title">Поиск <a className="clear">× очистить</a></div>
            <div className="inp-wrap">
              <span className="lead">{Ic.search}</span>
              <input className="inp" placeholder="Артикул, OEM, бренд…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>

          <div className="filter-group">
            <div className="filter-title">Категория</div>
            {allCats.map(c => {
              const on = cats.has(c);
              const count = PRODUCTS.filter(p => p.cat === c).length;
              return (
                <div key={c} className="filter-row" onClick={() => toggle(cats, setCats, c)}>
                  <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <span className={`chk ${on ? 'on' : ''}`} />
                    {c}
                  </span>
                  <span className="ct">{count}</span>
                </div>
              );
            })}
          </div>

          <div className="filter-group">
            <div className="filter-title">Бренд {brands.size > 0 && <a className="clear" onClick={() => setBrands(new Set())}>× очистить</a>}</div>
            {allBrands.map(b => {
              const on = brands.has(b);
              const count = PRODUCTS.filter(p => p.brand === b).length;
              return (
                <div key={b} className="filter-row" onClick={() => toggle(brands, setBrands, b)}>
                  <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <span className={`chk ${on ? 'on' : ''}`} />
                    {b}
                  </span>
                  <span className="ct">{count}</span>
                </div>
              );
            })}
          </div>

          <div className="filter-group">
            <div className="filter-title">SAE / Вязкость</div>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4}}>
              {allSaes.map(s => {
                const on = saes.has(s);
                return (
                  <button key={s} className={`pill ${on ? 'on' : ''}`} onClick={() => toggle(saes, setSaes, s)} style={{height: 24, fontSize: 11}}>{s}</button>
                );
              })}
            </div>
          </div>

          <div className="filter-group">
            <div className="filter-title">Остаток</div>
            {[
              {k: 'all', l: 'Все товары'},
              {k: 'in', l: 'В наличии (5+)'},
              {k: 'low', l: 'Мало · < 5'},
              {k: 'out', l: 'Нет в наличии'},
            ].map(f => (
              <div key={f.k} className="filter-row" onClick={() => setStockFilter(f.k)}>
                <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                  <span className="chk" style={{borderRadius: '50%', ...(stockFilter === f.k ? {background: 'var(--rust)', borderColor: 'var(--rust)'} : {})}}>
                    {stockFilter === f.k && <span style={{width: 6, height: 6, background: '#fff', borderRadius: '50%'}} />}
                  </span>
                  {f.l}
                </span>
                <span className="ct">{
                  f.k === 'all' ? PRODUCTS.length :
                  f.k === 'in' ? PRODUCTS.filter(p => p.stock >= 5).length :
                  f.k === 'low' ? PRODUCTS.filter(p => p.stock > 0 && p.stock < 5).length :
                  PRODUCTS.filter(p => p.stock === 0).length
                }</span>
              </div>
            ))}
          </div>

          <div className="filter-group">
            <div className="filter-title">Поставщик</div>
            {[...new Set(PRODUCTS.map(p => p.supplier))].slice(0, 4).map(s => (
              <div key={s} className="filter-row">
                <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                  <span className="chk" />{s}
                </span>
                <span className="ct">{PRODUCTS.filter(p => p.supplier === s).length}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Table */}
        <div>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap'}}>
            {cats.size > 0 && [...cats].map(c => <button key={c} className="pill on" onClick={() => toggle(cats, setCats, c)}>{c} <span className="x">{Ic.x}</span></button>)}
            {brands.size > 0 && [...brands].map(b => <button key={b} className="pill on" onClick={() => toggle(brands, setBrands, b)}>{b} <span className="x">{Ic.x}</span></button>)}
            {(cats.size + brands.size + saes.size) > 0 && <button className="pill" style={{borderStyle: 'dashed'}} onClick={() => { setCats(new Set()); setBrands(new Set()); setSaes(new Set()); }}>× Сбросить всё</button>}
            <div style={{flex: 1}} />
            <span className="l-meta">{filtered.length} из {PRODUCTS.length} артикулов</span>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width: 36}}><span className="chk" /></th>
                  <th>Артикул</th>
                  <th>Название</th>
                  <th>Спец.</th>
                  <th>Ячейка</th>
                  <th className="num">Остаток</th>
                  <th className="num">Доступно</th>
                  <th className="num">Резерв</th>
                  <th className="num">Закуп.</th>
                  <th className="num">Цена</th>
                  <th className="num">Маржа</th>
                  <th style={{width: 60}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const margin = (p.price - p.cost) / p.price * 100;
                  const stockTone = p.stock === 0 ? 'danger' : p.stock < 5 ? 'warning' : 'success';
                  return (
                    <tr key={p.sku}>
                      <td><span className="chk" /></td>
                      <td className="mono">{p.sku}</td>
                      <td>
                        <div style={{fontWeight: 500, color: 'var(--ink)'}}>{p.name}</div>
                        <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.04em'}}>
                          OEM {p.oem} · {p.brand} · {p.vol} · {p.supplier}
                        </div>
                      </td>
                      <td>
                        {p.sae !== '—' && <div style={{fontSize: 12, fontWeight: 600}}>{p.sae}</div>}
                        {p.api !== '—' && <div style={{fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--f-mono)'}}>API {p.api} · {p.acea}</div>}
                      </td>
                      <td className="mono">{p.cell}</td>
                      <td className="num"><span className={`badge ${stockTone} sm`} style={{minWidth: 32, justifyContent: 'center'}}>{p.stock}</span></td>
                      <td className="num">{p.avail}</td>
                      <td className="num muted">{p.reserve}</td>
                      <td className="num muted">{fmtMoneyPlain(p.cost)}</td>
                      <td className="num strong">{fmtMoneyPlain(p.price)} ₽</td>
                      <td className="num" style={{color: margin >= 35 ? 'var(--success)' : margin >= 25 ? 'var(--ink)' : 'var(--warning)', fontWeight: 600}}>{Math.round(margin)}%</td>
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

          {filtered.length === 0 && (
            <div className="empty" style={{marginTop: 16}}>
              <div className="e-title">Ничего не нашлось</div>
              <div className="e-body">Попробуй сбросить фильтры или изменить поисковую строку.</div>
              <button className="btn">Сбросить фильтры</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Receiving (приёмка)
   ============================================================ */
function ReceivingScreen() {
  return (
    <div className="container page" style={{paddingBottom: 100}}>
      <div className="page-head">
        <div>
          <div className="page-crumbs">
            <Link to="/home">Главная</Link><span className="sep">/</span>
            <span>Склад</span><span className="sep">/</span>
            <span className="cur l-mono">{RECEIVING.num}</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Приёмка · <span className="l-mono">{RECEIVING.num}</span></h1>
            <span className="badge warning"><span className="dot warning" />черновик</span>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn ghost">Удалить</button>
          <button className="btn">Сохранить</button>
          <button className="btn primary">Провести приёмку →</button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'flex-start'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {/* Header form */}
          <div className="card card-pad">
            <div className="form-grid cols-4" style={{gap: 14}}>
              <div className="field">
                <label className="field-label">Дата приёмки</label>
                <input className="inp" value={RECEIVING.date} />
              </div>
              <div className="field">
                <label className="field-label">Поставщик</label>
                <input className="inp" value={RECEIVING.supplier} />
              </div>
              <div className="field">
                <label className="field-label">Счёт / накладная</label>
                <input className="inp mono" value={RECEIVING.invoice} />
              </div>
              <div className="field">
                <label className="field-label">Ответственный</label>
                <input className="inp" value="Дмитрий Косов" />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="card" style={{padding: 0}}>
            <div className="card-head">
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <span className="h-h3">Поступающие позиции</span>
                <span className="badge sm">{RECEIVING.items.length}</span>
              </div>
              <div style={{display: 'flex', gap: 6}}>
                <button className="btn sm">{Ic.search} Найти товар</button>
                <button className="btn sm">{Ic.plus} Новый артикул</button>
                <button className="btn sm">Из Россько →</button>
              </div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width: 36}}>#</th>
                  <th>Артикул · название</th>
                  <th>Ячейка</th>
                  <th className="num">Кол.</th>
                  <th className="num">Закуп. за ед.</th>
                  <th className="num">Сумма</th>
                  <th className="num">Новый остаток</th>
                  <th style={{width: 60}}></th>
                </tr>
              </thead>
              <tbody>
                {RECEIVING.items.map((it, i) => {
                  const p = PRODUCTS.find(x => x.sku === it.sku);
                  const newStock = p.stock + it.qty;
                  return (
                    <tr key={it.sku}>
                      <td className="muted mono">{(i+1).toString().padStart(2,'0')}</td>
                      <td>
                        <div style={{fontWeight: 500, color: 'var(--ink)'}}>{p.name}</div>
                        <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.04em'}}>{p.sku} · OEM {p.oem}</div>
                      </td>
                      <td className="mono">{p.cell}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">{fmtMoneyPlain(it.cost)} ₽</td>
                      <td className="num strong">{fmtMoney(it.cost * it.qty)}</td>
                      <td className="num">
                        <span style={{color: 'var(--muted)'}}>{p.stock}</span>
                        <span style={{color: 'var(--success)', margin: '0 4px'}}>→</span>
                        <span style={{fontWeight: 700}}>{newStock}</span>
                      </td>
                      <td><div className="row-action"><IconBtn icon="trash" kind="ghost" /></div></td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="muted mono">{(RECEIVING.items.length + 1).toString().padStart(2,'0')}</td>
                  <td colSpan={6}>
                    <button style={{background: 'transparent', border: 'none', color: 'var(--rust)', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: 0, display: 'flex', gap: 8, alignItems: 'center'}}>
                      {Ic.plus} Добавить позицию
                    </button>
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Локальный складской учёт */}
          <div className="banner info">
            <span style={{display: 'flex'}}>{Ic.info}</span>
            <div>
              <div className="b-title">После проведения приёмки</div>
              <div className="b-body">
                Остатки обновятся во внутреннем учёте. Будет создан счёт поставщика
                <span style={{color: 'var(--ink)', fontWeight: 600, fontFamily: 'var(--f-mono)', marginLeft: 4}}>СЧ-2026-0102</span>
                со сроком оплаты 30 дней.
              </div>
            </div>
          </div>
        </div>

        {/* Totals */}
        <aside style={{position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h) + 16px)', display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Итог приёмки</span></div>
            <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
              {(() => {
                const sum = RECEIVING.items.reduce((s, it) => s + it.cost * it.qty, 0);
                const qty = RECEIVING.items.reduce((s, it) => s + it.qty, 0);
                const value = RECEIVING.items.reduce((s, it) => {
                  const p = PRODUCTS.find(x => x.sku === it.sku);
                  return s + p.price * it.qty;
                }, 0);
                return (
                  <>
                    <Row k="Позиций" v={RECEIVING.items.length} />
                    <Row k="Единиц товара" v={qty + ' шт'} />
                    <div className="divider-dashed" />
                    <Row k="Сумма закупки" v={fmtMoney(sum)} />
                    <Row k="Прогнозная розница" v={fmtMoney(value)} />
                    <Row k="Прогнозная маржа" v={fmtMoney(value - sum)} tone="success" />
                  </>
                );
              })()}
            </div>
            <div className="panel-foot">
              <button className="btn">Сохранить</button>
              <button className="btn primary">Провести {Ic.chevR}</button>
            </div>
          </div>

          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Связи</span></div>
            <div style={{padding: '4px 4px 8px'}}>
              {[
                {l: 'Счёт поставщика', v: 'СЧ-2026-0102 · к оплате', i: 'cash', tone: 'warning'},
                {l: 'Поставщик', v: 'Альфа-Ойл · 14 поставок', i: 'user'},
                {l: 'Накладная (скан)', v: 'счёт-фактура.pdf', i: 'download'},
              ].map((l, i) => (
                <a key={i} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderRadius: 4}}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{color: l.tone === 'warning' ? 'var(--warning)' : 'var(--muted)', display: 'flex'}}>{Ic[l.i]}</span>
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

/* ============================================================
   Write-off (списание)
   ============================================================ */
function WriteoffScreen() {
  const items = [
    { sku: 'SHL-HU-5W40-4L', qty: 1, reason: 'Брак · нарушена пломба канистры', cost: 3120 },
    { sku: 'MNN-HU815', qty: 2, reason: 'Повреждена упаковка при разгрузке', cost: 410 },
  ];

  return (
    <div className="container page" style={{paddingBottom: 100}}>
      <div className="page-head">
        <div>
          <div className="page-crumbs">
            <Link to="/home">Главная</Link><span className="sep">/</span>
            <span>Склад</span><span className="sep">/</span>
            <span className="cur l-mono">СПС-2026-0014</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Списание · <span className="l-mono">СПС-2026-0014</span></h1>
            <span className="badge warning"><span className="dot warning" />черновик</span>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn ghost">Удалить</button>
          <button className="btn">Сохранить</button>
          <button className="btn danger">Провести списание →</button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'flex-start'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          <div className="card card-pad">
            <div className="form-grid cols-3" style={{gap: 14}}>
              <div className="field">
                <label className="field-label">Дата</label>
                <input className="inp" value="23.05.2026" />
              </div>
              <div className="field">
                <label className="field-label">Основание</label>
                <select className="inp" defaultValue="Брак / повреждение"><option>Брак / повреждение</option><option>Истёк срок годности</option><option>Внутреннее использование</option><option>Расход на ремонт оборудования</option></select>
              </div>
              <div className="field">
                <label className="field-label">Ответственный</label>
                <input className="inp" value="Дмитрий Косов" />
              </div>
            </div>
          </div>

          <div className="card" style={{padding: 0}}>
            <div className="card-head">
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <span className="h-h3">Списываемые позиции</span>
                <span className="badge sm">{items.length}</span>
              </div>
              <button className="btn sm">{Ic.plus} Добавить позицию</button>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width: 36}}>#</th>
                  <th>Артикул · название</th>
                  <th>Ячейка</th>
                  <th className="num">Был остаток</th>
                  <th className="num">Списать</th>
                  <th className="num">Станет</th>
                  <th>Причина</th>
                  <th className="num">Сумма</th>
                  <th style={{width: 60}}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const p = PRODUCTS.find(x => x.sku === it.sku);
                  return (
                    <tr key={it.sku}>
                      <td className="muted mono">{(i+1).toString().padStart(2,'0')}</td>
                      <td>
                        <div style={{fontWeight: 500, color: 'var(--ink)'}}>{p.name}</div>
                        <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{p.sku}</div>
                      </td>
                      <td className="mono">{p.cell}</td>
                      <td className="num">{p.stock}</td>
                      <td className="num" style={{color: 'var(--danger)', fontWeight: 700}}>− {it.qty}</td>
                      <td className="num strong">{p.stock - it.qty}</td>
                      <td style={{fontSize: 12}}>{it.reason}</td>
                      <td className="num strong" style={{color: 'var(--danger)'}}>− {fmtMoney(it.cost * it.qty)}</td>
                      <td><div className="row-action"><IconBtn icon="trash" kind="ghost" /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="banner danger">
            <span style={{display: 'flex'}}>{Ic.alert}</span>
            <div>
              <div className="b-title">Действие необратимо</div>
              <div className="b-body">
                Списание уменьшит остатки во внутреннем учёте как «Списание брака».
                Сумма {fmtMoney(items.reduce((s, it) => s + it.cost * it.qty, 0))} будет отнесена на расходы.
              </div>
            </div>
          </div>
        </div>

        <aside style={{position: 'sticky', top: 'calc(var(--topbar-h) + var(--substrip-h) + 16px)'}}>
          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Итог</span></div>
            <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
              <Row k="Позиций" v={items.length} />
              <Row k="Единиц" v={items.reduce((s, it) => s + it.qty, 0) + ' шт'} />
              <div className="divider-dashed" />
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontSize: 13, color: 'var(--muted)'}}>Расход списания</span>
                <span className="l-money" style={{fontSize: 22, fontWeight: 700, color: 'var(--danger)'}}>− {fmtMoney(items.reduce((s, it) => s + it.cost * it.qty, 0))}</span>
              </div>
            </div>
            <div className="panel-foot">
              <button className="btn">Сохранить</button>
              <button className="btn danger">Провести</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { ProductsScreen, ReceivingScreen, WriteoffScreen });
