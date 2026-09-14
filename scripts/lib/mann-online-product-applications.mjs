import assert from 'node:assert/strict';
import {parseDocument,DomUtils} from 'htmlparser2';
const text=n=>DomUtils.textContent(n).replace(/\s+/g,' ').trim();
const children=(n,tag)=>(n.children??[]).filter(c=>c.name===tag);
const labels=['Model Type','Filter Type','Engine Code','ccm','kW','HP','Year of Manufacture'];
const hasClass=(n,c)=>(n.attribs?.class??'').split(/\s+/).includes(c);

// Offline English product-page reader. No HTTP, database writes or brand aliases.
// Binding parameters omit body suffixes: retain AND cross-check rendered cells.
export function parseMannOnlineApplications(html,{url,article}){
 const sourceUrl=new URL(url);assert.equal(sourceUrl.protocol,'https:');assert.equal(sourceUrl.hostname,'www.mann-filter.com');
 const dom=parseDocument(html),headings=DomUtils.findAll(n=>n.name==='h1',dom.children).map(text);
 assert.ok(headings.some(h=>h.replace(/\s/g,'').endsWith(article.replace(/\s/g,''))),'Wrong product page');
 const tables=DomUtils.findAll(n=>n.name==='table'&&n.attribs?.['aria-label']==='Application Table',dom.children);
 assert.ok(tables.length,'No application tables');const applications=[];
 function decode(link,cells){
  const raw=link.attribs?.['data-g-binding-params'];assert.ok(raw);const params=new URLSearchParams(decodeURIComponent(raw));
  const keys=[...params.keys()];assert.equal(new Set(keys).size,keys.length,'Duplicate application parameter');
  const binding=Object.fromEntries(params);assert.equal(binding.mode,'application');
  for(const key of ['vehicleMake','vehicleMakeId','vehicleModel','vehicleModelId','vehicleTypeId','vehicleName'])assert.ok(binding[key],`Missing ${key}`);
  for(const key of ['vehicleMakeId','vehicleModelId','vehicleTypeId'])assert.match(binding[key],/^\d+$/);
  assert.equal(text(link),binding.vehicleName);
  assert.ok(cells[0].startsWith(binding.vehicleName),'Rendered model differs from binding');
  for(const[index,key]of [[2,'engineCode'],[3,'ccm'],[4,'kw'],[5,'bhp']]){
   const value=cells[index]==='-'?'':cells[index],bound=binding[key]==='-'?'':binding[key]??'';assert.equal(value,bound,`Rendered ${key} differs from binding`);
  }
  let manufactureMonths={from:null,to:null,precision:'UNKNOWN'};
  if(!cells[6]){assert.equal(binding.vehicleManufacturedFrom,'1900-01-01');assert.equal(binding.vehicleManufacturedTo,'9999-12-31');}
  else {
   const displayed=/^(\d{2}\/\d{2})\s*→\s*(\d{2}\/\d{2})?$/.exec(cells[6]);assert.ok(displayed,'Unknown date layout');
   for(const[key,position]of [['vehicleManufacturedFrom',1],['vehicleManufacturedTo',2]]){
    const iso=binding[key];assert.match(iso,/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/);
    assert.equal(new Date(iso+'T00:00:00Z').toISOString().slice(0,10),iso,'Invalid calendar date');
    if(key==='vehicleManufacturedTo'&&iso==='9999-12-31'){assert.equal(displayed[position],undefined);continue;}
    assert.equal(displayed[position],iso.slice(5,7)+'/'+iso.slice(2,4),'Rendered date endpoint differs from binding');
   }
   assert.ok(binding.vehicleManufacturedFrom<=binding.vehicleManufacturedTo);
   manufactureMonths={from:binding.vehicleManufacturedFrom.slice(0,7),to:binding.vehicleManufacturedTo==='9999-12-31'?null:binding.vehicleManufacturedTo.slice(0,7),precision:'MONTH_FROM_RENDERED_TABLE'};
  }
  return {manufacturerTypeId:binding.vehicleTypeId,manufacturerMakeId:binding.vehicleMakeId,manufacturerModelId:binding.vehicleModelId,
   make:binding.vehicleMake,model:binding.vehicleModel,vehicleText:cells[0],filterType:cells[1],engineCode:cells[2],ccm:cells[3],kw:cells[4],hp:cells[5],vehicleYears:cells[6],manufactureMonths,binding,rawBinding:raw,renderedCells:cells};
 }
 for(const table of tables){
  const desktops=children(table,'tbody').filter(n=>hasClass(n,'cmp-table__desktop'));assert.equal(desktops.length,1);
  const desktopRows=children(desktops[0],'tr');assert.deepEqual(children(desktopRows[0],'th').map(text),labels);
  const records=desktopRows.slice(1).map(tr=>{const cells=children(tr,'td');assert.equal(cells.length,7);const links=DomUtils.findAll(n=>n.name==='a'&&Object.hasOwn(n.attribs??{},'data-g-binding-application-link'),tr.children);assert.equal(links.length,1);return decode(links[0],cells.map(text));});
  const mobiles=children(table,'tbody').filter(n=>hasClass(n,'cmp-table__tablet')).map(tbody=>{
   const rows=children(tbody,'tr');assert.equal(rows.length,7);const cells=rows.map(tr=>{const td=children(tr,'td');assert.equal(td.length,2);return td;});
   assert.deepEqual(cells.map(c=>text(c[0])),labels);const links=DomUtils.findAll(n=>n.name==='a'&&Object.hasOwn(n.attribs??{},'data-g-binding-application-link'),tbody.children);assert.equal(links.length,1);
   return decode(links[0],cells.map(c=>text(c[1])));
  });
  assert.deepEqual(mobiles,records,'Desktop/mobile application evidence differs');applications.push(...records);
 }
 const ids=applications.map(a=>`${a.manufacturerMakeId}:${a.manufacturerModelId}:${a.manufacturerTypeId}`);assert.equal(new Set(ids).size,ids.length,'Repeated manufacturer identity needs review');
 return {sourceUrl:url,article,applicationTables:tables.length,applications,publicationAllowed:false};
}
