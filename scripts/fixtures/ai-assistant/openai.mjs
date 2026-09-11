export class OpenAIConnectionError extends Error {}
export async function assertOpenAIConnection() { globalThis.__tgmReplay.connectionProbes++; }
export function createOpenAIClient() {
 return { responses: { create: async (body, options) => {
  const f = globalThis.__tgmReplay; f.modelCalls.push({ body, signalPresent: Boolean(options?.signal) });
  if (f.delayModel || (f.delayResearch && body.tools?.some(tool => tool.type === 'web_search'))) { await new Promise((resolve,reject) => { const timer = setTimeout(resolve,10000); options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true}); }); }
  if (f.failResearch && body.tools?.some(tool => tool.type === 'web_search')) throw new Error('Frozen research unavailable');
  if (body.tools?.some(tool => tool.type === 'web_search')) return f.researchResponse ?? { id:'frozen-research', output:[{type:'message',content:[{type:'output_text',text:'В замороженных источниках нет применимого момента или температуры. Нужна проверка.'}]}],usage:{input_tokens:20,output_tokens:20} };
  const next = f.responses.shift();
  if (!next) throw new Error('Unexpected model request in replay');
  return typeof next === 'function' ? next(body) : next;
 } } };
}
