#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rules from './rules.config.js';
import { searchProgramathorJobs, getProgramathorJobDetails, isProgramathorPostingTooOld } from './lib/programathor.js';
import { analyzeJob, isAllowedLocation } from './lib/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CANDIDATURAS_DIR = path.resolve(__dirname, 'candidaturas');
const COMPANY_BLACKLIST_FILE = path.resolve(__dirname, 'company-blacklist.json');
const TERMS_BLACKLIST_FILE = path.resolve(__dirname, 'terms-blacklist.json');
const PROGRAMATHOR_SEARCH_TERMS_FILE = path.resolve(__dirname, 'programathor-search-terms.json');
const SEARCH_TERMS_FILE = path.resolve(__dirname, 'search-terms.json');
const ALLOWED_CITIES_FILE = path.resolve(__dirname, 'allowed-cities.json');

// Cores ANSI simples para o terminal
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgYellow: '\x1b[43m\x1b[30m'
};

function loadCompanyBlacklist() {
  if (!fs.existsSync(COMPANY_BLACKLIST_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(COMPANY_BLACKLIST_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(c => (typeof c === 'string' ? c.trim() : ''))
        .filter(c => c.length > 0);
    }
    return [];
  } catch (err) {
    console.warn(`${colors.yellow}⚠️ Aviso: Não foi possível ler company-blacklist.json (${err.message}).${colors.reset}`);
    return [];
  }
}

function addCompanyToBlacklist(companyName, activeRules) {
  if (!companyName || typeof companyName !== 'string') return;
  const clean = companyName.trim();
  if (clean.length < 2) return;

  const currentList = loadCompanyBlacklist();
  const existsInFile = currentList.some(c => c.toLowerCase() === clean.toLowerCase());

  if (!existsInFile) {
    currentList.push(clean);
    try {
      fs.writeFileSync(COMPANY_BLACKLIST_FILE, JSON.stringify(currentList, null, 2) + '\n', 'utf-8');
      console.log(`\n  ${colors.magenta}🚫 Empresa "${clean}" adicionada automaticamente a company-blacklist.json${colors.reset}`);
    } catch (err) {
      console.warn(`${colors.yellow}⚠️ Aviso: Não foi possível atualizar company-blacklist.json (${err.message}).${colors.reset}`);
    }
  }

  if (activeRules && Array.isArray(activeRules.companyBlacklist)) {
    const existsInMemory = activeRules.companyBlacklist.some(c => c.toLowerCase() === clean.toLowerCase());
    if (!existsInMemory) {
      activeRules.companyBlacklist.push(clean);
    }
  }
}

function loadTermsBlacklist() {
  if (!fs.existsSync(TERMS_BLACKLIST_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(TERMS_BLACKLIST_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => {
          if (typeof item === 'string') return item.trim();
          if (typeof item === 'object' && item && item.term) {
            return { ...item, term: item.term.trim() };
          }
          return '';
        })
        .filter(Boolean);
    }
    return [];
  } catch (err) {
    console.warn(`${colors.yellow}⚠️ Aviso: Não foi possível ler terms-blacklist.json (${err.message}).${colors.reset}`);
    return [];
  }
}

function loadSearchTerms() {
  const targetFile = fs.existsSync(PROGRAMATHOR_SEARCH_TERMS_FILE)
    ? PROGRAMATHOR_SEARCH_TERMS_FILE
    : SEARCH_TERMS_FILE;

  if (!fs.existsSync(targetFile)) {
    return ['Node.js', 'Backend'];
  }
  try {
    const raw = fs.readFileSync(targetFile, 'utf-8');
    const parsed = JSON.parse(raw);
    let terms = [];
    if (Array.isArray(parsed)) {
      terms = parsed.map(t => (typeof t === 'string' ? t.trim() : (t.query || '').trim()));
    } else if (parsed && Array.isArray(parsed.terms)) {
      terms = parsed.terms.map(t => (typeof t === 'string' ? t.trim() : (t.query || '').trim()));
    }
    terms = terms.filter(t => t.length > 0);
    return terms.length > 0 ? terms : ['Node.js', 'Backend'];
  } catch (err) {
    console.warn(`${colors.yellow}⚠️ Aviso: Não foi possível ler termos de busca (${err.message}). Usando padrão.${colors.reset}`);
    return ['Node.js', 'Backend'];
  }
}

function loadAllowedCities() {
  if (!fs.existsSync(ALLOWED_CITIES_FILE)) {
    return rules.locationFilter?.localCities || [];
  }
  try {
    const raw = fs.readFileSync(ALLOWED_CITIES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(c => (typeof c === 'string' ? c.trim() : ''))
        .filter(c => c.length > 0);
    }
    return rules.locationFilter?.localCities || [];
  } catch (err) {
    console.warn(`${colors.yellow}⚠️ Aviso: Não foi possível ler allowed-cities.json (${err.message}). Usando padrão de rules.config.js.${colors.reset}`);
    return rules.locationFilter?.localCities || [];
  }
}

function parseArgs(availableTerms) {
  const args = process.argv.slice(2);
  const defaultQuery = availableTerms.length > 0 ? availableTerms[0] : 'Node.js';
  const options = {
    query: defaultQuery,
    customQuerySpecified: false,
    allTerms: false,
    listTerms: false,
    selectedTerm: null,
    limit: 25,
    timeFilter: rules.searchDefaults.timeFilter || 'past-24h',
    export: false,
    filterEnglish: rules.filterOutFluentEnglishCalls,
    remoteOnly: false
  };

  for (const arg of args) {
    if (arg.startsWith('--query=')) {
      options.query = arg.split('=')[1].replace(/^"|"$/g, '');
      options.customQuerySpecified = true;
    } else if (arg.startsWith('--term=')) {
      options.selectedTerm = arg.split('=')[1].replace(/^"|"$/g, '');
    } else if (arg === '--all' || arg === '--all-terms') {
      options.allTerms = true;
    } else if (arg === '--list-terms') {
      options.listTerms = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--days=')) {
      const days = parseInt(arg.split('=')[1], 10);
      if (days <= 1) options.timeFilter = 'past-24h';
      else if (days <= 7) options.timeFilter = 'past-week';
      else if (days <= 30) options.timeFilter = 'past-month';
      else options.timeFilter = 'all';
    } else if (arg === '--export') {
      options.export = true;
    } else if (arg === '--filter-english') {
      options.filterEnglish = true;
    } else if (arg === '--remote-only') {
      options.remoteOnly = true;
    } else if (arg === '--no-remote-only') {
      options.remoteOnly = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (options.selectedTerm) {
    const numIdx = parseInt(options.selectedTerm, 10);
    if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= availableTerms.length) {
      options.query = availableTerms[numIdx - 1];
    } else {
      const exactMatch = availableTerms.find(t => t.toLowerCase() === options.selectedTerm.toLowerCase());
      if (exactMatch) {
        options.query = exactMatch;
      } else {
        const partialMatch = availableTerms.find(t => t.toLowerCase().includes(options.selectedTerm.toLowerCase()));
        options.query = partialMatch || options.selectedTerm;
      }
    }
    options.customQuerySpecified = true;
  }

  return options;
}

function printHelp() {
  console.log(`
${colors.bold}${colors.cyan}Radar de Vagas ProgramaThor - CLI${colors.reset}

Uso:
  node programathor-cli.js [opções]

Opções:
  --query="<termo>"      Termo de busca (ex: "Node.js", "Backend", "TypeScript")
  --term=<nome|índice>   Usa termo de programathor-search-terms.json por índice ou nome
  --all                  Varre TODOS os termos de programathor-search-terms.json com deduplicação
  --list-terms           Lista todos os termos configurados para o ProgramaThor
  --days=<dias>          Filtro de tempo: 1 (últimas 24h - padrão), 7 (última semana), 30 (último mês)
  --limit=<num>          Quantidade máxima de vagas por termo (default: 25)
  --remote-only          Filtra apenas vagas cadastradas como 100% remotas
  --no-remote-only       Busca ampla (remoto + cidades permitidas) - padrão
  --filter-english       Descarta vagas que exigem inglês fluente falado/calls diárias
  --export               Gera relatório detalhado em markdown em candidaturas/
  --help, -h             Mostra esta mensagem de ajuda

Arquivos de Configuração:
  company-blacklist.json          Empresas bloqueadas
  terms-blacklist.json            Stacks/termos proibidos
  programathor-search-terms.json  Termos de busca
  allowed-cities.json             Cidades locais permitidas para presencial/híbrido

Exemplos:
  npm run scan:programathor                # Busca termo padrão no ProgramaThor (últimas 24h)
  npm run scan:programathor:all            # Varre todos os termos do ProgramaThor
  node programathor-cli.js --all --export  # Varre tudo e exporta relatório em markdown
  node programathor-cli.js --query="Node.js" --days=7 --export
`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const availableTerms = loadSearchTerms();
  const opts = parseArgs(availableTerms);

  if (opts.listTerms) {
    console.log(`\n${colors.bold}${colors.cyan}📋 Termos configurados em programathor-search-terms.json:${colors.reset}\n`);
    availableTerms.forEach((term, idx) => {
      console.log(`  ${colors.bold}${idx + 1}.${colors.reset} ${term}`);
    });
    console.log(`\n${colors.dim}Dica: Execute com --term=1 ou --term="${availableTerms[0]}" para buscar um termo específico.${colors.reset}`);
    console.log(`${colors.dim}Ou execute com --all para varrer todos de uma vez.${colors.reset}\n`);
    return;
  }

  const jsonCompanyBlacklist = loadCompanyBlacklist();
  const mergedCompanyBlacklist = [...new Set([...(rules.companyBlacklist || []), ...jsonCompanyBlacklist])];
  const jsonTermBlacklist = loadTermsBlacklist();
  const jsonAllowedCities = loadAllowedCities();
  const activeAllowedCities = jsonAllowedCities.length > 0
    ? jsonAllowedCities
    : (rules.locationFilter?.localCities || []);

  const activeRules = {
    ...rules,
    companyBlacklist: mergedCompanyBlacklist,
    termBlacklist: jsonTermBlacklist,
    locationFilter: {
      ...rules.locationFilter,
      localCities: activeAllowedCities
    },
    filterOutFluentEnglishCalls: opts.filterEnglish
  };

  const termsToSearch = opts.allTerms ? availableTerms : [opts.query];

  console.log(`\n${colors.bold}${colors.cyan}======================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}🎯 RADAR DE VAGAS: PROGRAMATHOR (programathor.com.br)${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================${colors.reset}`);
  if (opts.allTerms) {
    console.log(`🔍 ${colors.bold}Modo:${colors.reset} Lote completo com ${termsToSearch.length} termos de programathor-search-terms.json`);
  } else {
    console.log(`🔍 ${colors.bold}Termo:${colors.reset} "${opts.query}" ${!opts.customQuerySpecified ? colors.dim + '(padrão de programathor-search-terms.json)' + colors.reset : ''}`);
  }
  const remoteInfo = opts.remoteOnly ? 'Apenas Remoto' : 'Busca Ampla (Remoto + Cidades Permitidas)';
  console.log(`💻 ${colors.bold}Modalidade:${colors.reset} ${remoteInfo} | ⏳ ${colors.bold}Período:${colors.reset} ${opts.timeFilter}`);
  console.log(`🏙️  ${colors.bold}Cidades Locais:${colors.reset} ${activeAllowedCities.length} cidades (allowed-cities.json)`);
  console.log(`🚫 ${colors.bold}Blacklist:${colors.reset} ${mergedCompanyBlacklist.length} empresas | ${jsonTermBlacklist.length} termos`);
  console.log(`📊 ${colors.bold}Alvo:${colors.reset} até ${opts.limit} vagas/termo\n`);

  console.log(`${colors.dim}Conectando ao ProgramaThor (Modo Guest)...${colors.reset}`);

  const rawJobs = [];
  const seenJobIds = new Set();

  for (let tIdx = 0; tIdx < termsToSearch.length; tIdx++) {
    const currentTerm = termsToSearch[tIdx];
    if (opts.allTerms) {
      console.log(`\n🔎 [${tIdx + 1}/${termsToSearch.length}] Coletando vagas no ProgramaThor para: "${colors.bold}${currentTerm}${colors.reset}"...`);
    }

    const termJobs = await searchProgramathorJobs({
      query: currentTerm,
      remoteOnly: opts.remoteOnly,
      limit: opts.limit
    });

    let newCount = 0;
    for (const job of termJobs) {
      if (!seenJobIds.has(job.jobId)) {
        seenJobIds.add(job.jobId);
        rawJobs.push(job);
        newCount++;
      }
    }

    if (opts.allTerms) {
      console.log(`   ${colors.green}✓ ${termJobs.length} encontradas (${newCount} inéditas adicionadas)${colors.reset}`);
      if (tIdx < termsToSearch.length - 1) {
        await sleep(400 + Math.random() * 200);
      }
    }
  }

  if (!rawJobs || rawJobs.length === 0) {
    console.log(`\n${colors.yellow}⚠️ Nenhuma vaga encontrada no ProgramaThor para os parâmetros informados.${colors.reset}\n`);
    return;
  }

  console.log(`\n${colors.green}✓ ${rawJobs.length} vagas brutas únicas prontas para análise cirúrgica.${colors.reset}\n`);

  const passedJobs = [];
  const rejectedJobs = [];
  const lowScoreJobs = [];

  for (let i = 0; i < rawJobs.length; i++) {
    const job = rawJobs[i];
    process.stdout.write(`${colors.dim}[${i + 1}/${rawJobs.length}] Analisando:${colors.reset} ${job.title.slice(0, 45)}... `);

    // 1. Pré-checagem de Blacklist de Empresa
    if (job.company && activeRules.companyBlacklist && activeRules.companyBlacklist.length > 0) {
      const isBlacklisted = activeRules.companyBlacklist.some(c => {
        const clean = typeof c === 'string' ? c.trim().toLowerCase() : '';
        return clean.length > 0 && job.company.toLowerCase().includes(clean);
      });
      if (isBlacklisted) {
        job.analysis = {
          status: 'REJECTED',
          rejectReason: `Empresa na blacklist (${job.company})`,
          ruleId: 'COMPANY_BLACKLIST',
          score: 0,
          matchedKeywords: []
        };
        rejectedJobs.push(job);
        console.log(`\n  ${colors.red}❌ DESCARTADA:${colors.reset} Empresa na blacklist (${job.company})`);
        if (job.link) console.log(`     ${colors.dim}Link: ${job.link}${colors.reset}`);
        continue;
      }
    }

    // 2. Pré-checagem por tags proibidas do card (PHP, Flutter, C#, Java, etc.)
    if (job.tags && job.tags.length > 0 && activeRules.termBlacklist && activeRules.termBlacklist.length > 0) {
      let matchedTagBlacklist = null;
      for (const item of activeRules.termBlacklist) {
        const termStr = typeof item === 'string' ? item.trim().toLowerCase() : (item.term || '').trim().toLowerCase();
        if (!termStr) continue;
        const found = job.tags.find(t => {
          const tagNorm = t.trim().toLowerCase();
          if (termStr === 'java' && tagNorm.includes('javascript')) return false;
          if (termStr === 'c' && tagNorm !== 'c') return false;
          return tagNorm === termStr;
        });
        if (found) {
          matchedTagBlacklist = found;
          break;
        }
      }
      if (matchedTagBlacklist) {
        job.analysis = {
          status: 'REJECTED',
          rejectReason: `Tag proibida na blacklist ("${matchedTagBlacklist}")`,
          ruleId: 'TERM_BLACKLIST',
          score: 0,
          matchedKeywords: []
        };
        rejectedJobs.push(job);
        console.log(`\n  ${colors.red}❌ DESCARTADA:${colors.reset} Tag na blacklist ("${matchedTagBlacklist}") [ignorado fetch]`);
        if (job.link) console.log(`     ${colors.dim}Link: ${job.link}${colors.reset}`);
        continue;
      }
    }

    // 3. Pré-checagem de senioridade pelo título ou tag do card
    if (job.seniority && job.seniority.toLowerCase().includes('sênior')) {
      const hasSeniorBlacklist = activeRules.termBlacklist.some(t => {
        const str = typeof t === 'string' ? t.toLowerCase() : (t.term || '').toLowerCase();
        return str === 'sênior' || str === 'senior';
      });
      if (hasSeniorBlacklist) {
        job.analysis = {
          status: 'REJECTED',
          rejectReason: 'Senioridade incompatível (Sênior)',
          ruleId: 'SENIOR_NOT_ALLOWED',
          score: 0,
          matchedKeywords: []
        };
        rejectedJobs.push(job);
        console.log(`\n  ${colors.red}❌ DESCARTADA:${colors.reset} Senioridade incompatível (Sênior) [ignorado fetch]`);
        if (job.link) console.log(`     ${colors.dim}Link: ${job.link}${colors.reset}`);
        continue;
      }
    }

    // 4. Delay educado antes de obter os detalhes
    await sleep(250 + Math.random() * 200);

    const details = await getProgramathorJobDetails(job.link);
    if (!details || !details.description) {
      job.analysis = {
        status: 'REJECTED',
        rejectReason: 'Vaga indisponível ou encerrada no ProgramaThor (HTTP 404/500)',
        ruleId: 'JOB_CLOSED',
        score: 0,
        matchedKeywords: []
      };
      rejectedJobs.push(job);
      console.log(`\n  ${colors.red}❌ DESCARTADA:${colors.reset} Vaga indisponível/encerrada`);
      if (job.link) console.log(`     ${colors.dim}Link: ${job.link}${colors.reset}`);
      continue;
    }

    job.datePosted = details.datePosted;
    job.postedTime = details.postedTime;
    job.description = details.description;

    // 5. Checagem precisa de data de publicação (< 24h, semana, mês)
    if (details.datePosted && isProgramathorPostingTooOld(details.datePosted, opts.timeFilter)) {
      job.analysis = {
        status: 'REJECTED',
        rejectReason: `Publicada fora do período solicitado (${details.postedTime})`,
        ruleId: 'TOO_OLD',
        score: 0,
        matchedKeywords: []
      };
      rejectedJobs.push(job);
      console.log(`\n  ${colors.red}❌ DESCARTADA:${colors.reset} Fora do período (${details.postedTime})`);
      if (job.link) console.log(`     ${colors.dim}Link: ${job.link}${colors.reset}`);
      continue;
    }

    // 6. Análise cirúrgica de regras
    const analysis = analyzeJob(job, activeRules);
    job.analysis = analysis;

    if (analysis.status === 'REJECTED') {
      rejectedJobs.push(job);
      console.log(`\n  ${colors.red}❌ DESCARTADA:${colors.reset} ${analysis.rejectReason}`);
      if (analysis.matchedSnippet) {
        console.log(`     ${colors.dim}Gatilho: ${analysis.matchedSnippet}${colors.reset}`);
      }
      if (job.link) console.log(`     ${colors.dim}Link: ${job.link}${colors.reset}`);

      if (analysis.ruleId === 'ENGLISH_DESCRIPTION' && job.company) {
        addCompanyToBlacklist(job.company, activeRules);
      }
    } else if (analysis.status === 'LOW_SCORE') {
      lowScoreJobs.push(job);
      console.log(`\n  ${colors.yellow}⚠️ POUCO RELEVANTE (Score ${analysis.score}/100)${colors.reset} - Keywords insuficientes`);
      if (job.link) console.log(`     ${colors.dim}Link: ${job.link}${colors.reset}`);
    } else {
      passedJobs.push(job);
      const badge = analysis.tier === 'ALTA_PRIORIDADE'
        ? `${colors.bgGreen} ALTA PRIORIDADE ${colors.reset}`
        : `${colors.green} BOA OPORTUNIDADE ${colors.reset}`;

      console.log(`\n  ${badge} ${colors.bold}Score: ${analysis.score}/100${colors.reset}`);
      console.log(`     ${colors.cyan}Empresa:${colors.reset} ${job.company} | ${colors.dim}${job.location} (${job.postedTime})${colors.reset}`);
      console.log(`     ${colors.dim}Keywords:${colors.reset} ${analysis.matchedKeywords.join(', ') || 'N/A'}`);
      console.log(`     ${colors.dim}Link:${colors.reset} ${job.link}`);
    }
  }

  // Ordena aprovadas por score decrescente
  passedJobs.sort((a, b) => b.analysis.score - a.analysis.score);

  // Painel Final
  console.log(`\n${colors.bold}${colors.cyan}======================================================${colors.reset}`);
  console.log(`${colors.bold}📊 RESULTADO DO RADAR PROGRAMATHOR${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================${colors.reset}`);
  console.log(`Total varrido (únicas): ${rawJobs.length}`);
  console.log(`${colors.red}Descartadas (Deal-Breakers / Blacklist / Data): ${rejectedJobs.length}${colors.reset}`);
  console.log(`${colors.yellow}Descartadas (Score Baixo): ${lowScoreJobs.length}${colors.reset}`);
  console.log(`${colors.green}${colors.bold}Aprovadas no seu perfil: ${passedJobs.length}${colors.reset}\n`);

  if (passedJobs.length > 0) {
    console.log(`${colors.bold}🏆 TOP VAGAS IDENTIFICADAS NO PROGRAMATHOR:${colors.reset}`);
    passedJobs.forEach((job, idx) => {
      console.log(`\n${colors.bold}${idx + 1}. [Score: ${job.analysis.score}/100] ${job.title}${colors.reset}`);
      console.log(`   🏢 Empresa: ${job.company} | 📍 ${job.location} | 🕒 ${job.postedTime}`);
      console.log(`   🔑 Stack detectada: ${job.analysis.matchedKeywords.join(' • ')}`);
      console.log(`   🔗 Link direto: ${job.link}`);
    });
  }

  if (opts.export) {
    exportToMarkdown(passedJobs, rejectedJobs, lowScoreJobs, opts, termsToSearch);
  } else {
    console.log(`\n${colors.dim}💡 Dica: Rode com --export para salvar estas vagas formatadas em candidaturas/${colors.reset}`);
  }

  console.log('\n');
}

function exportToMarkdown(passedJobs, rejectedJobs, lowScoreJobs, opts, termsSearched) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileQuerySlug = opts.allTerms
    ? 'todos-os-termos'
    : opts.query.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const fileName = `radar-programathor-${fileQuerySlug}-${timestamp}.md`;

  if (!fs.existsSync(CANDIDATURAS_DIR)) {
    fs.mkdirSync(CANDIDATURAS_DIR, { recursive: true });
  }
  const filePath = path.join(CANDIDATURAS_DIR, fileName);

  const headerTitle = opts.allTerms
    ? `Radar ProgramaThor Consolidado: Múltiplos Termos`
    : `Radar ProgramaThor: ${opts.query}`;

  const totalAnalyzed = passedJobs.length + rejectedJobs.length + lowScoreJobs.length;
  const totalDiscarded = rejectedJobs.length + lowScoreJobs.length;

  let md = `# ${headerTitle} (${timestamp})\n\n`;
  md += `**Fonte:** ProgramaThor (programathor.com.br) | **Período:** ${opts.timeFilter}\n`;
  if (opts.allTerms) {
    md += `**Termos pesquisados (${termsSearched.length}):** ${termsSearched.map(t => `\`${t}\``).join(', ')}\n`;
  }
  md += `**Total analisadas:** ${totalAnalyzed} | **Aprovadas:** ${passedJobs.length} | **Descartadas:** ${totalDiscarded}\n\n`;

  md += `## 🎯 Vagas Selecionadas (Ordenadas por Match Técnico)\n\n`;

  if (passedJobs.length === 0) {
    md += `*Nenhuma vaga atingiu a pontuação mínima necessária nos termos pesquisados.*\n\n`;
  } else {
    passedJobs.forEach((job, idx) => {
      md += `### ${idx + 1}. ${job.title} — **${job.company}**\n`;
      md += `- **Score de Aderência:** \`${job.analysis.score}/100\` (${job.analysis.tier})\n`;
      md += `- **Localidade / Postada:** ${job.location} (${job.postedTime || 'Recente'})\n`;
      if (job.seniority || job.contract) {
        md += `- **Senioridade / Contrato:** ${[job.seniority, job.contract].filter(Boolean).join(' - ')}\n`;
      }
      md += `- **Stack Detectada:** ${job.analysis.matchedKeywords.map(k => `\`${k}\``).join(', ')}\n`;
      md += `- **Link da Vaga:** [Acessar Vaga no ProgramaThor](${job.link})\n`;
      md += `- **Status da Candidatura:** [ ] Não aplicada | [ ] Aplicada | [ ] Contato com Tech Recruiter\n\n`;
      if (job.description) {
        md += `<details><summary>Ver trecho da descrição</summary>\n\n\`\`\`\n${job.description.slice(0, 500)}...\n\`\`\`\n</details>\n\n---\n\n`;
      }
    });
  }

  const allEliminated = [
    ...rejectedJobs,
    ...lowScoreJobs.map(job => ({
      ...job,
      analysis: {
        ...job.analysis,
        ruleId: 'LOW_SCORE',
        rejectReason: `Pontuação insuficiente (${job.analysis?.score ?? 0}/100 - mínimo ${rules.scoring.minScoreToDisplay})`
      }
    }))
  ];

  if (allEliminated.length > 0) {
    md += `## 🗑️ Vagas Eliminadas pelo Filtro (${allEliminated.length})\n\n`;
    md += `| Vaga | Empresa | Motivo do Descarte | Link |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    allEliminated.forEach(job => {
      const cleanTitle = (job.title || 'Sem título').replace(/\|/g, '-');
      const cleanCompany = (job.company || 'Não informada').replace(/\|/g, '-');
      const linkMarkdown = job.link ? `[Ver no ProgramaThor](${job.link})` : 'N/A';
      md += `| ${cleanTitle} | ${cleanCompany} | ${job.analysis?.rejectReason || 'Descartada por filtro'} | ${linkMarkdown} |\n`;
    });
    md += `\n`;
  }

  fs.writeFileSync(filePath, md, 'utf-8');
  console.log(`\n${colors.green}📄 Relatório exportado com sucesso para:${colors.reset} [${path.relative(process.cwd(), filePath)}]`);
}

main().catch(err => {
  console.error('\nErro fatal na execução:', err);
  process.exit(1);
});
