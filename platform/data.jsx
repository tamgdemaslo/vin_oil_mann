// ====================================================================
//  platform/data.jsx — mock domain data for the back-office prototype
// ====================================================================

const USERS = {
  owner: { id: 'kosov', name: 'Дмитрий Косов', role: 'owner', roleLabel: 'Владелец', initials: 'ДК' },
  admin: { id: 'lebedeva', name: 'Анна Лебедева', role: 'admin', roleLabel: 'Администратор', initials: 'АЛ' },
  master1: { id: 'ignatenko', name: 'Сергей Игнатенко', role: 'master', roleLabel: 'Мастер', initials: 'СИ' },
  master2: { id: 'voitov', name: 'Артём Войтов', role: 'master', roleLabel: 'Мастер', initials: 'АВ' },
};

const CLIENTS = [
  { id: 'c-247', name: 'Алексей Соловьёв', phone: '+7 911 487 22 14', plate: 'А 247 МК 39', car: 'BMW X5 xDrive40i (G05)', vin: 'WBABA91070AL55203', visits: 4 },
  { id: 'c-318', name: 'Игорь Михайлов', phone: '+7 911 384 12 56', plate: 'М 318 ОР 39', car: 'Audi Q7 (4M) 3.0 TDI', vin: 'WAUZZZ4M0KD041318', visits: 2 },
  { id: 'c-512', name: 'Ольга Дворецкая', phone: '+7 911 654 28 71', plate: 'Е 512 АН 39', car: 'Mercedes E 220 d (W213)', vin: 'WDD2130041A512871', visits: 3 },
  { id: 'c-104', name: 'Павел Котов', phone: '+7 911 220 41 09', plate: 'К 104 ТТ 39', car: 'Porsche Cayenne 958 S', vin: 'WP1AB2A28GLA21104', visits: 6 },
  { id: 'c-789', name: 'Дмитрий Левин', phone: '+7 911 555 19 03', plate: 'О 789 ВТ 39', car: 'Toyota Land Cruiser 200', vin: 'JTMHV05J504167789', visits: 1 },
  { id: 'c-431', name: 'Анна Глебова', phone: '+7 911 671 84 22', plate: 'У 431 ВВ 39', car: 'Volvo XC90 D5', vin: 'YV4A22PL5K1431002', visits: 2 },
];

