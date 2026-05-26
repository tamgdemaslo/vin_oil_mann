/* eslint-disable */
// @ts-nocheck
"use client";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

// ====================================================================
//  data.jsx — все мок-данные сайта
// ====================================================================

const MASTERS = [
  {
    id: 'lobov',
    name: 'Максим Лобов',
    role: 'Мастер по замене масла',
    since: 2023,
    swaps: 4217,
    quote: '«Делаю то, для чего был рожден. Меняю масло.»',
    city: 'Калининград',
    helmet: 'stripes',
  },
  {
    id: 'voitov',
    name: 'Илья Елисеенко',
    role: 'Директор',
    since: 2024,
    swaps: 1850,
    quote: '«Скажу прямо, что нашёл. Покажу. Объясню. Дальше — ваше решение.»',
    city: 'Калининград',
    helmet: 'split',
  },
  {
    id: 'lebedev',
    name: 'Денис Духненко',
    role: 'Управляющий',
    since: 2024,
    swaps: 2040,
    quote: '«Аккуратность — это когда фильтр стоит ровно, прокладка целая, болт затянут.»',
    city: 'Калининград',
    helmet: 'arrow',
  },
  {
    id: 'kosov',
    name: 'Вадим Бигожин',
    role: 'Мастер-приемщик',
    since: 2023,
    swaps: 6100, // clients met
    swapsLabel: 'клиентов',
    quote: '«Здравствуйте, проходите в зону ожидания. Чай, кофе?»',
    city: 'Калининград',
    helmet: 'star',
  },
];

const DEMO_OILS = [
  {
    id: 'shell-helix-ultra-5w40',
    brand: 'Shell',
    line: 'Helix Ultra',
    visc: '5W-40',
    spec: 'API SP / ACEA A3/B4',
    type: 'Бензин · Дизель',
    volume: '4 л',
    base: 'PurePlus (синтетика)',
    price: 4990,
    workPrice: 0,
    badge: 'Чемпион Ле-Мана',
    note: 'Та самая, на которой Ferrari ездит в Ле-Мане.',
    color: '#C2410C',
    stock: 24,
  },
  {
    id: 'shell-helix-ultra-0w40',
    brand: 'Shell',
    line: 'Helix Ultra',
    visc: '0W-40',
    spec: 'API SN / ACEA A3/B4',
    type: 'Бензин · Холодный пуск',
    volume: '4 л',
    base: 'PurePlus (синтетика)',
    price: 5690,
    workPrice: 0,
    note: 'Для машин, которые ночуют на улице.',
    color: '#C2410C',
    stock: 12,
  },
  {
    id: 'mobil-1-esp-5w30',
    brand: 'Mobil',
    line: 'Mobil 1 ESP',
    visc: '5W-30',
    spec: 'API SN / ACEA C3 / MB 229.51',
    type: 'Бензин · Дизель с DPF',
    volume: '4 л',
    base: 'Полная синтетика',
    price: 5290,
    workPrice: 0,
    badge: 'OEM рекомендация',
    note: 'Заводская спецификация BMW LL-04 и MB 229.51.',
    color: '#1A4480',
    stock: 18,
  },
  {
    id: 'mobil-1-0w20',
    brand: 'Mobil',
    line: 'Mobil 1',
    visc: '0W-20',
    spec: 'API SP / ILSAC GF-6',
    type: 'Бензин · Гибрид',
    volume: '4 л',
    base: 'Полная синтетика',
    price: 5590,
    workPrice: 0,
    note: 'Для современных гибридов и Lexus/Toyota.',
    color: '#1A4480',
    stock: 9,
  },
  {
    id: 'zic-x9-ls-5w30',
    brand: 'ZIC',
    line: 'X9 LS',
    visc: '5W-30',
    spec: 'API SP / ACEA C3',
    type: 'Бензин · Дизель',
    volume: '4 л',
    base: 'YUBASE (синтетика)',
    price: 3890,
    workPrice: 0,
    note: 'Лучший баланс цена/качество для среднего сегмента.',
    color: '#7A2B2B',
    stock: 32,
  },
  {
    id: 'total-quartz-9000-5w40',
    brand: 'Total',
    line: 'Quartz 9000',
    visc: '5W-40',
    spec: 'API SN/CF / ACEA A3/B4',
    type: 'Бензин · Дизель',
    volume: '4 л',
    base: 'Синтетика',
    price: 4290,
    workPrice: 0,
    note: 'Французская классика для Peugeot, Citroën, Renault.',
    color: '#B43A2B',
    stock: 16,
  },
  {
    id: 'eurol-fluence-5w30',
    brand: 'Eurol',
    line: 'Fluence',
    visc: '5W-30',
    spec: 'API SN / ACEA A5/B5',
    type: 'Бензин',
    volume: '4 л',
    base: 'Синтетика',
    price: 4690,
    workPrice: 0,
    note: 'Голландское, для Ford EcoBoost и Volvo.',
    color: '#0E4FA0',
    stock: 7,
  },
  {
    id: 'lukoil-genesis-armortech-5w40',
    brand: 'Lukoil',
    line: 'Genesis Armortech',
    visc: '5W-40',
    spec: 'API SN/CF / ACEA A3/B4',
    type: 'Бензин · Дизель',
    volume: '4 л',
    base: 'Синтетика',
    price: 2990,
    workPrice: 0,
    note: 'Российский синтез, на который дают допуски MB и VW.',
    color: '#CC0000',
    stock: 41,
  },
  {
    id: 'bardahl-xtc-c60-5w40',
    brand: 'Bardahl',
    line: 'XTC C60',
    visc: '5W-40',
    spec: 'API SN / ACEA A3/B4',
    type: 'Бензин · Дизель',
    volume: '4 л',
    base: 'Синтетика + фуллерен',
    price: 5790,
    workPrice: 0,
    badge: 'C60 fullerene',
    note: 'С молекулой фуллерена. Для машин, которым уже за 150 000 км.',
    color: '#D08A2C',
    stock: 6,
  },
  {
    id: 'elf-evolution-700-sti-10w40',
    brand: 'ELF',
    line: 'Evolution 700 STI',
    visc: '10W-40',
    spec: 'API SL/CF / ACEA A3/B4',
    type: 'Бензин · Дизель',
    volume: '4 л',
    base: 'Полусинтетика',
    price: 2690,
    workPrice: 0,
    note: 'Для машин с пробегом, где синтетика «потеет».',
    color: '#003B7A',
    stock: 28,
  },
];

var OILS = [];

const CASES = [
  {
    id: 'bmw-x5-f15-zf8hp',
    title: 'BMW X5 F15 — полная замена ATF в АКПП ZF 8HP',
    year: 2017,
    mileage: '146 800 км',
    fluid: 'ZF LifeguardFluid 8',
    duration: '2 ч 40 мин',
    cost: 28400,
    summary: 'Машину привезли с толчками на 2–3 передаче. После полной аппаратной замены и обнуления адаптаций — коробка работает как новая.',
    hero: 'bmw',
    palette: ['#1c1c1c', '#3d3d3d', '#C2410C'],
    body: [
      {h: 'Что было', t: 'Клиент жаловался на толчки при переключении 2→3 на холодную и дёрганья при остановке. Сообщение «коробка перегрета» дважды загоралось летом.'},
      {h: 'Что сделали', t: 'Сняли поддон, заменили внутренний фильтр и прокладку. Через тестовый стенд прогнали 14 литров новой жидкости ZF LifeguardFluid 8 до прозрачной отработки. Обнулили адаптации через ISTA.'},
      {h: 'Результат', t: 'Тестовая поездка 45 км — толчки ушли. Гарантия на работу — 6 месяцев или 15 000 км.'},
    ],
    spec: [
      {k: 'Машина', v: 'BMW X5 F15 xDrive30d'},
      {k: 'Двигатель', v: 'N57D30 (3.0 дизель)'},
      {k: 'Пробег на момент', v: '146 800 км'},
      {k: 'Коробка', v: 'ZF 8HP70'},
      {k: 'Жидкость', v: 'ZF LifeguardFluid 8 — 9.5 л'},
      {k: 'Фильтр', v: 'ZF 0501 219 824 (оригинал)'},
      {k: 'Прокладка поддона', v: 'ZF 0501 216 243'},
      {k: 'Время работы', v: '2 ч 40 мин'},
      {k: 'Сумма', v: '28 400 ₽'},
    ],
  },
  {
    id: 'audi-q7-dl382',
    title: 'Audi Q7 — замена масла в DSG DL382',
    year: 2019,
    mileage: '102 400 км',
    fluid: 'VAG G 060 162',
    duration: '1 ч 50 мин',
    cost: 19800,
    summary: 'Плановая замена на 100 тыс. Машина чистая, без жалоб — превентивная процедура по регламенту.',
    hero: 'audi',
    palette: ['#1a1a1a', '#2A2A2A', '#C2410C'],
    body: [
      {h: 'Что было', t: 'Клиент пришёл по регламенту: 100 000 км — пора. Жалоб на коробку нет, но владелец делает всё по графику.'},
      {h: 'Что сделали', t: 'Слили масло самотёком, сняли поддон, заменили фильтр (оригинал VAG), залили 7.2 л оригинальной жидкости G 060 162. Прокатились до рабочей температуры, скорректировали уровень по щупу-приёмнику.'},
      {h: 'Результат', t: 'Коробка чиста, передачи переключаются мягко. Следующая замена — на 200 000 км.'},
    ],
    spec: [
      {k: 'Машина', v: 'Audi Q7 4M'},
      {k: 'Двигатель', v: '3.0 TDI (CRTC)'},
      {k: 'Пробег', v: '102 400 км'},
      {k: 'Коробка', v: 'DL382 (DSG 8-ст.)'},
      {k: 'Масло', v: 'VAG G 060 162 A2 — 7.2 л'},
      {k: 'Фильтр', v: '0BH 325 183 B (оригинал)'},
      {k: 'Время работы', v: '1 ч 50 мин'},
      {k: 'Сумма', v: '19 800 ₽'},
    ],
  },
  {
    id: 'mercedes-e213-9gtronic',
    title: 'Mercedes E-class W213 — 9G-Tronic, плановая замена',
    year: 2020,
    mileage: '78 500 км',
    fluid: 'MB 236.17',
    duration: '1 ч 30 мин',
    cost: 17200,
    summary: 'Плановое обслуживание АКПП 725.0 на 80 тыс. Машина чистая, ничего лишнего.',
    hero: 'mb',
    palette: ['#1c1c1c', '#3D3D3D', '#C2410C'],
    body: [
      {h: 'Что было', t: 'По регламенту MB — замена ATF в АКПП каждые 80 000 км. Машина ездит в основном по городу, режим спокойный.'},
      {h: 'Что сделали', t: 'Сняли поддон с интегрированным фильтром, заменили на оригинальный A 725 270 02 00. Залили 9.5 л Fuchs Titan ATF 9G со спецификацией MB 236.17. Корректировка через XENTRY.'},
      {h: 'Результат', t: 'Коробка переключается едва ощутимо. Документы и наряд-заказ на руках клиента.'},
    ],
    spec: [
      {k: 'Машина', v: 'Mercedes-Benz E 220 d (W213)'},
      {k: 'Двигатель', v: 'OM 654 (2.0 дизель)'},
      {k: 'Пробег', v: '78 500 км'},
      {k: 'Коробка', v: '725.0 (9G-Tronic)'},
      {k: 'Масло', v: 'Fuchs Titan ATF 9G — 9.5 л'},
      {k: 'Спецификация', v: 'MB-Approval 236.17'},
      {k: 'Время работы', v: '1 ч 30 мин'},
      {k: 'Сумма', v: '17 200 ₽'},
    ],
  },
  {
    id: 'porsche-cayenne-aisin',
    title: 'Porsche Cayenne — Aisin TR-80SD, полная замена',
    year: 2016,
    mileage: '189 300 км',
    fluid: 'VAG G 055 540',
    duration: '3 ч 10 мин',
    cost: 32100,
    summary: 'Машина с пробегом, владелец понимает что делает. Полный аппаратный цикл с двойной промывкой.',
    hero: 'porsche',
    palette: ['#0e0e0e', '#3D3D3D', '#C2410C'],
    body: [
      {h: 'Что было', t: 'Cayenne 958 с пробегом под 190 тыс. Жалоб на коробку нет, но владелец хочет «прожить ещё столько же». Запрос — полная замена с промывкой.'},
      {h: 'Что сделали', t: 'Промыли систему через аппарат, потом залили чистые 13 литров. Поменяли поддон в сборе (фильтр интегрирован). Обнулили адаптации.'},
      {h: 'Результат', t: 'Машина едет ровнее, реакция на педаль чётче. Гарантия — 6 мес. / 15 000 км.'},
    ],
    spec: [
      {k: 'Машина', v: 'Porsche Cayenne 958 S'},
      {k: 'Двигатель', v: '3.6 V6 (M55.01)'},
      {k: 'Пробег', v: '189 300 км'},
      {k: 'Коробка', v: 'Aisin TR-80SD'},
      {k: 'Масло', v: 'VAG G 055 540 A2 — 13.0 л'},
      {k: 'Поддон', v: '95532102510 (в сборе)'},
      {k: 'Время работы', v: '3 ч 10 мин'},
      {k: 'Сумма', v: '32 100 ₽'},
    ],
  },
];

// Сервисы первого экрана
const SERVICES = [
  { k: '01', title: 'Замена моторного масла', t: 'Покупаете масло у нас — замена бесплатно. Любая марка из ассортимента.', time: '25–40 мин' },
  { k: '02', title: 'Замена ATF / DSG / CVT', t: 'Полная или частичная замена в АКПП. Промывка через стенд, обнуление адаптаций.', time: '1.5–3 ч' },
  { k: '03', title: 'Замена антифриза', t: 'Полная замена ОЖ с промывкой системы. Оригинальные жидкости.', time: '30–50 мин' },
  { k: '04', title: 'Тормозная жидкость', t: 'Замена через прокачку всех контуров. DOT 4 / DOT 5.1.', time: '30 мин' },
  { k: '05', title: 'Замена фильтров', t: 'Воздушный, салонный, топливный. Только оригинал или Mann/Mahle.', time: '10–20 мин' },
  { k: '06', title: 'Диагностика 14 пунктов', t: 'Подвеска, тормоза, утечки, ремни, аккумулятор. Письменный отчёт.', time: '40 мин' },
];

// VIN demo lookup
const VIN_DEMO = {
  vin: 'WBABA91070AL55203',
  brand: 'BMW',
  model: 'X5 xDrive40i',
  generation: 'G05',
  year: 2021,
  engine: 'B58B30M1 (3.0 бензин, 333 л.с.)',
  oilCapacity: '6.5 л',
  oilSpec: 'BMW Longlife-01 / 5W-30',
  filter: 'BMW 11428583898',
  airFilter: 'MANN C 29 005',
  cabinFilter: 'MANN FP 32 001',
  drainPlug: 'M14×1.5, шайба 11137548021',
  recommended: 'bardahl-xtc-c60-5w40',
  alternatives: ['eurol-fluence-5w30', 'mobil-1-esp-5w30', 'shell-helix-ultra-5w40', 'zic-x9-ls-5w30'],
};

// History data for "personal account"
const ACCOUNT = {
  user: 'Алексей',
  car: {
    plate: 'А 247 МК 39',
    name: 'BMW X5 xDrive40i (G05)',
    year: 2021,
    vin: 'WBABA91070AL55203',
    mileage: 47820,
  },
  history: [
    {date: '14.05.2026', km: 47820, type: 'Замена моторного масла', oil: 'Mobil 1 ESP 5W-30', sum: 5290, master: 'Максим Лобов'},
    {date: '02.11.2025', km: 32100, type: 'Замена моторного масла + фильтров', oil: 'Mobil 1 ESP 5W-30', sum: 7140, master: 'Максим Лобов'},
    {date: '18.04.2025', km: 17400, type: 'Замена моторного масла', oil: 'Shell Helix Ultra 5W-40', sum: 4990, master: 'Никита Лебедев'},
    {date: '03.10.2024', km: 4100, type: 'Первая замена + диагностика 14 пунктов', oil: 'Mobil 1 ESP 5W-30', sum: 6290, master: 'Максим Лобов'},
  ],
  nextChange: {km: 62820, date: '14.05.2027'},
};



// ====================================================================
//  ui.jsx — общие UI-примитивы и атомы
// ====================================================================

/* ---------- Money / format ---------- */
const fmtMoney = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const fmtNum = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n));

/* ---------- Logo ---------- */
function Logo({ variant = 'light', monogram = false, h = 28, style = {} }) {
  const src = monogram
    ? (variant === 'rust' ? '/brand/monogram-rust.svg'
       : variant === 'light' ? '/brand/monogram-light.svg'
       : variant === 'dark' ? '/brand/monogram-dark.svg'
       : '/brand/monogram-black.svg')
    : (variant === 'light' ? '/brand/logo-wordmark-light.svg'
       : variant === 'dark' ? '/brand/logo-wordmark-dark.svg'
       : variant === 'white' ? '/brand/logo-wordmark-white.svg'
       : '/brand/logo-wordmark-black.svg');
  return <img src={src} alt="Там где масло." style={{height: h, width: 'auto', display: 'block', ...style}} />;
}

