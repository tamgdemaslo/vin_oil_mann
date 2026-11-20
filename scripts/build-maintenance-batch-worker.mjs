/** Build a temporary single-file worker for Timeweb /app, without copying secrets. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),output=resolve(args[0]??'/tmp/maintenance-vin-worker/worker.mjs');
const esbuildPath=process.env.ESBUILD_MODULE_PATH;
if(!esbuildPath)throw new Error('Set ESBUILD_MODULE_PATH to an installed esbuild/lib/main.js');
const require=createRequire(import.meta.url),{build}=require(esbuildPath);
let source=await readFile(resolve(root,'scripts/backfill-maintenance-vins.mjs'),'utf8');
source=source.replace("import { createJiti } from 'jiti';",'');
source=source.replace(/    const boot=createJiti\([^\n]+\n    \(\{prisma\}=await boot\.import\('\.\.\/src\/lib\/db\.ts'\)\);/, '    prisma=__realPrisma;');
source=source.replace(/    const j=createJiti\([^\n]+\n/,'');
const staticImports=[`import { prisma as __realPrisma } from ${JSON.stringify(resolve(root,'src/lib/db.ts'))};`];
source=source.replace(/    const (\{[^\n]+\})=await j\.import\('([^']+)'\);/g,(_all,names,path)=>{
 staticImports.push(`import ${names} from ${JSON.stringify(resolve(root,'scripts',path))};`);return '';
});
if(source.includes('createJiti')||source.includes('j.import(')||source.includes('boot.import('))throw new Error('Runner boot changed; review static transform before building');
const proxy=`export const prisma=new Proxy({}, { get(_target,key){const db=globalThis[Symbol.for('maintenance-vin-batch-db')];if(!db)throw new Error('Batch database context missing');const value=db[key];return typeof value==='function'?value.bind(db):value;} });`;
await mkdir(dirname(output),{recursive:true});
const result=await build({stdin:{contents:staticImports.join('\n')+'\n'+source,resolveDir:resolve(root,'scripts'),sourcefile:'maintenance-vin-worker-entry.mjs',loader:'js'},bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',outfile:output,metafile:true,write:false,tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'batch-prisma-proxy',setup(build){build.onResolve({filter:/^@\/lib\/db$/},()=>({path:'batch-db',namespace:'batch-db'}));build.onLoad({filter:/.*/,namespace:'batch-db'},()=>({contents:proxy,loader:'js'}));}}]});
const bytes=result.outputFiles[0].contents,gzip=gzipSync(bytes,{level:9}),sha=createHash('sha256').update(bytes).digest('hex');
await writeFile(output,bytes,{mode:0o600});await writeFile(output+'.gz',gzip,{mode:0o600});await writeFile(output+'.gz.b64',gzip.toString('base64'),{mode:0o600});await writeFile(output+'.meta.json',JSON.stringify({sha256:sha,bytes:bytes.length,gzipBytes:gzip.length,inputs:Object.keys(result.metafile.inputs),externalImports:result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({output,sha256:sha,bytes:bytes.length,gzipBytes:gzip.length}));