const PRODUCTS = [
  { sku: 'SHL-HU-5W40-4L', name: 'Shell Helix Ultra 5W-40', brand: 'Shell', cat: 'Моторное масло', sae: '5W-40', api: 'SP', acea: 'A3/B4', vol: '4 л', cost: 3120, price: 4990, stock: 24, avail: 22, reserve: 2, cell: 'A-12', supplier: 'Альфа-Ойл', oem: '550046641' },
  { sku: 'SHL-HU-0W40-4L', name: 'Shell Helix Ultra 0W-40', brand: 'Shell', cat: 'Моторное масло', sae: '0W-40', api: 'SN', acea: 'A3/B4', vol: '4 л', cost: 3680, price: 5690, stock: 12, avail: 11, reserve: 1, cell: 'A-12', supplier: 'Альфа-Ойл', oem: '550046638' },
  { sku: 'MOB-1-ESP-5W30-4', name: 'Mobil 1 ESP 5W-30', brand: 'Mobil', cat: 'Моторное масло', sae: '5W-30', api: 'SN', acea: 'C3', vol: '4 л', cost: 3340, price: 5290, stock: 18, avail: 16, reserve: 2, cell: 'A-13', supplier: 'Альфа-Ойл', oem: '154296' },
  { sku: 'MOB-1-0W20-4L', name: 'Mobil 1 0W-20', brand: 'Mobil', cat: 'Моторное масло', sae: '0W-20', api: 'SP', acea: '—', vol: '4 л', cost: 3580, price: 5590, stock: 9, avail: 7, reserve: 2, cell: 'A-13', supplier: 'Альфа-Ойл', oem: '155144' },
  { sku: 'ZIC-X9-LS-5W30-4', name: 'ZIC X9 LS 5W-30', brand: 'ZIC', cat: 'Моторное масло', sae: '5W-30', api: 'SP', acea: 'C3', vol: '4 л', cost: 2380, price: 3890, stock: 32, avail: 28, reserve: 4, cell: 'A-14', supplier: 'СК-Ойл', oem: '162200' },
  { sku: 'TOT-Q9-5W40-4L', name: 'Total Quartz 9000 5W-40', brand: 'Total', cat: 'Моторное масло', sae: '5W-40', api: 'SN/CF', acea: 'A3/B4', vol: '4 л', cost: 2640, price: 4290, stock: 16, avail: 14, reserve: 2, cell: 'A-15', supplier: 'СК-Ойл', oem: '213697' },
  { sku: 'LUK-GEN-AT-5W40-4', name: 'Lukoil Genesis Armortech 5W-40', brand: 'Lukoil', cat: 'Моторное масло', sae: '5W-40', api: 'SN/CF', acea: 'A3/B4', vol: '4 л', cost: 1820, price: 2990, stock: 41, avail: 38, reserve: 3, cell: 'A-16', supplier: 'РН-Север', oem: '3149867' },
  { sku: 'BRD-XTC-5W40-4', name: 'Bardahl XTC C60 5W-40', brand: 'Bardahl', cat: 'Моторное масло', sae: '5W-40', api: 'SN', acea: 'A3/B4', vol: '4 л', cost: 3620, price: 5790, stock: 2, avail: 2, reserve: 0, cell: 'A-17', supplier: 'Бардаль-Балтика', oem: '36343' },
  { sku: 'ELF-EVO-10W40-4', name: 'ELF Evolution 700 STI 10W-40', brand: 'ELF', cat: 'Моторное масло', sae: '10W-40', api: 'SL/CF', acea: 'A3/B4', vol: '4 л', cost: 1690, price: 2690, stock: 28, avail: 26, reserve: 2, cell: 'A-18', supplier: 'РН-Север', oem: '201525' },
  { sku: 'BMW-OF-LL01', name: 'Фильтр масляный BMW 11428583898', brand: 'BMW', cat: 'Фильтр масляный', sae: '—', api: '—', acea: '—', vol: '1 шт', cost: 620, price: 1180, stock: 14, avail: 12, reserve: 2, cell: 'B-04', supplier: 'BMW Russland', oem: '11428583898' },
  { sku: 'MNN-HU815', name: 'Фильтр масляный Mann HU815/2x', brand: 'Mann', cat: 'Фильтр масляный', sae: '—', api: '—', acea: '—', vol: '1 шт', cost: 410, price: 780, stock: 22, avail: 22, reserve: 0, cell: 'B-05', supplier: 'Mann+Hummel', oem: 'HU 815/2 x' },
  { sku: 'ZFL-LG8-1L', name: 'ZF LifeGuard 8 (ATF)', brand: 'ZF', cat: 'Трансмиссионное', sae: '—', api: '—', acea: '—', vol: '1 л', cost: 1280, price: 1990, stock: 38, avail: 32, reserve: 6, cell: 'C-02', supplier: 'ZF Baltic', oem: 'S671090312' },
  { sku: 'VAG-G060162-1L', name: 'VAG G 060 162 (ATF DSG)', brand: 'VAG', cat: 'Трансмиссионное', sae: '—', api: '—', acea: '—', vol: '1 л', cost: 1380, price: 2090, stock: 4, avail: 4, reserve: 0, cell: 'C-03', supplier: 'VAG Восток', oem: 'G060162A2' },
  { sku: 'BMW-OPLG-M14', name: 'Сливная пробка + шайба BMW M14', brand: 'BMW', cat: 'Расходник', sae: '—', api: '—', acea: '—', vol: '1 шт', cost: 110, price: 280, stock: 56, avail: 54, reserve: 2, cell: 'D-01', supplier: 'BMW Russland', oem: '11137548021' },
];

const SHIPMENTS = [
  { num: 'TGM-2026-0438', date: '23.05.2026 14:30', client: 'c-247', master: 'master1', status: 'draft', sum: 6450, paid: 0, items: 3, vin: 'WBABA91070AL55203' },
  { num: 'TGM-2026-0437', date: '23.05.2026 12:10', client: 'c-318', master: 'master1', status: 'in-progress', sum: 21800, paid: 0, items: 5, vin: 'WAUZZZ4M0KD041318' },
  { num: 'TGM-2026-0436', date: '23.05.2026 11:00', client: 'c-104', master: 'master2', status: 'completed', sum: 32400, paid: 32400, items: 7, vin: 'WP1AB2A28GLA21104' },
  { num: 'TGM-2026-0435', date: '23.05.2026 09:45', client: 'c-512', master: 'master1', status: 'completed', sum: 17400, paid: 17400, items: 4, vin: 'WDD2130041A512871' },
  { num: 'TGM-2026-0434', date: '22.05.2026 18:30', client: 'c-789', master: 'master2', status: 'completed', sum: 12800, paid: 12800, items: 3, vin: 'JTMHV05J504167789' },
  { num: 'TGM-2026-0433', date: '22.05.2026 16:15', client: 'c-431', master: 'master1', status: 'completed', sum: 9670, paid: 9670, items: 3, vin: 'YV4A22PL5K1431002' },
  { num: 'TGM-2026-0432', date: '22.05.2026 14:00', client: 'c-247', master: 'master1', status: 'completed', sum: 7290, paid: 7290, items: 2, vin: 'WBABA91070AL55203' },
  { num: 'TGM-2026-0431', date: '22.05.2026 11:20', client: 'c-318', master: 'master2', status: 'returned', sum: 4900, paid: 4900, items: 2, vin: 'WAUZZZ4M0KD041318' },
];

