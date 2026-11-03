import type { AvitoSettingsView } from "./types";

export function avitoFeedBlocker(enabled: boolean, hasReviewedFeed: boolean) {
  if (!enabled) return {
    code: "AVITO_FEED_PAUSED",
    message: "Выдача файла выключена в платформе. Включите «Разрешить автовыгрузку по ссылке» и сохраните настройки текущего филиала.",
  };
  if (!hasReviewedFeed) return {
    code: "AVITO_FEED_NOT_REVIEWED",
    message: "Первый файл ещё не сформирован. Откройте «Склад → Авито», выберите товары и нажмите «Сформировать файл». Товары с ошибками будут пропущены.",
  };
  return null;
}

/** This status describes only local XML setup, never Avito acceptance or API access. */
export function avitoLinkStatus(settings: Pick<AvitoSettingsView, "configured" | "enabled" | "lastExportAt"> | null | undefined) {
  if (!settings) return { label: "Загружаем настройки XML", tone: "neutral" as const };
  if (!settings.configured) return { label: "XML: нужны настройки", tone: "warning" as const };
  if (!settings.enabled) return { label: "XML-ссылка выключена", tone: "neutral" as const };
  if (!settings.lastExportAt) return { label: "XML: подготовьте первый файл", tone: "warning" as const };
  return { label: "XML-ссылка включена", tone: "success" as const };
}
