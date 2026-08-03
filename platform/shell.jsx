// ====================================================================
//  platform/shell.jsx — TopBar + sub-strip (shift, integrations)
// ====================================================================

function TopBar() {
  const r = useRoute();
  const path = r.path;
  const user = USERS.owner; // demo: viewing as owner
  const seg = path.split('/').filter(Boolean)[0] || 'home';
  const isAuth = path === '/login' || path === '/locked';

  if (isAuth) return null;

  return (
    <header className="topbar">
      {/* Main bar */}
      <div className="topbar-main">
        <Link to="/home"><BrandMark /></Link>

        <nav style={{display: 'flex', gap: 2, marginLeft: 12, alignItems: 'center'}}>
          <Link to="/home" className={`nav-link ${seg === 'home' ? 'active' : ''}`}>Главная</Link>

          <NavDropdown label="Операции" active={['shipments', 'diagnostics'].includes(seg)}>
            <div className="dropdown-section">Отгрузки</div>
            <Link to="/shipments" className="dropdown-item">Все отгрузки <span className="meta">438</span></Link>
            <Link to="/shipments/new" className="dropdown-item">Новая отгрузка</Link>
            <div className="dropdown-sep" />
            <div className="dropdown-section">Диагностика</div>
            <Link to="/diagnostics/TGM-2026-0436" className="dropdown-item">Открыть диагностику (демо)</Link>
            <a href="../report.html" className="dropdown-item">Превью отчёта клиенту →</a>
            <div className="dropdown-sep" />
            <div className="dropdown-section">Печать</div>
            <a className="dropdown-item">Заказ-наряды</a>
            <a className="dropdown-item">Наклейки под капот</a>
          </NavDropdown>

          <NavDropdown label="Склад" active={['products', 'receiving', 'writeoff', 'restock'].includes(seg)}>
            <Link to="/products" className="dropdown-item">Товары <span className="meta">847</span></Link>
            <Link to="/receiving" className="dropdown-item">Приёмка</Link>
            <Link to="/writeoff" className="dropdown-item">Списание</Link>
            <Link to="/restock" className="dropdown-item">Пополнение остатков <span className="meta">12</span></Link>
            <div className="dropdown-sep" />
            <a className="dropdown-item">Контрагенты склада</a>
            <a className="dropdown-item">Прибыль по складу</a>
          </NavDropdown>

          <NavDropdown label="Финансы" active={['cash', 'payroll', 'invoices', 'profit'].includes(seg)}>
            <Link to="/cash" className="dropdown-item">Касса</Link>
            <Link to="/invoices" className="dropdown-item">Счета поставщиков <span className="meta">7</span></Link>
            <Link to="/profit" className="dropdown-item">Прибыль</Link>
            <Link to="/payroll" className="dropdown-item">Зарплата <span className="meta">284 600 ₽</span></Link>
          </NavDropdown>

          <NavDropdown label="CRM" active={['crm', 'journal', 'deals'].includes(seg)}>
            <Link to="/crm" className="dropdown-item">Воронка <span className="meta">{DEALS.filter(d => d.stage !== 'won' && d.stage !== 'lost').length}</span></Link>
            <Link to="/deals" className="dropdown-item">Все сделки <span className="meta">{DEALS.length}</span></Link>
            <Link to="/journal" className="dropdown-item">Журнал записей <span className="meta">{APPOINTMENTS.length}</span></Link>
            <div className="dropdown-sep" />
            <a className="dropdown-item">Контрагенты / клиенты</a>
          </NavDropdown>

          <NavDropdown label="Кабинет" active={seg === 'cabinet'}>
            <a className="dropdown-item">Профиль</a>
            <a className="dropdown-item">Смены и рабочие дни</a>
            <a className="dropdown-item">Начисления</a>
            <a className="dropdown-item">Бонусы и штрафы</a>
            <div className="dropdown-sep" />
            <a className="dropdown-item">Аналитика клиентов</a>
            <a className="dropdown-item">Сменить пароль</a>
          </NavDropdown>
        </nav>

        <div style={{flex: 1}} />

        {/* Global search */}
        <div className="inp-wrap" style={{width: 320}}>
          <span className="lead">{Ic.search}</span>
          <input className="inp" placeholder="Товар, VIN, № отгрузки, клиент…" />
          <span className="trail"><span style={{fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--faint)', padding: '2px 5px', border: '1px solid var(--line)', borderRadius: 2}}>⌘K</span></span>
        </div>

        <IconBtn icon="bell" kind="ghost" />

        {/* Profile */}
        <ProfileBlock user={user} />
      </div>

      {/* Sub strip */}
      <div className="topbar-substrip">
        <ShiftIndicator />
        <span style={{width: 1, height: 16, background: 'var(--line)'}} />
        <div style={{display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)'}}>
          <span className="l-meta">Текущая отгрузка:</span>
          <Link to="/shipments/TGM-2026-0438" style={{color: 'var(--ink-2)', fontFamily: 'var(--f-mono)', fontWeight: 600, fontSize: 11, letterSpacing: '0.02em'}}>TGM-2026-0438</Link>
          <span style={{color: 'var(--muted)'}}>· А. Соловьёв · BMW X5</span>
        </div>
        <div style={{flex: 1}} />
        <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
          {INTEGRATIONS.map(i => (
            <div key={i.id} style={{display: 'flex', alignItems: 'center', gap: 5}}>
              <span className={`dot ${i.status === 'ok' ? 'success' : i.status === 'warn' ? 'warning' : 'danger'}`} />
              <span style={{fontSize: 11, color: 'var(--muted)'}}>{i.name}</span>
              <span style={{fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--faint)', letterSpacing: '0.04em'}}>{i.last}</span>
            </div>
          ))}
        </div>
        <span style={{width: 1, height: 16, background: 'var(--line)'}} />
        <div style={{fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.04em'}}>
          v 2.6.1 · build 2026.05.23
        </div>
      </div>
    </header>
  );
}

function ProfileBlock({ user }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  return (
    <div ref={ref} style={{position: 'relative'}}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: open ? 'var(--surface-sunk)' : 'transparent',
          border: '1px solid var(--line)', padding: '4px 10px 4px 4px', borderRadius: 4,
          cursor: 'pointer', height: 36,
        }}
      >
        <Avatar initials={user.initials} size={28} />
        <div style={{textAlign: 'left'}}>
          <div style={{fontSize: 12, fontWeight: 600, color: 'var(--ink)', lineHeight: 1}}>{user.name.split(' ').map(s => s[0] + (s === user.name.split(' ')[0] ? '.' : '')).join(' ')}</div>
          <div style={{fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 3}}>{user.roleLabel}</div>
        </div>
        <span style={{color: 'var(--faint)'}}>{Ic.chevD}</span>
      </button>
      {open && (
        <div className="dropdown" style={{right: 0, left: 'auto'}}>
          <div style={{padding: '10px 10px 8px', borderBottom: '1px solid var(--line)', marginBottom: 4}}>
            <div style={{fontSize: 13, fontWeight: 600}}>{user.name}</div>
            <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 2}}>kosov@tgm-kgd.ru</div>
            <div style={{marginTop: 8, display: 'inline-flex', padding: '2px 6px', background: 'var(--rust-tint)', color: 'var(--rust)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase'}}>{user.roleLabel} · все права</div>
          </div>
          <a className="dropdown-item">Кабинет</a>
          <a className="dropdown-item">Аналитика клиентов</a>
          <a className="dropdown-item">Сменить пароль</a>
          <div className="dropdown-sep" />
          <Link to="/login" className="dropdown-item" style={{color: 'var(--danger)'}}>Выйти</Link>
        </div>
      )}
    </div>
  );
}

function ShiftIndicator() {
  const active = SHIFT.status === 'active';
  if (active) {
    return (
      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
        <span className="dot success pulse" />
        <span style={{fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>Смена активна</span>
        <span style={{fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.02em'}}>
          с {SHIFT.openedAt.split('·')[1].trim()} · {SHIFT.duration}
        </span>
      </div>
    );
  }
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
      <span className="dot idle" />
      <span style={{fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>Смена закрыта</span>
    </div>
  );
}

Object.assign(window, { TopBar });
