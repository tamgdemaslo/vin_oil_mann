import assert from 'node:assert/strict';
import {reviewStagedInterval as review} from './lib/mann-staged-interval-review.mjs';
const solaris=review('Первая замена через 210 000 км или 10 лет Далее каждые 30 000 км или 2 года');
assert.deepEqual(solaris.initial,{km:210000,months:120,relationship:'SOURCE_OR'});
assert.deepEqual(solaris.subsequent,{km:30000,months:24,relationship:'SOURCE_OR'});
assert.equal(review('11 лет или 220 000 км для первой заливки далее 6 лет или 120 000 км').subsequent.km,120000);
assert.equal(review('Первая замена: 2.5 тыс. км. Далее: каждые 20 тыс. км. или 6 мес.').initial.km,2500);
assert.equal(review('Первая замена через 210 000 км (10 лет) далее каждые 30 000 км (2 года)').initial.relationship,'PARENTHETICAL_TIME_NOT_INFERRED_OR');
assert.equal(review('первая замена через 3 года, далее каждые 2 года').subsequent.months,24);
for(const raw of [
 'Первая замена через 160 тыс. км Далее каждые 80 тыс. км Тяж условия: сократить на 30-40%',
 'Первая замена через 150 тыс. км или 8 лет, далее каждые 75 тыс. км или 4 года ИЛИ SUZUKI LONG LIFE COOLANT',
 'Первая замена через 40 тыс. км, далее не требуется Мы рекомендуем каждые 30 тыс. км',
 'Первая замена через 25 тыс. км или 2 года и 3 мес., далее каждые 20 тыс. км или 2 года',
 'Первая замена через 180 тыс. км далее 100 тыс. км Другой антифриз Первая замена через 3 года далее 2 года',
 '180 тыс. км или 9 лет, далее каждые 100 тыс. км или 4 года',
])assert.equal(review(raw).status,'REVIEW_REQUIRED',raw);
console.log('Staged interval extraction positive and condition-preservation tests PASS');
