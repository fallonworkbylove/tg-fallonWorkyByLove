const util = require('util');

/**
 * Simple debug middleware to log req.user and expose a debug header.
 * Logs only in development or when request includes `X-Debug: 1` header.
 */
module.exports = function debugUser(req, res, next) {
  const shouldLog = process.env.NODE_ENV === 'development' || req.headers['x-debug'] === '1';

  if (shouldLog) {
    console.log('DEBUG req.dbUser:', util.inspect(req.dbUser, { depth: 5 }));
  }

  if (req.dbUser) {
    const userId = req.dbUser.id || 'unknown';
    try {
      res.setHeader('X-Debug-User', String(userId));
    } catch (e) {
      // ignore header set errors
    }
  }

  next();
};
