'use strict';

// ─── DEPENDENCIES ─────────────────────────────────────────────────────────────
const express        = require('express');
const cors           = require('cors');
const compression    = require('compression');
const helmet         = require('helmet');
const { XMLParser }  = require('fast-xml-parser');

// ─── APP SETUP ────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet({
  contentSecurityPolicy : false,   // HTML pages handle their own CSP
  crossOriginOpenerPolicy: false,
}));
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

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TTL_MS         = parseInt(process.env.CACHE_TTL_MS  || '600000', 10);   // 10 min
const FETCH_TIMEOUT  = parseInt(process.env.FETCH_TIMEOUT  || '9000',  10);   // 9 s
const MAX_RETRIES    = 2;
const WARM_BATCH     = 5;    // states warmed per batch during startup
const WARM_DELAY_MS  = 3000; // ms between warmup batches
const PORT           = parseInt(process.env.PORT || '3000', 10);

// ─── ALL 51 REGIONS ───────────────────────────────────────────────────────────
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

// Major metro areas — makes Google News searches more targeted
const STATE_CITIES = {
  al: 'Birmingham Mobile Huntsville Montgomery Alabama',
  ak: 'Anchorage Fairbanks Juneau Alaska',
  az: 'Phoenix Tucson Scottsdale Mesa Flagstaff Arizona',
  ar: 'Little Rock Fayetteville Fort Smith Jonesboro Arkansas',
  ca: 'Los Angeles San Francisco San Diego Sacramento San Jose California',
  co: 'Denver Colorado Springs Boulder Fort Collins Colorado',
  ct: 'Hartford New Haven Stamford Bridgeport Connecticut',
  de: 'Wilmington Dover Newark Delaware',
  fl: 'Miami Tampa Orlando Jacksonville Fort Lauderdale Florida',
  ga: 'Atlanta Savannah Augusta Macon Columbus Georgia',
  hi: 'Honolulu Hilo Maui Kauai Hawaii',
  id: "Boise Idaho Falls Nampa Coeur d'Alene Idaho",
  il: 'Chicago Springfield Rockford Peoria Aurora Illinois',
  in: 'Indianapolis Fort Wayne South Bend Evansville Indiana',
  ia: 'Des Moines Cedar Rapids Davenport Iowa City Iowa',
  ks: 'Wichita Kansas City Topeka Overland Park Kansas',
  ky: 'Louisville Lexington Bowling Green Covington Kentucky',
  la: 'New Orleans Baton Rouge Shreveport Lafayette Louisiana',
  me: 'Portland Bangor Augusta Lewiston Maine',
  md: 'Baltimore Annapolis Rockville Frederick Maryland',
  ma: 'Boston Worcester Springfield Cambridge Lowell Massachusetts',
  mi: 'Detroit Grand Rapids Ann Arbor Lansing Flint Michigan',
  mn: 'Minneapolis Saint Paul Duluth Rochester Minnesota',
  ms: 'Jackson Gulfport Biloxi Hattiesburg Mississippi',
  mo: 'Kansas City St Louis Springfield Columbia Missouri',
  mt: 'Billings Missoula Great Falls Bozeman Montana',
  ne: 'Omaha Lincoln Bellevue Grand Island Nebraska',
  nv: 'Las Vegas Reno Henderson Carson City Nevada',
  nh: 'Manchester Nashua Concord Portsmouth New Hampshire',
  nj: 'Newark Jersey City Trenton Atlantic City New Jersey',
  nm: 'Albuquerque Santa Fe Las Cruces Roswell New Mexico',
  ny: 'New York City Buffalo Albany Rochester Syracuse New York',
  nc: 'Charlotte Raleigh Durham Greensboro Asheville North Carolina',
  nd: 'Fargo Bismarck Grand Forks Minot North Dakota',
  oh: 'Columbus Cleveland Cincinnati Toledo Akron Dayton Ohio',
  ok: 'Oklahoma City Tulsa Norman Lawton Oklahoma',
  or: 'Portland Eugene Salem Bend Medford Oregon',
  pa: 'Philadelphia Pittsburgh Allentown Harrisburg Erie Pennsylvania',
  ri: 'Providence Warwick Cranston Pawtucket Newport Rhode Island',
  sc: 'Charleston Columbia Greenville Myrtle Beach South Carolina',
  sd: 'Sioux Falls Rapid City Aberdeen Pierre South Dakota',
  tn: 'Nashville Memphis Knoxville Chattanooga Tennessee',
  tx: 'Houston Dallas Austin San Antonio Fort Worth El Paso Texas',
  ut: 'Salt Lake City Provo Ogden St George Utah',
  vt: 'Burlington Montpelier Rutland Vermont',
  va: 'Richmond Virginia Beach Norfolk Arlington Roanoke Virginia',
  wa: 'Seattle Spokane Tacoma Bellevue Olympia Everett Washington',
  wv: 'Charleston Huntington Morgantown Parkersburg West Virginia',
  wi: 'Milwaukee Madison Green Bay Racine Kenosha Wisconsin',
  wy: 'Cheyenne Casper Laramie Gillette Wyoming',
  dc: 'Washington DC Capitol Hill Georgetown',
};

// ─── NATIONAL RSS SOURCES ─────────────────────────────────────────────────────
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

// ─── RSS FETCH WITH RETRY ─────────────────────────────────────────────────────
async function fetchFeed(url, attempt = 0) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);

    const res = await fetch(url, {
      signal  : ctrl.signal,
      headers : {
        'User-Agent'    : 'TopLinkNews/3.0 (+https://toplinknews.com)',
        'Accept'        : 'application/rss+xml, application/xml, text/xml, */*',
        'Cache-Control' : 'no-cache',
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

        // Google News wraps links in redirect URLs — pass them through as-is;
        // the browser will follow the redirect to the real article.
        link = link.trim();

        const raw =
          typeof item.description === 'string' ? item.description :
          item.description?.__cdata || item.description?.['#text'] ||
          item.summary?.__cdata || item.summary || '';

        const summary = String(raw)
          .replace(/<[^>]+>/g, '')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 280);

        return {
          title,
          link,
          source  : siteName,
          summary,
          pubDate : item.pubDate || item.updated || '',
        };
      })
      .filter(i => i.title && i.link && i.link.startsWith('http'));

  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const delay = 800 * (attempt + 1);
      await new Promise(r => setTimeout(r, delay));
      return fetchFeed(url, attempt + 1);
    }
    console.warn(`[feed] Failed after ${attempt + 1} attempts: ${url} — ${err.message}`);
    return [];
  }
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────
function dedupe(items) {
  const seen = new Set();
  return items.filter(i => {
    // Normalise: lowercase, strip punctuation, collapse spaces → 60-char key
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

// ─── NATIONAL + INTERNATIONAL PAYLOAD ────────────────────────────────────────
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

// ─── STATE PAYLOAD ────────────────────────────────────────────────────────────
async function buildStatePayload(stateCode, stateName) {
  const cities = STATE_CITIES[stateCode] || stateName;
  const gn     = q =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

  // Five targeted Google News queries per state
  const urls = [
    gn(`"${stateName}" breaking news`),
    gn(`${stateName} news today`),
    gn(`${stateName} local government legislature`),
    gn(`${cities} news`),
    gn(`${stateName} crime economy education`),
  ];

  const [brk, top1, top2, city1, city2] = await Promise.all(urls.map(u => fetchFeed(u)));

  const top   = dedupe([...top1,  ...top2 ]).slice(0, 20);
  const local = dedupe([...city1, ...city2]).slice(0, 18);

  return {
    breaking : brk[0] || top[0] || null,
    top,
    local,
    updated  : new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CACHE + IN-FLIGHT DEDUPLICATION
//  Prevents thundering-herd: if two requests arrive simultaneously for the
//  same uncached state, only ONE upstream call is made; both requests wait
//  on the same Promise.
// ═════════════════════════════════════════════════════════════════════════════
const cache    = {
  national : { data: null, age: 0 },   // national/intl
  states   : {},                        // { 'fl': { data, age }, ... }
};

const inFlight = {
  national : null,   // Promise | null
  states   : {},     // { 'fl': Promise | null, ... }
};

function isFresh(entry) {
  return entry && entry.data && (Date.now() - entry.age) < TTL_MS;
}

async function getNational() {
  if (isFresh(cache.national)) return cache.national.data;

  // Deduplicate concurrent requests
  if (!inFlight.national) {
    inFlight.national = buildNationalPayload()
      .then(payload => {
        cache.national = { data: payload, age: Date.now() };
        console.log(`[national] cached — nat:${payload.national.length}  intl:${payload.international.length}`);
        return payload;
      })
      .catch(err => {
        console.error('[national] build error:', err.message);
        return cache.national.data || null;   // serve stale if available
      })
      .finally(() => { inFlight.national = null; });
  }

  return inFlight.national;
}

async function getState(stateCode) {
  const sc = stateCode.toLowerCase();

  if (isFresh(cache.states[sc])) return cache.states[sc].data;

  if (!inFlight.states[sc]) {
    const stateName = STATE_NAMES[sc];
    inFlight.states[sc] = buildStatePayload(sc, stateName)
      .then(payload => {
        cache.states[sc] = { data: payload, age: Date.now() };
        console.log(`[${sc}] cached — top:${payload.top.length}  local:${payload.local.length}`);
        return payload;
      })
      .catch(err => {
        console.error(`[${sc}] build error:`, err.message);
        return cache.states[sc]?.data || null;
      })
      .finally(() => { inFlight.states[sc] = null; });
  }

  return inFlight.states[sc];
}

// ─── BACKGROUND REFRESH ───────────────────────────────────────────────────────
// Proactively refreshes caches before they expire, so users never wait.
// States are staggered in batches to avoid hammering Google News.
function scheduleRefresh() {
  const halfTTL = TTL_MS / 2;

  // National — refresh at half-TTL
  setInterval(async () => {
    console.log('[background] refreshing national…');
    inFlight.national = null;   // force fresh fetch
    cache.national.age = 0;
    await getNational();
  }, halfTTL);

  // States — stagger all 51 across the half-TTL window
  const stateCodes  = Object.keys(STATE_NAMES);
  const gapMs       = Math.floor(halfTTL / stateCodes.length);

  stateCodes.forEach((sc, i) => {
    setTimeout(() => {
      // First run after startup delay, then repeat every half-TTL
      setInterval(async () => {
        if (cache.states[sc]?.data) {   // only refresh if ever requested
          console.log(`[background] refreshing ${sc}…`);
          cache.states[sc].age = 0;
          await getState(sc);
        }
      }, halfTTL);
    }, gapMs * i);
  });
}

// ─── STARTUP WARMUP ───────────────────────────────────────────────────────────
// Pre-fetch national on startup; optionally pre-warm state caches in batches.
async function warmup() {
  console.log('[warmup] Fetching national/international feeds…');
  try {
    await getNational();
    console.log('[warmup] National feeds ready.');
  } catch (e) {
    console.error('[warmup] National failed:', e.message);
  }

  // Pre-warm the most-visited states in small batches so Render is ready fast
  const priorityStates = ['fl','tx','ca','ny','pa','oh','il','ga','nc','mi'];
  for (let i = 0; i < priorityStates.length; i += WARM_BATCH) {
    const batch = priorityStates.slice(i, i + WARM_BATCH);
    await Promise.all(batch.map(sc => getState(sc).catch(() => null)));
    console.log(`[warmup] Pre-warmed: ${batch.join(', ')}`);
    if (i + WARM_BATCH < priorityStates.length) {
      await new Promise(r => setTimeout(r, WARM_DELAY_MS));
    }
  }
  console.log('[warmup] Complete.');
}

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/headlines          → national + international
// GET /api/headlines?state=tx → Texas news
app.get('/api/headlines', async (req, res) => {
  const sc = req.query.state ? req.query.state.toLowerCase().trim() : null;

  // ── State ──
  if (sc) {
    if (!STATE_NAMES[sc]) {
      return res.status(400).json({ error: `Unknown state code: "${sc}". Use 2-letter codes (fl, tx, ca…).` });
    }
    try {
      const data = await getState(sc);
      if (!data) return res.status(503).json({ error: 'No data available. Please retry.' });
      return res.json(data);
    } catch (err) {
      console.error(`[route] state ${sc}:`, err.message);
      return res.status(500).json({ error: 'Server error fetching state headlines.' });
    }
  }

  // ── National ──
  try {
    const data = await getNational();
    if (!data) return res.status(503).json({ error: 'No data available. Please retry.' });
    return res.json(data);
  } catch (err) {
    console.error('[route] national:', err.message);
    return res.status(500).json({ error: 'Server error fetching national headlines.' });
  }
});

// POST /api/refresh            → bust national cache
// POST /api/refresh?state=tx   → bust a single state cache
app.post('/api/refresh', (req, res) => {
  const sc = (req.query.state || req.body?.state || '').toLowerCase().trim();
  if (sc) {
    if (!STATE_NAMES[sc]) return res.status(400).json({ error: `Unknown state: ${sc}` });
    if (cache.states[sc]) cache.states[sc].age = 0;
    inFlight.states[sc] = null;
    console.log(`[refresh] busted cache for: ${sc}`);
    return res.json({ cleared: sc, state: STATE_NAMES[sc] });
  }
  cache.national.age = 0;
  inFlight.national  = null;
  console.log('[refresh] busted national cache');
  res.json({ cleared: 'national' });
});

// GET /api/status → shows age of every cached region
app.get('/api/status', (_req, res) => {
  const now     = Date.now();
  const natAge  = cache.national.data
    ? Math.round((now - cache.national.age) / 1000) + 's ago'
    : 'not loaded';

  const states = {};
  for (const sc of Object.keys(STATE_NAMES)) {
    const entry = cache.states[sc];
    states[sc] = entry?.data
      ? Math.round((now - entry.age) / 1000) + 's ago'
      : 'not loaded';
  }

  res.json({
    uptime_s  : Math.round(process.uptime()),
    ttl_s     : TTL_MS / 1000,
    national  : natAge,
    states,
  });
});

// GET /health → Render health check
app.get('/health', (_req, res) => {
  res.json({
    status  : 'ok',
    uptime_s: Math.round(process.uptime()),
    memory  : process.memoryUsage().rss,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ═════════════════════════════════════════════════════════════════════════════
process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received — closing gracefully.');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT received.');
  process.exit(0);
});

// ─── START ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`\nTop Link News API v3.0`);
  console.log(`Port      : ${PORT}`);
  console.log(`Cache TTL : ${TTL_MS / 1000}s`);
  console.log(`Node      : ${process.version}\n`);

  await warmup();
  scheduleRefresh();
});

server.keepAliveTimeout = 65000;   // > Render's 60 s LB timeout
server.headersTimeout   = 66000;
