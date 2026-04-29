import { Router } from 'express';
import { query } from '../config/db.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();
router.use(authRequired);

async function upsertSettings(userId, category, payload) {
  const { rows } = await query(
    `INSERT INTO user_settings (user_id, category, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, category)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
     RETURNING category, payload, updated_at`,
    [userId, category, JSON.stringify(payload || {})]
  );
  return rows[0];
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT category, payload, updated_at FROM user_settings WHERE user_id = $1 ORDER BY category',
      [req.user.id]
    );
    const settings = rows.reduce((acc, item) => {
      acc[item.category] = item.payload;
      return acc;
    }, {});
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

router.get('/:category', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT category, payload, updated_at FROM user_settings WHERE user_id = $1 AND category = $2',
      [req.user.id, req.params.category]
    );
    res.json({ setting: rows[0] || { category: req.params.category, payload: {} } });
  } catch (error) {
    next(error);
  }
});

router.put('/:category', async (req, res, next) => {
  try {
    const setting = await upsertSettings(req.user.id, req.params.category, req.body);
    res.json({ setting });
  } catch (error) {
    next(error);
  }
});

export default router;
