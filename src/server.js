import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import groupsRoutes from './routes/groups.routes.js';
import n8nRoutes from './routes/n8n.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(i => i.trim());

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origem bloqueada pelo CORS: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true, app: 'mini-saas-n8n-backend' }));
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/n8n', n8nRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use(errorHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Backend running on port ${port}`));
