export type DiagnosticReportStatus = "NOT_CHECKED" | "GREEN" | "YELLOW" | "RED" | "SKIPPED";
export type DiagnosticReportTone = "success" | "warning" | "danger" | "neutral";

export type DiagnosticReportPositionInput = {
  node: string;
  status: string;
  tags?: string[] | null;
  measurementValue?: number | string | { toString(): string } | null;
  measurementUnit?: string | null;
  recommendation?: string | null;
};

export type DiagnosticReportDiagnosticInput = {
  completedAt?: Date | string | null;
  startedAt?: Date | string | null;
};

export type DiagnosticReportOfferInput = {
  title: string;
  nextVisitOnly?: boolean;
  variants?: { label?: string | null; priceRub?: number | null }[] | null;
};

export type DiagnosticReportCopyNode = {
  clientTitle: string;
  plainName: string;
  whatWeChecked: string;
  greenText: string;
  yellowText: string;
  redText: string;
  skippedText: string;
  tagLabels: Record<string, string>;
  tagExplanations: Record<string, string>;
  measurementText?: (value: number, unit?: string | null, status?: string) => string | null;
  recommendationTemplates: Record<string, string>;
  urgency: {
    GREEN: string;
    YELLOW: string;
    RED: string;
    SKIPPED: string;
  };
  ctaLabel: {
    GREEN?: string;
    YELLOW: string;
    RED: string;
    SKIPPED?: string;
  };
};

export type DiagnosticReportItemText = {
  title: string;
  statusLabel: string;
  statusTone: DiagnosticReportTone;
  summary: string;
  found: string[];
  explanation: string;
  recommendation: string;
  urgency: string;
  ctaLabel?: string;
  measurementText?: string;
};

const STATUS_LABELS: Record<Exclude<DiagnosticReportStatus, "NOT_CHECKED">, string> = {
  GREEN: "В норме",
  YELLOW: "Требует внимания",
  RED: "Рекомендуем заменить",
  SKIPPED: "Не проверялось",
};

const STATUS_TONES: Record<string, DiagnosticReportTone> = {
  GREEN: "success",
  YELLOW: "warning",
  RED: "danger",
  SKIPPED: "neutral",
};

const commonRecommendations = {
  control: "Рекомендуем контролировать состояние при следующем сервисном визите.",
  diagnostic: "Рекомендуем дополнительную диагностику и согласование дальнейших действий с мастером.",
  nextVisit: "Рекомендуем запланировать обслуживание на следующий визит.",
};

const fluidTagExplanations = {
  slight_dark: "Жидкость начала терять рабочие свойства.",
  strong_dark: "Жидкость заметно загрязнена и требует обслуживания.",
  burnt_smell: "Запах гари может указывать на перегрев или повышенную нагрузку.",
  metal_particles: "Металлические частицы — повод для дополнительной диагностики.",
  emulsion: "Эмульсия может говорить о попадании влаги или смешении жидкостей.",
  leak: "Следы подтёков стоит проверить повторно и устранить причину при подтверждении.",
};

function brakeFluidMeasurementText(value: number): string {
  if (value < 2) return "Влажность тормозной жидкости в норме.";
  if (value <= 3) return "Влажность повышена. Рекомендуем запланировать замену тормозной жидкости.";
  return "Влажность высокая. Рекомендуем заменить тормозную жидкость в ближайшее время.";
}

function coolantMeasurementText(value: number): string {
  if (value <= -35) return "Температура замерзания антифриза в норме.";
  if (value <= -20) return "Защитные свойства антифриза снижены. Рекомендуем контролировать состояние.";
  return "Антифриз требует замены: защита от замерзания недостаточная.";
}

