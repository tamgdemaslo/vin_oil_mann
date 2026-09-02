# Подтверждённый первичными источниками subset MANN — v1

Дата: 2026-09-02  
Режим: `DRY_RUN_ONLY`, без записи в БД  
Исходный прогон: `mann-technical-catalog-v9-timeweb-backup-20260823-190344`

## Решение

- Полный каталог из 953 предложенных связей: **NO-GO для materialization и production cutover**.
- Отдельный subset из 5 связей: **GO только для проектирования schema/staging**.
- Production apply: **не разрешён**.

Причина разделения: по официальным руководствам подтверждены автомобиль, двигатель, система и объём только для пяти связей. Это не подтверждает автоматически допуски, вязкость, рекомендации и интервалы из вторичного источника. Поэтому preview переносит только проверенные поля, а остальные технические поля намеренно исключает.

## Подтверждённые связи

| Автомобиль | Двигатель | Система | Подтверждённый объём | Источник |
|---|---|---|---:|---|
| HAVAL DARGO | GW4N20 | Охлаждающая жидкость | 10,3 ± 0,5 л | Руководство DARGO, PDF 260 / печатная 259 |
| HAVAL DARGO | GW4N20 | Моторное масло, с фильтром | 5,0 ± 0,1 л | Руководство DARGO, PDF 260 / печатная 259 |
| HAVAL JOLION | GW4G15K | Моторное масло, с фильтром | 3,8 ± 0,1 л | Руководство JOLION, PDF 253 / печатная 252 |
| Opel Corsa-D | Z10XEP | Моторное масло, с фильтром | 3,0 л | Руководство Corsa-D, PDF/печатная 199 |
| Opel Corsa-D | Z12XEP | Моторное масло, с фильтром | 3,5 л | Руководство Corsa-D, PDF/печатная 199 |

Все пять fingerprint существуют в v9 в состоянии `ACTIVE`, имеют `CONFIRMED_SINGLE`, пустые `hardConflicts` и `reviewBlockers`, а независимая алгоритмическая проверка содержит точный код двигателя.

## Первичные документы

### HAVAL DARGO (2022–2025)

- официальный индекс: `https://haval.ru/owners/instructions/`;
- документ: `https://cdn.perxis.ru/originals/d87f87obeucc73ceoo40/original`;
- SHA-256: `733e8e2442c247ec97939e05026482dae343bbcf38de52eb4b5ea83527742a64`;
- проверено: PDF-страница 260, печатная страница 259.

### HAVAL JOLION (2021–2024)

- официальный индекс: `https://haval.ru/owners/instructions/`;
- документ: `https://cdn.perxis.ru/originals/d0s1reobeucc73eqo940/original`;
- SHA-256: `9b630ae0ae19c12e66a871d4865f009459951d06ee69b4fb5f43085935515c1e`;
- проверено: PDF-страница 253, печатная страница 252.

### Opel Corsa-D

- официальный источник: `https://public-servicebox.opel.com/`;
- документ: `https://public-servicebox.opel.com/OVddb/OV/en_GB/Corsa_D/2004_2009/2009_08/manual_user/Corsa_03_en.pdf`;
- SHA-256: `a35bcea847084754f0e228387e246cdf1909f07aa18b043949360d3132f8a116`;
- проверено: PDF/печатная страница 199.

## Защитные ограничения

Версионированный verification set:

`data/mann-technical-primary-source-verification-v1.json`

Он фиксирует:

- commit, matcher, capacity parser и SHA-256 Timeweb backup исходного v9;
- SHA-256 каждого официального PDF;
- точные fingerprint и requirement ID;
- ожидаемые make/model/engine/system/capacity;
- `independentHumanSignoff=false`;
- `productionApplyAuthorized=false`.

Builder прекращает работу при дрейфе любого из перечисленных идентификаторов, требует точное совпадение двигателя и запрещает флаги `--apply`, `--write-db`, `--materialize`, `--production`.

В итог не переносятся непроверенные поля вторичного источника:

- specification/viscosity;
- recommendation;
- replacement/control intervals;
- analog text.

## Результат

Сформирован:

`outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344/mann-primary-source-verified-preview-v1.json`

Состав:

- 5 подтверждённых связей;
- 4 `ENGINE_OIL`;
- 1 `ENGINE_COOLANT`;
- 948 связей v9 не включены в подтверждённый subset.

Команды проверки:

```bash
npm run test:mann-primary-source-verified
npm run preview:mann-primary-source-verified
npx tsc --noEmit
```

Следующий безопасный этап — отдельный review Prisma/SQL expand-only schema и staging import plan. Сам verification set не является разрешением на migration или production apply.
