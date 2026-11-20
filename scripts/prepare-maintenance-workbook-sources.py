#!/usr/bin/env python3
"""Offline-only exact-key proposals. Never turns workbook labels into source evidence."""
import argparse, collections, hashlib, json, pathlib, re, os
p=argparse.ArgumentParser();p.add_argument('--workbook',required=True);p.add_argument('--matches',required=True);p.add_argument('--evidence-root',required=True);p.add_argument('--output',required=True);a=p.parse_args()
workbook=json.load(open(a.workbook));matched=json.load(open(a.matches));root=pathlib.Path(a.evidence_root)
keys={key for row in matched['results'] for candidate in row.get('candidates',[]) for key in candidate.get('variantIds',[])}
keys.update(key for row in matched['results'] for key in row.get('variantKeys',[]))
by_id={r['ID записи']:r for r in workbook['rows'] if r.get('Ключ MANN') in keys}
org=matched['config']['organization'];branch=matched['config']['branch'];proposals={};audit=[];seen=set();values=collections.defaultdict(set)
for directory in ['ravenol-volume-bulk-20261024','ravenol-volume-priority-20261024','ravenol-factory-bulk-20261024','engine-volume-scale-20261105']:
 d=root/directory
 if not d.exists():continue
 for source in d.rglob('approved-engine.json'):
  if source.name.startswith('._'):continue
  data=json.load(open(source))
  if not isinstance(data,list):continue
  for evidence in data:
   row=by_id.get(evidence.get('row_id'))
   if not row:continue
   key=row['Ключ MANN'];entry={'variantKey':key,'excelRow':row['excelRow'],'rowId':evidence.get('row_id'),'evidenceFile':str(source)}
   fingerprint=hashlib.sha256(json.dumps(evidence,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
   if fingerprint in seen:continue
   seen.add(fingerprint)
   def held(reason):audit.append({**entry,'status':reason})
   if evidence.get('status')!='confirmed' or not evidence.get('parent_approved'):held('HELD_NOT_CONFIRMED');continue
   if evidence.get('excel_row')!=row['excelRow']:held('HELD_ROW_MISMATCH');continue
   try:value=float(evidence['confirmed_value']);current=float(row[evidence['field']])
   except (KeyError,ValueError,TypeError):held('HELD_MISSING_WORKBOOK_VALUE');continue
   if not 0<value<50 or abs(value-current)>0.000001:held('HELD_VALUE_MISMATCH');continue
   if evidence.get('source_year_status')=='Частичное покрытие / варианты':held('HELD_PARTIAL_YEAR_COVERAGE');continue
   sources=[x for x in evidence.get('evidence',[]) if re.match(r'^https://[^/]+/',x.get('url',''))]
   if evidence.get('selected_source'):sources=[x for x in sources if x['url']==evidence['selected_source']]
   if not sources:held('HELD_NO_PUBLIC_SOURCE_URL');continue
   source_evidence=sources[0];caps=source_evidence.get('capacities',[])
   cap=next((c for c in caps if c.get('value_numeric') is not None and abs(float(c['value_numeric'])-value)<0.000001 and 'фильтр' not in c.get('label_raw','').lower()),None)
   factory=directory=='ravenol-factory-bulk-20261024' and 'WITH FILTER' in source_evidence.get('evidence','') and source_evidence.get('rows')
   if not cap and not factory:held('HELD_NO_QUOTABLE_SOURCE_CELL');continue
   excerpt=(' '.join(str(v) for v in source_evidence['rows'][0]) if factory else f"{cap.get('label_raw','')} {cap.get('value_raw','')}").strip()
   excerpt=' '.join(excerpt.split()[:25])
   volume=f'{value:g} л (замена с фильтром)' if factory else f'{value:g} л (каталоговый основной объём; включение фильтра не указано)'
   item={'systemCode':'ENGINE_OIL','specification':'','volumeText':volume,'sourceUrl':source_evidence['url'],'sourceTitle':'Nissan Lube Chart — таблица объёмов с фильтром' if factory else 'Ravenol — каталоговый объём двигателя','excerpt':excerpt}
   values[key].add(value)
   proposals.setdefault(key,{'organizationId':org,'branchId':branch,'variantKeys':[key],'items':[]})['items'].append(item)
   audit.append({**entry,'status':'PROPOSED_REVIEW_REQUIRED','value':value,'sourceUrl':source_evidence['url'],'explicitFilterBasis':bool(factory),'workbookSha256':workbook['sha256']})
# Any conflicting published values for one exact key stay out of the import file.
conflicts={key for key,vals in values.items() if len(vals)>1}
for key in conflicts:proposals.pop(key,None)
for record in proposals.values():
 unique={json.dumps(item,ensure_ascii=False,sort_keys=True):item for item in record['items']};record['items']=list(unique.values())
base=pathlib.Path(a.output);base.parent.mkdir(parents=True,exist_ok=True)
for name,value in [(base,list(proposals.values())),(base.with_suffix('.audit.json'),{'kind':'OFFLINE_REVIEWED_WORKBOOK_SOURCE_PROPOSALS','matchingRows':len(matched['results']),'candidateVariantKeys':len(keys),'workbookMatchedRows':len(by_id),'proposedVariants':len(proposals),'proposedItems':sum(len(r['items'])for r in proposals.values()),'conflictingVariantKeys':sorted(conflicts),'statusCounts':dict(collections.Counter(x['status']for x in audit)),'findings':audit,'applied':False})]:
 with open(name,'x',encoding='utf8')as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')
 os.chmod(name,0o600)
print(json.dumps({'variants':len(proposals),'items':sum(len(r['items'])for r in proposals.values()),'held':dict(collections.Counter(x['status']for x in audit if x['status']!='PROPOSED_REVIEW_REQUIRED'))},ensure_ascii=False))