export const DIAGNOSTIC_REPORT_COPY: Record<string, DiagnosticReportCopyNode> = {
  engine_oil: {
    clientTitle: "Моторное масло",
    plainName: "моторное масло",
    whatWeChecked: "Проверили уровень и внешнее состояние моторного масла.",
    greenText: "Состояние моторного масла визуально в норме. Срочных действий не требуется.",
    yellowText:
      "Состояние моторного масла требует внимания. Рекомендуем контролировать уровень и состояние масла, а также запланировать замену при следующем визите.",
    redText:
      "Рекомендуем заменить моторное масло и масляный фильтр. По результатам проверки есть признаки, что масло потеряло рабочие свойства или требует обслуживания.",
    skippedText: "Проверка моторного масла не выполнялась.",
    tagLabels: {
      oil_dark: "Сильное потемнение",
      oil_low: "Низкий уровень",
      metal_particles: "Блёстки металла",
      metal_shavings: "Металлическая стружка",
    },
    tagExplanations: {
      oil_dark: "Масло заметно загрязнено и может хуже защищать двигатель.",
      oil_low: "Низкий уровень масла повышает риск ускоренного износа двигателя.",
      metal_particles: "Металлические частицы — повод для дополнительной диагностики.",
      metal_shavings: "Металлическая стружка — повод для дополнительной диагностики.",
    },
    recommendationTemplates: {
      "замена масла и фильтра": "Рекомендуем заменить моторное масло и масляный фильтр.",
      "доливка и контроль": "Рекомендуем долить масло до нормы и проконтролировать состояние.",
      defaultYellow: "Рекомендуем контролировать уровень и запланировать замену масла при следующем визите.",
      defaultRed: "Рекомендуем заменить моторное масло и масляный фильтр.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На ближайшем сервисном визите.",
      RED: "В ближайшее удобное время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  atf: {
    clientTitle: "АКПП / масло ATF",
    plainName: "масло ATF",
    whatWeChecked: "Проверили состояние трансмиссионной жидкости АКПП по внешним признакам.",
    greenText: "Состояние жидкости АКПП визуально в норме. Срочных действий не требуется.",
    yellowText:
      "Состояние жидкости АКПП требует внимания. Рекомендуем запланировать обслуживание и контролировать работу коробки передач.",
    redText:
      "Рекомендуем выполнить замену ATF в ближайшее время. Обнаружены признаки ухудшения состояния жидкости АКПП.",
    skippedText: "Проверка АКПП не выполнялась.",
    tagLabels: {
      atf_slight_dark: "Лёгкое потемнение",
      atf_slight_darkening: "Лёгкое потемнение",
      slight_dark: "Лёгкое потемнение",
      atf_heavy_dark: "Сильное потемнение",
      atf_strong_darkening: "Сильное потемнение",
      heavy_dark: "Сильное потемнение",
      burnt_smell: "Запах гари",
      atf_burnt_smell: "Запах гари",
      metal_shavings: "Металлическая стружка",
      atf_metal_particles: "Металлическая стружка",
      emulsion: "Эмульсия",
      atf_emulsion: "Эмульсия",
    },
    tagExplanations: {
      atf_slight_dark: fluidTagExplanations.slight_dark,
      atf_slight_darkening: fluidTagExplanations.slight_dark,
      slight_dark: fluidTagExplanations.slight_dark,
      atf_heavy_dark: fluidTagExplanations.strong_dark,
      atf_strong_darkening: fluidTagExplanations.strong_dark,
      heavy_dark: fluidTagExplanations.strong_dark,
      burnt_smell: fluidTagExplanations.burnt_smell,
      atf_burnt_smell: fluidTagExplanations.burnt_smell,
      metal_shavings: fluidTagExplanations.metal_particles,
      atf_metal_particles: fluidTagExplanations.metal_particles,
      emulsion: fluidTagExplanations.emulsion,
      atf_emulsion: fluidTagExplanations.emulsion,
    },
    recommendationTemplates: {
      "частичная замена atf": "Рекомендуем запланировать частичную замену ATF.",
      partial_atf: "Рекомендуем запланировать частичную замену ATF.",
      "аппаратная замена atf": "Рекомендуем аппаратную замену ATF после согласования с мастером.",
      full_atf: "Рекомендуем аппаратную замену ATF после согласования с мастером.",
      "диагностика акпп": "Рекомендуем дополнительную диагностику АКПП.",
      diagnostic: "Рекомендуем дополнительную диагностику АКПП.",
      defaultYellow: "Рекомендуем запланировать обслуживание ATF на ближайший сервисный визит.",
      defaultRed: "Рекомендуем выполнить замену ATF в ближайшее время.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На ближайшем сервисном визите.",
      RED: "В ближайшее время после согласования с мастером.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать работы" },
  },
  mtf: {
    clientTitle: "МКПП / масло",
    plainName: "масло МКПП",
    whatWeChecked: "Проверили внешние признаки состояния масла механической коробки передач.",
    greenText: "Состояние масла МКПП визуально в норме.",
    yellowText: "Есть признаки, требующие контроля масла МКПП. Рекомендуем проверить состояние при следующем визите.",
    redText: "Рекомендуем обслуживание масла МКПП и дополнительную проверку работы коробки.",
    skippedText: "Проверка МКПП не выполнялась.",
    tagLabels: {
      mtf_dark: "Потемнение",
      dark: "Потемнение",
      mtf_grinding: "Хруст при включении",
      grinding: "Хруст при включении",
    },
    tagExplanations: {
      mtf_dark: "Потемнение может указывать на загрязнение масла.",
      dark: "Потемнение может указывать на загрязнение масла.",
      mtf_grinding: "Хруст при включении — повод проверить работу коробки.",
      grinding: "Хруст при включении — повод проверить работу коробки.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем проверить масло МКПП при следующем визите.",
      defaultRed: "Рекомендуем обслуживание масла МКПП и дополнительную проверку коробки.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать проверку" },
  },
  front_diff: {
    clientTitle: "Передний редуктор",
    plainName: "передний редуктор",
    whatWeChecked: "Проверили внешние признаки состояния масла и герметичность переднего редуктора.",
    greenText: "Передний редуктор визуально в норме.",
    yellowText: "Состояние масла редуктора требует внимания. Рекомендуем контролировать состояние и проверить наличие подтёков.",
    redText: "Рекомендуем заменить масло редуктора и проверить герметичность узла.",
    skippedText: "Проверка переднего редуктора не выполнялась.",
    tagLabels: { diff_dark: "Потемнение", dark: "Потемнение", diff_leak: "Подтёки", leak: "Подтёки" },
    tagExplanations: {
      diff_dark: "Потемнение может указывать на загрязнение масла.",
      dark: "Потемнение может указывать на загрязнение масла.",
      diff_leak: fluidTagExplanations.leak,
      leak: fluidTagExplanations.leak,
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем контролировать состояние масла редуктора и проверить наличие подтёков.",
      defaultRed: "Рекомендуем заменить масло переднего редуктора и проверить герметичность узла.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  rear_diff: {
    clientTitle: "Задний редуктор",
    plainName: "задний редуктор",
    whatWeChecked: "Проверили внешние признаки состояния масла и герметичность заднего редуктора.",
    greenText: "Задний редуктор визуально в норме.",
    yellowText: "Состояние масла редуктора требует внимания. Рекомендуем контролировать состояние и проверить наличие подтёков.",
    redText: "Рекомендуем заменить масло редуктора и проверить герметичность узла.",
    skippedText: "Проверка заднего редуктора не выполнялась.",
    tagLabels: { diff_dark: "Потемнение", dark: "Потемнение", diff_leak: "Подтёки", leak: "Подтёки" },
    tagExplanations: {
      diff_dark: "Потемнение может указывать на загрязнение масла.",
      dark: "Потемнение может указывать на загрязнение масла.",
      diff_leak: fluidTagExplanations.leak,
      leak: fluidTagExplanations.leak,
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем контролировать состояние масла редуктора и проверить наличие подтёков.",
      defaultRed: "Рекомендуем заменить масло заднего редуктора и проверить герметичность узла.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  transfer_case: {
    clientTitle: "Раздаточная коробка",
    plainName: "раздаточная коробка",
    whatWeChecked: "Проверили внешние признаки состояния масла раздаточной коробки.",
    greenText: "Раздаточная коробка визуально в норме.",
    yellowText: "Есть признаки, требующие контроля раздаточной коробки.",
    redText: "Рекомендуем заменить масло раздаточной коробки и проверить узел на шумы/подтёки.",
    skippedText: "Проверка раздаточной коробки не выполнялась.",
    tagLabels: { tc_dark: "Потемнение", dark: "Потемнение", tc_noise: "Шум", noise: "Шум" },
    tagExplanations: {
      tc_dark: "Потемнение может указывать на загрязнение масла.",
      dark: "Потемнение может указывать на загрязнение масла.",
      tc_noise: "Шум — повод проверить состояние узла.",
      noise: "Шум — повод проверить состояние узла.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем проконтролировать раздаточную коробку при следующем визите.",
      defaultRed: "Рекомендуем заменить масло раздаточной коробки и проверить узел на шумы или подтёки.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать работы" },
  },
  coolant: {
    clientTitle: "Антифриз / охлаждающая жидкость",
    plainName: "антифриз",
    whatWeChecked: "Проверили уровень, внешний вид и защитные свойства охлаждающей жидкости.",
    greenText: "Состояние охлаждающей жидкости визуально в норме.",
    yellowText: "Состояние охлаждающей жидкости требует внимания. Рекомендуем контролировать уровень и защитные свойства.",
    redText: "Рекомендуем заменить охлаждающую жидкость. Текущие признаки могут указывать на снижение защитных свойств антифриза.",
    skippedText: "Проверка охлаждающей жидкости не выполнялась.",
    tagLabels: { coolant_low: "Низкий уровень", low: "Низкий уровень", coolant_rust: "Ржавчина / осадок", rust: "Ржавчина / осадок" },
    tagExplanations: {
      coolant_low: "Низкий уровень охлаждающей жидкости требует контроля герметичности системы.",
      low: "Низкий уровень охлаждающей жидкости требует контроля герметичности системы.",
      coolant_rust: "Ржавчина или осадок могут указывать на ухудшение защитных свойств.",
      rust: "Ржавчина или осадок могут указывать на ухудшение защитных свойств.",
    },
    measurementText: coolantMeasurementText,
    recommendationTemplates: {
      defaultYellow: "Рекомендуем контролировать уровень и защитные свойства антифриза.",
      defaultRed: "Рекомендуем заменить охлаждающую жидкость.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На ближайшем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  brake_fluid: {
    clientTitle: "Тормозная жидкость",
    plainName: "тормозная жидкость",
    whatWeChecked: "Проверили влажность и состояние тормозной жидкости.",
    greenText: "Влажность тормозной жидкости в норме.",
    yellowText: "Тормозная жидкость требует внимания. Рекомендуем запланировать замену, так как жидкость со временем накапливает влагу.",
    redText: "Рекомендуем заменить тормозную жидкость в ближайшее время. Повышенная влажность снижает эффективность тормозной системы.",
    skippedText: "Проверка тормозной жидкости не выполнялась.",
    tagLabels: { bf_old: "Давно не менялась", old: "Давно не менялась", old_year: "Давно не менялась" },
    tagExplanations: {
      bf_old: "Тормозная жидкость со временем накапливает влагу и теряет свойства.",
      old: "Тормозная жидкость со временем накапливает влагу и теряет свойства.",
      old_year: "Тормозная жидкость со временем накапливает влагу и теряет свойства.",
    },
    measurementText: brakeFluidMeasurementText,
    recommendationTemplates: {
      "замена тормозной жидкости": "Рекомендуем заменить тормозную жидкость.",
      defaultYellow: "Рекомендуем запланировать замену тормозной жидкости.",
      defaultRed: "Рекомендуем заменить тормозную жидкость в ближайшее время.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На ближайшем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  power_steering: {
    clientTitle: "ГУР / усилитель руля",
    plainName: "система усилителя руля",
    whatWeChecked: "Проверили внешние признаки состояния жидкости усилителя руля.",
    greenText: "Система усилителя руля визуально в норме.",
    yellowText: "Есть признаки, требующие контроля жидкости усилителя руля.",
    redText: "Рекомендуем проверить систему усилителя руля и устранить возможные подтёки или шум.",
    skippedText: "Проверка усилителя руля не выполнялась.",
    tagLabels: { ps_leak: "Подтёки", leak: "Подтёки", ps_noise: "Гул насоса", noise: "Гул насоса" },
    tagExplanations: {
      ps_leak: "Подтёки требуют повторной проверки герметичности.",
      leak: "Подтёки требуют повторной проверки герметичности.",
      ps_noise: "Шум или гул — повод проверить систему усилителя руля.",
      noise: "Шум или гул — повод проверить систему усилителя руля.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем контролировать жидкость усилителя руля.",
      defaultRed: "Рекомендуем проверить систему усилителя руля и устранить возможные подтёки или шум.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать проверку" },
  },
  washer: {
    clientTitle: "Жидкость омывателя",
    plainName: "жидкость омывателя",
    whatWeChecked: "Проверили уровень жидкости омывателя.",
    greenText: "Уровень жидкости омывателя в норме.",
    yellowText: "Уровень жидкости омывателя требует внимания.",
    redText: "Рекомендуем долить жидкость омывателя.",
    skippedText: "Проверка жидкости омывателя не выполнялась.",
    tagLabels: { washer_empty: "Пустой бачок", empty: "Пустой бачок" },
    tagExplanations: {
      washer_empty: "Без жидкости омывателя ухудшается обзор через стекло.",
      empty: "Без жидкости омывателя ухудшается обзор через стекло.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем долить жидкость омывателя при удобном случае.",
      defaultRed: "Рекомендуем долить жидкость омывателя.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "При ближайшей возможности.",
      RED: "Сейчас или перед поездкой.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Долить жидкость" },
  },
  brakes_visual: {
    clientTitle: "Тормозные колодки / диски",
    plainName: "тормозные элементы",
    whatWeChecked: "Визуально проверили состояние тормозных колодок и дисков.",
    greenText: "Тормозные элементы визуально в норме.",
    yellowText: "Есть признаки износа тормозных элементов. Рекомендуем контролировать состояние.",
    redText: "Рекомендуем заменить изношенные элементы тормозной системы после согласования с мастером.",
    skippedText: "Визуальная проверка тормозов не выполнялась.",
    tagLabels: { pads_low: "Износ колодок", disc_rust: "Коррозия дисков", rust: "Коррозия дисков" },
    tagExplanations: {
      pads_low: "Остаток колодок стоит контролировать, чтобы не пропустить срок замены.",
      disc_rust: "Коррозия дисков может влиять на комфорт и эффективность торможения.",
      rust: "Коррозия дисков может влиять на комфорт и эффективность торможения.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем контролировать состояние тормозных элементов.",
      defaultRed: "Рекомендуем заменить изношенные элементы тормозной системы после согласования с мастером.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время после согласования.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  cv_boots: {
    clientTitle: "Пыльники ШРУС",
    plainName: "пыльники ШРУС",
    whatWeChecked: "Визуально проверили состояние пыльников приводов.",
    greenText: "Пыльники ШРУС визуально в норме.",
    yellowText: "Есть признаки износа или повреждения пыльников. Рекомендуем контролировать состояние.",
    redText: "Рекомендуем заменить повреждённый пыльник, чтобы избежать попадания грязи и износа ШРУС.",
    skippedText: "Проверка пыльников ШРУС не выполнялась.",
    tagLabels: { cv_crack: "Трещины пыльника", crack: "Трещины пыльника", cv_leak: "Выдавлена смазка", leak: "Выдавлена смазка" },
    tagExplanations: {
      cv_crack: "Трещины могут привести к попаданию грязи внутрь узла.",
      crack: "Трещины могут привести к попаданию грязи внутрь узла.",
      cv_leak: "Следы смазки говорят о возможной потере герметичности.",
      leak: "Следы смазки говорят о возможной потере герметичности.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем контролировать состояние пыльников.",
      defaultRed: "Рекомендуем заменить повреждённый пыльник.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  visible_leaks: {
    clientTitle: "Видимые течи",
    plainName: "видимые подтёки",
    whatWeChecked: "Визуально проверили доступные зоны на следы подтёков.",
    greenText: "Выраженных видимых течей не обнаружено.",
    yellowText: "Обнаружены следы возможных подтёков. Рекомендуем наблюдение и повторную проверку.",
    redText: "Обнаружены выраженные подтёки. Рекомендуем диагностику и устранение причины.",
    skippedText: "Проверка видимых течей не выполнялась.",
    tagLabels: { leak_oil: "Подтёки масла", oil: "Подтёки масла", leak_coolant: "Подтёки ОЖ", coolant: "Подтёки ОЖ" },
    tagExplanations: {
      leak_oil: "Следы масла требуют повторной проверки источника.",
      oil: "Следы масла требуют повторной проверки источника.",
      leak_coolant: "Следы охлаждающей жидкости требуют проверки герметичности системы.",
      coolant: "Следы охлаждающей жидкости требуют проверки герметичности системы.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем наблюдение и повторную проверку подтёков.",
      defaultRed: "Рекомендуем диагностику и устранение причины подтёков.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать диагностику" },
  },
  survey_cabin_filter: {
    clientTitle: "Салонный фильтр",
    plainName: "салонный фильтр",
    whatWeChecked: "Уточнили срок последней замены салонного фильтра.",
    greenText: "По сроку замены салонного фильтра вопросов нет.",
    yellowText: "Салонный фильтр давно не менялся. Рекомендуем заменить на следующем визите.",
    redText: "Рекомендуем заменить салонный фильтр для улучшения качества воздуха в салоне.",
    skippedText: "Опрос по салонному фильтру не выполнялся.",
    tagLabels: { cabin_old_year: "Не менялся больше года", old_year: "Не менялся больше года" },
    tagExplanations: {
      cabin_old_year: "Салонный фильтр со временем хуже задерживает пыль и запахи.",
      old_year: "Салонный фильтр со временем хуже задерживает пыль и запахи.",
    },
    recommendationTemplates: {
      "салонный фильтр": "Рекомендуем заменить салонный фильтр.",
      defaultYellow: "Рекомендуем заменить салонный фильтр на следующем визите.",
      defaultRed: "Рекомендуем заменить салонный фильтр.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем визите.",
      RED: "При ближайшем обслуживании.",
      SKIPPED: "Можно уточнить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  survey_air_filter: {
    clientTitle: "Воздушный фильтр",
    plainName: "воздушный фильтр",
    whatWeChecked: "Уточнили состояние или срок замены воздушного фильтра.",
    greenText: "По воздушному фильтру вопросов нет.",
    yellowText: "Воздушный фильтр загрязнён. Рекомендуем запланировать замену.",
    redText: "Рекомендуем заменить воздушный фильтр. Загрязнённый фильтр может ухудшать работу двигателя.",
    skippedText: "Опрос по воздушному фильтру не выполнялся.",
    tagLabels: { air_dirty: "Загрязнён", dirty: "Загрязнён" },
    tagExplanations: {
      air_dirty: "Загрязнённый фильтр может ограничивать поток воздуха к двигателю.",
      dirty: "Загрязнённый фильтр может ограничивать поток воздуха к двигателю.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем запланировать замену воздушного фильтра.",
      defaultRed: "Рекомендуем заменить воздушный фильтр.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем визите.",
      RED: "При ближайшем обслуживании.",
      SKIPPED: "Можно уточнить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать замену" },
  },
  survey_sparks: {
    clientTitle: "Свечи зажигания",
    plainName: "свечи зажигания",
    whatWeChecked: "Уточнили срок замены свечей зажигания.",
    greenText: "По сроку замены свечей вопросов нет.",
    yellowText: "Неизвестен срок замены свечей. Рекомендуем проверить регламент и запланировать обслуживание.",
    redText: "Рекомендуем проверить и при необходимости заменить свечи зажигания.",
    skippedText: "Опрос по свечам зажигания не выполнялся.",
    tagLabels: { sparks_unknown: "Неизвестно когда менялись", unknown: "Неизвестно когда менялись" },
    tagExplanations: {
      sparks_unknown: "Если срок замены неизвестен, лучше свериться с регламентом обслуживания.",
      unknown: "Если срок замены неизвестен, лучше свериться с регламентом обслуживания.",
    },
    recommendationTemplates: {
      defaultYellow: "Рекомендуем проверить регламент свечей и запланировать обслуживание.",
      defaultRed: "Рекомендуем проверить и при необходимости заменить свечи зажигания.",
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем визите.",
      RED: "При ближайшем обслуживании.",
      SKIPPED: "Можно уточнить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать проверку" },
  },
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[ё]/g, "е").replace(/[-\s]+/g, "_");
}

function normalizeTextKey(value: string): string {
  return value.trim().toLowerCase().replace(/[ё]/g, "е").replace(/\s+/g, " ");
}

function toNumber(value: DiagnosticReportPositionInput["measurementValue"]): number | null {
  if (value == null) return null;
  const raw = typeof value === "number" ? value : Number(value.toString().replace(",", "."));
  return Number.isFinite(raw) ? raw : null;
}

function asSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function fallbackCopy(node: string): DiagnosticReportCopyNode {
  return {
    clientTitle: "Дополнительная проверка",
    plainName: node,
    whatWeChecked: "Проверили дополнительный пункт диагностики.",
    greenText: "По этому пункту замечаний нет.",
    yellowText: "Пункт требует внимания и контроля при следующем визите.",
    redText: "Рекомендуем согласовать обслуживание по этому пункту.",
    skippedText: "Проверка этого пункта не выполнялась.",
    tagLabels: {},
    tagExplanations: {},
    recommendationTemplates: {
      defaultYellow: commonRecommendations.control,
      defaultRed: commonRecommendations.diagnostic,
    },
    urgency: {
      GREEN: "Действий не требуется.",
      YELLOW: "На следующем сервисном визите.",
      RED: "В ближайшее время.",
      SKIPPED: "Можно проверить при следующем визите.",
    },
    ctaLabel: { YELLOW: "Поставить напоминание", RED: "Согласовать работы" },
  };
}

function labelForTag(copy: DiagnosticReportCopyNode, code: string): string {
  const normalized = normalizeKey(code);
  return copy.tagLabels[code] ?? copy.tagLabels[normalized] ?? "Дополнительный признак";
}

function explanationForTag(copy: DiagnosticReportCopyNode, code: string): string | null {
  const normalized = normalizeKey(code);
  return copy.tagExplanations[code] ?? copy.tagExplanations[normalized] ?? null;
}

function recommendationFromTemplate(copy: DiagnosticReportCopyNode, position: DiagnosticReportPositionInput): string {
  const status = position.status;
  const explicit = position.recommendation?.trim();
  if (explicit) {
    const exact = copy.recommendationTemplates[explicit];
    const textKey = copy.recommendationTemplates[normalizeTextKey(explicit)];
    const codeKey = copy.recommendationTemplates[normalizeKey(explicit)];
    if (exact || textKey || codeKey) return exact ?? textKey ?? codeKey;
    if (/[_-]/.test(explicit) && !/\s/.test(explicit)) {
      return status === "RED"
        ? copy.recommendationTemplates.defaultRed ?? commonRecommendations.diagnostic
        : copy.recommendationTemplates.defaultYellow ?? commonRecommendations.control;
    }
    return asSentence(explicit);
  }
  if (status === "RED") return copy.recommendationTemplates.defaultRed ?? commonRecommendations.diagnostic;
  if (status === "YELLOW") return copy.recommendationTemplates.defaultYellow ?? commonRecommendations.control;
  if (status === "GREEN") return copy.recommendationTemplates.defaultGreen ?? "Действий не требуется.";
  return copy.recommendationTemplates.defaultSkipped ?? "Пункт можно проверить при следующем визите.";
}

export function diagnosticReportTagLabels(node: string, codes: string[]): string[] {
  const copy = DIAGNOSTIC_REPORT_COPY[node] ?? fallbackCopy(node);
  return codes.map((code) => labelForTag(copy, code));
}

export function buildDiagnosticReportItemText(
  position: DiagnosticReportPositionInput,
  _diagnostic?: DiagnosticReportDiagnosticInput,
  options?: { offer?: DiagnosticReportOfferInput | null }
): DiagnosticReportItemText {
  const copy = DIAGNOSTIC_REPORT_COPY[position.node] ?? fallbackCopy(position.node);
  const status = position.status as DiagnosticReportStatus;
  const statusLabel = status === "NOT_CHECKED" ? "Не проверялось" : STATUS_LABELS[status] ?? "Есть рекомендация";
  const measurementValue = toNumber(position.measurementValue);
  const measurementText = measurementValue == null ? null : copy.measurementText?.(measurementValue, position.measurementUnit, status) ?? null;
  const tagCodes = position.tags ?? [];
  const found = tagCodes.map((code) => labelForTag(copy, code));
  const explanations = tagCodes
    .map((code) => explanationForTag(copy, code))
    .filter((value): value is string => Boolean(value));
  if (measurementText) found.push(measurementText);

  const statusSummary =
    status === "GREEN"
      ? copy.greenText
      : status === "RED"
        ? copy.redText
        : status === "YELLOW"
          ? copy.yellowText
          : copy.skippedText;
  const recommendation = recommendationFromTemplate(copy, position);
  const offerText = options?.offer?.title?.trim();
  const recommendationWithOffer =
    offerText && !recommendation.toLowerCase().includes(offerText.toLowerCase())
      ? `${recommendation} Предложение сервиса: ${offerText}.`
      : recommendation;

  return {
    title: copy.clientTitle,
    statusLabel,
    statusTone: STATUS_TONES[status] ?? "neutral",
    summary: statusSummary,
    found: found.length > 0 ? found : [status === "RED" ? "Требуется обслуживание" : status === "YELLOW" ? "Требуется контроль" : statusLabel],
    explanation: explanations.length > 0 ? [statusSummary, ...explanations].join(" ") : statusSummary,
    recommendation: recommendationWithOffer,
    urgency: copy.urgency[status as Exclude<DiagnosticReportStatus, "NOT_CHECKED">] ?? copy.urgency.YELLOW,
    ctaLabel: status === "RED" ? copy.ctaLabel.RED : status === "YELLOW" ? copy.ctaLabel.YELLOW : copy.ctaLabel.GREEN,
    measurementText: measurementText ?? undefined,
  };
}
