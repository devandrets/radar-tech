#!/usr/bin/env node

import { spawn } from 'node:child_process';

const jobs = [
  ['Gupy', 'gupy-cli.js'],
  ['ProgramaThor', 'programathor-cli.js'],
  ['Remotar', 'remotar-cli.js'],
  ['LinkedIn', 'cli.js']
];

function getConcurrency() {
  const value = process.argv.find(arg => arg.startsWith('--parallel='))?.split('=')[1];
  if (value === undefined) return jobs.length;

  const concurrency = Number.parseInt(value, 10);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('O valor de --parallel deve ser um inteiro maior que zero.');
  }
  return Math.min(concurrency, jobs.length);
}

function runJob([name, script]) {
  return new Promise(resolve => {
    console.log(`\n▶️ Iniciando relatório ${name}...`);
    const extraArgs = process.argv.slice(2).filter(arg => !arg.startsWith('--parallel='));
    const child = spawn(process.execPath, [script, '--all', '--export', ...extraArgs], {
      stdio: 'inherit',
      env: process.env
    });

    child.on('error', error => {
      console.error(`\n❌ Falha ao iniciar ${name}: ${error.message}`);
      resolve(1);
    });
    child.on('exit', code => {
      if (code !== 0) console.error(`\n❌ Relatório ${name} terminou com código ${code ?? 1}.`);
      else console.log(`\n✅ Relatório ${name} concluído.`);
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const concurrency = getConcurrency();
  console.log(`🚀 Gerando ${jobs.length} relatórios em paralelo (concorrência: ${concurrency})`);

  let next = 0;
  let failures = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      failures += await runJob(job);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failures > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(`\nErro fatal: ${error.message}`);
  process.exitCode = 1;
});
