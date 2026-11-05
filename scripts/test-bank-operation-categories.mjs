import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { summarizeBankCategories: summarize, bankCategoryNameKey } = await jiti.import('../src/lib/bank-operation-category-domain.ts');
const categories = [
  { id: 'purchases', code: 'purchases', name: 'Закупки', kind: 'operating', archived: false },
  { id: 'fees', code: 'fees', name: 'Комиссии', kind: 'operating', archived: false },
  { id: 'transfer', code: 'transfer', name: 'Свои счета', kind: 'transfer', archived: false },
  { id: 'owner', code: 'owner', name: 'Личные средства', kind: 'owner', archived: false },
];
const operation = (id, direction, amountCents, categoryId) => ({ id, direction, amountCents, categoryId });
const operations = [
  operation('1','expense',12345,'purchases'), operation('2','income',345,'purchases'),
  operation('3','expense',990,'fees'), operation('4','expense',100000,'transfer'),
  operation('5','income',100000,'transfer'), operation('6','expense',30000,'owner'),
  operation('7','expense',49,null), operation('8','internal',500,'transfer'),
];
const result = summarize(operations,categories);
assert.equal(result.reduce((sum,row)=>sum+row.incomeCents,0),100845);
assert.equal(result.reduce((sum,row)=>sum+row.expenseCents,0),143884);
assert.equal(result.reduce((sum,row)=>sum+row.count,0),8);
assert.equal(result.find(row=>row.categoryId==='transfer').kind,'transfer');
assert.equal(result.find(row=>row.categoryId==='owner').kind,'owner');
assert.equal(result.find(row=>row.categoryId==='purchases').incomeCents,345,'supplier refunds retain their incoming direction');
assert.equal(result.find(row=>row.categoryId===null).expenseCents,49,'uncategorized money is never omitted');
const renamed = categories.map(row=>row.id==='purchases'?{...row,name:'Товары и материалы',archived:true}:row);
assert.equal(summarize(operations,renamed).find(row=>row.categoryId==='purchases').name,'Товары и материалы');
assert.equal(summarize(operations,renamed).find(row=>row.categoryId==='purchases').archived,true,'archiving retains historical totals');
assert.equal(summarize([operation('x','expense',100,'missing')],categories)[0].categoryId,null);
assert.equal(bankCategoryNameKey('  АРЕНДА   помещения '),'аренда помещения');
assert.throws(()=>summarize([operation('x','expense',NaN,null)],categories));
assert.throws(()=>summarize([operation('x','unknown',100,null)],categories));
assert.throws(()=>summarize([operation('x','expense',1.5,null)],categories));
assert.throws(()=>summarize([operation('x','expense',Number.MAX_SAFE_INTEGER,null),operation('y','expense',2,null)],categories));
console.log('Bank categories: kopeck totals, refunds, internal transfers, owner money, uncategorized and archived categories passed');
