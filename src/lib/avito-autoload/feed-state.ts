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
