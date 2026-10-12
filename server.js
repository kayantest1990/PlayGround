const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'shoes.json');

app.use(cors());
app.use(express.json());

// Static storefront (built output lives in PROJECT_DIR/public)
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ---------- Persistence (JSON file, falls back to in-memory) ----------
function loadShoes() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read data file, using in-memory seed:', err.message);
  }
  return seedShoes();
}

function saveShoes() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(shoes, null, 2));
  } catch (err) {
    console.error('Failed to persist data file:', err.message);
  }
}

function seedShoes() {
  return [
    {
      id: '1',
      name: 'Air Runner',
      brand: 'Nike',
      price: 129.99,
      sizes: [40, 41, 42, 43, 44],
      color: 'Black',
      stock: 25,
      category: 'running',
      description: 'Lightweight running shoes with breathable mesh.',
      imageUrl: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '2',
      name: 'Classic Leather',
      brand: 'Reebok',
      price: 89.99,
      sizes: [39, 40, 41, 42],
      color: 'White',
      stock: 40,
      category: 'casual',
      description: 'Timeless casual sneakers in full-grain leather.',
      imageUrl: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: '3',
      name: 'Ultra Boost Trail',
      brand: 'Adidas',
      price: 159.99,
      sizes: [42, 43, 44, 45],
      color: 'Grey',
      stock: 15,
      category: 'trail',
      description: 'Grippy trail shoes for all-terrain runs.',
      imageUrl: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}

let shoes = loadShoes();
let nextId =
  shoes.reduce((max, s) => Math.max(max, parseInt(s.id, 10) || 0), 0) + 1;

// ---------- Validation ----------
function validateShoe(data, { partial = false } = {}) {
  const errors = [];

  const check = (field, fn) => {
    if (partial && data[field] === undefined) return;
    const err = fn(data[field]);
    if (err) errors.push(`${field}: ${err}`);
  };

  check('name', (v) =>
    typeof v !== 'string' || !v.trim() ? 'required non-empty string' : null
  );
  check('brand', (v) =>
    typeof v !== 'string' || !v.trim() ? 'required non-empty string' : null
  );
  check('price', (v) =>
    typeof v !== 'number' || Number.isNaN(v) || v < 0
      ? 'required non-negative number'
      : null
  );
  check('sizes', (v) =>
    !Array.isArray(v) || v.length === 0 || !v.every((n) => typeof n === 'number')
      ? 'required non-empty array of numbers'
      : null
  );
  check('stock', (v) =>
    v !== undefined && (!Number.isInteger(v) || v < 0)
      ? 'must be a non-negative integer'
      : null
  );
  check('color', (v) =>
    v !== undefined && (typeof v !== 'string' || !v.trim())
      ? 'must be a non-empty string'
      : null
  );
  check('category', (v) =>
    v !== undefined && (typeof v !== 'string' || !v.trim())
      ? 'must be a non-empty string'
      : null
  );

  return errors;
}

// ---------- Routes ----------

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', count: shoes.length });
});

// List + filter + search + pagination
// GET /api/shoes?brand=Nike&category=running&minPrice=50&maxPrice=150&q=air&page=1&limit=10&sort=price
app.get('/api/shoes', (req, res) => {
  let result = [...shoes];
  const { brand, category, color, minPrice, maxPrice, q, sort, page, limit } =
    req.query;

  if (brand)
    result = result.filter((s) =>
      s.brand.toLowerCase().includes(String(brand).toLowerCase())
    );
  if (category)
    result = result.filter(
      (s) => (s.category || '').toLowerCase() === String(category).toLowerCase()
    );
  if (color)
    result = result.filter((s) =>
      (s.color || '').toLowerCase().includes(String(color).toLowerCase())
    );
  if (minPrice !== undefined)
    result = result.filter((s) => s.price >= Number(minPrice));
  if (maxPrice !== undefined)
    result = result.filter((s) => s.price <= Number(maxPrice));
  if (q) {
    const needle = String(q).toLowerCase();
    result = result.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.brand.toLowerCase().includes(needle) ||
        (s.description || '').toLowerCase().includes(needle)
    );
  }

  if (sort === 'price') result.sort((a, b) => a.price - b.price);
  if (sort === '-price') result.sort((a, b) => b.price - a.price);
  if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name));

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const total = result.length;
  const start = (pageNum - 1) * limitNum;
  const data = result.slice(start, start + limitNum);

  res.json({ total, page: pageNum, limit: limitNum, data });
});

// Get one
app.get('/api/shoes/:id', (req, res) => {
  const shoe = shoes.find((s) => s.id === req.params.id);
  if (!shoe) return res.status(404).json({ error: 'Shoe not found' });
  res.json(shoe);
});

// Create
app.post('/api/shoes', (req, res) => {
  const errors = validateShoe(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const now = new Date().toISOString();
  const shoe = {
    id: String(nextId++),
    name: req.body.name.trim(),
    brand: req.body.brand.trim(),
    price: req.body.price,
    sizes: req.body.sizes,
    color: req.body.color || '',
    stock: req.body.stock ?? 0,
    category: req.body.category || 'casual',
    description: req.body.description || '',
    imageUrl: req.body.imageUrl || '',
    createdAt: now,
    updatedAt: now,
  };
  shoes.push(shoe);
  saveShoes();
  res.status(201).json(shoe);
});

// Full replace
app.put('/api/shoes/:id', (req, res) => {
  const idx = shoes.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Shoe not found' });

  const errors = validateShoe(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const now = new Date().toISOString();
  shoes[idx] = {
    id: shoes[idx].id,
    name: req.body.name.trim(),
    brand: req.body.brand.trim(),
    price: req.body.price,
    sizes: req.body.sizes,
    color: req.body.color || '',
    stock: req.body.stock ?? 0,
    category: req.body.category || 'casual',
    description: req.body.description || '',
    imageUrl: req.body.imageUrl || '',
    createdAt: shoes[idx].createdAt,
    updatedAt: now,
  };
  saveShoes();
  res.json(shoes[idx]);
});

// Partial update
app.patch('/api/shoes/:id', (req, res) => {
  const shoe = shoes.find((s) => s.id === req.params.id);
  if (!shoe) return res.status(404).json({ error: 'Shoe not found' });

  const errors = validateShoe(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ errors });

  for (const key of [
    'name',
    'brand',
    'price',
    'sizes',
    'color',
    'stock',
    'category',
    'description',
    'imageUrl',
  ]) {
    if (req.body[key] !== undefined) {
      shoe[key] =
        typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
    }
  }
  shoe.updatedAt = new Date().toISOString();
  saveShoes();
  res.json(shoe);
});

// Delete
app.delete('/api/shoes/:id', (req, res) => {
  const idx = shoes.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Shoe not found' });
  const [deleted] = shoes.splice(idx, 1);
  saveShoes();
  res.json({ message: 'Shoe deleted', shoe: deleted });
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Root: storefront when available, otherwise API info
app.get('/', (req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.json({
    name: 'Shoes Store API',
    version: '1.0.0',
    endpoints: [
      'GET    /health',
      'GET    /api/shoes',
      'GET    /api/shoes/:id',
      'POST   /api/shoes',
      'PUT    /api/shoes/:id',
      'PATCH  /api/shoes/:id',
      'DELETE /api/shoes/:id',
    ],
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Shoes Store API running on http://localhost:${PORT}`);
  });
}

module.exports = app;
