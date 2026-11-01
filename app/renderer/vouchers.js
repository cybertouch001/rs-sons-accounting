
// R&S Sons Accounting - voucher entry screen
'use strict';
const ITEM_TYPES = ['SAL', 'PUR', 'CRN', 'DBN', 'SOR', 'POR', 'QTN', 'PFI', 'DCH', 'GRN', 'STJ', 'PRD'];
const SALE_SIDE = ['SAL', 'CRN', 'SOR', 'QTN', 'PFI', 'DCH'];
const CONVERT_TO = { SOR: 'SAL', QTN: 'SAL', PFI: 'SAL', DCH: 'SAL', POR: 'PUR', GRN: 'PUR' };

SCREENS.voucher = async (el, p) => {
  const c = await loadCache(true);
  let v;
  if (p.id) { v = await C('voucher', p.id); if (!v) throw new Error('Voucher not found'); v.lines = v.entries.map(e => ({ ledger_id: e.ledger_id, dr: e.dr, cr: e.cr, cost_centre_id: e.cost_centre_id, line_narr: e.line_narr, bill: e.bill, bank_date: e.bank_date })); }
  else if (p.prefill) v = Object.assign({}, p.prefill);
  else v = { vtype: p.vtype, date: APP.date, items: [], lines: [] };
  const vt = v.vtype; const T = APP.info.company.vtypes[vt];
  const isItem = ITEM_TYPES.includes(vt), isStock = vt === 'STJ' || vt === 'PRD', sale = SALE_SIDE.includes(vt);
  const s = APP.settings; const cs = s.state_code;
  const st = { v, saved: !!p.id, id: p.id || null };
  APP.current.dirty = false;

  const partyLedgers = l => underGroups(l, ['Sundry Debtors', 'Sundry Creditors', 'Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c', 'Loans & Advances (Asset)', 'Current Liabilities']) ;
  const cashBank = l => underGroups(l, ['Cash-in-Hand', 'Bank Accounts', 'Bank OD A/c']);
  const spLedgers = c.ledgers.filter(l => underGroups(l, [sale ? 'Sales Accounts' : 'Purchase Accounts']));
  const multiGodown = c.godowns.length > 1;
  const batchCols = c.items.some(i => i.batch_wise) || (v.items || []).some(i => i.batch_no);
  const head = `<h2 class="title"><span class="vtype-badge">${esc(T.short || T.name)}</span> ${st.saved ? '<small>Alteration mode — change and press Ctrl+S</small>' : '<small>New entry</small>'} ${v.status && v.status !== 'active' ? `<span class="pill ${v.status === 'cancelled' ? 'red' : 'grey'}">${esc(v.status.toUpperCase())}</span>` : ''}<span style="flex:1"></span>
    <select id="vtsw" title="Change voucher type">${Object.entries(APP.info.company.vtypes).map(([k, t]) => `<option value="${k}" ${k === vt ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></h2>`;

  // ---------- header ----------
  let hdr = `<div class="card"><div class="vhead">
    <div class="fld"><label>Voucher No.</label><input id="vno" value="${esc(v.number || '')}" placeholder="(auto)"></div>
    <div class="fld"><label>Date</label><input id="vdate" type="date" value="${esc(v.date)}"></div>`;
  if (isItem && !isStock) {
    hdr += `<div class="fld w2"><label>${sale ? 'Party / Customer' : 'Supplier'} (A/c)</label><input id="vparty" data-combo="1" placeholder="Type name… (Cash for cash bill)"></div>
      <div class="fld"><label>Place of Supply</label><select id="vpos">${U.STATES.map(x => `<option value="${x[0]}">${x[0]} - ${esc(x[1])}</option>`).join('')}</select></div>
      <div class="fld"><label>${vt === 'PUR' ? 'Supplier Invoice No.' : (vt === 'CRN' || vt === 'DBN') ? 'Against Invoice No.' : 'Ref / PO No.'}</label>${(vt === 'CRN' || vt === 'DBN') ? '<select id="vorig"><option value="">— none —</option></select>' : `<input id="vref" value="${esc(v.ref_no || '')}">`}</div>`;
    if (T.accounting) hdr += `<div class="fld w2"><label>${sale ? 'Sales' : 'Purchase'} Ledger</label><select id="vsp">${spLedgers.map(l => `<option value="${l.id}" ${l.id === v.sp_ledger_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>`;
    hdr += `<div class="fld"><label>Bill Discount %</label><input id="vbd" type="number" step="any" value="${v.bill_disc_pct || ''}"></div>
      <div class="fld chk"><input type="checkbox" id="vinc" ${v.tax_inclusive ? 'checked' : ''}><label for="vinc">Rates include GST</label></div>
      ${vt === 'PUR' || vt === 'DBN' ? `<div class="fld chk"><input type="checkbox" id="vrcm" ${v.rcm ? 'checked' : ''}><label for="vrcm">Reverse charge (RCM)</label></div>` : ''}
      ${sale && c.salesmen.length ? `<div class="fld"><label>Salesman</label><select id="vsm"><option value="">—</option>${c.salesmen.map(x => `<option value="${x.id}" ${x.id === v.salesman_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}`;
  } else if (vt === 'PRD') {
    hdr += `<div class="fld w2"><label>Bill of Materials</label><select id="vbom"><option value="">— choose BOM —</option>${c.boms.map(b => `<option value="${b.id}" ${b.id === v.bom_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div><div class="fld"><label>Quantity to produce</label><input id="vbq" type="number" step="any" value="1"></div><div class="fld"><label>&nbsp;</label><button class="btn" id="vbomgo">Load components</button></div>`;
  } else if (vt === 'RCT' || vt === 'PMT') {
    hdr += `<div class="fld w2"><label>${vt === 'RCT' ? 'Received in (Cash / Bank) — Dr' : 'Paid from (Cash / Bank) — Cr'}</label><input id="vacc" data-combo="1"></div>
      <div class="fld"><label>Mode</label><select id="vmode">${['Cash', 'Cheque', 'NEFT/RTGS', 'UPI', 'Card', 'DD'].map(m => `<option ${m === v.pay_mode ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="fld"><label>Cheque / UTR No.</label><input id="vchq" value="${esc(v.cheque_no || '')}"></div><div class="fld"><label>Cheque Date</label><input id="vchqd" type="date" value="${esc(v.cheque_date || '')}"></div>`;
  }
  if (c.cc.length && !isStock) hdr += `<div class="fld"><label>Cost Centre</label><select id="vcc"><option value="">—</option>${c.cc.map(x => `<option value="${x.id}" ${x.id === v.cost_centre_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>`;
  hdr += `</div>`;
  if (isItem && !isStock) hdr += `<details style="margin-top:6px" ${v.transport || v.vehicle_no || v.ship_to || v.buyer_name ? 'open' : ''}><summary style="cursor:pointer;color:var(--blue);font-size:12px">More details: buyer name (cash bill), ship-to, transport, e-way bill, due date</summary><div class="vhead" style="margin-top:6px">
     <div class="fld w2"><label>Buyer Name (cash / walk-in)</label><input id="vbuyer" value="${esc(v.buyer_name || '')}"></div><div class="fld w2"><label>Ship To (address)</label><input id="vship" value="${esc(v.ship_to || '')}"></div><div class="fld"><label>Due Date</label><input id="vdue" type="date" value="${esc(v.due_date || '')}"></div><div class="fld"><label>Ref Date</label><input id="vrefd" type="date" value="${esc(v.ref_date || '')}"></div>
     <div class="fld"><label>Transporter</label><input id="vtr" value="${esc(v.transport || '')}"></div><div class="fld"><label>Vehicle No.</label><input id="vveh" value="${esc(v.vehicle_no || '')}" style="text-transform:uppercase"></div><div class="fld"><label>Distance (km)</label><input id="vdist" type="number" value="${v.distance || ''}"></div><div class="fld"><label>e-Way Bill No.</label><input id="veway" value="${esc(v.eway_no || '')}"></div></div></details>`;
  hdr += `</div>`;

  // ---------- grid ----------
  let grid;
  if (isItem) {
    const lines = (v.items || []).map(x => ({ ...x })); if (!lines.length || !st.saved) lines.push({});
    st.lines = lines;
    grid = `<div class="card" style="padding:8px"><table class="grid" id="ig"><thead><tr><th style="width:26px">#</th><th>Item / Service</th>${isStock ? '<th style="width:80px">In / Out</th>' : ''}${batchCols ? '<th style="width:90px">Batch</th><th style="width:112px">Expiry</th>' : ''}${multiGodown || isStock ? '<th style="width:120px">Godown</th>' : ''}<th style="width:80px">Qty</th><th style="width:50px">Unit</th><th style="width:96px">Rate</th>${isStock ? '' : '<th style="width:60px">Disc %</th><th style="width:62px">GST %</th><th style="width:100px">Taxable</th><th style="width:88px">GST ₹</th>'}<th style="width:108px">Amount</th><th style="width:26px"></th></tr></thead><tbody></tbody></table>
     <div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm" id="iadd">+ Add line</button><span style="color:var(--muted);font-size:12px;align-self:center">Tip: type item name / code / scan barcode · Enter moves ahead · last row auto-adds</span></div></div>`;
  } else {
    const lines = (v.lines || []).map(x => ({ ...x }));
    st.lines = lines;
    if (vt === 'RCT' || vt === 'PMT') { st.acc = lines.find(l => (vt === 'RCT' ? l.dr : l.cr) && cashBank(c.ledgers.find(x => x.id === l.ledger_id) || {})); st.lines = lines.filter(l => l !== st.acc); }
    if (!st.lines.length) st.lines.push({}); if (vt === 'JRN' || vt === 'CNT') while (st.lines.length < 2) st.lines.push({});
    const two = vt === 'JRN' || vt === 'CNT';
    grid = `<div class="card" style="padding:8px"><table class="grid" id="ag"><thead><tr><th style="width:26px">#</th>${two ? '<th style="width:64px">Dr/Cr</th>' : ''}<th>Particulars (Ledger)</th><th style="width:250px">Bill-wise Reference</th>${c.cc.length ? '<th style="width:130px">Cost Centre</th>' : ''}<th style="width:200px">Line Narration</th>${two ? '<th style="width:120px">Debit ₹</th><th style="width:120px">Credit ₹</th>' : '<th style="width:130px">Amount ₹</th>'}<th style="width:26px"></th></tr></thead><tbody></tbody></table>
      <div style="margin-top:6px"><button class="btn sm" id="aadd">+ Add line</button></div></div>`;
  }
  const foot = `<div class="vfoot"><div><div class="fld"><label>Narration</label><textarea id="vnarr" rows="2">${esc(v.narration || '')}</textarea></div><div class="infobox" id="vinfo">Select a ${isItem ? 'party / item' : 'ledger'} to see balance, stock and last rates here.</div></div>
    <div class="totals" id="vtot"></div></div>
    <div class="actions" id="vact"></div>`;
  el.innerHTML = head + hdr + grid + foot;
  $('#vtsw').onchange = () => go('voucher', { vtype: $('#vtsw').value }, true);
  const markDirty = () => { APP.current.dirty = true; };
  el.addEventListener('input', markDirty);

  // ---------- party ----------
  const info = (html) => { $('#vinfo').innerHTML = html; };
  async function partyInfo(id) {
    if (!id) return; const l = c.ledgers.find(x => x.id === +id); if (!l) return;
    const bal = await C('ledgerBalance', l.id, '9999-12-31');
    info(`<b>${esc(l.name)}</b> · ${esc(l.group_name)}${l.gstin ? ' · GSTIN ' + esc(l.gstin) : ' · Unregistered'}${l.state_code ? ' · ' + esc(U.stateName(l.state_code)) : ''}<br>Current balance: <b>${U.drcr(bal)}</b>${l.credit_limit ? ` · Credit limit ₹${inr(l.credit_limit)}${bal > l.credit_limit ? ' <span class="neg">EXCEEDED</span>' : ''}` : ''}${l.credit_days ? ' · ' + l.credit_days + ' days credit' : ''}${l.phone ? ' · ☎ ' + esc(l.phone) : ''}`);
  }
  if ($('#vparty')) {
    const pIn = $('#vparty');
    combo(pIn, { source: ledgerSrc(partyLedgers), create: async (name) => new Promise(res => { go('ledgerEdit', { group: sale ? 'Sundry Debtors' : 'Sundry Creditors', onSaved: id => { res(id); } }); setTimeout(() => { const f = $('#f_name'); if (f) f.value = name; }, 60); }),
      onSelect: async x => { if (!x) return; const l = c.ledgers.find(y => y.id === +x.id) || (await loadCache(true)).ledgers.find(y => y.id === +x.id); $('#vpos').value = (l && l.state_code) || cs; partyInfo(x.id); recalc(); loadOrig(); } });
    const pl = c.ledgers.find(l => l.id === v.party_id); if (pl) { pIn.value = pl.name; pIn.dataset.id = pl.id; }
    $('#vpos').value = v.place_of_supply || (pl && pl.state_code) || cs; $('#vpos').onchange = recalc;
    if (v.party_id) partyInfo(v.party_id);
  }
  async function loadOrig() {
    const sel = $('#vorig'); if (!sel) return; const pid = $('#vparty').dataset.id; if (!pid) return;
    const bills = await C('pendingBills', +pid); const cur = v.orig_ref;
    sel.innerHTML = `<option value="">— none —</option>` + bills.filter(b => !b.onacc).map(b => `<option value="${esc(b.ref)}" ${b.ref === cur ? 'selected' : ''}>${esc(b.ref)} · ${U.fmtDate(b.date)} · ₹${inr(Math.abs(b.amount))}</option>`).join('') + (cur && !bills.some(b => b.ref === cur) ? `<option selected value="${esc(cur)}">${esc(cur)}</option>` : '');
  }
  if ($('#vorig')) loadOrig();
  if ($('#vacc')) { const a = $('#vacc'); combo(a, { source: ledgerSrc(cashBank), onSelect: x => x && partyInfo(x.id) }); const al = st.acc ? c.ledgers.find(l => l.id === st.acc.ledger_id) : c.ledgers.find(l => l.name === 'Cash'); if (al) { a.value = al.name; a.dataset.id = al.id; } }

  // ---------- item grid ----------
  const isInter = () => $('#vpos') ? $('#vpos').value !== String(cs).padStart(2, '0') : false;
  function drawItems() {
    for (const l of st.lines) if (l.item_id && !l.item_name) { const it = c.items.find(x => x.id === l.item_id); if (it) { l.item_name = it.name; l.unit_name = it.unit_name; } }
    const tb = $('#ig tbody'); tb.innerHTML = st.lines.map((l, i) => `<tr data-i="${i}"><td class="ro" style="text-align:center">${i + 1}</td><td class="cell"><input class="it" data-combo="1" value="${esc(l.item_name || '')}" data-id="${l.item_id || ''}"></td>
      ${isStock ? `<td class="cell"><select class="dir"><option value="-1" ${+l.direction < 0 ? 'selected' : ''}>Out</option><option value="1" ${+l.direction > 0 ? 'selected' : ''}>In</option></select></td>` : ''}
      ${batchCols ? `<td class="cell"><input class="bt" value="${esc(l.batch_no || '')}"></td><td class="cell"><input class="ex" type="date" value="${esc(l.exp_date || '')}"></td>` : ''}
      ${multiGodown || isStock ? `<td class="cell"><select class="gd">${c.godowns.map(g => `<option value="${g.id}" ${g.id === l.godown_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></td>` : ''}
      <td class="cell"><input class="num q" type="number" step="any" value="${l.qty ?? ''}"></td><td class="ro u" style="text-align:left">${esc(l.unit_name || '')}</td><td class="cell"><input class="num r" type="number" step="any" value="${l.rate ?? ''}" ${vt === 'PRD' ? 'readonly' : ''}></td>
      ${isStock ? '' : `<td class="cell"><input class="num d" type="number" step="any" value="${l.disc_pct || ''}"></td><td class="cell"><select class="g">${GST_RATES.map(r => `<option value="${r}" ${Number(l.gst_rate ?? 18) === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td class="ro tx"></td><td class="ro tt"></td>`}
      <td class="ro am b"></td><td style="text-align:center"><button class="btn sm" data-x="${i}" title="Remove line" tabindex="-1">×</button></td></tr>`).join('');
    $$('#ig tbody tr').forEach(tr => {
      const i = +tr.dataset.i, l = st.lines[i];
      combo($('.it', tr), { source: itemSrc(), create: async (name) => new Promise(res => { go('itemEdit', { onSaved: id => res(id) }); setTimeout(() => { const f = $('#f_name'); if (f) f.value = name; }, 60); }),
        onSelect: async x => { if (!x) { l.item_id = null; recalc(); return; } const fresh = (APP.cache.items || []).find(y => y.id === +x.id) || (await loadCache(true)).items.find(y => y.id === +x.id); l.item_id = fresh.id; l.item_name = fresh.name; l.unit_name = fresh.unit_name; l.gst_rate = fresh.gst_rate; l.cess_rate = fresh.cess_rate;
          const pid = $('#vparty') && $('#vparty').dataset.id; const inf = await C('itemInfo', fresh.id, pid ? +pid : null, $('#vdate').value);
          let rate = sale ? fresh.sale_rate : fresh.purchase_rate; if (sale && inf.priceList) { rate = inf.priceList.rate; l.disc_pct = inf.priceList.disc_pct || l.disc_pct; } if (isStock) rate = inf.avgCost || fresh.purchase_rate;
          if (!l.rate || !st.saved) l.rate = rate; if (!l.qty) l.qty = 1;
          $('.r', tr).value = l.rate; $('.q', tr).value = l.qty; $('.u', tr).textContent = l.unit_name || ''; if ($('.g', tr)) $('.g', tr).value = l.gst_rate; if ($('.d', tr)) $('.d', tr).value = l.disc_pct || '';
          info(`<b>${esc(fresh.name)}</b> · HSN ${esc(fresh.hsn || '-')} · GST ${fresh.gst_rate}%${fresh.mrp ? ' · MRP ₹' + inr(fresh.mrp) : ''}<br>In stock: <b class="${inf.stock <= 0 && fresh.item_type !== 'Service' ? 'neg' : ''}">${fresh.item_type === 'Service' ? 'service' : U.r3(inf.stock) + ' ' + esc(fresh.unit_name || '')}</b> · Avg cost ₹${inr(inf.avgCost)}${inf.lastSale ? ` · Last sold to this party @ ₹${inr(inf.lastSale.rate)} (${U.fmtDate(inf.lastSale.date)})` : ''}${inf.lastPur ? ` · Last purchase @ ₹${inr(inf.lastPur.rate)} from ${esc(inf.lastPur.party || '')}` : ''}${inf.priceList ? ` · Price list ₹${inr(inf.priceList.rate)}` : ''}`);
          if (i === st.lines.length - 1) { st.lines.push({}); drawItems(); const ntr = $(`#ig tbody tr[data-i="${i}"]`); $('.q', ntr).focus(); $('.q', ntr).select(); } recalc(); } });
      const bindNum = (cls, k) => { const e2 = $(cls, tr); if (!e2) return; e2.addEventListener('input', () => { l[k] = e2.value; recalc(); }); e2.addEventListener('change', () => { l[k] = e2.value; recalc(); }); };
      bindNum('.q', 'qty'); bindNum('.r', 'rate'); bindNum('.d', 'disc_pct'); bindNum('.g', 'gst_rate'); bindNum('.bt', 'batch_no'); bindNum('.ex', 'exp_date'); bindNum('.gd', 'godown_id'); bindNum('.dir', 'direction');
      $$('input,select', tr).forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !inp.dataset.combo) { e.preventDefault(); const nx = $$('input:not([readonly]),select', tr); const k = nx.indexOf(inp); if (k < nx.length - 1) nx[k + 1].focus(); else { const ntr = tr.nextElementSibling; if (ntr) $('.it', ntr).focus(); else $('#vnarr').focus(); } } }));
      $('[data-x]', tr).onclick = () => { st.lines.splice(i, 1); if (!st.lines.length) st.lines.push({}); drawItems(); recalc(); };
    });
    recalc();
  }
  function recalc() {
    if (isItem) {
      const items = st.lines.filter(l => l.item_id).map(l => ({ ...l, qty: Number(l.qty) || 0, rate: Number(l.rate) || 0, disc_pct: Number(l.disc_pct) || 0, gst_rate: Number(l.gst_rate) || 0, cess_rate: Number(l.cess_rate) || 0 }));
      const noTax = isStock || s.gst_registered === '0';
      const t = CALC.calcVoucher({ items, is_inter: isInter(), tax_inclusive: $('#vinc') && $('#vinc').checked, bill_disc_pct: $('#vbd') ? $('#vbd').value : 0 }, { noTax, roundOff: s.round_off !== '0' && !isStock });
      let k = 0; $$('#ig tbody tr').forEach((tr, i) => { const l = st.lines[i]; if (!l.item_id) { $('.am', tr).textContent = ''; if ($('.tx', tr)) { $('.tx', tr).textContent = ''; $('.tt', tr).textContent = ''; } return; } const it = items[k++];
        if (isStock) $('.am', tr).textContent = inr(it.qty * it.rate); else { $('.tx', tr).textContent = inr(it.taxable); $('.tt', tr).textContent = inr(it.cgst + it.sgst + it.igst + it.cess); $('.am', tr).textContent = inr(it.amount); } });
      const rows = isStock ? [['Total In value', inr(items.filter(i => +i.direction > 0).reduce((a, i) => a + i.qty * i.rate, 0))], ['Total Out value', inr(items.filter(i => +i.direction < 0).reduce((a, i) => a + i.qty * i.rate, 0))]]
        : [['Items / Qty', `${items.length} / ${U.r3(t.qty)}`], ['Gross', inr(t.gross)], t.discount ? ['Discount', '− ' + inr(t.discount)] : null, ['Taxable Value', inr(t.taxable)], ...(isInter() ? [['IGST', inr(t.igst)]] : [['CGST', inr(t.cgst)], ['SGST', inr(t.sgst)]]), t.cess ? ['Cess', inr(t.cess)] : null, ['Round Off', inr(t.round_off)]].filter(Boolean);
      $('#vtot').innerHTML = rows.map(r => `<div><span>${r[0]}</span><span>${r[1]}</span></div>`).join('') + (isStock ? '' : `<div class="gt"><span>${isInter() ? 'Total (Inter-state · IGST)' : 'Total (Intra-state · CGST+SGST)'}</span><span>₹ ${inr(t.total)}</span></div><div style="font-size:11px;color:var(--muted)">${esc(U.amountInWords(t.total))}</div>`);
      st.total = t.total;
    } else {
      const two = vt === 'JRN' || vt === 'CNT';
      let dr = 0, cr = 0; for (const l of st.lines) { dr += Number(l.dr) || 0; cr += Number(l.cr) || 0; }
      if (!two) { const tot = st.lines.reduce((a, l) => a + (Number(l.amt) || 0), 0); $('#vtot').innerHTML = `<div class="gt"><span>Total ${vt === 'RCT' ? 'received' : 'paid'}</span><span>₹ ${inr(tot)}</span></div><div style="font-size:11px;color:var(--muted)">${esc(U.amountInWords(tot))}</div>`; st.total = tot; }
      else $('#vtot').innerHTML = `<div><span>Total Debit</span><span>${inr(dr)}</span></div><div><span>Total Credit</span><span>${inr(cr)}</span></div><div class="gt"><span>Difference</span><span class="${Math.abs(dr - cr) > 0.005 ? 'neg' : ''}">${inr(dr - cr)}</span></div>`;
    }
  }
  // ---------- accounting grid ----------
  function drawAcc() {
    const two = vt === 'JRN' || vt === 'CNT';
    if (!two) for (const l of st.lines) if (l.amt == null) l.amt = vt === 'RCT' ? l.cr : l.dr;
    if (two) for (const l of st.lines) if (!l.side) l.side = l.cr ? 'Cr' : 'Dr';
    $('#ag tbody').innerHTML = st.lines.map((l, i) => `<tr data-i="${i}"><td class="ro" style="text-align:center">${i + 1}</td>${two ? `<td class="cell"><select class="sd"><option ${l.side === 'Dr' ? 'selected' : ''}>Dr</option><option ${l.side === 'Cr' ? 'selected' : ''}>Cr</option></select></td>` : ''}
      <td class="cell"><input class="lg" data-combo="1"></td><td class="cell"><select class="bl"><option value="">—</option></select></td>${c.cc.length ? `<td class="cell"><select class="cc"><option value="">—</option>${c.cc.map(x => `<option value="${x.id}" ${x.id === l.cost_centre_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>` : ''}
      <td class="cell"><input class="ln" value="${esc(l.line_narr || '')}"></td>${two ? `<td class="cell"><input class="num dr" type="number" step="any" value="${l.side === 'Dr' ? (l.dr || '') : ''}" ${l.side === 'Cr' ? 'disabled' : ''}></td><td class="cell"><input class="num cr" type="number" step="any" value="${l.side === 'Cr' ? (l.cr || '') : ''}" ${l.side === 'Dr' ? 'disabled' : ''}></td>` : `<td class="cell"><input class="num am2" type="number" step="any" value="${l.amt || ''}"></td>`}
      <td style="text-align:center"><button class="btn sm" data-x="${i}" tabindex="-1">×</button></td></tr>`).join('');
    $$('#ag tbody tr').forEach(tr => {
      const i = +tr.dataset.i, l = st.lines[i]; const lg = $('.lg', tr);
      const filt = vt === 'CNT' ? cashBank : (vt === 'RCT' || vt === 'PMT') ? (x => !cashBank(x) || true) : null;
      combo(lg, { source: ledgerSrc(filt), create: async (name) => new Promise(res => { go('ledgerEdit', { onSaved: id => res(id) }); setTimeout(() => { const f = $('#f_name'); if (f) f.value = name; }, 60); }), onSelect: x => { l.ledger_id = x ? +x.id : null; if (x) { partyInfo(x.id); fillBills(tr, l); } if (two && x && i > 0 && !l.dr && !l.cr) { let d = 0; for (const y of st.lines) d += (Number(y.dr) || 0) - (Number(y.cr) || 0); if (Math.abs(d) > 0.005) { l.side = d > 0 ? 'Cr' : 'Dr'; l[d > 0 ? 'cr' : 'dr'] = Math.abs(U.r2(d)); drawAcc(); return; } } if (i === st.lines.length - 1 && x) { st.lines.push(two ? { side: l.side === 'Dr' ? 'Cr' : 'Dr' } : {}); drawAcc(); const ntr = $(`#ag tbody tr[data-i="${i}"]`); const amt = $('.am2,.dr:not([disabled]),.cr:not([disabled])', ntr); if (amt) amt.focus(); } } });
      const led = c.ledgers.find(x => x.id === l.ledger_id); if (led) { lg.value = led.name; lg.dataset.id = led.id; fillBills(tr, l); }
      if ($('.sd', tr)) $('.sd', tr).onchange = () => { l.side = $('.sd', tr).value; if (l.side === 'Dr') { l.dr = l.dr || l.cr; l.cr = 0; } else { l.cr = l.cr || l.dr; l.dr = 0; } drawAcc(); };
      if ($('.dr', tr)) $('.dr', tr).oninput = () => { l.dr = $('.dr', tr).value; recalc(); }; if ($('.cr', tr)) $('.cr', tr).oninput = () => { l.cr = $('.cr', tr).value; recalc(); };
      if ($('.am2', tr)) $('.am2', tr).oninput = () => { l.amt = $('.am2', tr).value; recalc(); };
      $('.ln', tr).oninput = () => { l.line_narr = $('.ln', tr).value; }; if ($('.cc', tr)) $('.cc', tr).onchange = () => { l.cost_centre_id = +$('.cc', tr).value || null; };
      $('.bl', tr).onchange = () => { const val = $('.bl', tr).value; l.bill = !val ? null : val === '__onacc' ? { type: 'onacc' } : val === '__new' ? { type: 'new' } : { type: 'agst', ref: val }; const opt = $('.bl', tr).selectedOptions[0]; if (opt && opt.dataset.amt && !(Number(l.amt) || Number(l.dr) || Number(l.cr))) { const a = Math.abs(+opt.dataset.amt); if (two) { l[l.side === 'Dr' ? 'dr' : 'cr'] = a; } else l.amt = a; drawAcc(); } };
      $$('input:not([disabled]),select', tr).forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !inp.dataset.combo) { e.preventDefault(); const nx = $$('input:not([disabled]),select', tr); const k = nx.indexOf(inp); if (k < nx.length - 1) nx[k + 1].focus(); else { const ntr = tr.nextElementSibling; if (ntr) $('.lg', ntr).focus(); else $('#vnarr').focus(); } } }));
      $('[data-x]', tr).onclick = () => { st.lines.splice(i, 1); if (!st.lines.length) st.lines.push({}); drawAcc(); };
    });
    recalc();
  }
  async function fillBills(tr, l) {
    const sel = $('.bl', tr); const led = c.ledgers.find(x => x.id === l.ledger_id);
    if (!led || !led.bill_wise) { sel.innerHTML = '<option value="">— not bill-wise —</option>'; sel.disabled = true; l.bill = null; return; }
    sel.disabled = false; let bills = await C('pendingBills', led.id);
    const cur = l.bill && l.bill.type === 'agst' ? l.bill.ref : null;
    if (st.saved && cur && !bills.some(b => b.ref === cur)) bills.push({ ref: cur, amount: 0, date: '' });
    sel.innerHTML = `<option value="__onacc">On Account</option><option value="__new" ${l.bill && l.bill.type === 'new' ? 'selected' : ''}>New Ref / Advance</option>` + bills.filter(b => !b.onacc).map(b => `<option value="${esc(b.ref)}" data-amt="${b.amount}" ${b.ref === cur ? 'selected' : ''}>Agst ${esc(b.ref)} · ${b.date ? U.fmtDate(b.date) : ''} · ₹${inr(Math.abs(b.amount))} ${b.amount > 0 ? 'Dr' : 'Cr'}</option>`).join('');
    if (!l.bill) { const firstBill = bills.find(b => !b.onacc && (vt === 'RCT' ? b.amount > 0 : vt === 'PMT' ? b.amount < 0 : true)); if (firstBill && (vt === 'RCT' || vt === 'PMT')) { sel.value = firstBill.ref; l.bill = { type: 'agst', ref: firstBill.ref }; } else { sel.value = '__onacc'; l.bill = { type: 'onacc' }; } }
  }

  if (isItem) { drawItems(); $('#iadd').onclick = () => { st.lines.push({}); drawItems(); $(`#ig tbody tr:last-child .it`).focus(); }; }
  else { drawAcc(); $('#aadd').onclick = () => { st.lines.push((vt === 'JRN' || vt === 'CNT') ? {} : {}); drawAcc(); }; }
  ['#vinc', '#vbd', '#vrcm'].forEach(sel => { if ($(sel)) $(sel).addEventListener('input', recalc); if ($(sel)) $(sel).addEventListener('change', recalc); });
  if ($('#vbomgo')) $('#vbomgo').onclick = async () => { const bid = +$('#vbom').value; if (!bid) return toast('Choose a BOM', 'err'); const b = await C('bom', bid); const q = Number($('#vbq').value) || 1; const fin = c.items.find(i => i.id === b.item_id);
    st.lines = [{ item_id: fin.id, item_name: fin.name, unit_name: fin.unit_name, qty: U.r3(q), rate: 0, direction: 1 }, ...b.items.map(x => { const it = c.items.find(i => i.id === x.item_id); return { item_id: it.id, item_name: it.name, unit_name: it.unit_name, qty: U.r3(x.qty * q / (b.qty || 1)), rate: 0, direction: -1 }; })]; drawItems(); toast('Components loaded; cost is computed on save', 'ok'); };

  // ---------- collect & save ----------
  function collect() {
    const o = { vtype: vt, date: $('#vdate').value, narration: $('#vnarr').value, number: $('#vno').value.trim() || undefined };
    if (st.id) { o.id = st.id; o.base_rev = st.rev != null ? st.rev : (v.rev || 0); }
    o.status = v.status || 'active';
    if (v.linked_id) o.linked_id = v.linked_id;
    if ($('#vcc')) o.cost_centre_id = +$('#vcc').value || null;
    if (isItem) {
      if ($('#vparty')) { o.party_id = +$('#vparty').dataset.id || null; if (!o.party_id && $('#vparty').value) throw new Error('Pick the party from the list (or create it with Alt+C)'); o.place_of_supply = $('#vpos').value; }
      if ($('#vref')) o.ref_no = $('#vref').value; if ($('#vorig')) o.orig_ref = $('#vorig').value || null; if ($('#vsp')) o.sp_ledger_id = +$('#vsp').value;
      if ($('#vbd')) o.bill_disc_pct = Number($('#vbd').value) || 0; if ($('#vinc')) o.tax_inclusive = $('#vinc').checked ? 1 : 0; if ($('#vrcm')) o.rcm = $('#vrcm').checked ? 1 : 0; if ($('#vsm')) o.salesman_id = +$('#vsm').value || null;
      if ($('#vbuyer')) Object.assign(o, { buyer_name: $('#vbuyer').value, ship_to: $('#vship').value, due_date: $('#vdue').value || null, ref_date: $('#vrefd').value || null, transport: $('#vtr').value, vehicle_no: $('#vveh').value.toUpperCase(), distance: $('#vdist').value, eway_no: $('#veway').value });
      if ($('#vbom')) o.bom_id = +$('#vbom').value || null;
      for (const l of st.lines) if (!l.item_id && $$('#ig tbody tr')[st.lines.indexOf(l)] && $('.it', $$('#ig tbody tr')[st.lines.indexOf(l)]).value.trim()) throw new Error('Item "' + $('.it', $$('#ig tbody tr')[st.lines.indexOf(l)]).value + '" is not in the item list. Pick it or create it (Alt+C).');
      o.items = st.lines.filter(l => l.item_id).map(l => ({ item_id: l.item_id, qty: Number(l.qty) || 0, rate: Number(l.rate) || 0, disc_pct: Number(l.disc_pct) || 0, gst_rate: Number(l.gst_rate ?? 0), cess_rate: Number(l.cess_rate) || 0, godown_id: +l.godown_id || null, batch_no: l.batch_no || null, exp_date: l.exp_date || null, mfg_date: l.mfg_date || null, descr: l.descr || null, direction: +l.direction || (isStock ? -1 : undefined) }));
    } else {
      const two = vt === 'JRN' || vt === 'CNT';
      const lines = st.lines.filter(l => l.ledger_id).map(l => ({ ledger_id: l.ledger_id, dr: two ? (l.side === 'Dr' ? Number(l.dr) || 0 : 0) : (vt === 'PMT' ? Number(l.amt) || 0 : 0), cr: two ? (l.side === 'Cr' ? Number(l.cr) || 0 : 0) : (vt === 'RCT' ? Number(l.amt) || 0 : 0), bill: l.bill || undefined, cost_centre_id: l.cost_centre_id || null, line_narr: l.line_narr || null, bank_date: l.bank_date || null }));
      if (!two) { const acc = +$('#vacc').dataset.id; if (!acc) throw new Error('Choose the Cash / Bank account'); const tot = U.r2(lines.reduce((a, l) => a + l.dr + l.cr, 0)); lines.unshift({ ledger_id: acc, dr: vt === 'RCT' ? tot : 0, cr: vt === 'PMT' ? tot : 0, bank_date: st.acc ? st.acc.bank_date : null }); o.pay_mode = $('#vmode').value; o.cheque_no = $('#vchq').value; o.cheque_date = $('#vchqd').value || null; }
      o.lines = lines;
    }
    return o;
  }
  async function save(after) {
    try {
      const o = collect(); const r = await C('saveVoucher', o); st.rev = r.rev;
      for (const w of r.warnings || []) toast(w, 'err');
      APP.current.dirty = false; toast(`${T.name} ${r.number} saved`, 'ok');
      if (after === 'print') await api('doc.pdf', 'voucher', r.id);
      if (after === 'new' || (!st.saved && after !== 'stay' && after !== 'print')) { go('voucher', { vtype: vt }, true); return; }
      go('voucher', { id: r.id }, true);
    } catch (e) { fail(e); }
  }
  // ---------- actions ----------
  const A = [];
  if (st.saved) {
    A.push(`<button class="btn" data-a="pdf">PDF / Preview <kbd>Ctrl+P</kbd></button><button class="btn" data-a="print">Print</button>`);
    if (['SAL', 'QTN', 'PFI', 'SOR', 'CRN'].includes(vt)) A.push(`<button class="btn" data-a="wa">WhatsApp</button><button class="btn" data-a="mail">Email</button>`);
    if (['SAL', 'CRN', 'DBN'].includes(vt)) A.push(`<button class="btn" data-a="einv">e-Invoice JSON</button>`);
    if (['SAL', 'PUR', 'DCH', 'CRN', 'DBN'].includes(vt)) A.push(`<button class="btn" data-a="eway">e-Way Bill JSON</button>`);
    if (vt === 'PMT') A.push(`<button class="btn" data-a="cheque">Print Cheque</button>`);
    if (CONVERT_TO[vt]) A.push(`<button class="btn" data-a="convert">Convert → ${esc(vtName(CONVERT_TO[vt]))}</button>`);
    A.push(`<button class="btn" data-a="dup">Duplicate</button>`); if (can('operator') && v.status === 'active') A.push(`<button class="btn" data-a="recur">Make recurring</button>`);
    if (v.status === 'active') A.push(`<button class="btn" data-a="opt">Make Optional</button><button class="btn danger" data-a="cancel">Cancel Voucher</button>`); else A.push(`<button class="btn" data-a="reg">Make Regular</button>`);
    if (can('admin')) A.push(`<button class="btn danger" data-a="del">Delete</button>`);
  }
  $('#vact').innerHTML = A.join('') + `<span style="flex:1"></span><button class="btn" data-a="back">Back (Esc)</button>${!st.saved ? '<button class="btn" data-a="savenew">Save & New</button><button class="btn" data-a="saveprint">Save & Print</button>' : ''}<button class="btn primary" data-a="save">${st.saved ? 'Save Changes' : 'Save'} <kbd>Ctrl+S</kbd></button>`;
  const act = {
    recur: async () => { if (await recurringDialog(null, st.id)) go('recurring', {}); },
    back: () => back(), save: () => save(st.saved ? 'stay' : 'new'), savenew: () => save('new'), saveprint: () => save('print'),
    pdf: () => api('doc.pdf', 'voucher', st.id).catch(fail), print: () => api('doc.print', 'voucher', st.id).catch(fail),
    wa: () => api('doc.share', 'whatsapp', st.id).then(() => toast(window.rs.web ? 'WhatsApp opened — use "Save as PDF" and attach it' : 'PDF saved & shown in folder; WhatsApp opened — attach the PDF', 'ok')).catch(fail),
    mail: () => api('doc.share', 'email', st.id).then(() => toast(window.rs.web ? 'Email draft opened — use "Save as PDF" and attach it' : 'PDF saved & shown in folder; email draft opened — attach the PDF', 'ok')).catch(fail),
    einv: async () => { try { const j = await C('einvoiceJson', st.id); const r = await api('export.json', j, 'eInvoice ' + v.number); if (r) toast('e-Invoice JSON saved: ' + r.file, 'ok'); } catch (e) { fail(e); } },
    eway: async () => { try { const j = await C('ewayJson', st.id); const r = await api('export.json', j, 'eWayBill ' + v.number); if (r) toast('e-Way Bill JSON saved (upload on ewaybillgst.gov.in → Bulk)', 'ok'); } catch (e) { fail(e); } },
    cheque: async () => { const pr = await promptBox('Print Cheque', [{ k: 'payee', label: 'Payee name', w: 2 }, { k: 'ac', label: 'A/C Payee crossing', type: 'check', def: 1 }], { payee: v.party_name }); if (pr) api('doc.pdf', 'cheque', st.id, { payee: pr.payee, ac: !!pr.ac }).catch(fail); },
    convert: async () => { const inp = await C('convertVoucher', st.id, CONVERT_TO[vt]); go('voucher', { vtype: CONVERT_TO[vt], prefill: inp }); },
    dup: async () => { try { const r = await C('duplicateVoucher', st.id, APP.date); toast('Duplicated as ' + r.number, 'ok'); go('voucher', { id: r.id }, true); } catch (e) { fail(e); } },
    opt: async () => { try { await C('setVoucherStatus', st.id, 'optional'); toast('Marked optional (no effect on books)', 'ok'); render(); } catch (e) { fail(e); } },
    reg: async () => { try { await C('setVoucherStatus', st.id, 'active'); toast('Voucher is regular again', 'ok'); render(); } catch (e) { fail(e); } },
    cancel: async () => { if (await confirmBox('Cancel this voucher? The number stays, amounts become zero in books.', 'Cancel voucher', true)) { try { await C('setVoucherStatus', st.id, 'cancelled'); toast('Voucher cancelled', 'ok'); render(); } catch (e) { fail(e); } } },
    del: async () => { if (await confirmBox(`Delete ${T.name} ${v.number}? This is logged in the audit trail.`, 'Delete', true)) { try { await C('deleteVoucher', st.id); toast('Deleted', 'ok'); APP.current.dirty = false; back(); } catch (e) { fail(e); } } },
  };
  $$('#vact [data-a]').forEach(b => b.onclick = () => act[b.dataset.a]());
  APP.current.keys = e => { const k = e.key.toLowerCase(); if (e.ctrlKey && (k === 's' || k === 'a')) { save(st.saved ? 'stay' : 'new'); return true; } if (e.ctrlKey && k === 'p' && st.saved) { act.pdf(); return true; } if (e.altKey && k === 'p' && st.saved) { act.print(); return true; } if (e.altKey && k === 'd' && st.saved && can('admin')) { act.del(); return true; } if (e.altKey && k === '2' && st.saved) { act.dup(); return true; } };
  const first = st.saved ? $('#vdate') : ($('#vparty') || $('#vacc') || $('#vbom') || $('#ig .it') || $('#ag .lg')); if (first) first.focus();
};