const STATUS = {
  'draft': { label: 'Черновик', tone: 'warning' },
  'in-progress': { label: 'В работе', tone: 'info' },
  'completed': { label: 'Завершено', tone: 'success' },
  'returned': { label: 'Возврат', tone: 'danger' },
  'paid': { label: 'Оплачено', tone: 'success' },
  'unpaid': { label: 'Не оплачено', tone: 'warning' },
  'partial': { label: 'Частично', tone: 'warning' },
};

// VIN decode demo data
const VIN_DECODE = {
  'WBABA91070AL55203': {
    brand: 'BMW', model: 'X5 xDrive40i', generation: 'G05', year: 2021,
    engine: 'B58B30M1 · 3.0 бензин · 333 л.с.',
    body: 'SUV', drive: 'AWD', transmission: 'ZF 8HP51 (АКПП 8-ст.)',
    oilCapacity: '6.5 л', oilSpec: 'BMW Longlife-01 · 5W-30',
    filter: 'BMW 11428583898', drainPlug: 'M14×1.5 + шайба 11137548021',
    interval: '10 000 км / 12 мес',
    plans: [
      {
        tier: 'эконом',
        oil: { sku: 'LUK-GEN-AT-5W40-4', label: 'Lukoil Genesis Armortech 5W-40' },
        filter: { sku: 'MNN-HU815', label: 'Mann HU815/2x' },
        drain: 'BMW-OPLG-M14',
        total: 4450,
      },
      {
        tier: 'оптимальный',
        oil: { sku: 'MOB-1-ESP-5W30-4', label: 'Mobil 1 ESP 5W-30' },
        filter: { sku: 'BMW-OF-LL01', label: 'BMW OEM 11428583898' },
        drain: 'BMW-OPLG-M14',
        total: 6750,
        recommended: true,
      },
      {
        tier: 'премиум',
        oil: { sku: 'BRD-XTC-5W40-4', label: 'Bardahl XTC C60 5W-40' },
        filter: { sku: 'BMW-OF-LL01', label: 'BMW OEM 11428583898' },
        drain: 'BMW-OPLG-M14',
        total: 7250,
      },
    ],
  },
};

// Shift state demo
const SHIFT = {
  status: 'active', // 'closed' | 'active'
  openedAt: '23.05.2026 · 09:00',
  openedBy: 'master1',
  duration: '5 ч 42 мин',
  completedShipments: 3,
  revenue: 67270,
};

const CASH_SHIFT = {
  status: 'active', // 'closed' | 'open' | 'reconciling'
  openedAt: '23.05.2026 · 09:00',
  openedBy: 'admin',
  startBalance: 5000,
  ops: [
    { time: '09:30', kind: 'income', method: 'cash', label: 'Заказ TGM-2026-0435', amount: 17400 },
    { time: '10:15', kind: 'income', method: 'card', label: 'Заказ TGM-2026-0436', amount: 32400 },
    { time: '11:50', kind: 'expense', method: 'cash', label: 'Замена шланга на стенде', amount: -1200, doc: 'РО-118' },
    { time: '12:40', kind: 'income', method: 'cash', label: 'Заказ TGM-2026-0438 (часть)', amount: 3500 },
    { time: '13:20', kind: 'withdraw', method: 'cash', label: 'Изъятие в сейф', amount: -10000, doc: 'РО-119' },
    { time: '14:05', kind: 'income', method: 'sbp', label: 'Заказ TGM-2026-0437 (предоплата)', amount: 8000 },
  ],
};

const INTEGRATIONS = [
  { id: 'moysklad', name: 'МойСклад', status: 'ok', last: '14:48' },
  { id: 'aqsi', name: 'AQSI', status: 'ok', last: '14:50' },
  { id: 'rossko', name: 'Россько', status: 'warn', last: '13:12' },
  { id: 'yclients', name: 'YCLIENTS', status: 'ok', last: '14:49' },
];

// Receiving / write-off demo data
const RECEIVING = {
  num: 'ПРМ-2026-0091',
  date: '23.05.2026',
  supplier: 'Альфа-Ойл',
  invoice: '№ 7842 от 20.05.2026',
  status: 'draft',
  items: [
    { sku: 'SHL-HU-5W40-4L', qty: 12, cost: 3120 },
    { sku: 'SHL-HU-0W40-4L', qty: 6, cost: 3680 },
    { sku: 'MOB-1-ESP-5W30-4', qty: 10, cost: 3340 },
  ],
};

// ============================================================
// CRM
// ============================================================

const DEAL_STAGES = [
  { id: 'new',       label: 'Новая',         tone: 'info',    color: '#1D4ED8' },
  { id: 'work',      label: 'В работе',      tone: 'rust',    color: '#C2410C' },
  { id: 'wait-pay',  label: 'Ждём оплату',   tone: 'warning', color: '#B45309' },
  { id: 'won',       label: 'Завершено',     tone: 'success', color: '#15803D' },
  { id: 'lost',      label: 'Потеряно',      tone: 'neutral', color: '#737373' },
];

