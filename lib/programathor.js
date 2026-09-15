import * as cheerio from 'cheerio';

const USER_AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validação precisa da data de publicação do ProgramaThor (formato YYYY-MM-DD do JSON-LD)
 */
export function isProgramathorPostingTooOld(dateStr, timeFilter = 'past-24h') {
  if (!dateStr || timeFilter === 'all') return false;

  const postDate = new Date(dateStr);
  if (isNaN(postDate.getTime())) return false;

  const diffHours = (Date.now() - postDate.getTime()) / (1000 * 60 * 60);

  // Como o ProgramaThor registra YYYY-MM-DD sem hora (meia-noite UTC),
  // uma tolerância de até 36 horas cobre publicações de hoje e do dia anterior.
  if (timeFilter === 'past-24h') {
    return diffHours > 36;
  }
  if (timeFilter === 'past-week') {
    return diffHours > 24 * 8;
  }
  if (timeFilter === 'past-month') {
    return diffHours > 24 * 31;
  }

  return false;
}

/**
 * Formata a data em formato amigável relativo
 */
export function formatPostedTime(dateStr) {
  if (!dateStr) return 'Data não informada';
  const postDate = new Date(dateStr);
  if (isNaN(postDate.getTime())) return dateStr;

  const diffMs = Date.now() - postDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays <= 0) {
    return `Hoje (${dateStr})`;
  }
  if (diffDays === 1) {
    return `Ontem (${dateStr})`;
  }
  return `Há ${diffDays}d (${dateStr})`;
}

export function resolveProgramathorUrl(query, page = 1, remoteOnly = false) {
  const norm = (query || '').toLowerCase().trim();
  const slugMap = {
    'node.js': 'jobs-node-js',
    'node': 'jobs-node-js',
    'nodejs': 'jobs-node-js',
    'typescript': 'jobs-typescript',
    'ts': 'jobs-typescript',
    'nestjs': 'jobs-nestjs',
    'nest': 'jobs-nestjs',
    'fastify': 'jobs-fastify',
    'backend': 'jobs-back-end',
    'back-end': 'jobs-back-end',
    'desenvolvedor backend': 'jobs-back-end',
    'backend node': 'jobs-node-js',
    'backend typescript': 'jobs-typescript'
  };

  const basePath = slugMap[norm];
  const params = new URLSearchParams();

  if (basePath) {
    if (page > 1) params.set('page', String(page));
    if (remoteOnly) params.set('remoto', 'true');
    const qs = params.toString();
    return `https://programathor.com.br/${basePath}${qs ? `?${qs}` : ''}`;
  }

  if (page > 1) {
    return `https://programathor.com.br/jobs/page/${page}?q=${encodeURIComponent(query)}${remoteOnly ? '&remoto=true' : ''}`;
  }
  return `https://programathor.com.br/jobs?q=${encodeURIComponent(query)}${remoteOnly ? '&remoto=true' : ''}`;
}

/**
 * Busca listagem de cards no ProgramaThor com suporte à paginação REST
 */
export async function searchProgramathorJobs({
  query = 'Node.js',
  limit = 25,
  remoteOnly = false
}) {
  const jobs = [];
  const seenJobIds = new Set();
  let page = 1;
  const maxPages = Math.ceil(limit / 15) + 2;

  while (jobs.length < limit && page <= maxPages) {
    const url = resolveProgramathorUrl(query, page, remoteOnly);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 429) break;
        console.warn(`[ProgramaThor Search] HTTP ${response.status} ao consultar ${url}`);
        break;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const cards = $('.cell-list');

      if (cards.length === 0) {
        break;
      }

      let addedInPage = 0;

      cards.each((_, el) => {
        if (jobs.length >= limit) return false;

        const card = $(el);
        const linkEl = card.find('a').first();
        const href = linkEl.attr('href') || '';
        if (!href.startsWith('/jobs/')) return;

        const matchId = href.match(/\/jobs\/(\d+)/);
        const jobId = matchId ? matchId[1] : href;
        if (seenJobIds.has(jobId)) return;

        const title = card.find('h3').first().text().trim();
        if (!title) return;

        let company = '';
        let location = '';
        let seniority = '';
        let contract = '';

        card.find('.cell-list-content-icon span').each((_, span) => {
          const s = $(span);
          if (s.find('.fa-briefcase').length > 0) company = s.text().trim();
          else if (s.find('.fa-map-marker-alt').length > 0) location = s.text().trim();
          else if (s.find('.fa-chart-bar').length > 0) seniority = s.text().trim();
          else if (s.find('.fa-file-alt').length > 0) contract = s.text().trim();
        });

        const tags = [];
        card.find('.tag-list').each((_, t) => {
          const tag = $(t).text().trim();
          if (tag) tags.push(tag);
        });

        const isRemote = location.toLowerCase().includes('remoto');

        if (remoteOnly && !isRemote) {
          return;
        }

        const fullLink = href.startsWith('http') ? href : `https://programathor.com.br${href}`;

        seenJobIds.add(jobId);
        jobs.push({
          jobId,
          title,
          company: company || 'Empresa Confidencial',
          location: location || 'Brasil',
          isRemote,
          seniority,
          contract,
          tags,
          link: fullLink,
          source: 'ProgramaThor'
        });
        addedInPage++;
      });

      if (addedInPage === 0) {
        break;
      }

      page++;
      await sleep(300 + Math.random() * 200);
    } catch (err) {
      console.error(`Erro ao buscar página ${page} no ProgramaThor:`, err.message);
      break;
    }
  }

  return jobs;
}

/**
 * Obtém os detalhes completos da vaga (data exata do JSON-LD e descrição integral)
 */
export async function getProgramathorJobDetails(jobUrl) {
  try {
    const response = await fetch(jobUrl, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // 1. Extração da data de publicação do JSON-LD
    let datePosted = '';
    const dateMatch = html.match(/"datePosted"\s*:\s*"([^"]+)"/);
    if (dateMatch && dateMatch[1]) {
      datePosted = dateMatch[1].trim();
    }

    // 2. Extração do corpo da descrição
    // Seleciona o container principal de requisitos e descrição
    let descriptionText = '';
    const reqH3 = $('h3:contains("Requisitos")');
    let container = reqH3.length > 0 ? reqH3.parent() : $('.wrapper-content-job-show');

    if (container.length > 0) {
      // Remove elementos irrelevantes e anúncios
      container.find('ins, script, style, noscript, .adsbygoogle, .wrapper-bottom-fixed').remove();
      container.find('br').replaceWith('\n');
      container.find('p, li, h1, h2, h3, h4').each((_, el) => {
        $(el).append('\n');
      });
      descriptionText = container.text().replace(/\n{3,}/g, '\n\n').trim();
    } else {
      descriptionText = $('body').text().slice(0, 1000).trim();
    }

    const postedTime = formatPostedTime(datePosted);

    return {
      datePosted,
      postedTime,
      description: descriptionText,
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    return null;
  }
}
