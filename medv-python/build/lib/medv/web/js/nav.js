export const NAV = [
  {
    group: 'Daily work',
    items: [
      { hash: '#/dashboard', label: 'Dashboard', icon: 'dashboard', key: 'Ctrl+1' },
      { hash: '#/billing', label: 'New Bill', icon: 'billing', key: 'F2' },
      { hash: '#/sales', label: 'Bills', icon: 'list' },
      { hash: '#/returns', label: 'Returns', icon: 'returns' }
    ]
  },
  {
    group: 'Inventory',
    items: [
      { hash: '#/products', label: 'Medicines', icon: 'pill' },
      { hash: '#/stock', label: 'Stock & Expiry', icon: 'package', badge: 'stockAlerts' },
      { hash: '#/purchases', label: 'Purchases', icon: 'truck', key: 'F4' }
    ]
  },
  {
    group: 'People',
    items: [
      { hash: '#/customers', label: 'Patients', icon: 'users' },
      { hash: '#/doctors', label: 'Doctors', icon: 'doctor' },
      { hash: '#/suppliers', label: 'Suppliers', icon: 'supplier' }
    ]
  },
  {
    group: 'Money',
    items: [
      { hash: '#/money', label: 'Cash & Bank', icon: 'wallet' },
      { hash: '#/reminders', label: 'Refill Reminders', icon: 'bell', badge: 'pendingRx' }
    ]
  },
  {
    group: 'Insights & system',
    items: [
      { hash: '#/reports', label: 'Reports', icon: 'report' },
      { hash: '#/gst', label: 'GST', icon: 'gst' },
      { hash: '#/backup', label: 'Backup', icon: 'backup' },
      { hash: '#/settings', label: 'Settings', icon: 'settings' }
    ]
  }
];

export const ROLE_BLOCKED = {
  cashier: new Set(['#/purchases', '#/suppliers', '#/settings', '#/backup', '#/gst']),
  pharmacist: new Set([])
};

export function canSee(hash, role) {
  const blocked = ROLE_BLOCKED[role];
  return !blocked || !blocked.has(hash);
}
