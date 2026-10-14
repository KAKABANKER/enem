const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const {
  pool, initDatabase,
  signToken, authenticate, bcrypt,
  criarTokenEntrega, validarToken
} = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;
const PLUMIFY_PRODUCT_HASH = 'huk4la8duy';
const PLUMIFY_API_TOKEN = '0RRWtMOuHsAQlR7S0zEnlGBnLEnr8DgoDJS3GTecxH7nZr2X01kHo6rxrOGa';
const BASE_URL = 'https://enem-p733.onrender.com/';

app.use(cors({ origin: '*', credentials: true }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

initDatabase();

// ============ PIX (igual ao que já tem) ============
app.post('/api/create-pix', async (req, res) => {
  const { name, email, phone, document, amount, items, coupon, discount } = req.body;

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
      name, email,
      phone_number: phone.replace(/\D/g, ''),
      document: document.replace(/\D/g, ''),
      street_name: 'Rua Exemplo', number: '100', neighborhood: 'Centro',
      city: 'Fortaleza', state: 'CE', zip_code: '60000000'
    },
    cart: [{
      product_hash: PLUMIFY_PRODUCT_HASH,
      title: 'Guia 30 Temas de Redação ENEM',
      price: valorCents, quantity: 1, operation_type: 1, tangible: false
    }],
    expire_in_days: 1,
    transaction_origin: 'api',
    postback_url: `${BASE_URL}/api/webhook/pagamento`
  };

  try {
    const response = await fetch(
      `https://api.plumify.com.br/api/public/v1/transactions?api_token=${PLUMIFY_API_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const data = await response.json();

    if (!data.pix || !data.pix.pix_qr_code) {
      return res.status(400).json({ success: false, message: data.message || 'Erro ao gerar PIX' });
    }

    await pool.query(
      `INSERT INTO orders (transaction_id, name, email, phone, document, amount, status, items, coupon, discount)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        data.hash, name, email,
        phone.replace(/\D/g, ''),
        document.replace(/\D/g, ''),
        (valorCents / 100).toFixed(2),
        JSON.stringify(items || []),
        coupon || null,
        discount || 0
      ]
    ).catch(e => console.error('Erro INSERT order:', e.message));

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

// ============ WEBHOOK ============
app.post('/api/webhook/pagamento', async (req, res) => {
  const { hash, status } = req.body;
  if (status === 'paid' && hash) {
    try {
      await pool.query(
        `UPDATE orders SET status = 'PAID', paid_at = NOW() WHERE transaction_id = $1`,
        [hash]
      );
      console.log('Pedido pago:', hash);
    } catch (err) {
      console.error('Erro webhook:', err.message);
    }
  }
  res.json({ received: true });
});

// ============ STATUS ============
app.get('/api/pix-status', async (req, res) => {
  const { transactionId } = req.query;
  if (!transactionId) return res.status(400).json({ success: false });

  try {
    const r = await pool.query(`SELECT status FROM orders WHERE transaction_id = $1`, [transactionId]);
    if (r.rowCount === 0) return res.status(404).json({ success: false });
    const status = String(r.rows[0].status).toUpperCase();
    return res.json({ success: true, data: { status: status === 'PAID' ? 'PAID' : 'PENDING', transactionId } });
  } catch {
    return res.status(500).json({ success: false });
  }
});

// ============ LEAD (carrinho abandonado) ============
app.post('/api/lead', async (req, res) => {
  const { name, email, phone, document, items, amount } = req.body;
  if (!name || !phone) return res.status(400).json({ success: false });

  try {
    await pool.query(
      `INSERT INTO leads (name, email, phone, document, items, amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        name, email || null, phone.replace(/\D/g, ''),
        document ? document.replace(/\D/g, '') : null,
        JSON.stringify(items || []), amount || 0
      ]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('Erro lead:', err.message);
    return res.status(500).json({ success: false });
  }
});

// ============ ADMIN LOGIN ============
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Dados obrigatórios' });

  try {
    const r = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (r.rowCount === 0) return res.status(401).json({ error: 'Credenciais inválidas' });

    const valid = await bcrypt.compare(password, r.rows[0].senha_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

    await pool.query('UPDATE admin_users SET ultimo_login = NOW() WHERE id = $1', [r.rows[0].id]);
    const token = signToken(r.rows[0]);
    return res.json({ success: true, token, user: {
      id: r.rows[0].id, username: r.rows[0].username,
      nome: r.rows[0].nome, is_master: r.rows[0].is_master
    }});
  } catch {
    return res.status(500).json({ error: 'Erro' });
  }
});

app.get('/api/admin/verify', authenticate, (req, res) => res.json({ valid: true, user: req.user }));

// ============ ADMIN STATS ============
app.get('/api/admin/stats', authenticate, async (req, res) => {
  try {
    const q = async (sql) => (await pool.query(sql)).rows[0];
    const totalOrders = await q('SELECT COUNT(*) AS c FROM orders');
    const paid = await q(`SELECT COUNT(*) AS c FROM orders WHERE status = 'PAID'`);
    const pending = await q(`SELECT COUNT(*) AS c FROM orders WHERE status = 'PENDING'`);
    const totalLeads = await q('SELECT COUNT(*) AS c FROM leads');
    const abandoned = await q(`SELECT COUNT(*) AS c FROM leads WHERE status = 'NEW'`);
    const revenue = await q(`SELECT COALESCE(SUM(amount),0) AS t FROM orders WHERE status = 'PAID'`);
    const today = await q(`SELECT COALESCE(SUM(amount),0) AS t FROM orders WHERE status = 'PAID' AND paid_at >= CURRENT_DATE`);

    return res.json({ success: true, stats: {
      totalOrders: +totalOrders.c, paidOrders: +paid.c, pendingOrders: +pending.c,
      totalLeads: +totalLeads.c, abandonedLeads: +abandoned.c,
      revenue: +revenue.t, todayRevenue: +today.t
    }});
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

// ============ ADMIN ORDERS ============
app.get('/api/admin/orders', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500');
    return res.json({ success: true, orders: r.rows });
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

// ============ ADMIN LEADS ============
app.get('/api/admin/leads', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 500');
    return res.json({ success: true, leads: r.rows });
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/admin/leads/:id', authenticate, async (req, res) => {
  const { status, notes } = req.body;
  try {
    await pool.query(
      `UPDATE leads SET status = COALESCE($1, status), notes = COALESCE($2, notes),
       contacted_at = CASE WHEN $1 = 'CONTACTED' THEN NOW() ELSE contacted_at END
       WHERE id = $3`,
      [status, notes, req.params.id]
    );
    return res.json({ success: true });
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/admin/leads/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

// ============ DELIVER ============
app.post('/api/admin/orders/:id/deliver', authenticate, async (req, res) => {
  try {
    const o = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (o.rowCount === 0) return res.status(404).json({ error: 'Não encontrado' });

    const order = o.rows[0];
    const { token, expiraEm } = await criarTokenEntrega(order.transaction_id, 7);
    await pool.query('UPDATE orders SET delivered_at = NOW() WHERE id = $1', [order.id]);

    return res.json({
      success: true,
      link: `${BASE_URL}/entrega/${token}`,
      expiraEm,
      phone: order.phone,
      name: order.name,
      items: order.items || []
    });
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

// ============ ENTREGA ============
app.get('/api/entrega/:token', async (req, res) => {
  const result = await validarToken(req.params.token);
  if (!result.valid) return res.status(404).json({ success: false, reason: result.reason });

  const o = await pool.query(
    'SELECT name, items, amount FROM orders WHERE transaction_id = $1',
    [result.data.transaction_id]
  );
  if (o.rowCount === 0) return res.status(404).json({ success: false });

  return res.json({ success: true, data: {
    name: o.rows[0].name, items: o.rows[0].items || [], amount: o.rows[0].amount
  }});
});

app.get('/entrega/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'entrega.html'));
});

// ============ PÁGINAS ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'public', 'checkout.html')));
app.get('/sucesso', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sucesso.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/privacidade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacidade.html')));
app.get('/termos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'termos.html')));
app.get('/contato', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contato.html')));

app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Servidor na porta ${PORT}`));
module.exports = app;