const SOURCES = {
  'instagram': { label: 'Instagram',   color: '#E4405F' },
  'telegram':  { label: 'Telegram',    color: '#26A5E4' },
  'phone':     { label: 'Звонок',      color: '#15803D' },
  'site':      { label: 'Сайт',        color: '#1D4ED8' },
  'referral':  { label: 'Рекомендация',color: '#C2410C' },
  'repeat':    { label: 'Повторный',   color: '#525252' },
  'walk-in':   { label: 'С улицы',     color: '#737373' },
};

const DEALS = [
  // new
  { id: 'D-2026-0072', stage: 'new', client: 'c-789', sum: 5290, source: 'instagram', responsible: 'admin',  service: 'Замена масла + диагностика', createdAt: '23.05 11:12', daysInStage: 0, nextContact: '23.05 17:00', activity: 'today', overdue: false, comment: 'Хочет ZIC X9, на Toyota Land Cruiser. Готов завтра' },
  { id: 'D-2026-0071', stage: 'new', client: 'c-431', sum: 8900, source: 'phone',     responsible: 'admin',  service: 'Полная замена ATF на Volvo XC90', createdAt: '23.05 09:42', daysInStage: 0, nextContact: '23.05 16:00', activity: 'today', overdue: false, comment: 'Просит пересчитать с фильтром Volvo OEM' },
  { id: 'D-2026-0070', stage: 'new', client: 'c-512', sum: 0,    source: 'referral',  responsible: 'admin',  service: 'Уточнить услугу',                createdAt: '22.05 19:15', daysInStage: 1, nextContact: '24.05 10:00', activity: '1 день', overdue: false, comment: 'Пришла по рекомендации Соловьёва' },

  // work
  { id: 'D-2026-0068', stage: 'work', client: 'c-318', sum: 21800, source: 'instagram', responsible: 'master1', service: 'Замена ATF DSG DL382 + фильтр', createdAt: '23.05 09:00', daysInStage: 0, nextContact: '23.05 14:00', activity: '40 мин', overdue: false, comment: 'Машина на подъёмнике, ATF в работе' },
  { id: 'D-2026-0066', stage: 'work', client: 'c-247', sum: 6450, source: 'repeat',     responsible: 'master1', service: 'Замена масла BMW X5',          createdAt: '22.05 17:30', daysInStage: 1, nextContact: '23.05 15:30', activity: '2 ч',   overdue: false, comment: 'Записан на 15:30, подтвердил' },
  { id: 'D-2026-0064', stage: 'work', client: 'c-104', sum: 32100, source: 'referral',  responsible: 'master2', service: 'Aisin TR-80SD аппаратная',   createdAt: '21.05 14:00', daysInStage: 2, nextContact: '24.05 11:00', activity: '1 день', overdue: false, comment: 'Согласовали двойную промывку' },
  { id: 'D-2026-0060', stage: 'work', client: 'c-431', sum: 4800, source: 'site',       responsible: 'admin',  service: 'Диагностика подвески',         createdAt: '19.05 10:00', daysInStage: 4, nextContact: '22.05 14:00', activity: '4 дня', overdue: true,  comment: 'Не отвечает 2 дня. Перезвонить' },

  // wait-pay
  { id: 'D-2026-0062', stage: 'wait-pay', client: 'c-318', sum: 18900, source: 'instagram', responsible: 'admin', service: 'Замена ATF', createdAt: '20.05 11:00', daysInStage: 3, nextContact: '23.05 18:00', activity: '3 дня', overdue: false, comment: 'Просил счёт на юр.лицо. Отправлен' },
  { id: 'D-2026-0058', stage: 'wait-pay', client: 'c-104', sum: 14200, source: 'repeat',    responsible: 'admin', service: 'Замена масла + фильтры', createdAt: '18.05 16:20', daysInStage: 5, nextContact: '23.05 12:00', activity: '5 дней', overdue: true, comment: 'Обещал оплатить в среду' },

  // won
  { id: 'D-2026-0056', stage: 'won', client: 'c-247', sum: 7290,  source: 'repeat',    responsible: 'master1', service: 'Замена масла BMW',    createdAt: '22.05 14:00', daysInStage: 1, nextContact: '—', activity: 'вчера', overdue: false, comment: 'Завершено, наряд закрыт' },
  { id: 'D-2026-0055', stage: 'won', client: 'c-789', sum: 12800, source: 'phone',     responsible: 'master2', service: 'Toyota LC 200 ATF',   createdAt: '22.05 11:00', daysInStage: 1, nextContact: '—', activity: 'вчера', overdue: false, comment: 'Клиент доволен, оставил отзыв' },

  // lost
  { id: 'D-2026-0049', stage: 'lost', client: 'c-104', sum: 0, source: 'site', responsible: 'admin', service: 'Шиномонтаж', createdAt: '15.05 12:00', daysInStage: 8, nextContact: '—', activity: '—', overdue: false, comment: 'Шиномонтаж не делаем — направили к коллегам' },
];

// ============================================================
// Appointments / Записи клиентов (Журнал записей)
// ============================================================

