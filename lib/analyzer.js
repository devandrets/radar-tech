/**
 * Analisador e Classificador de Vagas contra Regras Customizadas
 */
export function analyzeJob(job, rules) {
  const fullText = `${job.title} \n ${job.company} \n ${job.location} \n ${job.description || ''}`;
  const normalizedText = fullText.toLowerCase();

  // 1. Checagem de Blacklist de Empresa
  if (rules.companyBlacklist && rules.companyBlacklist.length > 0) {
    const isBlacklisted = rules.companyBlacklist.some(c => {
      const cleanCompany = typeof c === 'string' ? c.trim().toLowerCase() : '';
      return cleanCompany.length > 0 && job.company.toLowerCase().includes(cleanCompany);
    });
    if (isBlacklisted) {
      return {
        status: 'REJECTED',
        rejectReason: `Empresa na blacklist (${job.company})`,
        ruleId: 'COMPANY_BLACKLIST',
        score: 0,
        matchedKeywords: []
      };
    }
  }

  // 2. Checagem de Descrição em Inglês (Descarta e sinaliza para auto-bloqueio)
  if (job.description && isEnglishDescription(job.description)) {
    return {
      status: 'REJECTED',
      rejectReason: `Descrição da vaga em inglês (${job.company || 'Empresa'})`,
      ruleId: 'ENGLISH_DESCRIPTION',
      score: 0,
      matchedKeywords: []
    };
  }

  // 3. Checagem de Localização e Modelo de Trabalho Remoto
  // Regra:
  // - Se a vaga estiver nas cidades locais permitidas (Belo Horizonte, Contagem, Betim, etc.), ela é aceita.
  // - Se a localidade for apenas "Brasil" ou "Brazil" (típico de vagas remotas nacionais no LinkedIn), é aceita como remota.
  // - Caso contrário (outras cidades/estados), SÓ é aceita se for remota ou mencionar REMOTO no título ou na descrição.
  // - Garante que vagas que aparecem como on-site no LinkedIn (ex: Gupy/ATS) mas tenham REMOTO na descrição sejam aceitas.
  const localCities = rules.locationFilter?.localCities || [
    'betim', 'contagem', 'belo horizonte', 'igarapé', 'igarape', 'juiz de fora', 'florestal', 'mateus leme', 'nova lima'
  ];
  const isLocalCity = isAllowedLocation(job.location, localCities);
  const normLoc = normalizeLocation(job.location).trim();
  const isGenericBrazil = /^(?:brasil|brazil)$/i.test(normLoc);
  const isRemoteLoc = normLoc.includes('remoto') || normLoc.includes('remote');
  const isRemoteMention = hasRemoteMention(job.title, job.description, rules.locationFilter?.remoteRegex);

  const isRemoteTag = Boolean(
    job.isRemote === true ||
    job.workplaceType === 'remote' ||
    (Array.isArray(job.criteria) && job.criteria.some(c => /\b(?:remot[oa]s?|remote)\b/i.test(c)))
  );

  // Trabalho remoto genuíno:
  // - Localidade apenas "Brasil" ou "Brazil" (padrão de vagas remotas nacionais no LinkedIn)
  // - Localidade trazendo explicitamente "remoto"
  // - Tag explícita de Remoto (isRemote, workplaceType === 'remote' ou nos critérios)
  // - Ou menção explícita de remoto no título ou descrição
  const isRemote = isGenericBrazil || isRemoteLoc || isRemoteMention || isRemoteTag;

  // Se NÃO for cidade local permitida (BH, Betim, Contagem...):
  if (!isLocalCity) {
    // 1. "hybrid só é válido, se for nas cidades citadas no json."
    // Se a vaga for fora das cidades permitidas e tiver marcação/menção de modelo híbrido, descarta sumariamente!
    const isHybrid = job.workplaceType === 'hybrid' ||
      /\b(?:h[íi]brido|hybrid)\b/i.test(`${job.title} ${job.description || ''}`) ||
      (Array.isArray(job.criteria) && job.criteria.some(c => /\bh[íi]brido|hybrid\b/i.test(c)));

    if (isHybrid) {
      return {
        status: 'REJECTED',
        rejectReason: `Vaga híbrida fora da região permitida (${job.location || 'Não informado'}). Híbrido só é válido nas cidades locais.`,
        ruleId: 'HYBRID_OUT_OF_REGION',
        score: 0,
        matchedKeywords: []
      };
    }

    // 2. Se não for comprovadamente remota (por tag, título ou descrição), descarta
    if (!isRemote) {
      return {
        status: 'REJECTED',
        rejectReason: `Local fora da região permitida (${job.location || 'Não informado'}) e sem menção a trabalho remoto na descrição`,
        ruleId: 'NO_REMOTE_MENTION',
        score: 0,
        matchedKeywords: []
      };
    }
  }

  // 5. Checagem de Blacklist de Termos Customizados (terms-blacklist.json)
  if (rules.termBlacklist && rules.termBlacklist.length > 0) {
    for (const item of rules.termBlacklist) {
      const termStr = typeof item === 'string' ? item.trim() : (item.term || '').trim();
      if (!termStr) continue;

      // Se a vaga for em cidade permitida do allowed-cities.json, termos de presencial/híbrido não a descartam
      if (isLocalCity && /^(?:presencial|h[íi]brido)$/i.test(termStr)) {
        continue;
      }

      const onlyTitle = typeof item === 'object' && item.onlyTitle;
      const textToMatch = onlyTitle ? (job.title || '') : fullText;

      const regex = createTermRegex(termStr);
      const match = textToMatch.match(regex);
      if (match) {
        const index = match.index || 0;
        const start = Math.max(0, index - 25);
        const end = Math.min(textToMatch.length, index + match[0].length + 25);
        const snippet = textToMatch.slice(start, end).replace(/\s+/g, ' ').trim();

        return {
          status: 'REJECTED',
          rejectReason: `Termo proibido na blacklist ("${termStr}")`,
          ruleId: 'TERM_BLACKLIST',
          matchedSnippet: `"...${snippet}..."`,
          score: 0,
          matchedKeywords: []
        };
      }
    }
  }

  // 3. Checagem de Deal-Breakers (Eliminação Sumária)
  for (const breaker of rules.dealBreakers) {
    // Se a vaga está nas cidades locais permitidas, NÃO aplica FAKE_REMOTE (pois híbrido e presencial são válidos nessas cidades)
    if (isLocalCity && breaker.id === 'FAKE_REMOTE') {
      continue;
    }

    const textToMatch = breaker.onlyTitle ? (job.title || '') : fullText;
    const match = textToMatch.match(breaker.regex);
    if (match) {
      // Extrai snippet de contexto (30 chars antes e depois)
      const index = match.index || 0;
      const start = Math.max(0, index - 25);
      const end = Math.min(textToMatch.length, index + match[0].length + 25);
      const snippet = textToMatch.slice(start, end).replace(/\s+/g, ' ').trim();

      return {
        status: 'REJECTED',
        rejectReason: breaker.label,
        ruleId: breaker.id,
        matchedSnippet: `"...${snippet}..."`,
        score: 0,
        matchedKeywords: []
      };
    }
  }

  // 3. Checagem opcional de Inglês Fluente / Calls Internacionais
  if (rules.filterOutFluentEnglishCalls && rules.fluentEnglishRegex) {
    const match = fullText.match(rules.fluentEnglishRegex);
    if (match) {
      return {
        status: 'REJECTED',
        rejectReason: 'Exige conversação fluente em inglês / reuniões diárias',
        ruleId: 'FLUENT_ENGLISH_REQUIRED',
        score: 0,
        matchedKeywords: []
      };
    }
  }

  // 4. Cálculo de Match Score & Identificação de Keywords
  let totalScore = 0;
  const matchedKeywords = [];
  const scoreBreakdown = {};

  const scoringConfig = rules.scoring || {};
  const weights = scoringConfig.weights || {};

  // Core Stack (Peso alto: teto de 40 pts)
  if (weights.core) {
    const coreMatches = [];
    for (const kw of weights.core.keywords) {
      const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
      if (regex.test(fullText)) {
        coreMatches.push(kw);
      }
    }
    const coreScore = Math.min(40, coreMatches.length * (weights.core.points || 15));
    totalScore += coreScore;
    scoreBreakdown.core = { score: coreScore, matches: coreMatches };
    matchedKeywords.push(...coreMatches);
  }

  // Cloud & Arquitetura (Teto de 30 pts)
  if (weights.cloudAndArchitecture) {
    const cloudMatches = [];
    for (const kw of weights.cloudAndArchitecture.keywords) {
      const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
      if (regex.test(fullText)) {
        cloudMatches.push(kw);
      }
    }
    const cloudScore = Math.min(30, cloudMatches.length * (weights.cloudAndArchitecture.points || 10));
    totalScore += cloudScore;
    scoreBreakdown.cloud = { score: cloudScore, matches: cloudMatches };
    matchedKeywords.push(...cloudMatches);
  }

  // Mensageria & Bancos de Dados (Teto de 20 pts)
  if (weights.dataAndMessaging) {
    const dataMatches = [];
    for (const kw of weights.dataAndMessaging.keywords) {
      const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
      if (regex.test(fullText)) {
        dataMatches.push(kw);
      }
    }
    const dataScore = Math.min(20, dataMatches.length * (weights.dataAndMessaging.points || 10));
    totalScore += dataScore;
    scoreBreakdown.data = { score: dataScore, matches: dataMatches };
    matchedKeywords.push(...dataMatches);
  }

  // Boosters & Ferramentas Modernas (Teto de 10 pts)
  if (weights.boosters) {
    const boosterMatches = [];
    for (const kw of weights.boosters.keywords) {
      const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
      if (regex.test(fullText)) {
        boosterMatches.push(kw);
      }
    }
    const boosterScore = Math.min(10, boosterMatches.length * (weights.boosters.points || 5));
    totalScore += boosterScore;
    scoreBreakdown.boosters = { score: boosterScore, matches: boosterMatches };
    matchedKeywords.push(...boosterMatches);
  }

  // Normaliza pontuação final entre 0 e 100
  const finalScore = Math.min(100, Math.max(0, totalScore));

  const hotThreshold = scoringConfig.hotScoreThreshold || 65;
  const minThreshold = scoringConfig.minScoreToDisplay || 30;

  let tier = 'COMPLEMENTAR';
  if (finalScore >= hotThreshold) {
    tier = 'ALTA_PRIORIDADE';
  } else if (finalScore >= minThreshold) {
    tier = 'BOA_OPORTUNIDADE';
  }

  return {
    status: finalScore >= minThreshold ? 'PASSED' : 'LOW_SCORE',
    score: finalScore,
    tier,
    isRemote: Boolean(isRemote),
    isLocalCity: Boolean(isLocalCity),
    scoreBreakdown,
    matchedKeywords: [...new Set(matchedKeywords)]
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createTermRegex(term) {
  const escaped = escapeRegExp(term);
  const isWordStart = /^[\p{L}\p{N}]/u.test(term);
  const isWordEnd = /[\p{L}\p{N}]$/u.test(term);
  const prefix = isWordStart ? '(?:^|[^\\p{L}\\p{N}_])' : '(?:^|\\s)';
  const suffix = isWordEnd ? '(?:$|[^\\p{L}\\p{N}_])' : '(?:$|\\s)';
  return new RegExp(`${prefix}${escaped}${suffix}`, 'iu');
}

// Marcadores e stopwords inequívocos em inglês (evitando colisões com palavras comuns em PT como "a", "as", "no", "me", "se")
const ENGLISH_UNAMBIGUOUS = new Set([
  'the', 'be', 'to', 'of', 'and', 'in', 'that', 'have', 'it', 'for',
  'not', 'on', 'with', 'he', 'you', 'do', 'at', 'this', 'but', 'his',
  'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my',
  'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if',
  'about', 'who', 'get', 'which', 'go', 'when', 'make', 'can', 'like',
  'time', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look',
  'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two',
  'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because',
  'any', 'these', 'give', 'day', 'most', 'us', 'are', 'is', 'were', 'was',
  'responsibilities', 'requirements', 'qualifications', 'experience', 'skills',
  'role', 'opportunity', 'join', 'working', 'looking', 'plus', 'preferred',
  'benefits', 'salary', 'equal', 'diversity', 'inclusion', 'overview', 'duties'
]);

// Marcadores e stopwords inequívocos em português
const PORTUGUESE_UNAMBIGUOUS = new Set([
  'de', 'que', 'do', 'da', 'em', 'um', 'para', 'é', 'com',
  'não', 'uma', 'os', 'na', 'por', 'mais', 'dos', 'como',
  'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu', 'sua', 'ou', 'ser',
  'quando', 'muito', 'há', 'nos', 'já', 'está', 'eu', 'também', 'só', 'pelo',
  'pela', 'até', 'isso', 'ela', 'entre', 'era', 'depois', 'sem', 'mesmo', 'aos',
  'ter', 'seus', 'quem', 'nas', 'esse', 'eles', 'estão', 'você', 'voce',
  'tinha', 'foram', 'essa', 'num', 'nem', 'suas', 'meu', 'às', 'minha', 'têm',
  'numa', 'pelos', 'elas', 'havia', 'seja', 'qual', 'será', 'nós', 'tenho',
  'lhe', 'deles', 'essas', 'esses', 'pelas', 'este', 'fosse', 'dele', 'tu',
  'te', 'vocês', 'lhes', 'meus', 'minhas', 'teu', 'tua', 'teus', 'tuas',
  'nosso', 'nossa', 'nossos', 'nossas', 'dela', 'delas', 'esta', 'estes',
  'estas', 'sobre', 'vaga', 'vagas', 'oportunidade', 'requisitos', 'atividades',
  'responsabilidades', 'diferenciais', 'benefícios', 'beneficios',
  'conhecimento', 'conhecimentos', 'experiência', 'experiencia', 'empresa',
  'equipe', 'time', 'trabalho', 'trabalhar', 'atuar', 'atuação', 'desenvolvimento',
  'salário', 'salario', 'contratação', 'contratacao', 'área', 'area'
]);

/**
 * Detecta se o texto de uma descrição de vaga está predominantemente em inglês.
 */
export function isEnglishDescription(text) {
  if (!text || typeof text !== 'string') return false;
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < 15) return false;

  let enCount = 0;
  let ptCount = 0;

  for (const w of words) {
    if (ENGLISH_UNAMBIGUOUS.has(w)) enCount++;
    if (PORTUGUESE_UNAMBIGUOUS.has(w)) ptCount++;
  }

  return (enCount >= 8 && enCount > ptCount * 2) || (ptCount === 0 && enCount >= 5);
}

/**
 * Normaliza strings para comparação (minúsculas, sem acentos).
 */
export function normalizeLocation(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Verifica se a localização informada bate com as cidades/regiões autorizadas.
 */
export function isAllowedLocation(locationStr, allowedList) {
  if (!locationStr || typeof locationStr !== 'string') return false;
  if (!Array.isArray(allowedList) || allowedList.length === 0) return true;
  const norm = normalizeLocation(locationStr);
  return allowedList.some(allowed => norm.includes(normalizeLocation(allowed)));
}

/**
 * Verifica se o título ou descrição menciona expressamente trabalho remoto.
 */
export function hasRemoteMention(title, description, customRegex) {
  const text = `${title || ''} \n ${description || ''}`;
  const regex = customRegex || /\b(?:remot[oa]s?|remote|home[\s-]?office|teletrabalho|qualquer\s+lugar\s+do\s+brasil|trabalho\s+[aà]\s+dist[âa]ncia)\b/i;
  return regex.test(text);
}
