import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
const pool = require("../db");
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

async function evolutionFetch(path, options = {}) {
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

/**
 * POST /api/whatsapp/connect
 * Body: { phone: "14999999999" }
 */
router.post("/connect", authMiddleware, async (req, res) => {
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

    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Evolution API não configurada no servidor.",
      });
    }

    const instanceName = buildInstanceName(userId, cleanPhone);

    const existing = await pool.query(
      `
      SELECT *
      FROM whatsapp_instances
      WHERE user_id = $1 AND phone = $2
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

      const inserted = await pool.query(
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

    const connectData = await evolutionFetch(`/instance/connect/${instanceName}`, {
      method: "GET",
    });

    const qrcode = normalizeQrCode(connectData);
    const pairingCode = normalizePairingCode(connectData);

    await pool.query(
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
router.get("/status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT *
      FROM whatsapp_instances
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId]
    );

    const instance = result.rows[0];

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

    await pool.query(
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


module.exports = router;
