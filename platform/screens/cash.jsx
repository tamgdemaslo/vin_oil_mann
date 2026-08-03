// ====================================================================
//  screens/cash.jsx — Cash register: opening / active / closing
// ====================================================================

function CashScreen() {
  const [view, setView] = useState('active'); // 'opening' | 'active' | 'closing'

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="page-crumbs">
            <Link to="/home">Главная</Link><span className="sep">/</span>
            <span>Финансы</span><span className="sep">/</span>
            <span className="cur">Касса</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <h1 className="page-title">Касса</h1>
            {view === 'active' && <span className="badge success"><span className="dot success pulse" />Кассовая смена активна</span>}
            {view === 'opening' && <span className="badge"><span className="dot idle" />Касса закрыта</span>}
            {view === 'closing' && <span className="badge warning"><span className="dot warning" />Сверка перед закрытием</span>}
          </div>
        </div>
        <div className="seg">
          {[
            {k: 'opening', l: 'Открытие'},
            {k: 'active', l: 'Активная смена'},
            {k: 'closing', l: 'Закрытие'},
          ].map(o => (
            <button key={o.k} className={`seg-btn ${view === o.k ? 'on' : ''}`} onClick={() => setView(o.k)}>{o.l}</button>
          ))}
        </div>
      </div>

      {view === 'opening' && <CashOpening />}
      {view === 'active' && <CashActive />}
      {view === 'closing' && <CashClosing />}
    </div>
  );
}

