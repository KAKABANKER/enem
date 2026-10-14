const { Pool } = require('pg');

// ============================================================
// CONEXÃO COM O BANCO — cole sua URL do Neon aqui
// ============================================================
const DATABASE_URL = 'postgresql://neondb_owner:npg_x8hwKdkAYQ6f@ep-steep-sunset-b67bc19e-pooler.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(150),
        email VARCHAR(150),
        phone VARCHAR(20),
        document VARCHAR(20),
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        product VARCHAR(100) DEFAULT 'guia-enem',
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_tid ON orders(transaction_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)
    `);

    console.log('Banco pronto: tabela orders verificada.');
  } catch (err) {
    console.error('Erro ao inicializar banco:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };
