// ====================================================================
//  screens/diagnostics.jsx — Диагностика по чек-листу (адаптивно)
// ====================================================================
//  Fullscreen overlay (поверх topbar). Открывается со страницы отгрузки.
//  Планшет/десктоп: список-сайдбар + панель. Телефон: одна колонка,
//  список как выезжающая «шторка», крупная нижняя навигация.
// ====================================================================

function useIsMobile(bp = 760) {
  const [m, setM] = React.useState(() => typeof window !== 'undefined' && window.matchMedia(`(max-width:${bp}px)`).matches);
  React.useEffect(() => {
    if (window.__forceMobile) { setM(true); return; }
    const mq = window.matchMedia(`(max-width:${bp}px)`);
    const h = e => setM(e.matches);
    mq.addEventListener('change', h); setM(mq.matches);
    return () => mq.removeEventListener('change', h);
  }, [bp]);
  return m;
}

function getDiagnosticStorageKey(num) {
  return `tgm.diagnostics.${num}.items`;
}

function getEmptyDiagnosticItem() {
  return { status: 'unchecked', value: '', note: '', rec: '', photos: [] };
}

function cloneDiagnosticItems() {
  return JSON.parse(JSON.stringify(DIAG_STATE.items));
}

function loadDiagnosticDraft(num) {
  const base = cloneDiagnosticItems();
  try {
    const raw = window.localStorage.getItem(getDiagnosticStorageKey(num));
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return saved && typeof saved === 'object' ? { ...base, ...saved } : base;
  } catch (e) {
    console.warn('[diagnostics] cannot read draft', e);
    return base;
  }
}

function normalizeItemsForStorage(items, keepPhotoData = true) {
  const normalized = {};
  Object.entries(items || {}).forEach(([id, item]) => {
    normalized[id] = {
      ...item,
      photos: (item.photos || []).map(ph => ({
        cap: ph.cap || '',
        name: ph.name || '',
        src: keepPhotoData && ph.src && ph.src.length < 450000 ? ph.src : undefined,
      })),
    };
  });
  return normalized;
}

function saveDiagnosticDraft(num, items) {
  try {
    window.localStorage.setItem(getDiagnosticStorageKey(num), JSON.stringify(normalizeItemsForStorage(items, true)));
  } catch (e) {
    try {
      window.localStorage.setItem(getDiagnosticStorageKey(num), JSON.stringify(normalizeItemsForStorage(items, false)));
      console.warn('[diagnostics] draft saved without embedded photo previews', e);
    } catch (err) {
      console.warn('[diagnostics] cannot save draft', err);
    }
  }
}

function fileToDiagnosticPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error('Only image files are supported'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          cap: '',
          name: file.name || 'photo.jpg',
          src: canvas.toDataURL('image/jpeg', 0.78),
        });
      };
      img.onerror = () => reject(new Error('Cannot decode image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error || new Error('Cannot read image'));
    reader.readAsDataURL(file);
  });
}

function DiagnosticTextField({ value, onCommit, multiline, delay = 260, ...props }) {
  const [draft, setDraft] = useState(value || '');
  const commitRef = useRef(onCommit);

  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { setDraft(value || ''); }, [value]);
  useEffect(() => {
    const next = draft;
    const prev = value || '';
    if (next === prev) return undefined;
    const t = window.setTimeout(() => commitRef.current(next), delay);
    return () => window.clearTimeout(t);
  }, [draft, value, delay]);

  const common = {
    ...props,
    value: draft,
    onChange: e => setDraft(e.target.value),
    onBlur: e => commitRef.current(e.target.value),
  };

  return multiline ? <textarea {...common} /> : <input {...common} />;
}

