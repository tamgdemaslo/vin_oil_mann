// ====================================================================
//  screens/finance.jsx — Счета поставщиков + Прибыль
// ====================================================================

const SUPPLIER_INVOICES = [
  { num: 'СЧ-2026-0102', supplier: 'Альфа-Ойл',        invoiceDate: '20.05.2026', dueDate: '04.06.2026', amount: 184200, paid: 0,       items: 28, doc: 'счёт-фактура' },
  { num: 'СЧ-2026-0099', supplier: 'Mann+Hummel',      invoiceDate: '12.05.2026', dueDate: '10.06.2026', amount: 38400,  paid: 0,       items: 12, doc: 'счёт-фактура' },
  { num: 'СЧ-2026-0098', supplier: 'BMW Russland',     invoiceDate: '11.05.2026', dueDate: '05.06.2026', amount: 62100,  paid: 0,       items: 7,  doc: 'счёт + ТТН' },
  { num: 'СЧ-2026-0096', supplier: 'СК-Ойл',           invoiceDate: '08.05.2026', dueDate: '22.05.2026', amount: 92800,  paid: 0,       items: 22, doc: 'счёт-фактура' },
  { num: 'СЧ-2026-0094', supplier: 'ZF Baltic',        invoiceDate: '06.05.2026', dueDate: '20.05.2026', amount: 48200,  paid: 48200,   items: 14, doc: 'счёт-фактура' },
  { num: 'СЧ-2026-0091', supplier: 'РН-Север',         invoiceDate: '03.05.2026', dueDate: '17.05.2026', amount: 56400,  paid: 56400,   items: 18, doc: 'счёт + УПД' },
  { num: 'СЧ-2026-0089', supplier: 'Бардаль-Балтика',  invoiceDate: '02.05.2026', dueDate: '16.05.2026', amount: 28700,  paid: 28700,   items: 4,  doc: 'счёт' },
  { num: 'СЧ-2026-0088', supplier: 'Альфа-Ойл',        invoiceDate: '01.05.2026', dueDate: '31.05.2026', amount: 67200,  paid: 30000,   items: 18, doc: 'счёт' },
];

const TODAY = new Date(2026, 4, 23);
function daysBetween(dateStr) {
  const [d, m, y] = dateStr.split('.').map(Number);
  const target = new Date(y, m - 1, d);
  return Math.round((target - TODAY) / 86400000);
}

