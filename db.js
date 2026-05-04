// Lightweight JSON-file store — no native dependencies required.
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'kitchen.json');

let nextId  = 1;
let store   = { orders: {} };  // id → order object

// ── Persist / Load ────────────────────────────────────────────
function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ nextId, store }, null, 2));
  } catch (_) {}
}

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      nextId = data.nextId || 1;
      store  = data.store  || { orders: {} };
      // Remove completed orders older than 24 h on startup
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [id, o] of Object.entries(store.orders)) {
        if (o.status === 'completed' && new Date(o.completed_at).getTime() < cutoff) {
          delete store.orders[id];
        }
      }
    }
  } catch (_) {}
}

load();

// ── Helpers ───────────────────────────────────────────────────
function now() { return new Date().toISOString(); }

function activeOrders() {
  return Object.values(store.orders)
    .filter(o => o.status !== 'completed')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

// ── Public API ────────────────────────────────────────────────
module.exports = {
  createOrder({ order_number, table_number, server_name, notes, items }) {
    const id    = nextId++;
    const ts    = now();
    const order = {
      id,
      order_number,
      table_number:  table_number  || null,
      server_name:   server_name   || null,
      notes:         notes         || null,
      status:             'new',
      created_at:         ts,
      updated_at:         ts,
      completed_at:       null,
      cutlery_confirmed:  false,
      items: items.map((item, idx) => ({
        id:        id * 1000 + idx + 1,
        order_id:  id,
        name:      item.name,
        quantity:  item.quantity  || 1,
        modifiers: item.modifiers || [],
        notes:     item.notes     || null,
        station:   item.station   || 'küche',
        status:    'pending',
      })),
    };
    store.orders[id] = order;
    save();
    return order;
  },

  getOrder(id) {
    return store.orders[+id] || null;
  },

  getActiveOrders() {
    return activeOrders();
  },

  getOrderHistory(limit = 50) {
    return Object.values(store.orders)
      .filter(o => o.status === 'completed')
      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
      .slice(0, limit);
  },

  updateOrderStatus(id, status) {
    const o = store.orders[+id];
    if (!o) return;
    o.status     = status;
    o.updated_at = now();
    if (status === 'completed') o.completed_at = now();
    save();
  },

  completeOrder(id) {
    this.updateOrderStatus(id, 'completed');
  },

  confirmCutlery(id) {
    const o = store.orders[+id];
    if (!o) return null;
    o.cutlery_confirmed = true;
    o.updated_at = now();
    save();
    return o;
  },

  updateItemStatus(itemId, status) {
    itemId = +itemId;
    for (const o of Object.values(store.orders)) {
      const item = o.items.find(i => i.id === itemId);
      if (item) {
        item.status  = status;
        o.updated_at = now();
        save();
        return;
      }
    }
  },
};
