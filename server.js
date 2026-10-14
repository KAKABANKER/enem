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
const BASE_URL = 'https://enem-p733.onrender.com';

app.use(cors({ origin: '*', credentials: true }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

initDatabase();

// ============ PIX ============
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

// ============ ADMIN — TROCAR SENHA ============
app.post('/api/admin/change-password', authenticate, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }
  if (novaSenha.length < 8) {
    return res.status(400).json({ error: 'Nova senha precisa ter ao menos 8 caracteres' });
  }

  try {
    const r = await pool.query('SELECT * FROM admin_users WHERE id = $1', [req.user.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    const valid = await bcrypt.compare(senhaAtual, r.rows[0].senha_hash);
    if (!valid) return res.status(401).json({ error: 'Senha atual incorreta' });

    const novoHash = bcrypt.hashSync(novaSenha, 10);
    await pool.query('UPDATE admin_users SET senha_hash = $1 WHERE id = $2', [novoHash, req.user.id]);

    return res.json({ success: true });
  } catch (err) {
    console.error('Erro change-password:', err.message);
    return res.status(500).json({ error: 'Erro' });
  }
});

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

// ============ ADMIN — GRÁFICO (últimos 7 dias) ============
app.get('/api/admin/chart', authenticate, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        paid_at::date AS data,
        COALESCE(SUM(amount), 0) AS total,
        COUNT(*) AS pedidos
      FROM orders
      WHERE status = 'PAID'
        AND paid_at >= NOW() - INTERVAL '7 days'
      GROUP BY paid_at::date
      ORDER BY paid_at::date ASC
    `);

    const map = new Map();
    r.rows.forEach(row => {
      const key = new Date(row.data).toISOString().slice(0, 10);
      map.set(key, { total: parseFloat(row.total), pedidos: parseInt(row.pedidos) });
    });

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const found = map.get(key);
      days.push({
        label,
        date: key,
        total: found ? found.total : 0,
        pedidos: found ? found.pedidos : 0
      });
    }

    return res.json({ success: true, days });
  } catch (err) {
    console.error('Erro chart:', err.message);
    return res.status(500).json({ error: 'Erro' });
  }
});

// ============ ADMIN ORDERS ============
app.get('/api/admin/orders', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500');
    return res.json({ success: true, orders: r.rows });
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/admin/orders/:id', authenticate, async (req, res) => {
  const { status } = req.body;
  const allowed = ['PENDING', 'PAID', 'CANCELLED', 'DELIVERED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    return res.json({ success: true });
  } catch { return res.status(500).json({ error: 'Erro' }); }
});

// ============ ADMIN — MARCAR COMO PAGO ============
app.put('/api/admin/orders/:id/mark-paid', authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE orders SET status = 'PAID', paid_at = NOW()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id, transaction_id, name, email`,
      [req.params.id]
    );
    if (r.rowCount === 0) {
      return res.status(400).json({ error: 'Pedido não encontrado ou já está pago' });
    }
    return res.json({ success: true, order: r.rows[0] });
  } catch (err) {
    console.error('Erro mark-paid:', err.message);
    return res.status(500).json({ error: 'Erro' });
  }
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