/* ---------- F1-style stylized racer portrait ---------- */
function F1Portrait({ helmet = 'stripes', mood = 'cold', label, sublabel }) {
  // Stylized portrait: B&W silhouette of a 70s F1 racer in open-face helmet + balaclava.
  // Different `helmet` styles add accent stripes.
  const accents = {
    stripes: ['#C2410C', '#F5F2ED', '#3D3D3D'],
    split:   ['#1A4480', '#F5F2ED', '#C2410C'],
    arrow:   ['#3D3D3D', '#C2410C', '#F5F2ED'],
    star:    ['#8B6F47', '#F5F2ED', '#C2410C'],
  }[helmet] || ['#C2410C', '#F5F2ED', '#3D3D3D'];

  const bg = mood === 'cold' ? '#0e0e0e' : '#1a1614';
  const skin = '#bfb6a8';
  const skinDark = '#7a7268';

  return (
    <div style={{position: 'relative', width: '100%', height: '100%', background: bg, overflow: 'hidden'}}>
      {/* moody radial glow (workshop hex light) */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 38%, rgba(194,65,12,0.18), transparent 55%), radial-gradient(circle at 70% 80%, rgba(168,90,60,0.12), transparent 50%)',
      }} />
      <svg viewBox="0 0 400 520" preserveAspectRatio="xMidYMid slice" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
        <defs>
          <filter id={`grain-${helmet}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.45 0" />
          </filter>
          <linearGradient id={`shadow-${helmet}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.7" />
          </linearGradient>
        </defs>

        {/* Shoulders / racing suit */}
        <path d="M 40 520 L 40 420 Q 70 380 130 372 L 170 360 L 230 360 L 270 372 Q 330 380 360 420 L 360 520 Z" fill="#0a0a0a" />
        <path d="M 40 520 L 40 420 Q 70 380 130 372 L 170 360 L 230 360 L 270 372 Q 330 380 360 420 L 360 520 Z" fill="url(#shadow-${helmet})" />
        {/* Collar zipper */}
        <line x1="200" y1="372" x2="200" y2="520" stroke="#222" strokeWidth="2" />
        {/* Sponsor patch */}
        <rect x="120" y="430" width="50" height="14" fill="#F5F2ED" opacity="0.85" />
        <text x="145" y="441" fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#0a0a0a" textAnchor="middle" fontWeight="700">TGM</text>
        {/* checker piping on shoulder */}
        <g>
          {[0,1,2,3,4,5,6,7].map(i => (
            <rect key={i} x={250+i*10} y="410" width="10" height="6" fill={i%2 ? '#F5F2ED' : '#0a0a0a'} />
          ))}
        </g>

        {/* Neck */}
        <path d="M 170 360 L 170 320 L 230 320 L 230 360 Z" fill={skinDark} />

        {/* Balaclava (fire suit hood) */}
        <path d="M 130 340 Q 110 250 140 190 Q 160 130 200 120 Q 240 130 260 190 Q 290 250 270 340 L 270 360 L 240 360 L 240 330 L 160 330 L 160 360 L 130 360 Z" fill="#1a1a1a" />

        {/* Face area (visible through opening) */}
        <ellipse cx="200" cy="240" rx="42" ry="52" fill={skin} />
        {/* shadow on face */}
        <path d="M 160 260 Q 180 290 200 290 Q 220 290 240 260 L 240 280 Q 220 305 200 305 Q 180 305 160 280 Z" fill={skinDark} opacity="0.6" />
        {/* eyes - just narrow strips for serious stare */}
        <rect x="172" y="232" width="20" height="3" fill="#0a0a0a" />
        <rect x="208" y="232" width="20" height="3" fill="#0a0a0a" />
        {/* mouth - line */}
        <line x1="190" y1="270" x2="210" y2="270" stroke="#3a3028" strokeWidth="1.5" />
        {/* nose hint */}
        <path d="M 198 244 L 200 260 L 204 261" stroke={skinDark} strokeWidth="1" fill="none" />

        {/* Open-face helmet shell over balaclava */}
        <path d="M 124 234 Q 120 130 200 110 Q 280 130 276 234 L 276 252 Q 260 240 240 240 L 160 240 Q 140 240 124 252 Z" fill={accents[2]} />
        {/* Visor opening dark */}
        <path d="M 156 226 Q 158 178 200 168 Q 242 178 244 226 Z" fill="#0a0a0a" />
        {/* Helmet centerline accents */}
        {helmet === 'stripes' && (
          <>
            <rect x="195" y="110" width="10" height="130" fill={accents[0]} />
            <rect x="184" y="110" width="6" height="130" fill={accents[1]} />
            <rect x="210" y="110" width="6" height="130" fill={accents[1]} />
          </>
        )}
        {helmet === 'split' && (
          <>
            <path d="M 200 110 L 200 240 L 124 240 Q 120 170 200 110 Z" fill={accents[0]} />
            <path d="M 130 200 Q 200 195 270 200" stroke={accents[2]} strokeWidth="3" fill="none" />
          </>
        )}
        {helmet === 'arrow' && (
          <>
            <path d="M 130 240 L 200 130 L 270 240 L 240 240 L 200 180 L 160 240 Z" fill={accents[1]} />
          </>
        )}
        {helmet === 'star' && (
          <>
            <circle cx="200" cy="170" r="18" fill={accents[2]} />
            <text x="200" y="178" textAnchor="middle" fontFamily="Oswald, sans-serif" fontSize="22" fontWeight="700" fill="#0a0a0a">★</text>
          </>
        )}
        {/* Visor strap */}
        <rect x="124" y="248" width="152" height="6" fill="#0a0a0a" />

        {/* Helmet bottom shadow */}
        <path d="M 124 234 Q 120 130 200 110 Q 280 130 276 234 L 276 252 Q 260 240 240 240 L 160 240 Q 140 240 124 252 Z" fill="url(#shadow-${helmet})" />

        {/* Grain overlay */}
        <rect width="100%" height="100%" filter={`url(#grain-${helmet})`} opacity="0.55" />
      </svg>

      {/* Big year stamp top-left */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 14,
        color: '#F5F2ED', letterSpacing: '0.06em', opacity: 0.9,
      }}>
        76
        <div style={{fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#9A9A9A', letterSpacing: '0.16em', marginTop: 2}}>KGD · OIL</div>
      </div>

      {/* corner ID */}
      <div style={{
        position: 'absolute', bottom: 14, right: 16,
        fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
        color: 'rgba(245,242,237,0.7)', letterSpacing: '0.1em',
      }}>
        N°{(label || '01').toString().padStart(3, '0')}
      </div>

      {/* optional bottom label */}
      {sublabel && (
        <div style={{
          position: 'absolute', bottom: 14, left: 16, right: 60,
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
          color: 'rgba(245,242,237,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>{sublabel}</div>
      )}
    </div>
  );
}

/* ---------- "Сар week" — машина в стиле постера ---------- */
function CarPlate({ palette = ['#1c1c1c', '#3d3d3d', '#C2410C'], label, sub, kind = 'bmw' }) {
  const carPaths = {
    bmw: 'M 50 200 L 80 170 L 130 160 L 200 150 L 280 150 L 340 165 L 380 195 L 390 200 L 380 215 L 370 215 L 360 230 Q 340 240 320 230 L 310 215 L 130 215 L 120 230 Q 100 240 80 230 L 70 215 L 60 215 Z',
    audi: 'M 50 200 L 80 165 L 140 152 L 210 145 L 290 148 L 350 165 L 385 195 L 390 200 L 385 215 L 370 215 L 360 232 Q 340 240 320 230 L 312 215 L 132 215 L 120 232 Q 100 240 80 230 L 70 215 L 60 215 Z',
    mb: 'M 50 200 L 80 172 L 130 160 L 200 152 L 280 152 L 340 168 L 380 198 L 390 200 L 380 218 L 370 218 L 360 232 Q 340 240 320 230 L 312 218 L 130 218 L 120 232 Q 100 240 80 230 L 70 218 L 60 218 Z',
    porsche: 'M 50 205 L 90 170 L 160 155 L 240 150 L 300 155 L 350 175 L 385 205 L 390 210 L 385 220 L 370 220 L 360 232 Q 340 240 320 230 L 312 220 L 132 220 L 120 232 Q 100 240 80 230 L 70 220 L 60 220 Z',
  };
  return (
    <div style={{position: 'relative', width: '100%', height: '100%', background: palette[0], overflow: 'hidden'}}>
      <div style={{position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 50% 80%, ${palette[2]}30, transparent 60%)`,
      }} />
      <svg viewBox="0 0 440 280" preserveAspectRatio="xMidYMid slice" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
        <defs>
          <filter id={`g-${kind}`}>
            <feTurbulence baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.4 0" />
          </filter>
          <linearGradient id={`hood-${kind}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={palette[1]} stopOpacity="0.4" />
            <stop offset="1" stopColor="#000" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        {/* ground */}
        <rect x="0" y="232" width="440" height="48" fill="#000" />
        <line x1="0" y1="232" x2="440" y2="232" stroke={palette[2]} strokeWidth="1" />
        {/* hex tile glow */}
        <g opacity="0.06" stroke={palette[2]} fill="none">
          {Array.from({length: 12}).map((_, i) => (
            <polygon key={i} points={`${20+i*36},20 ${36+i*36},10 ${52+i*36},20 ${52+i*36},38 ${36+i*36},48 ${20+i*36},38`} />
          ))}
        </g>
        {/* car silhouette - front 3/4 */}
        <path d={carPaths[kind] || carPaths.bmw} fill={palette[1]} />
        <path d={carPaths[kind] || carPaths.bmw} fill={`url(#hood-${kind})`} />
        {/* windshield */}
        <path d="M 150 162 L 200 156 L 270 156 L 305 168 L 290 195 L 165 195 Z" fill="#0a0a0a" />
        <path d="M 165 165 L 200 159 L 230 159" stroke={palette[2]} strokeWidth="1" fill="none" opacity="0.7" />
        {/* headlight */}
        <ellipse cx="358" cy="195" rx="22" ry="8" fill="#F5F2ED" opacity="0.85" />
        <ellipse cx="358" cy="195" rx="14" ry="4" fill={palette[2]} opacity="0.9" />
        {/* wheel */}
        <circle cx="100" cy="222" r="22" fill="#0a0a0a" />
        <circle cx="100" cy="222" r="22" fill="none" stroke="#3a3a3a" strokeWidth="1.5" />
        <circle cx="100" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" strokeWidth="1" />
        <circle cx="340" cy="222" r="22" fill="#0a0a0a" />
        <circle cx="340" cy="222" r="22" fill="none" stroke="#3a3a3a" strokeWidth="1.5" />
        <circle cx="340" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" strokeWidth="1" />
        {/* number on door */}
        <circle cx="220" cy="195" r="14" fill={palette[2]} opacity="0.85" />
        <text x="220" y="200" textAnchor="middle" fontFamily="Oswald, sans-serif" fontSize="18" fontWeight="700" fill="#0a0a0a">76</text>
        <rect width="100%" height="100%" filter={`url(#g-${kind})`} opacity="0.4" />
      </svg>
      <div style={{position: 'absolute', top: 14, left: 16, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 12, color: '#F5F2ED', letterSpacing: '0.08em'}}>
        76 · KGD
      </div>
      {label && (
        <div style={{position: 'absolute', bottom: 12, left: 16, fontFamily: 'Oswald, sans-serif', fontWeight: 700, color: '#F5F2ED', fontSize: 20, lineHeight: 1, textTransform: 'uppercase'}}>
          {label}
          {sub && <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 400, color: '#9A9A9A', letterSpacing: '0.12em', marginTop: 6}}>{sub}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- Free-change banner badge ---------- */
function FreeChangeBadge({ size = 'md', style = {} }) {
  const px = size === 'lg' ? 14 : size === 'sm' ? 10 : 12;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: `${px-4}px ${px}px`, background: '#C2410C', color: '#F5F2ED',
      fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: px-2, letterSpacing: '0.04em',
      ...style,
    }}>
      <span style={{display: 'inline-block', width: 6, height: 6, background: '#F5F2ED', borderRadius: '50%'}} />
      ЗАМЕНА ВКЛЮЧЕНА
    </div>
  );
}

/* ---------- Tape (mono ticker) ---------- */
function Tape({ items, kind = 'paper' }) {
  return (
    <div style={{
      background: kind === 'rust' ? '#C2410C' : kind === 'paper' ? '#F5F2ED' : '#0a0a0a',
      color: kind === 'paper' ? '#0a0a0a' : '#F5F2ED',
      overflow: 'hidden', position: 'relative',
      borderTop: '1px solid rgba(0,0,0,0.1)', borderBottom: '1px solid rgba(0,0,0,0.1)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 32, padding: '10px 0',
        whiteSpace: 'nowrap', animation: 'tape 60s linear infinite',
        fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        {[...items, ...items, ...items].map((s, i) => (
          <span key={i} style={{display: 'inline-flex', alignItems: 'center', gap: 32}}>
            {s}
            <span style={{display: 'inline-block', width: 8, height: 8, background: kind === 'paper' ? '#C2410C' : '#F5F2ED', borderRadius: '50%'}} />
          </span>
        ))}
      </div>
      <style>{`@keyframes tape { from{transform:translateX(0)} to{transform:translateX(-33.333%)} }`}</style>
    </div>
  );
}

/* ---------- Section heading ---------- */
function SectionHead({ eyebrow, title, right, paper, num }) {
  return (
    <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 28, borderBottom: paper ? '1px solid var(--line-paper)' : '1px solid var(--line)', paddingBottom: 18}}>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 18}}>
        {num && <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--gray-2)', letterSpacing: '0.14em'}}>— {num}</div>}
        <div>
          {eyebrow && <div className="t-eyebrow" style={{marginBottom: 10}}>{eyebrow}</div>}
          <h2 className="t-headline" style={{margin: 0, fontSize: 'clamp(28px, 4vw, 48px)', lineHeight: 1}}>{title}</h2>
        </div>
      </div>
      {right && <div style={{flexShrink: 0}}>{right}</div>}
    </div>
  );
}

/* ---------- Router context ---------- */
const RouterCtx = createContext(null);
function useRoute() { return useContext(RouterCtx); }
function Link({ to, children, ...rest }) {
  const r = useRoute();
  return (
    <a href={'#' + to} onClick={e => { e.preventDefault(); r.go(to); }} {...rest}>{children}</a>
  );
}

/* ---------- expose ---------- */


// ====================================================================
//  api.jsx — тонкий клиент для backend API
// ====================================================================

const API_BASE = '';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.error?.message || 'API request failed');
    error.details = data?.error?.details || null;
    error.status = response.status;
    throw error;
  }

  return data;
}

const apiGet = (path) => apiRequest(path);
const apiPost = (path, body) => apiRequest(path, {
  method: 'POST',
  body: JSON.stringify(body),
});



// ====================================================================
//  layout.jsx — Top navigation, Footer, page chrome
// ====================================================================

function TopBar() {
  const r = useRoute();
  const path = r.path;
  const nav = [
    {to: '/', label: 'Главная'},
    {to: '/vin', label: 'Подбор по VIN'},
    {to: '/shop', label: 'Магазин'},
    {to: '/cases', label: 'Кейсы'},
    {to: '/team', label: 'Команда'},
    {to: '/contacts', label: 'Контакты'},
  ];
  const active = (to) => to === '/' ? path === '/' : path.startsWith(to);
  return (
    <header style={{position: 'sticky', top: 0, zIndex: 20, background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--line)'}}>
      <div className="container" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 68}}>
        <Link to="/" style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <Logo variant="light" h={22} />
        </Link>
        <nav style={{display: 'flex', alignItems: 'center', gap: 28}}>
          {nav.map(n => (
            <Link key={n.to} to={n.to} style={{
              fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13,
              color: active(n.to) ? '#F5F2ED' : '#9A9A9A',
              borderBottom: active(n.to) ? '2px solid #C2410C' : '2px solid transparent',
              padding: '6px 0', letterSpacing: '0.02em', transition: 'color 120ms',
            }}>{n.label}</Link>
          ))}
        </nav>
        <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
          <Link to="/account" style={{display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9A9A9A', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em'}}>
            <span style={{display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#C2410C'}} />
            А 247 МК 39
          </Link>
          <Link to="/vin" className="btn sm rust">Записаться <span className="arr">→</span></Link>
        </div>
      </div>
      {/* Mini status strip */}
      <div className="container" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 30, borderTop: '1px solid var(--line)', fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#6B6B6B', letterSpacing: '0.12em', textTransform: 'uppercase'}}>
        <div style={{display: 'flex', gap: 22}}>
          <span>Калининград · Московский пр. 244 · Дачная 6В · Юрия Гагарина 116</span>
          <span>пн - выходной, вт-пт 09:00-19:00, сб-вск 10:00-17:00</span>
          <a href="tel:+79950545859" style={{color: '#9A9A9A', textDecoration: 'none'}}>+7 (995) 054-58-59</a>
        </div>
        <div style={{display: 'flex', gap: 22}}>
          <span><span style={{color: '#C2410C'}}>●</span> сегодня 4 свободных слота</span>
          <span>замена за 28 мин</span>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer style={{background: '#0a0a0a', color: '#F5F2ED', borderTop: '1px solid var(--line)'}}>
      {/* Map + hours block */}
      <div className="container client-footer__grid" style={{padding: '64px 24px 32px', display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.9fr', gap: 48}}>
        {/* Map placeholder */}
        <div className="client-footer__map">
          <div className="t-eyebrow" style={{marginBottom: 14}}>Как найти</div>
          <h3 className="t-headline" style={{fontSize: 28, margin: '0 0 18px'}}>Калининград,<br />Московский пр. 244<br />Дачная 6В<br />Юрия Гагарина 116</h3>
          <div style={{position: 'relative', aspectRatio: '16 / 9', background: '#161616', border: '1px solid var(--line)', overflow: 'hidden'}}>
            <svg viewBox="0 0 600 340" preserveAspectRatio="xMidYMid slice" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
              {/* schematic Kaliningrad-ish street grid */}
              <rect width="600" height="340" fill="#0e0e0e" />
              <g stroke="#1f1f1f" strokeWidth="1" fill="none">
                {Array.from({length: 14}).map((_, i) => <line key={'h'+i} x1="0" y1={i*26} x2="600" y2={i*26} />)}
                {Array.from({length: 24}).map((_, i) => <line key={'v'+i} x1={i*26} y1="0" x2={i*26} y2="340" />)}
              </g>
              {/* big avenues */}
              <line x1="0" y1="180" x2="600" y2="155" stroke="#3D3D3D" strokeWidth="6" />
              <line x1="320" y1="0" x2="280" y2="340" stroke="#3D3D3D" strokeWidth="5" />
              <line x1="0" y1="80" x2="600" y2="90" stroke="#2A2A2A" strokeWidth="4" />
              <line x1="100" y1="0" x2="80" y2="340" stroke="#2A2A2A" strokeWidth="3" />
              {/* river */}
              <path d="M -10 240 Q 150 220 280 250 T 620 240" stroke="#1f3a4a" strokeWidth="14" fill="none" />
              {/* pin */}
              <g transform="translate(310 170)">
                <circle r="40" fill="#C2410C" opacity="0.15" />
                <circle r="22" fill="#C2410C" opacity="0.3" />
                <circle r="8" fill="#C2410C" />
                <circle r="3" fill="#F5F2ED" />
              </g>
              <text x="354" y="170" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#F5F2ED" letterSpacing="2">TGM · ТОЧКА 01</text>
            </svg>
          </div>
        </div>

        {/* Hours */}
        <div className="client-footer__hours">
          <div className="t-eyebrow" style={{marginBottom: 14}}>Часы работы</div>
          <table style={{width: '100%', borderCollapse: 'collapse'}}>
            <tbody>
              {[
                ['Пн', 'Выходной'],
                ['Вт', '09:00 — 19:00'],
                ['Ср', '09:00 — 19:00'],
                ['Чт', '09:00 — 19:00'],
                ['Пт', '09:00 — 19:00'],
                ['Сб', '10:00 — 17:00'],
                ['Вс', '10:00 — 17:00'],
              ].map(([d, h], i) => (
                <tr key={i} style={{borderBottom: '1px dashed var(--line)'}}>
                  <td style={{padding: '11px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.12em'}}>{d}</td>
                  <td style={{padding: '11px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: h === 'Выходной' ? '#6B6B6B' : '#F5F2ED', textAlign: 'right'}}>{h}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop: 18, padding: '14px 16px', border: '1px solid #C2410C', display: 'flex', alignItems: 'center', gap: 12}}>
            <span style={{display: 'inline-block', width: 8, height: 8, background: '#C2410C', borderRadius: '50%'}} />
            <div>
              <div style={{fontSize: 12, color: '#F5F2ED', fontWeight: 600}}>Сейчас открыты</div>
              <div style={{fontSize: 11, color: '#9A9A9A', fontFamily: 'JetBrains Mono, monospace', marginTop: 2}}>До закрытия 4 ч 12 мин</div>
            </div>
          </div>
        </div>

        {/* Quick links + contact */}
        <div className="client-footer__contact">
          <div className="t-eyebrow" style={{marginBottom: 14}}>Прямой контакт</div>
          <a href="tel:+79950545859" style={{display: 'block', fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26, lineHeight: 1.05, marginBottom: 18, color: '#F5F2ED', textDecoration: 'none'}}>
            +7 (995)<br />054-58-59
          </a>
          <div style={{display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26}}>
            <a className="t-mono" style={{fontSize: 13, color: '#F5F2ED', display: 'inline-flex', alignItems: 'center', gap: 10}}>
              <span style={{display: 'inline-block', width: 4, height: 4, background: '#C2410C', borderRadius: '50%'}} /> tam-gde-maslo@mail.ru
            </a>
            <a className="t-mono" style={{fontSize: 13, color: '#F5F2ED', display: 'inline-flex', alignItems: 'center', gap: 10}}>
              <span style={{display: 'inline-block', width: 4, height: 4, background: '#C2410C', borderRadius: '50%'}} /> t.me/tamgdemaslo
            </a>
            <a className="t-mono" style={{fontSize: 13, color: '#F5F2ED', display: 'inline-flex', alignItems: 'center', gap: 10}}>
              <span style={{display: 'inline-block', width: 4, height: 4, background: '#C2410C', borderRadius: '50%'}} /> instagram/tamgdemaslo.kgd
            </a>
          </div>
          <Link to="/vin" className="btn rust" style={{width: '100%'}}>Записаться сейчас <span className="arr">→</span></Link>
        </div>
      </div>

      {/* Chequered separator */}
      <div className="chequered" />

      {/* Bottom bar */}
      <div className="container" style={{padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.1em', textTransform: 'uppercase'}}>
        <div style={{display: 'flex', gap: 32, alignItems: 'center'}}>
          <Logo variant="light" monogram h={32} />
          <span>© 2026 Там где масло. Калининград.</span>
        </div>
        <div style={{display: 'flex', gap: 24}}>
          <Link to="/privacy" style={{color: '#6B6B6B'}}>Политика конфиденциальности</Link>
          <Link to="/offer" style={{color: '#6B6B6B'}}>Договор оферты</Link>
          <span>ИП Елисеенко И. С. · ИНН 392302838630</span>
        </div>
      </div>
    </footer>
  );
}



// ====================================================================
//  pages/home.jsx — Главная
// ====================================================================

function HomeHero() {
  const r = useRoute();
  const [vin, setVin] = useState('');
  const submit = () => { r.go('/vin', { vin }); };
  const master = MASTERS[0];
  const [swapsCount, setSwapsCount] = useState(master.swaps);

  useEffect(() => {
    let cancelled = false;
    const loadStats = () => apiGet('/api/stats')
      .catch(() => fetch('http://127.0.0.1:3000/api/public/stats', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null))
      .then(data => {
        if (!cancelled && Number.isFinite(data?.replacementsCount)) setSwapsCount(data.replacementsCount);
      })
      .catch(() => {});
    loadStats();
    const id = window.setInterval(loadStats, 30000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  return (
    <section style={{background: '#0a0a0a', borderBottom: '1px solid var(--line)', position: 'relative', overflow: 'hidden'}} className="home-hero grain">
      {/* Top strip: F1 poster header */}
      <div style={{borderBottom: '1px solid var(--line)'}}>
        <div className="container" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9A9A9A'}}>
          <div style={{display: 'flex', gap: 24}}>
            <span><span style={{color: '#C2410C'}}>76</span> · KALININGRAD</span>
            <span>SERVICE STATION №01</span>
            <span>MOSKOVSKY 244</span>
          </div>
          <div style={{display: 'flex', gap: 24}}>
            <span>54.689°N · 20.493°E</span>
            <span>EST. 2023</span>
          </div>
        </div>
      </div>

      <div className="container home-hero__grid" style={{padding: '60px 24px 0', display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 56, alignItems: 'start'}}>
        {/* Left: poster headline & portrait */}
        <div className="home-hero__poster">
          <div style={{display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 26}}>
            <span className="t-eyebrow">Сервис уровня дилера</span>
            <span style={{flex: 1, height: 1, background: '#3D3D3D'}} />
            <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.16em'}}>N°01 / 04</span>
          </div>

          <h1 style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 700,
            fontSize: 'clamp(56px, 9vw, 132px)', lineHeight: 0.88,
            letterSpacing: '-0.02em', margin: 0, textTransform: 'uppercase',
            color: '#F5F2ED',
          }}>
            Лобов<span style={{color: '#C2410C'}}>.</span>
          </h1>
          <div style={{display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 10, marginBottom: 32}}>
            <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 400, fontSize: 22, letterSpacing: '0.04em', color: '#F5F2ED', textTransform: 'uppercase'}}>Мастер по замене масла</span>
            <span style={{flex: 1, height: 1, background: '#3D3D3D'}} />
            <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.12em'}}>с 2023 · {fmtNum(swapsCount)} замен</span>
          </div>

          {/* Portrait + quote */}
          <div className="home-hero__portrait-grid" style={{display: 'grid', gridTemplateColumns: '320px 1fr', gap: 28, alignItems: 'stretch'}}>
            <div style={{aspectRatio: '4/5', border: '1px solid var(--line)'}}>
              <F1Portrait helmet={master.helmet} label="1" sublabel={master.name} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'space-between'}}>
              <div>
                <blockquote style={{
                  margin: 0, fontFamily: 'Inter, sans-serif', fontWeight: 500,
                  fontSize: 22, lineHeight: 1.3, color: '#F5F2ED', letterSpacing: '-0.01em',
                  borderLeft: '3px solid #C2410C', paddingLeft: 18,
                }}>
                  «Делаю то, для чего был рожден. Меняю масло.»
                </blockquote>
              </div>
              <div className="home-hero__stats" style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 24}}>
                <div className="numpanel"><span className="k">Открыты с</span><span className="v">2023</span><span className="u">года</span></div>
                <div className="numpanel"><span className="k">Замен всего</span><span className="v">{fmtNum(swapsCount)}</span><span className="u">по сети</span></div>
                <div className="numpanel"><span className="k">Среднее время</span><span className="v">28</span><span className="u">минут</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: booking by VIN card */}
        <div className="home-hero__booking" style={{position: 'sticky', top: 110, alignSelf: 'start'}}>
          <div style={{background: '#F5F2ED', color: '#0a0a0a', padding: '28px 28px 26px', position: 'relative'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22}}>
              <div>
                <div className="t-eyebrow" style={{color: '#C2410C', marginBottom: 8}}>Запись по VIN</div>
                <div className="t-headline" style={{fontSize: 28, lineHeight: 1, letterSpacing: '-0.02em'}}>Подберём масло за 12 секунд</div>
              </div>
              <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, lineHeight: 0.9, color: '#0a0a0a'}}>01</div>
            </div>

            <label style={{display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em', color: '#6B6B6B', textTransform: 'uppercase', marginBottom: 8}}>VIN автомобиля · 17 знаков</label>
            <input
              className="inp paper mono"
              placeholder="WBABA91070AL55203"
              maxLength={17}
              value={vin}
              onChange={e => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{borderColor: '#0a0a0a', height: 58, fontSize: 16, letterSpacing: '0.14em'}}
            />
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.1em'}}>
              <span>{vin.length}/17</span>
              <a onClick={() => setVin(VIN_DEMO.vin)} style={{color: '#C2410C', cursor: 'pointer', textTransform: 'uppercase'}}>Попробовать с демо-VIN →</a>
            </div>

            <button className="btn rust lg" onClick={submit} style={{width: '100%', marginTop: 18, justifyContent: 'space-between'}}>
              Подобрать масло и слот
              <span className="arr">→</span>
            </button>

            <div style={{borderTop: '1px solid var(--line-paper)', marginTop: 22, paddingTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#3D3D3D'}}>
              <span style={{display: 'inline-flex', alignItems: 'center', gap: 8}}>
                <FreeChangeBadge size="sm" />
                при покупке масла у нас
              </span>
              <Link to="/shop" style={{color: '#C2410C', fontWeight: 600, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.1em'}}>Каталог →</Link>
            </div>

            {/* checker strip at bottom */}
            <div className="chequered invert" style={{position: 'absolute', left: 0, right: 0, bottom: -14}} />
          </div>

          {/* Quick-call alt */}
          <div style={{marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, border: '1px solid var(--line)'}}>
            <div style={{padding: '18px 20px', background: '#0a0a0a'}}>
              <div className="t-eyebrow muted" style={{marginBottom: 8}}>Связь</div>
              <a href="tel:+79950545859" style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 20, color: '#F5F2ED', textDecoration: 'none'}}>+7 (995) 054-58-59</a>
              <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', marginTop: 4, letterSpacing: '0.1em'}}>пн - выходной, вт-пт 09:00-19:00, сб-вск 10:00-17:00</div>
            </div>
            <div style={{padding: '18px 20px', background: '#0a0a0a'}}>
              <div className="t-eyebrow muted" style={{marginBottom: 8}}>Telegram</div>
              <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 20, color: '#F5F2ED'}}>@tamgdemaslo</div>
              <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', marginTop: 4, letterSpacing: '0.1em'}}>отвечаем за 2 минуты</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom strip */}
      <div style={{marginTop: 64}} className="chequered thin" />
    </section>
  );
}

/* Free change banner — full-bleed F1 poster strip */
function FreeChangeBanner() {
  return (
    <section className="free-change-banner" style={{background: '#C2410C', color: '#F5F2ED', position: 'relative', overflow: 'hidden'}}>
      <div className="container free-change-banner__grid" style={{padding: '54px 24px', display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr', alignItems: 'center', gap: 40}}>
        <div>
          <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12, opacity: 0.7}}>Правило дома · с 2023</div>
          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 92, lineHeight: 0.9}}>0 ₽</div>
        </div>
        <div>
          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(36px, 4.4vw, 64px)', lineHeight: 1, letterSpacing: '-0.01em', textTransform: 'uppercase'}}>
            Купили масло у нас<span style={{color: '#0a0a0a'}}>.</span><br />
            Замена включена<span style={{color: '#0a0a0a'}}>.</span>
          </div>
          <div style={{marginTop: 18, fontSize: 15, maxWidth: 540, opacity: 0.95, lineHeight: 1.5}}>
            Никаких звёздочек. Любая марка из ассортимента — Shell, Mobil, ZIC, Lukoil, Total, Bardahl. Работа мастера, прокладка, утилизация отработки — в цене масла.
          </div>
        </div>
        <div className="free-change-banner__saving" style={{justifySelf: 'end', textAlign: 'right'}}>
          <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 14, opacity: 0.7}}>средняя экономия</div>
          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 42, lineHeight: 1}}>1 200 — 1 800 ₽</div>
          <Link to="/shop" className="btn" style={{marginTop: 22, background: '#0a0a0a', color: '#F5F2ED', borderColor: '#0a0a0a'}}>
            Смотреть каталог <span className="arr">→</span>
          </Link>
        </div>
      </div>
      {/* race numbers as background */}
      <div style={{position: 'absolute', top: -20, right: -20, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 280, color: 'rgba(10,10,10,0.12)', lineHeight: 0.8, pointerEvents: 'none'}}>76</div>
    </section>
  );
}

