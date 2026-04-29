import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

export async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token ausente' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      'SELECT id, name, email, plan_status, api_key FROM users WHERE id = $1 AND deleted_at IS NULL',
      [decoded.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Usuário inválido' });

    req.user = rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

export async function n8nApiKeyRequired(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (!apiKey) return res.status(401).json({ error: 'API Key ausente' });

    const { rows } = await query(
      'SELECT id, name, email, plan_status FROM users WHERE api_key = $1 AND deleted_at IS NULL',
      [apiKey]
    );
    if (!rows[0]) return res.status(401).json({ error: 'API Key inválida' });
    if (rows[0].plan_status !== 'active' && rows[0].plan_status !== 'trial') {
      return res.status(403).json({ error: 'Assinatura inativa' });
    }

    req.n8nUser = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}
