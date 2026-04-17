const express = require('express');
const cors    = require('cors');
const Parser  = require('rss-parser');
const parser  = new Parser({ timeout: 10000 });

const app = express();
app.use(cors());

/* ═══════════════════════════════════════════════════════════════════
   FREE RSS FEED SOURCES
   All feeds are publicly available at no cost.
   Organized by political lean so we can interleave them evenly.
   To add more feeds: just push another URL into the right array.
═══════════════════════════════════════════════════════════════════ */
const FEEDS = {

  left: [
    'https://www.vox.com/rss/index.xml',                         // Vox
    'https://www.motherjones.com/feed/',                          // Mother Jones
    'https://www.theguardian.com/us/rss',                         // The Guardian US
    'https://slate.com/feeds/all.rss',                            // Slate
    'https://www.huffpost.com/section/front-page/feed',           // HuffPost
    'https://theintercept.com/feed/?rss',                         // The Intercept
    'https://www.commondreams.org/rss.xml',                       // Common Dreams
    'https://talkingpointsmemo.com/feed',                         // Talking Points Memo
  ],

  center: [
    'https://feeds.npr.org/1001/rss.xml',                         // NPR News
    'https://feeds.bbci.co.uk/news/rss.xml',                      // BBC News
    'https://feeds.reuters.com/reuters/topNews',                   // Reuters
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',  // NY Times
    'https://feeds.washingtonpost.com/rss/national',               // Washington Post
    'https://www.pbs.org/newshour/feeds/rss/headlines',            // PBS NewsHour
    'https://thehill.com/feed/',                                   // The Hill
    'https://www.cbsnews.com/latest/rss/main',                    // CBS News
    'https://abcnews.go.com/abcnews/topstories',                  // ABC News
    'http://rssfeeds.usatoday.com/usatoday-NewsTopStories',       // USA Today
    'https://www.politico.com/rss/politicopicks.xml',              // Politico
    'https://feeds.a.dj.com/rss/RSSWorldNews.xml',                // Wall Street Journal World
    'https://feeds.nbcnews.com/nbcnews/public/news',               // NBC News
    'https://www.axios.com/feeds/feed.rss',                       // Axios
    'https://feeds.skynews.com/feeds/rss/home.xml',               // Sky News
    'https://www.aljazeera.com/xml/rss/all.xml',                  // Al Jazeera English
    'https://rss.dw.com/rdf/rss-en-all',                          // Deutsche Welle
  ],

  right: [
    'http://feeds.foxnews.com/foxnews/latest',                    // Fox News
    'https://feeds.feedburner.com/nationalreview/NRO',            // National Review
    'https://thefederalist.com/feed/',                            // The Federalist
    'https://www.washingtonexaminer.com/section/news/feed/',      // Washington Examiner
    'https://www.dailysignal.com/feed/',                          // Daily Signal (Heritage)
    'https://justthenews.com/rss.xml',                            // Just the News
    'https://www.oann.com/feed/',                                 // One America News
    'https://nypost.com/feed/',                                   // New York Post
  ],

};

/* ═══════════════════════════════════════════════════════════════════
   FETCH + CACHE LOGIC
═══════════════════════════════════════════════════════════════════ */
const MAX_PER_FEED  = 8;   // articles pulled per feed
const MAX_PER_COL   = 25;  // headlines shown per column

let cachedHeadlines = { left: [], right: [] };
let lastUpdate      = null;

/* Fisher-Yates shuffle */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Fetch a single RSS feed, return array of {title, link, lean} */
async function fetchFeed(url, lean) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).slice(0, MAX_PER_FEED).map(item => ({
      title: (item.title || '').trim(),
      link:  item.link || item.guid || '',
      lean,
    }));
  } catch (err) {
    console.warn(`  ✗ Failed: ${url} — ${err.message}`);
    return [];
  }
}

async function fetchAllFeeds() {
  console.log('\nFetching headlines from all sources...');

  /* Fetch all feeds concurrently */
  const promises = [];
  for (const [lean, urls] of Object.entries(FEEDS)) {
    for (const url of urls) {
      promises.push(fetchFeed(url, lean));
    }
  }
  const results = await Promise.allSettled(promises);
  const allArticles = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  /* Separate by lean */
  const leftPool   = shuffle(allArticles.filter(a => a.lean === 'left'));
  const centerPool = shuffle(allArticles.filter(a => a.lean === 'center'));
  const rightPool  = shuffle(allArticles.filter(a => a.lean === 'right'));

  console.log(`  Sources: ${leftPool.length} left  |  ${centerPool.length} center  |  ${rightPool.length} right`);

  /* ── INTERLEAVE evenly across both columns ──────────────────────
     Pattern repeats: left → center → right → center → left → ...
     This guarantees no column is ever all-one-lean.
     Left column  gets: L C R C L C R C ...
     Right column gets: R C L C R C L C ...
  ─────────────────────────────────────────────────────────────── */
  function interleave(firstLean, secondLean, first, center, second) {
    const out = [];
    const pools = { left: [...first], center: [...center], right: [...second] };
    const pattern = [firstLean, 'center', secondLean, 'center'];
    let i = 0;
    while (out.length < MAX_PER_COL) {
      const pick = pattern[i % pattern.length];
      if (pools[pick] && pools[pick].length > 0) {
        out.push(pools[pick].shift());
      } else {
        /* That pool is exhausted — pull from whichever still has items */
        const fallback = ['center', firstLean, secondLean].find(k => pools[k] && pools[k].length > 0);
        if (!fallback) break;
        out.push(pools[fallback].shift());
      }
      i++;
    }
    return out.map(a => ({ title: a.title, link: a.link }));
  }

  cachedHeadlines = {
    left:  interleave('left',  'right', leftPool,  centerPool, rightPool),
    right: interleave('right', 'left',  rightPool, centerPool, leftPool),
  };

  lastUpdate = new Date();
  console.log(`  ✓ ${cachedHeadlines.left.length} left-col  |  ${cachedHeadlines.right.length} right-col  — ${lastUpdate.toLocaleTimeString()}`);
}

/* Fetch on startup, refresh every 10 minutes */
fetchAllFeeds();
setInterval(fetchAllFeeds, 10 * 60 * 1000);

/* ═══════════════════════════════════════════════════════════════════
   API ROUTES
═══════════════════════════════════════════════════════════════════ */

/* Health check — Render pings this to keep the service warm */
app.get('/', (req, res) => {
  res.json({
    status:     'Top Link News API is running',
    feeds:      Object.entries(FEEDS).map(([lean, urls]) => `${lean}: ${urls.length}`).join(' | '),
    lastUpdate: lastUpdate ? lastUpdate.toISOString() : 'pending',
  });
});

app.get('/api/headlines', (req, res) => {
  res.json({
    headlines:  cachedHeadlines,
    lastUpdate: lastUpdate ? lastUpdate.toISOString() : null,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Top Link News API running on port ${PORT}`);
});
