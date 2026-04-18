'use strict';

const express        = require('express');
const cors           = require('cors');
const { XMLParser }  = require('fast-xml-parser');

const app    = express();
const parser = new XMLParser({
  ignoreAttributes : false,
  attributeNamePrefix: '@_',
  cdataPropName    : '__cdata',
  textNodeName     : '#text',
});

app.use(cors());
app.use(express.json());

// ─── RSS SOURCES ────────────────────────────────────────────────────────────
const SOURCES = {
  breaking: [
    'https://feeds.apnews.com/rss/apf-topnews',
  ],
  national: [
    'https://feeds.apnews.com/rss/apf-usnews',
    'https://feeds.npr.org/1001/rss.xml',
    'https://feeds.abcnews.com/abcnews/usheadlines',
    'https://www.cbsnews.com/latest/rss/politics',
  ],
  international: [
    'https://feeds.apnews.com/rss/apf-intlnews',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.abcnews.com/abcnews/internationalheadlines',
    'https://feeds.npr.org/1004/rss.xml',
  ],
  local: [
    'https://feeds.apnews.com/rss/apf-oddities',
    'https://www.cbsnews.com/latest/rss/us',
    'https://feeds.abcnews.com/abcnews/domesticandworldnews',
    'https://feeds.npr.org/1014/rss.xml',
  ],
};

// ─── FETCH ONE RSS FEED ──────────────────────────────────────────────────────
async function fetchFeed(url) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);

    const res = await fetch(url, {
      signal  : ctrl.signal,
      headers : { 'User-Agent': 'TopLinkNews/2.0 (+https://toplinknews.com)' },
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const xml     = await res.text();
    const parsed  = parser.parse(xml);
    const channel = parsed?.rss?.channel || parsed?.feed || {};

    // Site name for attribution
    const siteName =
      (typeof channel.title === 'string' ? channel.title : channel.title?.['#text'] || channel.title?.__cdata) ||
      new URL(url).hostname;

    const items = channel.item || channel.entry || [];
    const arr   = Array.isArray(items) ? items : [items];

    return arr
      .map(item => {
        // Title – handle plain string, CDATA, or nested object
        const title =
          (typeof item.title === 'string' ? item.title :
           item.title?.__cdata || item.title?.['#text'] || '').trim();

        // Link – handle string, @href attribute (Atom), or guid
        let link = '';
        if (typeof item.link === 'string')          link = item.link;
        else if (item.link?.['@_href'])              link = item.link['@_href'];
        else if (typeof item.guid === 'string')      link = item.guid;
        else if (item.guid?.['#text'])               link = item.guid['#text'];

        // Description / summary (for breaking splash sub-text)
        const description =
          (typeof item.description === 'string' ? item.description :
           item.description?.__cdata || item.description?.['#text'] || '').trim()
          .replace(/<[^>]+>/g, '')   // strip HTML tags
          .slice(0, 260);

        return {
          title,
          link      : link.trim(),
          source    : siteName,
          summary   : description,
          pubDate   : item.pubDate || item.updated || '',
        };
      })
      .filter(i => i.title && i.link && i.link.startsWith('http'));

  } catch {
    return [];
  }
}

// ─── DEDUPLICATE BY TITLE ─────────────────────────────────────────────────
function dedupe(items) {
  const seen = new Set();
  return items.filter(i => {
    const key = i.title.slice(0, 80).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── BUILD FULL PAYLOAD ──────────────────────────────────────────────────────
async function buildPayload() {
  const [
    brk,
    nat1, nat2, nat3, nat4,
    int1, int2, int3, int4,
    loc1, loc2, loc3, loc4,
  ] = await Promise.all([
    fetchFeed(SOURCES.breaking[0]),
    fetchFeed(SOURCES.national[0]),
    fetchFeed(SOURCES.national[1]),
    fetchFeed(SOURCES.national[2]),
    fetchFeed(SOURCES.national[3]),
    fetchFeed(SOURCES.international[0]),
    fetchFeed(SOURCES.international[1]),
    fetchFeed(SOURCES.international[2]),
    fetchFeed(SOURCES.international[3]),
    fetchFeed(SOURCES.local[0]),
    fetchFeed(SOURCES.local[1]),
    fetchFeed(SOURCES.local[2]),
    fetchFeed(SOURCES.local[3]),
  ]);

  const national      = dedupe([...nat1, ...nat2, ...nat3, ...nat4]).slice(0, 22);
  const international = dedupe([...int1, ...int2, ...int3, ...int4]).slice(0, 22);
  const local         = dedupe([...loc1, ...loc2, ...loc3, ...loc4]).slice(0, 14);

  // Breaking headline = freshest AP top story, falls back to first national
  const breaking = brk[0] || national[0] || null;

  return {
    breaking,
    national,
    international,
    local,
    updated: new Date().toISOString(),
  };
}

// ─── CACHE (10-minute TTL) ───────────────────────────────────────────────────
let cache    = null;
let cacheAge = 0;
const TTL    = 10 * 60 * 1000;   // 10 minutes

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/headlines', async (_req, res) => {
  try {
    if (cache && Date.now() - cacheAge < TTL) {
      return res.json(cache);
    }

    console.log('[TopLinkNews] Refreshing feeds…');
    const payload = await buildPayload();
    cache    = payload;
    cacheAge = Date.now();
    console.log(`[TopLinkNews] Loaded – national:${payload.national.length}  intl:${payload.international.length}  local:${payload.local.length}`);
    res.json(payload);

  } catch (err) {
    console.error('[TopLinkNews] Error:', err);
    // Return stale cache if available, otherwise 500
    if (cache) return res.json(cache);
    res.status(500).json({ error: 'Failed to fetch headlines. Please try again shortly.' });
  }
});

// Force-bust cache on demand (useful for testing)
app.post('/api/refresh', async (_req, res) => {
  cache    = null;
  cacheAge = 0;
  res.json({ status: 'cache cleared' });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Top Link News API listening on :${PORT}`));
