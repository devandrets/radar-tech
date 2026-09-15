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
 * Limpa o texto da descrição da vaga (removendo tags HTML se presentes)
 */
export function cleanGupyDescription(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    try {
      const $ = cheerio.load(raw);
      $('br').replaceWith('\n');
      $('p, li, div, h1, h2, h3, h4, h5, h6').each((_, el) => {
        $(el).append('\n');
      });
      return $.text().replace(/\n{3,}/g, '\n\n').trim();
    } catch {
      return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  return raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Formata a localização a partir dos campos estruturados da Gupy
 */
export function formatGupyLocation(item) {
  const city = (item.city || '').trim();
  const state = (item.state || '').trim();
  const isRemote = item.workplaceType === 'remote';

  let loc = '';
  if (city && state) {
    loc = `${city}, ${state}`;
  } else if (city) {
    loc = city;
  } else if (state) {
    loc = state;
  } else {
    loc = isRemote ? 'Remoto' : 'Brasil';
  }

  if (isRemote && !loc.toLowerCase().includes('remoto')) {
    loc += ' (Remoto)';
  }

  return loc;
}

/**
 * Formata a data de publicação em texto amigável relativo
 */
export function formatPostedTime(isoDate) {
  if (!isoDate) return 'Data não informada';
  const postDate = new Date(isoDate);
  if (isNaN(postDate.getTime())) return isoDate;

  const diffMs = Date.now() - postDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const dateStr = postDate.toISOString().slice(0, 10);

  if (diffHours < 1) {
    const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    return `Há ${diffMinutes} min (${dateStr})`;
  }
  if (diffHours < 24) {
    return `Há ${diffHours}h (${dateStr})`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `Há ${diffDays}d (${dateStr})`;
}

/**
 * Validação precisa de idade da publicação com base no ISO 8601 da Gupy
 */
export function isGupyPostingTooOld(isoDate, timeFilter = 'past-24h') {
  if (!isoDate || timeFilter === 'all') return false;

  const postDate = new Date(isoDate);
  if (isNaN(postDate.getTime())) return false;

  const diffHours = (Date.now() - postDate.getTime()) / (1000 * 60 * 60);

  if (timeFilter === 'past-24h') {
    return diffHours > 24;
  }
  if (timeFilter === 'past-week') {
    return diffHours > 24 * 7;
  }
  if (timeFilter === 'past-month') {
    return diffHours > 24 * 30;
  }

  return false;
}

/**
 * Busca vagas na API oficial pública de busca da Gupy (portal.gupy.io)
 */
export async function searchGupyJobs({
  jobName = 'Node',
  limit = 25,
  workplaceType = null, // 'remote', 'on-site', 'hybrid' ou null para todas
  timeFilter = 'past-24h'
}) {
  const jobs = [];
  let offset = 0;
  const batchSize = Math.min(50, Math.max(10, limit));

  while (jobs.length < limit) {
    const params = new URLSearchParams({
      jobName,
      limit: String(batchSize),
      offset: String(offset)
    });

    if (workplaceType) {
      params.append('workplaceType', workplaceType);
    }

    const url = `https://portal.gupy.io/api/job-search/jobs?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://portal.gupy.io/'
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('⚠️ Rate limit da Gupy (HTTP 429). Aguardando 2 segundos...');
          await sleep(2000);
          break;
        }
        console.warn(`[Gupy Search] HTTP ${response.status} ao consultar ${url}`);
        break;
      }

      const json = await response.json();
      const items = json.data || [];
      const totalAvailable = json.pagination?.total ?? 0;

      if (items.length === 0) {
        break;
      }

      let countAddedInBatch = 0;

      for (const item of items) {
        if (jobs.length >= limit) break;

        const jobId = String(item.id);
        const title = (item.name || '').trim();
        const company = (item.careerPageName || 'Empresa Confidencial').trim();
        const publishedDate = item.publishedDate || '';
        const workplace = (item.workplaceType || '').toLowerCase();
        const isRemote = workplace === 'remote';
        const isDisabilityAffirmative = Boolean(item.disabilities);
        const link = item.jobUrl || `https://portal.gupy.io/job/${jobId}`;
        const description = cleanGupyDescription(item.description || '');
        const location = formatGupyLocation(item);
        const postedTime = formatPostedTime(publishedDate);

        if (!title || !jobId) continue;

        // Evita duplicatas se a paginação repetir registros
        if (!jobs.some(j => j.jobId === jobId)) {
          jobs.push({
            jobId,
            title,
            company,
            location,
            city: item.city || '',
            state: item.state || '',
            workplaceType: workplace,
            isRemote,
            disabilities: isDisabilityAffirmative,
            publishedDate,
            postedTime,
            link,
            description,
            source: 'Gupy'
          });
          countAddedInBatch++;
        }
      }

      offset += items.length;

      if (offset >= totalAvailable || countAddedInBatch === 0) {
        break;
      }

      // Delay leve entre páginas
      await sleep(300 + Math.random() * 200);
    } catch (err) {
      console.error(`Erro ao buscar vagas na Gupy (offset ${offset}):`, err.message);
      break;
    }
  }

  return jobs;
}
