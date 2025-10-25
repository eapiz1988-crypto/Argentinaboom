// ArgentinaBoom - Server with Admin Panel (Node.js + Express + SQLite)
// Demo rules: users can register freely; admin (credentials in .env) can view users and set balances.
// Admin obtains a JWT via /api/admin/login. Admin routes require token with isAdmin flag.

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'ChangeMe123!';

app.use(cors());
app.use(express.json());

// Initialize SQLite
const dbFile = path.join(__dirname, 'database.sqlite3');
const db = new sqlite3.Database(dbFile);

function runAsync(sql, params=[]) { return new Promise((resolve,reject)=>{ db.run(sql, params, function(err){ if(err) reject(err); else resolve(this); }); }); }
function getAsync(sql, params=[]) { return new Promise((resolve,reject)=>{ db.get(sql, params, (err,row)=>{ if(err) reject(err); else resolve(row); }); }); }
function allAsync(sql, params=[]) { return new Promise((resolve,reject)=>{ db.all(sql, params, (err,rows)=>{ if(err) reject(err); else resolve(rows); }); }); }

async function initDB(){
  await runAsync(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    balance REAL DEFAULT 0,
    approved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  // create admin record in a table if needed (we'll use env for admin login)
}
initDB().catch(console.error);

// Helpers
function rouletteColor(n){ if(n===0) return 'green'; const redSet = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]); return redSet.has(n)?'red':'black'; }

function authMiddleware(req,res,next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: 'No token' });
  const parts = auth.split(' ');
  if(parts.length !== 2) return res.status(401).json({ error: 'Bad authorization header' });
  const token = parts[1];
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  }catch(e){
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req,res,next){
  if(!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// Public routes
app.post('/api/register', async (req,res)=>{
  const { username, password } = req.body || {};
  if(!username || !password) return res.status(400).json({ error: 'username and password required' });
  try{
    const hashed = await bcrypt.hash(password, 10);
    await runAsync('INSERT INTO users (username, password_hash, balance, approved) VALUES (?, ?, ?, ?)', [username, hashed, 0, 0]);
    const user = await getAsync('SELECT id, username, balance, approved FROM users WHERE username = ?', [username]);
    res.json({ user, message: 'Registrado. Esperar aprobación del admin para recibir saldos.' });
  }catch(e){
    if(e && e.message && e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/login', async (req,res)=>{
  const { username, password } = req.body || {};
  if(!username || !password) return res.status(400).json({ error: 'username and password required' });
  try{
    const row = await getAsync('SELECT id, username, password_hash, balance, approved FROM users WHERE username = ?', [username]);
    if(!row) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if(!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: row.id, username: row.username, isAdmin: false }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: row.id, username: row.username, balance: row.balance, approved: !!row.approved }, token });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/me', authMiddleware, async (req,res)=>{
  const id = req.user.id;
  try{
    const row = await getAsync('SELECT id, username, balance, approved FROM users WHERE id = ?', [id]);
    if(!row) return res.status(404).json({ error: 'User not found' });
    res.json({ user: row });
  }catch(e){ res.status(500).json({ error: 'server error' }); }
});

// Spin: only allowed if user is approved by admin
app.post('/api/spin', authMiddleware, async (req,res)=>{
  const id = req.user.id;
  const { bet, choice } = req.body || {};
  const betNum = Number(bet);
  if(!betNum || betNum <= 0) return res.status(400).json({ error: 'Invalid bet' });
  if(!['red','black'].includes(choice)) return res.status(400).json({ error: 'Invalid choice' });

  try{
    const user = await getAsync('SELECT id, balance, approved FROM users WHERE id = ?', [id]);
    if(!user) return res.status(404).json({ error: 'User not found' });
    if(!user.approved) return res.status(403).json({ error: 'Cuenta no aprobada por admin' });
    if(betNum > user.balance) return res.status(400).json({ error: 'Insufficient balance' });

    const number = Math.floor(Math.random() * 37);
    const color = rouletteColor(number);
    let won = false; let payout = 0;
    if(color === choice){ won = true; payout = betNum * 2; }

    const newBalance = Math.round((user.balance + (won ? (payout - betNum) : -betNum)) * 100) / 100;
    await runAsync('UPDATE users SET balance = ? WHERE id = ?', [newBalance, id]);

    res.json({ result: { number, color, won, bet: betNum, payout: won ? payout : 0 }, balance: newBalance });
  }catch(e){ console.error(e); res.status(500).json({ error: 'server error' }); }
});

// Admin auth: returns JWT with isAdmin flag if credentials match env
app.post('/api/admin/login', async (req,res)=>{
  const { username, password } = req.body || {};
  if(!username || !password) return res.status(400).json({ error: 'username and password required' });
  if(username === ADMIN_USER && password === ADMIN_PASS){
    const token = jwt.sign({ id: 0, username: ADMIN_USER, isAdmin: true }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid admin credentials' });
});

// Admin routes
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req,res)=>{
  try{
    const rows = await allAsync('SELECT id, username, balance, approved, created_at FROM users ORDER BY id DESC', []);
    res.json({ users: rows });
  }catch(e){ res.status(500).json({ error: 'server error' }); }
});

// Approve user
app.post('/api/admin/users/:id/approve', authMiddleware, adminMiddleware, async (req,res)=>{
  const id = Number(req.params.id);
  try{
    await runAsync('UPDATE users SET approved = 1 WHERE id = ?', [id]);
    const row = await getAsync('SELECT id, username, balance, approved FROM users WHERE id = ?', [id]);
    res.json({ user: row });
  }catch(e){ res.status(500).json({ error: 'server error' }); }
});

// Set balance
app.post('/api/admin/users/:id/balance', authMiddleware, adminMiddleware, async (req,res)=>{
  const id = Number(req.params.id);
  const { balance } = req.body || {};
  const newBalance = Math.round((Number(balance) || 0) * 100) / 100;
  try{
    await runAsync('UPDATE users SET balance = ? WHERE id = ?', [newBalance, id]);
    const row = await getAsync('SELECT id, username, balance, approved FROM users WHERE id = ?', [id]);
    res.json({ user: row });
  }catch(e){ res.status(500).json({ error: 'server error' }); }
});

// Simple health
app.get('/api/ping', (req,res)=>res.json({ ok: true }));

app.listen(PORT, ()=>{
  console.log(`ArgentinaBoom server listening on http://localhost:${PORT}`);
});
