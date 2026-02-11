const crypto = require('crypto');

function authMiddleware(req, res, next) {
  const expected = process.env.AUTH_TOKEN || '';
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = header.slice(7);

  // timingSafeEqual requires equal-length buffers
  const tokenBuf = Buffer.from(token, 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');

  if (tokenBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = authMiddleware;
