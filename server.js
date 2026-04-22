'use strict';

// ═════════════════════════════════════════════════════════════════════════════
//  TOP LINK NEWS API  v4.0
//  Endpoints:
//    GET  /api/headlines              → national + international + local
//    GET  /api/headlines?state=fl     → state-specific news (all 51 regions)
//    GET  /api/topic?t=sports         → topic page feeds (7 topics)
//    POST /api/refresh                → bust national cache
//    POST /api/refresh?state=fl       → bust one state cache
//    POST /api/refresh?topic=sports   → bust one topic cache
//    GET  /api/status                 → cache age report for all regions + topics
//    GET  /health                     → Render health check
// ═════════════════════════════════════════════════════════════════════════════

// ─── DEPENDENCIES ─────────────────────────────────────────────────────────────
const express        = require('express');
const cors           = require('cors');
const compression    = require('compression');
const helmet         = require('helmet');
const { XMLParser }  = require('fast-xml-parser');

// ─── APP SETUP ────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());

// ─── XML PARSER ───────────────────────────────────────────────────────────────
const parser = new XMLParser({
  ignoreAttributes   : false,
  attributeNamePrefix: '@_',
  cdataPropName      : '__cdata',
  textNodeName       : '#text',
});

// ─── RUNTIME CONFIG ───────────────────────────────────────────────────────────
const TTL_MS        = parseInt(process.env.CACHE_TTL_MS  || '600000', 10);  // 10 min
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT  || '9000',  10);  // 9 s
const MAX_RETRIES   = 2;
const WARM_BATCH    = 5;
const WARM_DELAY_MS = 3000;
const PORT          = parseInt(process.env.PORT || '3000', 10);

// ═════════════════════════════════════════════════════════════════════════════
//  STATE DATA
// ═════════════════════════════════════════════════════════════════════════════
const STATE_NAMES = {
  al:'Alabama',        ak:'Alaska',           az:'Arizona',
  ar:'Arkansas',       ca:'California',       co:'Colorado',
  ct:'Connecticut',    de:'Delaware',         fl:'Florida',
  ga:'Georgia',        hi:'Hawaii',           id:'Idaho',
  il:'Illinois',       in:'Indiana',          ia:'Iowa',
  ks:'Kansas',         ky:'Kentucky',         la:'Louisiana',
  me:'Maine',          md:'Maryland',         ma:'Massachusetts',
  mi:'Michigan',       mn:'Minnesota',        ms:'Mississippi',
  mo:'Missouri',       mt:'Montana',          ne:'Nebraska',
  nv:'Nevada',         nh:'New Hampshire',    nj:'New Jersey',
  nm:'New Mexico',     ny:'New York',         nc:'North Carolina',
  nd:'North Dakota',   oh:'Ohio',             ok:'Oklahoma',
  or:'Oregon',         pa:'Pennsylvania',     ri:'Rhode Island',
  sc:'South Carolina', sd:'South Dakota',     tn:'Tennessee',
  tx:'Texas',          ut:'Utah',             vt:'Vermont',
  va:'Virginia',       wa:'Washington',       wv:'West Virginia',
  wi:'Wisconsin',      wy:'Wyoming',          dc:'Washington DC',
};

