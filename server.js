const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const parser = new Parser();

const app = express();
app.use(cors()); // Allows your Namecheap site to call this API

// Expanded feeds — left, neutral, right
const feeds = {
  left: [
    'https://www.vox.com/rss/index.xml',
    'https://www.motherjones.com/feed/'
  ],
  neutral: [
    'https://feeds.reuters.com/reuters/topNews',
    'https://apnews.com/rss'
  ],
  right: [
    'http://feeds.foxnews.com/foxnews/latest',
    'https://feeds.feedburner.com/nationalreview'
  ]
};

let cachedHeadlines = { left: [], neutral: [], right: [] };
let lastUpdate = null;

async function fetchAllFeeds() {
  console.log('Fetching fresh headlines...');
  const newHeadlines = { left: [], neutral: [], right: [] };

  for (const [category, urls] of Object.entries(feeds)) {
    for (const url of urls) {
      try {
        const feed = await parser.parseURL(url);
        newHeadlines[category] = newHeadlines[category].concat(
          feed.items.slice(0, 10).map(item => ({
            title: item.title,
            link: item.link
          }))
        );
      } catch (err) {
        console.warn(`Failed to fetch ${url}:`, err.message);
      }
    }
  }

  cachedHeadlines = newHeadlines;
  lastUpdate = new Date();
  console.log(`Headlines updated at ${lastUpdate.toLocaleTimeString()}`);
}

// Fetch on startup, then refresh every 10 minutes
fetchAllFeeds();
setInterval(fetchAllFeeds, 10 * 60 * 1000);

// Health check — Render pings this to confirm the service is alive
app.get('/', (req, res) => {
  res.json({ status: 'Top Link News API is running', lastUpdate });
});

app.get('/api/headlines', (req, res) => {
  res.json({
    headlines: cachedHeadlines,
    lastUpdate: lastUpdate ? lastUpdate.toISOString() : null
  });
});

// process.env.PORT is required by Render — do not hardcode this
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Top Link News API running on port ${PORT}`);
});
