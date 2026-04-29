import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { query } from '../config/db.js';
import { generateApiKey, signJwt } from '../utils/tokens.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const apiKey = generateApiKey();
    const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    const { rows } = await query(
      `INSERT INTO users (id, name, email, password_hash, api_key, plan_status, trial_ends_at)
       VALUES ($1, $2, LOWER($3), $4, $5, 'trial', $6)
       RETURNING id, name, email, api_key, plan_status, trial_ends_at`,
      [uuid(), name, email, passwordHash, apiKey, trialEndsAt]
    );

    const token = signJwt(rows[0]);
    res.status(201).json({ token, user: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado' });
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query(
      'SELECT id, name, email, password_hash, api_key, plan_status, trial_ends_at FROM users WHERE email = LOWER($1) AND deleted_at IS NULL',
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

    delete user.password_hash;
    const token = signJwt(user);
    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authRequired, async (req, res) => {
  res.json({ user: req.user });
});

router.post('/rotate-api-key', authRequired, async (req, res, next) => {
  try {
    const apiKey = generateApiKey();
    const { rows } = await query(
      'UPDATE users SET api_key = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, api_key, plan_status',
      [apiKey, req.user.id]
    );
    res.json({ user: rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