const STATE_CITIES = {
  al:'Birmingham Mobile Huntsville Montgomery Alabama',
  ak:'Anchorage Fairbanks Juneau Alaska',
  az:'Phoenix Tucson Scottsdale Mesa Flagstaff Arizona',
  ar:'Little Rock Fayetteville Fort Smith Jonesboro Arkansas',
  ca:'Los Angeles San Francisco San Diego Sacramento San Jose California',
  co:'Denver Colorado Springs Boulder Fort Collins Colorado',
  ct:'Hartford New Haven Stamford Bridgeport Connecticut',
  de:'Wilmington Dover Newark Delaware',
  fl:'Miami Tampa Orlando Jacksonville Fort Lauderdale Florida',
  ga:'Atlanta Savannah Augusta Macon Columbus Georgia',
  hi:'Honolulu Hilo Maui Kauai Hawaii',
  id:"Boise Idaho Falls Nampa Coeur d'Alene Idaho",
  il:'Chicago Springfield Rockford Peoria Aurora Illinois',
  in:'Indianapolis Fort Wayne South Bend Evansville Indiana',
  ia:'Des Moines Cedar Rapids Davenport Iowa City Iowa',
  ks:'Wichita Kansas City Topeka Overland Park Kansas',
  ky:'Louisville Lexington Bowling Green Covington Kentucky',
  la:'New Orleans Baton Rouge Shreveport Lafayette Louisiana',
  me:'Portland Bangor Augusta Lewiston Maine',
  md:'Baltimore Annapolis Rockville Frederick Maryland',
  ma:'Boston Worcester Springfield Cambridge Lowell Massachusetts',
  mi:'Detroit Grand Rapids Ann Arbor Lansing Flint Michigan',
  mn:'Minneapolis Saint Paul Duluth Rochester Minnesota',
  ms:'Jackson Gulfport Biloxi Hattiesburg Mississippi',
  mo:'Kansas City St Louis Springfield Columbia Missouri',
  mt:'Billings Missoula Great Falls Bozeman Montana',
  ne:'Omaha Lincoln Bellevue Grand Island Nebraska',
  nv:'Las Vegas Reno Henderson Carson City Nevada',
  nh:'Manchester Nashua Concord Portsmouth New Hampshire',
  nj:'Newark Jersey City Trenton Atlantic City New Jersey',
  nm:'Albuquerque Santa Fe Las Cruces Roswell New Mexico',
  ny:'New York City Buffalo Albany Rochester Syracuse New York',
  nc:'Charlotte Raleigh Durham Greensboro Asheville North Carolina',
  nd:'Fargo Bismarck Grand Forks Minot North Dakota',
  oh:'Columbus Cleveland Cincinnati Toledo Akron Dayton Ohio',
  ok:'Oklahoma City Tulsa Norman Lawton Oklahoma',
  or:'Portland Eugene Salem Bend Medford Oregon',
  pa:'Philadelphia Pittsburgh Allentown Harrisburg Erie Pennsylvania',
  ri:'Providence Warwick Cranston Pawtucket Newport Rhode Island',
  sc:'Charleston Columbia Greenville Myrtle Beach South Carolina',
  sd:'Sioux Falls Rapid City Aberdeen Pierre South Dakota',
  tn:'Nashville Memphis Knoxville Chattanooga Tennessee',
  tx:'Houston Dallas Austin San Antonio Fort Worth El Paso Texas',
  ut:'Salt Lake City Provo Ogden St George Utah',
  vt:'Burlington Montpelier Rutland Vermont',
  va:'Richmond Virginia Beach Norfolk Arlington Roanoke Virginia',
  wa:'Seattle Spokane Tacoma Bellevue Olympia Everett Washington',
  wv:'Charleston Huntington Morgantown Parkersburg West Virginia',
  wi:'Milwaukee Madison Green Bay Racine Kenosha Wisconsin',
  wy:'Cheyenne Casper Laramie Gillette Wyoming',
  dc:'Washington DC Capitol Hill Georgetown',
};

