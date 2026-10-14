const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const { pool, initDatabase } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

const PLUMIFY_PRODUCT_HASH = process.env.PLUMIFY_PRODUCT_HASH;
const PLUMIFY_API_TOKEN = process.env.PLUMIFY_API_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

app.use(cors({ origin: '*', credentials: true }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Inicializa banco no boot
initDatabase();

// ============================================================
// CRIA COBRANÇA PIX NA PLUMIFY
// ============================================================
app.post('/api/create-pix', async (req, res) => {
  const { name, email, phone, document, amount } = req.body;

  if (!name || !email || !phone || !document || !amount) {
    return res.status(400).json({ success: false, message: 'Dados incompletos' });
  }

  const valorCents = Math.round(Number(amount) * 100);
  if (valorCents < 100) {
    return res.status(400).json({ success: false, message: 'Valor mínimo R$ 1,00' });
  }

  const payload = {
    amount: valorCents,
    offer_hash: PLUMIFY_PRODUCT_HASH,
    payment_method: 'pix',
    customer: {
      name: name,
      email: email,
      phone_number: phone.replace(/\D/g, ''),
      document: document.replace(/\D/g, ''),
      street_name: 'Rua Exemplo',
      number: '100',
      neighborhood: 'Centro',
      city: 'Fortaleza',
      state: 'CE',
      zip_code: '60000000'
    },
    cart: [{
      product_hash: PLUMIFY_PRODUCT_HASH,
      title: 'Guia 30 Temas de Redação ENEM',
      price: valorCents,
      quantity: 1,
      operation_type: 1,
      tangible: false
    }],
    expire_in_days: 1,
    transaction_origin: 'api',
    postback_url: `${BASE_URL}/api/webhook/pagamento`
  };

  try {
    const response = await fetch(
      `https://api.plumify.com.br/api/public/v1/transactions?api_token=${PLUMIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    const data = await response.json();

    if (!data.pix || !data.pix.pix_qr_code) {
      return res.status(400).json({
        success: false,
        message: data.message || 'Erro ao gerar PIX'
      });
    }

    // Grava pedido como PENDING no Neon
    try {
      await pool.query(
        `INSERT INTO orders (transaction_id, name, email, phone, document, amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
         ON CONFLICT (transaction_id) DO NOTHING`,
        [
          data.hash,
          name,
          email,
          phone.replace(/\D/g, ''),
          document.replace(/\D/g, ''),
          (valorCents / 100).toFixed(2)
        ]
      );
    } catch (dbErr) {
      console.error('Erro ao gravar pedido no Neon:', dbErr.message);
      // Não bloqueia a resposta — o cliente ainda recebe o PIX
    }

    return res.json({
      success: true,
      data: {
        transactionId: data.hash,
        paymentData: {
          copyPaste: data.pix.pix_qr_code,
          qrCodeBase64: data.pix.pix_qr_code_base64 || null
        }
      }
    });
  } catch (error) {
    console.error('Erro create-pix:', error);
    return res.status(500).json({ success: false, message: 'Erro ao gerar pagamento' });
  }
});

// ============================================================
// WEBHOOK — Plumify avisa quando o PIX foi pago
// ============================================================
app.post('/api/webhook/pagamento', async (req, res) => {
  const { hash, status } = req.body;
  console.log('[WEBHOOK PLUMIFY]', { hash, status });

  if (status === 'paid' && hash) {
    try {
      const result = await pool.query(
        `UPDATE orders
         SET status = 'PAID', paid_at = NOW()
         WHERE transaction_id = $1
         RETURNING id, email, name`,
        [hash]
      );

      if (result.rowCount === 0) {
        // Webhook chegou antes do INSERT (raro, mas acontece)
        console.warn(`Pedido ${hash} não encontrado — inserindo como pago direto`);
        await pool.query(
          `INSERT INTO orders (transaction_id, amount, status, paid_at)
           VALUES ($1, 0, 'PAID', NOW())
           ON CONFLICT (transaction_id) DO UPDATE
           SET status = 'PAID', paid_at = NOW()`,
          [hash]
        );
      } else {
        console.log(`Pedido ${hash} marcado como PAID (cliente: ${result.rows[0].email})`);
        // TODO: disparar e-mail com o PDF aqui (fica pro #4)
      }
    } catch (err) {
      console.error('Erro webhook no Neon:', err.message);
    }
  }

  res.json({ received: true });
});

// ============================================================
// CONSULTA STATUS — front faz polling aqui, agora lendo do Neon
// ============================================================
app.get('/api/pix-status', async (req, res) => {
  const { transactionId } = req.query;
  if (!transactionId) {
    return res.status(400).json({ success: false, message: 'transactionId obrigatório' });
  }

  try {
    const result = await pool.query(
      `SELECT status FROM orders WHERE transaction_id = $1`,
      [transactionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    const status = String(result.rows[0].status).toUpperCase();
    return res.json({
      success: true,
      data: {
        status: status === 'PAID' ? 'PAID' : 'PENDING',
        transactionId
      }
    });
  } catch (err) {
    console.error('Erro pix-status:', err.message);
    return res.status(500).json({ success: false, message: 'Erro ao consultar' });
  }
});

// ============================================================
// PÁGINAS
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'public', 'checkout.html')));
app.get('/sucesso', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sucesso.html')));
app.get('/privacidade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacidade.html')));
app.get('/termos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'termos.html')));
app.get('/contato', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contato.html')));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'conectado' });
  } catch {
    res.status(500).json({ ok: false, db: 'erro' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor online na porta ${PORT}`);
});

module.exports = app;