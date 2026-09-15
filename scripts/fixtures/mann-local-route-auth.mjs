// Only authentication is substituted; route validation and database reads stay real.
export async function requireBranchApi(){return {ok:true,context:{localFixture:true}};}
export async function runWithBranchApiContext(context,fn){
 if(!context.localFixture)throw Error('Local fixture context required');
 return fn();
}
