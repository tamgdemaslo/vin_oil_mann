// ====================================================================
//  screens/deals.jsx — Все сделки (table view, alt to kanban)
// ====================================================================

function DealsListScreen() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');

  const enriched = DEALS.map(d => ({
    ...d,
    stageObj: DEAL_STAGES.find(s => s.id === d.stage),
    sourceObj: SOURCES[d.source],
    clientObj: CLIENTS.find(c => c.id === d.client),
    respObj: USERS[d.responsible],
  }));

  const tabs = [
    { k: 'all', l: 'Все', c: enriched.length },
    ...DEAL_STAGES.map(s => ({ k: s.id, l: s.label, c: enriched.filter(d => d.stage === s.id).length })),
  ];

  const list = enriched
    .filter(d => tab === 'all' || d.stage === tab)
    .filter(d => !q || d.clientObj.name.toLowerCase().includes(q.toLowerCase()) || d.id.toLowerCase().includes(q.toLowerCase()));

  const totalSum = list.reduce((s, d) => s + d.sum, 0);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs"><Link to="/home">Главная</Link><span className="sep">/</span><Link to="/crm">CRM</Link><span className="sep">/</span><span className="cur">Все сделки</span></div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Все сделки</h1>
            <span className="badge">{list.length} сделок</span>
            <span className="badge outline">{fmtMoney(totalSum)}</span>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <Link to="/crm" className="btn">Канбан →</Link>
          <button className="btn primary">{Ic.plus} Новая сделка</button>
        </div>
      </div>

      <div className="tabs" style={{marginBottom: 16}}>
        {tabs.map(t => (
          <button key={t.k} className={`tab ${tab === t.k ? 'active' : ''}`} onClick={() => setTab(t.k)}>
            {t.l}<span className="count">{t.c}</span>
          </button>
        ))}
      </div>

      <div style={{display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center'}}>
        <div className="inp-wrap" style={{width: 280}}>
          <span className="lead">{Ic.search}</span>
          <input className="inp" placeholder="Имя клиента, № сделки…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="pill">Период · Май 2026</button>
        <button className="pill">Ответственный</button>
        <button className="pill">Источник</button>
        <button className="pill" style={{borderStyle: 'dashed'}}>{Ic.plus} Ещё фильтр</button>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width: 36}}><span className="chk" /></th>
              <th>№ сделки</th>
              <th>Клиент / авто</th>
              <th>Услуга</th>
              <th>Стадия</th>
              <th>Источник</th>
              <th>Ответственный</th>
              <th>Создана</th>
              <th>След. контакт</th>
              <th className="num">Сумма</th>
              <th style={{width: 60}}></th>
            </tr>
          </thead>
          <tbody>
            {list.map(d => (
              <tr key={d.id}>
                <td><span className="chk" /></td>
                <td><Link to={`/crm/${d.id}`} className="mono strong" style={{color: 'var(--ink)'}}>{d.id}</Link></td>
                <td>
                  <div style={{fontWeight: 500, color: 'var(--ink)'}}>{d.clientObj.name}</div>
                  <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{d.clientObj.car.split(' (')[0]} · <span className="l-mono">{d.clientObj.plate}</span></div>
                </td>
                <td>{d.service}</td>
                <td><span className={`badge ${d.stageObj.tone} sm`}><span className={`dot ${d.stageObj.tone}`} />{d.stageObj.label}</span></td>
                <td>
                  <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12}}>
                    <span style={{width: 6, height: 6, borderRadius: '50%', background: d.sourceObj.color}} />
                    {d.sourceObj.label}
                  </span>
                </td>
                <td>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <Avatar initials={d.respObj.initials} size={22} tone="neutral" />
                    <span style={{fontSize: 12}}>{d.respObj.name.split(' ')[1]}</span>
                  </div>
                </td>
                <td className="mono muted">{d.createdAt}</td>
                <td className={d.overdue ? '' : ''}>
                  <span className={d.overdue ? 'mono' : 'mono'} style={{
                    color: d.overdue ? 'var(--danger)' : 'var(--ink-2)',
                    fontWeight: d.overdue ? 700 : 500,
                  }}>{d.nextContact}</span>
                  {d.overdue && <div style={{fontSize: 10, color: 'var(--danger)', fontWeight: 600, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em'}}>просрочен</div>}
                </td>
                <td className="num strong">{d.sum > 0 ? fmtMoney(d.sum) : '—'}</td>
                <td>
                  <div className="row-action">
                    <IconBtn icon="edit" kind="ghost" />
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

Object.assign(window, { DealsListScreen });