function SupplierInvoicesScreen() {
  const [tab, setTab] = useState('all');

  const enriched = SUPPLIER_INVOICES.map(inv => {
    const left = inv.amount - inv.paid;
    const dueDays = daysBetween(inv.dueDate);
    const state = left === 0 ? 'paid'
                : dueDays < 0 ? 'overdue'
                : inv.paid > 0 ? 'partial'
                : dueDays <= 7 ? 'due-soon'
                : 'upcoming';
    return { ...inv, left, dueDays, state };
  });

  const tabs = [
    { k: 'all',      l: 'Все',          c: enriched.length },
    { k: 'overdue',  l: 'Просрочены',   c: enriched.filter(i => i.state === 'overdue').length, tone: 'danger' },
    { k: 'due-soon', l: 'Скоро',        c: enriched.filter(i => i.state === 'due-soon').length, tone: 'warning' },
    { k: 'partial',  l: 'Частично',     c: enriched.filter(i => i.state === 'partial').length },
    { k: 'paid',     l: 'Оплачены',     c: enriched.filter(i => i.state === 'paid').length },
  ];
  const list = tab === 'all' ? enriched : enriched.filter(i => i.state === tab);

  const totalDue = enriched.filter(i => i.state !== 'paid').reduce((s, i) => s + i.left, 0);
  const overdueSum = enriched.filter(i => i.state === 'overdue').reduce((s, i) => s + i.left, 0);
  const next7Days = enriched.filter(i => i.dueDays >= 0 && i.dueDays <= 7).reduce((s, i) => s + i.left, 0);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><span>Финансы</span><span className="sep">/</span><span className="cur">Счета поставщиков</span></div>
          <h1 className="page-title">Счета поставщиков</h1>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn">{Ic.download} Выгрузка</button>
          <button className="btn primary">{Ic.plus} Новый счёт</button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16}}>
        <Kpi accent="var(--rust)" label="К оплате всего" value={fmtMoney(totalDue)} sub={`${enriched.filter(i => i.state !== 'paid').length} счетов`} mono />
        <Kpi accent="var(--danger)" label="Просрочено" value={fmtMoney(overdueSum)} sub={`${enriched.filter(i => i.state === 'overdue').length} счёт`} mono />
        <Kpi accent="var(--warning)" label="К оплате в 7 дней" value={fmtMoney(next7Days)} mono />
        <Kpi label="Оплачено в мае" value={fmtMoney(enriched.filter(i => i.state === 'paid').reduce((s, i) => s + i.paid, 0))} sub={`${enriched.filter(i => i.state === 'paid').length} счетов`} mono />
      </div>

      <div className="tabs" style={{marginBottom: 16}}>
        {tabs.map(t => (
          <button key={t.k} className={`tab ${tab === t.k ? 'active' : ''}`} onClick={() => setTab(t.k)}>
            {t.l}<span className="count">{t.c}</span>
          </button>
        ))}
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width: 36}}><span className="chk" /></th>
              <th>№ счёта</th>
              <th>Поставщик</th>
              <th>Дата счёта</th>
              <th>Срок оплаты</th>
              <th>Статус</th>
              <th className="num">Сумма</th>
              <th className="num">Оплачено</th>
              <th className="num">Остаток</th>
              <th style={{width: 100}}></th>
            </tr>
          </thead>
          <tbody>
            {list.map(inv => (
              <tr key={inv.num}>
                <td><span className="chk" /></td>
                <td>
                  <div className="mono strong" style={{color: 'var(--ink)'}}>{inv.num}</div>
                  <div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{inv.doc}</div>
                </td>
                <td className="strong">{inv.supplier}<div className="l-mono" style={{fontSize: 11, color: 'var(--muted)', marginTop: 2, fontWeight: 400}}>{inv.items} позиций</div></td>
                <td className="mono">{inv.invoiceDate}</td>
                <td>
                  <div className="mono">{inv.dueDate}</div>
                  <div style={{
                    fontSize: 11, marginTop: 2, fontWeight: 600,
                    color: inv.dueDays < 0 ? 'var(--danger)' : inv.dueDays <= 7 ? 'var(--warning)' : 'var(--muted)',
                  }}>
                    {inv.dueDays < 0 ? `просрочка ${-inv.dueDays} дн` : inv.dueDays === 0 ? 'сегодня' : `через ${inv.dueDays} дн`}
                  </div>
                </td>
                <td><InvStateBadge state={inv.state} /></td>
                <td className="num strong">{fmtMoney(inv.amount)}</td>
                <td className="num">{inv.paid > 0 ? fmtMoney(inv.paid) : '—'}</td>
                <td className="num strong" style={{color: inv.left === 0 ? 'var(--success)' : inv.state === 'overdue' ? 'var(--danger)' : 'var(--ink)'}}>{inv.left === 0 ? '✓' : fmtMoney(inv.left)}</td>
                <td>
                  <div className="row-action">
                    {inv.left > 0 && <button className="btn sm primary">Оплатить</button>}
                    <IconBtn icon="more" kind="ghost" />
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

function InvStateBadge({ state }) {
  const m = {
    'paid':      { l: 'Оплачен',     t: 'success' },
    'overdue':   { l: 'Просрочен',   t: 'danger' },
    'partial':   { l: 'Частично',    t: 'warning' },
    'due-soon':  { l: 'Скоро срок',  t: 'warning' },
    'upcoming':  { l: 'В срок',      t: 'neutral' },
  }[state];
  return <span className={`badge ${m.t} sm`}><span className={`dot ${m.t}`} />{m.l}</span>;
}

/* ============================================================
   Profit screen
   ============================================================ */
function ProfitScreen() {
  const [scope, setScope] = useState('month'); // month | week | day

  const monthly = {
    revenue: 1247800,
    cogs: 612400,
    margin: 635400,
    opex: 223000,    // salaries+rent+utilities
    profit: 412400,
    target: 1400000,
    yoy: { revenue: 18, margin: 12, profit: 14 },
  };

  // Weekly buckets
  const weeks = [
    { l: '01–07 мая', rev: 268400, marg: 138500, prof: 78000 },
    { l: '08–14 мая', rev: 304200, marg: 156800, prof: 96400 },
    { l: '15–21 мая', rev: 386700, marg: 198400, prof: 128500 },
    { l: '22–23 мая', rev: 288500, marg: 141700, prof: 109500 },
  ];

  // By service
  const services = [
    { name: 'Замена масла', rev: 487300, cnt: 296, marg: 248400, mPct: 51 },
    { name: 'Замена ATF',    rev: 412800, cnt: 38,  marg: 198200, mPct: 48 },
    { name: 'Диагностика',   rev: 124800, cnt: 156, marg: 124800, mPct: 100 },
    { name: 'Антифриз / тормозная', rev: 142400, cnt: 64, marg: 51200, mPct: 36 },
    { name: 'Прочее',        rev: 80500,  cnt: 22,  marg: 12800, mPct: 16 },
  ];
  const maxRev = Math.max(...services.map(s => s.rev));

  // By master
  const masters = [
    { name: 'Сергей Игнатенко', rev: 528400, marg: 264200, cnt: 142, avg: 3721, share: 42 },
    { name: 'Артём Войтов',     rev: 387600, marg: 198300, cnt: 96,  avg: 4037, share: 31 },
    { name: 'Никита Лебедев',   rev: 331800, marg: 172900, cnt: 78,  avg: 4254, share: 27 },
  ];

  return (
    <div className="container page" style={{paddingBottom: 80}}>
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><span>Финансы</span><span className="sep">/</span><span className="cur">Прибыль</span></div>
          <h1 className="page-title">Прибыль <span className="muted" style={{fontSize: 16, fontWeight: 500}}>· Май 2026 · 23 из 31 дн</span></h1>
        </div>
        <div style={{display: 'flex', gap: 12}}>
          <div className="seg">
            <button className={`seg-btn ${scope === 'month' ? 'on' : ''}`} onClick={() => setScope('month')}>Месяц</button>
            <button className={`seg-btn ${scope === 'week' ? 'on' : ''}`} onClick={() => setScope('week')}>Неделя</button>
            <button className={`seg-btn ${scope === 'day' ? 'on' : ''}`} onClick={() => setScope('day')}>День</button>
          </div>
          <button className="btn">{Ic.download} Выгрузить</button>
        </div>
      </div>

      {/* Headline KPIs */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16}}>
        <Kpi accent="var(--ink)" label="Выручка" value={fmtMoney(monthly.revenue)} sub={`Цель ${fmtMoney(monthly.target)}`} trend={{dir: 'up', value: `+${monthly.yoy.revenue}% YoY`}} mono />
        <Kpi label="Себестоимость" value={fmtMoney(monthly.cogs)} sub={`${Math.round(monthly.cogs / monthly.revenue * 100)}% от выручки`} mono />
        <Kpi accent="var(--success)" label="Валовая маржа" value={fmtMoney(monthly.margin)} sub={`${Math.round(monthly.margin / monthly.revenue * 100)}%`} trend={{dir: 'up', value: `+${monthly.yoy.margin}%`}} mono />
        <Kpi label="Операционные расходы" value={fmtMoney(monthly.opex)} sub="ЗП · аренда · услуги" mono />
        <Kpi accent="var(--rust)" label="Чистая прибыль" value={fmtMoney(monthly.profit)} sub={`${Math.round(monthly.profit / monthly.revenue * 100)}% маржа`} trend={{dir: 'up', value: `+${monthly.yoy.profit}%`}} mono />
      </div>

      {/* Goal progress + waterfall */}
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16}}>
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Прогресс к цели мая</span><span className="badge sm">Осталось 8 дней</span></div>
          <div style={{padding: 20}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8}}>
              <span className="l-money" style={{fontSize: 26, fontWeight: 700}}>{fmtMoney(monthly.revenue)}</span>
              <span style={{fontSize: 13, color: 'var(--muted)'}}>из {fmtMoney(monthly.target)}</span>
            </div>
            <div style={{height: 12, background: 'var(--surface-deep)', borderRadius: 2, position: 'relative', overflow: 'hidden'}}>
              <div style={{position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.round(monthly.revenue / monthly.target * 100)}%`, background: 'var(--rust)'}} />
              <div style={{position: 'absolute', left: '74%', top: -2, bottom: -2, width: 2, background: 'var(--ink)'}} title="темп требуемый" />
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--muted)'}}>
              <span>0 ₽</span>
              <span style={{color: 'var(--ink)', fontWeight: 600}}>89% от плана</span>
              <span>{fmtMoney(monthly.target)}</span>
            </div>
            <div className="banner success" style={{marginTop: 18}}>
              <span style={{display: 'flex'}}>{Ic.check}</span>
              <div>
                <div className="b-title">Идём быстрее плана</div>
                <div className="b-body">На 23 мая ожидалось {fmtMoney(monthly.target * 23 / 31)}, фактически {fmtMoney(monthly.revenue)}. До цели не хватает {fmtMoney(monthly.target - monthly.revenue)} — это 8 дней по ~{fmtMoney((monthly.target - monthly.revenue) / 8)} в день.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Как сложилась прибыль</span></div>
          <div style={{padding: 20}}>
            <Waterfall items={[
              { l: 'Выручка',                v: monthly.revenue,  k: 'start' },
              { l: '− Себестоимость',        v: -monthly.cogs,    k: 'down' },
              { l: 'Валовая маржа',          v: monthly.margin,   k: 'sub' },
              { l: '− Зарплаты',             v: -148000,          k: 'down' },
              { l: '− Аренда + услуги',      v: -55000,           k: 'down' },
              { l: '− Прочее',               v: -20000,           k: 'down' },
              { l: 'Чистая прибыль',         v: monthly.profit,   k: 'final' },
            ]} />
          </div>
        </div>
      </div>

      {/* Weekly bars */}
      <div className="card" style={{padding: 0, marginBottom: 16}}>
        <div className="card-head"><span className="h-h3">Динамика по неделям</span></div>
        <div style={{padding: 24}}>
          <div style={{display: 'grid', gridTemplateColumns: `repeat(${weeks.length}, 1fr)`, gap: 14, alignItems: 'flex-end', height: 220, marginBottom: 14}}>
            {weeks.map((w, i) => {
              const max = Math.max(...weeks.map(x => x.rev));
              const hRev = (w.rev / max) * 180;
              const hMarg = (w.marg / max) * 180;
              const hProf = (w.prof / max) * 180;
              return (
                <div key={i} style={{display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center'}}>
                  <div style={{display: 'flex', gap: 4, alignItems: 'flex-end', height: 200}}>
                    <div style={{width: 24, height: hRev, background: 'var(--ink)', position: 'relative'}}>
                      <div style={{position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontFamily: 'var(--f-mono)', fontWeight: 600, whiteSpace: 'nowrap'}}>{Math.round(w.rev / 1000)}</div>
                    </div>
                    <div style={{width: 24, height: hMarg, background: 'var(--success)'}} />
                    <div style={{width: 24, height: hProf, background: 'var(--rust)'}} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{display: 'grid', gridTemplateColumns: `repeat(${weeks.length}, 1fr)`, gap: 14, paddingTop: 10, borderTop: '1px solid var(--line)'}}>
            {weeks.map((w, i) => (
              <div key={i} style={{textAlign: 'center', fontSize: 12, fontWeight: 600}}>{w.l}</div>
            ))}
          </div>
          <div style={{display: 'flex', gap: 18, marginTop: 14, fontSize: 12, color: 'var(--muted)', justifyContent: 'center'}}>
            <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}><span style={{width: 12, height: 12, background: 'var(--ink)'}} />Выручка</span>
            <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}><span style={{width: 12, height: 12, background: 'var(--success)'}} />Маржа</span>
            <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}><span style={{width: 12, height: 12, background: 'var(--rust)'}} />Прибыль</span>
          </div>
        </div>
      </div>

      {/* Two side by side: services + masters */}
      <div style={{display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16}}>
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Выручка по услугам</span><span className="badge sm">{services.length}</span></div>
          <table className="tbl">
            <thead>
              <tr><th>Услуга</th><th className="num">Кол-во</th><th className="num">Выручка</th><th></th><th className="num">Маржа</th><th className="num">%</th></tr>
            </thead>
            <tbody>
              {services.map((s, i) => (
                <tr key={i}>
                  <td className="strong">{s.name}</td>
                  <td className="num">{s.cnt}</td>
                  <td className="num strong">{fmtMoney(s.rev)}</td>
                  <td style={{width: '30%', padding: '0 14px'}}>
                    <div style={{height: 8, background: 'var(--surface-deep)', borderRadius: 2, position: 'relative', overflow: 'hidden'}}>
                      <div style={{position: 'absolute', left: 0, top: 0, height: '100%', width: `${(s.rev / maxRev) * 100}%`, background: 'var(--ink)'}} />
                    </div>
                  </td>
                  <td className="num">{fmtMoney(s.marg)}</td>
                  <td className="num" style={{color: s.mPct >= 50 ? 'var(--success)' : s.mPct >= 35 ? 'var(--ink-2)' : 'var(--warning)', fontWeight: 700}}>{s.mPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Прибыль по мастерам</span></div>
          <div style={{padding: '8px 0'}}>
            {masters.map((m, i) => {
              const emp = EMPLOYEES.find(e => e.id === ['master1', 'master2', 'lebedev'][i]);
              return (
                <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i === masters.length - 1 ? 'none' : '1px solid var(--line)'}}>
                  <Avatar initials={emp?.initials || 'НЛ'} size={32} tone="neutral" />
                  <div style={{flex: 1, minWidth: 0}}>
                    <div style={{fontSize: 13, fontWeight: 600}}>{m.name}</div>
                    <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>
                      {m.cnt} отгрузок · средний чек <span className="l-mono">{fmtMoney(m.avg)}</span>
                    </div>
                    <div style={{height: 6, background: 'var(--surface-deep)', marginTop: 6, position: 'relative', overflow: 'hidden', borderRadius: 2}}>
                      <div style={{position: 'absolute', left: 0, top: 0, height: '100%', width: `${m.share * 1.8}%`, background: 'var(--rust)'}} />
                    </div>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div className="l-money" style={{fontSize: 15, fontWeight: 700}}>{fmtMoney(m.rev)}</div>
                    <div className="l-mono" style={{fontSize: 11, color: 'var(--success)', fontWeight: 600, marginTop: 2}}>маржа {fmtMoneyPlain(m.marg)} ₽</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Waterfall({ items }) {
  const max = Math.max(...items.map(i => Math.abs(i.v)));
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      {items.map((it, i) => {
        const w = Math.abs(it.v) / max * 100;
        const color = it.k === 'down' ? 'var(--danger)'
                    : it.k === 'sub'  ? 'var(--success)'
                    : it.k === 'final' ? 'var(--rust)'
                    : 'var(--ink)';
        const bold = it.k === 'final' || it.k === 'sub' || it.k === 'start';
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div style={{width: 180, fontSize: 12.5, fontWeight: bold ? 700 : 500, color: bold ? 'var(--ink)' : 'var(--ink-2)'}}>{it.l}</div>
            <div style={{flex: 1, position: 'relative', height: 22, background: 'var(--surface-deep)', borderRadius: 2, overflow: 'hidden'}}>
              <div style={{position: 'absolute', left: 0, top: 0, height: '100%', width: `${w}%`, background: color}} />
            </div>
            <div className="l-money" style={{width: 110, textAlign: 'right', fontSize: 13, fontWeight: bold ? 700 : 500, color: it.v < 0 ? 'var(--danger)' : color}}>
              {it.v < 0 ? '−' : ''}{fmtMoney(Math.abs(it.v))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { SupplierInvoicesScreen, ProfitScreen });
