const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');
const db       = require('./db');
const settings = require('./settings');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Allow cross-origin requests so the POS system can reach this API from any port/host
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── WebSocket ────────────────────────────────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'init', orders: db.getActiveOrders(), settings: settings.get() }));
});

// ── REST API ─────────────────────────────────────────────────────────────────

// GET /api/settings
app.get('/api/settings', (_req, res) => res.json(settings.get()));

// PUT /api/settings
app.put('/api/settings', (req, res) => {
  const updated = settings.set(req.body);
  broadcast({ type: 'settings_updated', settings: updated });
  res.json(updated);
});

// GET /api/stats
app.get('/api/stats', (_req, res) => {
  const today   = new Date().toISOString().split('T')[0];
  const history = db.getOrderHistory(500);
  const active  = db.getActiveOrders();
  const done    = history.filter(o => o.completed_at?.startsWith(today));

  let avgMin = null;
  if (done.length) {
    const ms = done.reduce((s, o) => s + (new Date(o.completed_at) - new Date(o.created_at)), 0);
    avgMin = Math.round(ms / done.length / 60000);
  }

  const hourly = new Array(24).fill(0);
  done.forEach(o => { hourly[new Date(o.created_at).getHours()]++; });

  res.json({ today: { completed: done.length, avgMinutes: avgMin }, active: active.length, ready: active.filter(o => o.status === 'ready').length, hourly });
});

// GET /api/orders/history  (must be defined before /:id)
app.get('/api/orders/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  res.json(db.getOrderHistory(limit));
});

// GET /api/orders
app.get('/api/orders', (_req, res) => {
  res.json(db.getActiveOrders());
});

// POST /api/orders  ← POS system calls this to create a new order
//
// Body: {
//   order_number : string  (required)
//   table_number : string
//   server_name  : string
//   notes        : string  (e.g. allergies)
//   items: [{
//     name      : string  (required)
//     quantity  : number
//     modifiers : string[]  (e.g. ["ohne Zwiebeln"])
//     notes     : string
//     station   : string   ("küche" | "grill" | "cold" | "bar" | "dessert")
//   }]
// }
app.post('/api/orders', (req, res) => {
  const { order_number, table_number, server_name, notes, items } = req.body;

  if (!order_number)        return res.status(400).json({ error: 'order_number ist erforderlich' });
  if (!items?.length)       return res.status(400).json({ error: 'items ist erforderlich und darf nicht leer sein' });
  if (!items.every(i => i.name)) return res.status(400).json({ error: 'Jede Position muss einen Namen haben' });

  try {
    const order = db.createOrder({ order_number, table_number, server_name, notes, items });
    broadcast({ type: 'order_new', order });
    res.status(201).json(order);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/orders/:id/status
app.patch('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const valid = ['new', 'in_progress', 'almost_ready', 'ready', 'completed'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });

  db.updateOrderStatus(req.params.id, status);

  if (status === 'completed') {
    broadcast({ type: 'order_completed', orderId: +req.params.id });
    return res.json({ success: true });
  }

  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });

  broadcast({ type: 'order_updated', order });
  res.json(order);
});

// PATCH /api/orders/:orderId/items/:itemId/status
app.patch('/api/orders/:orderId/items/:itemId/status', (req, res) => {
  const { status } = req.body;
  if (!['pending', 'done'].includes(status)) {
    return res.status(400).json({ error: 'Status muss "pending" oder "done" sein' });
  }

  db.updateItemStatus(req.params.itemId, status);

  const order = db.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });

  const allDone = order.items.every(i => i.status === 'done');
  const anyDone = order.items.some(i => i.status === 'done');

  let newOrderStatus = order.status;
  if (allDone) {
    newOrderStatus = 'ready';
  } else if (anyDone) {
    newOrderStatus = 'in_progress';
  } else {
    newOrderStatus = 'new';
  }

  if (newOrderStatus !== order.status) {
    db.updateOrderStatus(req.params.orderId, newOrderStatus);
    order.status = newOrderStatus;
  }

  broadcast({ type: 'order_updated', order });
  res.json(order);
});

// PATCH /api/orders/:id/cutlery  (waiter confirms cutlery is set)
app.patch('/api/orders/:id/cutlery', (req, res) => {
  const order = db.confirmCutlery(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });
  broadcast({ type: 'order_updated', order });
  res.json(order);
});

// DELETE /api/orders/:id  (complete / bump off screen)
app.delete('/api/orders/:id', (req, res) => {
  db.completeOrder(req.params.id);
  broadcast({ type: 'order_completed', orderId: +req.params.id });
  res.json({ success: true });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      Kitchen Display System (KDS)      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n  Server:           http://localhost:${PORT}`);
  console.log(`  Küchen-Display:   http://localhost:${PORT}/kitchen.html`);
  console.log(`  POS Demo:         http://localhost:${PORT}/pos-demo.html`);
  console.log(`  API Basis-URL:    http://localhost:${PORT}/api\n`);
});
