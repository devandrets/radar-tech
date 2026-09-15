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
export function cleanRemotarDescription(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    try {
      const $ = cheerio.load(raw);
      $('script, style, noscript').remove();
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
 * Formata a localização a partir dos campos estruturados do Remotar
 */
export function formatRemotarLocation(item) {
  const city = (item.city || '').trim();
  const state = (item.state || '').trim();
  const isRemote = item.type === 'remote';

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
  } else if (item.type === 'hybrid' && !loc.toLowerCase().includes('híbrido')) {
    loc += ' (Híbrido)';
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
 * Validação precisa de idade da publicação com base no ISO 8601 do Remotar
 */
export function isRemotarPostingTooOld(isoDate, timeFilter = 'past-24h') {
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
 * Busca vagas na API oficial pública do Remotar (api.remotar.com.br)
 */
export async function searchRemotarJobs({
  query = 'Node',
  limit = 50,
  remoteOnly = true,
  timeFilter = 'past-24h'
}) {
  const jobs = [];
  let page = 1;
  const batchSize = Math.min(50, Math.max(10, limit));
  const seenJobIds = new Set();

  while (jobs.length < limit) {
    const params = new URLSearchParams({
      search: query,
      per_page: String(batchSize),
      page: String(page)
    });

    if (remoteOnly) {
      params.append('type', 'remote');
    }

    const url = `https://api.remotar.com.br/jobs?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://remotar.com.br/'
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('⚠️ Rate limit do Remotar (HTTP 429). Aguardando 2 segundos...');
          await sleep(2000);
          break;
        }
        console.warn(`[Remotar Search] HTTP ${response.status} ao consultar ${url}`);
        break;
      }

      const json = await response.json();
      const items = json.data || [];
      const meta = json.meta || {};
      const lastPage = meta.last_page ?? 1;

      if (items.length === 0) {
        break;
      }

      let countAddedInBatch = 0;

      for (const item of items) {
        if (jobs.length >= limit) break;

        const jobId = String(item.id);
        const title = (item.title || '').trim();
        const company = (item.company?.name || 'Empresa Confidencial').trim();
        const publishedDate = item.createdAt || item.updatedAt || '';
        const workplace = (item.type || '').toLowerCase();
        const isRemote = workplace === 'remote';
        
        // Link direto no ATS original ou link da vaga no portal Remotar
        const link = item.externalLink || `https://remotar.com.br/job/${jobId}`;
        const description = cleanRemotarDescription(item.description || item.subtitle || '');
        const location = formatRemotarLocation(item);
        const postedTime = formatPostedTime(publishedDate);

        if (!title || !jobId) continue;

        if (!seenJobIds.has(jobId)) {
          seenJobIds.add(jobId);
          jobs.push({
            jobId,
            title,
            company,
            location,
            city: item.city || '',
            state: item.state || '',
            workplaceType: workplace,
            isRemote,
            publishedDate,
            postedTime,
            link,
            description,
            source: 'Remotar'
          });
          countAddedInBatch++;
        }
      }

      page++;

      if (page > lastPage || countAddedInBatch === 0) {
        break;
      }

      await sleep(250 + Math.random() * 150);
    } catch (err) {
      console.error(`Erro ao buscar vagas no Remotar (página ${page}):`, err.message);
      break;
    }
  }

  return jobs;
}