function DiagnosticsScreen() {
  const r = useRoute();
  // const num = r.params?.id || DIAG_STATE.shipment;
  const num = (r.params && r.params.id) || DIAG_STATE.shipment;
  const client = CLIENTS.find(x => x.id === DIAG_STATE.client);
  const master = USERS[DIAG_STATE.master];
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isEditingText, setIsEditingText] = useState(false);
  const hamburgerRef = useRef(null);
  const photoInputRef = useRef(null);
  const drawerTouchRef = useRef(null);

  // local state -> editable copy of DIAG_STATE.items
  const [items, setItems] = useState(() => loadDiagnosticDraft(num));
  const [activeBlock, setActiveBlock] = useState(DIAG_BLOCKS[0].id);
  const [activeItem, setActiveItem] = useState(DIAG_BLOCKS[0].items[0].id);
  const [showSummary, setShowSummary] = useState(false);

  const block = DIAG_BLOCKS.find(b => b.id === activeBlock);
  const item = block.items.find(it => it.id === activeItem);
  const itemState = items[activeItem] || { status: 'unchecked', value: '', note: '', photos: [] };

  // Counts overall
  const allItems = DIAG_BLOCKS.flatMap(b => b.items);
  const totalCount = allItems.length;
  const statusCounts = Object.keys(DIAG_STATUS).reduce((acc, st) => {
    acc[st] = allItems.filter(it => (items[it.id]?.status || 'unchecked') === st).length;
    return acc;
  }, {});
  const indirectCount = ['no-access', 'by-mileage', 'by-client'].reduce((a, k) => a + statusCounts[k], 0);
  const completion = Math.round(((totalCount - statusCounts.unchecked) / totalCount) * 100);

  useEffect(() => {
    const t = window.setTimeout(() => saveDiagnosticDraft(num, items), 350);
    return () => window.clearTimeout(t);
  }, [num, items]);

  useEffect(() => {
    if (!isMobile || !drawerOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [isMobile, drawerOpen]);

  useEffect(() => {
    if (!isMobile) {
      setIsEditingText(false);
      return undefined;
    }
    const isTextControl = el => el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT');
    const onFocus = e => { if (isTextControl(e.target)) setIsEditingText(true); };
    const onBlur = () => {
      window.setTimeout(() => setIsEditingText(isTextControl(document.activeElement)), 0);
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, [isMobile]);

  function update(id, patch) {
    setItems(s => ({ ...s, [id]: { ...(s[id] || getEmptyDiagnosticItem()), ...patch } }));
  }

  function closeDrawer(restoreFocus = true) {
    setDrawerOpen(false);
    if (restoreFocus && isMobile) {
      window.setTimeout(() => hamburgerRef.current && hamburgerRef.current.focus(), 0);
    }
  }

  function handleDrawerTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    drawerTouchRef.current = { x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
  }

  function handleDrawerTouchMove(e) {
    const start = drawerTouchRef.current;
    const t = e.touches && e.touches[0];
    if (!start || !t) return;
    start.dx = t.clientX - start.x;
    start.dy = t.clientY - start.y;
    if (start.dx < -80 && Math.abs(start.dx) > Math.abs(start.dy) * 1.15) {
      drawerTouchRef.current = null;
      closeDrawer(true);
    }
  }

  function handleDrawerTouchEnd() {
    const start = drawerTouchRef.current;
    drawerTouchRef.current = null;
    if (!start) return;
    if (start.dx < -64 && Math.abs(start.dx) > Math.abs(start.dy) * 1.15) closeDrawer(true);
  }

  function handlePhotoPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const itemId = activeItem;
    Promise.all(files.map(fileToDiagnosticPhoto))
      .then(photos => {
        setItems(s => {
          const cur = s[itemId] || getEmptyDiagnosticItem();
          return { ...s, [itemId]: { ...cur, photos: [...(cur.photos || []), ...photos] } };
        });
      })
      .catch(err => console.warn('[diagnostics] cannot attach photo', err));
  }

  // Jump to next unchecked
  const flatItems = DIAG_BLOCKS.flatMap(b => b.items.map(it => ({...it, blockId: b.id})));
  const flatIdx = flatItems.findIndex(it => it.id === activeItem);

  function gotoNext() {
    const next = flatItems[flatIdx + 1];
    if (next) {
      setActiveBlock(next.blockId);
      setActiveItem(next.id);
    } else {
      setShowSummary(true);
    }
  }
  function gotoPrev() {
    const prev = flatItems[flatIdx - 1];
    if (prev) {
      setActiveBlock(prev.blockId);
      setActiveItem(prev.id);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 100,
      display: 'flex', flexDirection: 'column',
      width: '100vw', height: '100dvh', maxWidth: '100vw', maxHeight: '100dvh',
      overflow: 'hidden',
    }}>
      {/* Top bar */}
      <header style={{
        minHeight: 64, background: 'var(--ink)', color: '#F5F2ED',
        display: 'flex', alignItems: 'center', padding: isMobile ? '10px 14px' : '0 20px', gap: isMobile ? 10 : 16,
        borderBottom: '1px solid var(--ink-2)', flexShrink: 0,
      }}>
        <Link to={`/shipments/${num}`} style={{display: 'flex', alignItems: 'center', gap: 8, color: '#F5F2ED', padding: isMobile ? '8px' : '8px 12px', border: '1px solid #3D3D3D', borderRadius: 4, fontSize: 13, flexShrink: 0}}>
          {Ic.chevL}{!isMobile && ' Закрыть'}
        </Link>
        {!isMobile && <div style={{width: 1, height: 24, background: '#3D3D3D'}} />}
        <div style={{flex: 1, minWidth: 0}}>
          {!isMobile && <div style={{fontSize: 11, color: '#9A9A9A', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600}}>Диагностика · {totalCount} пунктов · {num}</div>}
          <div style={{display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, marginTop: isMobile ? 0 : 4}}>
            <span style={{fontSize: isMobile ? 14 : 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{client.car.split(' (')[0]} <span style={{color: '#9A9A9A', fontFamily: 'var(--f-mono)', fontWeight: 500}}>{client.plate.split(' ').slice(0,2).join(' ')}</span></span>
            {!isMobile && <span style={{color: '#737373', fontSize: 13}}>· {client.name}</span>}
          </div>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 20, flexShrink: 0}}>
          <CompletionRing pct={completion} />
          {!isMobile && (
            <>
              <div style={{textAlign: 'right'}}>
                <div style={{fontSize: 11, color: '#9A9A9A', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600}}>Прогресс</div>
                <div style={{fontFamily: 'var(--f-mono)', fontSize: 14, fontWeight: 700, marginTop: 2}}>{totalCount - statusCounts.unchecked} / {totalCount}</div>
              </div>
              <a href={`#/diag-print/${num}`} className="btn lg" style={{background: '#3D3D3D', color: '#fff', borderColor: '#3D3D3D'}}>{Ic.print} Печать карты</a>
              <button className="btn primary lg" onClick={() => setShowSummary(true)}>Завершить и отправить →</button>
            </>
          )}
        </div>
      </header>

      {/* Mobile sub-bar: open structure drawer + jump to summary */}
      {isMobile && !showSummary && (
        <div style={{display: 'flex', alignItems: 'stretch', gap: 8, padding: '8px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--line)', flexShrink: 0}}>
          <button ref={hamburgerRef} aria-expanded={drawerOpen} aria-controls="diagnostics-drawer" onClick={() => setDrawerOpen(true)} style={{flex: 1, minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', textAlign: 'left'}}>
            <span style={{display: 'flex', flexDirection: 'column', gap: 3}}>
              <span style={{width: 16, height: 2, background: 'var(--ink-2)', borderRadius: 1}} />
              <span style={{width: 16, height: 2, background: 'var(--ink-2)', borderRadius: 1}} />
              <span style={{width: 16, height: 2, background: 'var(--ink-2)', borderRadius: 1}} />
            </span>
            <span style={{minWidth: 0}}>
              <span style={{display: 'block', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{block.title}</span>
              <span style={{display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)'}}>Пункт {flatIdx + 1} из {totalCount}</span>
            </span>
          </button>
          <button className="btn" onClick={() => setShowSummary(true)} style={{flexShrink: 0}}>Итог</button>
        </div>
      )}

      {/* Body */}
      <div onTouchStart={isMobile && drawerOpen ? handleDrawerTouchStart : undefined} onTouchMove={isMobile && drawerOpen ? handleDrawerTouchMove : undefined} onTouchEnd={isMobile && drawerOpen ? handleDrawerTouchEnd : undefined} style={{flex: 1, display: 'flex', minHeight: 0, position: 'relative'}}>
        {/* Drawer overlay on mobile */}
        {isMobile && drawerOpen && (
          <div onClick={() => closeDrawer(true)} onTouchStart={handleDrawerTouchStart} onTouchMove={handleDrawerTouchMove} onTouchEnd={handleDrawerTouchEnd} style={{position: 'absolute', inset: 0, background: 'rgba(10,10,10,0.5)', zIndex: 35}} />
        )}
        {/* Sidebar with blocks (off-canvas drawer on mobile) */}
        <aside id="diagnostics-drawer" aria-hidden={isMobile ? !drawerOpen : undefined} onTouchStart={isMobile ? handleDrawerTouchStart : undefined} onTouchMove={isMobile ? handleDrawerTouchMove : undefined} onTouchEnd={isMobile ? handleDrawerTouchEnd : undefined} style={isMobile ? {
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '86%', maxWidth: 340, zIndex: 40,
          background: 'var(--surface)', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-104%)',
          transition: 'transform 220ms ease', boxShadow: drawerOpen ? '0 0 40px rgba(0,0,0,0.3)' : 'none',
          touchAction: 'pan-y',
        } : {
          width: 280, flexShrink: 0,
          background: 'var(--surface)', borderRight: '1px solid var(--line)',
          overflowY: 'auto',
        }}>
          <div style={{padding: isMobile ? '14px 20px' : '20px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: isMobile ? 'sticky' : 'static', top: 0, background: 'var(--surface)', zIndex: 2, borderBottom: isMobile ? '1px solid var(--line)' : 'none'}}>
            <div className="l-eyebrow">Структура диагностики</div>
            {isMobile && <button aria-label="Закрыть список пунктов" onClick={() => closeDrawer(true)} style={{width: 44, height: 44, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: 'var(--muted)'}}>×</button>}
          </div>
          {DIAG_BLOCKS.map(b => {
            const blockItems = b.items.map(it => ({...it, st: items[it.id]?.status || 'unchecked'}));
            const blockCounts = ['good', 'warn', 'crit'].reduce((a, k) => { a[k] = blockItems.filter(i => i.st === k).length; return a; }, {});
            const blockIndirect = blockItems.filter(i => ['no-access', 'by-mileage', 'by-client'].includes(i.st)).length;
            const open = b.id === activeBlock;
            return (
              <div key={b.id}>
                <button
                  onClick={() => { setActiveBlock(b.id); setActiveItem(b.items[0].id); }}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '14px 20px', background: open ? 'var(--surface-sunk)' : 'transparent',
                    border: 'none', borderTop: '1px solid var(--line)',
                    borderLeft: open ? '3px solid var(--rust)' : '3px solid transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{flex: 1}}>
                    <div style={{fontSize: 13, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.005em'}}>{b.title}</div>
                    <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>{b.items.length} {b.items.length === 1 ? 'пункт' : b.items.length < 5 ? 'пункта' : 'пунктов'}</div>
                  </div>
                  <div style={{display: 'flex', gap: 4}}>
                    {blockCounts.crit > 0 && <span style={{minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center'}}>{blockCounts.crit}</span>}
                    {blockCounts.warn > 0 && <span style={{minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--warning)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center'}}>{blockCounts.warn}</span>}
                    {blockIndirect > 0 && <span style={{minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#6B7280', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center'}}>{blockIndirect}</span>}
                    {blockCounts.good > 0 && <span style={{minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--success)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center'}}>{blockCounts.good}</span>}
                  </div>
                </button>
                {open && (
                  <div>
                    {blockItems.map(it => {
                      const st = DIAG_STATUS[it.st];
                      const active = it.id === activeItem;
                      return (
                        <button
                          key={it.id}
                          onClick={() => { setActiveItem(it.id); if (isMobile) closeDrawer(true); }}
                          style={{
                            width: '100%', textAlign: 'left',
                            padding: '11px 20px 11px 36px',
                            background: active ? 'var(--rust-tint)' : 'transparent',
                            border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 10,
                            borderLeft: active ? '3px solid var(--rust)' : '3px solid transparent',
                            paddingLeft: 33,
                          }}
                        >
                          <span style={{
                            width: 18, height: 18, borderRadius: '50%',
                            background: st.color, color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, flexShrink: 0,
                          }}>{st.icon}</span>
                          <span style={{fontSize: 12.5, color: active ? 'var(--rust)' : 'var(--ink-2)', fontWeight: active ? 600 : 500, lineHeight: 1.3}}>{it.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Bottom summary */}
          <div style={{padding: '20px', borderTop: '1px solid var(--line)', marginTop: 8}}>
            <div className="l-eyebrow" style={{marginBottom: 12}}>Сводка</div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
              {[['good', DIAG_STATUS.good.label, 'success', statusCounts.good], ['warn', DIAG_STATUS.warn.label, 'warning', statusCounts.warn], ['crit', DIAG_STATUS.crit.label, 'danger', statusCounts.crit], ['indirect', 'Косвенно', 'info', indirectCount]].map(([st, label, tone, n]) => (
                <div key={st} style={{padding: '10px 12px', background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 4}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4}}>
                    <span className={`dot ${tone}`} />
                    <span style={{fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>{label}</span>
                  </div>
                  <div className="l-mono" style={{fontSize: 18, fontWeight: 700, color: 'var(--ink)'}}>{n}</div>
                </div>
              ))}
            </div>
          </div>
          {isMobile && (
            <div style={{padding: '4px 20px 24px', display: 'flex', flexDirection: 'column', gap: 8}}>
              <a href={`#/diag-print/${num}`} className="btn lg" style={{justifyContent: 'center'}}>{Ic.print} Печать карты</a>
              <button className="btn primary lg" onClick={() => { setShowSummary(true); setDrawerOpen(false); }} style={{justifyContent: 'center'}}>Завершить и отправить →</button>
            </div>
          )}
        </aside>

        {/* Main */}
        <main style={{flex: 1, minWidth: 0, overflowX: 'hidden', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: isMobile ? (isEditingText ? '18px 16px calc(28px + env(safe-area-inset-bottom))' : '18px 16px calc(104px + env(safe-area-inset-bottom))') : '24px 32px 40px'}}>
          {!showSummary && (
            <>
              {/* Breadcrumb / item title */}
              <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20, gap: 24}}>
                <div>
                  <div className="l-eyebrow muted" style={{marginBottom: 6}}>{block.title}</div>
                  <h2 style={{fontSize: isMobile ? 23 : 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', lineHeight: 1.1}}>{item.label}</h2>
                  {item.norm && <div style={{marginTop: 8, fontSize: 13, color: 'var(--muted)'}}>Норма: <span style={{color: 'var(--ink-2)', fontWeight: 600}}>{item.norm}</span></div>}
                </div>
                {!isMobile && (
                  <div style={{display: 'flex', gap: 6}}>
                    <button className="btn lg" onClick={gotoPrev} disabled={flatIdx === 0}>{Ic.chevL} Назад</button>
                    <button className="btn primary lg" onClick={gotoNext}>Дальше {Ic.chevR}</button>
                  </div>
                )}
              </div>

              {/* Status picker (touch-friendly) — two groups */}
              <div style={{marginBottom: 24}}>
                <div className="l-eyebrow" style={{marginBottom: 10}}>Результат осмотра</div>
                <div style={{display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(3, 1fr)', gap: 8}}>
                  {['good', 'warn', 'crit'].map(k => {
                    const s = DIAG_STATUS[k];
                    const active = itemState.status === k;
                    return (
                      <button key={k} onClick={() => update(activeItem, { status: k })}
                        style={{
                          height: 84, minWidth: 0, padding: isMobile ? '8px 4px' : undefined, background: active ? s.color : 'var(--surface)',
                          color: active ? '#fff' : 'var(--ink)',
                          border: '2px solid ' + (active ? s.color : 'var(--line)'),
                          borderRadius: 6, cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          gap: 6, fontSize: isMobile ? 12 : 13, fontWeight: 600, transition: 'all 100ms',
                        }}>
                        <span style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
                          border: active ? 'none' : `2px solid ${s.color}`,
                          color: active ? '#fff' : s.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16, fontWeight: 700,
                        }}>{s.icon}</span>
                        {s.label}
                      </button>
                    );
                  })}
                </div>

                <div className="l-eyebrow" style={{margin: '16px 0 10px'}}>Без прямого осмотра</div>
                <div style={{display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 8}}>
                  {['no-access', 'by-mileage', 'by-client'].map(k => {
                    const s = DIAG_STATUS[k];
                    const active = itemState.status === k;
                    return (
                      <button key={k} onClick={() => update(activeItem, { status: k })}
                        title={s.hint}
                        style={{
                          minHeight: 66, padding: '10px 12px',
                          background: active ? s.color : 'var(--surface)',
                          color: active ? '#fff' : 'var(--ink-2)',
                          border: '2px solid ' + (active ? s.color : 'var(--line)'),
                          borderRadius: 6, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', transition: 'all 100ms',
                        }}>
                        <span style={{
                          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                          background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
                          border: active ? 'none' : `2px solid ${s.color}`,
                          color: active ? '#fff' : s.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, fontWeight: 700,
                        }}>{s.icon}</span>
                        <span>
                          <div style={{fontSize: 13, fontWeight: 600}}>{s.label}</div>
                          <div style={{fontSize: 10.5, color: active ? 'rgba(255,255,255,0.8)' : 'var(--muted)', marginTop: 2, lineHeight: 1.25}}>{s.hint}</div>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Measurement (if item has one) */}
              {item.measure && (
                <div style={{marginBottom: 24}}>
                  <div className="l-eyebrow" style={{marginBottom: 10}}>{item.measure}{item.unit && <span style={{color: 'var(--muted)', marginLeft: 6, textTransform: 'lowercase'}}>· {item.unit}</span>}</div>
                  <DiagnosticTextField
                    className="inp xl"
                    value={itemState.value || ''}
                    onCommit={value => update(activeItem, { value })}
                    placeholder={item.unit ? `Например: 12.5 ${item.unit}` : 'Опиши результат'}
                    style={{height: 56, fontSize: 18, fontFamily: item.unit ? 'var(--f-mono)' : 'var(--f-sans)'}}
                  />
                </div>
              )}

              {/* Photos with captions */}
              <div style={{marginBottom: 24}}>
                <div className="l-eyebrow" style={{marginBottom: 10}}>Фото · {(itemState.photos || []).length} <span style={{textTransform: 'none', letterSpacing: 0, color: 'var(--faint)', fontWeight: 400}}>· подпись попадёт в отчёт клиенту</span></div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture={isMobile ? 'environment' : undefined}
                  multiple={!isMobile}
                  onChange={handlePhotoPick}
                  style={{position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none'}}
                  tabIndex="-1"
                />
                <div style={{display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12}}>
                  {(itemState.photos || []).map((ph, i) => (
                    <div key={i} style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                      <div style={{
                        aspectRatio: '4/3', background: 'var(--surface-deep)',
                        border: '1px solid var(--line)', borderRadius: 4,
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {ph.src
                          ? <img src={ph.src} alt={ph.cap || `Фото ${i + 1}`} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
                          : <div style={{position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${['#3D3D3D', '#525252', '#737373'][i % 3]} 0%, #1a1a1a 100%)`}} />}
                        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)'}} />
                        <div style={{position: 'absolute', top: 6, left: 8, fontFamily: 'var(--f-mono)', fontSize: 10, color: '#F5F2ED', letterSpacing: '0.1em', opacity: 0.85}}>IMG_{(i+1).toString().padStart(3,'0')}</div>
                        <div style={{position: 'absolute', bottom: 6, left: 8, right: 8, color: '#F5F2ED', fontSize: 11, fontWeight: 600, lineHeight: 1.25, textShadow: '0 1px 3px rgba(0,0,0,0.6)'}}>{ph.cap || 'Без подписи'}</div>
                        <button aria-label="Удалить фото" style={{
                          position: 'absolute', top: 6, right: 6,
                          width: isMobile ? 44 : 28, height: isMobile ? 44 : 28, background: 'rgba(0,0,0,0.66)', color: '#fff',
                          border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: isMobile ? 22 : 16,
                        }} onClick={(e) => { e.preventDefault(); update(activeItem, { photos: (itemState.photos || []).filter((_, j) => j !== i) }); }}>×</button>
                      </div>
                      <DiagnosticTextField
                        className="inp"
                        value={ph.cap || ''}
                        onCommit={cap => update(activeItem, { photos: (itemState.photos || []).map((p, j) => j === i ? { ...p, cap } : p) })}
                        placeholder="Подпись к фото"
                        style={{height: isMobile ? 44 : 34, fontSize: 12}}
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => photoInputRef.current && photoInputRef.current.click()}
                    style={{
                      aspectRatio: '4/3', background: 'var(--surface-sunk)',
                      border: '2px dashed var(--line-strong)', borderRadius: 4,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, cursor: 'pointer', color: 'var(--muted)', fontSize: 12, alignSelf: 'start',
                    }}
                  >
                    <span style={{fontSize: 22}}>+</span>
                    {isMobile ? 'Камера' : 'Добавить фото'}
                  </button>
                </div>
              </div>

              {/* Comment with presets */}
              <div style={{marginBottom: 24}}>
                <div className="l-eyebrow" style={{marginBottom: 10}}>Комментарий мастера</div>
                {item.notes && item.notes.length > 0 && (
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10}}>
                    {item.notes.map((n, i) => (
                      <button key={i} onClick={() => update(activeItem, { note: itemState.note ? itemState.note + ' ' + n : n })}
                        className="preset-chip">{n}</button>
                    ))}
                  </div>
                )}
                <DiagnosticTextField
                  className="inp"
                  rows="3"
                  multiline
                  value={itemState.note || ''}
                  onCommit={note => update(activeItem, { note })}
                  placeholder="Что увидели · что насторожило · какие шумы / запахи"
                  style={{height: 'auto', padding: 14, fontSize: 14, lineHeight: 1.5, fontFamily: 'var(--f-sans)'}}
                />
              </div>

              {/* Recommendation — for anything that isn't a clean «Хорошо» */}
              {itemState.status !== 'good' && itemState.status !== 'unchecked' && (
                <div style={{
                  padding: 18, background: itemState.status === 'crit' ? 'var(--danger-tint)' : itemState.status === 'warn' ? 'var(--warning-tint)' : 'var(--info-tint)',
                  border: `1px solid ${itemState.status === 'crit' ? 'var(--danger-tint-strong)' : itemState.status === 'warn' ? 'var(--warning-tint-strong)' : 'var(--info-tint-strong)'}`,
                  borderRadius: 4, marginBottom: 24,
                }}>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, fontWeight: 700, color: itemState.status === 'crit' ? 'var(--danger)' : itemState.status === 'warn' ? 'var(--warning)' : 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>
                    <span style={{display: 'flex'}}>{Ic.alert}</span>
                    Рекомендация клиенту
                  </div>
                  {item.recs && item.recs.length > 0 && (
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10}}>
                      {item.recs.concat(REC_PRESETS_COMMON).map((rc, i) => (
                        <button key={i} onClick={() => update(activeItem, { rec: rc })} className="preset-chip light">{rc}</button>
                      ))}
                    </div>
                  )}
                  <DiagnosticTextField
                    className="inp"
                    rows="2"
                    multiline
                    value={itemState.rec || ''}
                    onCommit={rec => update(activeItem, { rec })}
                    placeholder="Что предлагаем сделать. С ценой и сроком."
                    style={{height: 'auto', padding: 14, fontSize: 14, lineHeight: 1.5, fontFamily: 'var(--f-sans)', background: '#fff'}}
                  />
                  <div style={{marginTop: 10, fontSize: 11, color: 'var(--muted)'}}>Эта рекомендация попадёт в публичный отчёт клиенту.</div>
                </div>
              )}
            </>
          )}

          {showSummary && (
            <DiagnosticsSummary
              items={items}
              client={client}
              statusCounts={statusCounts}
              onBack={() => setShowSummary(false)}
              num={num}
              isMobile={isMobile}
            />
          )}
        </main>
      </div>

      {/* Mobile sticky bottom nav */}
      {isMobile && !showSummary && !isEditingText && (
        <div style={{display: 'flex', alignItems: 'stretch', gap: 8, padding: '10px 14px calc(10px + env(safe-area-inset-bottom))', background: 'var(--surface)', borderTop: '1px solid var(--line)', flexShrink: 0, boxShadow: '0 -4px 16px rgba(0,0,0,0.06)'}}>
          <button className="btn lg" onClick={gotoPrev} disabled={flatIdx === 0} style={{flex: 1, justifyContent: 'center', height: 52}}>{Ic.chevL} Назад</button>
          <button className="btn primary lg" onClick={gotoNext} style={{flex: 2, justifyContent: 'center', height: 52}}>{flatIdx === totalCount - 1 ? 'К итогу' : 'Дальше'} {Ic.chevR}</button>
        </div>
      )}
    </div>
  );
}

function CompletionRing({ pct }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <div style={{position: 'relative', width: 48, height: 48}}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#3D3D3D" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke="#C2410C" strokeWidth="4"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          transform="rotate(-90 24 24)" />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, fontFamily: 'var(--f-mono)', color: '#F5F2ED',
      }}>{pct}%</div>
    </div>
  );
}

function DiagnosticsSummary({ items, client, statusCounts, onBack, num, isMobile }) {
  const recommendations = DIAG_BLOCKS.flatMap(b => b.items)
    .map(it => ({...it, st: items[it.id]}))
    .filter(it => it.st && it.st.rec);
  const indirectCount = ['no-access', 'by-mileage', 'by-client'].reduce((a, k) => a + (statusCounts[k] || 0), 0);

  return (
    <div style={{maxWidth: 880, margin: '0 auto'}}>
      <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexDirection: isMobile ? 'column' : 'row'}}>
        <div>
          <div className="l-eyebrow accent" style={{marginBottom: 8}}>Финальная сводка</div>
          <h1 style={{fontSize: isMobile ? 24 : 32, fontWeight: 700, margin: 0, letterSpacing: '-0.02em'}}>Диагностика готова к отправке</h1>
          <div style={{marginTop: 10, fontSize: 14, color: 'var(--muted)'}}>{Object.keys(items).length ? DIAG_BLOCKS.flatMap(b => b.items).length : 0} пунктов проверены · {recommendations.length} рекомендаций сформированы</div>
        </div>
        <button className="btn lg" onClick={onBack}>{Ic.chevL} Вернуться к проверкам</button>
      </div>

      {/* Counts */}
      <div style={{display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10, marginBottom: 24}}>
        {[['good', DIAG_STATUS.good.label, DIAG_STATUS.good.color, statusCounts.good],
          ['warn', DIAG_STATUS.warn.label, DIAG_STATUS.warn.color, statusCounts.warn],
          ['crit', DIAG_STATUS.crit.label, DIAG_STATUS.crit.color, statusCounts.crit],
          ['indirect', 'Косвенно', '#1D4ED8', indirectCount],
          ['unchecked', 'Не проверено', '#A3A3A3', statusCounts.unchecked]].map(([k, label, color, n]) => (
          <div key={k} style={{padding: '16px 16px', background: 'var(--surface)', border: '1px solid var(--line)', borderTop: `3px solid ${color}`}}>
            <div style={{fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>{label}</div>
            <div className="l-mono" style={{fontSize: 30, fontWeight: 700, marginTop: 8, color: color}}>{n}</div>
          </div>
        ))}
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div style={{marginBottom: 24}}>
          <div className="l-eyebrow" style={{marginBottom: 12}}>Рекомендации клиенту · {recommendations.length}</div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {recommendations.map(r => {
              const st = DIAG_STATUS[r.st.status] || DIAG_STATUS.warn;
              const isCrit = r.st.status === 'crit';
              return (
              <div key={r.id} style={{
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderLeft: `4px solid ${st.color}`,
                padding: '14px 16px',
              }}>
                <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16}}>
                  <div>
                    <div style={{fontSize: 14, fontWeight: 600, marginBottom: 6}}>{r.label}</div>
                    <div style={{fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5}}>{r.st.rec}</div>
                    {r.st.note && <div style={{fontSize: 12, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic'}}>«{r.st.note}»</div>}
                  </div>
                  <span style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    background: isCrit ? 'var(--danger-tint)' : st.group === 'indirect' ? 'var(--info-tint)' : 'var(--warning-tint)',
                    color: st.color,
                    border: `1px solid ${isCrit ? 'var(--danger-tint-strong)' : st.group === 'indirect' ? 'var(--info-tint-strong)' : 'var(--warning-tint-strong)'}`,
                    borderRadius: 2, flexShrink: 0, whiteSpace: 'nowrap',
                  }}>{st.label}</span>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* What happens next */}
      <div className="banner info" style={{marginBottom: 24}}>
        <span style={{display: 'flex'}}>{Ic.info}</span>
        <div>
          <div className="b-title">Что произойдёт при отправке</div>
          <div className="b-body">
            Клиент получит публичный отчёт по ссылке: <a href="../report.html" style={{color: 'var(--rust)', fontFamily: 'var(--f-mono)', fontWeight: 600}}>tgm.report/4Vh2P</a>.
            Отчёт оформлен в фирменной стилистике, без внутренних цен закупки.
            Также придёт SMS и сообщение в Telegram-бот.
          </div>
        </div>
      </div>

      <div style={{display: 'flex', gap: 8, justifyContent: isMobile ? 'stretch' : 'flex-end', flexDirection: isMobile ? 'column' : 'row'}}>
        <a href={`#/diag-print/${num}`} className="btn lg" style={isMobile ? {justifyContent: 'center'} : undefined}>{Ic.print} Печать карты</a>
        <a href="../report.html" className="btn lg" style={isMobile ? {justifyContent: 'center'} : undefined}>Посмотреть превью отчёта</a>
        <button className="btn primary lg" style={isMobile ? {justifyContent: 'center'} : undefined}>Отправить клиенту →</button>
      </div>
    </div>
  );
}

Object.assign(window, { DiagnosticsScreen });
