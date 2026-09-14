import assert from 'node:assert/strict';
import {intersectMonths,unionMonths,subtractMonths} from './lib/mann-month-intervals.mjs';
assert.deepEqual(intersectMonths({from:'2010-02',to:'2012-01'},{from:'2010-01',to:'2015-12'}),{from:'2010-02',to:'2012-01'});
assert.deepEqual(unionMonths([{from:'2010-01',to:'2010-12'},{from:'2011-01',to:null}]),[{from:'2010-01',to:null}]);
assert.deepEqual(subtractMonths({from:'2010-01',to:null},[{from:'2011-02',to:'2017-12'}]),[{from:'2010-01',to:'2011-01'},{from:'2018-01',to:null}]);
assert.deepEqual(subtractMonths({from:null,to:null},[{from:null,to:null}]),[]);
assert.deepEqual(subtractMonths({from:null,to:'2010-12'},[{from:'2010-03',to:null}]),[{from:null,to:'2010-02'}]);
// Exhaustively compare against sets on a bounded month lattice, including overlaps.
const m=n=>`2010-${String(n+1).padStart(2,'0')}`;
for(let a=0;a<8;a++)for(let b=a;b<8;b++)for(let c=0;c<8;c++)for(let d=c;d<8;d++){
 const source={from:m(a),to:m(b)},covered=[{from:m(c),to:m(d)}],left=subtractMonths(source,covered);
 for(let n=0;n<8;n++)assert.equal(left.some(w=>w.from<=m(n)&&m(n)<=w.to),n>=a&&n<=b&&!(n>=c&&n<=d));
}
console.log('Inclusive month union/intersection/subtraction tests passed');
