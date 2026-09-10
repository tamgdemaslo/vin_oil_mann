// Route replay only. Production authentication is never used or bypassed.
import { actor, tenant, runWithRequestTenant } from './harness.mjs';

export async function requireAIAssistantBaseAccess() {
  if (globalThis.__tgmReplay.deniedAccess) return { response: Response.json({error:'Denied fixture access'}, {status:403}) };
  return {session:{user:actor},actorId:actor.id};
}
export async function resolveAIAssistantThreadAccess(base, id) {
  const thread=globalThis.__tgmReplay.tables.aIAssistantThread.find(row=>row.id===id && row.branchId===tenant.branchId);
  if (!thread) throw new Error('Thread unavailable in fixture scope');
  return {...base,tenant,organizationId:tenant.organizationId};
}
export const runWithAIAssistantBranchContext=(access,work)=>runWithRequestTenant(access.tenant,work);
export const aiAssistantApiError=()=>Response.json({error:'Fixture request failed'},{status:500});
