import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { one } from './db/index.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import hospitalRoutes from './routes/hospitals.js';
import appointmentRoutes from './routes/appointments.js';
import emergencyRoutes from './routes/emergency.js';
import gatewayRoutes from './routes/gateway.js';
import aiRoutes from './routes/ai.js';
import speechRoutes from './routes/speech.js';
import paymentRoutes from './routes/payments.js';
import doctorRoutes from './routes/doctor.js';
import fileRoutes from './routes/files.js';
import pushRoutes from './routes/push.js';
import hwRoutes from './routes/hw.js';
import adminRoutes from './routes/admin.js';
import familyRoutes from './routes/family.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(
    helmet({
      // Only our own code, Google Fonts and Razorpay checkout may load in the app.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", 'wss:', 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
          frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          // Force HTTPS in production; not locally, so phones on the same Wi-Fi can test over http.
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Camera, microphone and location only for this app itself.
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=(self "https://api.razorpay.com")');
    next();
  });
  app.use(cors({ origin: config.corsOrigins }));
  // The payment webhook needs the raw body to check its signature.
  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === '/api/payments/webhook' ? next() : json(req, res, next)));

  // Load balancers and uptime checks: 200 only when the database answers.
  app.get('/api/health', async (_req, res) => {
    try {
      await one('SELECT 1');
      res.json({ ok: true, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, error: 'Database not reachable' });
    }
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api', hospitalRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/emergency', emergencyRoutes);
  app.use('/api/gateway', gatewayRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/speech', speechRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/doctor', doctorRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/hw', hwRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/family', familyRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the API also serves the built PWA.
  const dist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
  });

  return app;
}