const APPT_STATUS = {
  'wait':      { label: 'Ожидание',     tone: 'warning' },
  'confirmed': { label: 'Подтверждён',  tone: 'info' },
  'arrived':   { label: 'Пришёл',       tone: 'success' },
  'in-work':   { label: 'В работе',     tone: 'rust' },
  'done':      { label: 'Завершён',     tone: 'success' },
  'no-show':   { label: 'Не пришёл',    tone: 'danger' },
  'cancelled': { label: 'Отменён',      tone: 'neutral' },
};

// Times in 24h format, durations in minutes
const APPOINTMENTS = [
  // master1 (Игнатенко) — column 0
  { id: 'A-461', time: '09:00', duration: 60, master: 'master1', client: 'c-318', service: 'Замена ATF DSG DL382',    status: 'in-work',   source: 'instagram' },
  { id: 'A-458', time: '10:15', duration: 30, master: 'master1', client: 'c-512', service: 'Замена моторного масла',  status: 'done',      source: 'repeat' },
  { id: 'A-462', time: '11:00', duration: 90, master: 'master1', client: 'c-247', service: 'Замена масла + диагност.', status: 'done',      source: 'phone' },
  { id: 'A-465', time: '14:30', duration: 60, master: 'master1', client: 'c-247', service: 'Замена масла BMW',         status: 'confirmed', source: 'repeat' },
  { id: 'A-468', time: '15:30', duration: 30, master: 'master1', client: 'c-512', service: 'Доливка ATF',              status: 'confirmed', source: 'phone' },
  { id: 'A-470', time: '17:00', duration: 60, master: 'master1', client: 'c-789', service: 'Подбор масла + замена',    status: 'wait',      source: 'instagram' },

  // master2 (Войтов) — column 1
  { id: 'A-459', time: '10:00', duration: 90, master: 'master2', client: 'c-104', service: 'Aisin аппаратная',         status: 'in-work',   source: 'referral' },
  { id: 'A-463', time: '12:00', duration: 30, master: 'master2', client: 'c-431', service: 'Диагностика 14 пунктов',   status: 'done',      source: 'site' },
  { id: 'A-464', time: '13:30', duration: 60, master: 'master2', client: 'c-789', service: 'Toyota LC 200 · ATF',      status: 'done',      source: 'phone' },
  { id: 'A-467', time: '16:30', duration: 60, master: 'master2', client: 'c-789', service: 'Замена масла Toyota',      status: 'confirmed', source: 'phone' },
  { id: 'A-471', time: '18:30', duration: 30, master: 'master2', client: 'c-318', service: 'Доливка масла',            status: 'wait',      source: 'instagram' },

  // no-show from earlier today
  { id: 'A-466', time: '14:00', duration: 30, master: 'master2', client: 'c-431', service: 'Замена фильтров',          status: 'no-show',   source: 'site' },
];

// ============================================================
// Diagnostics — 14 points across 4 blocks
// ============================================================

const DIAG_STATUS = {
  'unchecked':  { label: 'Не проверено',     short: 'Не пров.',  tone: 'idle',    color: '#A3A3A3', icon: '○', group: 'result' },
  'good':       { label: 'Хорошо',           short: 'Хорошо',    tone: 'success', color: '#15803D', icon: '✓', group: 'result' },
  'warn':       { label: 'Внимание',         short: 'Внимание',  tone: 'warning', color: '#B45309', icon: '!', group: 'result' },
  'crit':       { label: 'Критично',         short: 'Критично',  tone: 'danger',  color: '#B91C1C', icon: '×', group: 'result' },
  'no-access':  { label: 'Доступ затруднён', short: 'Нет доступа', tone: 'neutral', color: '#6B7280', icon: '⊘', group: 'indirect', hint: 'Осмотр не проводился из-за сложности доступа' },
  'by-mileage': { label: 'Вывод по пробегу', short: 'По пробегу', tone: 'info',    color: '#1D4ED8', icon: '≈', group: 'indirect', hint: 'Заключение на основании пробега и регламента' },
  'by-client':  { label: 'Со слов клиента',  short: 'Со слов',   tone: 'info',    color: '#7C3AED', icon: '”', group: 'indirect', hint: 'Записано со слов клиента, без прямого осмотра' },
};

// Общие наборы готовых формулировок
const REC_PRESETS_COMMON = ['Контроль на следующем визите', 'Дефектовка на подъёмнике'];