// ═════════════════════════════════════════════════════════════════════════════
//  TOPIC FEED REGISTRY
//  Each topic has three feed groups that map to the three columns on the page:
//    left  → left news column
//    right → right news column
//    band  → dark bottom headline band
// ═════════════════════════════════════════════════════════════════════════════
const TOPIC_FEEDS = {
  sports: {
    left : [
      'https://www.cbssports.com/rss/headlines/',
      'https://www.espn.com/espn/rss/news',
    ],
    right: [
      'https://feeds.bbci.co.uk/sport/rss.xml',
      'https://www.cbssports.com/college-football/rss/',
    ],
    band : [
      'https://sports.yahoo.com/rss/',
      'https://www.cbssports.com/nba/rss/',
    ],
  },

  economy: {
    left : [
      'https://feeds.reuters.com/reuters/businessNews',
      'https://feeds.npr.org/1017/rss.xml',
    ],
    right: [
      'https://www.cnbc.com/id/100003114/device/rss/rss.html',
      'https://feeds.marketwatch.com/marketwatch/topstories/',
    ],
    band : [
      'https://feeds.feedburner.com/businessinsider',
      'https://feeds.npr.org/1006/rss.xml',
    ],
  },

  technology: {
    left : [
      'https://techcrunch.com/feed/',
      'https://www.theverge.com/rss/index.xml',
    ],
    right: [
      'https://feeds.arstechnica.com/arstechnica/index',
      'https://www.wired.com/feed/rss',
    ],
    band : [
      'https://www.technologyreview.com/feed/',
      'https://www.zdnet.com/news/rss.xml',
    ],
  },

  betting: {
    left : [
      'https://www.cbssports.com/nfl/rss/',
      'https://sports.yahoo.com/rss/',
    ],
    right: [
      'https://www.cbssports.com/nba/rss/',
      'https://www.cbssports.com/mlb/rss/',
    ],
    band : [
      'https://www.espn.com/espn/rss/news',
      'https://www.cbssports.com/nhl/rss/',
    ],
  },

  diet: {
    left : [
      'https://www.healthline.com/rss/nutrition',
      'https://www.medicalnewstoday.com/rss/nutrition-diet',
    ],
    right: [
      'https://www.runnersworld.com/rss/all/',
      'https://www.menshealth.com/rss/fitness.xml',
    ],
    band : [
      'https://www.eatthis.com/feed/',
      'https://www.womenshealthmag.com/rss/fitness.xml',
    ],
  },

  wellness: {
    left : [
      'https://www.healthline.com/rss/mental-health',
      'https://www.medicalnewstoday.com/rss/stress',
    ],
    right: [
      'https://www.menshealth.com/rss/fitness.xml',
      'https://www.womenshealthmag.com/rss/fitness.xml',
    ],
    band : [
      'https://www.healthline.com/rss/nutrition',
      'https://feeds.npr.org/1037/rss.xml',
    ],
  },

  ai: {
    left : [
      'https://techcrunch.com/tag/artificial-intelligence/feed/',
      'https://venturebeat.com/ai/feed/',
    ],
    right: [
      'https://www.technologyreview.com/feed/',
      'https://feeds.arstechnica.com/arstechnica/index',
    ],
    band : [
      'https://www.wired.com/feed/tag/artificial-intelligence/rss',
      'https://www.theverge.com/rss/index.xml',
    ],
  },
};

// Validate topic names
const VALID_TOPICS = new Set(Object.keys(TOPIC_FEEDS));

