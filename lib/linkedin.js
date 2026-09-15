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

const TIME_FILTER_MAP = {
  'past-24h': 'r86400',
  'past-week': 'r604800',
  'past-month': 'r2592000',
  'all': ''
};

/**
 * Busca lista inicial de vagas no endpoint público de guest do LinkedIn
 */
export async function searchJobs({
  keywords = 'Node.js',
  location = 'Brasil',
  remoteOnly = true,
  timeFilter = 'past-week',
  limit = 25,
  geoId = '106057199' // Brasil
}) {
  const jobs = [];
  let start = 0;
  const timeCode = TIME_FILTER_MAP[timeFilter] || '';

  while (jobs.length < limit) {
    const params = new URLSearchParams({
      keywords,
      location,
      geoId,
      start: String(start)
    });

    if (remoteOnly) {
      params.append('f_WT', '2'); // 2 = Remoto
    }

    if (timeCode) {
      params.append('f_TPR', timeCode);
    }

    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://www.google.com/'
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('⚠️ Rate limit do LinkedIn (HTTP 429). Aguardando 3 segundos...');
          await sleep(3000);
          break;
        }
        console.warn(`[LinkedIn Search] HTTP ${response.status} ao consultar ${url}`);
        break;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const items = $('li');

      if (items.length === 0) {
        // Fim dos resultados disponíveis
        break;
      }

      let countAddedInBatch = 0;

      items.each((_, el) => {
        if (jobs.length >= limit) return false;

        const card = $(el).find('.base-card');
        const urn = card.attr('data-entity-urn') || '';
        let jobId = urn.replace('urn:li:jobPosting:', '').trim();

        const rawLink = $(el).find('.base-card__full-link').attr('href') || '';
        if (!jobId && rawLink) {
          const match = rawLink.match(/\/view\/(\d+)/);
          if (match) jobId = match[1];
        }

        const title = $(el).find('.base-search-card__title').text().trim();
        const company = $(el).find('.base-search-card__subtitle').text().trim();
        const loc = $(el).find('.job-search-card__location').text().trim();
        const postedTime = $(el).find('time').text().trim() || $(el).find('time').attr('datetime') || '';
        const cleanLink = jobId ? `https://www.linkedin.com/jobs/view/${jobId}` : (rawLink.split('?')[0] || '');

        // Ignora cards com data explicitamente fora do filtro (ex: Há 2 dias, 1 mês, etc.)
        if (timeFilter && isPostingTooOld(postedTime, timeFilter)) {
          return;
        }

        if (title && jobId) {
          // Evita duplicatas se o LinkedIn repetir o card
          if (!jobs.some(j => j.jobId === jobId)) {
            const cleanLoc = (loc || '').trim();
            const isBrazilLoc = /^(?:brasil|brazil)$/i.test(cleanLoc);
            const hasRemoteInLoc = /\b(?:remot[oa]s?|remote)\b/i.test(cleanLoc);
            const hasRemoteInTitle = /\b(?:remot[oa]s?|remote)\b/i.test(title);
            const isJobRemote = isBrazilLoc || hasRemoteInLoc || hasRemoteInTitle;

            jobs.push({
              jobId,
              title,
              company,
              location: loc,
              postedTime,
              link: cleanLink,
              isRemote: isJobRemote,
              workplaceType: isJobRemote ? 'remote' : (cleanLoc ? 'city_office' : undefined)
            });
            countAddedInBatch++;
          }
        }
      });

      if (countAddedInBatch === 0) {
        break;
      }

      start += items.length;
      // Delay educado entre páginas
      await sleep(600 + Math.random() * 400);
    } catch (err) {
      console.error(`Erro ao buscar página ${start}:`, err.message);
      break;
    }
  }

  return jobs;
}

/**
 * Obtém a descrição completa de uma vaga através da API de guest
 */
