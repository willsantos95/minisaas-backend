import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../config/db.js";

const router = express.Router();

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE_PREFIX = process.env.EVOLUTION_INSTANCE_PREFIX || "minisaas";

function onlyNumbers(value) {
  return String(value || "").replace(/\D/g, "");
}

function buildInstanceName(userId, phone) {
  const cleanPhone = onlyNumbers(phone);
  return `${INSTANCE_PREFIX}_user_${userId}_${cleanPhone}`;
}

function normalizeQrCode(data) {
  return (
    data?.qrcode?.base64 ||
    data?.qrcode ||
    data?.base64 ||
    data?.qr ||
    data?.code ||
    null
  );
}

function normalizePairingCode(data) {
  return (
    data?.pairingCode ||
    data?.pairing_code ||
    data?.qrcode?.pairingCode ||
    null
  );
}

function normalizeGroupsResponse(groupsData) {
  if (Array.isArray(groupsData)) return groupsData;

  if (Array.isArray(groupsData?.groups)) return groupsData.groups;
  if (Array.isArray(groupsData?.data)) return groupsData.data;
  if (Array.isArray(groupsData?.response)) return groupsData.response;

  return [];
}

function getGroupJid(group) {
  return (
    group?.id ||
    group?.jid ||
    group?.groupJid ||
    group?.remoteJid ||
    group?.key?.remoteJid ||
    null
  );
}

function getGroupName(group) {
  return (
    group?.subject ||
    group?.name ||
    group?.groupName ||
    group?.pushName ||
    "Grupo sem nome"
  );
}

async function evolutionFetch(path, options = {}) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    throw new Error("Evolution API não configurada no servidor.");
  }

  const response = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.raw ||
        `Erro Evolution API: ${response.status}`
    );
  }

  return data;
}

async function getLatestUserInstance(userId) {
  const result = await query(
    `
    SELECT *
    FROM whatsapp_instances
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0];
}

/**
 * POST /api/whatsapp/connect
 * Body: { phone: "14999999999" }
 */
router.post("/connect", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { phone } = req.body;

    const cleanPhone = onlyNumbers(phone);

    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Informe um número de WhatsApp válido.",
      });
    }

    const instanceName = buildInstanceName(userId, cleanPhone);

    const existing = await query(
      `
      SELECT *
      FROM whatsapp_instances
      WHERE user_id = $1 
        AND phone = $2
      LIMIT 1
      `,
      [userId, cleanPhone]
    );

    let instance = existing.rows[0];

    if (!instance) {
      await evolutionFetch("/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });

      const inserted = await query(
        `
        INSERT INTO whatsapp_instances 
          (user_id, phone, instance_name, status)
        VALUES 
          ($1, $2, $3, $4)
        RETURNING *
        `,
        [userId, cleanPhone, instanceName, "created"]
      );

      instance = inserted.rows[0];
    }

    const connectData = await evolutionFetch(
      `/instance/connect/${instanceName}`,
      {
        method: "GET",
      }
    );

    const qrcode = normalizeQrCode(connectData);
    const pairingCode = normalizePairingCode(connectData);

    await query(
      `
      UPDATE whatsapp_instances
      SET 
        qrcode = $1,
        pairing_code = $2,
        status = $3,
        updated_at = NOW()
      WHERE id = $4
      `,
      [qrcode, pairingCode, "waiting_connection", instance.id]
    );

    return res.json({
      success: true,
      instanceName,
      phone: cleanPhone,
      status: "waiting_connection",
      qrcode,
      pairingCode,
      raw: connectData,
    });
  } catch (error) {
    console.error("Erro ao conectar WhatsApp:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Erro ao criar conexão com WhatsApp.",
    });
  }
});

/**
 * GET /api/whatsapp/status
 */
router.get("/status", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    const instance = await getLatestUserInstance(userId);

    if (!instance) {
      return res.json({
        success: true,
        connected: false,
        status: "not_created",
      });
    }

    let stateData = null;

    try {
      stateData = await evolutionFetch(
        `/instance/connectionState/${instance.instance_name}`,
        {
          method: "GET",
        }
      );
    } catch (e) {
      console.log("Não foi possível consultar estado da instância:", e.message);
    }

    const state =
      stateData?.instance?.state ||
      stateData?.state ||
      stateData?.connectionStatus ||
      "unknown";

    const connected = state === "open" || state === "connected";

    await query(
      `
      UPDATE whatsapp_instances
      SET 
        status = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [connected ? "connected" : state, instance.id]
    );

    return res.json({
      success: true,
      connected,
      status: connected ? "connected" : state,
      instanceName: instance.instance_name,
      phone: instance.phone,
      raw: stateData,
    });
  } catch (error) {
    console.error("Erro ao consultar status WhatsApp:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Erro ao consultar status do WhatsApp.",
    });
  }
});

/**
 * GET /api/whatsapp/groups
 * Lista os grupos da instância conectada na Evolution
 */
