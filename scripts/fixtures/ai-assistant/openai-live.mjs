import { createJiti } from 'jiti';
import { resolve } from 'node:path';
const jiti = createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const actual = await jiti.import(resolve('src/lib/openai-client.ts'));
export const OpenAIConnectionError = actual.OpenAIConnectionError;
export const assertOpenAIConnection = actual.assertOpenAIConnection;
let requestedMaximumUsd = 0;
let contextTokenUpperBound = 0;
export function createOpenAIClient(key, options) {
 const client=actual.createOpenAIClient(key,options);
 const create=client.responses.create.bind(client.responses);
 client.responses.create=async (body, opts) => {
  const f=globalThis.__tgmReplay;
  if(body.model!=='gpt-5.6-terra')throw new Error('LIVE_BUDGET_MODEL_NOT_PRICED');
  if(f.modelCalls.length>=6)throw new Error('LIVE_BUDGET_CALL_LIMIT');
  // Pricing verified 2026-09-09: $2 input / $12 output per 1M tokens.
  // Byte count is a conservative upper bound for token count for this request.
  const maxOutput=4096, bytes=Buffer.byteLength(JSON.stringify(body));
  contextTokenUpperBound = body.previous_response_id ? contextTokenUpperBound + bytes + maxOutput : bytes;
  const reserve=contextTokenUpperBound*2/1e6+maxOutput*12/1e6+0.02;
  if(requestedMaximumUsd+reserve>1.00)throw new Error('LIVE_BUDGET_USD_LIMIT');
  requestedMaximumUsd+=reserve;
  f.modelCalls.push({model:body.model,reservedUsd:reserve});
  const response=await create({...body,max_output_tokens:maxOutput,max_tool_calls:1},opts);
  f.liveUsage??=[];f.liveUsage.push({inputTokens:response.usage?.input_tokens??null,cachedInputTokens:response.usage?.input_tokens_details?.cached_tokens??null,outputTokens:response.usage?.output_tokens??null,status:response.status});
  return response;
 };
 return client;
}