const DIAG_BLOCKS = [
  {
    id: 'engine',
    title: 'Моторные и сервисные жидкости',
    short: 'Жидкости',
    items: [
      { id: 'oil-level', label: 'Уровень моторного масла', measure: 'Уровень', unit: 'мм по щупу', norm: 'между MIN и MAX',
        notes: ['Между MIN и MAX', 'Ближе к MAX', 'Ниже MIN — нужен долив', 'В норме после замены'],
        recs: ['Долив моторного масла', 'Контроль уровня через 1 000 км'] },
      { id: 'oil-condition', label: 'Состояние масла — цвет, запах', norm: 'прозрачное, без запаха гари',
        notes: ['Свежее, прозрачное', 'Тёмное, отработало ресурс', 'Запах гари', 'Только что залито'],
        recs: ['Замена моторного масла и фильтра'] },
      { id: 'coolant', label: 'Антифриз — уровень и t° замерзания', measure: 'Замерзание', unit: '°C', norm: '≤ −35 °C',
        notes: ['Уровень в норме, −42 °C', 'Уровень ниже MIN', 'Низкая плотность', 'Следы масла в ОЖ'],
        recs: ['Долив / замена антифриза', 'Проверка системы охлаждения'] },
      { id: 'brake-fluid', label: 'Тормозная жидкость — влажность', measure: 'Влажность', unit: '%', norm: '< 2.0 %',
        notes: ['В норме, до 2 %', '2.3 % воды — выше нормы', 'Тёмная, отработавшая'],
        recs: ['Замена тормозной жидкости DOT 4 с прокачкой · ~2 200 ₽'] },
      { id: 'washer', label: 'Жидкость омывателя', norm: 'долита',
        notes: ['Долита', 'Пустой бачок'], recs: ['Долив незамерзайки'] },
    ],
  },
  {
    id: 'trans',
    title: 'Трансмиссия и полный привод',
    short: 'Трансмиссия',
    items: [
      { id: 'atf-level', label: 'Уровень ATF', measure: 'Уровень', unit: 'мм', norm: 'по регламенту',
        notes: ['Норма после замены', 'Ниже уровня', 'Перелив'], recs: ['Корректировка уровня ATF'] },
      { id: 'atf-condition', label: 'Состояние ATF — цвет, запах', norm: 'красное, прозрачное',
        notes: ['Красное, чистое', 'Тёмное, запах гари', 'Мутное, с продуктами износа'],
        recs: ['Аппаратная замена ATF с промывкой', 'Замена фильтра АКПП'] },
      { id: 'reducer', label: 'Редуктор — масло, шум', norm: 'без шума, уровень в норме',
        notes: ['Без шума, уровень в норме', 'Гул на скорости', 'Подтёки масла', 'Масло не менялось по пробегу'],
        recs: ['Замена масла в редукторе', 'Диагностика на подъёмнике с прогазовкой'] },
      { id: 'transfer', label: 'Раздаточная коробка — масло, шум', norm: 'работает штатно',
        notes: ['Работает штатно', 'Шум при переключении', 'Подтёки', 'Толчки при старте'],
        recs: ['Замена масла в раздатке', 'Диагностика муфты раздатки'] },
    ],
  },
  {
    id: 'electro',
    title: 'Электрооборудование и свет',
    short: 'Электрика',
    items: [
      { id: 'battery', label: 'АКБ — напряжение покоя', measure: 'Напряжение', unit: 'В', norm: '12.4–12.7 В',
        notes: ['12.6 В — в норме', '12.2 В — ниже нормы', 'Держит нагрузку', 'Теряет ёмкость'],
        recs: ['Зарядка АКБ', 'Замена АКБ перед зимой · от 9 500 ₽'] },
      { id: 'lights', label: 'Освещение и сигналы', norm: 'все исправны',
        notes: ['Все исправны', 'Не горит габарит', 'Помутнели фары'], recs: ['Замена ламп', 'Полировка фар'] },
    ],
  },
  {
    id: 'visual',
    title: 'Ходовая и осмотр снизу',
    short: 'Ходовая',
    items: [
      { id: 'belts', label: 'Ремни и приводы', norm: 'без трещин',
        notes: ['Без трещин', 'Микротрещины', 'Ремень не менялся по пробегу'], recs: ['Замена ремня навесного оборудования'] },
      { id: 'leaks-engine', label: 'Утечки моторного отсека', norm: 'сухо',
        notes: ['Сухо', 'Запотевание клапанной крышки', 'Подтёки масла'], recs: ['Замена прокладки клапанной крышки'] },
      { id: 'leaks-bottom', label: 'Утечки снизу', norm: 'сухо',
        notes: ['Сухо', 'Запотевание поддона', 'Подтёки из сальника'], recs: ['Устранение течи · диагностика на подъёмнике'] },
      { id: 'pads', label: 'Тормозные колодки — остаток', measure: 'Остаток', unit: '%', norm: '> 30 %',
        notes: ['Перед 62 %, зад в норме', 'Задние 28 % — к замене', 'Скрип при торможении'],
        recs: ['Замена задних колодок · ~6 800 ₽', 'Замена передних колодок'] },
      { id: 'tires', label: 'Шины — глубина протектора', measure: 'Глубина', unit: 'мм', norm: '> 4.0 мм',
        notes: ['5.6 мм — в норме', 'Передние 3.8 мм — ниже нормы', 'Неравномерный износ'],
        recs: ['Замена передней пары шин до зимы', 'Развал-схождение'] },
      { id: 'suspension', label: 'Подвеска — сайлентблоки, рычаги', norm: 'без люфтов',
        notes: ['Без люфтов', 'Стук на кочках', 'Разрывы сайлентблоков задних рычагов', 'Надрыв пыльника ШРУС'],
        recs: ['Замена сайлентблоков задних рычагов · ~28 000 ₽', 'Замена пыльника ШРУС · ~3 500 ₽'] },
    ],
  },
];

