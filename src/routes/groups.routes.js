import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { query } from '../config/db.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();
router.use(authRequired);

router.get('/', async (req, res, next) => {
  try {
    const { niche, type } = req.query;
    const params = [req.user.id];
    let where = 'WHERE user_id = $1 AND deleted_at IS NULL';
    if (niche) { params.push(niche); where += ` AND niche = $${params.length}`; }
    if (type) { params.push(type); where += ` AND group_type = $${params.length}`; }

    const { rows } = await query(
      `SELECT * FROM user_groups ${where} ORDER BY niche, name`,
      params
    );
    res.json({ groups: rows });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, group_code, niche, group_type, selected_to_copy, selected_to_send, status } = req.body;
    if (!name || !group_code || !niche || !group_type) {
      return res.status(400).json({ error: 'Nome, código do grupo, nicho e tipo são obrigatórios' });
    }
    const { rows } = await query(
      `INSERT INTO user_groups (id, user_id, name, group_code, niche, group_type, selected_to_copy, selected_to_send, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [uuid(), req.user.id, name, group_code, niche, group_type, !!selected_to_copy, !!selected_to_send, status || 'active']
    );
    res.status(201).json({ group: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, group_code, niche, group_type, selected_to_copy, selected_to_send, status } = req.body;
    const { rows } = await query(
      `UPDATE user_groups
       SET name = COALESCE($1, name),
           group_code = COALESCE($2, group_code),
           niche = COALESCE($3, niche),
           group_type = COALESCE($4, group_type),
           selected_to_copy = COALESCE($5, selected_to_copy),
           selected_to_send = COALESCE($6, selected_to_send),
           status = COALESCE($7, status),
           updated_at = NOW()
       WHERE id = $8 AND user_id = $9 AND deleted_at IS NULL
       RETURNING *`,
      [name, group_code, niche, group_type, selected_to_copy, selected_to_send, status, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json({ group: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'UPDATE user_groups SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