// ═════════════════════════════════════════════════════════════════════════════
//  NATIONAL RSS SOURCES
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
//  RSS FETCH  (with retry + timeout)
// ═════════════════════════════════════════════════════════════════════════════
async function fetchFeed(url, attempt = 0) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);

    const res = await fetch(url, {
      signal : ctrl.signal,
      headers: {
        'User-Agent'   : 'TopLinkNews/4.0 (+https://toplinknews.com)',
        'Accept'       : 'application/rss+xml, application/xml, text/xml, */*',
        'Cache-Control': 'no-cache',
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml     = await res.text();
    const parsed  = parser.parse(xml);
    const channel = parsed?.rss?.channel || parsed?.feed || {};

    const siteName =
      (typeof channel.title === 'string'
        ? channel.title
        : channel.title?.['#text'] || channel.title?.__cdata || '') ||
      new URL(url).hostname.replace(/^www\./, '');

    const rawItems = channel.item || channel.entry || [];
    const items    = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items
      .map(item => {
        const title = (
          typeof item.title === 'string' ? item.title :
          item.title?.__cdata || item.title?.['#text'] || ''
        ).trim().replace(/\s+/g, ' ');

        let link = '';
        if      (typeof item.link === 'string') link = item.link;
        else if (item.link?.['@_href'])          link = item.link['@_href'];
        else if (typeof item.guid === 'string')  link = item.guid;
        else if (item.guid?.['#text'])           link = item.guid['#text'];
        link = link.trim();

        const raw =
          typeof item.description === 'string' ? item.description :
          item.description?.__cdata || item.description?.['#text'] ||
          item.summary?.__cdata     || item.summary || '';

        const summary = String(raw)
          .replace(/<[^>]+>/g, '')
          .replace(/&[a-z#0-9]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 280);

        return {
          title,
          link,
          source : siteName,
          summary,
          pubDate: item.pubDate || item.updated || '',
        };
      })
      .filter(i => i.title && i.link && i.link.startsWith('http'));

  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      return fetchFeed(url, attempt + 1);
    }
    console.warn(`[feed] failed after ${attempt + 1} attempts: ${url} — ${err.message}`);
    return [];
  }
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────
function dedupe(items) {
  const seen = new Set();
  return items.filter(i => {
    const key = i.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  PAYLOAD BUILDERS
// ═════════════════════════════════════════════════════════════════════════════

// ── National + International ──────────────────────────────────────────────────
async function buildNationalPayload() {
  const [
    brk,
    nat1, nat2, nat3, nat4,
    int1, int2, int3, int4,
    loc1, loc2, loc3, loc4,
  ] = await Promise.all([
    fetchFeed(SOURCES.breaking[0]),
    ...SOURCES.national.map(u => fetchFeed(u)),
    ...SOURCES.international.map(u => fetchFeed(u)),
    ...SOURCES.local.map(u => fetchFeed(u)),
  ]);

  const national      = dedupe([...nat1, ...nat2, ...nat3, ...nat4]).slice(0, 22);
  const international = dedupe([...int1, ...int2, ...int3, ...int4]).slice(0, 22);
  const local         = dedupe([...loc1, ...loc2, ...loc3, ...loc4]).slice(0, 14);
  const breaking      = brk[0] || national[0] || null;

  return { breaking, national, international, local, updated: new Date().toISOString() };
}

// ── State-specific (Google News RSS) ─────────────────────────────────────────
async function buildStatePayload(stateCode, stateName) {
  const cities = STATE_CITIES[stateCode] || stateName;
  const gn     = q =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

  const [brk, top1, top2, city1, city2] = await Promise.all([
    fetchFeed(gn(`"${stateName}" breaking news`)),
    fetchFeed(gn(`${stateName} news today`)),
    fetchFeed(gn(`${stateName} local government legislature`)),
    fetchFeed(gn(`${cities} news`)),
    fetchFeed(gn(`${stateName} crime economy education`)),
  ]);

  const top   = dedupe([...top1,  ...top2 ]).slice(0, 20);
  const local = dedupe([...city1, ...city2]).slice(0, 18);

  return {
    breaking: brk[0] || top[0] || null,
    top,
    local,
    updated: new Date().toISOString(),
  };
}

// ── Topic page (sports / economy / technology / betting / diet / wellness / ai)
async function buildTopicPayload(topic) {
  const feeds = TOPIC_FEEDS[topic];

  const [left1, left2, right1, right2, band1, band2] = await Promise.all([
    fetchFeed(feeds.left[0]),
    fetchFeed(feeds.left[1]  || feeds.left[0]),
    fetchFeed(feeds.right[0]),
    fetchFeed(feeds.right[1] || feeds.right[0]),
    fetchFeed(feeds.band[0]),
    fetchFeed(feeds.band[1]  || feeds.band[0]),
  ]);

  const left  = dedupe([...left1,  ...left2 ]).slice(0, 20);
  const right = dedupe([...right1, ...right2]).slice(0, 20);
  const band  = dedupe([...band1,  ...band2 ]).slice(0, 16);
  const breaking = left[0] || right[0] || null;

  return { breaking, left, right, band, updated: new Date().toISOString() };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CACHE + IN-FLIGHT DEDUPLICATION
//  One Promise per unique cache key — concurrent requests never fire duplicate
//  upstream fetches.
// ═════════════════════════════════════════════════════════════════════════════
const cache = {
  national: { data: null, age: 0 },
  states  : {},   // { 'fl': { data, age } }
  topics  : {},   // { 'sports': { data, age } }
};

const inFlight = {
  national: null,
  states  : {},
  topics  : {},
};

function isFresh(entry) {
  return entry?.data && (Date.now() - entry.age) < TTL_MS;
}

// ── Getters ───────────────────────────────────────────────────────────────────
async function getNational() {
  if (isFresh(cache.national)) return cache.national.data;
  if (!inFlight.national) {
    inFlight.national = buildNationalPayload()
      .then(p => { cache.national = { data: p, age: Date.now() }; return p; })
      .catch(e => { console.error('[national]', e.message); return cache.national.data || null; })
      .finally(() => { inFlight.national = null; });
  }
  return inFlight.national;
}

async function getState(sc) {
  if (isFresh(cache.states[sc])) return cache.states[sc].data;
  if (!inFlight.states[sc]) {
    inFlight.states[sc] = buildStatePayload(sc, STATE_NAMES[sc])
      .then(p => { cache.states[sc] = { data: p, age: Date.now() }; return p; })
      .catch(e => { console.error(`[${sc}]`, e.message); return cache.states[sc]?.data || null; })
      .finally(() => { inFlight.states[sc] = null; });
  }
  return inFlight.states[sc];
}

async function getTopic(topic) {
  if (isFresh(cache.topics[topic])) return cache.topics[topic].data;
  if (!inFlight.topics[topic]) {
    inFlight.topics[topic] = buildTopicPayload(topic)
      .then(p => { cache.topics[topic] = { data: p, age: Date.now() }; return p; })
      .catch(e => { console.error(`[topic:${topic}]`, e.message); return cache.topics[topic]?.data || null; })
      .finally(() => { inFlight.topics[topic] = null; });
  }
  return inFlight.topics[topic];
}

// ═════════════════════════════════════════════════════════════════════════════
//  BACKGROUND REFRESH  (proactive — users rarely hit a cold cache)
// ═════════════════════════════════════════════════════════════════════════════
function scheduleRefresh() {
  const half   = TTL_MS / 2;
  const states = Object.keys(STATE_NAMES);
  const topics = Object.keys(TOPIC_FEEDS);

  // National — every half-TTL
  setInterval(() => {
    cache.national.age = 0;
    getNational().catch(() => null);
  }, half);

  // Topics — stagger across half-TTL window
  const topicGap = Math.floor(half / topics.length);
  topics.forEach((t, i) => {
    setTimeout(() => {
      setInterval(() => {
        if (cache.topics[t]?.data) {
          cache.topics[t].age = 0;
          getTopic(t).catch(() => null);
        }
      }, half);
    }, topicGap * i);
  });

  // States — stagger all 51 across half-TTL window
  const stateGap = Math.floor(half / states.length);
  states.forEach((sc, i) => {
    setTimeout(() => {
      setInterval(() => {
        if (cache.states[sc]?.data) {
          cache.states[sc].age = 0;
          getState(sc).catch(() => null);
        }
      }, half);
    }, stateGap * i);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  STARTUP WARMUP
// ═════════════════════════════════════════════════════════════════════════════
async function warmup() {
  // 1 — National feeds
  console.log('[warmup] national feeds…');
  await getNational().catch(e => console.error('[warmup] national:', e.message));
  console.log('[warmup] national ready.');

  // 2 — All 7 topic pages in parallel
  console.log('[warmup] topic feeds…');
  await Promise.all(Object.keys(TOPIC_FEEDS).map(t => getTopic(t).catch(() => null)));
  console.log('[warmup] topics ready:', Object.keys(TOPIC_FEEDS).join(', '));

  // 3 — Priority states in batches
  const priority = ['fl', 'tx', 'ca', 'ny', 'pa', 'oh', 'il', 'ga', 'nc', 'mi'];
  for (let i = 0; i < priority.length; i += WARM_BATCH) {
    const batch = priority.slice(i, i + WARM_BATCH);
    await Promise.all(batch.map(sc => getState(sc).catch(() => null)));
    console.log(`[warmup] states: ${batch.join(', ')}`);
    if (i + WARM_BATCH < priority.length) {
      await new Promise(r => setTimeout(r, WARM_DELAY_MS));
    }
  }
  console.log('[warmup] complete.');
}

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── GET /api/headlines  ·  GET /api/headlines?state=fl ────────────────────────
app.get('/api/headlines', async (req, res) => {
  const sc = req.query.state ? req.query.state.toLowerCase().trim() : null;

  if (sc) {
    if (!STATE_NAMES[sc])
      return res.status(400).json({ error: `Unknown state: "${sc}". Use 2-letter codes.` });
    try {
      const data = await getState(sc);
      if (!data) return res.status(503).json({ error: 'No data yet — please retry.' });
      return res.json(data);
    } catch (e) {
      console.error(`[route/state] ${sc}:`, e.message);
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  try {
    const data = await getNational();
    if (!data) return res.status(503).json({ error: 'No data yet — please retry.' });
    return res.json(data);
  } catch (e) {
    console.error('[route/national]:', e.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/topic?t=sports ───────────────────────────────────────────────────
app.get('/api/topic', async (req, res) => {
  const t = req.query.t ? req.query.t.toLowerCase().trim() : null;

  if (!t || !VALID_TOPICS.has(t)) {
    return res.status(400).json({
      error  : `Unknown topic: "${t}".`,
      valid  : [...VALID_TOPICS],
    });
  }

  try {
    const data = await getTopic(t);
    if (!data) return res.status(503).json({ error: 'No data yet — please retry.' });
    return res.json(data);
  } catch (e) {
    console.error(`[route/topic] ${t}:`, e.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/refresh ─────────────────────────────────────────────────────────
app.post('/api/refresh', (req, res) => {
  const sc    = (req.query.state || req.body?.state    || '').toLowerCase().trim();
  const topic = (req.query.topic || req.body?.topic    || '').toLowerCase().trim();

  if (topic) {
    if (!VALID_TOPICS.has(topic))
      return res.status(400).json({ error: `Unknown topic: ${topic}` });
    if (cache.topics[topic]) cache.topics[topic].age = 0;
    inFlight.topics[topic] = null;
    console.log(`[refresh] topic: ${topic}`);
    return res.json({ cleared: 'topic', topic });
  }

  if (sc) {
    if (!STATE_NAMES[sc])
      return res.status(400).json({ error: `Unknown state: ${sc}` });
    if (cache.states[sc]) cache.states[sc].age = 0;
    inFlight.states[sc] = null;
    console.log(`[refresh] state: ${sc}`);
    return res.json({ cleared: 'state', state: sc, name: STATE_NAMES[sc] });
  }

  cache.national.age = 0;
  inFlight.national  = null;
  console.log('[refresh] national');
  res.json({ cleared: 'national' });
});

// ── GET /api/status ───────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  const now  = Date.now();
  const age  = entry =>
    entry?.data ? `${Math.round((now - entry.age) / 1000)}s ago` : 'not loaded';

  const topics = {};
  for (const t of VALID_TOPICS) topics[t] = age(cache.topics[t]);

  const states = {};
  for (const sc of Object.keys(STATE_NAMES)) states[sc] = age(cache.states[sc]);

  res.json({
    version  : '4.0',
    uptime_s : Math.round(process.uptime()),
    ttl_s    : TTL_MS / 1000,
    national : age(cache.national),
    topics,
    states,
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status   : 'ok',
    version  : '4.0',
    uptime_s : Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ═════════════════════════════════════════════════════════════════════════════
process.on('SIGTERM', () => { console.log('[shutdown] SIGTERM'); process.exit(0); });
process.on('SIGINT',  () => { console.log('[shutdown] SIGINT');  process.exit(0); });

// ═════════════════════════════════════════════════════════════════════════════
//  START
// ═════════════════════════════════════════════════════════════════════════════
const server = app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════╗
║   Top Link News API  v4.0            ║
╠══════════════════════════════════════╣
║  Port      : ${String(PORT).padEnd(23)}║
║  Cache TTL : ${String(TTL_MS / 1000 + 's').padEnd(23)}║
║  Node      : ${process.version.padEnd(23)}║
║  Topics    : ${Object.keys(TOPIC_FEEDS).join(', ').slice(0,23).padEnd(23)}║
╚══════════════════════════════════════╝
`);
  await warmup();
  scheduleRefresh();
});

// Fixes random 502s on Render — keepAlive must exceed LB's 60 s timeout
server.keepAliveTimeout = 65000;
server.headersTimeout   = 66000;
