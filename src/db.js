const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ============================================================
// CONEXÃO COM O BANCO
// ============================================================
const DATABASE_URL = 'postgresql://neondb_owner:npg_x8hwKdkAYQ6f@ep-steep-sunset-b67bc19e-pooler.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,           // ← reduz de 5 pra 2
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ============================================================
// JWT
// ============================================================
const JWT_SECRET = 'coloque-aqui-uma-string-longa-aleatoria-min-32-chars';
// Gere uma com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, nome: user.nome, is_master: user.is_master },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ============================================================
// TOKENS DE ENTREGA
// ============================================================
function gerarToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function criarTokenEntrega(transactionId, dias = 7) {
  const token = gerarToken();
  const expira = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO delivery_tokens (token, transaction_id, expira_em) VALUES ($1, $2, $3)`,
    [token, transactionId, expira]
  );
  return { token, expiraEm: expira };
}

async function validarToken(token) {
  const r = await pool.query(`SELECT * FROM delivery_tokens WHERE token = $1`, [token]);
  if (r.rowCount === 0) return { valid: false, reason: 'not_found' };
  if (new Date(r.rows[0].expira_em) < new Date()) return { valid: false, reason: 'expired' };
  return { valid: true, data: r.rows[0] };
}

// ============================================================
// INIT BANCO
// ============================================================
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Pedidos
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(100) UNIQUE,
        name VARCHAR(150), email VARCHAR(150), phone VARCHAR(20), document VARCHAR(20),
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        items JSONB, coupon VARCHAR(20), discount DECIMAL(10,2) DEFAULT 0,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(), paid_at TIMESTAMP
      )
    `);

    // Leads (carrinho abandonado)
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150), email VARCHAR(150), phone VARCHAR(20), document VARCHAR(20),
        items JSONB, amount DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'NEW', notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(), contacted_at TIMESTAMP
      )
    `);

    // Admins
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        nome VARCHAR(100),
        is_master BOOLEAN DEFAULT false,
        ultimo_login TIMESTAMP,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tokens de entrega
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_tokens (
        id SERIAL PRIMARY KEY,
        token VARCHAR(64) UNIQUE NOT NULL,
        transaction_id VARCHAR(100) NOT NULL,
        expira_em TIMESTAMP NOT NULL,
        usado BOOLEAN DEFAULT false,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    // Índices
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_tid ON orders(transaction_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON delivery_tokens(token)`);

    // Admin master padrão
    const check = await client.query(`SELECT * FROM admin_users WHERE username = 'admin'`);
    if (check.rowCount === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await client.query(
        `INSERT INTO admin_users (username, senha_hash, nome, is_master) VALUES ($1, $2, $3, true)`,
        ['admin', hash, 'Administrador']
      );
      console.log('Admin criado: admin / admin123 — TROQUE A SENHA');
    }

    console.log('Banco pronto.');
  } catch (err) {
    console.error('Erro initDatabase:', err.message);
  } finally {
    client.release();
  }
}

module.exports = {
  pool, initDatabase,
  signToken, authenticate, bcrypt,
  criarTokenEntrega, validarToken
};
