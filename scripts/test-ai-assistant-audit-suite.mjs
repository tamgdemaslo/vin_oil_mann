#!/usr/bin/env node
// Reproducible frozen acceptance. No live model, business database or network.
import { spawn } from 'node:child_process';
const scripts = [
  'test-ai-assistant-oil-request', 'test-ai-assistant-service-type', 'test-ai-assistant-e2e', 'test-ai-assistant-disconnect', 'test-ai-assistant-holdout', 'test-ai-assistant-metrics', 'test-ai-assistant-customer-dialogue',
  'test-ai-material-selection', 'test-ai-quote-and-tech-card', 'test-ai-quote-and-tech-card-field-suite',
  'test-ai-answer-formatting', 'test-ai-tool-loop-policy', 'test-ai-assistant-branch-context',
  'test-mann-vehicle-resolver', 'test-mann-unified-technical-profile', 'test-product-attribute-dictionaries',
  'test-rossko-api-2-1-contract', 'test-rossko-error-classification',
  'check-timeweb-only', 'test-timeweb-wireproxy-runtime',
];
let next = 0;
const results = [];
await Promise.all(Array.from({length:3}, async () => {
  while (next < scripts.length) {
    const script = scripts[next++];
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [`scripts/${script}.mjs`], {stdio:['ignore','pipe','pipe']});
      let output = '';
      child.stdout.on('data', data => {output += data;});
      child.stderr.on('data', data => {output += data;});
      child.on('error', error => resolve({script, exitCode:1, output:error.message}));
      child.on('close', code => resolve({script, exitCode:code ?? 1, output}));
    });
    results.push(result);
    console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${script}`);
    if (result.exitCode !== 0) console.error(result.output);
  }
}));
console.log(JSON.stringify({asOf:new Date().toISOString(),scope:'frozen replay and local regression',suites:results.length,failed:results.filter(r=>r.exitCode!==0).map(r=>r.script)}));
process.exitCode = results.some(r=>r.exitCode!==0) ? 1 : 0;
