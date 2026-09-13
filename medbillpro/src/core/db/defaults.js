'use strict';

/** Settings every installation starts with, shared by the desktop and web builds. */
const DEFAULT_SETTINGS = {
  setup_complete: '0',
  store_name: 'My Medical Store',
  store_tagline: 'Chemist & Druggist',
  store_address: '',
  store_city: '',
  store_state: 'Maharashtra',
  store_pincode: '',
  store_phone: '',
  store_email: '',
  store_gstin: '',
  store_dl_no: '',
  store_fssai: '',
  invoice_prefix: 'INV',
  purchase_prefix: 'PUR',
  sale_return_prefix: 'SR',
  purchase_return_prefix: 'PR',
  expiry_alert_days: '90',
  low_stock_enabled: '1',
  default_gst_rate: '12',
  price_includes_gst: '0',
  round_off_invoice: '1',
  print_format: 'a5',
  print_copies: '1',
  invoice_terms: 'Goods once sold will not be taken back without a valid reason. Subject to local jurisdiction.',
  invoice_footer: 'Get well soon — thank you for visiting!',
  rx_reminder_days: '25',
  whatsapp_template: 'Hello {name}, this is a friendly reminder from {store} that your medicines ({medicines}) are due for a refill. Reply to reserve your order.',
  theme: 'light',
  currency_symbol: '₹',
  backup_reminder_days: '7',
  last_backup_at: ''
};

module.exports = { DEFAULT_SETTINGS };
