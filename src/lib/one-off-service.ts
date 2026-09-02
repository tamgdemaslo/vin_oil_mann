import {
  SALES_ANALYTICS_METRIC_BY_CODE,
  metricOptions,
  type ServiceAggregateType,
  type ServiceConfiguration,
  type ServiceProcedure,
} from "@/lib/sales-analytics-taxonomy";

export const ONE_OFF_SERVICE_AGGREGATES: readonly { value: ServiceAggregateType; label: string }[] = [
  { value: "AUTOMATIC", label: "АКПП" },
  { value: "CVT", label: "Вариатор (CVT)" },
  { value: "DCT_DSG", label: "Робот / DSG" },
  { value: "MANUAL", label: "МКПП" },
  { value: "UNKNOWN", label: "Не указано" },
] as const;

export const ONE_OFF_SERVICE_PROCEDURES: readonly { value: ServiceProcedure; label: string }[] = [
  { value: "PARTIAL", label: "Частичная" },
  { value: "MACHINE", label: "Аппаратная" },
  { value: "STANDARD", label: "Стандартная" },
  { value: "UNKNOWN", label: "Не указано" },
] as const;

export const ONE_OFF_SERVICE_CONFIGURATIONS: readonly { value: ServiceConfiguration; label: string }[] = [
  { value: "NO_PAN", label: "Без снятия поддона" },
  { value: "PAN_AND_FILTER", label: "Поддон и фильтр" },
  { value: "TWO_FILTERS", label: "Два фильтра" },
  { value: "OTHER", label: "Другая конфигурация" },
  { value: "UNKNOWN", label: "Не указано" },
] as const;

export const ONE_OFF_SERVICE_METRICS = metricOptions("SERVICE_OPERATION").map((metric) => ({
  code: metric.code,
  label: metric.title,
}));

export type OneOffServiceInput = {
  analyticsMetricCode?: string;
  aggregateType?: ServiceAggregateType | string | null;
  procedure?: ServiceProcedure | string | null;
  configuration?: ServiceConfiguration | string | null;
  classificationVersion?: number | null;
};

export type NormalizedOneOffService = {
  analyticsMetricCode: string;
  aggregateType: ServiceAggregateType | null;
  procedure: ServiceProcedure | null;
  configuration: ServiceConfiguration | null;
  classificationVersion: number;
};

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().toUpperCase();
  if (!allowed.includes(normalized as T)) throw new Error(`Недопустимое значение поля «${field}»`);
  return normalized as T;
}

export function normalizeOneOffServiceInput(input: OneOffServiceInput): NormalizedOneOffService {
  const analyticsMetricCode = String(input.analyticsMetricCode ?? "").trim().toUpperCase();
  const metric = SALES_ANALYTICS_METRIC_BY_CODE.get(analyticsMetricCode);
  if (!metric || metric.type !== "SERVICE_OPERATION" || !metric.active) {
    throw new Error("Выберите аналитическую категорию разовой услуги");
  }

  const aggregateType = enumValue(
    input.aggregateType,
    ONE_OFF_SERVICE_AGGREGATES.map((item) => item.value),
    "Тип агрегата",
  );
  const procedure = enumValue(
    input.procedure,
    ONE_OFF_SERVICE_PROCEDURES.map((item) => item.value),
    "Способ выполнения",
  );
  const configuration = enumValue(
    input.configuration,
    ONE_OFF_SERVICE_CONFIGURATIONS.map((item) => item.value),
    "Конфигурация",
  );

  if (analyticsMetricCode === "TRANSMISSION_FLUID_SERVICE") {
    return {
      analyticsMetricCode,
      aggregateType: aggregateType ?? "UNKNOWN",
      procedure: procedure ?? "UNKNOWN",
      configuration: configuration ?? "UNKNOWN",
      classificationVersion: 1,
    };
  }

  return {
    analyticsMetricCode,
    aggregateType,
    procedure,
    configuration,
    classificationVersion: 1,
  };
}