function CashOpening() {
  const [balance, setBalance] = useState('5000');
  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24}}>
      <div className="card" style={{padding: 0}}>
        <div className="card-head"><span className="h-h3">Открыть кассовую смену</span></div>
        <div style={{padding: 24, display: 'flex', flexDirection: 'column', gap: 18}}>
          <div className="field">
            <label className="field-label">Стартовый остаток наличных в кассе</label>
            <div className="inp-wrap">
              <input
                className="inp xl mono"
                value={balance}
                onChange={e => setBalance(e.target.value.replace(/\D/g, ''))}
                style={{fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em'}}
              />
              <span className="trail" style={{fontSize: 18, color: 'var(--muted)'}}>₽</span>
            </div>
            <div className="field-help">Пересчитай купюры и монеты в ящике до начала смены</div>
          </div>

          <div className="field">
            <label className="field-label">Комментарий (по желанию)</label>
            <input className="inp" placeholder="Например: сейф пополнен утром" />
          </div>

          <div className="banner info">
            <span style={{display: 'flex'}}>{Ic.info}</span>
            <div>
              <div className="b-title">Что произойдёт при открытии</div>
              <div className="b-body">
                Кассовая смена начнётся в 14:48. Доступны: приём оплат, возвраты, изъятия,
                расходные ордера. Перед закрытием — обязательная сверка по AQSI.
              </div>
            </div>
          </div>

          <button className="btn primary xl">{Ic.play} Открыть смену</button>
        </div>
      </div>

      <div className="card" style={{padding: 0}}>
        <div className="card-head"><span className="h-h3">Последняя закрытая смена · вчера</span></div>
        <div style={{padding: 24, display: 'flex', flexDirection: 'column', gap: 16}}>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14}}>
            <Kpi label="Поступления" value="218 400 ₽" mono />
            <Kpi label="Расход / изъятия" value="38 200 ₽" mono />
            <Kpi label="По AQSI" value="218 400 ₽" sub="сверка ✓" mono />
            <Kpi label="Расхождение" value="0 ₽" sub="всё чисто" mono />
          </div>
          <div className="divider" />
          <table style={{width: '100%', fontSize: 12}}>
            <tbody>
              {[
                ['Открыто', '22.05.2026 · 09:00', 'Анной Л.'],
                ['Закрыто', '22.05.2026 · 20:14', 'Анной Л.'],
                ['Стартовый остаток', '5 000 ₽', '— факт совпал —'],
                ['Финальный остаток', '64 300 ₽', 'передан в сейф'],
                ['Операций по кассе', '24', '7 расходных ордеров'],
              ].map(([k, v, s], i) => (
                <tr key={i} style={{borderBottom: i === 4 ? 'none' : '1px dashed var(--line)'}}>
                  <td style={{padding: '8px 0', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>{k}</td>
                  <td style={{padding: '8px 0', fontFamily: k.includes('остаток') || k.includes('операций') ? 'var(--f-mono)' : 'var(--f-sans)', fontWeight: 500}}>{v}</td>
                  <td style={{padding: '8px 0', color: 'var(--muted)', fontSize: 11, textAlign: 'right'}}>{s}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <a className="btn ghost" style={{justifyContent: 'space-between'}}>Открыть журнал смен <span className="arrow">→</span></a>
        </div>
      </div>
    </div>
  );
}

function CashActive() {
  const income = CASH_SHIFT.ops.filter(o => o.amount > 0).reduce((s, o) => s + o.amount, 0);
  const outflow = -CASH_SHIFT.ops.filter(o => o.amount < 0).reduce((s, o) => s + o.amount, 0);
  const expected = CASH_SHIFT.startBalance + income - outflow;

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
      {/* Top KPIs */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12}}>
        <Kpi label="Открыто" value={CASH_SHIFT.openedAt.split('·')[1].trim()} sub={`Анной Л. · ${SHIFT.duration}`} />
        <Kpi label="Стартовый остаток" value={fmtMoney(CASH_SHIFT.startBalance)} mono />
        <Kpi accent="var(--success)" label="Поступления" value={`+ ${fmtMoney(income)}`} sub={`${CASH_SHIFT.ops.filter(o => o.amount > 0).length} операций`} mono />
        <Kpi accent="var(--warning)" label="Изъятия / расход" value={`− ${fmtMoney(outflow)}`} sub={`${CASH_SHIFT.ops.filter(o => o.amount < 0).length} операций`} mono />
        <Kpi accent="var(--rust)" label="Ожидаемый остаток" value={fmtMoney(expected)} sub="наличными в ящике" mono />
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'flex-start'}}>
        {/* Operations log */}
        <div className="card" style={{padding: 0}}>
          <div className="card-head">
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <span className="h-h3">Операции смены</span>
              <span className="badge sm">{CASH_SHIFT.ops.length} · сегодня</span>
            </div>
            <div style={{display: 'flex', gap: 6}}>
              <button className="btn sm">{Ic.plus} Изъятие</button>
              <button className="btn sm">{Ic.plus} Расход</button>
              <button className="btn sm">{Ic.plus} Внесение</button>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Время</th>
                <th>Операция</th>
                <th>Метод</th>
                <th>Документ</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {CASH_SHIFT.ops.slice().reverse().map((o, i) => {
                const isExpense = o.amount < 0;
                const kindLabel = {income: 'Поступление', expense: 'Расход', withdraw: 'Изъятие'}[o.kind];
                const kindTone = {income: 'success', expense: 'warning', withdraw: 'info'}[o.kind];
                const methodLabel = {cash: 'Наличные', card: 'Карта', sbp: 'СБП'}[o.method];
                return (
                  <tr key={i}>
                    <td className="mono">{o.time}</td>
                    <td>
                      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                        <span className={`badge ${kindTone} sm`}>{kindLabel}</span>
                        <span>{o.label}</span>
                      </div>
                    </td>
                    <td><span className="badge sm outline">{methodLabel}</span></td>
                    <td className="mono muted">{o.doc || '—'}</td>
                    <td className="num strong" style={{color: isExpense ? 'var(--warning)' : 'var(--success)'}}>
                      {isExpense ? '' : '+ '}{fmtMoney(o.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* AQSI sync + actions */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="card" style={{padding: 0}}>
            <div className="card-head">
              <span className="h-h3">Сверка с AQSI</span>
              <span className="badge success sm"><span className="dot success" />14:50</span>
            </div>
            <div style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
              <Row k="По кассе · карта" v={fmtMoney(32400)} />
              <Row k="По AQSI · карта" v={fmtMoney(32400)} />
              <div className="divider-dashed" />
              <Row k="По кассе · СБП" v={fmtMoney(8000)} />
              <Row k="По AQSI · СБП" v={fmtMoney(8000)} />
              <div className="divider-dashed" />
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontSize: 13, color: 'var(--muted)'}}>Расхождение</span>
                <span className="l-money" style={{fontSize: 18, fontWeight: 700, color: 'var(--success)'}}>0 ₽</span>
              </div>
              <button className="btn sm ghost" style={{justifyContent: 'space-between'}}>Подтянуть свежие данные {Ic.refresh}</button>
            </div>
          </div>

          <div className="card" style={{padding: 0}}>
            <div className="card-head"><span className="h-h3">Действия</span></div>
            <div style={{padding: 12, display: 'flex', flexDirection: 'column', gap: 6}}>
              <button className="btn">{Ic.print} Печать журнала смены</button>
              <button className="btn">{Ic.download} Выгрузить в Excel</button>
              <button className="btn primary" style={{marginTop: 6}}>{Ic.pause} Закрыть кассовую смену</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CashClosing() {
  const [actual, setActual] = useState('55100');
  const expected = 55100;
  const diff = parseInt(actual || '0', 10) - expected;
  const isDiscrepancy = diff !== 0;

  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24}}>
      <div className="card" style={{padding: 0}}>
        <div className="card-head"><span className="h-h3">Сверка остатка</span></div>
        <div style={{padding: 24, display: 'flex', flexDirection: 'column', gap: 18}}>
          <div className="field">
            <label className="field-label">Фактическая сумма наличных в ящике</label>
            <div className="inp-wrap">
              <input
                className="inp xl mono"
                value={actual}
                onChange={e => setActual(e.target.value.replace(/\D/g, ''))}
                style={{fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em'}}
              />
              <span className="trail" style={{fontSize: 18, color: 'var(--muted)'}}>₽</span>
            </div>
            <div className="field-help">Пересчитай и впиши то, что лежит в ящике сейчас</div>
          </div>

          <div className="divider-dashed" />

          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            <Row k="Стартовый остаток" v={fmtMoney(CASH_SHIFT.startBalance)} />
            <Row k="Поступлений наличными" v={'+ ' + fmtMoney(20900)} tone="success" />
            <Row k="Расход + изъятия" v={'− ' + fmtMoney(11200)} />
            <div className="divider-dashed" />
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
              <span style={{fontSize: 13, color: 'var(--muted)'}}>Ожидаемый остаток</span>
              <span className="l-money" style={{fontSize: 22, fontWeight: 700}}>{fmtMoney(expected)}</span>
            </div>
          </div>

          {isDiscrepancy ? (
            <div className="banner danger">
              <span style={{display: 'flex'}}>{Ic.alert}</span>
              <div>
                <div className="b-title">Расхождение {diff > 0 ? '+' : ''}{fmtMoney(diff)}</div>
                <div className="b-body">Сверка кассы расходится с фактом. Перепроверь ящик или зафиксируй расхождение с комментарием.</div>
              </div>
            </div>
          ) : (
            <div className="banner success">
              <span style={{display: 'flex'}}>{Ic.check}</span>
              <div>
                <div className="b-title">Касса сходится</div>
                <div className="b-body">Факт совпал с ожидаемым остатком. Можно закрывать смену.</div>
              </div>
            </div>
          )}

          {isDiscrepancy && (
            <div className="field">
              <label className="field-label">Комментарий к расхождению (обязательно)</label>
              <textarea className="inp" rows="3" style={{height: 'auto', padding: 10, fontFamily: 'var(--f-sans)'}} placeholder="Например: ошиблись со сдачей, передали клиенту лишние 200 ₽" />
            </div>
          )}

          <button className="btn primary xl">{Ic.lock} Закрыть кассовую смену</button>
        </div>
      </div>

      {/* Closing summary */}
      <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
        <div className="card" style={{padding: 0}}>
          <div className="card-head"><span className="h-h3">Сводка по смене</span></div>
          <div style={{padding: 16}}>
            <table style={{width: '100%', fontSize: 12}}>
              <tbody>
                {[
                  ['ОТКРЫТО', CASH_SHIFT.openedAt.split('·')[1].trim() + ', 23.05.2026'],
                  ['ЗАКРЫВАЕТ', 'Анна Лебедева'],
                  ['ДЛИТЕЛЬНОСТЬ', SHIFT.duration],
                  ['ОПЕРАЦИЙ', CASH_SHIFT.ops.length],
                  ['ПОСТУПЛЕНИЯ ВСЕГО', fmtMoney(61300)],
                  ['  наличными', fmtMoney(20900)],
                  ['  картой', fmtMoney(32400)],
                  ['  СБП', fmtMoney(8000)],
                  ['РАСХОДЫ + ИЗЪЯТИЯ', fmtMoney(11200)],
                  ['  расходных ордеров', 2],
                  ['СВЕРКА AQSI', '✓ сошлась'],
                ].map(([k, v], i) => (
                  <tr key={i} style={{borderBottom: i === 10 ? 'none' : '1px dashed var(--line)'}}>
                    <td style={{padding: '8px 0', color: 'var(--muted)', fontSize: 11, letterSpacing: '0.04em', fontWeight: 600}}>{k}</td>
                    <td style={{padding: '8px 0', textAlign: 'right', fontFamily: typeof v === 'string' && v.includes('₽') ? 'var(--f-mono)' : 'var(--f-sans)', fontWeight: 500}}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-pad">
          <div className="l-eyebrow" style={{marginBottom: 10}}>После закрытия</div>
          <ul style={{margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.8}}>
            <li>Будет создана запись в журнале смен</li>
            <li>Сумма из ящика отметится как переданная в сейф</li>
            <li>Журнал смены отправится на e-mail владельца</li>
            <li>Касса будет закрыта · следующая смена откроется завтра</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CashScreen });
