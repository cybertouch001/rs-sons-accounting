
// R&S Sons Accounting - report viewer
'use strict';
const REPORT_FILTERS = {
  dayBook: ['period', 'vtype'], trialBalance: ['period', 'detailed'], profitLoss: ['period'], balanceSheet: ['asOn'], ledgerStatement: ['period', 'ledger'], cashBook: ['period', 'cashLedger'], bankBook: ['period', 'bankLedger'],
  register: ['period', 'vtypeReq'], monthlySummary: ['period'], stockSummary: ['period'], itemLedger: ['period', 'item'], godownStock: ['asOn'], batchStock: ['asOn'], reorderReport: ['asOn'], slowMoving: ['asOn'],
  itemAnalysis: ['period', 'side'], partyAnalysis: ['period', 'side'], salesmanReport: ['period'], outstanding: ['asOn', 'kind', 'byDue', 'detail'], interestReport: ['asOn', 'rate'], cashFlow: ['period'], ratios: ['period'], budgetReport: ['period'],
  costCentreReport: ['period'], brs: ['asOn', 'bankLedger', 'all'], tdsReport: ['period', 'tdsKind'], depreciationChart: ['asOn'], salaryRegister: ['month'], auditLog: ['period'], gstr1: ['period', 'gstSection'], gstr3b: ['period'], gstSummary: ['period'], groupSummary: ['period'],
};
const PERIOD_PRESETS = () => { const fy = fyRange(); const t = APP.date; const m0 = t.slice(0, 8) + '01'; const pm = new Date(Date.parse(m0) - 86400000).toISOString().slice(0, 10);
  const q = (() => { const m = +t.slice(5, 7); const qs = m >= 4 && m <= 6 ? ['04', '06'] : m >= 7 && m <= 9 ? ['07', '09'] : m >= 10 && m <= 12 ? ['10', '12'] : ['01', '03']; const y = t.slice(0, 4); const last = new Date(Date.UTC(+y, +qs[1], 0)).toISOString().slice(0, 10); return [`${y}-${qs[0]}-01`, last]; })();
  return [['Financial Year', fy.from, fy.to], ['Today', t, t], ['This Month', m0, new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7), 0)).toISOString().slice(0, 10)], ['Last Month', pm.slice(0, 8) + '01', pm], ['This Quarter', q[0], q[1]], ['Year to Date', fy.from, t]]; };

function repTable(rep, opts = {}) {
  const cols = rep.columns;
  const fmt = (c, v) => { if (v == null || v === '') return ''; if (c.t === 'amt') return `<span class="${v < 0 ? 'neg' : ''}">${inr(v)}</span>`; if (c.t === 'qty') return String(U.r3(v)); if (c.t === 'num') return typeof v === 'number' ? String(U.r2(v)) : esc(v); if (c.t === 'date') return U.fmtDate(v); return esc(v); };
  const al = c => (['amt', 'qty', 'num'].includes(c.t) || c.align === 'right') ? 'r' : '';
  let body;
  if (rep.tformat) body = rep.rows.map((r, i) => `<tr class="${r._total ? 'tot' : ''}" data-i="${i}"><td class="${r._ldrill ? 'dl' : ''}" data-side="l" style="padding-left:${8 + (r._li || 0) * 16}px;${r._li ? 'color:var(--sub)' : 'font-weight:600'}">${esc(r.lp)}</td><td class="r" style="${r._li ? 'color:var(--sub)' : 'font-weight:600'}">${r.la == null ? '' : inr(r.la)}</td><td class="${r._rdrill ? 'dl' : ''}" data-side="r" style="border-left:2px solid var(--line);padding-left:${8 + (r._ri || 0) * 16}px;${r._ri ? 'color:var(--sub)' : 'font-weight:600'}">${esc(r.rp)}</td><td class="r" style="${r._ri ? 'color:var(--sub)' : 'font-weight:600'}">${r.ra == null ? '' : inr(r.ra)}</td></tr>`).join('');
  else body = rep.rows.map((r, i) => `<tr data-i="${i}" class="${r._drill ? 'drill' : ''} ${r._b ? 'b' : ''} ${r._warn ? 'warn' : ''}">${cols.map((c, j) => `<td class="${al(c)} ${c.k === 'summary' || c.k === 'narration' || c.k === 'narr' ? 'wrap' : ''}" style="${j === 0 && r._l ? 'padding-left:' + (8 + r._l * 16) + 'px' : ''}">${r._edit && c.k === r._edit ? `<input type="date" class="bd" data-e="${r.entry_id}" value="${esc(r[c.k] || '')}">` : fmt(c, r[c.k])}</td>`).join('')}</tr>`).join('');
  const foot = rep.foot ? `<tfoot><tr>${cols.map(c => `<td class="${al(c)}">${fmt(c, rep.foot[c.k])}</td>`).join('')}</tr></tfoot>` : '';
  return `<div class="tbl-wrap" id="rwrap"><table class="tbl" id="rtbl"><thead><tr>${cols.map((c, i) => `<th class="${al(c)}" data-c="${i}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" style="padding:18px;color:var(--muted)">No entries for this period.</td></tr>`}</tbody>${foot}</table></div>`;
}

SCREENS.report = async (el, p) => {
  const r = p.r; const filters = REPORT_FILTERS[r] || ['period']; const c = await loadCache();
  const a = Object.assign({}, p.a || {});
  const fy = fyRange();
  if (filters.includes('period')) { if (!a.from) a.from = r === 'dayBook' ? APP.date : fy.from; if (!a.to) a.to = r === 'dayBook' ? APP.date : fy.to; }
  if (filters.includes('asOn') && !a.to) a.to = ['balanceSheet', 'depreciationChart'].includes(r) ? (APP.date > fy.to ? fy.to : (r === 'depreciationChart' ? fy.to : APP.date)) : APP.date;
  if (r === 'balanceSheet' && !p.a) a.to = APP.date;
  const bar = [];
  if (filters.includes('period')) bar.push(`<select id="rpre" title="Period">${['<option value="">Period…</option>', ...PERIOD_PRESETS().map((x, i) => `<option value="${i}">${x[0]}</option>`)].join('')}</select><input type="date" id="rfrom" value="${a.from}"> to <input type="date" id="rto" value="${a.to}">`);
  if (filters.includes('asOn')) bar.push(`As on <input type="date" id="rto" value="${a.to}">`);
  if (filters.includes('vtype')) bar.push(`<select id="rvt"><option value="">All voucher types</option>${Object.entries(APP.info.company.vtypes).map(([k, t]) => `<option value="${k}" ${a.vtype === k ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`);
  if (filters.includes('vtypeReq')) bar.push(`<select id="rvt">${Object.entries(APP.info.company.vtypes).map(([k, t]) => `<option value="${k}" ${a.vtype === k ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`);
  if (filters.includes('detailed')) bar.push(`<label><input type="checkbox" id="rdet" ${a.detailed === false ? '' : 'checked'}> Ledger-wise</label>`);
  if (filters.includes('ledger') || filters.includes('cashLedger') || filters.includes('bankLedger')) bar.push(`<input id="rled" data-combo="1" placeholder="Ledger" style="width:240px">`);
  if (filters.includes('item')) bar.push(`<input id="ritem" data-combo="1" placeholder="Item" style="width:240px">`);
  if (filters.includes('side')) bar.push(`<select id="rside"><option value="sale" ${a.side !== 'purchase' ? 'selected' : ''}>Sales</option><option value="purchase" ${a.side === 'purchase' ? 'selected' : ''}>Purchase</option></select>`);
  if (filters.includes('kind')) bar.push(`<select id="rkind"><option value="receivable" ${a.kind !== 'payable' ? 'selected' : ''}>Receivables</option><option value="payable" ${a.kind === 'payable' ? 'selected' : ''}>Payables</option></select>`);
  if (filters.includes('byDue')) bar.push(`<label><input type="checkbox" id="rdue" ${a.byDue ? 'checked' : ''}> Age by due date</label>`);
  if (filters.includes('detail')) bar.push(`<label><input type="checkbox" id="rdetail" ${a.detail ? 'checked' : ''}> Bill-wise detail</label>`);
  if (filters.includes('rate')) bar.push(`Rate % <input id="rrate" type="number" style="width:60px" value="${a.rate || 18}">`);
  if (filters.includes('all')) bar.push(`<label><input type="checkbox" id="rall" ${a.all ? 'checked' : ''}> Show reconciled too</label>`);
  if (filters.includes('tdsKind')) bar.push(`<select id="rtk"><option ${a.kind !== 'TCS' ? 'selected' : ''}>TDS</option><option ${a.kind === 'TCS' ? 'selected' : ''}>TCS</option></select>`);
  if (filters.includes('month')) bar.push(`Month <input type="month" id="rmon" value="${a.month || APP.date.slice(0, 7)}">`);
  if (filters.includes('gstSection')) bar.push(`<select id="rsec">${[['summary', 'Summary'], ['b2b', 'B2B'], ['b2cl', 'B2C Large'], ['b2cs', 'B2C Small'], ['cdnr', 'CDN Registered'], ['cdnur', 'CDN Unregistered'], ['hsn', 'HSN Summary'], ['docs', 'Documents']].map(([k, l]) => `<option value="${k}" ${(a.section || 'summary') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
  const exp = [`<button class="btn" id="rgo">Refresh</button>`, `<input id="rq" placeholder="Search in report" style="width:170px">`, `<span class="sp"></span>`];
  if (r === 'gstr1') exp.push(`<button class="btn" id="rj1">GSTR-1 JSON</button><button class="btn" id="rx1">GSTR-1 Excel (all sheets)</button>`);
  if (r === 'gstr3b') exp.push(`<button class="btn" id="rj3">GSTR-3B JSON</button>`);
  if (r === 'depreciationChart' && can('operator')) exp.push(`<button class="btn" id="rdep">Post Depreciation Journal</button>`);
  exp.push(`<button class="btn" id="rxl">Excel</button><button class="btn" id="rpdf">PDF <kbd>Ctrl+P</kbd></button><button class="btn" id="rprt">Print</button><button class="btn" id="rcsv">CSV</button><button class="btn" id="rhtm">HTML</button>`);
  el.innerHTML = `<h2 class="title" id="rtitle">Loading…</h2><div class="toolbar">${bar.join('')}${exp.join('')}</div><div id="rchart"></div><div id="rout"></div>`;
  // ledger / item pickers
  if ($('#rled')) { const filt = filters.includes('cashLedger') ? (l => underGroups(l, ['Cash-in-Hand'])) : filters.includes('bankLedger') ? (l => underGroups(l, ['Bank Accounts', 'Bank OD A/c'])) : null; combo($('#rled'), { source: ledgerSrc(filt), onSelect: x => { if (x) { a.ledger_id = +x.id; load(); } } }); const l = c.ledgers.find(x => x.id === a.ledger_id); if (l) { $('#rled').value = l.name; $('#rled').dataset.id = l.id; } }
  if ($('#ritem')) { combo($('#ritem'), { source: itemSrc(), onSelect: x => { if (x) { a.item_id = +x.id; load(); } } }); const it = c.items.find(x => x.id === a.item_id); if (it) { $('#ritem').value = it.name; $('#ritem').dataset.id = it.id; } }
  let rep = null, cur = -1;
  async function load() {
    if ($('#rfrom')) a.from = $('#rfrom').value; if ($('#rto')) a.to = $('#rto').value; if ($('#rvt')) a.vtype = $('#rvt').value || undefined; if ($('#rdet')) a.detailed = $('#rdet').checked;
    if ($('#rside')) a.side = $('#rside').value; if ($('#rkind')) a.kind = $('#rkind').value; if ($('#rdue')) a.byDue = $('#rdue').checked; if ($('#rdetail')) a.detail = $('#rdetail').checked; if ($('#rrate')) a.rate = $('#rrate').value; if ($('#rall')) a.all = $('#rall').checked; if ($('#rtk')) a.kind = $('#rtk').value; if ($('#rmon')) a.month = $('#rmon').value; if ($('#rsec')) a.section = $('#rsec').value;
    APP.current.params.a = Object.assign({}, a);
    if (filters.includes('ledger') && !a.ledger_id) { $('#rtitle').textContent = 'Ledger Statement'; $('#rout').innerHTML = '<div class="card">Choose a ledger above.</div>'; $('#rled').focus(); return; }
    if (filters.includes('item') && !a.item_id) { $('#rtitle').textContent = 'Stock Item Ledger'; $('#rout').innerHTML = '<div class="card">Choose an item above.</div>'; $('#ritem').focus(); return; }
    try { rep = await C(r, a); } catch (e) { $('#rtitle').textContent = 'Report'; $('#rout').innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    APP.cache.lastRep = rep;
    $('#rtitle').innerHTML = `${esc(rep.title)} <small>${esc(rep.subtitle || '')}</small>${rep.meta && rep.meta.balanced === false ? '<span class="pill red">NOT BALANCED</span>' : rep.meta && rep.meta.balanced ? '<span class="pill green">✔ Tallied</span>' : ''}`;
    if (rep.chart && rep.rows.length) { const ch = rep.chart; const rows = rep.rows.slice(0, ch.limit || 24).map(x => { const o = { label: x[ch.x] }; for (const s of ch.series) o[(rep.columns.find(cc => cc.k === s) || { label: s }).label] = x[s]; return o; }); $('#rchart').innerHTML = `<div class="card" style="padding:8px 12px">${barChart(rows, ch.series.map(s => (rep.columns.find(cc => cc.k === s) || { label: s }).label))}</div>`; } else $('#rchart').innerHTML = '';
    $('#rout').innerHTML = repTable(rep); cur = -1; bindRows(); filter();
  }
  function rowDrill(i, side) {
    const row = rep.rows[i]; if (!row) return; const d = rep.tformat ? (side === 'r' ? row._rdrill : row._ldrill || row._rdrill) : row._drill; if (!d) return;
    if (d.voucher) go('voucher', { id: d.voucher }); else go('report', { r: d.r, a: d.a });
  }
  function bindRows() {
    $$('#rtbl tbody tr').forEach(tr => { tr.onclick = (e) => { if (e.target.tagName === 'INPUT') return; const td = e.target.closest('td'); rowDrill(+tr.dataset.i, td && td.dataset.side); }; });
    $$('#rtbl input.bd').forEach(inp => inp.onchange = async () => { try { await C('setBankDate', +inp.dataset.e, inp.value || null); toast('Bank date saved', 'ok'); } catch (e) { fail(e); } });
    $$('#rtbl thead th').forEach(th => th.onclick = () => { if (rep.tformat) return; const col = rep.columns[+th.dataset.c]; const dir = th.dataset.dir === 'asc' ? -1 : 1; th.dataset.dir = dir === 1 ? 'asc' : 'desc'; rep.rows.sort((x, y) => { const p1 = x[col.k], p2 = y[col.k]; if (typeof p1 === 'number' || typeof p2 === 'number') return ((p1 || 0) - (p2 || 0)) * dir; return String(p1 || '').localeCompare(String(p2 || '')) * dir; }); $('#rout').innerHTML = repTable(rep); bindRows(); });
  }
  function filter() { const q = ($('#rq').value || '').toLowerCase(); $$('#rtbl tbody tr').forEach(tr => tr.classList.toggle('hidden', !!q && !tr.textContent.toLowerCase().includes(q))); }
  function moveCur(d) { const trs = $$('#rtbl tbody tr').filter(t => !t.classList.contains('hidden')); if (!trs.length) return; let k = trs.findIndex(t => t.classList.contains('cur')); trs.forEach(t => t.classList.remove('cur')); k = Math.max(0, Math.min(trs.length - 1, k + d)); trs[k].classList.add('cur'); trs[k].scrollIntoView({ block: 'nearest' }); cur = +trs[k].dataset.i; }
  $('#rq').oninput = filter; $('#rgo').onclick = load;
  $$('.toolbar input[type=date], .toolbar select:not(#rpre), .toolbar input[type=checkbox], .toolbar input[type=month]', el).forEach(x => x.addEventListener('change', load));
  if ($('#rpre')) $('#rpre').onchange = () => { const x = PERIOD_PRESETS()[+$('#rpre').value]; if (x) { $('#rfrom').value = x[1]; $('#rto').value = x[2]; load(); } };
  const pdf = () => rep && api('doc.pdf', 'report', 0, { report: rep, landscape: rep.columns.length > 7 }).catch(fail);
  $('#rpdf').onclick = pdf; $('#rprt').onclick = () => rep && api('doc.print', 'report', 0, { report: rep }).catch(fail);
  $('#rxl').onclick = () => rep && api('export.excel', rep).then(x => x && toast('Excel saved: ' + x.file, 'ok')).catch(fail);
  $('#rcsv').onclick = () => { if (!rep) return; const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; const lines = [rep.columns.map(cc => q(cc.label)).join(','), ...rep.rows.map(row => rep.columns.map(cc => q(row[cc.k])).join(','))]; if (rep.foot) lines.push(rep.columns.map(cc => q(rep.foot[cc.k])).join(',')); api('export.text', '\ufeff' + lines.join('\r\n'), rep.title, 'csv').then(x => x && toast('CSV saved', 'ok')).catch(fail); };
  $('#rhtm').onclick = async () => { if (!rep) return; const h = await api('doc.html', 'report', 0, { report: rep }); api('export.text', h, rep.title, 'html').then(x => x && toast('HTML saved', 'ok')).catch(fail); };
  if ($('#rj1')) $('#rj1').onclick = async () => { try { const j = await C('gstr1Json', a); const x = await api('export.json', j, `GSTR1_${j.fp}`); if (x) toast('GSTR-1 JSON saved — upload via GST offline tool / portal', 'ok'); } catch (e) { fail(e); } };
  if ($('#rx1')) $('#rx1').onclick = () => api('export.gstr1Excel', a).then(x => x && toast('GSTR-1 Excel saved', 'ok')).catch(fail);
  if ($('#rj3')) $('#rj3').onclick = async () => { try { const j = await C('gstr3bJson', a); const x = await api('export.json', j, `GSTR3B_${j.ret_period}`); if (x) toast('GSTR-3B JSON saved', 'ok'); } catch (e) { fail(e); } };
  if ($('#rdep')) $('#rdep').onclick = async () => { if (!await confirmBox('Post depreciation journal for this financial year (dated 31 March)?', 'Post')) return; try { const x = await C('postDepreciation', a); toast('Journal ' + x.number + ' posted', 'ok'); load(); } catch (e) { fail(e); } };
  APP.current.keys = e => { if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.id !== 'rq') return false;
    if (e.key === 'ArrowDown') { moveCur(1); return true; } if (e.key === 'ArrowUp') { moveCur(-1); return true; } if (e.key === 'Enter' && cur >= 0) { rowDrill(cur); return true; } if (e.ctrlKey && e.key.toLowerCase() === 'p') { pdf(); return true; } };
  await load();
  if (document.activeElement === document.body || !document.activeElement) moveCur(1);
};
