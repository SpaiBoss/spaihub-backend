import { readOwnerLogoFile, isSafeLogoFilename } from '../services/objectStorage.js';

export async function serveOwnerLogo(req, res, next) {
  try {
    const { filename } = req.params;
    if (!isSafeLogoFilename(filename)) {
      return res.status(400).json({ error: 'Invalid logo filename' });
    }

    const { buffer, contentType } = await readOwnerLogoFile(filename);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  } catch (err) {
    if (
      err.code === 'ENOENT'
      || err.name === 'NoSuchKey'
      || err.$metadata?.httpStatusCode === 404
    ) {
      return res.status(404).json({ error: 'Logo not found' });
    }
    next(err);
  }
}
