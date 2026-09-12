import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import { call } from '../api.js';
import { store } from '../store.js';
import { card, form, toast } from '../ui.js';

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha',
  'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

/** Three-step first-run wizard. Nothing here needs a network connection. */
export async function render({ onDone }) {
  let step = 0;
  const values = { store_state: 'Maharashtra', invoice_prefix: 'INV', default_gst_rate: 12, print_format: 'a5', expiry_alert_days: 90, sample_data: 1 };
  const host = el('div.auth-card');

  const stepsBar = () => el('div.steps', ...[0, 1, 2].map((i) => el(`div.step${i < step ? '.done' : ''}${i === step ? '.current' : ''}`)));

  const shopForm = form([
    { name: 'store_name', label: 'Store name', required: true, span: 'full', autofocus: true, placeholder: 'e.g. Sanjivani Medical & General Stores' },
    { name: 'store_tagline', label: 'Line under the name (optional)', span: 'full', placeholder: 'Chemist & Druggist' },
    { name: 'store_address', label: 'Address', span: 'full' },
    { name: 'store_city', label: 'City' },
    { name: 'store_state', label: 'State', type: 'select', options: STATES },
    { name: 'store_pincode', label: 'PIN code' },
    { name: 'store_phone', label: 'Phone' }
  ], values, { columns: 2 });

  const legalForm = form([
    { name: 'store_gstin', label: 'GSTIN', span: 'full', placeholder: '27ABCDE1234F1Z5', help: 'Leave blank if you are not registered under GST.' },
    { name: 'store_dl_no', label: 'Drug licence number', span: 'full', placeholder: 'MH-NAG-20B-123456' },
    { name: 'store_fssai', label: 'FSSAI number (optional)' },
    { name: 'store_email', label: 'Email' },
    { name: 'invoice_prefix', label: 'Invoice prefix', required: true, width: 'sm', help: 'Bills will be numbered INV-0001, INV-0002 …' },
    { name: 'default_gst_rate', label: 'Default GST %', type: 'select', options: [0, 5, 12, 18, 28], width: 'sm' },
    { name: 'print_format', label: 'Invoice paper', type: 'select', options: [{ value: 'a5', label: 'A5 (half sheet)' }, { value: 'a4', label: 'A4' }, { value: 'thermal', label: '80 mm thermal roll' }] },
    { name: 'expiry_alert_days', label: 'Warn me this many days before expiry', type: 'number', min: 7, max: 365, width: 'sm' }
  ], values, { columns: 2 });

  const adminForm = form([
    { name: 'admin_password', label: 'Administrator password', type: 'password', required: true, span: 'full', help: 'You will sign in as “admin” with this password. Keep it safe — it protects your shop data.' },
    { name: 'confirm_password', label: 'Repeat password', type: 'password', required: true, span: 'full' },
    { name: 'sample_data', label: 'Load a small sample catalogue so I can try things out', type: 'checkbox', span: 'full' }
  ], values, { columns: 1 });

  const stepMeta = [
    { title: 'Your shop', subtitle: 'This appears on every bill you print.', f: shopForm },
    { title: 'Licences & invoice', subtitle: 'Used for GST reports and invoice numbering.', f: legalForm },
    { title: 'Administrator account', subtitle: 'The default password must be replaced before you begin.', f: adminForm }
  ];

  function collect() {
    Object.assign(values, stepMeta[step].f.values());
  }

  async function finish() {
    collect();
    if (values.admin_password !== values.confirm_password) {
      adminForm.showError('confirm_password', 'The two passwords do not match.');
      return;
    }
    if (String(values.admin_password).length < 4) {
      adminForm.showError('admin_password', 'Use at least 4 characters.');
      return;
    }
    finishBtn.disabled = true;
    try {
      await call('setup.complete', values);
      toast('Setup finished — your local database is ready.', { type: 'ok' });
      await onDone();
    } catch {
      finishBtn.disabled = false;
    }
  }

  const finishBtn = el('button.btn.teal', { onclick: finish }, icon('check'), 'Finish setup');

  function draw() {
    const meta = stepMeta[step];
    mount(host,
      el('img.logo-sm', { src: 'assets/logo.png', alt: 'MedV' }),
      stepsBar(),
      card({
        title: meta.title,
        subtitle: `Step ${step + 1} of 3`,
        body: el('div', el('p.fs-13.muted', meta.subtitle), meta.f.node),
        footer: el('div.row.w-100',
          step > 0 ? el('button.btn', { onclick: () => { collect(); step -= 1; draw(); } }, 'Back') : null,
          el('div.spacer'),
          step < 2
            ? el('button.btn.primary', {
              onclick: () => {
                if (!meta.f.validate()) return;
                collect();
                step += 1;
                draw();
              }
            }, 'Continue', icon('chevronRight'))
            : finishBtn)
      }),
      el('div.note.mt-16', icon('shield'),
        el('div', el('b', 'Everything stays on this computer. '),
          `The database file is created at ${store.state?.paths?.db || 'your application data folder'}.`)));
  }

  draw();

  return el('div.auth',
    el('div.auth-art',
      el('div.brand', el('img', { src: 'assets/logo.png', alt: 'MedV' })),
      el('div',
        el('h1', 'Welcome to MedV.'),
        el('p.lead', 'Three short steps and your medical store is ready to bill. Nothing is uploaded anywhere — your database is created on this computer and stays there.'),
        el('ul.auth-features',
          el('li', icon('check'), el('span', 'Local SQLite database, created automatically')),
          el('li', icon('check'), el('span', 'Backup to a pen drive whenever you like')),
          el('li', icon('check'), el('span', 'GST-ready invoices from the first bill')))),
      el('div.foot', 'MedV by Vormir Tech Solutions')),
    el('div.auth-form', host));
}
