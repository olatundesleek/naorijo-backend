import express from 'express';
import paymentRoutes from './modules/payments/routes.js';
import billingRoutes from './modules/billing/routes.js';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { corsOrigins, env } from './config/env.js';
import authRoutes from './modules/auth/routes.js';
import companyRoutes from './modules/companies/routes.js';
import productRoutes from './modules/products/routes.js';
import verificationRoutes from './modules/verification/routes.js';
import platformAdminRoutes from './modules/platform-admin/routes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-CSRF-Token']
}));
app.use('/api/v1/webhooks/payments', express.raw({ type: 'application/json', limit: '64kb' }), paymentRoutes);
app.use(express.json({ limit: '32kb', strict: true }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', companyRoutes);
app.use('/api/v1', productRoutes);
app.use('/api/v1', billingRoutes);
app.use('/api/v1/verify', verificationRoutes);
app.use('/api/v1/platform-admin', platformAdminRoutes);
app.use(notFound);
app.use(errorHandler);
