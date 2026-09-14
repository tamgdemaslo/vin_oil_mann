import assert from 'node:assert/strict';
const index=value=>{assert.match(value,/^\d{4}-(0[1-9]|1[0-2])$/);return Number(value.slice(0,4))*12+Number(value.slice(5))-1;};
const display=n=>Number.isFinite(n)?`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`:null;
const numeric=w=>{const pair=[w.from===null?-Infinity:index(w.from),w.to===null?Infinity:index(w.to)];assert.ok(pair[0]<=pair[1]);return pair;};
export function intersectMonths(a,b){const x=numeric(a),y=numeric(b),lo=Math.max(x[0],y[0]),hi=Math.min(x[1],y[1]);return lo<=hi?{from:display(lo),to:display(hi)}:null;}
export function unionMonths(windows){
 const sorted=windows.map(numeric).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),out=[];
 for(const pair of sorted){const last=out.at(-1);if(last&&pair[0]<=last[1]+1)last[1]=Math.max(last[1],pair[1]);else out.push([...pair]);}
 return out.map(([lo,hi])=>({from:display(lo),to:display(hi)}));
}
export function subtractMonths(source,covered){
 const [start,end]=numeric(source),out=[];let cursor=start;
 for(const window of unionMonths(covered.map(w=>intersectMonths(source,w)).filter(Boolean))){const[lo,hi]=numeric(window);if(cursor<lo)out.push({from:display(cursor),to:display(lo-1)});cursor=hi+1;if(hi===Infinity)return out;}
 if(cursor<=end)out.push({from:display(cursor),to:display(end)});return out;
}