/* Services 6-up */
function ServicesGrid() {
  return (
    <section style={{background: '#0a0a0a', padding: '90px 0'}}>
      <div className="container">
        <SectionHead eyebrow="Что делаем" title="Сервис, дисциплина, тишина." num="02 / 09" right={<Link to="/contacts" className="btn ghost sm">Полный прайс →</Link>} />
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
          {SERVICES.map(s => (
            <div key={s.k} style={{background: '#0a0a0a', padding: '32px 28px 28px', minHeight: 220, position: 'relative'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22}}>
                <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.16em', color: '#C2410C'}}>{s.k}</span>
                <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.12em', color: '#6B6B6B'}}>{s.time}</span>
              </div>
              <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26, lineHeight: 1.05, color: '#F5F2ED', textTransform: 'uppercase', letterSpacing: '-0.01em', marginBottom: 14}}>{s.title}</div>
              <div style={{fontSize: 13.5, color: '#9A9A9A', lineHeight: 1.55, maxWidth: 320}}>{s.t}</div>
              {s.k === '01' && (
                <div style={{position: 'absolute', top: 24, right: 28}}>
                  <FreeChangeBadge size="sm" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Cases preview */
function CasesPreview() {
  return (
    <section style={{background: '#0a0a0a', padding: '90px 0 110px', borderTop: '1px solid var(--line)'}}>
      <div className="container">
        <SectionHead eyebrow="Машины недели" title="Кейсы: масло в АКПП." num="03 / 09" right={<Link to="/cases" className="btn ghost sm">Все кейсы →</Link>} />
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28}}>
          {CASES.slice(0, 3).map((c, idx) => (
            <Link key={c.id} to={`/case/${c.id}`} style={{display: 'block'}}>
              <div className="card" style={{padding: 0, background: '#0a0a0a', overflow: 'hidden', height: '100%', cursor: 'pointer'}}>
                <div style={{aspectRatio: '16/10', borderBottom: '1px solid var(--line)'}}>
                  <CarPlate kind={c.hero} palette={c.palette} label={`N°${(idx+1).toString().padStart(2,'0')}`} sub={c.fluid} />
                </div>
                <div style={{padding: '22px 22px 24px'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em'}}>
                    <span>CASE / 0{idx+1}</span>
                    <span>{c.year} · {c.mileage}</span>
                  </div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, lineHeight: 1.1, color: '#F5F2ED', textTransform: 'uppercase', marginBottom: 14, letterSpacing: '-0.01em'}}>{c.title.split('—')[0].trim()}</div>
                  <div style={{fontSize: 13.5, color: '#9A9A9A', lineHeight: 1.55, marginBottom: 18}}>{c.summary}</div>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: '1px dashed var(--line)'}}>
                    <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED'}}>{fmtMoney(c.cost)}</span>
                    <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.12em'}}>ОТКРЫТЬ →</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Products preview */
function ProductsPreview() {
  const featuredIds = ['shell-helix-ultra-5w40', 'mobil-1-esp-5w30', 'zic-x9-ls-5w30', 'bardahl-xtc-c60-5w40'];
  const fixedPicks = OILS.filter(o => featuredIds.includes(o.id));
  const picks = fixedPicks.length ? fixedPicks : OILS.filter(o => o.stock > 0).slice(0, 4);
  return (
    <section style={{background: '#F5F2ED', color: '#0a0a0a', padding: '90px 0 110px', position: 'relative'}}>
      <div className="container">
        <SectionHead paper eyebrow="Что заливают" title="На что записываются чаще всего." num="04 / 09" right={<Link to="/shop" className="btn ghost dark sm">Весь каталог →</Link>} />
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22}}>
          {picks.map((o, idx) => <OilCardPaper key={o.id} oil={o} idx={idx} />)}
        </div>
      </div>
    </section>
  );
}

function OilCardPaper({ oil, idx }) {
  return (
    <Link to={`/product/${oil.id}`}>
      <div style={{
        background: '#FFFFFF', border: '1px solid #D9D3C5',
        padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', gap: 16,
        position: 'relative', height: '100%', cursor: 'pointer',
        transition: 'border-color 160ms, transform 160ms',
      }} onMouseEnter={e => e.currentTarget.style.borderColor = '#C2410C'} onMouseLeave={e => e.currentTarget.style.borderColor = '#D9D3C5'}>
        <div style={{position: 'absolute', top: 12, right: 12}}>
          <FreeChangeBadge size="sm" />
        </div>
        <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.16em', color: '#6B6B6B', textTransform: 'uppercase'}}>{(idx+1).toString().padStart(2,'0')} / {oil.brand.toUpperCase()}</div>

        {/* canister silhouette */}
        <div style={{height: 130, position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center'}}>
          <svg viewBox="0 0 120 130" width="100" height="130">
            <rect x="48" y="2" width="24" height="12" fill="#0a0a0a" />
            <path d="M 28 14 L 92 14 L 96 26 L 96 124 L 24 124 L 24 26 Z" fill={oil.color} />
            <path d="M 28 14 L 92 14 L 96 26 L 96 124 L 24 124 L 24 26 Z" fill="url(#sh)" />
            <rect x="30" y="50" width="60" height="40" fill="#F5F2ED" />
            <text x="60" y="68" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="14" fill="#0a0a0a">{oil.brand}</text>
            <text x="60" y="82" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontWeight="700" fontSize="11" fill="#0a0a0a">{oil.visc}</text>
            <defs>
              <linearGradient id="sh" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#000" stopOpacity="0.2" />
                <stop offset="0.5" stopColor="#000" stopOpacity="0" />
                <stop offset="1" stopColor="#000" stopOpacity="0.25" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div>
          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 20, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 6}}>{oil.brand} {oil.line}</div>
          <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.06em'}}>{oil.visc} · {oil.volume} · {oil.type}</div>
        </div>

        <div style={{marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 14, borderTop: '1px dashed #D9D3C5'}}>
          <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26, color: '#0a0a0a'}}>{fmtMoney(oil.price)}</span>
          <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.12em'}}>+ ЗАМЕНА</span>
        </div>
      </div>
    </Link>
  );
}

/* Big numbers */
function CifryBlock() {
  return (
    <section style={{background: '#0a0a0a', padding: '90px 0', borderTop: '1px solid var(--line)'}}>
      <div className="container">
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
          {[
            {k: 'Замен с открытия', v: '4 217', u: 'литров масла прошло через нас'},
            {k: 'Среднее время визита', v: '28', u: 'минут с подъёма до спуска'},
            {k: 'Пропущенных замен', v: '0', u: 'за 2025 год'},
            {k: 'Возвращаются второй раз', v: '74%', u: 'из тех, кто приехал в 2024'},
          ].map((s, i) => (
            <div key={i} style={{background: '#0a0a0a', padding: '40px 32px 36px', minHeight: 220, display: 'flex', flexDirection: 'column', justifyContent: 'space-between'}}>
              <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.16em', textTransform: 'uppercase'}}>{(i+1).toString().padStart(2,'0')} / 04</div>
              <div>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14}}>{s.k}</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 88, lineHeight: 0.9, color: '#F5F2ED', letterSpacing: '-0.02em'}}>{s.v}</div>
                <div style={{fontSize: 13, color: '#9A9A9A', marginTop: 16, maxWidth: 220, lineHeight: 1.4}}>{s.u}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Team preview */
function TeamPreview() {
  return (
    <section style={{background: '#0a0a0a', padding: '0 0 110px'}}>
      <div className="container">
        <SectionHead eyebrow="Наши люди" title="Конкретные люди, не персонал." num="05 / 09" right={<Link to="/team" className="btn ghost sm">Вся команда →</Link>} />
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22}}>
          {MASTERS.map((m, idx) => (
            <Link key={m.id} to="/team">
              <div style={{display: 'flex', flexDirection: 'column', gap: 18, cursor: 'pointer'}}>
                <div style={{aspectRatio: '4/5', border: '1px solid var(--line)'}}>
                  <F1Portrait helmet={m.helmet} label={idx+1} sublabel={m.role} />
                </div>
                <div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em', marginBottom: 8}}>N°0{idx+1}</div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, lineHeight: 1.1, textTransform: 'uppercase', color: '#F5F2ED', marginBottom: 6}}>{m.name}</div>
                  <div style={{fontSize: 12.5, color: '#9A9A9A', marginBottom: 10}}>{m.role}</div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.06em'}}>
                    с {m.since} · {fmtNum(m.swaps)} {m.swapsLabel || 'замен'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* What we don't do */
function WhatWeDont() {
  const items = [
    {n: '01', t: 'Шиномонтаж', d: 'Это другой бизнес и другая аудитория. Уважаем коллег, но не лезем.'},
    {n: '02', t: 'Скидочные акции «−30% на замену»', d: 'Если масло хорошее — оно стоит сколько стоит. Демпинг бьёт по качеству.'},
    {n: '03', t: 'Красно-жёлтую вывесочную эстетику', d: 'Никаких баннеров «АКЦИЯ!», восклицательных знаков и мультяшных маслёнок.'},
    {n: '04', t: 'Корпоративный канцелярит', d: 'Без «Уважаемый клиент, в связи с...». Пишем как разговариваем.'},
    {n: '05', t: 'Маскотов и капель масла с глазами', d: 'Бренд — это не персонаж. Бренд — это мастерская и люди в ней.'},
    {n: '06', t: 'Не возьмёмся за то, что не умеем', d: 'Если двигатель открывать — отправим к нашим коллегам по моторному цеху.'},
  ];
  return (
    <section style={{background: '#0a0a0a', padding: '90px 0 110px', borderTop: '1px solid var(--line)'}}>
      <div className="container">
        <SectionHead eyebrow="Принципы дома" title="Что мы не делаем." num="06 / 09" right={<span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.14em', textTransform: 'uppercase'}}>На случай если кто-то сомневается</span>} />
        <div className="what-we-dont__grid" style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
          {items.map(it => (
            <div key={it.n} style={{background: '#0a0a0a', padding: '32px 28px'}}>
              <div style={{display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14}}>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#6B6B6B', letterSpacing: '0.12em', marginTop: 4}}>{it.n}</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, lineHeight: 1.1, textTransform: 'uppercase', color: '#F5F2ED'}}>
                  <span style={{color: '#C2410C', marginRight: 8}}>—</span>{it.t}
                </div>
              </div>
              <div style={{fontSize: 13.5, color: '#9A9A9A', lineHeight: 1.55, paddingLeft: 32}}>{it.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Big closing CTA */
function ClosingCTA() {
  const r = useRoute();
  return (
    <section className="closing-cta" style={{background: '#F5F2ED', color: '#0a0a0a', padding: '110px 0', position: 'relative', overflow: 'hidden'}}>
      <div style={{position: 'absolute', top: -60, right: -100, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 520, color: 'rgba(10,10,10,0.05)', lineHeight: 0.8, pointerEvents: 'none', letterSpacing: '-0.04em'}}>76</div>
      <div className="container closing-cta__grid" style={{position: 'relative', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 56, alignItems: 'center'}}>
        <div className="closing-cta__copy">
          <div className="t-eyebrow" style={{marginBottom: 18}}>07 / 09 · Финал</div>
          <h2 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(48px, 7vw, 96px)', lineHeight: 0.92, margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
            Заезжай.<br />Не разводим<span style={{color: '#C2410C'}}>.</span>
          </h2>
          <div style={{marginTop: 24, fontSize: 18, lineHeight: 1.5, maxWidth: 580, color: '#3D3D3D'}}>
            Сервис уровня дилера. Атмосфера гаража. Свои пацаны на ресепшене. Без официоза, без скидочных акций, без «уважаемый клиент».
          </div>
          <div style={{display: 'flex', gap: 16, marginTop: 36}}>
            <Link to="/vin" className="btn rust lg">Записаться по VIN <span className="arr">→</span></Link>
            <Link to="/shop" className="btn ghost dark lg">Каталог масел</Link>
          </div>
        </div>
        <div className="closing-cta__portrait">
          <div style={{aspectRatio: '4/5', border: '1px solid #0a0a0a'}}>
            <F1Portrait helmet="arrow" label="07" sublabel="Заезжай · KGD · 76" />
          </div>
        </div>
      </div>
    </section>
  );
}

function HomePage() {
  return (
    <main>
      <HomeHero />
      <Tape kind="rust" items={[
        'Купил масло — замена бесплатно',
        'Калининград · 2023 → ∞',
        'Shell · Mobil · ZIC · Total · Bardahl · Lukoil',
        'Среднее время визита 28 минут',
      ]} />
      <ServicesGrid />
      <FreeChangeBanner />
      <CasesPreview />
      <ProductsPreview />
      <CifryBlock />
      <TeamPreview />
      <WhatWeDont />
      <ClosingCTA />
    </main>
  );
}



// ====================================================================
//  pages/vin.jsx — Подбор по VIN + запись
// ====================================================================

function VinPage() {
  const r = useRoute();
  const initial = (r.state && r.state.vin) || '';
  const [vin, setVin] = useState(initial);
  const [step, setStep] = useState(initial.length === 17 ? 2 : 1);
  const [chosenOilId, setChosenOilId] = useState(VIN_DEMO.recommended);
  const [slotIdx, setSlotIdx] = useState(0);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [slotGroups, setSlotGroups] = useState(() => buildFallbackSlotGroups());
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [bookingStatus, setBookingStatus] = useState('idle');
  const [bookingError, setBookingError] = useState('');
  const [appointment, setAppointment] = useState(null);
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupStatus, setLookupStatus] = useState('idle');
  const [lookupError, setLookupError] = useState('');
  const [selectedFilters, setSelectedFilters] = useState({
    oil: true,
    air: false,
    cabin: false,
  });

  const demoCar = {
    brand: VIN_DEMO.brand,
    model: VIN_DEMO.model,
    generation: VIN_DEMO.generation,
    year: VIN_DEMO.year,
    engine: VIN_DEMO.engine,
  };
  const demoMaintenance = {
    oilCapacity: VIN_DEMO.oilCapacity,
    oilSpec: VIN_DEMO.oilSpec,
    filter: VIN_DEMO.filter,
    oilCapacityLiters: parseLiters(VIN_DEMO.oilCapacity),
    filters: buildFallbackFilters(VIN_DEMO),
    drainPlug: VIN_DEMO.drainPlug,
  };
  const defaultRecommended = OILS.find(o => o.id === VIN_DEMO.recommended);
  const defaultAlternatives = VIN_DEMO.alternatives.map(id => OILS.find(o => o.id === id)).filter(Boolean);
  const lookupCar = lookupResult?.car || demoCar;
  const maintenance = lookupResult?.maintenance || demoMaintenance;
  const recommended = lookupResult?.recommended || defaultRecommended;
  const alternatives = lookupResult?.alternatives?.length ? lookupResult.alternatives : defaultAlternatives;
  const carTitle = `${lookupCar.brand || ''} ${lookupCar.model || ''}`.trim() || 'Автомобиль';
  const carShortModel = String(lookupCar.model || '').split(' ')[0] || lookupCar.model || 'машина';
  const allOils = [recommended, ...alternatives, ...OILS].filter(Boolean);
  const chosen = allOils.find(o => o.id === chosenOilId) || recommended;
  const lookupMessage = lookupError || lookupResult?.warning || '';
  const oilCalc = calculateOilByCapacity(chosen, maintenance);
  const recommendedOilCalc = calculateOilByCapacity(recommended, maintenance);
  const filterItems = buildFilterItems(maintenance);
  const selectedFilterItems = filterItems.filter(item => selectedFilters[item.key]);
  const filtersTotal = selectedFilterItems.reduce((sum, item) => sum + item.price, 0);
  const orderTotal = oilCalc.total + filtersTotal;

  const runVinLookup = async (value, { keepCurrentStep = false } = {}) => {
    const cleanVin = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanVin.length !== 17 || lookupStatus === 'loading') return;

    setVin(cleanVin);
    setLookupStatus('loading');
    setLookupError('');

    try {
      const result = await apiPost('/api/vin/lookup', { vin: cleanVin });
      setLookupResult(result);
      setChosenOilId(result.recommended?.id || VIN_DEMO.recommended);
      if (!keepCurrentStep) setStep(2);
    } catch (error) {
      setLookupResult(null);
      setChosenOilId(VIN_DEMO.recommended);
      setLookupError(error.message || 'Не удалось получить подбор с сервера. Показываем демо-результат.');
      if (!keepCurrentStep) setStep(2);
    } finally {
      setLookupStatus('idle');
    }
  };

  useEffect(() => {
    if (!initial || initial.length !== 17) return;
    setVin(initial);
    runVinLookup(initial, { keepCurrentStep: true });
  }, [initial]);

  useEffect(() => {
    if (step !== 4) return;

    let alive = true;
    setSlotsLoading(true);
    setBookingError('');

    apiGet('/api/appointments/slots')
      .then(data => {
        if (!alive) return;
        const availableSlots = (data.items || []).filter(s => s.available);
        setSlotGroups(groupApiSlots(availableSlots));
        setSlotIdx(0);
      })
      .catch(() => {
        if (!alive) return;
        setSlotGroups(buildFallbackSlotGroups());
        setBookingError('Не удалось обновить слоты с сервера. Показываем ближайшие варианты, но запись подтвердится только при связи с API.');
      })
      .finally(() => {
        if (alive) setSlotsLoading(false);
      });

    return () => { alive = false; };
  }, [step]);

  const flatSlots = slotGroups.flatMap(d => d.times.map(t => ({...t, d})));
  const selectedSlot = appointment?.slot || flatSlots[slotIdx] || null;
  const canBook = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10 && selectedSlot && bookingStatus !== 'sending';

  const submitAppointment = async () => {
    if (!canBook) {
      setBookingError('Заполни имя, телефон и выбери слот.');
      return;
    }

    setBookingStatus('sending');
    setBookingError('');

    try {
      const created = await apiPost('/api/appointments', {
        name,
        phone,
        vin,
        oilId: chosen.id,
        slotId: selectedSlot.id,
        comment: [
          `Масло: ${oilFullName(chosen)} ${chosen.visc}, объём заливки ${formatLiters(oilCalc.requiredLiters)}, упаковок ${oilCalc.packages} × ${formatLiters(oilCalc.packageLiters)}`,
          selectedFilterItems.length
            ? `Фильтры: ${selectedFilterItems.map(item => `${item.title} ${item.article}`).join('; ')}`
            : 'Фильтры не выбраны',
          `Итого: ${fmtMoney(orderTotal)}`,
        ].join('\n'),
      });
      setAppointment(created);
      setStep(5);
    } catch (error) {
      setBookingError(error.message || 'Не получилось создать запись.');
    } finally {
      setBookingStatus('idle');
    }
  };

  return (
    <main style={{background: '#0a0a0a', minHeight: '100vh', padding: '40px 0 100px'}}>
      <div className="container">
        {/* Stepper header */}
        <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 40, borderBottom: '1px solid var(--line)', paddingBottom: 24}}>
          <div className="t-eyebrow">Запись по VIN</div>
          <span style={{flex: 1, height: 1, background: '#3D3D3D'}} />
          {['VIN', 'Машина', 'Масло и фильтры', 'Слот', 'Готово'].map((s, i) => (
            <div key={s} style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                color: (i+1) <= step ? '#F5F2ED' : '#6B6B6B', letterSpacing: '0.12em',
              }}>{(i+1).toString().padStart(2,'0')} {s}</span>
              {i < 4 && <span style={{width: 24, height: 1, background: (i+1) < step ? '#C2410C' : '#3D3D3D'}} />}
            </div>
          ))}
        </div>

        <h1 className="t-headline" style={{fontSize: 'clamp(36px, 5.5vw, 72px)', lineHeight: 0.95, margin: '0 0 50px', letterSpacing: '-0.02em'}}>
          {step === 1 && <>Введи VIN — <span style={{color: 'var(--gray-1)'}}>дальше всё сделаем за тебя<span style={{color: '#C2410C'}}>.</span></span></>}
          {step === 2 && <>Машина определена<span style={{color: '#C2410C'}}>.</span></>}
          {step === 3 && <>Выбери масло и фильтры<span style={{color: '#C2410C'}}>.</span></>}
          {step === 4 && <>Выбери удобный слот<span style={{color: '#C2410C'}}>.</span></>}
          {step === 5 && <>Записал. Ждём<span style={{color: '#C2410C'}}>.</span></>}
        </h1>

        {/* STEP 1 — VIN entry */}
        {step === 1 && (
          <div style={{display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 56}}>
            <div>
              <label style={{display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', color: '#9A9A9A', textTransform: 'uppercase', marginBottom: 10}}>VIN автомобиля · 17 знаков</label>
              <input
                className="inp mono"
                placeholder="WBABA91070AL55203"
                maxLength={17}
                value={vin}
                onChange={e => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                style={{height: 72, fontSize: 22, letterSpacing: '0.2em'}}
                autoFocus
              />
              <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.1em'}}>
                <span>{vin.length}/17</span>
                <a onClick={() => setVin(VIN_DEMO.vin)} style={{color: '#C2410C', cursor: 'pointer'}}>Попробовать с демо-VIN →</a>
              </div>
              <button
                className="btn rust lg"
                disabled={vin.length !== 17 || lookupStatus === 'loading'}
                style={{marginTop: 28, opacity: vin.length === 17 && lookupStatus !== 'loading' ? 1 : 0.4, width: 280, justifyContent: 'space-between'}}
                onClick={() => runVinLookup(vin)}
              >
                {lookupStatus === 'loading' ? 'Определяем...' : 'Определить машину'} <span className="arr">→</span>
              </button>

              {lookupError && (
                <div style={{marginTop: 18, padding: '14px 16px', border: '1px solid #C2410C', color: '#F5F2ED', background: '#1a0f0a', fontSize: 13, lineHeight: 1.45}}>
                  {lookupError}
                </div>
              )}

              <div style={{marginTop: 50, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
                {[
                  {n: '01', t: 'Не знаешь VIN?', d: 'Он есть в СТС, в нижней части лобового и в страховке. Или позвони — продиктуем сами.'},
                  {n: '02', t: 'Что мы определим', d: 'Марка, модель, год, двигатель, тип масла, рекомендованную марку и аналоги.'},
                ].map(it => (
                  <div key={it.n} style={{background: '#0a0a0a', padding: '22px 22px'}}>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em', marginBottom: 10}}>{it.n}</div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 18, color: '#F5F2ED', textTransform: 'uppercase', marginBottom: 8}}>{it.t}</div>
                    <div style={{fontSize: 13, color: '#9A9A9A', lineHeight: 1.5}}>{it.d}</div>
                  </div>
                ))}
              </div>
            </div>

            <aside style={{border: '1px solid var(--line)', padding: 28, background: '#0e0e0e'}}>
              <div className="t-eyebrow" style={{marginBottom: 14}}>Без VIN</div>
              <div className="t-headline" style={{fontSize: 22, marginBottom: 18}}>Просто позвони</div>
              <a href="tel:+79950545859" style={{display: 'block', fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 36, lineHeight: 1, color: '#F5F2ED', marginBottom: 8, textDecoration: 'none'}}>+7 (995)<br />054-58-59</a>
              <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em', marginBottom: 24}}>пн - выходной, вт-пт 09:00-19:00, сб-вск 10:00-17:00</div>
              <div style={{borderTop: '1px solid var(--line)', paddingTop: 22}}>
                <div className="t-eyebrow muted" style={{marginBottom: 10}}>Или в Telegram</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED'}}>@tamgdemaslo</div>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em', marginTop: 4}}>отвечаем за 2 минуты</div>
              </div>
            </aside>
          </div>
        )}

        {/* STEP 2 — car identified */}
        {step === 2 && (
          <div style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 56, alignItems: 'start'}}>
            <div>
              <div style={{display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 18}}>
                <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em'}}>VIN · {vin}</span>
                <a onClick={() => setStep(1)} style={{fontSize: 12, color: '#9A9A9A', cursor: 'pointer'}}>изменить</a>
              </div>
              <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, lineHeight: 1, color: '#F5F2ED', textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
                {carTitle}
              </div>
              <div style={{fontFamily: 'Oswald, sans-serif', fontSize: 22, color: '#9A9A9A', textTransform: 'uppercase', marginTop: 8}}>
                {lookupCar.generation} · {lookupCar.year}
              </div>

              <table className="spec" style={{marginTop: 36}}>
                <tbody>
                  <tr><th>Двигатель</th><td>{lookupCar.engine || 'Уточним по каталогу'}</td></tr>
                  <tr><th>Заводская спецификация</th><td>{maintenance.oilSpec}</td></tr>
                  <tr><th>Объём заливки</th><td>{maintenance.oilCapacity}</td></tr>
                  <tr><th>Масляный фильтр</th><td>{maintenance.filters?.oil?.article || maintenance.filter}</td></tr>
                  <tr><th>Воздушный фильтр</th><td>{maintenance.filters?.air?.article || 'Подберём по VIN'}</td></tr>
                  <tr><th>Салонный фильтр</th><td>{maintenance.filters?.cabin?.article || 'Подберём по VIN'}</td></tr>
                  <tr><th>Сливная пробка</th><td>{maintenance.drainPlug}</td></tr>
                  <tr><th>Регламент</th><td>каждые 10 000 км / 12 мес</td></tr>
                </tbody>
              </table>

              {lookupMessage && (
                <div style={{marginTop: 22, padding: '14px 16px', border: '1px solid var(--line)', color: '#9A9A9A', background: '#0e0e0e', fontSize: 13, lineHeight: 1.45}}>
                  {lookupMessage}
                </div>
              )}

              <button className="btn rust lg" disabled={lookupStatus === 'loading'} onClick={() => setStep(3)} style={{marginTop: 32, width: 280, justifyContent: 'space-between', opacity: lookupStatus === 'loading' ? 0.45 : 1}}>
                {lookupStatus === 'loading' ? 'Подбираем...' : 'Подобрать масло'} <span className="arr">→</span>
              </button>
            </div>

            <aside>
              <div style={{aspectRatio: '4/3', border: '1px solid var(--line)'}}>
                <CarPlate kind="bmw" palette={['#1c1c1c', '#3D3D3D', '#C2410C']} label={vin.slice(0, 6) || 'VIN'} sub={`${lookupCar.brand} ${carShortModel}`} />
              </div>
              <div style={{marginTop: 18, padding: 18, border: '1px solid var(--line)', background: '#0e0e0e'}}>
                <div className="t-eyebrow muted" style={{marginBottom: 8}}>Совет мастера</div>
                <div style={{fontSize: 14, color: '#F5F2ED', lineHeight: 1.55}}>
                  {lookupResult?.source?.oilRequirements === 'openai+local-rules'
                    ? 'Сверили VIN, локальные правила TGM и технические требования к маслу. Перед заливкой мастер ещё раз проверит допуск по фактическому двигателю.'
                    : 'Подбор предварительный: перед заливкой мастер сверит допуск по каталогу и фактическому двигателю.'}
                </div>
                <div style={{marginTop: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em'}}>— Максим Лобов · мастер</div>
              </div>
            </aside>
          </div>
        )}

        {/* STEP 3 — oil pick */}
        {step === 3 && (
          <div>
            <div style={{marginBottom: 26}}>
              <div className="t-eyebrow" style={{marginBottom: 10}}>Рекомендация для {lookupCar.brand} {carShortModel}</div>
            </div>

            <div style={{border: '1px solid #C2410C', marginBottom: 32, background: '#0e0e0e'}}>
              <div style={{padding: '20px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 18}}>
                <div>
                  <div className="t-eyebrow" style={{marginBottom: 8}}>Собери без пакетов</div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 34, color: '#F5F2ED', textTransform: 'uppercase', lineHeight: 1}}>Масло отдельно. Фильтры отдельно.</div>
                </div>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', textAlign: 'right', lineHeight: 1.45}}>
                  Расчёт масла идёт от объёма двигателя:<br />
                  {formatLiters(oilCalc.requiredLiters)} / {formatLiters(oilCalc.packageLiters)} = {oilCalc.packages} шт.
                </div>
              </div>

              <div style={{display: 'grid', gridTemplateColumns: '0.95fr 1.35fr', gap: 1, background: 'var(--line)'}}>
                <section style={{background: '#0a0a0a', padding: '24px'}}>
                  <div className="t-eyebrow muted" style={{marginBottom: 14}}>01 / Масло</div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 30, color: '#F5F2ED', lineHeight: 1.05, textTransform: 'uppercase'}}>{oilFullName(chosen)}</div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', marginTop: 10, letterSpacing: '0.08em'}}>{chosen.visc} · упаковка {formatLiters(oilCalc.packageLiters)}</div>
                  <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', marginTop: 20}}>
                    <div style={{background: '#0e0e0e', padding: '14px'}}>
                      <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.1em'}}>НУЖНО</div>
                      <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26, color: '#F5F2ED'}}>{formatLiters(oilCalc.requiredLiters)}</div>
                    </div>
                    <div style={{background: '#0e0e0e', padding: '14px'}}>
                      <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.1em'}}>КОЛ-ВО</div>
                      <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26, color: '#F5F2ED'}}>{oilCalc.packages} шт.</div>
                    </div>
                    <div style={{background: '#0e0e0e', padding: '14px'}}>
                      <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.1em'}}>СУММА</div>
                      <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26, color: '#F5F2ED'}}>{fmtMoney(oilCalc.total)}</div>
                    </div>
                  </div>
                </section>

                <section style={{background: '#0a0a0a', padding: '24px'}}>
                  <div className="t-eyebrow muted" style={{marginBottom: 14}}>02 / Фильтры на выбор</div>
                  <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10}}>
                    {filterItems.map(item => {
                      const active = selectedFilters[item.key];
                      return (
                        <button
                          key={`top-${item.key}`}
                          type="button"
                          onClick={() => setSelectedFilters(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
                          style={{
                            minHeight: 150,
                            textAlign: 'left',
                            background: active ? '#17110d' : '#0e0e0e',
                            color: '#F5F2ED',
                            border: '1px solid',
                            borderColor: active ? '#C2410C' : 'var(--line)',
                            padding: '16px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
                            <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: active ? '#C2410C' : '#6B6B6B', letterSpacing: '0.12em'}}>{active ? 'ВКЛ' : 'ВЫКЛ'}</span>
                            <span style={{width: 18, height: 18, border: '1px solid #C2410C', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#C2410C', fontSize: 13}}>{active ? '✓' : '+'}</span>
                          </div>
                          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 19, textTransform: 'uppercase', lineHeight: 1.05}}>{item.title}</div>
                          <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#9A9A9A', marginTop: 8, letterSpacing: '0.04em', minHeight: 28}}>{item.article}</div>
                          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 23, marginTop: 10}}>{fmtMoney(item.price)}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              <div style={{padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24}}>
                <div style={{fontSize: 13, color: '#9A9A9A'}}>Итог пересчитывается из выбранного масла и включённых фильтров. Работа мастера включена.</div>
                <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 42, color: '#F5F2ED'}}>{fmtMoney(orderTotal)}</div>
                  <button className="btn rust" onClick={() => setStep(4)} style={{whiteSpace: 'nowrap'}}>К выбору слота <span className="arr">→</span></button>
                </div>
              </div>
            </div>

            {/* Recommended big card */}
            <div style={{display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 1, background: 'var(--line)', border: '1px solid #C2410C', marginBottom: 32}}>
              <div style={{background: '#0e0e0e', padding: '36px 36px 32px'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22}}>
                  <span className="badge solid-rust">★ ОСНОВНАЯ РЕКОМЕНДАЦИЯ</span>
                  <FreeChangeBadge size="sm" />
                </div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 48, lineHeight: 1, color: '#F5F2ED', textTransform: 'uppercase', letterSpacing: '-0.02em'}}>{oilFullName(recommended)}</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontSize: 20, color: '#9A9A9A', textTransform: 'uppercase', marginTop: 8}}>{recommended.visc} · {recommended.volume}</div>
                <div style={{fontSize: 14, color: '#9A9A9A', lineHeight: 1.55, marginTop: 18, maxWidth: 500}}>{recommended.note}</div>
                <div style={{marginTop: 18, padding: '14px 16px', border: '1px dashed var(--line)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', lineHeight: 1.5}}>
                  Объём заливки: {formatLiters(recommendedOilCalc.requiredLiters)} · упаковка {formatLiters(recommendedOilCalc.packageLiters)} · нужно {recommendedOilCalc.packages} шт.
                </div>
                <div style={{marginTop: 28, display: 'flex', alignItems: 'baseline', gap: 28}}>
                  <div>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em'}}>МАСЛО</div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 38, color: '#F5F2ED'}}>{fmtMoney(recommendedOilCalc.total)}</div>
                  </div>
                  <div>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em'}}>ФИЛЬТРЫ</div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 38, color: '#F5F2ED'}}>{fmtMoney(filtersTotal)}</div>
                  </div>
                  <div>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em'}}>ИТОГ</div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 38, color: '#F5F2ED'}}>{fmtMoney(recommendedOilCalc.total + filtersTotal)}</div>
                  </div>
                </div>
              </div>
              <div style={{background: '#0a0a0a', padding: '36px 36px'}}>
                <table className="spec">
                  <tbody>
                    <tr><th>Спецификация</th><td>{recommended.spec}</td></tr>
                    <tr><th>Тип</th><td>{recommended.type}</td></tr>
                    <tr><th>База</th><td>{recommended.base}</td></tr>
                    <tr><th>Упаковка</th><td>{recommended.volume}</td></tr>
                    <tr><th>Расчётный объём</th><td>{formatLiters(recommendedOilCalc.requiredLiters)} · {recommendedOilCalc.packages} шт.</td></tr>
                    <tr><th>Запас на складе</th><td>{recommended.stock} канистр</td></tr>
                  </tbody>
                </table>
                <button
                  className="btn rust"
                  onClick={() => setChosenOilId(recommended.id)}
                  style={{width: '100%', marginTop: 22, justifyContent: 'space-between'}}
                >
                  {chosen?.id === recommended?.id ? 'Выбрано' : 'Выбрать масло'} <span className="arr">→</span>
                </button>
              </div>
            </div>

            <div className="t-eyebrow muted" style={{marginBottom: 16}}>Альтернативы в той же спецификации</div>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
              {alternatives.map(o => (
                <div key={o.id} style={{background: '#0e0e0e', padding: '22px 22px'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em'}}>
                    <span>{o.brand.toUpperCase()}</span>
                    <span style={{color: '#C2410C'}}>+ ЗАМЕНА</span>
                  </div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED', textTransform: 'uppercase', lineHeight: 1.05, marginBottom: 6}}>{o.line}</div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A'}}>{o.visc} · {o.volume}</div>
                  <div style={{fontSize: 12.5, color: '#9A9A9A', marginTop: 12, lineHeight: 1.4, minHeight: 50}}>{o.note}</div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#6B6B6B', marginTop: 12, lineHeight: 1.35}}>
                    {(() => {
                      const calc = calculateOilByCapacity(o, maintenance);
                      return `${formatLiters(calc.requiredLiters)} · ${calc.packages} шт. · ${fmtMoney(calc.total)}`;
                    })()}
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--line)'}}>
                    <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED'}}>{fmtMoney(calculateOilByCapacity(o, maintenance).total)}</span>
                    <a onClick={() => setChosenOilId(o.id)} style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.12em', cursor: 'pointer'}}>{chosen?.id === o.id ? 'ВЫБРАНО' : 'ВЫБРАТЬ →'}</a>
                  </div>
                </div>
              ))}
            </div>

            <div style={{marginTop: 32}}>
              <div className="t-eyebrow muted" style={{marginBottom: 16}}>Фильтры отдельно</div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
                {filterItems.map(item => {
                  const active = selectedFilters[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedFilters(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
                      style={{
                        textAlign: 'left',
                        background: active ? '#14100d' : '#0e0e0e',
                        color: '#F5F2ED',
                        border: '0',
                        borderTop: active ? '3px solid #C2410C' : '3px solid transparent',
                        padding: '22px 22px',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
                        <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: active ? '#C2410C' : '#6B6B6B', letterSpacing: '0.14em'}}>{active ? 'ВКЛЮЧЕН' : 'НЕ ВЫБРАН'}</span>
                        <span style={{width: 18, height: 18, border: '1px solid #C2410C', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#C2410C', fontSize: 13}}>{active ? '✓' : '+'}</span>
                      </div>
                      <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, textTransform: 'uppercase', lineHeight: 1.05}}>{item.title}</div>
                      <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', marginTop: 8, letterSpacing: '0.06em'}}>{item.article}</div>
                      <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 24, marginTop: 16}}>{fmtMoney(item.price)}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{marginTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, border: '1px solid #C2410C', padding: '22px 24px'}}>
              <div>
                <div className="t-eyebrow" style={{marginBottom: 8}}>Итого по выбранному</div>
                <div style={{fontSize: 13, color: '#9A9A9A'}}>Масло по объёму + выбранные фильтры. Работа мастера включена.</div>
              </div>
              <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 46, color: '#F5F2ED'}}>{fmtMoney(orderTotal)}</div>
                <button className="btn rust" onClick={() => setStep(4)} style={{whiteSpace: 'nowrap'}}>К выбору слота <span className="arr">→</span></button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4 — slot picker */}
        {step === 4 && (
          <div style={{display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 56}}>
            <div>
              <div className="t-eyebrow muted" style={{marginBottom: 14}}>Свободные слоты в Калининграде · Московский пр. 244</div>

              {slotsLoading && (
                <div style={{marginBottom: 18, padding: '14px 16px', border: '1px solid var(--line)', color: '#9A9A9A', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase'}}>
                  Обновляем слоты с сервера...
                </div>
              )}

              {slotGroups.map((d, di) => (
                <div key={d.date} style={{marginBottom: 22, borderTop: '1px solid var(--line)', paddingTop: 18}}>
                  <div style={{display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14}}>
                    <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 24, color: '#F5F2ED', textTransform: 'uppercase'}}>{d.day}</span>
                    <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.12em'}}>{d.wd} · {d.date}</span>
                    <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.1em', marginLeft: 'auto'}}>{d.times.length} СВОБОДНЫХ</span>
                  </div>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
                    {d.times.map((t, ti) => {
                      const idx = slotGroups.slice(0, di).reduce((a, s) => a + s.times.length, 0) + ti;
                      const active = idx === slotIdx;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSlotIdx(idx)}
                          style={{
                            height: 56, padding: '0 22px',
                            background: active ? '#C2410C' : 'transparent',
                            color: active ? '#F5F2ED' : '#F5F2ED',
                            border: '1px solid',
                            borderColor: active ? '#C2410C' : 'var(--line)',
                            fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 20,
                            letterSpacing: '0.02em', cursor: 'pointer',
                          }}
                        >{t.time}</button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {!slotsLoading && slotGroups.length === 0 && (
                <div style={{padding: '28px 0', borderTop: '1px solid var(--line)', color: '#9A9A9A', fontSize: 14}}>
                  Свободных слотов пока нет. Позвони +7 (995) 054-58-59 — администратор подберёт окно вручную.
                </div>
              )}

              <div style={{marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
                <div>
                  <label style={{display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', color: '#9A9A9A', textTransform: 'uppercase', marginBottom: 8}}>Имя</label>
                  <input className="inp" placeholder="Алексей" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <label style={{display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', color: '#9A9A9A', textTransform: 'uppercase', marginBottom: 8}}>Телефон</label>
                  <input className="inp mono" placeholder="+7 ___ ___ __ __" value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
              </div>

              {bookingError && (
                <div style={{marginTop: 18, padding: '14px 16px', border: '1px solid #C2410C', color: '#F5F2ED', background: '#1a0f0a', fontSize: 13, lineHeight: 1.45}}>
                  {bookingError}
                </div>
              )}

              <button
                className="btn rust lg"
                disabled={!canBook}
                onClick={submitAppointment}
                style={{marginTop: 28, width: '100%', justifyContent: 'space-between', opacity: canBook ? 1 : 0.45}}
              >
                {bookingStatus === 'sending' ? 'Отправляем...' : 'Подтвердить запись'} <span className="arr">→</span>
              </button>
            </div>

            <aside style={{position: 'sticky', top: 130, alignSelf: 'start'}}>
              <div style={{border: '1px solid var(--line)', background: '#0e0e0e'}}>
                <div style={{padding: '22px 22px 20px', borderBottom: '1px solid var(--line)'}}>
                  <div className="t-eyebrow" style={{marginBottom: 10}}>Сводка</div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 24, color: '#F5F2ED', textTransform: 'uppercase'}}>{carTitle}</div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', marginTop: 4, letterSpacing: '0.06em'}}>{vin} · {lookupCar.year || 'год уточним'}</div>
                </div>
                <table className="spec" style={{margin: '0 22px', width: 'calc(100% - 44px)'}}>
                  <tbody>
                    <tr><th>Услуга</th><td>Замена моторного масла</td></tr>
                    <tr><th>Масло</th><td>{oilFullName(chosen)} {chosen.visc}</td></tr>
                    <tr><th>Объём заливки</th><td>{formatLiters(oilCalc.requiredLiters)}</td></tr>
                    <tr><th>Упаковки</th><td>{oilCalc.packages} × {formatLiters(oilCalc.packageLiters)}</td></tr>
                    <tr><th>Фильтры</th><td>{selectedFilterItems.length ? selectedFilterItems.map(item => item.title.replace(' фильтр', '')).join(', ') : 'не выбраны'}</td></tr>
                    <tr><th>Слот</th><td>{selectedSlot ? `${selectedSlot.weekday || selectedSlot.d?.wd} ${selectedSlot.date || selectedSlot.d?.date} · ${selectedSlot.time}` : 'Выберите слот'}</td></tr>
                  </tbody>
                </table>
                <div style={{padding: '0 22px 22px'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderTop: '1px dashed var(--line)', fontSize: 13}}>
                    <span style={{color: '#9A9A9A'}}>Масло {oilCalc.packages} × {formatLiters(oilCalc.packageLiters)}</span>
                    <span style={{color: '#F5F2ED', fontFamily: 'JetBrains Mono, monospace'}}>{fmtMoney(oilCalc.total)}</span>
                  </div>
                  {filterItems.map(item => selectedFilters[item.key] && (
                    <div key={item.key} style={{display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderTop: '1px dashed var(--line)', fontSize: 13}}>
                      <span style={{color: '#9A9A9A'}}>{item.title}</span>
                      <span style={{color: '#F5F2ED', fontFamily: 'JetBrains Mono, monospace'}}>{fmtMoney(item.price)}</span>
                    </div>
                  ))}
                  <div style={{display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderTop: '1px dashed var(--line)', fontSize: 13}}>
                    <span style={{color: '#9A9A9A'}}>Работа мастера</span>
                    <span style={{color: '#C2410C', fontFamily: 'JetBrains Mono, monospace'}}>включена · 0 ₽</span>
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderTop: '1px dashed var(--line)', fontSize: 13}}>
                    <span style={{color: '#9A9A9A'}}>Утилизация отработки</span>
                    <span style={{color: '#C2410C', fontFamily: 'JetBrains Mono, monospace'}}>включена · 0 ₽</span>
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '18px 0 0', borderTop: '2px solid #C2410C', marginTop: 8}}>
                    <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.14em', textTransform: 'uppercase'}}>Итог</span>
                    <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 40, color: '#F5F2ED'}}>{fmtMoney(orderTotal)}</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* STEP 5 — done */}
        {step === 5 && (
          <div style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 56, alignItems: 'start'}}>
            <div>
              <div style={{padding: '40px 40px', background: '#C2410C', color: '#F5F2ED', position: 'relative', overflow: 'hidden'}}>
                <div style={{position: 'absolute', top: -30, right: -10, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 220, color: 'rgba(10,10,10,0.15)', lineHeight: 0.8}}>76</div>
                <div className="t-eyebrow" style={{color: '#F5F2ED', marginBottom: 14}}>Заявка №{appointment?.id || 'TGM'}</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, lineHeight: 1, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>Записал.<br />Ждём в {selectedSlot?.time}<span style={{color: '#0a0a0a'}}>.</span></div>
                <div style={{marginTop: 24, fontSize: 16, lineHeight: 1.5}}>
                  {selectedSlot?.weekday || selectedSlot?.d?.wd}, {selectedSlot?.date || selectedSlot?.d?.date} · Калининград, Московский пр. 244. Если планы меняются — звони +7 (995) 054-58-59, перенесём без вопросов.
                </div>
              </div>
              <div style={{marginTop: 24, padding: '22px 24px', border: '1px solid var(--line)', background: '#0e0e0e', fontSize: 13.5, color: '#F5F2ED', lineHeight: 1.55}}>
                <span style={{color: '#C2410C', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', marginRight: 8}}>SMS</span>
                «Записал. {selectedSlot?.weekday || selectedSlot?.d?.wd} {selectedSlot?.date || selectedSlot?.d?.date}, {selectedSlot?.time}. {lookupCar.brand} {carShortModel}. {oilFullName(chosen)}, {formatLiters(oilCalc.requiredLiters)}. Если что — звони.»
              </div>
            </div>
            <aside>
              <div style={{border: '1px solid var(--line)', padding: '24px 24px', background: '#0e0e0e'}}>
                <div className="t-eyebrow muted" style={{marginBottom: 14}}>Что взять с собой</div>
                <ul style={{margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12}}>
                  {['СТС или ПТС', 'Сервисную книжку (если есть)', 'Себя — кофе нальём'].map((s, i) => (
                    <li key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, color: '#F5F2ED'}}>
                      <span style={{color: '#C2410C', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, paddingTop: 2}}>0{i+1}</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <Link to="/" className="btn ghost lg" style={{marginTop: 22, width: '100%', justifyContent: 'space-between'}}>
                На главную <span className="arr">→</span>
              </Link>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function oilFullName(oil) {
  const brand = String(oil?.brand || '').trim();
  const line = String(oil?.line || '').trim();
  if (!brand) return line;
  if (!line) return brand;

  return line.toLowerCase().startsWith(brand.toLowerCase()) ? line : `${brand} ${line}`;
}

function parseLiters(value) {
  const matched = String(value || '').match(/\d+(?:[.,]\d+)?/);
  if (!matched) return null;
  const parsed = Number(matched[0].replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getOilPackageLiters(oil) {
  return parseLiters(oil?.volume) || 4;
}

function getRequiredOilLiters(maintenance) {
  return Number(maintenance?.oilCapacityLiters) || parseLiters(maintenance?.oilCapacity) || 4;
}

function calculateOilByCapacity(oil, maintenance) {
  const requiredLiters = getRequiredOilLiters(maintenance);
  const packageLiters = getOilPackageLiters(oil);
  const packages = Math.max(1, Math.ceil(requiredLiters / packageLiters));
  const total = packages * (Number(oil?.price) || 0);

  return { requiredLiters, packageLiters, packages, total };
}

function formatLiters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0 л';
  return `${String(Math.round(number * 10) / 10).replace('.', ',')} л`;
}

function buildFallbackFilters(vinDemo) {
  return {
    oil: {
      title: 'Масляный фильтр',
      article: vinDemo.filter || 'MANN / OEM по VIN',
      price: 950,
    },
    air: {
      title: 'Воздушный фильтр',
      article: vinDemo.airFilter || 'MANN / OEM по VIN',
      price: 1350,
    },
    cabin: {
      title: 'Салонный фильтр',
      article: vinDemo.cabinFilter || 'MANN / OEM по VIN',
      price: 1650,
    },
  };
}

function buildFilterItems(maintenance) {
  const filters = maintenance?.filters || buildFallbackFilters(VIN_DEMO);
  return ['oil', 'air', 'cabin'].map(key => ({
    key,
    title: filters[key]?.title || (key === 'oil' ? 'Масляный фильтр' : key === 'air' ? 'Воздушный фильтр' : 'Салонный фильтр'),
    article: filters[key]?.article || 'Подберём по VIN',
    price: Number(filters[key]?.price) || 0,
  }));
}

function groupApiSlots(items) {
  const groups = [];
  const byDate = new Map();

  items.forEach(slot => {
    if (!byDate.has(slot.date)) {
      const group = {
        day: slot.day,
        date: slot.date,
        wd: slot.weekday,
        times: [],
      };
      byDate.set(slot.date, group);
      groups.push(group);
    }

    byDate.get(slot.date).times.push({
      id: slot.id,
      time: slot.time,
      date: slot.date,
      weekday: slot.weekday,
    });
  });

  return groups;
}

function buildFallbackSlotGroups() {
  const weekdayTimes = ['09:00', '10:30', '12:00', '13:30', '16:00', '17:00', '18:30'];
  const saturdayTimes = ['10:00', '11:30', '13:00', '15:00'];
  const now = new Date();
  const today = vinStartOfDay(now);
  const tomorrow = vinAddDays(today, 1);
  const groups = [];
  let cursor = today;

  while (groups.length < 3) {
    const dayOfWeek = cursor.getDay();

    if (dayOfWeek !== 0) {
      const times = (dayOfWeek === 6 ? saturdayTimes : weekdayTimes)
        .filter(time => !vinSameDate(cursor, today) || vinToMinutes(time) > vinCurrentMinutes(now));

      if (times.length) {
        const date = vinFormatDate(cursor);
        const wd = vinFormatWeekday(cursor);
        const day = vinSameDate(cursor, today) ? 'СЕГ' : vinSameDate(cursor, tomorrow) ? 'ЗАВ' : wd.toUpperCase();
        const iso = vinIsoDate(cursor);

        groups.push({
          day,
          date,
          wd,
          times: times.map(time => ({
            id: `${iso}-${time.replace(':', '')}`,
            time,
            date,
            weekday: wd,
          })),
        });
      }
    }

    cursor = vinAddDays(cursor, 1);
  }

  return groups;
}

function vinStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function vinAddDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function vinSameDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function vinIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function vinFormatDate(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function vinFormatWeekday(date) {
  const weekday = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
  }).format(date).replace('.', '');

  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

function vinCurrentMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function vinToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}



// ====================================================================
//  pages/shop.jsx — каталог масел и расходников
// ====================================================================

function ShopPage() {
  const [brands, setBrands] = useState(new Set());
  const [viscs, setViscs] = useState(new Set());
  const [types, setTypes] = useState(new Set());
  const [vols, setVols] = useState(new Set());
  const [sort, setSort] = useState('rec');

  const toggle = (set, setter, v) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    setter(n);
  };
  const reset = () => { setBrands(new Set()); setViscs(new Set()); setTypes(new Set()); setVols(new Set()); };

  const filtered = OILS.filter(o => {
    if (brands.size && !brands.has(o.brand)) return false;
    if (viscs.size && !viscs.has(o.visc)) return false;
    if (vols.size && !vols.has(o.volume)) return false;
    if (types.size && ![...types].some(t => o.type.includes(t))) return false;
    return true;
  });
  if (sort === 'cheap') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'exp') filtered.sort((a, b) => b.price - a.price);

  const allBrands = [...new Set(OILS.map(o => o.brand))];
  const allViscs = [...new Set(OILS.map(o => o.visc))];
  const allVols = [...new Set(OILS.map(o => o.volume))];
  const allTypes = ['Бензин', 'Дизель', 'Гибрид', 'DPF'];

  return (
    <main style={{background: '#F5F2ED', color: '#0a0a0a', minHeight: '100vh', padding: '40px 0 100px'}}>
      <div className="container">
        {/* Header */}
        <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 14, borderBottom: '1px solid #0a0a0a', paddingBottom: 24}}>
          <div>
            <div className="t-eyebrow" style={{marginBottom: 14}}>Каталог · моторные масла</div>
            <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(40px, 6vw, 80px)', lineHeight: 0.92, margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
              Масло.<br />Купил — поменяли<span style={{color: '#C2410C'}}>.</span>
            </h1>
          </div>
          <div style={{textAlign: 'right'}}>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginBottom: 6}}>В каталоге</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 64, lineHeight: 1, color: '#0a0a0a'}}>{filtered.length}</div>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginTop: 4}}>из {OILS.length} ПОЗИЦИЙ</div>
          </div>
        </div>

        {/* Free change strip */}
        <div style={{background: '#0a0a0a', color: '#F5F2ED', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 36}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
            <FreeChangeBadge size="md" />
            <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 20, textTransform: 'uppercase'}}>Цена на сайте = цена с заменой. Никаких «работ сверху».</span>
          </div>
          <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.12em'}}>ПРАВИЛО ДОМА · С 2023</div>
        </div>

        <div style={{display: 'grid', gridTemplateColumns: '260px 1fr', gap: 40, alignItems: 'start'}}>
          {/* Filters */}
          <aside style={{position: 'sticky', top: 120}}>
            <FilterGroup title="Бренд" items={allBrands} active={brands} onToggle={v => toggle(brands, setBrands, v)} />
            <FilterGroup title="Вязкость" items={allViscs} active={viscs} onToggle={v => toggle(viscs, setViscs, v)} />
            <FilterGroup title="Тип ДВС" items={allTypes} active={types} onToggle={v => toggle(types, setTypes, v)} />
            <FilterGroup title="Объём" items={allVols} active={vols} onToggle={v => toggle(vols, setVols, v)} />
            <button
              onClick={reset}
              style={{marginTop: 18, width: '100%', height: 44, background: 'transparent', border: '1px solid #0a0a0a', color: '#0a0a0a', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer'}}
            >Сбросить фильтры</button>
          </aside>

          <div>
            {/* sort */}
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, paddingBottom: 16, borderBottom: '1px solid #D9D3C5'}}>
              <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', textTransform: 'uppercase'}}>
                Показываем {filtered.length}
              </div>
              <div style={{display: 'flex', gap: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase'}}>
                <span style={{color: '#6B6B6B'}}>Сортировка:</span>
                {[{k: 'rec', l: 'Реком.'}, {k: 'cheap', l: 'Дешевле'}, {k: 'exp', l: 'Дороже'}].map(o => (
                  <a key={o.k} onClick={() => setSort(o.k)} style={{color: sort === o.k ? '#C2410C' : '#0a0a0a', cursor: 'pointer', borderBottom: sort === o.k ? '1px solid #C2410C' : '1px solid transparent', paddingBottom: 2}}>{o.l}</a>
                ))}
              </div>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22}}>
              {filtered.map((o, i) => <ShopCard key={o.id} oil={o} idx={i} />)}
            </div>

            {filtered.length === 0 && (
              <div style={{padding: '80px 0', textAlign: 'center', color: '#6B6B6B'}}>
                Ничего не нашлось. Сбрось фильтры.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function FilterGroup({ title, items, active, onToggle }) {
  return (
    <div style={{marginBottom: 28}}>
      <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', color: '#6B6B6B', textTransform: 'uppercase', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #0a0a0a'}}>{title}</div>
      <ul style={{margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4}}>
        {items.map(v => {
          const on = active.has(v);
          return (
            <li key={v}>
              <label style={{display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0', fontSize: 13}}>
                <span style={{
                  width: 16, height: 16, border: '1px solid #0a0a0a',
                  background: on ? '#C2410C' : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>{on && <span style={{color: '#F5F2ED', fontSize: 11, lineHeight: 1}}>✓</span>}</span>
                <span style={{color: '#0a0a0a'}}>{v}</span>
                <span style={{marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B'}}>
                  {OILS.filter(o => o.brand === v || o.visc === v || o.volume === v || o.type.includes(v)).length}
                </span>
                <input type="checkbox" checked={on} onChange={() => onToggle(v)} style={{display: 'none'}} />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShopCard({ oil, idx }) {
  return (
    <Link to={`/product/${oil.id}`}>
      <div style={{
        background: '#FFFFFF', border: '1px solid #D9D3C5',
        padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', gap: 16,
        position: 'relative', height: '100%', cursor: 'pointer',
        transition: 'border-color 160ms',
      }} onMouseEnter={e => e.currentTarget.style.borderColor = '#C2410C'} onMouseLeave={e => e.currentTarget.style.borderColor = '#D9D3C5'}>
        <div style={{position: 'absolute', top: 12, right: 12}}><FreeChangeBadge size="sm" /></div>

        <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.16em', color: '#6B6B6B', textTransform: 'uppercase'}}>
          {(idx+1).toString().padStart(3,'0')} · {oil.brand.toUpperCase()}
        </div>

        <div style={{height: 150, position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center'}}>
          <svg viewBox="0 0 120 150" width="110" height="150">
            <rect x="48" y="2" width="24" height="14" fill="#0a0a0a" />
            <path d="M 28 16 L 92 16 L 96 28 L 96 144 L 24 144 L 24 28 Z" fill={oil.color} />
            <path d="M 28 16 L 92 16 L 96 28 L 96 144 L 24 144 L 24 28 Z" fill="url(#shp)" />
            <rect x="30" y="58" width="60" height="48" fill="#F5F2ED" />
            <text x="60" y="76" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="14" fill="#0a0a0a">{oil.brand}</text>
            <text x="60" y="90" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontWeight="700" fontSize="11" fill="#0a0a0a">{oil.visc}</text>
            <text x="60" y="100" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="#6B6B6B">{oil.volume}</text>
            <defs>
              <linearGradient id="shp" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#000" stopOpacity="0.2" /><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.25" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div>
          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 19, lineHeight: 1.1, textTransform: 'uppercase', marginBottom: 6}}>{oil.brand} {oil.line}</div>
          <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.04em'}}>{oil.visc} · {oil.volume} · {oil.type}</div>
        </div>

        {oil.badge && (
          <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, padding: '4px 8px', border: '1px solid #C2410C', color: '#C2410C', display: 'inline-block', alignSelf: 'flex-start', letterSpacing: '0.1em', textTransform: 'uppercase'}}>{oil.badge}</div>
        )}

        <div style={{marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 14, borderTop: '1px dashed #D9D3C5'}}>
          <div>
            <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26}}>{fmtMoney(oil.price)}</span>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#C2410C', letterSpacing: '0.12em', marginTop: 2}}>+ ЗАМЕНА В ЦЕНЕ</div>
          </div>
          <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#0a0a0a', letterSpacing: '0.12em'}}>В НАЛИЧИИ {oil.stock} →</span>
        </div>
      </div>
    </Link>
  );
}



// ====================================================================
//  pages/product.jsx — карточка масла + калькулятор
// ====================================================================

function ProductPage() {
  const r = useRoute();
  const id = (r.params && r.params.id) || (r.path.split('/')[2]);
  const oil = OILS.find(o => o.id === id) || OILS[0];
  const others = OILS.filter(o => o.id !== oil.id).slice(0, 4);

  const [filtersOpts] = useState({ filter: 950, drain: 280, antifreeze: 0 });
  const [addFilter, setAddFilter] = useState(true);
  const [addDrain, setAddDrain] = useState(true);
  const [addAntifreeze, setAddAntifreeze] = useState(false);

  const total = oil.price
    + (addFilter ? filtersOpts.filter : 0)
    + (addDrain ? filtersOpts.drain : 0)
    + (addAntifreeze ? 3200 : 0);

  return (
    <main style={{background: '#F5F2ED', color: '#0a0a0a', minHeight: '100vh', padding: '40px 0 100px'}}>
      <div className="container">
        {/* Breadcrumb */}
        <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 28}}>
          <Link to="/" style={{color: '#6B6B6B'}}>Главная</Link> / <Link to="/shop" style={{color: '#6B6B6B'}}>Магазин</Link> / <span style={{color: '#0a0a0a'}}>{oil.brand} {oil.line}</span>
        </div>

        <div style={{display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 56}}>
          {/* Image side */}
          <div>
            <div style={{aspectRatio: '1', background: '#FFFFFF', border: '1px solid #D9D3C5', position: 'relative', overflow: 'hidden'}}>
              {/* hex glow background */}
              <div style={{position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 50%, ${oil.color}20, transparent 60%)`}} />
              <div style={{position: 'absolute', top: 18, left: 18}}>
                <FreeChangeBadge size="lg" />
              </div>
              <div style={{position: 'absolute', top: 18, right: 18, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 80, color: '#0a0a0a', lineHeight: 0.9, letterSpacing: '-0.02em'}}>
                {oil.visc.split('-')[0]}<span style={{color: '#C2410C'}}>.</span>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.1em', textAlign: 'right', marginTop: -8}}>{oil.visc}</div>
              </div>
              {/* canister */}
              <svg viewBox="0 0 280 360" style={{position: 'absolute', inset: 0, margin: 'auto', width: '60%', height: '80%'}}>
                <rect x="112" y="8" width="56" height="28" fill="#0a0a0a" />
                <path d="M 60 36 L 220 36 L 232 64 L 232 348 L 48 348 L 48 64 Z" fill={oil.color} />
                <path d="M 60 36 L 220 36 L 232 64 L 232 348 L 48 348 L 48 64 Z" fill="url(#prod-sh)" />
                <rect x="64" y="120" width="156" height="160" fill="#F5F2ED" />
                <text x="142" y="166" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="38" fill="#0a0a0a">{oil.brand}</text>
                <text x="142" y="200" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="20" fill="#0a0a0a">{oil.line}</text>
                <line x1="68" y1="218" x2="216" y2="218" stroke="#0a0a0a" />
                <text x="142" y="246" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="36" fill="#C2410C">{oil.visc}</text>
                <text x="142" y="266" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#0a0a0a" letterSpacing="2">{oil.spec.split('/')[0].trim()}</text>
                <text x="142" y="272" />
                <text x="142" y="294" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="22" fill="#0a0a0a">{oil.volume}</text>
                <defs>
                  <linearGradient id="prod-sh" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#000" stopOpacity="0.25" /><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.3" />
                  </linearGradient>
                </defs>
              </svg>
              {/* corner stamps */}
              <div style={{position: 'absolute', bottom: 18, left: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.16em'}}>
                ART. {oil.id.toUpperCase().slice(0, 10)}
              </div>
              <div style={{position: 'absolute', bottom: 18, right: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.16em'}}>
                В НАЛИЧИИ · {oil.stock}
              </div>
            </div>

            {/* note */}
            <div style={{marginTop: 22, padding: '20px 22px', border: '1px solid #0a0a0a', background: '#0a0a0a', color: '#F5F2ED'}}>
              <div className="t-eyebrow muted" style={{marginBottom: 8}}>Слово мастера</div>
              <div style={{fontSize: 15, lineHeight: 1.5}}>{oil.note}</div>
              <div style={{marginTop: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.1em'}}>— Максим Лобов</div>
            </div>
          </div>

          {/* Info side */}
          <div>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14}}>
              {oil.brand} · {oil.type}
            </div>
            <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(40px, 5.5vw, 72px)', lineHeight: 0.95, margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
              {oil.line}<br /><span style={{color: '#C2410C'}}>{oil.visc}.</span>
            </h1>
            <div style={{fontFamily: 'Oswald, sans-serif', fontSize: 18, color: '#6B6B6B', textTransform: 'uppercase', marginTop: 8}}>
              {oil.volume} · {oil.base}
            </div>

            <table className="spec" style={{marginTop: 32}}>
              <tbody>
                <tr><th>Бренд</th><td>{oil.brand}</td></tr>
                <tr><th>Линейка</th><td>{oil.line}</td></tr>
                <tr><th>Вязкость SAE</th><td>{oil.visc}</td></tr>
                <tr><th>Спецификация</th><td>{oil.spec}</td></tr>
                <tr><th>Тип ДВС</th><td>{oil.type}</td></tr>
                <tr><th>База</th><td>{oil.base}</td></tr>
                <tr><th>Объём</th><td>{oil.volume}</td></tr>
                <tr><th>Артикул</th><td style={{fontFamily: 'JetBrains Mono, monospace'}}>{oil.id.toUpperCase()}</td></tr>
              </tbody>
            </table>

            {/* Calculator */}
            <div style={{marginTop: 36, background: '#0a0a0a', color: '#F5F2ED', padding: '28px 28px 24px', position: 'relative', overflow: 'hidden'}}>
              <div style={{position: 'absolute', top: -24, right: -10, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 180, color: 'rgba(245,242,237,0.04)', lineHeight: 0.8}}>+</div>

              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22}}>
                <div>
                  <div className="t-eyebrow" style={{marginBottom: 8}}>Калькулятор замены</div>
                  <div className="t-headline" style={{fontSize: 24}}>Что включено и что докинуть.</div>
                </div>
                <FreeChangeBadge size="sm" />
              </div>

              <table style={{width: '100%', borderCollapse: 'collapse'}}>
                <tbody>
                  <tr style={{borderBottom: '1px dashed var(--line)'}}>
                    <td style={{padding: '14px 0', fontSize: 13.5, color: '#F5F2ED'}}>
                      <span style={{color: '#C2410C', marginRight: 8}}>✓</span> Масло {oil.brand} {oil.line} {oil.visc} · {oil.volume}
                    </td>
                    <td style={{padding: '14px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: '#F5F2ED', textAlign: 'right'}}>{fmtMoney(oil.price)}</td>
                  </tr>
                  <tr style={{borderBottom: '1px dashed var(--line)'}}>
                    <td style={{padding: '14px 0', fontSize: 13.5, color: '#F5F2ED'}}>
                      <span style={{color: '#C2410C', marginRight: 8}}>✓</span> Работа мастера, прокладка, утилизация
                    </td>
                    <td style={{padding: '14px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: '#C2410C', textAlign: 'right'}}>0 ₽</td>
                  </tr>

                  <OptRow label="Масляный фильтр (оригинал)" price={950} on={addFilter} toggle={() => setAddFilter(!addFilter)} hint="Mann / Mahle / OEM" />
                  <OptRow label="Сливной болт + шайба" price={280} on={addDrain} toggle={() => setAddDrain(!addDrain)} hint="каждая замена — новая шайба" />
                  <OptRow label="Антифриз (доливка до полной)" price={3200} on={addAntifreeze} toggle={() => setAddAntifreeze(!addAntifreeze)} hint="по желанию, по щупу" />
                </tbody>
              </table>

              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 24, paddingTop: 22, borderTop: '2px solid #C2410C'}}>
                <div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.14em', textTransform: 'uppercase'}}>Итого к оплате</div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', marginTop: 4, letterSpacing: '0.06em'}}>наличными, картой, СБП · по факту</div>
                </div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, color: '#F5F2ED', lineHeight: 0.9}}>{fmtMoney(total)}</div>
              </div>

              <Link to="/vin" className="btn rust lg" style={{width: '100%', marginTop: 22, justifyContent: 'space-between'}}>
                Записаться по этому маслу <span className="arr">→</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Compatibility */}
        <section style={{marginTop: 80}}>
          <SectionHead paper eyebrow="Подходит к машинам" title="OEM-допуски и спецификации." num="" right={<Link to="/vin" className="btn ghost dark sm">Проверить по VIN →</Link>} />
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14}}>
            {['BMW LL-01', 'MB-Approval 229.5', 'VW 502.00 / 505.00', 'Porsche A40', 'Renault RN 0700/0710', 'Fiat 9.55535-Z2', 'Ford WSS-M2C913-D', 'GM dexos2'].map(c => (
              <div key={c} style={{padding: '18px 18px', background: '#FFF', border: '1px solid #D9D3C5'}}>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.12em', marginBottom: 8}}>OEM</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', lineHeight: 1.1}}>{c}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Other oils */}
        <section style={{marginTop: 80}}>
          <SectionHead paper eyebrow="Похожие позиции" title="Если хочешь сравнить." num="" />
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22}}>
            {others.map((o, i) => <OilCardPaper key={o.id} oil={o} idx={i} />)}
          </div>
        </section>
      </div>
    </main>
  );
}

function OptRow({ label, price, on, toggle, hint }) {
  return (
    <tr style={{borderBottom: '1px dashed var(--line)'}}>
      <td style={{padding: '14px 0', fontSize: 13.5, color: '#F5F2ED'}}>
        <label style={{display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer'}}>
          <span style={{
            width: 16, height: 16, border: '1px solid #F5F2ED',
            background: on ? '#C2410C' : 'transparent', borderColor: on ? '#C2410C' : '#F5F2ED',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>{on && <span style={{color: '#F5F2ED', fontSize: 11, lineHeight: 1}}>+</span>}</span>
          {label}
          <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.08em', marginLeft: 8}}>· {hint}</span>
          <input type="checkbox" checked={on} onChange={toggle} style={{display: 'none'}} />
        </label>
      </td>
      <td style={{padding: '14px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: on ? '#F5F2ED' : '#6B6B6B', textAlign: 'right'}}>
        {on ? '+' : ''}{fmtMoney(price)}
      </td>
    </tr>
  );
}



// ====================================================================
//  pages/cases.jsx — Кейсы (список) + детальная страница
// ====================================================================

function CasesPage() {
  return (
    <main style={{background: '#0a0a0a', minHeight: '100vh', padding: '40px 0 100px'}}>
      <div className="container">
        <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 14, borderBottom: '1px solid var(--line)', paddingBottom: 28}}>
          <div>
            <div className="t-eyebrow" style={{marginBottom: 14}}>Кейсы · замена масла в АКПП</div>
            <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(44px, 6.5vw, 88px)', lineHeight: 0.92, margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
              Машины недели<span style={{color: '#C2410C'}}>.</span><br />
              <span style={{color: '#9A9A9A'}}>что у нас было в работе.</span>
            </h1>
          </div>
          <div style={{textAlign: 'right'}}>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginBottom: 6}}>Опубликовано</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, lineHeight: 1, color: '#F5F2ED'}}>{CASES.length}</div>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginTop: 4}}>РАЗВОРОТОВ · 2025–2026</div>
          </div>
        </div>

        <div style={{display: 'flex', gap: 14, padding: '22px 0', marginBottom: 36, borderBottom: '1px solid var(--line)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.14em', textTransform: 'uppercase', flexWrap: 'wrap'}}>
          <span style={{color: '#6B6B6B'}}>Фильтр:</span>
          {['Все', 'ZF 8HP', 'DSG / DL382', '9G-Tronic', 'Aisin', 'CVT', 'Toyota'].map((f, i) => (
            <span key={f} style={{color: i === 0 ? '#C2410C' : '#F5F2ED', borderBottom: i === 0 ? '1px solid #C2410C' : '1px solid transparent', paddingBottom: 2, cursor: 'pointer'}}>{f}</span>
          ))}
        </div>

        <div style={{display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
          {CASES.map((c, idx) => (
            <Link key={c.id} to={`/case/${c.id}`}>
              <div style={{display: 'grid', gridTemplateColumns: '120px 280px 1fr 200px', gap: 28, padding: '28px 28px', background: '#0a0a0a', alignItems: 'center', cursor: 'pointer', transition: 'background 160ms'}}
                onMouseEnter={e => e.currentTarget.style.background = '#161616'}
                onMouseLeave={e => e.currentTarget.style.background = '#0a0a0a'}>
                <div>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em'}}>CASE / 0{idx+1}</div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 44, lineHeight: 1, color: '#F5F2ED', marginTop: 8}}>{(idx+1).toString().padStart(2, '0')}</div>
                </div>
                <div style={{aspectRatio: '4/3', border: '1px solid var(--line)'}}>
                  <CarPlate kind={c.hero} palette={c.palette} label={`N°0${idx+1}`} sub={c.fluid} />
                </div>
                <div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 26, lineHeight: 1.1, color: '#F5F2ED', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '-0.01em'}}>{c.title}</div>
                  <div style={{fontSize: 14, color: '#9A9A9A', lineHeight: 1.55, marginBottom: 14, maxWidth: 640}}>{c.summary}</div>
                  <div style={{display: 'flex', gap: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.08em', textTransform: 'uppercase'}}>
                    <span>{c.year}</span>
                    <span>·</span>
                    <span>{c.mileage}</span>
                    <span>·</span>
                    <span>{c.fluid}</span>
                    <span>·</span>
                    <span>{c.duration}</span>
                  </div>
                </div>
                <div style={{textAlign: 'right'}}>
                  <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginBottom: 6}}>Сумма работы</div>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 38, color: '#F5F2ED', lineHeight: 1}}>{fmtMoney(c.cost)}</div>
                  <div style={{marginTop: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em'}}>ОТКРЫТЬ →</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div style={{marginTop: 80, padding: '36px 40px', background: '#0e0e0e', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 32}}>
          <div>
            <div className="t-eyebrow" style={{marginBottom: 10}}>Своя коробка — свой случай</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 32, lineHeight: 1, color: '#F5F2ED', textTransform: 'uppercase', letterSpacing: '-0.01em'}}>Не нашёл свою машину?</div>
            <div style={{marginTop: 14, fontSize: 14, color: '#9A9A9A', lineHeight: 1.5, maxWidth: 540}}>Каждая коробка — отдельная история. Скажи марку и пробег — расскажем, что делали с такими же.</div>
          </div>
          <Link to="/vin" className="btn rust lg">Записаться по VIN <span className="arr">→</span></Link>
        </div>
      </div>
    </main>
  );
}

function CasePage() {
  const r = useRoute();
  const id = (r.params && r.params.id) || r.path.split('/')[2];
  const c = CASES.find(x => x.id === id) || CASES[0];
  const idx = CASES.findIndex(x => x.id === c.id);
  const next = CASES[(idx + 1) % CASES.length];

  return (
    <main style={{background: '#0a0a0a', minHeight: '100vh', padding: '0 0 100px'}}>
      {/* Hero */}
      <section style={{background: c.palette[0], borderBottom: '1px solid var(--line)', position: 'relative', overflow: 'hidden'}} className="grain">
        <div style={{borderBottom: '1px solid var(--line)'}}>
          <div className="container" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9A9A9A'}}>
            <div style={{display: 'flex', gap: 24}}>
              <Link to="/cases" style={{color: '#C2410C'}}>← КЕЙСЫ</Link>
              <span>CASE №{(idx + 1).toString().padStart(2, '0')} / 04</span>
              <span>{c.year} · {c.mileage}</span>
            </div>
            <div style={{display: 'flex', gap: 24}}>
              <span>{c.fluid}</span>
              <span>{c.duration}</span>
            </div>
          </div>
        </div>

        <div className="container" style={{padding: '70px 24px 50px', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 56, alignItems: 'center'}}>
          <div>
            <div className="t-eyebrow" style={{marginBottom: 22}}>Полная замена ATF</div>
            <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(46px, 6.5vw, 96px)', lineHeight: 0.9, margin: 0, textTransform: 'uppercase', color: '#F5F2ED', letterSpacing: '-0.02em'}}>
              {c.title.split('—')[0].trim()}<span style={{color: '#C2410C'}}>.</span>
            </h1>
            <div style={{marginTop: 26, fontSize: 18, color: '#F5F2ED', lineHeight: 1.5, maxWidth: 580, opacity: 0.85}}>
              {c.summary}
            </div>
            <div style={{display: 'flex', gap: 14, marginTop: 36}}>
              <div className="numpanel"><span className="k">Пробег</span><span className="v">{c.mileage.split(' ')[0]}</span><span className="u">км</span></div>
              <div className="numpanel"><span className="k">Время работы</span><span className="v">{c.duration.split(' ')[0]}</span><span className="u">{c.duration.split(' ').slice(1).join(' ')}</span></div>
              <div className="numpanel"><span className="k">Сумма</span><span className="v">{fmtNum(c.cost / 1000)}</span><span className="u">тыс. ₽</span></div>
            </div>
          </div>
          <div style={{aspectRatio: '4/3'}}>
            <CarPlate kind={c.hero} palette={c.palette} label={`N°0${idx+1}`} sub={c.fluid} />
          </div>
        </div>
      </section>

      {/* Body */}
      <section style={{background: '#0a0a0a', padding: '80px 0'}}>
        <div className="container" style={{display: 'grid', gridTemplateColumns: '1fr 320px', gap: 64, alignItems: 'start'}}>
          <article>
            {c.body.map((b, i) => (
              <div key={i} style={{display: 'grid', gridTemplateColumns: '80px 1fr', gap: 32, paddingBottom: 40, marginBottom: 40, borderBottom: i === c.body.length - 1 ? 'none' : '1px solid var(--line)'}}>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#C2410C', letterSpacing: '0.14em', textTransform: 'uppercase', paddingTop: 6}}>
                  0{i+1}
                </div>
                <div>
                  <h3 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 32, margin: 0, color: '#F5F2ED', textTransform: 'uppercase', letterSpacing: '-0.01em', marginBottom: 16}}>{b.h}</h3>
                  <p style={{fontSize: 16, color: '#F5F2ED', lineHeight: 1.6, margin: 0, opacity: 0.85, maxWidth: 660}}>{b.t}</p>
                </div>
              </div>
            ))}

            {/* Process strip */}
            <div style={{marginTop: 16}}>
              <div className="t-eyebrow muted" style={{marginBottom: 18}}>Хронометраж</div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
                {[
                  {t: '00:00', s: 'Приёмка', d: 'VIN, сверка регламента, согласование жидкости.'},
                  {t: '00:15', s: 'Подъём', d: 'Лифт, защита, осмотр поддона на утечки.'},
                  {t: '00:30', s: 'Слив + поддон', d: 'Слив отработки, снятие поддона, замена фильтра и прокладки.'},
                  {t: '01:10', s: 'Аппарат', d: 'Прогон жидкости через стенд до прозрачности.'},
                  {t: '02:30', s: 'Корректировка', d: 'Прогрев, уровень, обнуление адаптаций, тест-драйв.'},
                ].map((p, i) => (
                  <div key={i} style={{background: '#0a0a0a', padding: '20px 18px', minHeight: 170}}>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED', lineHeight: 1}}>{p.t}</div>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.12em', marginTop: 8, textTransform: 'uppercase'}}>{p.s}</div>
                    <div style={{fontSize: 12, color: '#9A9A9A', lineHeight: 1.5, marginTop: 12}}>{p.d}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quote */}
            <div style={{marginTop: 60, padding: '36px 40px', background: '#0e0e0e', borderLeft: '3px solid #C2410C'}}>
              <div style={{fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 22, color: '#F5F2ED', lineHeight: 1.4, letterSpacing: '-0.01em'}}>
                «Полная замена — это не "слил и залил". Это работа со стендом, прокладками и адаптациями. Час времени экономить нельзя.»
              </div>
              <div style={{marginTop: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.12em'}}>— Максим Лобов · мастер моторного цеха</div>
            </div>
          </article>

          {/* Sidebar — spec sheet */}
          <aside style={{position: 'sticky', top: 130}}>
            <div style={{padding: '22px 22px', border: '1px solid var(--line)', background: '#0e0e0e'}}>
              <div className="t-eyebrow" style={{marginBottom: 12}}>Наряд-заказ № {1100 + idx * 17}</div>
              <table className="spec">
                <tbody>
                  {c.spec.map(s => (
                    <tr key={s.k}><th>{s.k}</th><td>{s.v}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{marginTop: 22, paddingTop: 18, borderTop: '2px solid #C2410C', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.14em', textTransform: 'uppercase'}}>Итого</span>
                <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 36, color: '#F5F2ED'}}>{fmtMoney(c.cost)}</span>
              </div>
              <Link to="/vin" className="btn rust" style={{width: '100%', marginTop: 18, justifyContent: 'space-between'}}>
                Записать свою машину <span className="arr">→</span>
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {/* Next case */}
      <section style={{background: next.palette[0], padding: '60px 0'}}>
        <div className="container">
          <Link to={`/case/${next.id}`}>
            <div style={{display: 'grid', gridTemplateColumns: '120px 1fr 240px', gap: 36, alignItems: 'center', cursor: 'pointer'}}>
              <div>
                <div className="t-eyebrow muted" style={{marginBottom: 10}}>Следующий кейс</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 64, color: '#F5F2ED', lineHeight: 1}}>{(CASES.findIndex(x => x.id === next.id) + 1).toString().padStart(2, '0')}</div>
              </div>
              <div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(28px, 4vw, 48px)', lineHeight: 1.05, color: '#F5F2ED', textTransform: 'uppercase', letterSpacing: '-0.01em'}}>{next.title}</div>
                <div style={{marginTop: 12, fontSize: 14, color: '#F5F2ED', opacity: 0.7, maxWidth: 720}}>{next.summary}</div>
              </div>
              <div style={{aspectRatio: '4/3', border: '1px solid var(--line)'}}>
                <CarPlate kind={next.hero} palette={next.palette} label={`N°0${CASES.findIndex(x => x.id === next.id) + 1}`} sub={next.fluid} />
              </div>
            </div>
          </Link>
        </div>
      </section>
    </main>
  );
}



// ====================================================================
//  pages/team.jsx — «Наши люди»
// ====================================================================

function TeamPage() {
  return (
    <main style={{background: '#0a0a0a', minHeight: '100vh', padding: '40px 0 100px'}}>
      <div className="container">
        <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 14, borderBottom: '1px solid var(--line)', paddingBottom: 28}}>
          <div>
            <div className="t-eyebrow" style={{marginBottom: 14}}>Наши люди</div>
            <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(44px, 6.5vw, 96px)', lineHeight: 0.92, margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
              Конкретные люди<span style={{color: '#C2410C'}}>.</span><br />
              <span style={{color: '#9A9A9A'}}>не безликий персонал.</span>
            </h1>
          </div>
          <div style={{textAlign: 'right'}}>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginBottom: 6}}>В команде</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, lineHeight: 1, color: '#F5F2ED'}}>{MASTERS.length}</div>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginTop: 4}}>МАСТЕРОВ · 2026</div>
          </div>
        </div>

        <div style={{padding: '24px 0 56px', fontSize: 16, color: '#9A9A9A', lineHeight: 1.6, maxWidth: 760, borderBottom: '1px solid var(--line)'}}>
          У нас нет «работников зала», «специалистов фронта» и «администраторов клиентского отдела». У нас — мастера. У каждого имя, лицо, цифра. Если не нравится мастер — скажешь, поменяем. Если нравится — записывайся к конкретному.
        </div>

        <div style={{padding: '56px 0', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 40}}>
          {MASTERS.map((m, idx) => <MasterCard key={m.id} m={m} idx={idx} />)}
        </div>

        {/* Hiring strip */}
        <section style={{marginTop: 40, padding: '40px 40px', background: '#C2410C', color: '#F5F2ED', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'center', position: 'relative', overflow: 'hidden'}}>
          <div style={{position: 'absolute', top: -40, right: -20, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 280, color: 'rgba(10,10,10,0.12)', lineHeight: 0.8, pointerEvents: 'none'}}>+1</div>
          <div style={{position: 'relative'}}>
            <div className="t-eyebrow" style={{color: '#F5F2ED', marginBottom: 14, opacity: 0.85}}>Растём</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 48, lineHeight: 0.95, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>Ищем 5-го мастера<span style={{color: '#0a0a0a'}}>.</span></div>
            <div style={{marginTop: 18, fontSize: 15, lineHeight: 1.5, maxWidth: 480}}>
              Калининград. Моторный цех. Опыт от 3 лет. Чёрная униформа. Кофе бесплатно. Зарплата выше рынка — потому что мы не демпингуем.
            </div>
          </div>
          <div style={{position: 'relative', textAlign: 'right'}}>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7, marginBottom: 12}}>пиши в личку</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 42, lineHeight: 1, marginBottom: 22}}>@tamgdemaslo<span style={{color: '#0a0a0a'}}>.</span></div>
            <a className="btn" style={{background: '#0a0a0a', borderColor: '#0a0a0a', color: '#F5F2ED'}}>
              Резюме в Telegram <span className="arr">→</span>
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}

function MasterCard({ m, idx }) {
  return (
    <div style={{display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'stretch', border: '1px solid var(--line)', background: '#0e0e0e'}}>
      <div style={{aspectRatio: '4/5', borderRight: '1px solid var(--line)'}}>
        <F1Portrait helmet={m.helmet} label={idx+1} sublabel={m.role} />
      </div>
      <div style={{padding: '22px 24px 22px 0', display: 'flex', flexDirection: 'column', gap: 14}}>
        <div>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em'}}>N°0{idx+1} · {m.city.toUpperCase()}</div>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.1em'}}>С {m.since}</div>
          </div>
          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 30, lineHeight: 1.05, color: '#F5F2ED', textTransform: 'uppercase', marginTop: 10, letterSpacing: '-0.01em'}}>{m.name}<span style={{color: '#C2410C'}}>.</span></div>
          <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 400, fontSize: 16, color: '#9A9A9A', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4}}>{m.role}</div>
        </div>
        <div style={{paddingTop: 14, borderTop: '1px dashed var(--line)', fontFamily: 'Inter', fontSize: 14.5, color: '#F5F2ED', lineHeight: 1.55, fontStyle: 'normal'}}>
          {m.quote}
        </div>
        <div style={{marginTop: 'auto', display: 'flex', gap: 14, paddingTop: 14, borderTop: '1px solid var(--line)'}}>
          <div className="numpanel" style={{flex: 1, padding: '12px 14px'}}>
            <span className="k">Замен / клиентов</span>
            <span className="v" style={{fontSize: 28}}>{fmtNum(m.swaps)}</span>
            <span className="u">{m.swapsLabel || 'замен'}</span>
          </div>
          <div className="numpanel" style={{flex: 1, padding: '12px 14px'}}>
            <span className="k">Стаж в TGM</span>
            <span className="v" style={{fontSize: 28}}>{2026 - m.since}</span>
            <span className="u">{2026 - m.since === 1 ? 'год' : 'лет'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}



// ====================================================================
//  pages/contacts.jsx — Контакты + карта точки
// ====================================================================

function ContactsPage() {
  return (
    <main style={{background: '#0a0a0a', minHeight: '100vh', padding: '40px 0 100px'}}>
      <div className="container">
        <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 14, borderBottom: '1px solid var(--line)', paddingBottom: 28}}>
          <div>
            <div className="t-eyebrow" style={{marginBottom: 14}}>Контакты · точка 01</div>
            <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(44px, 6.5vw, 88px)', lineHeight: 0.92, margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
              Калининград<span style={{color: '#C2410C'}}>.</span><br />
              Московский пр. 244.
            </h1>
          </div>
          <div style={{textAlign: 'right'}}>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginBottom: 6}}>Координаты</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 28, lineHeight: 1.1, color: '#F5F2ED'}}>54.689°N<br />20.493°E</div>
          </div>
        </div>

        <div style={{display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 40, marginTop: 40}}>
          {/* Map */}
          <div style={{position: 'relative', aspectRatio: '16 / 11', background: '#0e0e0e', border: '1px solid var(--line)', overflow: 'hidden'}}>
            <svg viewBox="0 0 900 620" preserveAspectRatio="xMidYMid slice" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
              <rect width="900" height="620" fill="#0a0a0a" />
              {/* small streets grid */}
              <g stroke="#1a1a1a" strokeWidth="1" fill="none">
                {Array.from({length: 26}).map((_, i) => <line key={'h'+i} x1="0" y1={i*26} x2="900" y2={i*26} />)}
                {Array.from({length: 36}).map((_, i) => <line key={'v'+i} x1={i*26} y1="0" x2={i*26} y2="620" />)}
              </g>
              {/* main avenues — diagonal Moskovsky pr */}
              <line x1="-20" y1="320" x2="920" y2="270" stroke="#3D3D3D" strokeWidth="14" />
              <line x1="-20" y1="320" x2="920" y2="270" stroke="#1F1F1F" strokeWidth="11" />
              <text x="50" y="295" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#6B6B6B" letterSpacing="2">МОСКОВСКИЙ ПРОСПЕКТ</text>
              {/* Leninsky */}
              <line x1="380" y1="0" x2="320" y2="620" stroke="#3D3D3D" strokeWidth="10" />
              <line x1="380" y1="0" x2="320" y2="620" stroke="#1F1F1F" strokeWidth="7" />
              <text x="346" y="100" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#6B6B6B" letterSpacing="2" transform="rotate(-85 346 100)">ЛЕНИНСКИЙ</text>
              {/* secondary */}
              <line x1="0" y1="160" x2="900" y2="180" stroke="#2A2A2A" strokeWidth="6" />
              <line x1="0" y1="480" x2="900" y2="460" stroke="#2A2A2A" strokeWidth="6" />
              <line x1="120" y1="0" x2="100" y2="620" stroke="#2A2A2A" strokeWidth="4" />
              <line x1="640" y1="0" x2="660" y2="620" stroke="#2A2A2A" strokeWidth="4" />
              {/* river Pregel */}
              <path d="M -10 420 Q 200 400 400 440 T 920 420 L 920 460 Q 700 470 500 460 T -10 470 Z" fill="#0d2230" />
              <path d="M -10 420 Q 200 400 400 440 T 920 420" stroke="#1a3a52" strokeWidth="2" fill="none" />
              <text x="700" y="450" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#3a5a72" letterSpacing="2">ПРЕГОЛЯ</text>
              {/* blocks */}
              <g fill="#141414">
                <rect x="130" y="260" width="80" height="40" />
                <rect x="220" y="220" width="60" height="50" />
                <rect x="180" y="320" width="100" height="60" />
                <rect x="430" y="240" width="90" height="50" />
                <rect x="540" y="200" width="70" height="40" />
                <rect x="520" y="290" width="80" height="50" />
                <rect x="680" y="240" width="100" height="50" />
                <rect x="740" y="320" width="120" height="80" />
                <rect x="80" y="160" width="50" height="80" />
                <rect x="280" y="160" width="60" height="50" />
              </g>
              {/* point pin */}
              <g transform="translate(458 295)">
                <circle r="70" fill="#C2410C" opacity="0.1">
                  <animate attributeName="r" values="70;90;70" dur="3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.1;0.04;0.1" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle r="40" fill="#C2410C" opacity="0.2" />
                <circle r="14" fill="#C2410C" />
                <circle r="5" fill="#F5F2ED" />
              </g>
              <line x1="478" y1="295" x2="600" y2="295" stroke="#C2410C" strokeWidth="1" strokeDasharray="3 3" />
              <text x="608" y="290" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#F5F2ED" letterSpacing="2">TGM · ТОЧКА 01</text>
              <text x="608" y="304" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#9A9A9A" letterSpacing="1">МОСКОВСКИЙ 244 · КГД</text>
              {/* compass */}
              <g transform="translate(840 60)">
                <circle r="22" fill="none" stroke="#3D3D3D" />
                <line x1="0" y1="-22" x2="0" y2="22" stroke="#3D3D3D" />
                <polygon points="0,-22 -4,-10 4,-10" fill="#C2410C" />
                <text x="0" y="-30" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#F5F2ED">N</text>
              </g>
              {/* legend bar */}
              <g transform="translate(40 560)">
                <rect width="180" height="40" fill="#0a0a0a" stroke="#3D3D3D" />
                <text x="14" y="20" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#6B6B6B" letterSpacing="2">MAP / KGD · M 1:8000</text>
                <line x1="14" y1="28" x2="74" y2="28" stroke="#F5F2ED" strokeWidth="2" />
                <line x1="74" y1="28" x2="134" y2="28" stroke="#C2410C" strokeWidth="2" />
                <text x="138" y="32" fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#9A9A9A">500 М</text>
              </g>
            </svg>
            {/* zoom controls */}
            <div style={{position: 'absolute', top: 14, right: 14, display: 'flex', flexDirection: 'column', gap: 1}}>
              <button style={{width: 36, height: 36, background: '#0a0a0a', border: '1px solid #3D3D3D', color: '#F5F2ED', fontFamily: 'Oswald, sans-serif', fontSize: 22, lineHeight: 1, cursor: 'pointer'}}>+</button>
              <button style={{width: 36, height: 36, background: '#0a0a0a', border: '1px solid #3D3D3D', color: '#F5F2ED', fontFamily: 'Oswald, sans-serif', fontSize: 22, lineHeight: 1, cursor: 'pointer'}}>−</button>
            </div>
          </div>

          {/* Info column */}
          <div style={{display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
            {[
              {k: 'Адрес', v: 'Калининград,\nМосковский пр. 244\nДачная 6В\nЮрия Гагарина 116'},
              {k: 'Телефон', v: '+7 (995) 054-58-59', big: true},
              {k: 'Telegram', v: '@tamgdemaslo', big: true},
              {k: 'Часы работы', v: 'пн - выходной\nвт-пт 09:00-19:00\nсб-вск 10:00-17:00'},
              {k: 'Как заехать', v: 'Со двора напротив автосалона Renault. Указатель «TGM» — на углу. Парковка для клиентов — 4 места, бесплатно.'},
              {k: 'Реквизиты', v: 'ИП Елисеенко Илья Сергеевич\nИНН 392302838630'},
            ].map((r, i) => (
              <div key={i} style={{background: '#0a0a0a', padding: '22px 22px'}}>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10}}>{r.k}</div>
                <div style={{
                  fontFamily: r.big ? 'Oswald, sans-serif' : 'Inter, sans-serif',
                  fontWeight: r.big ? 700 : 400,
                  fontSize: r.big ? 26 : 14, lineHeight: r.big ? 1.05 : 1.5,
                  color: '#F5F2ED', whiteSpace: 'pre-line',
                }}>{r.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* What's inside */}
        <section style={{marginTop: 72}}>
          <SectionHead eyebrow="Что внутри" title="Чёрный фасад. Тёплое дерево. Шестиугольный свет." />
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22}}>
            {[
              {n: '01', t: 'Зона ожидания', d: 'Рыжий кожаный диван, тёплое дерево, постеры эпохи Формулы-1, бесплатный кофе и Wi-Fi.', acc: '#A85A3C'},
              {n: '02', t: 'Моторный цех', d: 'Два подъёмника, чистый пол, шестиугольная подсветка. Видно с дивана через стекло.', acc: '#3D3D3D'},
              {n: '03', t: 'Склад масла', d: '120+ артикулов в наличии. Все бренды из прайса всегда на полке.', acc: '#C2410C'},
            ].map(b => (
              <div key={b.n} style={{background: '#0e0e0e', border: '1px solid var(--line)', padding: '0 0', overflow: 'hidden'}}>
                <div style={{height: 200, position: 'relative', overflow: 'hidden', background: '#1a1a1a'}}>
                  <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 30% 60%, ${b.acc}40, transparent 60%)`}} />
                  {/* schematic interior */}
                  <svg viewBox="0 0 320 200" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
                    {b.n === '01' && (
                      <g>
                        {/* hex lights */}
                        <g fill={b.acc} opacity="0.6">
                          {[40, 100, 160, 220, 280].map((x, i) => (
                            <polygon key={i} points={`${x},20 ${x+14},10 ${x+28},20 ${x+28},36 ${x+14},46 ${x},36`} opacity="0.5" />
                          ))}
                        </g>
                        {/* sofa */}
                        <rect x="60" y="110" width="200" height="56" fill={b.acc} />
                        <rect x="60" y="110" width="200" height="16" fill="#7a4029" />
                        <rect x="68" y="166" width="184" height="10" fill="#5a2f1f" />
                        {/* table */}
                        <rect x="140" y="172" width="40" height="6" fill="#8B6F47" />
                      </g>
                    )}
                    {b.n === '02' && (
                      <g>
                        {/* hex grid */}
                        <g fill="none" stroke={b.acc} opacity="0.4">
                          {[20, 80, 140, 200, 260].map((x, i) => (
                            <polygon key={i} points={`${x},30 ${x+18},20 ${x+36},30 ${x+36},48 ${x+18},58 ${x},48`} />
                          ))}
                        </g>
                        {/* lift */}
                        <rect x="70" y="100" width="60" height="80" fill="#3D3D3D" />
                        <rect x="190" y="100" width="60" height="80" fill="#3D3D3D" />
                        <rect x="70" y="92" width="60" height="8" fill="#C2410C" />
                        <rect x="190" y="92" width="60" height="8" fill="#C2410C" />
                        <line x1="60" y1="180" x2="270" y2="180" stroke="#F5F2ED" strokeWidth="2" />
                      </g>
                    )}
                    {b.n === '03' && (
                      <g>
                        {/* shelves */}
                        {[40, 80, 120, 160].map((y, i) => (
                          <g key={i}>
                            <line x1="20" y1={y} x2="300" y2={y} stroke="#3D3D3D" strokeWidth="1" />
                            {Array.from({length: 14}).map((_, j) => (
                              <rect key={j} x={26 + j*20} y={y - 28} width="14" height="28" fill={['#C2410C', '#1A4480', '#7A2B2B', '#B43A2B', '#003B7A'][j % 5]} />
                            ))}
                          </g>
                        ))}
                      </g>
                    )}
                  </svg>
                  <div style={{position: 'absolute', top: 14, left: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#F5F2ED', letterSpacing: '0.14em', opacity: 0.8}}>{b.n}</div>
                </div>
                <div style={{padding: '22px 22px 24px'}}>
                  <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED', textTransform: 'uppercase', lineHeight: 1.05, marginBottom: 10}}>{b.t}</div>
                  <div style={{fontSize: 13.5, color: '#9A9A9A', lineHeight: 1.55}}>{b.d}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section style={{marginTop: 72, padding: '40px 44px', background: '#C2410C', color: '#F5F2ED', display: 'grid', gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'center', position: 'relative', overflow: 'hidden'}}>
          <div style={{position: 'absolute', top: -40, right: -20, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 240, color: 'rgba(10,10,10,0.12)', lineHeight: 0.8, pointerEvents: 'none'}}>76</div>
          <div style={{position: 'relative'}}>
            <div className="t-eyebrow" style={{color: '#F5F2ED', opacity: 0.85, marginBottom: 12}}>Связь</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(28px, 3.5vw, 48px)', lineHeight: 1, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
              Просто позвони. Запишем за минуту<span style={{color: '#0a0a0a'}}>.</span>
            </div>
          </div>
          <div style={{position: 'relative', textAlign: 'right'}}>
            <a href="tel:+79950545859" style={{display: 'block', fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 38, lineHeight: 1, marginBottom: 12, color: '#F5F2ED', textDecoration: 'none'}}>+7 (995) 054-58-59</a>
            <Link to="/vin" className="btn" style={{background: '#0a0a0a', borderColor: '#0a0a0a', color: '#F5F2ED'}}>
              Или по VIN <span className="arr">→</span>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}



// ====================================================================
//  pages/account.jsx — Личный кабинет (история машины)
// ====================================================================

function AccountPage() {
  const a = ACCOUNT;
  const kmToNext = a.nextChange.km - a.car.mileage;
  const pct = Math.max(0, Math.min(1, (15000 - kmToNext) / 15000));

  return (
    <main style={{background: '#0a0a0a', minHeight: '100vh', padding: '40px 0 100px'}}>
      <div className="container">
        {/* Header — "наряд-заказ"-style */}
        <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 14, borderBottom: '1px solid var(--line)', paddingBottom: 28}}>
          <div>
            <div className="t-eyebrow" style={{marginBottom: 14}}>Личный гараж · {a.user}</div>
            <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 0.95, margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
              {a.car.name}<span style={{color: '#C2410C'}}>.</span>
            </h1>
            <div style={{display: 'flex', gap: 22, marginTop: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.1em', textTransform: 'uppercase'}}>
              <span>ГОС. №&nbsp;{a.car.plate}</span>
              <span>VIN {a.car.vin}</span>
              <span>{a.car.year}</span>
              <span>{fmtNum(a.car.mileage)} км</span>
            </div>
          </div>
          <div style={{textAlign: 'right'}}>
            <div className="t-eyebrow muted" style={{marginBottom: 6}}>Наряд-заказы</div>
            <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, lineHeight: 1, color: '#F5F2ED'}}>{a.history.length}</div>
            <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', letterSpacing: '0.12em', marginTop: 4}}>С ОКТЯБРЯ 2024</div>
          </div>
        </div>

        <div style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 40, marginTop: 40}}>
          {/* History */}
          <div>
            <div className="t-eyebrow muted" style={{marginBottom: 18}}>История замен · хронология</div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--line)', border: '1px solid var(--line)'}}>
              {a.history.map((h, i) => (
                <div key={i} style={{display: 'grid', gridTemplateColumns: '80px 120px 1fr 200px', gap: 22, padding: '22px 22px', background: '#0e0e0e', alignItems: 'center'}}>
                  <div>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.14em'}}>N°{(a.history.length - i).toString().padStart(2, '0')}</div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 28, lineHeight: 1, color: '#F5F2ED', marginTop: 8}}>{i === 0 ? '◆' : '○'}</div>
                  </div>
                  <div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 20, color: '#F5F2ED'}}>{h.date}</div>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A', marginTop: 4, letterSpacing: '0.08em'}}>{fmtNum(h.km)} КМ</div>
                  </div>
                  <div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 18, color: '#F5F2ED', textTransform: 'uppercase', lineHeight: 1.1, marginBottom: 6}}>{h.type}</div>
                    <div style={{fontSize: 13, color: '#9A9A9A'}}>{h.oil} · мастер {h.master}</div>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED'}}>{fmtMoney(h.sum)}</div>
                    <a style={{display: 'inline-block', marginTop: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.12em', cursor: 'pointer'}}>НАРЯД-ЗАКАЗ →</a>
                  </div>
                </div>
              ))}
            </div>

            {/* Chequered footer of doc */}
            <div className="chequered thin" style={{marginTop: 18}} />
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18, padding: '14px 0', borderBottom: '1px dashed var(--line)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.1em'}}>
              <span>СУММА ВСЕХ ВИЗИТОВ</span>
              <span style={{color: '#F5F2ED', fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 24}}>{fmtMoney(a.history.reduce((s, h) => s + h.sum, 0))}</span>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px dashed var(--line)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.1em'}}>
              <span>ЗАМЕН ЗА 2 ГОДА</span>
              <span style={{color: '#F5F2ED'}}>{a.history.length}</span>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', padding: '14px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#9A9A9A', letterSpacing: '0.1em'}}>
              <span>СРЕДНИЙ ИНТЕРВАЛ</span>
              <span style={{color: '#F5F2ED'}}>14 240 КМ</span>
            </div>
          </div>

          {/* Right column */}
          <div style={{display: 'flex', flexDirection: 'column', gap: 22}}>
            {/* Next change */}
            <div style={{background: '#C2410C', color: '#F5F2ED', padding: '28px 28px 26px', position: 'relative', overflow: 'hidden'}}>
              <div style={{position: 'absolute', top: -20, right: -10, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 200, color: 'rgba(10,10,10,0.15)', lineHeight: 0.8}}>76</div>
              <div className="t-eyebrow" style={{color: '#F5F2ED', opacity: 0.85, marginBottom: 12, position: 'relative'}}>Следующая замена</div>
              <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 64, lineHeight: 0.95, position: 'relative', textTransform: 'uppercase', letterSpacing: '-0.02em'}}>
                Через {fmtNum(kmToNext)} км
              </div>
              <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#F5F2ED', opacity: 0.8, marginTop: 12, letterSpacing: '0.1em', position: 'relative'}}>ИЛИ {a.nextChange.date} · ЧТО НАСТУПИТ РАНЬШЕ</div>
              {/* progress bar */}
              <div style={{marginTop: 22, height: 8, background: 'rgba(10,10,10,0.2)', position: 'relative'}}>
                <div style={{position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct * 100}%`, background: '#0a0a0a'}} />
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#F5F2ED', opacity: 0.7, letterSpacing: '0.1em', position: 'relative'}}>
                <span>0</span>
                <span>15 000 КМ</span>
              </div>
              <Link to="/vin" className="btn lg" style={{marginTop: 22, width: '100%', justifyContent: 'space-between', position: 'relative', background: '#0a0a0a', borderColor: '#0a0a0a', color: '#F5F2ED'}}>
                Записаться заранее <span className="arr">→</span>
              </Link>
            </div>

            {/* Sticker preview */}
            <div style={{padding: 28, border: '1px solid var(--line)', background: '#0e0e0e'}}>
              <div className="t-eyebrow muted" style={{marginBottom: 14}}>Наклейка на лобовое</div>
              <div style={{background: '#F5F2ED', color: '#0a0a0a', padding: '20px 24px', position: 'relative'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                  <Logo variant="black" monogram h={36} />
                  <div className="chequered" style={{width: 60, height: 8}}></div>
                </div>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.14em', color: '#6B6B6B', marginTop: 10}}>ДО СЛЕДУЮЩЕЙ ЗАМЕНЫ:</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 32, lineHeight: 1, marginTop: 6}}>{fmtNum(a.nextChange.km)} км</div>
                <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 20, color: '#C2410C', marginTop: 4}}>ИЛИ {a.nextChange.date}</div>
                <div style={{fontFamily: 'Inter', fontSize: 13, color: '#0a0a0a', marginTop: 14, lineHeight: 1.4}}>«Не забудь — мы скучаем.»</div>
                <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#6B6B6B', marginTop: 14, letterSpacing: '0.1em'}}>+7 (995) 054-58-59 · TGM · KGD</div>
              </div>
              <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#6B6B6B', letterSpacing: '0.12em', marginTop: 12, textAlign: 'center'}}>50 × 80 ММ · ПЕЧАТЬ НА ПЛЁНКЕ</div>
            </div>

            {/* Garage actions */}
            <div style={{padding: '22px 24px', border: '1px solid var(--line)', background: '#0e0e0e'}}>
              <div className="t-eyebrow muted" style={{marginBottom: 14}}>Гараж</div>
              <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                {[
                  {l: 'Изменить пробег', d: `сейчас ${fmtNum(a.car.mileage)} км`},
                  {l: 'Добавить вторую машину', d: 'X3 жены, дача, мотоцикл'},
                  {l: 'SMS-напоминание за 500 км', d: 'включено'},
                  {l: 'Скачать историю в PDF', d: '4 наряд-заказа'},
                ].map((b, i) => (
                  <a key={i} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i === 3 ? 'none' : '1px dashed var(--line)', cursor: 'pointer'}}>
                    <div>
                      <div style={{fontSize: 14, color: '#F5F2ED'}}>{b.l}</div>
                      <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6B6B6B', marginTop: 2, letterSpacing: '0.06em'}}>{b.d}</div>
                    </div>
                    <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#C2410C'}}>→</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Recommended now */}
        <section style={{marginTop: 64}}>
          <SectionHead eyebrow="Рекомендуем" title="Под твою машину." right={<Link to="/vin" className="btn ghost sm">Подбор по VIN →</Link>} />
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22}}>
            {OILS.filter(o => VIN_DEMO.alternatives.slice(0,3).includes(o.id) || o.id === VIN_DEMO.recommended).slice(0,4).map((o, i) => (
              <Link key={o.id} to={`/product/${o.id}`}>
                <div className="card" style={{padding: 0, height: '100%'}}>
                  <div style={{padding: 22}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 14}}>
                      <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#9A9A9A', letterSpacing: '0.12em'}}>{o.brand.toUpperCase()}</span>
                      {o.id === VIN_DEMO.recommended && <span className="badge solid-rust">★ ОСНОВНОЕ</span>}
                    </div>
                    <div style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED', lineHeight: 1.1, marginBottom: 6, textTransform: 'uppercase'}}>{o.line}</div>
                    <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9A9A9A'}}>{o.visc} · {o.volume}</div>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18, paddingTop: 14, borderTop: '1px dashed var(--line)'}}>
                      <span style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#F5F2ED'}}>{fmtMoney(o.price)}</span>
                      <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#C2410C', letterSpacing: '0.12em'}}>+ ЗАМЕНА</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}



// ====================================================================
//  pages/legal.jsx — Политика конфиденциальности и оферта
// ====================================================================

const LEGAL_OWNER = 'ИП Елисеенко Илья Сергеевич';
const LEGAL_INN = '392302838630';
const LEGAL_PHONE = '+7 (995) 054-58-59';
const LEGAL_EMAIL = 'tam-gde-maslo@mail.ru';
const LEGAL_ADDRESS = 'Калининград, Московский пр. 244; Дачная 6В; Юрия Гагарина 116';

function LegalShell({ eyebrow, title, children }) {
  return (
    <main style={{background: '#F5F2ED', color: '#0a0a0a'}}>
      <section className="container" style={{padding: '86px 24px 96px'}}>
        <div className="t-eyebrow" style={{marginBottom: 16}}>{eyebrow}</div>
        <h1 style={{
          fontFamily: 'Oswald, sans-serif',
          fontWeight: 700,
          fontSize: 'clamp(42px, 6vw, 86px)',
          lineHeight: 0.95,
          margin: 0,
          textTransform: 'uppercase',
        }}>
          {title}<span style={{color: '#C2410C'}}>.</span>
        </h1>
        <div style={{maxWidth: 940, marginTop: 34, display: 'grid', gap: 18}}>
          {children}
        </div>
      </section>
    </main>
  );
}

function LegalBlock({ title, children }) {
  return (
    <section style={{background: '#fff', border: '1px solid #D9D3C5', padding: '24px 26px'}}>
      <h2 style={{
        margin: '0 0 12px',
        fontFamily: 'Oswald, sans-serif',
        fontSize: 26,
        lineHeight: 1.05,
        textTransform: 'uppercase',
      }}>
        {title}
      </h2>
      <div style={{fontSize: 15, lineHeight: 1.7, color: '#3D3D3D'}}>
        {children}
      </div>
    </section>
  );
}

function LegalList({ items }) {
  return (
    <ul style={{margin: '0 0 0 18px', padding: 0}}>
      {items.map((item, index) => (
        <li key={index} style={{marginBottom: 8}}>{item}</li>
      ))}
    </ul>
  );
}

function PrivacyPage() {
  return (
    <LegalShell eyebrow="Документы" title="Политика конфиденциальности">
      <LegalBlock title="Оператор">
        <p style={{margin: 0}}>
          {LEGAL_OWNER}, ИНН {LEGAL_INN}, обрабатывает персональные данные клиентов сайта «Там где масло.»
          для записи на услуги, обратной связи, подбора масла и исполнения клиентских запросов.
        </p>
      </LegalBlock>

      <LegalBlock title="Какие данные обрабатываем">
        <LegalList items={[
          'имя, телефон, VIN автомобиля и сведения об автомобиле;',
          'данные заявки, выбранные услуги, комментарии клиента;',
          'технические данные посещения сайта: IP-адрес, cookies, сведения о браузере и устройстве;',
          'историю обращений, если клиент повторно связывается с сервисом.',
        ]} />
      </LegalBlock>

      <LegalBlock title="Зачем нужны данные">
        <LegalList items={[
          'чтобы связаться с клиентом и подтвердить запись;',
          'чтобы подобрать масло, расходники и свободный слот;',
          'чтобы вести историю обслуживания и улучшать качество сервиса;',
          'чтобы выполнять требования закона и защищать права сторон.',
        ]} />
      </LegalBlock>

      <LegalBlock title="Передача и хранение">
        <p style={{margin: 0}}>
          Данные не продаются третьим лицам. Они могут передаваться сервисам, которые помогают вести запись,
          CRM, аналитику, связь с клиентом и хранение данных, только в объёме, необходимом для работы сайта
          и оказания услуг.
        </p>
      </LegalBlock>

      <LegalBlock title="Права клиента">
        <p style={{margin: 0}}>
          Клиент может запросить уточнение, блокировку или удаление своих данных, а также отозвать согласие
          на обработку. Для обращения используйте телефон <a href="tel:+79950545859">{LEGAL_PHONE}</a> или
          email <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.
        </p>
      </LegalBlock>
    </LegalShell>
  );
}

function OfferPage() {
  return (
    <LegalShell eyebrow="Документы" title="Договор оферты">
      <LegalBlock title="Исполнитель">
        <p style={{margin: 0}}>
          {LEGAL_OWNER}, ИНН {LEGAL_INN}. Контакты: <a href="tel:+79950545859">{LEGAL_PHONE}</a>,
          {' '}<a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. Адреса оказания услуг: {LEGAL_ADDRESS}.
        </p>
      </LegalBlock>

      <LegalBlock title="Предмет оферты">
        <p style={{margin: 0}}>
          Исполнитель оказывает услуги по подбору и замене масла, технических жидкостей и сопутствующих
          расходников. Оформление заявки на сайте, по телефону или через мессенджер означает принятие условий
          настоящей оферты.
        </p>
      </LegalBlock>

      <LegalBlock title="Порядок записи и оказания услуг">
        <LegalList items={[
          'клиент оставляет заявку, указывает контактные данные и сведения об автомобиле;',
          'исполнитель подтверждает запись, перечень работ, ориентировочную стоимость и время визита;',
          'окончательная стоимость зависит от выбранных материалов, фактического объёма работ и состояния автомобиля;',
          'услуга оказывается после согласования работ с клиентом.',
        ]} />
      </LegalBlock>

      <LegalBlock title="Оплата и отмена записи">
        <p style={{margin: 0}}>
          Оплата производится после оказания услуги наличными, банковской картой или иным согласованным способом.
          Клиент может перенести или отменить запись, предупредив исполнителя заранее по телефону {LEGAL_PHONE}.
        </p>
      </LegalBlock>

      <LegalBlock title="Ответственность">
        <p style={{margin: 0}}>
          Исполнитель отвечает за качество выполненных работ в пределах фактически оказанных услуг. Клиент
          обязан предоставить достоверные данные об автомобиле и сообщить об известных неисправностях,
          которые могут повлиять на подбор материалов или выполнение работ.
        </p>
      </LegalBlock>
    </LegalShell>
  );
}



// ====================================================================
//  app.jsx — router + mount
// ====================================================================

function useHashRoute() {
  const parse = () => {
    if (typeof window === 'undefined') return '/';
    const h = window.location.hash.replace(/^#/, '') || '/';
    return h;
  };
  const [path, setPath] = useState(parse());
  const [state, setState] = useState({});

  useEffect(() => {
    const onHash = () => { setPath(parse()); window.scrollTo({ top: 0, behavior: 'auto' }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (to, st = {}) => {
    setState(st);
    window.location.hash = to;
    if (window.location.hash === '#' + to) {
      // already same hash — force scroll
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  // Parse params
  const segs = path.split('/').filter(Boolean);
  const params = {};
  if (segs[0] === 'product' && segs[1]) params.id = segs[1];
  if (segs[0] === 'case' && segs[1]) params.id = segs[1];

  return { path, go, state, params };
}

function App() {
  const router = useHashRoute();
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [catalogStatus, setCatalogStatus] = useState('loading');
  const [catalogError, setCatalogError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCatalogStatus('loading');
    setCatalogError('');

    apiGet('/api/oils?limit=1000')
      .then(data => {
        const oils = Array.isArray(data?.items) ? data.items : [];
        if (cancelled) return;
        if (oils.length === 0) throw new Error('Каталог масел из эко-платформы пуст.');
        OILS = oils;
        window.OILS = oils;
        setCatalogVersion(version => version + 1);
        setCatalogStatus('ready');
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('[catalog] Не удалось обновить масла:', error.message);
        OILS = DEMO_OILS;
        window.OILS = DEMO_OILS;
        setCatalogError(error.message || 'Не удалось загрузить каталог масел.');
        setCatalogStatus('ready');
      });

    return () => { cancelled = true; };
  }, []);

  const seg = router.path.split('/').filter(Boolean);
  let page;
  if (router.path === '/' || router.path === '') page = <HomePage />;
  else if (seg[0] === 'privacy') page = <PrivacyPage />;
  else if (seg[0] === 'offer') page = <OfferPage />;
  else if (catalogStatus === 'loading') page = <CatalogGate title="Загружаем каталог масел" />;
  else if (catalogStatus === 'error') page = <CatalogGate title="Каталог эко-платформы недоступен" text={catalogError} />;
  else if (seg[0] === 'vin') page = <VinPage />;
  else if (seg[0] === 'shop') page = <ShopPage />;
  else if (seg[0] === 'product') page = <ProductPage />;
  else if (seg[0] === 'cases') page = <CasesPage />;
  else if (seg[0] === 'case') page = <CasePage />;
  else if (seg[0] === 'team') page = <TeamPage />;
  else if (seg[0] === 'contacts') page = <ContactsPage />;
  else if (seg[0] === 'account') page = <AccountPage />;
  else page = <HomePage />;

  return (
    <RouterCtx.Provider value={{ ...router, catalogVersion }}>
      <TopBar />
      {page}
      <Footer />
    </RouterCtx.Provider>
  );
}


function CatalogGate({ title, text }) {
  return (
    <main style={{background: '#F5F2ED', color: '#0a0a0a', minHeight: '70vh', padding: '90px 0'}}>
      <div className="container">
        <div className="t-eyebrow" style={{marginBottom: 16}}>Каталог</div>
        <h1 style={{fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(38px, 6vw, 72px)', lineHeight: 0.95, margin: 0, textTransform: 'uppercase'}}>
          {title}<span style={{color: '#C2410C'}}>.</span>
        </h1>
        {text && <p style={{maxWidth: 560, marginTop: 18, color: '#6B6B6B', fontSize: 16, lineHeight: 1.55}}>{text}</p>}
      </div>
    </main>
  );
}


export default App;