// Pre-filled diagnostics state for the demo shipment (TGM-2026-0436, Porsche Cayenne)
const DIAG_STATE = {
  shipment: 'TGM-2026-0436',
  client: 'c-104',
  vin: 'WP1AB2A28GLA21104',
  startedAt: '23.05.2026 · 11:24',
  finishedAt: '23.05.2026 · 11:52',
  master: 'master2',
  mileage: 189300,
  items: {
    // Жидкости
    'oil-level':     { status: 'good', value: 'между MIN и MAX',  note: '', photos: [] },
    'oil-condition': { status: 'good', value: 'свежее, прозрачное', note: 'только что залили Mobil 1 ESP', photos: [{ cap: 'Свежее масло на щупе' }] },
    'coolant':       { status: 'good', value: '−42 °C',           note: 'уровень в норме', photos: [] },
    'brake-fluid':   { status: 'warn', value: '2.3 %',            note: 'Выше нормы, влага в системе',
                       rec: 'Замена тормозной жидкости DOT 4 с прокачкой · ~2 200 ₽', photos: [{ cap: 'Тестер: 2.3 % воды' }] },
    'washer':        { status: 'good', value: 'долита',           note: '', photos: [] },
    // Трансмиссия и полный привод
    'atf-level':     { status: 'good', value: 'норма после замены', note: '', photos: [{ cap: 'Уровень ATF после замены' }] },
    'atf-condition': { status: 'good', value: 'красное, чистое',  note: '', photos: [{ cap: 'Цвет новой жидкости' }] },
    'reducer':       { status: 'no-access', value: 'под защитой картера', note: 'Доступ затруднён — защита не снималась. Осмотрим на следующем визите.',
                       photos: [] },
    'transfer':      { status: 'by-client', value: 'толчки при старте', note: 'Клиент отмечает лёгкие толчки на старте. Прямой осмотр на ходу не выявил отклонений.',
                       rec: 'Диагностика муфты раздатки на стенде', photos: [] },
    // Электрика и свет
    'battery':       { status: 'warn', value: '12.2 В',           note: 'Ниже нормы покоя, теряет ёмкость',
                       rec: 'Замена АКБ перед зимой · от 9 500 ₽', photos: [{ cap: 'Мультиметр: 12.2 В' }] },
    'lights':        { status: 'good', value: 'все исправны',     note: '', photos: [] },
    // Ходовая
    'belts':         { status: 'by-mileage', value: 'пробег 189 000 км', note: 'Ремень навесного не менялся по пробегу — рекомендуем плановую замену.',
                       rec: 'Замена ремня навесного оборудования по регламенту', photos: [] },
    'leaks-engine':  { status: 'good', value: 'сухо',             note: '', photos: [] },
    'leaks-bottom':  { status: 'good', value: 'сухо',             note: '', photos: [{ cap: 'Поддон — сухо' }] },
    'pads':          { status: 'warn', value: 'задние 28 %',      note: 'Передние 62 %, задние приближаются к минимуму',
                       rec: 'Замена задних колодок в ближайшие 3–5 тыс. км · ~6 800 ₽', photos: [{ cap: 'Задние колодки, остаток 28 %' }] },
    'tires':         { status: 'warn', value: 'передние 3.8 мм',  note: 'Передние ниже нормы, задние 5.6 мм',
                       rec: 'Замена передней пары шин до октября', photos: [{ cap: 'Глубиномер: 3.8 мм' }, { cap: 'Износ передней оси' }] },
    'suspension':    { status: 'crit', value: 'разрыв сайлентблоков задних рычагов', note: 'Стук на кочках, заметная игра при покачивании',
                       rec: 'Замена сайлентблоков задних рычагов · 2 шт · оригинал Porsche · ~28 000 ₽ с работой',
                       photos: [{ cap: 'Разрыв сайлентблока' }, { cap: 'Люфт заднего рычага' }, { cap: 'Надрыв пыльника ШРУС' }] },
  },
};

// ============================================================
// Employees + Payroll
// ============================================================

const EMPLOYEES = [
  { id: 'master1', name: 'Сергей Игнатенко', role: 'Мастер моторного цеха', since: '03.10.2023',
    rate: { type: 'mixed', base: 80000, hourly: 0, piece: 12 },
    initials: 'СИ',
  },
  { id: 'master2', name: 'Артём Войтов', role: 'Мастер-диагност', since: '14.02.2024',
    rate: { type: 'mixed', base: 70000, hourly: 0, piece: 10 },
    initials: 'АВ',
  },
  { id: 'lebedev', name: 'Никита Лебедев', role: 'Мастер моторного цеха', since: '08.05.2024',
    rate: { type: 'mixed', base: 65000, hourly: 0, piece: 10 },
    initials: 'НЛ',
  },
  { id: 'admin', name: 'Анна Лебедева', role: 'Администратор', since: '01.11.2023',
    rate: { type: 'salary', base: 75000, hourly: 0, piece: 0 },
    initials: 'АЛ',
  },
];

