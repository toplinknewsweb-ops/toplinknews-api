'use strict';

const express        = require('express');
const cors           = require('cors');
const { XMLParser }  = require('fast-xml-parser');

const app    = express();
const parser = new XMLParser({
  ignoreAttributes   : false,
  attributeNamePrefix: '@_',
  cdataPropName      : '__cdata',
  textNodeName       : '#text',
});

app.use(cors());
app.use(express.json());

// ─── ALL 50 STATES + DC ───────────────────────────────────────────────────────
const STATE_NAMES = {
  al:'Alabama',   ak:'Alaska',        az:'Arizona',      ar:'Arkansas',
  ca:'California',co:'Colorado',      ct:'Connecticut',  de:'Delaware',
  fl:'Florida',   ga:'Georgia',       hi:'Hawaii',       id:'Idaho',
  il:'Illinois',  in:'Indiana',       ia:'Iowa',         ks:'Kansas',
  ky:'Kentucky',  la:'Louisiana',     me:'Maine',        md:'Maryland',
  ma:'Massachusetts',mi:'Michigan',   mn:'Minnesota',    ms:'Mississippi',
  mo:'Missouri',  mt:'Montana',       ne:'Nebraska',     nv:'Nevada',
  nh:'New Hampshire',nj:'New Jersey', nm:'New Mexico',   ny:'New York',
  nc:'North Carolina',nd:'North Dakota',oh:'Ohio',       ok:'Oklahoma',
  or:'Oregon',    pa:'Pennsylvania',  ri:'Rhode Island', sc:'South Carolina',
  sd:'South Dakota',tn:'Tennessee',   tx:'Texas',        ut:'Utah',
  vt:'Vermont',   va:'Virginia',      wa:'Washington',   wv:'West Virginia',
  wi:'Wisconsin', wy:'Wyoming',       dc:'Washington DC',
};

// Major metro areas per state — enriches Google News queries
const STATE_CITIES = {
  al:'Birmingham Mobile Huntsville Alabama',
  ak:'Anchorage Fairbanks Alaska',
  az:'Phoenix Tucson Scottsdale Arizona',
  ar:'Little Rock Fayetteville Fort Smith Arkansas',
  ca:'Los Angeles San Francisco San Diego Sacramento California',
  co:'Denver Colorado Springs Boulder Colorado',
  ct:'Hartford New Haven Stamford Connecticut',
  de:'Wilmington Dover Delaware',
  fl:'Miami Tampa Orlando Jacksonville Fort Lauderdale Florida',
  ga:'Atlanta Savannah Augusta Georgia',
  hi:'Honolulu Maui Hawaii',
  id:'Boise Idaho Falls Idaho',
  il:'Chicago Springfield Rockford Illinois',
  in:'Indianapolis Fort Wayne South Bend Indiana',
  ia:'Des Moines Cedar Rapids Iowa',
  ks:'Wichita Kansas City Topeka Kansas',
  ky:'Louisville Lexington Bowling Green Kentucky',
  la:'New Orleans Baton Rouge Shreveport Louisiana',
  me:'Portland Bangor Augusta Maine',
  md:'Baltimore Annapolis Rockville Maryland',
  ma:'Boston Worcester Springfield Massachusetts',
  mi:'Detroit Grand Rapids Ann Arbor Michigan',
  mn:'Minneapolis Saint Paul Duluth Minnesota',
  ms:'Jackson Gulfport Biloxi Mississippi',
  mo:'Kansas City St Louis Springfield Missouri',
  mt:'Billings Missoula Great Falls Montana',
  ne:'Omaha Lincoln Bellevue Nebraska',
  nv:'Las Vegas Reno Henderson Nevada',
  nh:'Manchester Nashua Concord New Hampshire',
  nj:'Newark Jersey City Trenton New Jersey',
  nm:'Albuquerque Santa Fe Las Cruces New Mexico',
  ny:'New York City Buffalo Albany Rochester New York',
  nc:'Charlotte Raleigh Durham Greensboro North Carolina',
  nd:'Fargo Bismarck Grand Forks North Dakota',
  oh:'Columbus Cleveland Cincinnati Toledo Ohio',
  ok:'Oklahoma City Tulsa Norman Oklahoma',
  or:'Portland Eugene Salem Oregon',
  pa:'Philadelphia Pittsburgh Allentown Harrisburg Pennsylvania',
  ri:'Providence Warwick Cranston Rhode Island',
  sc:'Charleston Columbia Greenville South Carolina',
  sd:'Sioux Falls Rapid City Aberdeen South Dakota',
  tn:'Nashville Memphis Knoxville Chattanooga Tennessee',
  tx:'Houston Dallas Austin San Antonio Fort Worth Texas',
  ut:'Salt Lake City Provo Ogden Utah',
  vt:'Burlington Montpelier Vermont',
  va:'Richmond Virginia Beach Norfolk Arlington Virginia',
  wa:'Seattle Spokane Tacoma Bellevue Washington',
  wv:'Charleston Huntington Morgantown West Virginia',
  wi:'Milwaukee Madison Green Bay Wisconsin',
  wy:'Cheyenne Casper Laramie Wyoming',
  dc:'Washington DC Capitol Hill',
};

