const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'settings.json');

const DEFAULTS = {
  restaurant: { name: 'Mein Restaurant', logo: '🍳' },
  kitchen: { urgencyYellow: 5, urgencyOrange: 10, urgencyRed: 15, sound: true },
  ausgabe: { urgencyYellow: 2, urgencyOrange: 5,  urgencyRed: 8,  sound: true },
  stations: [
    { id: 'küche',   label: 'Küche',   color: '#448aff' },
    { id: 'grill',   label: 'Grill',   color: '#ff7043' },
    { id: 'cold',    label: 'Kalt',    color: '#00b0ff' },
    { id: 'bar',     label: 'Bar',     color: '#9c6eff' },
    { id: 'dessert', label: 'Dessert', color: '#f06292' },
  ],
};

let current = (() => {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULTS));
})();

module.exports = {
  get()     { return current; },
  set(data) { current = data; fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); return current; },
  DEFAULTS,
};
