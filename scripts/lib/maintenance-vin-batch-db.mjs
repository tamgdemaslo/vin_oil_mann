// Late-bound transaction forwarding keeps repeated import records isolated.
export const prisma=new Proxy({}, {get(_target,property){
 const value=globalThis[Symbol.for('maintenance-vin-batch-db')];
 if(!value)throw new Error('Batch database context was not initialized');
 const member=value[property];
 return typeof member==='function'?member.bind(value):member;
}});
