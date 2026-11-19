const util = require('util');

/**
 * Debug middleware: logs req.dbUser only in development.
 * Client X-Debug header ignored in production.
 */
module.exports = function debugUser(req, res, next) {
  const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
  if (!isDev) return next();

  if (req.headers['x-debug'] === '1') {
    console.log('DEBUG req.dbUser:', util.inspect(req.dbUser, { depth: 5 }));
    if (req.dbUser) {
      try {
        res.setHeader('X-Debug-User', String(req.dbUser.id || 'unknown'));
      } catch (_) {}
    }
  }
  next();
};
