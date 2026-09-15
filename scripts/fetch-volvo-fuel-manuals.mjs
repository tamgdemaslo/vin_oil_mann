import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const dir=resolve(import.meta.dirname,'../tmp/pdfs/volvo-fuel-evidence-2026-09-14');
await mkdir(dir,{recursive:true});
const docs=[
 ['s40-my12','https://ldgsvccassets.blob.core.windows.net/pdfs/3b2dc914ca807879995b3bd1e01a75305a73fb2c/S40_owners_manual_MY12_EN_tp14006.pdf'],
 ['v50-my12','https://ldgsvccassets.blob.core.windows.net/pdfs/6314aac781be23932c6215ad2d4e9968ab717ef4/V50_owners_manual_MY12_EN_tp14033.pdf'],
 ['v50-my10','https://ldgsvccassets.blob.core.windows.net/pdfs/18939bdb9d7f579ebf9812040b32cd622be31e4c/V50_owners_manual_MY10_EN_tp10852.pdf']
];
const manifest=[];
for(const [id,url] of docs){const response=await fetch(url);assert.ok(response.ok);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const path=resolve(dir,id+'.pdf');await writeFile(path,bytes,{flag:'wx'});manifest.push({id,url,path,sha256:sha(bytes),bytes:bytes.length});console.log(id+' saved');}
await writeFile(resolve(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
