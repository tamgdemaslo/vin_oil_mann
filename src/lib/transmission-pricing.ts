export const TRANSMISSION_PRICE_TERMS = "Указана стоимость работы. Масло, фильтры и расходные материалы оплачиваются отдельно. Выставление уровня масла входит в стоимость. Итоговую сумму с учётом материалов согласуем до начала работ.";

export const TRANSMISSION_PRICE_GROUPS = [
  {
    method: "partial",
    title: "Частичная замена",
    branches: "На Гагарина, 116 и Дачной, 6В",
    rows: [
      { filters: 0, label: "Без замены фильтра", shop: 3500, customer: 5000 },
      { filters: 1, label: "С заменой одного фильтра", shop: 5250, customer: 7500 },
      { filters: 2, label: "С заменой двух фильтров", shop: 7000, customer: 10000 },
    ],
  },
  {
    method: "hardware",
    title: "Аппаратная замена",
    branches: "Только на Дачной, 6В",
    rows: [
      { filters: 0, label: "Без замены фильтра", shop: 5500, customer: 7500 },
      { filters: 1, label: "С заменой одного фильтра", shop: 7000, customer: 10000 },
      { filters: 2, label: "С заменой двух фильтров", shop: 8750, customer: 12500 },
    ],
  },
] as const;
