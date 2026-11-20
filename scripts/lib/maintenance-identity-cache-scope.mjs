/** Capability-limited cache delegate for one VIN; await derived writes before adjudication. */
export function createMaintenanceIdentityCacheScope(delegate,scope){
 if(!scope?.branchId||!scope.organizationId||scope.inputType!=='vin'||!/^[a-f0-9]{64}$/.test(scope.normalizedInputHash))throw Error('Invalid identity cache scope');
 const pending=new Set();
 const track=promise=>{const task=Promise.resolve(promise);pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;};
 const cache={
  findFirst:arg=>delegate.findFirst({...arg,where:{...arg.where,...scope}}),
  create:arg=>{if(arg.data.normalizedInputHash!==scope.normalizedInputHash||!['vindecode','vindecode2'].includes(arg.data.method))throw Error('Out-of-scope cache write');return track(delegate.create({...arg,data:{...arg.data,...scope}}));},
  updateMany:arg=>{if(Object.keys(arg.data).some(k=>!['normalizedVehicleJson','status','errorCode','errorMessage'].includes(k)))throw Error('Unexpected cache mutation');return track(delegate.updateMany({...arg,where:{...arg.where,...scope}}));},
 };
 return {db:new Proxy({vehicleLookupCache:cache},{get(target,k){if(k!=='vehicleLookupCache')throw Error('Identity-only pilot forbids other DB delegates');return target[k];}}),
  async drain(){while(pending.size)await Promise.allSettled([...pending]);}};
}
