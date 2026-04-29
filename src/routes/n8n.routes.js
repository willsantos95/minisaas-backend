import { Router } from 'express';
import { query } from '../config/db.js';
import { n8nApiKeyRequired } from '../middleware/auth.js';

const router = Router();
router.use(n8nApiKeyRequired);

router.get('/profile', (req, res) => {
  res.json({ user: req.n8nUser });
});

router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT category, payload FROM user_settings WHERE user_id = $1',
      [req.n8nUser.id]
    );
    const settings = rows.reduce((acc, item) => {
      acc[item.category] = item.payload;
      return acc;
    }, {});
    res.json({ user: req.n8nUser, settings });
  } catch (error) {
    next(error);
  }
});

router.get('/affiliate', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT payload FROM user_settings WHERE user_id = $1 AND category = 'affiliate'`,
      [req.n8nUser.id]
    );
    res.json({ affiliate: rows[0]?.payload || {} });
  } catch (error) {
    next(error);
  }
});

router.get('/telegram', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT payload FROM user_settings WHERE user_id = $1 AND category = 'telegram'`,
      [req.n8nUser.id]
    );
    res.json({ telegram: rows[0]?.payload || {} });
  } catch (error) {
    next(error);
  }
});

router.get('/whatsapp', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT payload FROM user_settings WHERE user_id = $1 AND category = 'whatsapp'`,
      [req.n8nUser.id]
    );
    res.json({ whatsapp: rows[0]?.payload || {} });
  } catch (error) {
    next(error);
  }
});

router.get('/groups', async (req, res, next) => {
  try {
    const { niche, copy, send } = req.query;
    const params = [req.n8nUser.id];
    let where = `WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL`;
    if (niche) { params.push(niche); where += ` AND niche = $${params.length}`; }
    if (copy === 'true') where += ' AND selected_to_copy = true';
    if (send === 'true') where += ' AND selected_to_send = true';

    const { rows } = await query(
      `SELECT id, name, group_code, niche, group_type, selected_to_copy, selected_to_send, status
       FROM user_groups ${where} ORDER BY niche, name`,
      params
    );
    res.json({ groups: rows });
  } catch (error) {
    next(error);
  }
});

router.post('/groups/sync', async (req, res, next) => {
  try {
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    for (const group of groups) {
      await query(
        `INSERT INTO user_groups (user_id, name, group_code, niche, group_type, selected_to_copy, selected_to_send, status)
         VALUES ($1, $2, $3, COALESCE($4, 'geral'), COALESCE($5, 'origin'), false, false, 'active')
         ON CONFLICT (user_id, group_code)
         DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [req.n8nUser.id, group.name, group.group_code, group.niche, group.group_type]
      );
    }
    res.json({ message: 'Grupos sincronizados', total: groups.length });
  } catch (error) {
    next(error);
  }
});

export default router;