// ─── NATIONAL RSS SOURCES ─────────────────────────────────────────────────────
const SOURCES = {
  breaking:      ['https://feeds.apnews.com/rss/apf-topnews'],
  national:      [
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

// ─── FETCH + PARSE ONE RSS FEED ───────────────────────────────────────────────
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

    const siteName =
      (typeof channel.title === 'string' ? channel.title :
       channel.title?.['#text'] || channel.title?.__cdata) ||
      new URL(url).hostname;

    const items = channel.item || channel.entry || [];
    const arr   = Array.isArray(items) ? items : [items];

    return arr
      .map(item => {
        const title =
          (typeof item.title === 'string' ? item.title :
           item.title?.__cdata || item.title?.['#text'] || '').trim();

        let link = '';
        if (typeof item.link === 'string')     link = item.link;
        else if (item.link?.['@_href'])         link = item.link['@_href'];
        else if (typeof item.guid === 'string') link = item.guid;
        else if (item.guid?.['#text'])          link = item.guid['#text'];

        const description =
          (typeof item.description === 'string' ? item.description :
           item.description?.__cdata || item.description?.['#text'] || '').trim()
          .replace(/<[^>]+>/g, '').slice(0, 260);

        return {
          title,
          link     : link.trim(),
          source   : siteName,
          summary  : description,
          pubDate  : item.pubDate || item.updated || '',
        };
      })
      .filter(i => i.title && i.link && i.link.startsWith('http'));

  } catch {
    return [];
  }
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(i => {
    const key = i.title.slice(0, 80).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── NATIONAL + INTERNATIONAL PAYLOAD ────────────────────────────────────────
async function buildPayload() {
  const [brk,nat1,nat2,nat3,nat4,int1,int2,int3,int4,loc1,loc2,loc3,loc4] =
    await Promise.all([
      fetchFeed(SOURCES.breaking[0]),
      ...SOURCES.national.map(fetchFeed),
      ...SOURCES.international.map(fetchFeed),
      ...SOURCES.local.map(fetchFeed),
    ]);

  const national      = dedupe([...nat1,...nat2,...nat3,...nat4]).slice(0,22);
  const international = dedupe([...int1,...int2,...int3,...int4]).slice(0,22);
  const local         = dedupe([...loc1,...loc2,...loc3,...loc4]).slice(0,14);

  return {
    breaking: brk[0] || national[0] || null,
    national, international, local,
    updated: new Date().toISOString(),
  };
}

// ─── STATE-SPECIFIC PAYLOAD (Google News RSS) ─────────────────────────────────
async function buildStatePayload(stateCode, stateName) {
  const cities = STATE_CITIES[stateCode] || stateName;
  const enc    = q => encodeURIComponent(q);
  const gn     = q => `https://news.google.com/rss/search?q=${enc(q)}&hl=en-US&gl=US&ceid=US:en`;

  const feeds = [
    gn(`${stateName} breaking news`),
    gn(`${stateName} news today`),
    gn(`${stateName} local government politics`),
    gn(`${cities} news`),
    gn(`${stateName} crime economy weather`),
  ];

  const [brk, top1, top2, city1, city2] = await Promise.all(feeds.map(fetchFeed));

  const top   = dedupe([...top1,  ...top2 ]).slice(0, 20);
  const local = dedupe([...city1, ...city2]).slice(0, 18);

  return {
    breaking : brk[0] || top[0] || null,
    top,
    local,
    updated  : new Date().toISOString(),
  };
}

// ─── CACHE ────────────────────────────────────────────────────────────────────
const TTL        = 10 * 60 * 1000;
let   mainCache  = null;
let   mainAge    = 0;
const stateCache = {};

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.get('/api/headlines', async (req, res) => {
  const stateCode = req.query.state ? req.query.state.toLowerCase() : null;

  // ── State path ──
  if (stateCode) {
    const stateName = STATE_NAMES[stateCode];
    if (!stateName) return res.status(400).json({ error: 'Unknown state: ' + stateCode });

    const hit = stateCache[stateCode];
    if (hit && Date.now() - hit.age < TTL) return res.json(hit.data);

    try {
      console.log(`[TopLinkNews] Fetching state: ${stateCode} (${stateName})`);
      const payload = await buildStatePayload(stateCode, stateName);
      stateCache[stateCode] = { data: payload, age: Date.now() };
      console.log(`[${stateCode}] top=${payload.top.length}  local=${payload.local.length}`);
      return res.json(payload);
    } catch (err) {
      console.error(`[${stateCode}] Error:`, err);
      if (hit) return res.json(hit.data);
      return res.status(500).json({ error: 'Failed to fetch state headlines.' });
    }
  }

  // ── National / International path ──
  try {
    if (mainCache && Date.now() - mainAge < TTL) return res.json(mainCache);
    console.log('[TopLinkNews] Refreshing national feeds…');
    const payload = await buildPayload();
    mainCache = payload;
    mainAge   = Date.now();
    res.json(payload);
  } catch (err) {
    console.error('[TopLinkNews] Error:', err);
    if (mainCache) return res.json(mainCache);
    res.status(500).json({ error: 'Failed to fetch headlines.' });
  }
});

app.post('/api/refresh', (req, res) => {
  const sc = req.body?.state?.toLowerCase();
  if (sc && stateCache[sc]) {
    delete stateCache[sc];
    return res.json({ cleared: sc });
  }
  mainCache = null; mainAge = 0;
  res.json({ cleared: 'main' });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Top Link News API on :${PORT}`));
