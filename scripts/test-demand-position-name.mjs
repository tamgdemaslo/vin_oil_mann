import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { resolveServicePositionName: name } = await jiti.import(resolve('src/lib/demand-position-name.ts'));
const uuid = '40324f2c-4a8e-46f8-a461-d4c97ee5bf75';
const cuid = 'cmtzmrm5k0c6xk8012f5kawdr';
// New manual service, repeated saves, and intentional label edits.
assert.equal(name(' Замена моторного масла и фильтра '), 'Замена моторного масла и фильтра');
assert.equal(name('Новое название', 'Старое название'), 'Новое название');
assert.equal(name(undefined, 'Сохранённая услуга'), 'Сохранённая услуга');
// Existing corrupted positions recover the original submitted label for printing.
assert.equal(name(uuid, 'Замена моторного масла и фильтра'), 'Замена моторного масла и фильтра');
assert.equal(name(cuid, uuid, 'Замена моторного масла'), 'Замена моторного масла');
assert.equal(name(`local://service/${cuid}`, 'Работа'), 'Работа');
// If the original label is lost, do not invent a specific service or print an ID.
assert.equal(name(uuid, cuid, null, ''), 'Разовая услуга');
assert.equal(name('Замена ATF 6HP19'), 'Замена ATF 6HP19');
console.log('Service position name regression checks passed');
