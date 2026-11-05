import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { summarizeBankCategories: summarize, bankCategoryNameKey, automaticBankCategory, bankExpenseMerchantKey, needsBankExpenseReview } = await jiti.import('../src/lib/bank-operation-category-domain.ts');
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

const marketing = {id:'ads',code:'marketing',name:'Реклама',kind:'operating',archived:false};
const catalog = [...categories, marketing];
const expense = {id:'bank-operation',direction:'expense',amountCents:500,categoryId:null,counterparty:'ООО «Авито»',inn:'0000000000',purpose:'Оплата размещения'};
assert.equal(automaticBankCategory(expense,catalog)?.id,marketing.id);
assert.equal(automaticBankCategory(expense,catalog,'purchases')?.id,'purchases');
assert.equal(automaticBankCategory({...expense,direction:'income'},catalog),undefined);
assert.equal(automaticBankCategory({...expense,purpose:'Возврат услуги'},catalog),undefined);
assert.equal(automaticBankCategory({...expense,counterparty:'Авитопром'},catalog),undefined);
assert.equal(automaticBankCategory(expense,[{...marketing,archived:true}]),undefined);
assert.equal(bankExpenseMerchantKey(expense),bankExpenseMerchantKey({...expense,counterparty:'  ООО   «АВИТО»  '}));
assert.notEqual(bankExpenseMerchantKey(expense),bankExpenseMerchantKey({...expense,inn:'0000000001'}));
assert.equal(bankExpenseMerchantKey({...expense,counterparty:'Перевод',inn:''}),null);
assert.equal(needsBankExpenseReview(expense),true);
assert.equal(needsBankExpenseReview({...expense,hiddenFromReview:true}),false);
assert.equal(needsBankExpenseReview({...expense,categoryId:marketing.id}),false);
assert.equal(needsBankExpenseReview({...expense,id:''}),false);
console.log('Bank automation: merchant matching, manual rules, Avito, archive and review filters passed');
