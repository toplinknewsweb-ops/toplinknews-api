const express     = require('express');
const compression = require('compression');
const helmet      = require('helmet');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Security headers ── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],

      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://pagead2.googlesyndication.com",
        "https://www.googletagmanager.com",
        "https://www.google-analytics.com",
        "https://partner.googleadservices.com",
        "https://tpc.googlesyndication.com",
      ],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
      ],

      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
      ],

      imgSrc: [
        "'self'",
        "data:",
        "https:",
      ],

      connectSrc: [
        "'self'",
        "https://api.rss2json.com",
        "https://api.web3forms.com",
        "https://pagead2.googlesyndication.com",
        "https://www.google-analytics.com",
        "https://stats.g.doubleclick.net",
      ],

      frameSrc: [
        "https://googleads.g.doubleclick.net",
        "https://tpc.googlesyndication.com",
      ],

      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'", "https://api.web3forms.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

/* ── Gzip compression ── */
app.use(compression());

/* ── Cache-control headers ── */
app.use(function (req, res, next) {
  const p = req.path;
  if (p.endsWith('.html') || p === '/') {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  } else if (/\.(svg|png|jpg|jpeg|gif|webp|ico)$/.test(p)) {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  } else if (/\.(css|js|woff2?)$/.test(p)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  next();
});

/* ── Redirect www to non-www ── */
app.use(function (req, res, next) {
  if (req.headers.host && req.headers.host.startsWith('www.')) {
    return res.redirect(301, 'https://toplinknews.com' + req.url);
  }
  next();
});

/* ── Serve static files ── */
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index:      'index.html',
  dotfiles:   'ignore',
}));

/* ── Explicit routes for all pages ── */
const pages = ['about', 'privacy', 'dmca', 'advertise'];
pages.forEach(function(page) {
  app.get('/' + page, function(req, res) {
    res.sendFile(path.join(__dirname, page + '.html'));
  });
});

/* ── Sitemap.xml ── */
app.get('/sitemap.xml', function (req, res) {
  res.set('Content-Type', 'application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://toplinknews.com/</loc><changefreq>always</changefreq><priority>1.0</priority></url><url><loc>https://toplinknews.com/about.html</loc><changefreq>monthly</changefreq><priority>0.8</priority></url><url><loc>https://toplinknews.com/advertise.html</loc><changefreq>monthly</changefreq><priority>0.8</priority></url><url><loc>https://toplinknews.com/privacy.html</loc><changefreq>yearly</changefreq><priority>0.5</priority></url><url><loc>https://toplinknews.com/dmca.html</loc><changefreq>yearly</changefreq><priority>0.5</priority></url></urlset>');
});

/* ── Robots.txt ── */
app.get('/robots.txt', function (req, res) {
  res.set('Content-Type', 'text/plain');
  res.send('User-agent: *\nAllow: /\nSitemap: https://toplinknews.com/sitemap.xml');
});

/* ── 404 fallback ── */
app.use(function (req, res) {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

/* ── Start server ── */
app.listen(PORT, function () {
  console.log('Top Link News running on port ' + PORT);
});