router.get("/groups", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    const instance = await getLatestUserInstance(userId);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: "Nenhuma instância de WhatsApp encontrada para este usuário.",
      });
    }

    const groupsData = await evolutionFetch(
      `/group/fetchAllGroups/${instance.instance_name}?getParticipants=false`,
      {
        method: "GET",
      }
    );

    const savedGroupsResult = await query(
      `
      SELECT group_jid, role, niche, status
      FROM user_whatsapp_groups
      WHERE user_id = $1
        AND instance_name = $2
        AND status = 'active'
      `,
      [userId, instance.instance_name]
    );

    const savedGroups = savedGroupsResult.rows;
    const evolutionGroups = normalizeGroupsResponse(groupsData);

    const groups = evolutionGroups
      .map((group) => {
        const groupJid = getGroupJid(group);
        const groupName = getGroupName(group);

        if (!groupJid) return null;

        const roles = savedGroups
          .filter((saved) => saved.group_jid === groupJid)
          .map((saved) => saved.role);

        const savedConfig = savedGroups.find(
          (saved) => saved.group_jid === groupJid
        );

        return {
          id: groupJid,
          group_jid: groupJid,
          group_name: groupName,
          subject: group?.subject || groupName,
          owner: group?.owner || null,
          creation: group?.creation || null,
          participants_count:
            group?.participants?.length ||
            group?.size ||
            group?.participantsCount ||
            null,
          is_origin: roles.includes("origin"),
          is_destination: roles.includes("destination"),
          niche: savedConfig?.niche || "geral",
          raw: group,
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      instanceName: instance.instance_name,
      groups,
      raw: groupsData,
    });
  } catch (error) {
    console.error("Erro ao listar grupos:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Erro ao listar grupos do WhatsApp.",
    });
  }
});

/**
 * POST /api/whatsapp/groups/save
 * Body:
 * {
 *   groups: [
 *     {
 *       group_jid: "120363423459629928@g.us",
 *       group_name: "Nome do Grupo",
 *       is_origin: true,
 *       is_destination: false,
 *       niche: "geral"
 *     }
 *   ]
 * }
 */
router.post("/groups/save", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groups } = req.body;

    if (!Array.isArray(groups)) {
      return res.status(400).json({
        success: false,
        message: "Envie uma lista de grupos válida.",
      });
    }

    const instance = await getLatestUserInstance(userId);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: "Nenhuma instância de WhatsApp encontrada.",
      });
    }

    await query(
      `
      DELETE FROM user_whatsapp_groups
      WHERE user_id = $1
        AND instance_name = $2
      `,
      [userId, instance.instance_name]
    );

    for (const group of groups) {
      const groupJid = group.group_jid || group.id;
      const groupName = group.group_name || group.name || "Grupo sem nome";
      const niche = group.niche || "geral";

      if (!groupJid) continue;

      if (group.is_origin) {
        await query(
          `
          INSERT INTO user_whatsapp_groups
            (user_id, instance_name, group_jid, group_name, role, niche, status)
          VALUES
            ($1, $2, $3, $4, $5, $6, 'active')
          ON CONFLICT (user_id, group_jid, role)
          DO UPDATE SET
            instance_name = EXCLUDED.instance_name,
            group_name = EXCLUDED.group_name,
            niche = EXCLUDED.niche,
            status = 'active',
            updated_at = NOW()
          `,
          [
            userId,
            instance.instance_name,
            groupJid,
            groupName,
            "origin",
            niche,
          ]
        );
      }

      if (group.is_destination) {
        await query(
          `
          INSERT INTO user_whatsapp_groups
            (user_id, instance_name, group_jid, group_name, role, niche, status)
          VALUES
            ($1, $2, $3, $4, $5, $6, 'active')
          ON CONFLICT (user_id, group_jid, role)
          DO UPDATE SET
            instance_name = EXCLUDED.instance_name,
            group_name = EXCLUDED.group_name,
            niche = EXCLUDED.niche,
            status = 'active',
            updated_at = NOW()
          `,
          [
            userId,
            instance.instance_name,
            groupJid,
            groupName,
            "destination",
            niche,
          ]
        );
      }
    }

    const savedCountResult = await query(
      `
      SELECT 
        COUNT(*) FILTER (WHERE role = 'origin') AS origins,
        COUNT(*) FILTER (WHERE role = 'destination') AS destinations
      FROM user_whatsapp_groups
      WHERE user_id = $1
        AND instance_name = $2
        AND status = 'active'
      `,
      [userId, instance.instance_name]
    );

    return res.json({
      success: true,
      message: "Configuração dos grupos salva com sucesso.",
      summary: {
        origins: Number(savedCountResult.rows[0]?.origins || 0),
        destinations: Number(savedCountResult.rows[0]?.destinations || 0),
      },
    });
  } catch (error) {
    console.error("Erro ao salvar grupos:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Erro ao salvar configuração dos grupos.",
    });
  }
});

export default router;