export async function getJobDetails(jobId) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Seletores comuns de descrição no layout público
    const descEl = $('.show-more-less-html__markup');
    let descriptionText = '';

    if (descEl.length > 0) {
      // Converte quebras de linha e parágrafos antes de extrair texto puro
      descEl.find('br').replaceWith('\n');
      descEl.find('p, li').each((_, el) => {
        $(el).append('\n');
      });
      descriptionText = descEl.text().replace(/\n{3,}/g, '\n\n').trim();
    } else {
      // Fallback para outros layouts
      descriptionText = $('section.description, .decorated-job-posting__details').text().trim();
    }

    // Informações adicionais
    const criteria = [];
    let employmentType = '';
    let seniorityLevel = '';
    let jobFunction = '';
    let industries = '';

    $('.description__job-criteria-item').each((_, el) => {
      const header = $(el).find('.description__job-criteria-subheader').text().trim();
      const value = $(el).find('.description__job-criteria-text').text().trim();
      if (header && value) {
        criteria.push(`${header}: ${value}`);
        const hLow = header.toLowerCase();
        if (hLow.includes('tipo de emprego') || hLow.includes('employment type')) {
          employmentType = value;
        } else if (hLow.includes('nível de experiência') || hLow.includes('seniority level')) {
          seniorityLevel = value;
        } else if (hLow.includes('função') || hLow.includes('job function')) {
          jobFunction = value;
        } else if (hLow.includes('setores') || hLow.includes('industries')) {
          industries = value;
        }
      }
    });

    const isCriteriaRemote = criteria.some(c => /remot[oa]|remote/i.test(c));
    const isCriteriaFullTime = criteria.some(c => /tempo\s+integral|full[-\s]?time/i.test(c)) ||
      /tempo\s+integral|full[-\s]?time/i.test(employmentType);

    // Checagem se a vaga está fechada ou expirada
    const isClosed = html.includes('Não está mais aceitando candidaturas') ||
                     html.includes('No longer accepting applications') ||
                     html.includes('Esta vaga foi encerrada') ||
                     $('.closed-job__flavor, .job-closed').length > 0;

    const detailsPostedTime = $('.posted-time-ago__text').first().text().trim().replace(/\s+/g, ' ') ||
                             $('time').first().text().trim().replace(/\s+/g, ' ') ||
                             $('.topcard__flavor--metadata').first().text().trim().replace(/\s+/g, ' ');

    return {
      description: descriptionText,
      criteria,
      employmentType: employmentType || (isCriteriaFullTime ? 'Tempo integral' : ''),
      seniorityLevel,
      jobFunction,
      industries,
      isRemote: isCriteriaRemote,
      workplaceType: isCriteriaRemote ? 'remote' : undefined,
      isClosed,
      postedTime: detailsPostedTime,
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    return null;
  }
}

/**
 * Avalia se o texto descritivo de tempo indica que a publicação é mais antiga que o filtro pretendido.
 */
export function isPostingTooOld(postedTimeString, timeFilter = 'past-24h') {
  if (!postedTimeString || typeof postedTimeString !== 'string') return false;
  const t = postedTimeString.toLowerCase().trim();

  const isoMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const postDate = new Date(t);
    if (!isNaN(postDate.getTime())) {
      const diffHours = (Date.now() - postDate.getTime()) / (1000 * 60 * 60);
      if (timeFilter === 'past-24h' && diffHours > 36) return true;
      if (timeFilter === 'past-week' && diffHours > 24 * 8) return true;
    }
  }

  if (timeFilter === 'past-24h') {
    // Se mencionar dias, semanas, meses, anos
    if (/(?:^|\P{L})(?:dias?|days?|semanas?|weeks?|m[êe]s(?:es)?|months?|anos?|years?)(?:\P{L}|$)/iu.test(t)) {
      return true;
    }
    // Formato abreviado tipo 2d, 1w, 1y
    if (/(?:^|\P{L})\d+\s*(?:d|w|y)(?:\P{L}|$)/iu.test(t)) {
      return true;
    }
  } else if (timeFilter === 'past-week') {
    if (/(?:^|\P{L})(?:m[êe]s(?:es)?|months?|anos?|years?)(?:\P{L}|$)/iu.test(t)) {
      return true;
    }
    const weeksMatch = t.match(/(?:h[áa]\s*|)(\d+)\s*(?:semanas?|weeks?\s*ago)/iu);
    if (weeksMatch && parseInt(weeksMatch[1], 10) > 1) {
      return true;
    }
    const daysMatch = t.match(/(?:h[áa]\s*|)(\d+)\s*(?:dias?|days?\s*ago)/iu);
    if (daysMatch && parseInt(daysMatch[1], 10) > 7) {
      return true;
    }
  }
  return false;
}
