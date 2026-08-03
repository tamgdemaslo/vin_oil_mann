export type PosterWork = {
  name: string;
  price: number;
  qty: number;
  /** Сумма скидки по строке, ₽ (для зачёркнутой цены) */
  discount: number;
  sum: number;
};

export type PosterPart = {
  name: string;
  price: number;
  qty: number;
  discount: number;
  sum: number;
};

export type PosterHistoryRow = {
  date: string;
  km: number | null;
  note: string;
};

export type JobOrderPosterModel = {
  number: string;
  date: string;
  city: string;
  point: string;
  ip: {
    name: string;
    inn: string;
    ogrn: string;
    address: string;
    phone: string;
    site: string;
    tg: string;
  };
  master: { name: string };
  ecoUser: string;
  client: {
    name: string;
    phone: string;
    /** Заезды на этом авто — для «N-й заезд с …» */
    visits: number;
    sinceVisit: string;
    history: PosterHistoryRow[];
    /** Всего заездов клиента по телефону (синк applicable) — под исполнителем */
    lifetimeVisits: number;
    /** Год первого заезда по телефону — «с 2023» */
    lifetimeSinceYear: string;
  };
  car: {
    make: string;
    model: string;
    year: string;
    plate: string;
    vin: string;
    mileage: number;
  };
  works: PosterWork[];
  parts: PosterPart[];
  worksTotal: number;
  partsTotal: number;
  grandTotal: number;
  payMethod: string;
  next: {
    date: string;
    mileage: number;
    intervalKm: number;
    intervalMonths: number;
  };
  warrantyUntil: string;
  warrantyDays: number;
  milestone: { value: number; leftKm: number };
  /** Короткая подпись для подкапотных бирок (моторное масло и т.д.) */
  oilTagLine: string;
  /** Явно заданный объём для подкапотной бирки из доп. поля отгрузки «Объем». */
  oilTagVolume: string;
};
