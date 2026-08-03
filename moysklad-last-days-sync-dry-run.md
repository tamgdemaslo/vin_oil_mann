# MoySklad last-days sync dry-run

- Generated: 2026-05-31T19:59:48.169Z
- Mode: verify
- Days: 7
- Cutoff: 2026-05-23T22:00:00.000Z
- Backup confirmed: no
- Can backfill: no

## Summary

| Bucket | Count |
| --- | ---: |
| missingLocally | 0 |
| changedRemotely | 0 |
| localOnly | 0 |
| conflicts | 0 |
| readyToImport | 0 |
| needsManualReview | 18 |

## Entity Counts

| Entity | Remote | Local |
| --- | ---: | ---: |
| organizations | 0 | 0 |
| stores | 0 | 0 |
| products | 366 | 935 |
| services | 0 | 0 |
| counterparties | 10 | 10 |
| demands | 48 | 56 |
| demandPositions | 145 | 162 |
| stock | 833 | 837 |
| cashouts | 1 | 1 |
| payments | 2 | 0 |
| supplierInvoices | 1 | 1 |
| supplies | 15 | 1 |
| writeoffs | 0 | 1 |

## Blockers

- Для import supplies/writeoffs нужен проверенный transformer/upsert; legacy-поля уже nullable и не блокируют локальную работу
- Для import supplier invoices нужна проверка связей с приёмками/оплатами; legacy-поля уже nullable
- Для import payments нужна проверка связи с локальным счётом/кассовым документом; legacy-поля уже nullable

## missingLocally

Нет записей.

## changedRemotely

Нет записей.

## localOnly

Нет записей.

## conflicts

Нет записей.

## readyToImport

Нет записей.

## needsManualReview

- payments | 0156497a-5848-11f1-0a80-09d2003a7cd5 | 00041 | Оплаты МойСклад имеют nullable legacy-поля локально, но требуют ручной проверки связи с локальным счётом/кассовым документом перед automatic import
- payments | 993f7eb2-5847-11f1-0a80-1948003abd3e | 00040 | Оплаты МойСклад имеют nullable legacy-поля локально, но требуют ручной проверки связи с локальным счётом/кассовым документом перед automatic import
- supplierInvoices | 92e2410f-5847-11f1-0a80-09d2003a6604 | 3470 | LocalSupplierInvoice хранит nullable legacy-поля, но automatic import счетов поставщиков заблокирован до проверки связей с приёмками и оплатами
- supplies | 114dbc9f-5cee-11f1-0a80-1b8b0022c48d | 00241 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | c8196b24-5cfa-11f1-0a80-041d00241381 | 00243 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 31cfa0cc-5cf8-11f1-0a80-19be0023237d | 00242 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 8c14f09b-5c1c-11f1-0a80-130600197537 | 00240 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 724c13d2-5c04-11f1-0a80-1aef001854c6 | 00239 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 6a9bb5dc-5b52-11f1-0a80-1cae000d24a8 | 00238 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | b2317bd4-5aaa-11f1-0a80-07fb002401b5 | 00237 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | e10f86e0-5a9e-11f1-0a80-07fb0021227d | 00236 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 1b513bfd-5a63-11f1-0a80-09d80005721e | 00234 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 5e22f674-5a8e-11f1-0a80-0586000efa88 | 00235 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 756a4139-59b6-11f1-0a80-03b6000b3264 | 00233 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | fc6998b5-599b-11f1-0a80-157900059e58 | 00232 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 5f2494a5-5921-11f1-0a80-1adf00adbada | 00231 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | be0488b5-58f0-11f1-0a80-1948004b8c4c | 00230 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
- supplies | 4bda5a51-58e2-11f1-0a80-10740046721d | 00229 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей
