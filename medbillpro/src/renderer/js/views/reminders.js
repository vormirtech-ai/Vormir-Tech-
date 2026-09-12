import { el, mount } from '../dom.js';
import { icon } from '../icons.js';
import * as fmt from '../format.js';
import { call, shellApi, clipboard } from '../api.js';
import { store } from '../store.js';
import { card, dataTable, emptyState, badge, stat, tabs, toast, confirm, formModal, modal } from '../ui.js';
import { partyPicker } from '../pickers.js';

function waLink(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return `https://wa.me/91${national}?text=${encodeURIComponent(message)}`;
}

export async function render() {
  let tab = 'due';
  const host = el('div');
  let pending = [];
  let sent = [];
  let suggestions = [];

  async function load() {
    [pending, sent, suggestions] = await Promise.all([
      call('reminders.list', { status: 'pending', limit: 500 }),
      call('reminders.list', { status: 'sent', limit: 200 }),
      call('reminders.suggestions', { days: Number(store.settings.rx_reminder_days) || 25 })
    ]);
    draw();
  }

  async function addReminder(customer = null) {
    let party = customer;
    const picker = partyPicker({ type: 'customer', value: customer, onPick: (p) => { party = p; } });
    const saved = await formModal({
      title: 'New refill reminder',
      columns: 2,
      submitLabel: 'Save reminder',
      values: { due_date: fmt.addDays(fmt.today(), Number(store.settings.rx_reminder_days) || 25) },
      fields: [
        { kind: 'node', span: 'full', node: el('div.field.required', el('label', 'Patient'), picker) },
        { name: 'due_date', label: 'Remind on', type: 'date', required: true },
        { name: 'medicines', label: 'Medicines', placeholder: 'Metformin 500, Amlodipine 5' },
        { name: 'note', label: 'Note', span: 'full' }
      ],
      onSubmit: async (v) => {
        if (!party) { toast('Choose the patient first.', { type: 'error' }); return false; }
        return call('reminders.save', { ...v, customer_id: party.id });
      }
    });
    if (saved) { toast('Reminder saved.', { type: 'ok' }); await load(); }
  }

  function openMessage(row) {
    const box = el('textarea', { rows: 5, style: { width: '100%' } }, row.message);
    const handle = modal({
      title: `Message for ${row.customer_name}`,
      size: 'narrow',
      body: el('div',
        el('p.fs-13.muted', 'Nothing is sent automatically. Edit the text, then open WhatsApp or copy it.'),
        box,
        row.phone ? el('div.fs-12.muted.mt-8', `Phone: ${row.phone}`) : el('div.note.warn.mt-8', icon('alert'), el('div', 'This patient has no phone number saved.'))),
      footer: [
        el('button.btn', {
          onclick: async () => { await clipboard.write(box.value); toast('Message copied.', { type: 'ok' }); }
        }, icon('copy'), 'Copy text'),
        el('button.btn.teal', {
          disabled: !row.phone,
          onclick: async () => {
            await shellApi.openExternal(waLink(row.phone, box.value));
            await call('reminders.status', { id: row.id, status: 'sent' });
            handle.close();
            toast('Marked as sent.', { type: 'ok' });
            await load();
          }
        }, icon('chat'), 'Open WhatsApp')
      ]
    });
  }

  function reminderTable(rows, { showStatus = false } = {}) {
    return dataTable({
      rows,
      rowClass: (r) => (r.due ? 'row-warn' : ''),
      columns: [
        { key: 'customer_name', label: 'Patient', render: (r) => el('div', el('b', r.customer_name), el('div.fs-12.muted', r.phone || 'no phone')) },
        { key: 'medicines', label: 'Medicines', render: (r) => el('span.fs-13', r.medicines || '—') },
        { key: 'invoice_no', label: 'From bill', render: (r) => r.invoice_no || '—' },
        { key: 'due_date', label: 'Due', render: (r) => el('div', fmt.date(r.due_date), el('div.fs-12.muted', fmt.relativeDays(r.due_date))) },
        showStatus ? { key: 'sent_at', label: 'Sent', render: (r) => fmt.stamp(r.sent_at) } : null,
        {
          key: 'actions', label: '', align: 'center',
          render: (r) => el('div.row.tight', { style: { flexWrap: 'nowrap' } },
            el('button.btn.sm.teal', { onclick: () => openMessage(r) }, icon('chat'), 'Message'),
            el('button.btn.sm', {
              onclick: async () => {
                await call('reminders.status', { id: r.id, status: 'done' });
                toast('Marked done.', { type: 'ok' });
                await load();
              }
            }, icon('check')),
            el('button.icon-btn', {
              title: 'Delete',
              onclick: async () => {
                const ok = await confirm({ title: 'Delete this reminder?', message: 'It will no longer appear in the list.', danger: true });
                if (!ok) return;
                await call('reminders.remove', { id: r.id });
                await load();
              }
            }, icon('trash')))
        }
      ].filter(Boolean),
      empty: emptyState({
        title: 'Nothing here',
        message: 'Reminders are created automatically when you choose a refill period while billing.',
        iconName: 'bell'
      })
    });
  }

  function draw() {
    const due = pending.filter((r) => r.due);
    mount(host,
      el('div.grid.cols-3.mb-16',
        stat({ label: 'Due now', value: String(due.length), iconName: 'bell', accent: due.length ? 'orange' : 'green' }),
        stat({ label: 'Scheduled', value: String(pending.length - due.length), iconName: 'calendar', accent: 'blue' }),
        stat({ label: 'Suggested from history', value: String(suggestions.length), iconName: 'users', accent: 'purple' })),
      el('div.row.mb-16',
        tabs({
          items: [
            { key: 'due', label: 'Due now', count: due.length },
            { key: 'upcoming', label: 'Upcoming', count: pending.length - due.length },
            { key: 'suggested', label: 'Suggested', count: suggestions.length },
            { key: 'sent', label: 'Sent' }
          ],
          active: tab,
          pill: true,
          onChange: (k) => { tab = k; draw(); }
        }),
        el('div.spacer'),
        el('button.btn.primary', { onclick: () => addReminder() }, icon('plus'), 'New reminder')),
      el('div.note.mb-16', icon('shield'), el('div',
        el('b', 'Nothing leaves this computer by itself. '),
        'MedV prepares the message and opens WhatsApp only when you click — so reminders work even when the shop PC is offline (the message waits until you are online).')),
      tab === 'suggested'
        ? card({
          title: 'Patients who have not returned',
          subtitle: `No purchase in the last ${store.settings.rx_reminder_days} days`,
          flush: true,
          body: dataTable({
            rows: suggestions,
            columns: [
              { key: 'customer_name', label: 'Patient', render: (r) => el('div', el('b', r.customer_name), el('div.fs-12.muted', r.phone || 'no phone')) },
              { key: 'medicines', label: 'Last bought', render: (r) => el('span.fs-13', r.medicines || '—') },
              { key: 'last_visit', label: 'Last visit', render: (r) => el('div', fmt.date(r.last_visit), el('div.fs-12.muted', fmt.relativeDays(r.last_visit))) },
              {
                key: 'actions', label: '', align: 'center',
                render: (r) => el('button.btn.sm.primary', {
                  onclick: () => addReminder({ id: r.customer_id, name: r.customer_name, phone: r.phone })
                }, icon('plus'), 'Add reminder')
              }
            ],
            empty: emptyState({ title: 'Every regular patient has visited recently', iconName: 'check' })
          })
        })
        : card({
          title: tab === 'due' ? 'Refills due now' : (tab === 'upcoming' ? 'Scheduled reminders' : 'Already sent'),
          flush: true,
          body: tab === 'due'
            ? reminderTable(due)
            : (tab === 'upcoming' ? reminderTable(pending.filter((r) => !r.due)) : reminderTable(sent, { showStatus: true }))
        }));
  }

  await load();
  return host;
}
