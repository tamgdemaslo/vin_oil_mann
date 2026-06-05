// ====================================================================
//  screens/restock.jsx — Пополнение остатков (auto-suggest)
// ====================================================================

const RESTOCK_RULES = {
  // sku -> { min, target }
  'SHL-HU-5W40-4L':    { min: 10, target: 30, leadDays: 3,  velocity: 1.8 },
  'SHL-HU-0W40-4L':    { min: 8,  target: 20, leadDays: 3,  velocity: 0.9 },
  'MOB-1-ESP-5W30-4':  { min: 12, target: 30, leadDays: 3,  velocity: 1.6 },
  'MOB-1-0W20-4L':     { min: 8,  target: 18, leadDays: 5,  velocity: 0.5 },
  'ZIC-X9-LS-5W30-4':  { min: 20, target: 50, leadDays: 4,  velocity: 2.4 },
  'TOT-Q9-5W40-4L':    { min: 10, target: 24, leadDays: 5,  velocity: 1.1 },
  'LUK-GEN-AT-5W40-4': { min: 25, target: 60, leadDays: 7,  velocity: 3.1 },
  'BRD-XTC-5W40-4':    { min: 5,  target: 15, leadDays: 7,  velocity: 0.4 },
  'ELF-EVO-10W40-4':   { min: 15, target: 40, leadDays: 4,  velocity: 1.7 },
  'BMW-OF-LL01':       { min: 8,  target: 20, leadDays: 7,  velocity: 0.6 },
  'MNN-HU815':         { min: 12, target: 30, leadDays: 5,  velocity: 1.2 },
  'ZFL-LG8-1L':        { min: 20, target: 60, leadDays: 5,  velocity: 1.4 },
  'VAG-G060162-1L':    { min: 10, target: 30, leadDays: 5,  velocity: 0.8 },
  'BMW-OPLG-M14':      { min: 30, target: 100, leadDays: 7, velocity: 2.4 },
};

