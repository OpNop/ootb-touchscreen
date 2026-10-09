import './env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js';
import { ensureFirstAdmin } from './auth.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/admin', express.static(path.join(root, 'admin')));
app.use('/', express.static(path.join(root, 'kiosk')));

// Express 4 does not catch async errors, so the routes above are sync or wrap their own failures.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong.' : err.message });
});

ensureFirstAdmin();
const port = +process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Kiosk:  http://localhost:${port}/`);
  console.log(`Admin:  http://localhost:${port}/admin/`);
});
