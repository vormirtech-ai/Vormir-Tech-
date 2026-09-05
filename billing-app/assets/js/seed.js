/*  Lavi The Dhawa & Family Restaurant — POS
 *  seed.js — the printed menu, transcribed from the restaurant's menu card.
 *  The three "White Box Specials" sections (Rice, Roti, Paratha) are the
 *  fast-moving items, so they are flagged `popular` and surface first in the POS.
 */
(function (App) {
  'use strict';

  var CATEGORIES = [
    { id: 'rice',    name: 'Rice',        icon: '🍚', popular: true,  sort: 1 },
    { id: 'roti',    name: 'Roti & Papad', icon: '🫓', popular: true,  sort: 2 },
    { id: 'paratha', name: 'Paratha',     icon: '🥞', popular: true,  sort: 3 },
    { id: 'sabzi',   name: 'Sabzi',       icon: '🍲', popular: false, sort: 4 },
    { id: 'paneer',  name: 'Paneer',      icon: '🧀', popular: false, sort: 5 },
    { id: 'nonveg',  name: 'Non-Veg',     icon: '🍗', popular: false, sort: 6 },
    { id: 'nvrice',  name: 'Non-Veg Rice', icon: '🍛', popular: false, sort: 7 },
    { id: 'snacks',  name: 'Snacks',      icon: '🍳', popular: false, sort: 8 },
    { id: 'banwai',  name: 'Banwai',      icon: '🔥', popular: false, sort: 9 },
    { id: 'roast',   name: 'Roast',       icon: '🍖', popular: false, sort: 10 }
  ];

  // [name, cat, variants, note]  — variants: [[label, price], ...]
  var RAW = [
    // ---- White Box Special: Rice (Half / Full) ----
    ['Plain Rice',     'rice', [['Half', 60], ['Full', 100]]],
    ['Steam Rice',     'rice', [['Half', 60], ['Full', 110]]],
    ['Jeera Rice',     'rice', [['Half', 70], ['Full', 120]]],
    ['Afghani Rice',   'rice', [['Half', 80], ['Full', 120]]],
    ['Garlic Rice',    'rice', [['Half', 80], ['Full', 120]]],
    ['Masala Rice',    'rice', [['Half', 80], ['Full', 140]]],
    ['Veg Pulao',      'rice', [['Half', 90], ['Full', 160]]],
    ['Khichdi',        'rice', [['Half', 90], ['Full', 160]]],
    ['Butter Khichdi', 'rice', [['Half', 100], ['Full', 180]]],

    // ---- White Box Special: Roti & Papad ----
    ['Tandoor Roti',        'roti', [['Plate', 15]]],
    ['Tandoor Butter Roti', 'roti', [['Plate', 20]]],
    ['Tawa Roti',           'roti', [['Plate', 15]]],
    ['Tawa Butter Roti',    'roti', [['Plate', 20]]],
    ['Papad Dry',           'roti', [['Plate', 25]]],
    ['Papad Fry',           'roti', [['Plate', 30]]],
    ['Masala Papad',        'roti', [['Plate', 40]]],

    // ---- White Box Special: Paratha ----
    ['Plain Paratha',  'paratha', [['Plate', 40]]],
    ['Aloo Paratha',   'paratha', [['Plate', 60]]],
    ['Gobhi Paratha',  'paratha', [['Plate', 60]]],
    ['Pyaz Paratha',   'paratha', [['Plate', 60]]],
    ['Paneer Paratha', 'paratha', [['Plate', 80]]],

    // ---- Sabzi ----
    ['Plain Dal',      'sabzi', [['Half', 60], ['Full', 100]]],
    ['Jeera Dal',      'sabzi', [['Half', 70], ['Full', 120]]],
    ['Dal Fry',        'sabzi', [['Half', 70], ['Full', 120]]],
    ['Dal Tadka',      'sabzi', [['Half', 80], ['Full', 140]]],
    ['Sev Bhaji',      'sabzi', [['Half', 80], ['Full', 140]]],
    ['Sev Tomato',     'sabzi', [['Half', 80], ['Full', 140]]],
    ['Sev Masala',     'sabzi', [['Half', 80], ['Full', 140]]],
    ['Chana Masala',   'sabzi', [['Half', 80], ['Full', 140]]],
    ['Aloo Matar',     'sabzi', [['Half', 80], ['Full', 140]]],
    ['Aloo Chhole',    'sabzi', [['Half', 80], ['Full', 140]]],
    ['Chhole Masala',  'sabzi', [['Half', 80], ['Full', 140]]],
    ['Aloo Gobhi',     'sabzi', [['Half', 80], ['Full', 140]]],
    ['Gobhi Masala',   'sabzi', [['Half', 80], ['Full', 140]]],
    ['Jeera Aloo',     'sabzi', [['Half', 80], ['Full', 140]]],
    ['Aloo Palak',     'sabzi', [['Half', 80], ['Full', 140]]],
    ['Bhindi Fry',     'sabzi', [['Half', 80], ['Full', 140]]],
    ['Bhindi Masala',  'sabzi', [['Half', 80], ['Full', 140]]],
    ['Tamatar Chatni', 'sabzi', [['Half', 90], ['Full', 160]]],
    ['Mix Veg',        'sabzi', [['Half', 90], ['Full', 160]]],

    // ---- Paneer ----
    ['Paneer Masala', 'paneer', [['Half', 140], ['Full', 240]]],
    ['Matar Paneer',  'paneer', [['Half', 140], ['Full', 240]]],
    ['Butter Paneer', 'paneer', [['Half', 150], ['Full', 260]]],
    ['Shahi Paneer',  'paneer', [['Half', 150], ['Full', 260]]],
    ['Kadhai Paneer', 'paneer', [['Half', 150], ['Full', 260]]],

    // ---- Non-Veg ----
    ['Anda Curry',      'nonveg', [['Half', 80], ['Full', 140]]],
    ['Anda Masala',     'nonveg', [['Half', 90], ['Full', 160]]],
    ['Bhurji Curry',    'nonveg', [['Half', 90], ['Full', 160]]],
    ['Chicken Fry',     'nonveg', [['Full', 240]]],
    ['Chicken Curry',   'nonveg', [['Half', 140], ['Full', 260]]],
    ['Chicken Masala',  'nonveg', [['Half', 150], ['Full', 260]]],
    ['Butter Chicken',  'nonveg', [['Half', 160], ['Full', 280]]],
    ['Chicken Latpata', 'nonveg', [['Half', 150], ['Full', 260]]],
    ['Machhli Curry',   'nonveg', [['Half', 140], ['Full', 260]]],
    ['Machhli Masala',  'nonveg', [['Half', 150], ['Full', 260]]],
    ['Machhli Fry',     'nonveg', [['Full', 240]]],

    // ---- Non-Veg Rice ----
    ['Anda Rice',    'nvrice', [['Half', 90], ['Full', 160]]],
    ['Mughlai Rice', 'nvrice', [['Half', 100], ['Full', 180]]],
    ['Chicken Rice', 'nvrice', [['Half', 150], ['Full', 280]]],

    // ---- Snacks ----
    ['Anda Fry',        'snacks', [['Plate', 25]]],
    ['Anda Bhurji',     'snacks', [['Plate', 80]]],
    ['Anda Omelet',     'snacks', [['Plate', 80]]],
    ['Chicken Fry',     'snacks', [['Plate', 240]]],
    ['Chicken Latpata', 'snacks', [['Plate', 260]]],
    ['Machhli Fry',     'snacks', [['Plate', 240]]],

    // ---- Banwai (Tari / Masala) ----
    ['Chicken Banwai 1/2 Kilo',        'banwai', [['Tari', 250], ['Masala', 300]], '2 Plate'],
    ['Chicken Banwai (Boiler) 1 Kilo', 'banwai', [['Tari', 350], ['Masala', 400]], '3 Plate'],
    ['Chicken Banwai 1 Kilo',          'banwai', [['Tari', 400], ['Masala', 450]], '3 Plate'],
    ['Machhli Banwai 1 Kilo',          'banwai', [['Tari', 350], ['Masala', 400]], '3 Plate'],
    ['Mutton Banwai 1 Kilo',           'banwai', [['Tari', 450], ['Masala', 500]], '3 Plate'],

    // ---- Roast ----
    ['Machhli Roast', 'roast', [['1 Kilo', 350]]],
    ['Chicken Roast', 'roast', [['1 Kilo', 350]]]
  ];

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function buildItems() {
    var popularCats = {};
    CATEGORIES.forEach(function (c) { if (c.popular) popularCats[c.id] = true; });

    return RAW.map(function (row, index) {
      var name = row[0], cat = row[1], variants = row[2], note = row[3] || '';
      return {
        id: cat + '-' + slug(name),
        name: name,
        cat: cat,
        note: note,
        popular: !!popularCats[cat],
        active: true,
        sort: index + 1,
        variants: variants.map(function (v) { return { label: v[0], price: v[1] }; })
      };
    });
  }

  // A small starter pantry so the inventory module is useful from minute one.
  var INVENTORY = [
    ['Rice (Basmati)', 'Grocery', 'kg', 50, 15, 62],
    ['Atta',           'Grocery', 'kg', 40, 15, 38],
    ['Toor Dal',       'Grocery', 'kg', 20, 6,  120],
    ['Paneer',         'Dairy',   'kg', 5,  2,  340],
    ['Butter',         'Dairy',   'kg', 4,  1,  520],
    ['Milk',           'Dairy',   'ltr', 15, 5,  56],
    ['Chicken',        'Meat',    'kg', 12, 5,  210],
    ['Mutton',         'Meat',    'kg', 5,  2,  700],
    ['Fish (Machhli)', 'Meat',    'kg', 6,  2,  260],
    ['Eggs (Anda)',    'Meat',    'pcs', 90, 30, 7],
    ['Onion (Pyaz)',   'Vegetable', 'kg', 30, 10, 32],
    ['Tomato',         'Vegetable', 'kg', 20, 8,  30],
    ['Potato (Aloo)',  'Vegetable', 'kg', 30, 10, 26],
    ['Gobhi',          'Vegetable', 'kg', 12, 4,  35],
    ['Bhindi',         'Vegetable', 'kg', 8,  3,  45],
    ['Palak',          'Vegetable', 'kg', 6,  2,  30],
    ['Green Peas (Matar)', 'Vegetable', 'kg', 8, 3, 60],
    ['Cooking Oil',    'Grocery', 'ltr', 25, 8,  135],
    ['Ghee',           'Grocery', 'kg', 6,  2,  620],
    ['Papad',          'Grocery', 'pkt', 24, 8,  55],
    ['LPG Cylinder',   'Fuel',    'pcs', 3,  1,  1850],
    ['Cumin (Jeera)',  'Spice',   'kg', 3,  1,  380],
    ['Garam Masala',   'Spice',   'kg', 2,  1,  450],
    ['Red Chilli Powder', 'Spice', 'kg', 4, 1,  260],
    ['Turmeric',       'Spice',   'kg', 2,  1,  240],
    ['Salt',           'Spice',   'kg', 10, 3,  22]
  ];

  function buildInventory() {
    return INVENTORY.map(function (r, i) {
      return {
        id: 'inv-' + slug(r[0]),
        name: r[0], cat: r[1], unit: r[2],
        stock: r[3], min: r[4], cost: r[5],
        supplier: '', active: true, sort: i + 1,
        updatedAt: Date.now()
      };
    });
  }

  App.Seed = {
    categories: CATEGORIES,
    slug: slug,
    menu: buildItems,
    inventory: buildInventory
  };
})(window.App = window.App || {});