function RestockScreen() {
  const [grouped, setGrouped] = useState(true);
  const [order, setOrder] = useState(() => {
    // sku → qty to order
    const seed = {};
    Object.keys(RESTOCK_RULES).forEach(sku => {
      const p = PRODUCTS.find(x => x.sku === sku);
      const r = RESTOCK_RULES[sku];
      if (p && p.stock <= r.min) seed[sku] = Math.max(0, r.target - p.stock);
    });
    return seed;
  });

  // Build per-product analysis
  const rows = PRODUCTS
    .filter(p => RESTOCK_RULES[p.sku])
    .map(p => {
      const rule = RESTOCK_RULES[p.sku];
      const daysLeft = rule.velocity > 0 ? Math.round(p.stock / rule.velocity) : 999;
      const status = p.stock === 0 ? 'out'
                   : p.stock <= rule.min ? 'low'
                   : daysLeft <= rule.leadDays + 2 ? 'soon'
                   : 'ok';
      return { ...p, rule, daysLeft, status };
    })
    .sort((a, b) => {
      const order = { out: 0, low: 1, soon: 2, ok: 3 };
      return order[a.status] - order[b.status];
    });

  const needAction = rows.filter(r => r.status !== 'ok');

  // group by supplier
  const bySupplier = {};
  rows.forEach(r => {
    if ((order[r.sku] || 0) > 0) {
      bySupplier[r.supplier] = bySupplier[r.supplier] || [];
      bySupplier[r.supplier].push(r);
    }
  });
  const orderTotal = Object.values(order).reduce((s, q) => s + (q || 0), 0);
  const orderCost = rows.reduce((s, r) => s + (order[r.sku] || 0) * r.cost, 0);

  return (
    <div className="container page" style={{paddingBottom: 100}}>
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><span>Склад</span><span className="sep">/</span><span className="cur">Пополнение остатков</span></div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Пополнение остатков</h1>
            {needAction.length > 0 && <span className="badge warning"><span className="dot warning" />{needAction.length} требует внимания</span>}
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn">{Ic.refresh} Обновить рекомендации</button>
          <button className="btn primary" disabled={orderTotal === 0}>{Ic.plus} Создать заявки ({Object.keys(bySupplier).length})</button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16}}>
        <Kpi accent="var(--danger)" label="Закончилось" value={rows.filter(r => r.status === 'out').length} sub="критично · 0 шт на складе" />
        <Kpi accent="var(--warning)" label="Низкий остаток" value={rows.filter(r => r.status === 'low').length} sub="ниже минимума" />
        <Kpi accent="var(--info)" label="Скоро закончится" value={rows.filter(r => r.status === 'soon').length} sub="в пределах срока поставки" />
        <Kpi accent="var(--rust)" label="В черновике заявок" value={`${orderTotal} шт`} sub={`на сумму ${fmtMoney(orderCost)}`} mono />
      </div>

      <div className="tabs" style={{marginBottom: 16}}>
        <button className={`tab ${grouped ? 'active' : ''}`} onClick={() => setGrouped(true)}>По поставщикам<span className="count">{Object.keys(bySupplier).length || '—'}</span></button>
        <button className={`tab ${!grouped ? 'active' : ''}`} onClick={() => setGrouped(false)}>Все позиции<span className="count">{rows.length}</span></button>
      </div>

      {grouped && Object.keys(bySupplier).length === 0 && (
        <div className="empty">
          <div className="e-title">Сначала набери позиции</div>
          <div className="e-body">Внизу на вкладке «Все позиции» отметь, что заказать у каждого поставщика — здесь автоматически появятся черновики заявок.</div>
          <button className="btn" onClick={() => setGrouped(false)}>Перейти к позициям</button>
        </div>
      )}

      {grouped && Object.keys(bySupplier).length > 0 && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {Object.entries(bySupplier).map(([supplier, items]) => {
            const supSum = items.reduce((s, it) => s + (order[it.sku] || 0) * it.cost, 0);
            const supQty = items.reduce((s, it) => s + (order[it.sku] || 0), 0);
            return (
              <div key={supplier} className="card" style={{padding: 0}}>
                <div className="card-head">
                  <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                    <span className="h-h3">{supplier}</span>
                    <span className="badge sm">{items.length} позиций · {supQty} шт</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
                    <span className="l-money" style={{fontSize: 16, fontWeight: 700}}>{fmtMoney(supSum)}</span>
                    <button className="btn sm primary">Создать заявку →</button>
                  </div>
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Артикул · название</th>
                      <th className="num">Остаток</th>
                      <th className="num">Хватит на</th>
                      <th className="num">Заказать</th>
                      <th className="num">Цена закупки</th>
                      <th className="num">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(r => (
                      <tr key={r.sku}>
                        <td>
                          <div style={{fontWeight: 500, color: 'var(--ink)'}}>{r.name}</div>
                          <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{r.sku}</div>
                        </td>
                        <td className="num"><StockBadge p={r} /></td>
                        <td className="num">
                          <span className="l-mono" style={{fontWeight: 600}}>{r.daysLeft} дн</span>
                          <div style={{fontSize: 10, color: 'var(--muted)', marginTop: 2}}>при {r.rule.velocity}/день</div>
                        </td>
                        <td className="num">
                          <QtyEditor v={order[r.sku] || 0} onChange={v => setOrder(o => ({...o, [r.sku]: v}))} />
                        </td>
                        <td className="num muted">{fmtMoneyPlain(r.cost)} ₽</td>
                        <td className="num strong">{fmtMoney((order[r.sku] || 0) * r.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {!grouped && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Статус</th>
                <th>Артикул · название</th>
                <th>Поставщик</th>
                <th className="num">Остаток</th>
                <th className="num">Min / Target</th>
                <th className="num">Расход / день</th>
                <th className="num">Хватит на</th>
                <th className="num">Срок поставки</th>
                <th className="num">Рек. заказ</th>
                <th className="num">Заказать</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const recOrder = Math.max(0, r.rule.target - r.stock);
                return (
                  <tr key={r.sku}>
                    <td><StatusPill st={r.status} /></td>
                    <td>
                      <div style={{fontWeight: 500, color: 'var(--ink)'}}>{r.name}</div>
                      <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{r.sku}</div>
                    </td>
                    <td>{r.supplier}</td>
                    <td className="num"><StockBadge p={r} /></td>
                    <td className="num muted">{r.rule.min} / {r.rule.target}</td>
                    <td className="num muted">{r.rule.velocity}</td>
                    <td className="num" style={{color: r.daysLeft <= r.rule.leadDays ? 'var(--danger)' : r.daysLeft <= r.rule.leadDays + 5 ? 'var(--warning)' : 'var(--ink-2)', fontWeight: 600}}>{r.daysLeft} дн</td>
                    <td className="num muted">{r.rule.leadDays} дн</td>
                    <td className="num strong" style={{color: recOrder > 0 ? 'var(--rust)' : 'var(--muted)'}}>{recOrder > 0 ? `${recOrder} шт` : '—'}</td>
                    <td className="num"><QtyEditor v={order[r.sku] || 0} onChange={v => setOrder(o => ({...o, [r.sku]: v}))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StockBadge({ p }) {
  const tone = p.stock === 0 ? 'danger' : p.stock <= p.rule.min ? 'warning' : 'success';
  return <span className={`badge ${tone} sm`} style={{minWidth: 36, justifyContent: 'center', fontFamily: 'var(--f-mono)', fontWeight: 700}}>{p.stock}</span>;
}

function StatusPill({ st }) {
  const map = {
    out:  { l: 'Закончилось', t: 'danger' },
    low:  { l: 'Низкий',      t: 'warning' },
    soon: { l: 'Скоро',       t: 'info' },
    ok:   { l: 'Норма',       t: 'success' },
  }[st];
  return <span className={`badge ${map.t} sm`}><span className={`dot ${map.t}`} />{map.l}</span>;
}

function QtyEditor({ v, onChange }) {
  return (
    <div style={{display: 'inline-flex', alignItems: 'center', border: '1px solid var(--line-strong)', borderRadius: 4, overflow: 'hidden'}}>
      <button onClick={() => onChange(Math.max(0, v - 1))} style={{width: 24, height: 28, background: 'var(--surface)', border: 'none', cursor: 'pointer', color: 'var(--muted)'}}>−</button>
      <input
        value={v}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)))}
        style={{
          width: 44, height: 28, border: 'none', textAlign: 'center',
          fontFamily: 'var(--f-mono)', fontWeight: 700, fontSize: 13,
          color: v > 0 ? 'var(--rust)' : 'var(--ink)',
          background: v > 0 ? 'var(--rust-tint)' : 'var(--surface)',
        }}
      />
      <button onClick={() => onChange(v + 1)} style={{width: 24, height: 28, background: 'var(--surface)', border: 'none', cursor: 'pointer', color: 'var(--rust)'}}>+</button>
    </div>
  );
}

Object.assign(window, { RestockScreen });
