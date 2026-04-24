const express    = require('express');
const compression = require('compression');
const helmet     = require('helmet');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Security headers ── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://pagead2.googlesyndication.com", "https://www.googletagmanager.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "https:"],
      connectSrc:  ["'self'", "https://api.rss2json.com", "https://pagead2.googlesyndication.com"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,   /* needed for AdSense iframes */
}));

/* ── Gzip compression (faster page loads, better SEO) ── */
app.use(compression());

/* ── Cache-control headers ── */
app.use(function (req, res, next) {
  /* HTML pages: short cache so news stays fresh */
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'public, max-age=300');   /* 5 min */
  }
  /* Static assets: longer cache */
  else if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=86400'); /* 1 day */
  }
  next();
});

/* ── Serve all static files from the project root ── */
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],   /* allows /about to resolve to about.html */
  index: 'index.html',
}));

/* ── Friendly 404 fallback ── */
app.use(function (req, res) {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

/* ── Start server ── */
app.listen(PORT, function () {
  console.log('Top Link News running on port ' + PORT);
});
