// ====================================================================
//  screens/diag-print.jsx — Печатный отчёт диагностики (A4, клиентский)
// ====================================================================
//  «ВАУ» версия для клиента: брендовый герой, вердикт, точки внимания,
//  фотоотчёт с затемнением и подписями, полный чек-лист, подписи.
//  Кнопка «Печать / PDF». Печатается на белом, герой — тёмный.
// ====================================================================

function DiagnosticsPrintCard() {
  const r = useRoute() || {};
  const num = (r.params && r.params.id) || DIAG_STATE.shipment;
  const c = CLIENTS.find(x => x.id === DIAG_STATE.client) || CLIENTS[3];
  const master = USERS[DIAG_STATE.master];

  const allItems = DIAG_BLOCKS.flatMap(b => b.items);
  const sc = Object.keys(DIAG_STATUS).reduce((a, k) => {
    a[k] = allItems.filter(it => (DIAG_STATE.items[it.id]?.status || 'unchecked') === k).length; return a;
  }, {});
  const indirect = sc['no-access'] + sc['by-mileage'] + sc['by-client'];

  const order = { crit: 0, warn: 1, 'no-access': 2, 'by-mileage': 2, 'by-client': 2 };
  const recs = allItems.map(it => ({ it, st: DIAG_STATE.items[it.id] }))
    .filter(x => x.st && x.st.rec)
    .sort((a, b) => (order[a.st.status] ?? 3) - (order[b.st.status] ?? 3));

  const photos = allItems.map(it => ({ it, st: DIAG_STATE.items[it.id] }))
    .filter(x => x.st && x.st.photos && x.st.photos.length)
    .flatMap((x, bi) => x.st.photos.map(p => ({ cap: p.cap, label: x.it.label, status: x.st.status })));

  const verdict = sc.crit > 0 ? 'требует внимания' : 'в порядке*';

  return (
    <div className="diag-print-screen">
      <div className="diag-print-toolbar no-print">
        <Link to={`/diagnostics/${num}`} className="btn">{Ic.chevL} К карте</Link>
        <Link to={`/shipments/${num}`} className="btn ghost">Отгрузка {num}</Link>
        <div style={{flex: 1}} />
        <span style={{fontSize: 12, color: 'rgba(255,255,255,0.7)'}}>Клиентский отчёт · A4 · {photos.length} фото</span>
        <button className="btn primary" onClick={() => window.print()}>{Ic.print} Печать / PDF</button>
      </div>

      <div className="paper-a4 rep">
        {/* ===== HERO ===== */}
        <div className="rep-hero">
          <div className="rep-hero-top">
            <span className="rep-wordmark">ТАМ ГДЕ МАСЛО.</span>
            <span className="rep-hero-meta">ОТЧЁТ ДИАГНОСТИКИ · {num}</span>
          </div>
          <div className="rep-hero-body">
            <div>
              <div className="rep-eyebrow rust">Привет, {c.name.split(' ')[0]}</div>
              <h1 className="rep-title">{c.car.split(' (')[0]}<span className="rust">.</span><br /><span className="muted2">{allItems.length} пунктов проверены<span className="rust">.</span></span></h1>
              <div className="rep-facts">
                <div className="rep-fact"><div className="k">Пробег</div><div className="v">{DIAG_STATE.mileage.toLocaleString('ru-RU')}</div><div className="u">км</div></div>
                <div className="rep-fact"><div className="k">Гос. номер</div><div className="v">{c.plate.split(' ').slice(0, 2).join(' ')}</div><div className="u">{c.plate.split(' ').slice(2).join(' ')}</div></div>
                <div className="rep-fact"><div className="k">Дата</div><div className="v">23.05</div><div className="u">2026 · {DIAG_STATE.finishedAt.split('· ')[1]}</div></div>
                <div className="rep-fact"><div className="k">Мастер</div><div className="v sm">{master.name.split(' ')[1]}</div><div className="u">{master.name.split(' ')[0]}</div></div>
              </div>
            </div>
            <div className="rep-hero-car">
              <svg viewBox="0 0 440 280" preserveAspectRatio="xMidYMid slice" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
                <rect x="0" y="232" width="440" height="48" fill="#000" />
                <line x1="0" y1="232" x2="440" y2="232" stroke="#C2410C" strokeWidth="1" />
                <path d="M 50 205 L 90 170 L 160 155 L 240 150 L 300 155 L 350 175 L 385 205 L 390 210 L 385 220 L 370 220 L 360 232 Q 340 240 320 230 L 312 220 L 132 220 L 120 232 Q 100 240 80 230 L 70 220 L 60 220 Z" fill="#3D3D3D" />
                <path d="M 150 162 L 200 156 L 270 156 L 305 168 L 290 195 L 165 195 Z" fill="#0a0a0a" />
                <circle cx="100" cy="222" r="22" fill="#0a0a0a" stroke="#3a3a3a" strokeWidth="1.5" />
                <circle cx="100" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" />
                <circle cx="340" cy="222" r="22" fill="#0a0a0a" stroke="#3a3a3a" strokeWidth="1.5" />
                <circle cx="340" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" />
                <circle cx="220" cy="195" r="14" fill="#C2410C" />
                <text x="220" y="201" textAnchor="middle" fontFamily="Oswald" fontSize="18" fontWeight="700" fill="#0a0a0a">76</text>
              </svg>
              <div className="rep-car-tag">{c.name.split(' ')[1] || c.name} · VIN {c.vin.slice(-6)}</div>
            </div>
          </div>
          <div className="rep-chequered" />
        </div>

        {/* ===== VERDICT ===== */}
        <div className="rep-verdict">
          <div className="rep-v-cell good"><div className="n">{sc.good}</div><div className="l">Хорошо</div></div>
          <div className="rep-v-cell warn"><div className="n">{sc.warn}</div><div className="l">Внимание</div></div>
          <div className="rep-v-cell crit"><div className="n">{sc.crit}</div><div className="l">Критично</div></div>
          <div className="rep-v-cell ind"><div className="n">{indirect}</div><div className="l">Косвенно</div></div>
          <div className="rep-v-statement">
            <div className="rep-eyebrow">Итог</div>
            <div className="s">Машина {verdict}</div>
          </div>
        </div>

        {/* ===== RECOMMENDATIONS ===== */}
        {recs.length > 0 && (
          <div className="rep-sec">
            <div className="rep-sec-head">
              <span className="rep-sec-num">01</span>
              <div><div className="rep-eyebrow rust">Что предлагаем</div><h2 className="rep-h2">Точки внимания · {recs.length}</h2></div>
            </div>
            <div className="rep-recs">
              {recs.map(({ it, st }) => {
                const ds = DIAG_STATUS[st.status] || DIAG_STATUS.warn;
                return (
                  <div className="rep-rec" key={it.id} style={{borderLeftColor: ds.color}}>
                    <div className="rep-rec-head">
                      <h3>{it.label}</h3>
                      <span className="rep-rec-tag" style={{background: ds.color}}>{ds.label}</span>
                    </div>
                    <div className="rep-rec-desc">{st.rec}</div>
                    {st.note && <div className="rep-rec-quote">«{st.note}»<br /><span>— {master.name.split(' ')[0]}, мастер-диагност</span></div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== PHOTO REPORT ===== */}
        {photos.length > 0 && (
          <div className="rep-sec">
            <div className="rep-sec-head">
              <span className="rep-sec-num">02</span>
              <div><div className="rep-eyebrow rust">Как это выглядит</div><h2 className="rep-h2">Фотоотчёт · {photos.length}</h2></div>
            </div>
            <div className="rep-photos">
              {photos.map((p, i) => {
                const ds = DIAG_STATUS[p.status] || DIAG_STATUS.good;
                const grad = ['linear-gradient(135deg,#4a4a4a,#161616)', 'linear-gradient(120deg,#5a4a42,#161210)', 'linear-gradient(150deg,#404a52,#10141a)', 'linear-gradient(135deg,#52504a,#16140f)'][i % 4];
                return (
                  <figure className="rep-photo" key={i}>
                    <div className="rep-photo-img" style={{backgroundImage: grad}}>
                      <div className="rep-photo-scrim" />
                      <span className="rep-photo-dot" style={{background: ds.color}} />
                      <span className="rep-photo-no">IMG_{(i + 1).toString().padStart(3, '0')}</span>
                      <figcaption className="rep-photo-cap">
                        <span className="lbl">{p.label}</span>
                        <span className="cap">{p.cap}</span>
                      </figcaption>
                    </div>
                  </figure>
                );
              })}
            </div>
            <div className="rep-photo-note">Снимки сделаны мастером в процессе осмотра {DIAG_STATE.finishedAt}.</div>
          </div>
        )}

        {/* ===== FULL CHECKLIST ===== */}
        <div className="rep-sec">
          <div className="rep-sec-head">
            <span className="rep-sec-num">03</span>
            <div><div className="rep-eyebrow rust">Полный список</div><h2 className="rep-h2">Что мы посмотрели</h2></div>
          </div>
          <div className="rep-legend">
            {['good', 'warn', 'crit', 'no-access', 'by-mileage', 'by-client'].map(k => (
              <span className="rep-key" key={k}><span className="rep-mark" style={{background: DIAG_STATUS[k].color}}>{DIAG_STATUS[k].icon}</span>{DIAG_STATUS[k].label}</span>
            ))}
          </div>
          <div className="rep-check">
            {DIAG_BLOCKS.map((b, bi) => (
              <div className="rep-block" key={b.id}>
                <div className="rep-block-head"><span className="rep-block-no">{(bi + 1).toString().padStart(2, '0')}</span>{b.title}</div>
                {b.items.map(it => {
                  const st = DIAG_STATE.items[it.id] || { status: 'unchecked' };
                  const ds = DIAG_STATUS[st.status] || DIAG_STATUS.unchecked;
                  return (
                    <div className="rep-check-row" key={it.id}>
                      <span className="rep-mark sm" style={{background: ds.color}}>{ds.icon}</span>
                      <span className="rep-check-label">{it.label}</span>
                      <span className="rep-check-val">{st.value || '—'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="rep-foot">
          <div className="rep-foot-cta">
            <div>
              <div className="rep-eyebrow rust">Что дальше</div>
              <div className="rep-foot-q">Запишем на работы по точкам внимания?</div>
              <div className="rep-foot-sub">Подберём материалы заранее, согласуем время. Пишите в Telegram или звоните.</div>
            </div>
            <div className="rep-foot-contact">
              <div className="ph">+7 (4012) 77-22-11</div>
              <div className="tg">Telegram · @tamgdemaslo</div>
              <div className="link">Онлайн-версия: tgm.report/4Vh2P</div>
            </div>
          </div>
          <div className="rep-sign">
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Мастер · {master.name}</div></div>
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Клиент · подпись</div></div>
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Дата ознакомления</div></div>
          </div>
          <div className="rep-disclaimer">
            * «В порядке» означает: критичных проблем для дальнейшей эксплуатации не выявлено. Пункты «внимание», «по пробегу» и «со слов клиента» — рекомендации, а не предписания.
            «Доступ затруднён» — пункт не осматривался напрямую и будет проверен на следующем визите. Карта отражает состояние авто на момент осмотра ({DIAG_STATE.finishedAt}).
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DiagnosticsPrintCard });
