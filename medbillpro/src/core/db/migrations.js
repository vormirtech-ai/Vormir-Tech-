'use strict';

/**
 * Migrations are applied in order and tracked with SQLite's `user_version`.
 * Never edit a migration that has shipped — append a new one instead.
 */
const migrations = [
  {
    version: 1,
    name: 'initial-schema',
    up(db) {
      db.exec(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE counters (
          name  TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE users (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          username   TEXT NOT NULL UNIQUE,
          name       TEXT NOT NULL,
          role       TEXT NOT NULL DEFAULT 'cashier',
          pass_hash  TEXT NOT NULL,
          pass_salt  TEXT NOT NULL,
          active     INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );

        CREATE TABLE audit_log (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          at        TEXT NOT NULL,
          user_id   INTEGER,
          username  TEXT,
          action    TEXT NOT NULL,
          entity    TEXT,
          entity_id TEXT,
          detail    TEXT
        );
        CREATE INDEX idx_audit_at ON audit_log(at DESC);

        CREATE TABLE products (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT NOT NULL,
          generic       TEXT DEFAULT '',
          manufacturer  TEXT DEFAULT '',
          category      TEXT DEFAULT 'Medicine',
          hsn           TEXT DEFAULT '3004',
          gst_rate      REAL NOT NULL DEFAULT 12,
          pack_size     INTEGER NOT NULL DEFAULT 1,
          pack_label    TEXT NOT NULL DEFAULT 'Strip',
          unit_label    TEXT NOT NULL DEFAULT 'Tablet',
          allow_loose   INTEGER NOT NULL DEFAULT 1,
          rack          TEXT DEFAULT '',
          schedule_type TEXT DEFAULT 'General',
          reorder_level INTEGER NOT NULL DEFAULT 0,
          active        INTEGER NOT NULL DEFAULT 1,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );
        CREATE INDEX idx_products_name ON products(name);
        CREATE INDEX idx_products_generic ON products(generic);

        CREATE TABLE batches (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          batch_no      TEXT NOT NULL,
          expiry        TEXT NOT NULL,
          mrp           REAL NOT NULL DEFAULT 0,
          rate_per_unit REAL NOT NULL DEFAULT 0,
          qty_units     INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL,
          UNIQUE (product_id, batch_no, expiry)
        );
        CREATE INDEX idx_batches_product ON batches(product_id);
        CREATE INDEX idx_batches_expiry ON batches(expiry);

        CREATE TABLE customers (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT NOT NULL,
          phone           TEXT DEFAULT '',
          email           TEXT DEFAULT '',
          address         TEXT DEFAULT '',
          gstin           TEXT DEFAULT '',
          dob             TEXT,
          notes           TEXT DEFAULT '',
          opening_balance REAL NOT NULL DEFAULT 0,
          active          INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL
        );
        CREATE INDEX idx_customers_name ON customers(name);
        CREATE INDEX idx_customers_phone ON customers(phone);

        CREATE TABLE doctors (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          name           TEXT NOT NULL,
          phone          TEXT DEFAULT '',
          clinic         TEXT DEFAULT '',
          reg_no         TEXT DEFAULT '',
          commission_pct REAL NOT NULL DEFAULT 0,
          active         INTEGER NOT NULL DEFAULT 1,
          created_at     TEXT NOT NULL
        );

        CREATE TABLE suppliers (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT NOT NULL,
          phone           TEXT DEFAULT '',
          email           TEXT DEFAULT '',
          address         TEXT DEFAULT '',
          gstin           TEXT DEFAULT '',
          dl_no           TEXT DEFAULT '',
          opening_balance REAL NOT NULL DEFAULT 0,
          active          INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL
        );
        CREATE INDEX idx_suppliers_name ON suppliers(name);

        CREATE TABLE purchases (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          no          TEXT NOT NULL UNIQUE,
          date        TEXT NOT NULL,
          supplier_id INTEGER REFERENCES suppliers(id),
          ref_no      TEXT DEFAULT '',
          inter_state INTEGER NOT NULL DEFAULT 0,
          subtotal    REAL NOT NULL DEFAULT 0,
          discount    REAL NOT NULL DEFAULT 0,
          gst_amount  REAL NOT NULL DEFAULT 0,
          round_off   REAL NOT NULL DEFAULT 0,
          total       REAL NOT NULL DEFAULT 0,
          paid        REAL NOT NULL DEFAULT 0,
          notes       TEXT DEFAULT '',
          created_at  TEXT NOT NULL,
          created_by  TEXT DEFAULT ''
        );
        CREATE INDEX idx_purchases_date ON purchases(date);

        CREATE TABLE purchase_items (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_id   INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
          product_id    INTEGER NOT NULL REFERENCES products(id),
          batch_id      INTEGER REFERENCES batches(id),
          name          TEXT NOT NULL,
          batch_no      TEXT NOT NULL,
          expiry        TEXT NOT NULL,
          mrp           REAL NOT NULL DEFAULT 0,
          qty_units     INTEGER NOT NULL DEFAULT 0,
          free_units    INTEGER NOT NULL DEFAULT 0,
          rate_per_unit REAL NOT NULL DEFAULT 0,
          disc_pct      REAL NOT NULL DEFAULT 0,
          gst_rate      REAL NOT NULL DEFAULT 0,
          taxable       REAL NOT NULL DEFAULT 0,
          gst_amount    REAL NOT NULL DEFAULT 0,
          total         REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_pitems_purchase ON purchase_items(purchase_id);

        CREATE TABLE sales (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          no            TEXT NOT NULL UNIQUE,
          date          TEXT NOT NULL,
          customer_id   INTEGER REFERENCES customers(id),
          doctor_id     INTEGER REFERENCES doctors(id),
          patient_name  TEXT DEFAULT '',
          patient_phone TEXT DEFAULT '',
          rx_no         TEXT DEFAULT '',
          inter_state   INTEGER NOT NULL DEFAULT 0,
          subtotal      REAL NOT NULL DEFAULT 0,
          discount      REAL NOT NULL DEFAULT 0,
          gst_amount    REAL NOT NULL DEFAULT 0,
          round_off     REAL NOT NULL DEFAULT 0,
          total         REAL NOT NULL DEFAULT 0,
          paid          REAL NOT NULL DEFAULT 0,
          payment_mode  TEXT NOT NULL DEFAULT 'Cash',
          cost_total    REAL NOT NULL DEFAULT 0,
          notes         TEXT DEFAULT '',
          created_at    TEXT NOT NULL,
          created_by    TEXT DEFAULT ''
        );
        CREATE INDEX idx_sales_date ON sales(date);
        CREATE INDEX idx_sales_customer ON sales(customer_id);

        CREATE TABLE sale_items (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          product_id    INTEGER NOT NULL REFERENCES products(id),
          batch_id      INTEGER REFERENCES batches(id),
          name          TEXT NOT NULL,
          batch_no      TEXT NOT NULL,
          expiry        TEXT NOT NULL,
          hsn           TEXT DEFAULT '',
          mrp           REAL NOT NULL DEFAULT 0,
          qty_units     INTEGER NOT NULL DEFAULT 0,
          returned_units INTEGER NOT NULL DEFAULT 0,
          rate_per_unit REAL NOT NULL DEFAULT 0,
          disc_pct      REAL NOT NULL DEFAULT 0,
          gst_rate      REAL NOT NULL DEFAULT 0,
          taxable       REAL NOT NULL DEFAULT 0,
          cgst          REAL NOT NULL DEFAULT 0,
          sgst          REAL NOT NULL DEFAULT 0,
          igst          REAL NOT NULL DEFAULT 0,
          total         REAL NOT NULL DEFAULT 0,
          cost_per_unit REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_sitems_sale ON sale_items(sale_id);
        CREATE INDEX idx_sitems_product ON sale_items(product_id);

        CREATE TABLE sale_returns (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          no          TEXT NOT NULL UNIQUE,
          date        TEXT NOT NULL,
          sale_id     INTEGER REFERENCES sales(id),
          customer_id INTEGER REFERENCES customers(id),
          subtotal    REAL NOT NULL DEFAULT 0,
          gst_amount  REAL NOT NULL DEFAULT 0,
          total       REAL NOT NULL DEFAULT 0,
          refund_mode TEXT NOT NULL DEFAULT 'Cash',
          notes       TEXT DEFAULT '',
          created_at  TEXT NOT NULL,
          created_by  TEXT DEFAULT ''
        );
        CREATE INDEX idx_sreturns_date ON sale_returns(date);

        CREATE TABLE sale_return_items (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          return_id     INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
          sale_item_id  INTEGER REFERENCES sale_items(id),
          product_id    INTEGER NOT NULL REFERENCES products(id),
          batch_id      INTEGER REFERENCES batches(id),
          name          TEXT NOT NULL,
          batch_no      TEXT DEFAULT '',
          expiry        TEXT DEFAULT '',
          qty_units     INTEGER NOT NULL DEFAULT 0,
          rate_per_unit REAL NOT NULL DEFAULT 0,
          gst_rate      REAL NOT NULL DEFAULT 0,
          taxable       REAL NOT NULL DEFAULT 0,
          gst_amount    REAL NOT NULL DEFAULT 0,
          total         REAL NOT NULL DEFAULT 0,
          restock       INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE purchase_returns (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          no          TEXT NOT NULL UNIQUE,
          date        TEXT NOT NULL,
          purchase_id INTEGER REFERENCES purchases(id),
          supplier_id INTEGER REFERENCES suppliers(id),
          subtotal    REAL NOT NULL DEFAULT 0,
          gst_amount  REAL NOT NULL DEFAULT 0,
          total       REAL NOT NULL DEFAULT 0,
          reason      TEXT DEFAULT '',
          notes       TEXT DEFAULT '',
          created_at  TEXT NOT NULL,
          created_by  TEXT DEFAULT ''
        );

        CREATE TABLE purchase_return_items (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          return_id     INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
          product_id    INTEGER NOT NULL REFERENCES products(id),
          batch_id      INTEGER REFERENCES batches(id),
          name          TEXT NOT NULL,
          batch_no      TEXT DEFAULT '',
          expiry        TEXT DEFAULT '',
          qty_units     INTEGER NOT NULL DEFAULT 0,
          rate_per_unit REAL NOT NULL DEFAULT 0,
          gst_rate      REAL NOT NULL DEFAULT 0,
          taxable       REAL NOT NULL DEFAULT 0,
          gst_amount    REAL NOT NULL DEFAULT 0,
          total         REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE payments (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          date        TEXT NOT NULL,
          party_type  TEXT NOT NULL,
          party_id    INTEGER,
          party_name  TEXT DEFAULT '',
          direction   TEXT NOT NULL,
          amount      REAL NOT NULL DEFAULT 0,
          mode        TEXT NOT NULL DEFAULT 'Cash',
          account     TEXT NOT NULL DEFAULT 'cash',
          ref_no      TEXT DEFAULT '',
          sale_id     INTEGER REFERENCES sales(id),
          purchase_id INTEGER REFERENCES purchases(id),
          notes       TEXT DEFAULT '',
          created_at  TEXT NOT NULL,
          created_by  TEXT DEFAULT ''
        );
        CREATE INDEX idx_payments_date ON payments(date);
        CREATE INDEX idx_payments_party ON payments(party_type, party_id);

        CREATE TABLE expenses (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          date       TEXT NOT NULL,
          category   TEXT NOT NULL DEFAULT 'General',
          payee      TEXT DEFAULT '',
          amount     REAL NOT NULL DEFAULT 0,
          account    TEXT NOT NULL DEFAULT 'cash',
          notes      TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          created_by TEXT DEFAULT ''
        );
        CREATE INDEX idx_expenses_date ON expenses(date);

        CREATE TABLE ledger (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          date        TEXT NOT NULL,
          account     TEXT NOT NULL,
          direction   TEXT NOT NULL,
          amount      REAL NOT NULL DEFAULT 0,
          source_type TEXT NOT NULL,
          source_id   INTEGER,
          description TEXT DEFAULT '',
          created_at  TEXT NOT NULL
        );
        CREATE INDEX idx_ledger_date ON ledger(date);
        CREATE INDEX idx_ledger_source ON ledger(source_type, source_id);

        CREATE TABLE stock_adjustments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          date       TEXT NOT NULL,
          batch_id   INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id),
          qty_units  INTEGER NOT NULL DEFAULT 0,
          reason     TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          created_by TEXT DEFAULT ''
        );

        CREATE TABLE rx_reminders (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          sale_id     INTEGER REFERENCES sales(id) ON DELETE SET NULL,
          due_date    TEXT NOT NULL,
          medicines   TEXT DEFAULT '',
          note        TEXT DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'pending',
          sent_at     TEXT,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX idx_rx_due ON rx_reminders(status, due_date);

        CREATE TABLE doctor_commissions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          date        TEXT NOT NULL,
          doctor_id   INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
          sale_id     INTEGER REFERENCES sales(id) ON DELETE CASCADE,
          base_amount REAL NOT NULL DEFAULT 0,
          pct         REAL NOT NULL DEFAULT 0,
          amount      REAL NOT NULL DEFAULT 0,
          paid        INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX idx_dcomm_doctor ON doctor_commissions(doctor_id);
      `);
    }
  }
];

module.exports = migrations;
