const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Cria a tabela de pedidos se não existir
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