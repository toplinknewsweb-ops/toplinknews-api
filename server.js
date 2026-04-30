const express    = require('express');
const cors       = require('cors');
const RSSParser  = require('rss-parser');
const NodeCache  = require('node-cache');

const app    = express();
const parser = new RSSParser({ timeout: 8000 });
const cache  = new NodeCache({ stdTTL: 600 }); // 10-minute cache

app.use(cors());
app.use(express.json());

/* ═══════════════════════════════════════════════
   NATIONAL SOURCES  (always loaded)
═══════════════════════════════════════════════ */
const NATIONAL_SOURCES = [
  { label: 'NPR',              url: 'https://feeds.npr.org/1001/rss.xml' },
  { label: 'AP News',          url: 'https://feeds.apnews.com/rss/apf-topnews' },
  { label: 'Reuters',          url: 'https://feeds.reuters.com/reuters/topNews' },
  { label: 'Fox News',         url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
  { label: 'BBC News',         url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { label: 'The Guardian',     url: 'https://www.theguardian.com/us-news/rss' },
  { label: 'PBS NewsHour',     url: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
  { label: 'Washington Times', url: 'https://www.washingtontimes.com/rss/headlines/news/' },
  { label: 'ABC News',         url: 'https://feeds.abcnews.com/abcnews/topstories' },
  { label: 'NBC News',         url: 'https://feeds.nbcnews.com/nbcnews/public/news' },
  { label: 'CBS News',         url: 'https://www.cbsnews.com/latest/rss/main' },
  { label: 'CNN',              url: 'https://rss.cnn.com/rss/edition.rss' },
  { label: 'New York Post',    url: 'https://nypost.com/feed/' },
  { label: 'Al Jazeera',       url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { label: 'Deutsche Welle',   url: 'https://rss.dw.com/rdf/rss-en-all' },
  { label: 'France 24',        url: 'https://www.france24.com/en/rss' }
];

/* ═══════════════════════════════════════════════
   STATE-SPECIFIC LOCAL NEWS SOURCES
═══════════════════════════════════════════════ */
const STATE_SOURCES = {
  al: [
    { label: 'AL.com',          url: 'https://www.al.com/arc/outboundfeeds/rss/?outputType=xml' },
    { label: 'WAFF 48',         url: 'https://www.waff.com/rss' }
  ],
  ak: [
    { label: 'Anchorage Daily', url: 'https://www.adn.com/rss.xml' },
    { label: 'KTUU',            url: 'https://www.ktuu.com/rss' }
  ],
  az: [
    { label: 'AZ Central',      url: 'https://rssfeeds.azcentral.com/rss/feeds/azcentral/home' },
    { label: 'KTAR News',       url: 'https://ktar.com/feed/' }
  ],
  ar: [
    { label: 'Arkansas Democrat', url: 'https://www.arkansasonline.com/rss/' },
    { label: 'KATV',            url: 'https://katv.com/rss' }
  ],
  ca: [
    { label: 'LA Times',        url: 'https://www.latimes.com/rss2.0.xml' },
    { label: 'SF Chronicle',    url: 'https://www.sfchronicle.com/feed/' },
    { label: 'KCAL News',       url: 'https://kcalnews.com/feed/' }
  ],
  co: [
    { label: 'Denver Post',     url: 'https://www.denverpost.com/feed/' },
    { label: 'CPR News',        url: 'https://www.cpr.org/feed/' }
  ],
  ct: [
    { label: 'CT Insider',      url: 'https://www.ctinsider.com/rss/' },
    { label: 'NBC Connecticut', url: 'https://www.nbcconnecticut.com/feed/' }
  ],
  de: [
    { label: 'Delaware Online',  url: 'https://www.delawareonline.com/rss/news' },
    { label: 'WDEL',            url: 'https://www.wdel.com/search/?f=rss' }
  ],
  fl: [
    { label: 'Miami Herald',    url: 'https://www.miamiherald.com/rss/headlines/' },
    { label: 'Tampa Bay Times', url: 'https://www.tampabay.com/rss/' },
    { label: 'Orlando Sentinel', url: 'https://www.orlandosentinel.com/feed/' },
    { label: 'Sun Sentinel',    url: 'https://www.sun-sentinel.com/feed/' }
  ],
  ga: [
    { label: 'AJC',             url: 'https://www.ajc.com/rss/feeds/news/' },
    { label: 'WSB-TV',          url: 'https://www.wsbtv.com/rss' }
  ],
  hi: [
    { label: 'Honolulu Star',   url: 'https://www.staradvertiser.com/feed/' },
    { label: 'KHON2',           url: 'https://www.khon2.com/feed/' }
  ],
  id: [
    { label: 'Idaho Statesman', url: 'https://www.idahostatesman.com/rss/news' },
    { label: 'KTVB',            url: 'https://www.ktvb.com/rss' }
  ],
  il: [
    { label: 'Chicago Tribune', url: 'https://www.chicagotribune.com/arcio/rss/' },
    { label: 'Chicago Sun-Times', url: 'https://chicago.suntimes.com/rss/news.xml' },
    { label: 'WGN Radio',       url: 'https://wgnradio.com/feed/' }
  ],
  in: [
    { label: 'Indy Star',       url: 'https://www.indystar.com/rss/news' },
    { label: 'WTHR',            url: 'https://www.wthr.com/rss' }
  ],
  ia: [
    { label: 'Des Moines Register', url: 'https://www.desmoinesregister.com/rss/news' },
    { label: 'WHO-HD',          url: 'https://who13.com/feed/' }
  ],
  ks: [
    { label: 'Wichita Eagle',   url: 'https://www.kansas.com/rss/news' },
    { label: 'KSNT News',       url: 'https://www.ksnt.com/feed/' }
  ],
  ky: [
    { label: 'Courier Journal', url: 'https://www.courier-journal.com/rss/news' },
    { label: 'WKYT',            url: 'https://www.wkyt.com/rss' }
  ],
  la: [
    { label: 'Times-Picayune',  url: 'https://www.nola.com/rss/news/' },
    { label: 'WDSU',            url: 'https://www.wdsu.com/rss' }
  ],
  me: [
    { label: 'Portland Press Herald', url: 'https://www.pressherald.com/feed/' },
    { label: 'WMTW',            url: 'https://www.wmtw.com/rss' }
  ],
  md: [
    { label: 'Baltimore Sun',   url: 'https://www.baltimoresun.com/feed/' },
    { label: 'WBAL-TV',         url: 'https://www.wbaltv.com/rss' }
  ],
  ma: [
    { label: 'Boston Globe',    url: 'https://www.bostonglobe.com/rss/headlines' },
    { label: 'Boston Herald',   url: 'https://www.bostonherald.com/feed/' },
    { label: 'WCVB',            url: 'https://www.wcvb.com/rss' }
  ],
  mi: [
    { label: 'Detroit Free Press', url: 'https://www.freep.com/rss/news' },
    { label: 'MLive',           url: 'https://www.mlive.com/rss/news/' },
    { label: 'WXYZ',            url: 'https://www.wxyz.com/rss' }
  ],
  mn: [
    { label: 'Star Tribune',    url: 'https://www.startribune.com/feeds/news' },
    { label: 'MPR News',        url: 'https://www.mprnews.org/rss' }
  ],
  ms: [
    { label: 'Clarion Ledger',  url: 'https://www.clarionledger.com/rss/news' },
    { label: 'WJTV',            url: 'https://www.wjtv.com/feed/' }
  ],
  mo: [
    { label: 'St. Louis Post',  url: 'https://www.stltoday.com/rss' },
    { label: 'KC Star',         url: 'https://www.kansascity.com/rss/news' }
  ],
  mt: [
    { label: 'Billings Gazette', url: 'https://billingsgazette.com/search/?f=rss' },
    { label: 'KTVQ',            url: 'https://www.ktvq.com/feed/' }
  ],
  ne: [
    { label: 'Omaha World-Herald', url: 'https://omaha.com/search/?f=rss' },
    { label: 'KETV',            url: 'https://www.ketv.com/rss' }
  ],
  nv: [
    { label: 'Las Vegas Review', url: 'https://www.reviewjournal.com/feed/' },
    { label: 'Reno Gazette',    url: 'https://www.rgj.com/rss/news' },
    { label: 'KLAS',            url: 'https://www.8newsnow.com/feed/' }
  ],
  nh: [
    { label: 'Union Leader',    url: 'https://www.unionleader.com/rss' },
    { label: 'WMUR',            url: 'https://www.wmur.com/rss' }
  ],
  nj: [
    { label: 'NJ.com',          url: 'https://www.nj.com/rss/news/' },
    { label: 'NJ Advance Media', url: 'https://www.northjersey.com/rss/news' }
  ],
  nm: [
    { label: 'Albuquerque Journal', url: 'https://www.abqjournal.com/feed/' },
    { label: 'KOB 4',           url: 'https://www.kob.com/rss' }
  ],
  ny: [
    { label: 'NY Times',        url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
    { label: 'NY Daily News',   url: 'https://www.nydailynews.com/arcio/rss/' },
    { label: 'Newsday',         url: 'https://www.newsday.com/rss' }
  ],
  nc: [
    { label: 'Charlotte Observer', url: 'https://www.charlotteobserver.com/rss/news' },
    { label: 'News & Observer',  url: 'https://www.newsobserver.com/rss/news' },
    { label: 'WRAL',            url: 'https://www.wral.com/rss' }
  ],
  nd: [
    { label: 'Bismarck Tribune', url: 'https://bismarcktribune.com/search/?f=rss' },
    { label: 'KFYR',            url: 'https://www.kfyrtv.com/rss' }
  ],
  oh: [
    { label: 'Cleveland Plain Dealer', url: 'https://www.cleveland.com/rss/news/' },
    { label: 'Columbus Dispatch', url: 'https://www.dispatch.com/rss/news' },
    { label: 'WEWS',            url: 'https://www.newsnet5.com/rss' }
  ],
  ok: [
    { label: 'The Oklahoman',   url: 'https://www.oklahoman.com/rss/news' },
    { label: 'Tulsa World',     url: 'https://tulsaworld.com/search/?f=rss' }
  ],
  or: [
    { label: 'The Oregonian',   url: 'https://www.oregonlive.com/rss/news/' },
    { label: 'Oregon Public Broadcasting', url: 'https://www.opb.org/rss/news' }
  ],
  pa: [
    { label: 'Philadelphia Inquirer', url: 'https://www.inquirer.com/rss' },
    { label: 'Pittsburgh Post-Gazette', url: 'https://www.post-gazette.com/rss/news' },
    { label: 'WPXI',            url: 'https://www.wpxi.com/rss' }
  ],
  ri: [
    { label: 'Providence Journal', url: 'https://www.providencejournal.com/rss/news' },
    { label: 'WJAR',            url: 'https://turnto10.com/rss' }
  ],
  sc: [
    { label: 'The State',       url: 'https://www.thestate.com/rss/news' },
    { label: 'Post and Courier', url: 'https://www.postandcourier.com/rss' }
  ],
  sd: [
    { label: 'Argus Leader',    url: 'https://www.argusleader.com/rss/news' },
    { label: 'KSFY',            url: 'https://www.ksfy.com/rss' }
  ],
  tn: [
    { label: 'Tennessean',      url: 'https://www.tennessean.com/rss/news' },
    { label: 'Memphis Commercial Appeal', url: 'https://www.commercialappeal.com/rss/news' },
    { label: 'WKRN',            url: 'https://www.wkrn.com/feed/' }
  ],
  tx: [
    { label: 'Houston Chronicle', url: 'https://www.houstonchronicle.com/feed/' },
    { label: 'Dallas Morning News', url: 'https://www.dallasnews.com/arcio/rss/' },
    { label: 'Austin American-Statesman', url: 'https://www.statesman.com/rss/news' },
    { label: 'San Antonio Express', url: 'https://www.expressnews.com/rss/news' }
  ],
  ut: [
    { label: 'Salt Lake Tribune', url: 'https://www.sltrib.com/rss' },
    { label: 'KSL',             url: 'https://www.ksl.com/rss' }
  ],
  vt: [
    { label: 'Burlington Free Press', url: 'https://www.burlingtonfreepress.com/rss/news' },
    { label: 'VT Digger',       url: 'https://vtdigger.org/feed/' }
  ],
  va: [
    { label: 'Richmond Times',  url: 'https://richmond.com/feed/' },
    { label: 'Virginian-Pilot', url: 'https://www.pilotonline.com/rss' },
    { label: 'WTVR',            url: 'https://www.wtvr.com/feed/' }
  ],
  wa: [
    { label: 'Seattle Times',   url: 'https://www.seattletimes.com/rss/home' },
    { label: 'The Spokesman-Review', url: 'https://www.spokesman.com/rss/news' },
    { label: 'KING 5',          url: 'https://www.king5.com/rss' }
  ],
  wv: [
    { label: 'Charleston Gazette', url: 'https://www.wvgazettemail.com/feed/' },
    { label: 'WSAZ',            url: 'https://www.wsaz.com/rss' }
  ],
  wi: [
    { label: 'Milwaukee Journal', url: 'https://www.jsonline.com/arcio/rss/' },
    { label: 'Wisconsin State Journal', url: 'https://madison.com/feed/' },
    { label: 'WISN',            url: 'https://www.wisn.com/rss' }
  ],
  wy: [
    { label: 'Casper Star-Tribune', url: 'https://trib.com/feed/' },
    { label: 'Wyoming Tribune',  url: 'https://www.wyomingnews.com/feed/' }
  ],
  dc: [
    { label: 'Washington Post',  url: 'https://feeds.washingtonpost.com/rss/national' },
    { label: 'DC News Now',      url: 'https://www.dcnewsnow.com/feed/' },
    { label: 'WTOP',             url: 'https://wtop.com/feed/' }
  ]
};

/* ═══════════════════════════════════════════════
   HELPER: Fetch one RSS feed
═══════════════════════════════════════════════ */
async function fetchFeed(source, maxItems = 5) {
  try {
    const feed = await parser.parseURL(source.url);
    return (feed.items || []).slice(0, maxItems).map(item => ({
      title:   item.title  || '',
      link:    item.link   || item.guid || '',
      summary: item.contentSnippet || item.summary || '',
      source:  source.label,
      pubDate: item.pubDate || ''
    }));
  } catch (e) {
    console.warn(`Feed failed: ${source.label} — ${e.message}`);
    return [];
  }
}

/* ═══════════════════════════════════════════════
   HELPER: Interleave results from multiple feeds
═══════════════════════════════════════════════ */
function interleave(arrays) {
  const result = [];
  const maxLen = Math.max(...arrays.map(a => a.length));
  for (let i = 0; i < maxLen; i++) {
    arrays.forEach(arr => { if (arr[i]) result.push(arr[i]); });
  }
  return result;
}

/* ═══════════════════════════════════════════════
   GET /api/headlines
   Query params:
     ?state=fl   → state-specific local news
     (none)      → national/international only
═══════════════════════════════════════════════ */
app.get('/api/headlines', async (req, res) => {
  const stateCode = (req.query.state || '').toLowerCase().trim();
  const cacheKey  = `headlines_${stateCode || 'national'}`;

  // Serve from cache if available
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`Cache hit: ${cacheKey}`);
    return res.json(cached);
  }

  try {
    // Fetch national feeds in parallel
    const nationalResults = await Promise.all(
      NATIONAL_SOURCES.map(src => fetchFeed(src, 4))
    );
    const nationalItems = interleave(nationalResults);

    // Fetch state-specific feeds if requested
    let localItems = [];
    if (stateCode && STATE_SOURCES[stateCode]) {
      const localResults = await Promise.all(
        STATE_SOURCES[stateCode].map(src => fetchFeed(src, 6))
      );
      localItems = interleave(localResults);
    }

    const breaking = nationalItems[0] || null;
    const mid      = Math.ceil(nationalItems.length / 2);

    const payload = {
      breaking,
      top:   nationalItems.slice(0, mid),
      right: nationalItems.slice(mid),
      local: localItems,
      state: stateCode || null,
      updatedAt: new Date().toISOString()
    };

    cache.set(cacheKey, payload);
    console.log(`Served: ${cacheKey} | national=${nationalItems.length} local=${localItems.length}`);
    res.json(payload);

  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: 'Failed to fetch headlines', message: err.message });
  }
});

/* ═══════════════════════════════════════════════
   GET /api/health  — uptime check for Render
═══════════════════════════════════════════════ */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});

/* ═══════════════════════════════════════════════
   START SERVER
═══════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TopLinkNews API running on port ${PORT}`);
});