// Payroll for the current month (May 2026, period 1-23 May = 16 working days so far)
const PAYROLL = {
  period: 'Май 2026',
  payoutDate: '05.06.2026',
  workingDaysInPeriod: 16,
  totalDaysInMonth: 21,
  rows: [
    { emp: 'master1', daysWorked: 16, hoursWorked: 128, shipments: 142, pieceSum: 18400, bonus: 5000, penalty: 0,
      bonusReason: 'Машина недели · клиент в восторге', penaltyReason: '' },
    { emp: 'master2', daysWorked: 14, hoursWorked: 108, shipments: 96,  pieceSum: 12800, bonus: 0, penalty: 1500,
      bonusReason: '', penaltyReason: 'Опоздание на смену · 18.05' },
    { emp: 'lebedev', daysWorked: 12, hoursWorked: 96,  shipments: 78,  pieceSum: 9800, bonus: 0, penalty: 0,
      bonusReason: '', penaltyReason: '' },
    { emp: 'admin',   daysWorked: 16, hoursWorked: 128, shipments: 0,   pieceSum: 0, bonus: 3000, penalty: 0,
      bonusReason: 'Закрыты все счета поставщиков в срок', penaltyReason: '' },
  ],
};

// Working days calendar for master1, May 2026
const WORKING_DAYS = {
  master1: {
    // day → status: 'worked' | 'off' | 'vacation' | 'sick' | 'planned'
    1: 'worked', 2: 'worked', 3: 'off', 4: 'off', 5: 'worked',
    6: 'worked', 7: 'worked', 8: 'worked', 9: 'worked', 10: 'off',
    11: 'off', 12: 'worked', 13: 'worked', 14: 'worked', 15: 'worked',
    16: 'worked', 17: 'off', 18: 'worked', 19: 'worked', 20: 'worked',
    21: 'worked', 22: 'worked', 23: 'worked',
    24: 'off', 25: 'planned', 26: 'planned', 27: 'planned', 28: 'planned',
    29: 'planned', 30: 'planned', 31: 'off',
  },
};

const PIECE_RULES = [
  { id: 1, kind: 'Замена моторного масла',         from: 0,   to: 5000,  pct: 10, fixed: 0,    note: 'Заказ до 5 000 ₽' },
  { id: 2, kind: 'Замена моторного масла',         from: 5001,to: 10000, pct: 12, fixed: 0,    note: '5 001 — 10 000 ₽' },
  { id: 3, kind: 'Замена моторного масла',         from: 10001, to: null,pct: 15, fixed: 0,    note: 'свыше 10 000 ₽' },
  { id: 4, kind: 'Замена ATF (АКПП/DSG)',          from: 0,   to: null,  pct: 18, fixed: 0,    note: 'любая сумма' },
  { id: 5, kind: 'Замена антифриза/тормозной',     from: 0,   to: null,  pct: 12, fixed: 0,    note: '' },
  { id: 6, kind: 'Диагностика 14 пунктов',         from: 0,   to: null,  pct: 0,  fixed: 300,  note: 'фикс. ставка за полную диагностику' },
];

const BONUS_PENALTY_LOG = [
  { id: 1, date: '21.05.2026', emp: 'master1', kind: 'bonus',   amount: 5000, reason: 'Машина недели — Porsche Cayenne · отзыв 5 звёзд' },
  { id: 2, date: '18.05.2026', emp: 'master2', kind: 'penalty', amount: 1500, reason: 'Опоздание на 35 минут' },
  { id: 3, date: '15.05.2026', emp: 'admin',   kind: 'bonus',   amount: 3000, reason: 'Закрыла все счета поставщиков в срок' },
  { id: 4, date: '10.05.2026', emp: 'master1', kind: 'bonus',   amount: 2000, reason: 'Спас клиенту коробку — нашёл утечку на приёмке' },
  { id: 5, date: '07.05.2026', emp: 'master2', kind: 'penalty', amount: 800, reason: 'Не сверил уровень после замены — клиент вернулся' },
];

Object.assign(window, {
  USERS, CLIENTS, PRODUCTS, SHIPMENTS, STATUS, VIN_DECODE, SHIFT, CASH_SHIFT, INTEGRATIONS, RECEIVING,
  DEAL_STAGES, SOURCES, DEALS, APPT_STATUS, APPOINTMENTS,
  DIAG_STATUS, DIAG_BLOCKS, DIAG_STATE,
  EMPLOYEES, PAYROLL, WORKING_DAYS, PIECE_RULES, BONUS_PENALTY_LOG,
});
