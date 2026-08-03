// ====================================================================
//  screens/auth.jsx — Login + locked session
// ====================================================================

function LoginScreen() {
  const r = useRoute();
  const initialState = r.path === '/locked' ? 'locked' : 'normal';
  const [state, setState] = useState(initialState);
  const [email, setEmail] = useState(state === 'locked' ? 'kosov@tgm-kgd.ru' : '');
  const [password, setPassword] = useState('');

  return (
    <div style={{minHeight: '100vh', background: 'var(--bg)', display: 'grid', gridTemplateColumns: '1fr 1fr'}}>
      {/* Left: visual */}
      <div style={{
        background: 'var(--ink)', color: '#F5F2ED',
        padding: 56, position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        {/* hex grid bg */}
        <div style={{position: 'absolute', inset: 0, opacity: 0.5, backgroundImage: `
          repeating-linear-gradient(60deg, transparent 0 22px, rgba(245,242,237,0.03) 22px 23px),
          repeating-linear-gradient(-60deg, transparent 0 22px, rgba(245,242,237,0.03) 22px 23px),
          repeating-linear-gradient(0deg, transparent 0 22px, rgba(245,242,237,0.03) 22px 23px)
        `}} />
        <div style={{position: 'relative'}}>
          <img src={(window.__resources && window.__resources.logoLight) || "../assets/logo-wordmark-light.svg"} alt="Там где масло." style={{height: 22, display: 'block'}} />
          <div style={{marginTop: 14, fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', color: 'var(--rust)', textTransform: 'uppercase'}}>Эко-платформа · v 2.6.1</div>
        </div>

        <div style={{position: 'relative'}}>
          <div style={{fontSize: 11, letterSpacing: '0.14em', color: '#9A9A9A', textTransform: 'uppercase', marginBottom: 14, fontFamily: 'var(--f-mono)'}}>
            Внутренняя система · Калининград · Московский 244
          </div>
          <div style={{fontSize: 36, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 460}}>
            Касса. Склад. Отгрузки. Зарплата.<br />
            <span style={{color: '#9A9A9A'}}>В одном окне<span style={{color: 'var(--rust)'}}>.</span></span>
          </div>
          <div style={{marginTop: 28, display: 'flex', gap: 32}}>
            {[
              ['438', 'отгрузок в мае'],
              ['12', 'позиций под закупку'],
              ['4', 'мастера в смене'],
            ].map(([n, l]) => (
              <div key={l}>
                <div style={{fontSize: 28, fontWeight: 700, lineHeight: 1, fontFamily: 'var(--f-mono)'}}>{n}</div>
                <div style={{fontSize: 11, color: '#9A9A9A', marginTop: 6, letterSpacing: '0.04em'}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 11, color: '#737373', fontFamily: 'var(--f-mono)', letterSpacing: '0.06em'}}>
          <span>ИП Косов Д. А. · ОГРНИП 323390000123456</span>
          <span>© 2023–2026</span>
        </div>
      </div>

      {/* Right: form */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 56}}>
        <div style={{width: '100%', maxWidth: 420}}>
          {/* State switcher (demo only) */}
          <div className="seg" style={{marginBottom: 28}}>
            {[
              {k: 'normal', l: 'Вход'},
              {k: 'error', l: 'Ошибка'},
              {k: 'locked', l: 'Блокировка'},
            ].map(o => (
              <button key={o.k} className={`seg-btn ${state === o.k ? 'on' : ''}`} onClick={() => setState(o.k)}>{o.l}</button>
            ))}
          </div>

          <div style={{fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', color: 'var(--rust)', textTransform: 'uppercase', marginBottom: 10}}>
            {state === 'locked' ? 'Сессия заблокирована' : '01 / 03 · Авторизация'}
          </div>
          <h1 style={{fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1}}>
            {state === 'locked' ? <>Введи пароль,<br /><span style={{color: 'var(--muted)'}}>чтобы продолжить смену.</span></> : <>Войти в платформу<span style={{color: 'var(--rust)'}}>.</span></>}
          </h1>
          {state === 'locked' && (
            <div style={{marginTop: 14, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5}}>
              Ты не работал в системе 25 минут. Касса и отгрузки на паузе.
              Введи пароль — продолжишь там же, где остановился.
            </div>
          )}

          <div style={{marginTop: 32, display: 'flex', flexDirection: 'column', gap: 16}}>
            <div className="field">
              <label className="field-label">E-mail</label>
              <input
                className={`inp lg ${state === 'error' ? 'error' : ''}`}
                type="email"
                placeholder="ivan@tgm-kgd.ru"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={state === 'locked'}
              />
            </div>

            <div className="field">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <label className="field-label">Пароль</label>
                {state !== 'locked' && <a style={{fontSize: 11, color: 'var(--rust)', fontWeight: 500}}>Забыл пароль</a>}
              </div>
              <input
                className={`inp lg ${state === 'error' ? 'error' : ''}`}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
              />
              {state === 'error' && (
                <div className="field-error">{Ic.alert} Неверный e-mail или пароль · попробуй ещё раз</div>
              )}
            </div>

            {state !== 'locked' && (
              <label className="chk-label" style={{marginTop: 4}}>
                <span className="chk" />Запомнить меня на этом компьютере
              </label>
            )}

            <button className="btn primary xl" style={{marginTop: 8}}>
              {state === 'locked' ? 'Продолжить смену' : 'Войти'} <span className="arrow">→</span>
            </button>

            {state === 'locked' && (
              <Link to="/login" style={{textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 4}}>
                Сменить пользователя
              </Link>
            )}
          </div>

          <div style={{marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--f-mono)', letterSpacing: '0.04em'}}>
            <span>SSL · сессия 8 часов</span>
            <a style={{color: 'var(--rust)'}}>support@tgm-kgd.ru</a>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen });
