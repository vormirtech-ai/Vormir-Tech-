/*  receipt.js — builds the printable bill.
 *  Two layouts: an 80 mm thermal roll (the dhaba's counter printer) and an A4
 *  sheet for parties who want a proper invoice. All CSS is inlined into the
 *  print document so it renders identically with no network.
 */
(function (App) {
  'use strict';

  var U = App.U;

  function line(label, value, opts) {
    opts = opts || {};
    return '<tr class="' + (opts.strong ? 'strong' : '') + '">' +
      '<td class="l">' + U.esc(label) + '</td>' +
      '<td class="r">' + U.esc(value) + '</td></tr>';
  }

  function thermalCSS() {
    return [
      '@page { size: 80mm auto; margin: 3mm; }',
      '* { box-sizing: border-box; }',
      'body { width: 74mm; margin: 0 auto; font-family: "Courier New", ui-monospace, monospace;',
      '  font-size: 11px; line-height: 1.42; color: #000; -webkit-print-color-adjust: exact; }',
      '.c { text-align: center; } .r { text-align: right; } .l { text-align: left; }',
      '.shop { font-size: 17px; font-weight: 700; letter-spacing: .5px; }',
      '.tag { font-size: 11px; margin-bottom: 2px; }',
      '.small { font-size: 10px; }',
      '.rule { border-top: 1px dashed #000; margin: 5px 0; }',
      '.rule--solid { border-top: 1px solid #000; }',
      'table { width: 100%; border-collapse: collapse; }',
      'td, th { padding: 1px 0; vertical-align: top; font-size: 11px; }',
      'th { border-bottom: 1px dashed #000; text-align: left; font-size: 10px; text-transform: uppercase; }',
      '.items td { padding: 2px 0; }',
      '.qty { width: 30px; text-align: center; }',
      '.amt { width: 62px; text-align: right; }',
      '.rate { width: 52px; text-align: right; }',
      '.strong td { font-weight: 700; font-size: 13px; padding-top: 3px; }',
      '.meta td { font-size: 10px; }',
      '.foot { margin-top: 6px; font-size: 10px; }',
      '.variant { font-size: 9px; }'
    ].join('\n');
  }

  function a4CSS() {
    return [
      '@page { size: A4; margin: 14mm; }',
      '* { box-sizing: border-box; }',
      'body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 12px; color: #14181f;',
      '  margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
      '.sheet { max-width: 180mm; margin: 0 auto; }',
      '.head { display: flex; justify-content: space-between; align-items: flex-start;',
      '  border-bottom: 3px solid #1d2b45; padding-bottom: 12px; margin-bottom: 16px; }',
      '.shop { font-size: 26px; font-weight: 800; color: #1d2b45; letter-spacing: -.4px; }',
      '.tag { color: #b0311f; font-weight: 600; font-size: 13px; }',
      '.addr { color: #5a6472; font-size: 11px; margin-top: 5px; line-height: 1.6; }',
      '.doc { text-align: right; }',
      '.doc h2 { margin: 0 0 6px; font-size: 15px; letter-spacing: 2px; color: #5a6472; text-transform: uppercase; }',
      '.doc .no { font-size: 17px; font-weight: 700; color: #1d2b45; }',
      '.doc .dt { color: #5a6472; font-size: 11px; margin-top: 3px; }',
      '.party { display: flex; gap: 30px; margin-bottom: 14px; font-size: 12px; }',
      '.party b { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #8a94a3; margin-bottom: 2px; }',
      'table.items { width: 100%; border-collapse: collapse; margin-bottom: 14px; }',
      'table.items th { background: #1d2b45; color: #fff; text-align: left; padding: 8px 10px;',
      '  font-size: 10px; text-transform: uppercase; letter-spacing: .6px; }',
      'table.items td { padding: 7px 10px; border-bottom: 1px solid #e6e9ee; }',
      'table.items tr:nth-child(even) td { background: #f7f8fa; }',
      '.r { text-align: right; } .c { text-align: center; }',
      '.totals { width: 260px; margin-left: auto; border-collapse: collapse; }',
      '.totals td { padding: 5px 8px; }',
      '.totals .l { color: #5a6472; }',
      '.totals .r { text-align: right; font-variant-numeric: tabular-nums; }',
      '.totals tr.strong td { border-top: 2px solid #1d2b45; font-size: 16px; font-weight: 800; color: #1d2b45; padding-top: 8px; }',
      '.words { margin-top: 10px; font-size: 11px; color: #5a6472; font-style: italic; }',
      '.foot { margin-top: 26px; border-top: 1px solid #e6e9ee; padding-top: 10px;',
      '  display: flex; justify-content: space-between; color: #8a94a3; font-size: 10px; }',
      '.variant { color: #8a94a3; font-size: 10px; }'
    ].join('\n');
  }

  function thermalBody(bill, s) {
    var out = [];
    out.push('<div class="c">');
    out.push('<div class="shop">' + U.esc(s.name) + '</div>');
    if (s.tagline) out.push('<div class="tag">' + U.esc(s.tagline) + '</div>');
    if (s.address) out.push('<div class="small">' + U.esc(s.address) + '</div>');
    if (s.phone) out.push('<div class="small">Mob: ' + U.esc(s.phone) + '</div>');
    if (s.gstin) out.push('<div class="small">GSTIN: ' + U.esc(s.gstin) + '</div>');
    if (s.fssai) out.push('<div class="small">FSSAI: ' + U.esc(s.fssai) + '</div>');
    out.push('</div>');
    out.push('<div class="rule"></div>');

    out.push('<table class="meta"><tr><td class="l">Bill: ' + U.esc(bill.billNo) + '</td>' +
      '<td class="r">' + U.esc(U.dateLabel(bill.date)) + '</td></tr>' +
      '<tr><td class="l">' + U.esc(bill.orderType || 'Dine-In') +
      (bill.tableNo ? ' • Table ' + U.esc(bill.tableNo) : '') + '</td>' +
      '<td class="r">' + U.esc(U.timeLabel(bill.createdAt)) + '</td></tr>' +
      (bill.customerName || bill.customerPhone
        ? '<tr><td class="l" colspan="2">' + U.esc([bill.customerName, bill.customerPhone].filter(Boolean).join(' • ')) + '</td></tr>'
        : '') +
      '</table>');
    out.push('<div class="rule"></div>');

    out.push('<table class="items"><thead><tr>' +
      '<th>Item</th><th class="qty">Qty</th><th class="rate">Rate</th><th class="amt">Amt</th>' +
      '</tr></thead><tbody>');
    bill.items.forEach(function (l) {
      var name = U.esc(l.name) + (l.variant && l.variant !== 'Plate'
        ? ' <span class="variant">(' + U.esc(l.variant) + ')</span>' : '');
      out.push('<tr><td class="l">' + name + '</td>' +
        '<td class="qty">' + l.qty + '</td>' +
        '<td class="rate">' + U.moneyShort(l.price) + '</td>' +
        '<td class="amt">' + U.money(l.amount) + '</td></tr>');
      if (l.note) out.push('<tr><td class="l small" colspan="4">↳ ' + U.esc(l.note) + '</td></tr>');
    });
    out.push('</tbody></table>');
    out.push('<div class="rule"></div>');

    var t = [];
    t.push(line('Sub Total (' + bill.qty + ' qty)', U.money(bill.subtotal)));
    if (bill.discount > 0) t.push(line('Discount' + (bill.discountType === 'percent' ? ' ' + bill.discountValue + '%' : ''), '-' + U.money(bill.discount)));
    if (bill.serviceCharge > 0) t.push(line('Service Charge ' + bill.serviceChargeRate + '%', U.money(bill.serviceCharge)));
    if (bill.tax > 0) {
      t.push(line('CGST ' + (bill.gstRate / 2) + '%', U.money(bill.cgst)));
      t.push(line('SGST ' + (bill.gstRate / 2) + '%', U.money(bill.sgst)));
    }
    if (bill.roundOff) t.push(line('Round Off', (bill.roundOff > 0 ? '+' : '') + U.money(bill.roundOff)));
    t.push(line('TOTAL', s.currency + U.money(bill.total), { strong: true }));
    out.push('<table>' + t.join('') + '</table>');

    out.push('<div class="rule rule--solid"></div>');
    out.push('<table class="meta"><tr><td class="l">Payment</td><td class="r">' + U.esc(bill.paymentMode || 'Cash') + '</td></tr></table>');
    if (bill.status === 'cancelled') out.push('<div class="c" style="font-weight:700;margin-top:4px">*** CANCELLED ***</div>');
    out.push('<div class="rule"></div>');
    out.push('<div class="c foot">' + U.esc(s.footerNote || '') + '</div>');
    out.push('<div class="c small" style="margin-top:4px">' + U.esc(U.words(bill.total)) + '</div>');
    return out.join('\n');
  }

  function a4Body(bill, s) {
    var rows = bill.items.map(function (l, i) {
      return '<tr><td class="c">' + (i + 1) + '</td>' +
        '<td>' + U.esc(l.name) +
        (l.variant && l.variant !== 'Plate' ? ' <span class="variant">(' + U.esc(l.variant) + ')</span>' : '') +
        (l.note ? '<div class="variant">↳ ' + U.esc(l.note) + '</div>' : '') + '</td>' +
        '<td class="c">' + l.qty + '</td>' +
        '<td class="r">' + U.money(l.price) + '</td>' +
        '<td class="r">' + U.money(l.amount) + '</td></tr>';
    }).join('');

    var totals = [];
    totals.push(line('Sub Total', s.currency + U.money(bill.subtotal)));
    if (bill.discount > 0) totals.push(line('Discount' + (bill.discountType === 'percent' ? ' (' + bill.discountValue + '%)' : ''), '- ' + s.currency + U.money(bill.discount)));
    if (bill.serviceCharge > 0) totals.push(line('Service Charge (' + bill.serviceChargeRate + '%)', s.currency + U.money(bill.serviceCharge)));
    if (bill.tax > 0) {
      totals.push(line('CGST @ ' + (bill.gstRate / 2) + '%', s.currency + U.money(bill.cgst)));
      totals.push(line('SGST @ ' + (bill.gstRate / 2) + '%', s.currency + U.money(bill.sgst)));
    }
    if (bill.roundOff) totals.push(line('Round Off', (bill.roundOff > 0 ? '+ ' : '- ') + s.currency + U.money(Math.abs(bill.roundOff))));
    totals.push(line('Grand Total', s.currency + U.money(bill.total), { strong: true }));

    return [
      '<div class="sheet">',
      '<div class="head"><div>',
      '<div class="shop">' + U.esc(s.name) + '</div>',
      s.tagline ? '<div class="tag">' + U.esc(s.tagline) + '</div>' : '',
      '<div class="addr">' + [s.address, s.phone ? 'Phone: ' + s.phone : '', s.gstin ? 'GSTIN: ' + s.gstin : '', s.fssai ? 'FSSAI: ' + s.fssai : '']
        .filter(Boolean).map(U.esc).join('<br>') + '</div>',
      '</div><div class="doc">',
      '<h2>' + (s.gstin ? 'Tax Invoice' : 'Bill') + '</h2>',
      '<div class="no">' + U.esc(bill.billNo) + '</div>',
      '<div class="dt">' + U.esc(U.dateLabel(bill.date)) + ' • ' + U.esc(U.timeLabel(bill.createdAt)) + '</div>',
      '</div></div>',
      '<div class="party">',
      '<div><b>Order Type</b>' + U.esc(bill.orderType || 'Dine-In') + (bill.tableNo ? ' — Table ' + U.esc(bill.tableNo) : '') + '</div>',
      '<div><b>Customer</b>' + U.esc(bill.customerName || 'Walk-in') + (bill.customerPhone ? ' — ' + U.esc(bill.customerPhone) : '') + '</div>',
      '<div><b>Payment</b>' + U.esc(bill.paymentMode || 'Cash') + '</div>',
      '</div>',
      '<table class="items"><thead><tr><th class="c" style="width:34px">#</th><th>Item</th>',
      '<th class="c" style="width:56px">Qty</th><th class="r" style="width:80px">Rate</th>',
      '<th class="r" style="width:96px">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>',
      '<table class="totals">' + totals.join('') + '</table>',
      '<div class="words">Amount in words: ' + U.esc(U.words(bill.total)) + '</div>',
      bill.status === 'cancelled' ? '<div class="words" style="color:#b0311f;font-weight:700">THIS BILL HAS BEEN CANCELLED</div>' : '',
      '<div class="foot"><span>' + U.esc(s.footerNote || '') + '</span><span>Computer generated bill</span></div>',
      '</div>'
    ].join('\n');
  }

  App.Receipt = {
    html: function (bill, settings, format) {
      var fmt = format || settings.printFormat || '80mm';
      var css = fmt === 'a4' ? a4CSS() : thermalCSS();
      var body = fmt === 'a4' ? a4Body(bill, settings) : thermalBody(bill, settings);
      return '<!doctype html><html><head><meta charset="utf-8">' +
        '<title>' + U.esc(bill.billNo) + '</title><style>' + css + '</style></head>' +
        '<body>' + body + '</body></html>';
    },

    print: function (bill, settings, format) {
      App.UI.print(App.Receipt.html(bill, settings, format), bill.billNo);
    }
  };
})(window.App = window.App || {});
