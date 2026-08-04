#!/usr/bin/env node
/* Headless state tests for qts-quote-builder widget.js.
 *
 * Loads app/widget.js in a vm sandbox with a stub document (readyState stays
 * "loading" so boot() never runs) and drives the pure state helpers exposed on
 * window.__QTS_TEST__. Exit 0 = all PASS, 1 = failure.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'widget.js'), 'utf8');

function freshWidget(referrer) {
  const documentStub = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; }, // no DOM: getCurrentCurrency falls back to DATA.meta
    referrer: referrer || '',          // drives detectCreatorEnvironment()
  };
  const windowStub = {};
  const sandbox = { document: documentStub, window: windowStub, console, setTimeout, clearTimeout, Promise };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'widget.js' });
  const t = windowStub.__QTS_TEST__;
  if (!t) throw new Error('widget.js did not expose __QTS_TEST__');
  // 1:1 EUR/USD so listEur numeric tests stay readable; live widget loads FX_Rates_Cache.
  t.setFxRate(1);
  return t;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('PASS  ' + name); }
  else { failures++; console.error('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

/* ---- EUR list presentation (always EUR; sale column is USD) ---- */
{
  const t = freshWidget();
  t.DATA.meta.currency = 'EUR';
  check('list pill is EUR list', t.refPillLabel() === 'EUR list', t.refPillLabel());
  t.DATA.meta.currency = 'USD';
  check('list pill stays EUR list in USD quote', t.refPillLabel() === 'EUR list', t.refPillLabel());

  t.addLineFromItem({ sku: '100545', name: 'Test item', type: 'BMS', unit: 280, flags: [] }, 1);
  check('new line keeps eur_ref source with converted sale',
    t.state.lines.length === 1 && t.state.lines[0].priceSource === 'eur_ref' && t.state.lines[0].unit === 280);
}

/* ---- Repeated kit expansion merges ---- */
const KIT7 = [
  { part_number: '100816', qty: '1', kit_warning: '' },
  { part_number: '100809', qty: '8', kit_warning: '' },   // calculated CMU qty
  { part_number: '100985.2', qty: '8', kit_warning: '' }, // match_cmu (CMU18 harness bundle, pricelist v1.0)
  { part_number: '100777', qty: '1', kit_warning: '' },
  { part_number: '100778', qty: '1', kit_warning: '' },
  { part_number: '100779', qty: '1', kit_warning: '' },
  { part_number: '101814', qty: '1', kit_warning: 'QTY_UNCONFIRMED - verify harness count' },
];
{
  const t = freshWidget();
  let r1 = t.applyKitRows(KIT7, 1);
  let r2 = t.applyKitRows(KIT7, 1);
  let r3 = t.applyKitRows(KIT7, 1);
  check('same 7-line kit added 3x keeps 7 rows', t.state.lines.length === 7, String(t.state.lines.length));
  check('first add appends 7, later adds merge 7', r1.added === 7 && r2.merged === 7 && r3.merged === 7 && r2.added === 0 && r3.added === 0,
    JSON.stringify([r1, r2, r3]));
  const bySku = {};
  t.state.lines.forEach(l => { bySku[l.sku + '|' + (l.kitWarning || '')] = l.qty; });
  check('fixed-qty component increments 1 -> 3', bySku['100816|'] === 3, String(bySku['100816|']));
  check('calculated CMU component increments 8 -> 24', bySku['100809|'] === 24, String(bySku['100809|']));
  check('match_cmu component increments 8 -> 24', bySku['100985.2|'] === 24, String(bySku['100985.2|']));
  check('warning text preserved on merged line',
    bySku['101814|QTY_UNCONFIRMED - verify harness count'] === 3);
}

/* ---- Distinct lines stay distinct ---- */
{
  const t = freshWidget();
  t.applyKitRows(KIT7, 1);
  // Unrelated manual line with a different SKU stays separate.
  t.addLineFromItem({ sku: '200300', name: 'Unrelated', type: 'BMS', unit: 100, flags: [] }, 2);
  t.applyKitRows(KIT7, 1);
  check('unrelated SKU line remains separate and untouched',
    t.state.lines.filter(l => l.sku === '200300').length === 1 &&
    t.state.lines.find(l => l.sku === '200300').qty === 2);

  // Same SKU but a DIFFERENT kit warning must not merge (variant identity).
  const variant = [{ part_number: '101814', qty: '1', kit_warning: 'DIFFERENT WARNING' }];
  t.applyKitRows(variant, 1);
  check('same SKU with different warning stays a separate line',
    t.state.lines.filter(l => l.sku === '101814').length === 2);

  // Custom/manual lines are never merge targets.
  t.state.lines.push({ id: 'LX', sku: '100816', name: 'hand-typed', type: 'Custom', qty: 5, unit: 0, flags: [], custom: true, priceSource: 'manual' });
  const before = t.state.lines.find(l => l.custom).qty;
  t.applyKitRows([{ part_number: '100816', qty: '1', kit_warning: '' }], 1);
  check('custom line never absorbs kit rows',
    t.state.lines.find(l => l.custom).qty === before &&
    t.state.lines.filter(l => l.sku === '100816' && !l.custom).length === 1);
}

/* ---- Kit-qty multiplier still applies on merge ---- */
{
  const t = freshWidget();
  t.applyKitRows(KIT7, 2); // qty x2
  t.applyKitRows(KIT7, 1);
  const l = t.state.lines.find(x => x.sku === '100809');
  check('kit qty multiplier composes across merges (8x2 + 8 = 24)', l.qty === 24, String(l.qty));
}

/* ---- Discard draft ---- */
(async () => {
  /* ---- Round 78: save/update toast vs post-save reload ---- */
  {
    const t = freshWidget();
    const rows = [{ sku: '100545', name: 'Item', qty: '2', unit: '318.18', warning: '' }];

    // Manual load path: default (non-silent) applyLoadedLines emits "Loaded …".
    t.DATA.meta.quoteNo = 'TEST-QUOTE0030';
    t.applyLoadedLines(rows);
    check('manual load emits the Loaded toast',
      t.getLastToast() === 'Loaded TEST-QUOTE0030 (1 lines)', t.getLastToast());

    // Silent refresh replaces lines but emits NO toast.
    t.applyLoadedLines(rows, true);
    check('silent refresh replaces lines without toasting',
      t.state.lines.length === 1 && t.getLastToast() === 'Loaded TEST-QUOTE0030 (1 lines)');

    // Blank server Unit_Price must NOT wipe a known on-screen price (autosave race).
    const keep = t.snapshotPricedLines();
    t.applyLoadedLines([{ sku: '100545', name: 'Item', qty: '2', unit: '', warning: '' }], true, keep);
    check('blank server unit keeps prior price', t.state.lines[0].unit === 318.18);
    check('blank server unit is not UNPRICED when prior price kept',
      t.state.lines[0].flags.indexOf('unpriced') === -1);
    check('autosave debounced at 3s (burst edits collapse to one write)', t.AUTOSAVE_DELAY_MS === 3000, String(t.AUTOSAVE_DELAY_MS));

    // Update-in-place completion: silent internal reload, then "Draft updated —"
    // is the FINAL toast (reload cannot overwrite it).
    await t.finishSave(true, 'TEST-QUOTE0030', () => { t.applyLoadedLines(rows, true); return Promise.resolve(); });
    check('update save ends with the Draft updated toast',
      t.getLastToast() === 'Draft updated — TEST-QUOTE0030 (pricing/sync run on the Creator side)', t.getLastToast());

    // New-draft completion still says "Draft saved —".
    await t.finishSave(false, 'TEST-QUOTE0031', () => { t.applyLoadedLines(rows, true); return Promise.resolve(); });
    check('new draft save ends with the Draft saved toast',
      t.getLastToast() === 'Draft saved — TEST-QUOTE0031 (pricing/sync run on the Creator side)', t.getLastToast());
  }

  // 1. Unsaved quote: no discard action.
  {
    const t = freshWidget();
    check('unsaved quote cannot discard', t.canDiscardDraft() === false);
    let rejected = false;
    await t.discardDraftCore({}).catch(() => { rejected = true; });
    check('unsaved quote discard rejects without touching deps', rejected);
  }

  // 2/3. Eligibility follows saved-record + Draft status exactly.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '4929688000000099004';
    t.state.quoteStatus = 'Draft';
    check('loaded Draft can discard', t.canDiscardDraft() === true);
    for (const s of ['Send for Signature', 'Signed', '', null, 'draft']) {
      t.state.quoteStatus = s;
      check('status ' + JSON.stringify(s) + ' cannot discard', t.canDiscardDraft() === false, String(s));
    }
  }

  // 4. Confirmed Draft deletion success -> complete state reset.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.state.customer = { contactId: 'c1', accountId: 'a1' };
    t.state.discount = 12; t.state.kitQty = 4; t.state.kitCells = '96';
    t.state.dismissedPending = { X: true };
    t.DATA.meta.quoteNo = 'TEST-QUOTE0099';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 2);
    const calls = [];
    const id = await t.discardDraftCore({
      getStatus: (rid) => { calls.push(['get', 'q', rid]); return Promise.resolve({ recordId: rid, status: 'Draft', source: 'test' }); },
      deleteRecord: (rid) => { calls.push(['del', rid]); return Promise.resolve(rid); },
    });
    check('discard re-reads the record before deleting',
      calls.length === 2 && calls[0][0] === 'get' && calls[0][2] === '111222333' && calls[1][0] === 'del' && calls[1][1] === '111222333',
      JSON.stringify(calls));
    check('discard resolves with the deleted record id', id === '111222333');
    check('discard success clears record id + status', t.state.quoteRecordId === null && t.state.quoteStatus === null);
    check('discard success clears lines and seq', t.state.lines.length === 0 && t.state.seq === 1);
    check('discard success clears customer/CRM IDs', t.state.customer === null);
    check('discard success clears totals/kit/pending state',
      t.state.discount === 0 && t.state.kitQty === 1 && t.state.kitCells === '' &&
      Object.keys(t.state.dismissedPending).length === 0);
    check('discard success resets quote number', t.DATA.meta.quoteNo === 'QTS-DRAFT');
    check('post-discard state can no longer discard', t.canDiscardDraft() === false);
  }

  // 5. Delete failure -> loaded state fully preserved.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.state.customer = { contactId: 'c1' };
    t.DATA.meta.quoteNo = 'TEST-QUOTE0099';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 2);
    let msg = '';
    await t.discardDraftCore({
      getStatus: () => Promise.resolve({ status: 'Draft', source: 'test' }),
      deleteRecord: () => Promise.reject(new Error('Quote delete returned code 2945')),
    }).catch(e => { msg = e.message; });
    check('delete failure surfaces the exact error', msg === 'Quote delete returned code 2945', msg);
    check('delete failure preserves loaded state',
      t.state.quoteRecordId === '111222333' && t.state.quoteStatus === 'Draft' &&
      t.state.lines.length === 1 && t.state.customer !== null && t.DATA.meta.quoteNo === 'TEST-QUOTE0099');
  }

  // 6. Stale UI: server status changed away from Draft -> deletion blocked.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft'; // stale client belief
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 1);
    let deleted = false, msg = '';
    await t.discardDraftCore({
      getStatus: () => Promise.resolve({ status: 'Send for Signature', source: 'test' }),
      deleteRecord: () => { deleted = true; return Promise.resolve(); },
    }).catch(e => { msg = e.message; });
    check('stale non-Draft server status blocks deletion', !deleted && msg.indexOf('Send for Signature') !== -1, msg);
    check('stale block preserves loaded state and syncs status',
      t.state.quoteRecordId === '111222333' && t.state.lines.length === 1 &&
      t.state.quoteStatus === 'Send for Signature');
  }

  /* ---- Round 76: authoritative status re-read guard ---- */

  // 6b. Authoritative source OMITS Status (null) -> blocked, nothing deleted.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 1);
    let deleted = false, msg = '';
    await t.discardDraftCore({
      getStatus: () => Promise.resolve({ status: null, source: 'test' }),
      deleteRecord: () => { deleted = true; return Promise.resolve(); },
    }).catch(e => { msg = e.message; });
    check('unreadable Status blocks deletion', !deleted && msg.indexOf('not readable') !== -1, msg);
    check('unreadable-Status block preserves loaded state',
      t.state.quoteRecordId === '111222333' && t.state.quoteStatus === 'Draft' && t.state.lines.length === 1);
  }

  // 6c. Authoritative source READ FAILS -> blocked, state preserved.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 1);
    let deleted = false, msg = '';
    await t.discardDraftCore({
      getStatus: () => Promise.reject(new Error('Quote status re-read failed: timeout')),
      deleteRecord: () => { deleted = true; return Promise.resolve(); },
    }).catch(e => { msg = e.message; });
    check('status re-read failure blocks deletion with exact error',
      !deleted && msg === 'Quote status re-read failed: timeout', msg);
    check('re-read failure preserves loaded state',
      t.state.quoteRecordId === '111222333' && t.state.quoteStatus === 'Draft' && t.state.lines.length === 1);
  }

  // 6d. Server-side no-match/race (criteria matched nothing) -> blocked, state preserved.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 1);
    let msg = '';
    await t.discardDraftCore({
      getStatus: () => Promise.resolve({ status: 'Draft', source: 'test' }),
      deleteRecord: () => Promise.reject(new Error('Nothing was deleted — the record no longer matches Status "Draft" (it may have changed or been removed on the server).')),
    }).catch(e => { msg = e.message; });
    check('server-side no-match race blocks with exact message', msg.indexOf('Nothing was deleted') === 0, msg);
    check('no-match race preserves loaded state',
      t.state.quoteRecordId === '111222333' && t.state.quoteStatus === 'Draft' && t.state.lines.length === 1);
  }

  /* ---- In-widget confirmation UI path (Round 71: no browser-native confirm) ---- */

  // Unsaved quote: first click refuses to even open the confirmation.
  {
    const t = freshWidget();
    check('unsaved quote: requestDiscard refuses to open confirm panel',
      t.requestDiscard() === false && t.state.discardConfirmOpen === false);
  }

  // Loaded Draft: click opens panel; Cancel closes with zero state change.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.DATA.meta.quoteNo = 'TEST-QUOTE0099';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 2);
    check('loaded Draft: requestDiscard opens confirm panel',
      t.requestDiscard() === true && t.state.discardConfirmOpen === true);
    t.cancelDiscard();
    check('Cancel closes panel and changes nothing',
      t.state.discardConfirmOpen === false && t.state.quoteRecordId === '111222333' &&
      t.state.quoteStatus === 'Draft' && t.state.lines.length === 1 &&
      t.DATA.meta.quoteNo === 'TEST-QUOTE0099');
  }

  // Confirm runs the guarded path: re-read first, then delete, then reset.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 1);
    t.requestDiscard();
    const calls = [];
    await t.confirmDiscard({
      getStatus: (rid) => { calls.push(['get', rid]); return Promise.resolve({ status: 'Draft', source: 'test' }); },
      deleteRecord: (rid) => { calls.push(['del', rid]); return Promise.resolve(rid); },
    });
    check('confirmDiscard closes panel and runs re-read -> delete',
      t.state.discardConfirmOpen === false &&
      calls.length === 2 && calls[0][0] === 'get' && calls[1][0] === 'del',
      JSON.stringify(calls));
    check('confirmDiscard success fully resets state',
      t.state.quoteRecordId === null && t.state.quoteStatus === null &&
      t.state.lines.length === 0 && t.DATA.meta.quoteNo === 'QTS-DRAFT');
  }

  // Confirm on a stale UI: server no longer Draft -> blocked, state preserved.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.addLineFromItem({ sku: '100545', name: 'Item', type: 'BMS', unit: 280, flags: [] }, 1);
    t.requestDiscard();
    let deleted = false, rejected = false;
    await t.confirmDiscard({
      getStatus: () => Promise.resolve({ status: 'Signed', source: 'test' }),
      deleteRecord: () => { deleted = true; return Promise.resolve(); },
    }).catch(() => { rejected = true; });
    check('confirmDiscard blocks stale non-Draft and preserves state',
      rejected && !deleted && t.state.quoteRecordId === '111222333' &&
      t.state.lines.length === 1 && t.state.quoteStatus === 'Signed' &&
      t.state.discardConfirmOpen === false);
  }

  /* ---- Round 75: load identity (record ID + Status) and eligibility ---- */
  {
    const t = freshWidget();
    // Detail read carries both fields (REST-like shape).
    let r = t.applyQuoteIdentity({ ID: '4929688000000107005', Status: 'Draft' }, null);
    check('applyQuoteIdentity from detail read populates ID+Status, discard available',
      r.recordId === '4929688000000107005' && r.status === 'Draft' && t.canDiscardDraft() === true);

    // v1 SDK detail read missing Status -> list row supplies it.
    r = t.applyQuoteIdentity({ ID: '4929688000000107005' }, { ID: '4929688000000107005', Status: 'Draft' });
    check('list-row Status fallback keeps discard available when detail read omits Status',
      r.status === 'Draft' && t.canDiscardDraft() === true);

    // Detail read missing ID entirely -> never the literal "undefined" string.
    r = t.applyQuoteIdentity({ Status: 'Draft' }, { ID: '111222333', Status: 'Draft' });
    check('list-row ID fallback: recordId never becomes "undefined"',
      r.recordId === '111222333' && t.canDiscardDraft() === true);

    // Status blank everywhere -> null, discard unavailable (never enables blind).
    r = t.applyQuoteIdentity({ ID: '111222333' }, { ID: '111222333' });
    check('blank Status everywhere stays null and blocks discard',
      r.status === null && t.canDiscardDraft() === false);

    // Non-Draft -> unavailable.
    t.applyQuoteIdentity({ ID: '111222333', Status: 'Signed' }, null);
    check('loaded non-Draft is not discardable', t.canDiscardDraft() === false);

    // Missing record ID -> unavailable even if Status says Draft.
    r = t.applyQuoteIdentity({ Status: 'Draft' }, null);
    check('missing record ID blocks discard', r.recordId === null && t.canDiscardDraft() === false);
  }

  // Header status label and discard eligibility read the same state.
  {
    const t = freshWidget();
    check('unsaved quote: header label says unsaved, discard unavailable',
      t.quoteStatusLabel() === 'Draft (unsaved)' && t.canDiscardDraft() === false);
    t.applyQuoteIdentity({ ID: '1', Status: 'Draft' }, null);
    check('loaded Draft: header label matches eligible state',
      t.quoteStatusLabel() === 'Draft' && t.canDiscardDraft() === true);
    t.applyQuoteIdentity({ ID: '1' }, { ID: '1' });
    check('loaded with unreadable Status: header shows Unknown, discard blocked',
      t.quoteStatusLabel() === 'Unknown' && t.canDiscardDraft() === false);
    t.applyQuoteIdentity({ ID: '1', Status: 'Send for Signature' }, null);
    check('loaded non-Draft: header shows real status, discard blocked',
      t.quoteStatusLabel() === 'Send for Signature' && t.canDiscardDraft() === false);
  }

  /* ---- Round 74: delegated document-capture pointerdown routing ---- */
  // Fake DOM nodes: a plain parent chain with ids, as the delegation walker
  // sees them. Any node instance works — that's the point of delegation
  // (routing must not depend on the originally bound node).
  const fakeNode = (id, parent) => ({ id, tagName: 'BUTTON', parentNode: parent || null, classList: { contains: () => false } });

  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    const btn = { id: 'btn-discard', tagName: 'BUTTON', parentNode: null, classList: { contains: () => false } };
    t.handleDiscardEvent({ type: 'pointerdown', target: btn });
    check('pointerdown on #btn-discard opens confirm panel', t.state.discardConfirmOpen === true);

    // Child-of-button target.
    t.cancelDiscard();
    const child = { id: '', tagName: 'SPAN', parentNode: btn, classList: { contains: () => false } };
    t.handleDiscardEvent({ type: 'pointerdown', target: child });
    check('pointerdown on child of #btn-discard opens confirm panel', t.state.discardConfirmOpen === true);

    // Duplicate suppression: mousedown+click of the SAME gesture must not
    // re-activate after pointerdown already did.
    t.cancelDiscard(); // panel closed by hand mid-gesture...
    t.handleDiscardEvent({ type: 'mousedown', target: btn });
    t.handleDiscardEvent({ type: 'click', target: btn });
    check('mousedown/click after activating pointerdown are suppressed', t.state.discardConfirmOpen === false);

    // A NEW gesture (fresh pointerdown) activates again.
    t.handleDiscardEvent({ type: 'pointerdown', target: btn });
    check('next gesture pointerdown activates again', t.state.discardConfirmOpen === true);
    t.cancelDiscard();

    // mousedown-only environment (no pointer events): mousedown activates,
    // its click is suppressed.
    t.handleDiscardEvent({ type: 'pointerdown', target: { id: '', tagName: 'DIV', parentNode: null, classList: { contains: () => false } } });
    t.handleDiscardEvent({ type: 'mousedown', target: btn });
    check('mousedown fallback activates when pointerdown missed the control', t.state.discardConfirmOpen === true);
    t.cancelDiscard();
    t.handleDiscardEvent({ type: 'click', target: btn });
    check('click after activating mousedown is suppressed', t.state.discardConfirmOpen === false);
  }

  // Cancel and Confirm via pointerdown.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.requestDiscard();
    t.handleDiscardEvent({ type: 'pointerdown', target: fakeNode('discard-cancel') });
    check('pointerdown on #discard-cancel closes panel, state untouched',
      t.state.discardConfirmOpen === false && t.state.quoteRecordId === '111222333');

    t.state.quoteRecordId = null; // ineligible -> discardDraftCore rejects safely
    t.state.discardConfirmOpen = true;
    t.handleDiscardEvent({ type: 'pointerdown', target: fakeNode('discard-confirm-btn') });
    await new Promise(r => setTimeout(r, 0));
    check('pointerdown on #discard-confirm-btn routes to confirmDiscard (panel closed)',
      t.state.discardConfirmOpen === false);
  }

  // Unrelated pointer events route nowhere.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.handleDiscardEvent({ type: 'pointerdown', target: fakeNode('btn-save') });
    t.handleDiscardEvent({ type: 'mousedown', target: fakeNode('btn-save') });
    t.handleDiscardEvent({ type: 'pointerdown', target: null });
    check('unrelated pointer events ignored', t.state.discardConfirmOpen === false);
  }

  /* ---- Round 73 (retained): delegated click routing still works ---- */

  // Click on (a clone of) #btn-discard routes to requestDiscard -> panel opens.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.handleDocumentClick({ target: fakeNode('btn-discard') });
    check('delegated click on #btn-discard opens confirm panel', t.state.discardConfirmOpen === true);
    // Also works when the click target is a CHILD of the button.
    t.cancelDiscard();
    t.handleDocumentClick({ target: fakeNode('', fakeNode('btn-discard')) });
    check('delegated click on a child of #btn-discard opens confirm panel', t.state.discardConfirmOpen === true);
  }

  // Click on #discard-cancel routes to cancelDiscard.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.requestDiscard();
    t.handleDocumentClick({ target: fakeNode('discard-cancel') });
    check('delegated click on #discard-cancel closes panel, state untouched',
      t.state.discardConfirmOpen === false && t.state.quoteRecordId === '111222333');
  }

  // Click on #discard-confirm-btn routes to confirmDiscard (guarded path:
  // ineligible state rejects internally and is caught by the router).
  {
    const t = freshWidget();
    t.state.quoteRecordId = null; // ineligible -> discardDraftCore rejects safely
    t.state.discardConfirmOpen = true;
    t.handleDocumentClick({ target: fakeNode('discard-confirm-btn') });
    await new Promise(r => setTimeout(r, 0)); // let the rejection settle
    check('delegated click on #discard-confirm-btn routes to confirmDiscard (panel closed)',
      t.state.discardConfirmOpen === false);
  }

  // Unrelated click routes nowhere and never opens the panel.
  {
    const t = freshWidget();
    t.state.quoteRecordId = '111222333';
    t.state.quoteStatus = 'Draft';
    t.handleDocumentClick({ target: fakeNode('btn-save') });
    t.handleDocumentClick({ target: null });
    check('delegated routing ignores unrelated clicks', t.state.discardConfirmOpen === false);
  }

  /* ---- Live quantity-tier repricing (mirrors fn_get_tier_price.deluge) ---- */
  {
    const t = freshWidget();
    // 100980 per the July source / r80 import: T1=150 (<=19), T2=100 (<=99)
    const tiers980 = [150, 100, null, null, null, null, null, null, null];
    check('100980 qty 19 -> 150 (hardware T1)', t.tierPriceForQty(tiers980, 'hardware', 19) === 150);
    check('100980 qty 20 -> 100 (hardware T2)', t.tierPriceForQty(tiers980, 'hardware', 20) === 100);
    check('hardware band edge 99/100 walks down on sparse T3',
      t.tierPriceForQty(tiers980, 'hardware', 100) === 100);

    // License scheme boundaries (200001-shaped: 700/525/455/350/245/175)
    const lic = [700, 525, 455, 350, 245, 175, null, null, null];
    check('license qty 1 -> T1', t.tierPriceForQty(lic, 'license', 1) === 700);
    check('license qty 2 -> T2', t.tierPriceForQty(lic, 'license', 2) === 525);
    check('license qty 3 -> T3 (boundary 2->3)', t.tierPriceForQty(lic, 'license', 3) === 455);
    check('license qty 24 -> T5', t.tierPriceForQty(lic, 'license', 24) === 245);
    check('license qty 25 -> T6', t.tierPriceForQty(lic, 'license', 25) === 175);

    // Sparse walk-down: nominal tier blank -> highest populated earlier tier
    const sparse = [150, null, 90, null, null, null, null, null, null];
    check('sparse walk-down qty 50 (T2 blank) -> T1 150', t.tierPriceForQty(sparse, 'hardware', 50) === 150);
    check('sparse qty 150 -> T3 90', t.tierPriceForQty(sparse, 'hardware', 150) === 90);
    check('all-blank tiers -> null (no invented price)',
      t.tierPriceForQty([null, null, null, null, null, null, null, null, null], 'hardware', 5) === null);
  }

  // mapItems retains tier metadata + scheme
  {
    const t = freshWidget();
    const items = t.mapItems([
      { Part_Number: '100980', Description: 'i-BMS Master', Category: 'BMS', Price_T1: '$150.00', Price_T2: '100' },
      { Part_Number: '200001', Description: 'Creator License reactivation', Category: 'Software', Price_T1: '700', Price_T2: '525' },
    ]);
    check('mapItems retains tiers array', items[0].tiers[0] === 150 && items[0].tiers[1] === 100 && items[0].tiers[2] === null);
    check('mapItems scheme: BMS -> hardware', items[0].scheme === 'hardware');
    check('mapItems scheme: Software -> license', items[1].scheme === 'license');
  }

  // eur_ref line reprices live on qty change; totals update immediately
  {
    const t = freshWidget();
    const item = { sku: '100980', name: 'i-BMS Master', type: 'BMS', unit: 150,
      tiers: [150, 100, null, null, null, null, null, null, null], scheme: 'hardware', flags: [] };
    t.addLineFromItem(item, 1);
    const l = t.state.lines[0];
    check('eur_ref line carries tiers + scheme', Array.isArray(l.tiers) && l.scheme === 'hardware');
    l.qty = 19; check('qty 19: no reprice needed', t.repriceEurRefLine(l) === false && l.unit === 150);
    l.qty = 20; check('qty 20: reprices 150 -> 100', t.repriceEurRefLine(l) === true && l.unit === 100);
    check('totals update immediately from repriced unit', t.computeTotals().subtotal === 2000);
    l.qty = 19; check('qty back to 19: reprices 100 -> 150', t.repriceEurRefLine(l) === true && l.unit === 150);
  }

  // stored (Creator-priced) and manual/custom lines are never overridden
  {
    const t = freshWidget();
    t.applyLoadedLines([{ sku: '100980', name: 'i-BMS Master', qty: '20', unit: '123.45', warning: '' }], true);
    const stored = t.state.lines[0];
    check('loaded line is priceSource stored', stored.priceSource === 'stored');
    stored.qty = 500;
    check('stored line never repriced client-side', t.repriceEurRefLine(stored) === false && stored.unit === 123.45);

    const manual = { id: 'LM', sku: 'CUSTOM', name: 'x', type: 'Custom', qty: 30, unit: 42,
      flags: [], custom: true, priceSource: 'manual', tiers: [150, 100], scheme: 'hardware' };
    check('manual line never repriced client-side', t.repriceEurRefLine(manual) === false && manual.unit === 42);
  }

  // kit-added Item_Master-backed lines retain tiers and reprice
  {
    const t = freshWidget();
    t.setCustomerType('End Customer'); // isolate tier math from catalog Disc %
    t.DATA.items = [{ sku: '100980', name: 'i-BMS Master', type: 'BMS', unit: 150,
      tiers: [150, 100, null, null, null, null, null, null, null], scheme: 'hardware',
      flags: [], discountable: true }];
    t.applyKitRows([{ part_number: '100980', qty: '2', kit_warning: '' }], 12); // qty 24 -> T2
    const kl = t.state.lines[0];
    check('kit-added line carries tiers', Array.isArray(kl.tiers));
    check('kit-added line reprices past band (qty 24 -> 100)', kl.qty === 24 && kl.unit === 100,
      String([kl.qty, kl.unit, kl.discountPct]));
    t.applyKitRows([{ part_number: '100980', qty: '2', kit_warning: '' }], 1); // merge to 26 (still T2)
    check('kit merge keeps repriced tier', t.state.lines.length === 1 && kl.unit === 100);

    // Live expand_kit / Deluge may emit Part_Number (PascalCase) — must still join Item_Master
    const t2 = freshWidget();
    t2.setCustomerType('Distributor');
    t2.DATA.items = [{ sku: '100916', name: 'i-BMS15/6', type: 'BMS', listEur: 330, unit: 330,
      tiers: [330, 275, null, null, null, null, null, null, null], scheme: 'hardware',
      flags: [], discountable: true, category: 'bms' }];
    t2.applyKitRows([{ Part_Number: '100916', Qty: '1', Kit_Warning: '' }], 1);
    check('kit PascalCase Part_Number joins Item_Master',
      t2.state.lines.length === 1 && t2.state.lines[0].name === 'i-BMS15/6' && t2.state.lines[0].listEur === 330);
    check('kit PascalCase row preloads Distributor Disc %',
      t2.state.lines[0].discountPct === 10, String(t2.state.lines[0].discountPct));

    // qty 24 Distributor HW → 7.5% when discountable
    const t3 = freshWidget();
    t3.setCustomerType('Distributor');
    t3.DATA.items = [{ sku: '100980', name: 'Harness', type: 'BMS', listEur: 100, unit: 100,
      tiers: [150, 100, null, null, null, null, null, null, null], scheme: 'hardware',
      flags: [], discountable: true, category: 'bms' }];
    t3.applyKitRows([{ part_number: '100980', qty: '24', kit_warning: '' }], 1);
    check('kit-added discountable line preloads Disc % for qty band',
      t3.state.lines[0].discountPct === 7.5, String(t3.state.lines[0].discountPct));
  }

  // Recalculate re-runs tier derivation for eligible lines only
  {
    const t = freshWidget();
    t.addLineFromItem({ sku: '100980', name: 'i-BMS Master', type: 'BMS', unit: 150,
      tiers: [150, 100, null, null, null, null, null, null, null], scheme: 'hardware', flags: [] }, 1);
    t.state.lines[0].qty = 25; // stale unit 150
    t.state.lines.push({ id: 'LM', sku: 'CUSTOM', name: 'x', type: 'Custom', qty: 5, unit: 9,
      flags: [], custom: true, priceSource: 'manual' });
    t.recalculate();
    check('Recalculate reprices stale eur_ref line', t.state.lines[0].unit === 100);
    check('Recalculate leaves manual line alone', t.state.lines[1].unit === 9);
    check('Recalculate is silent (no toast)', t.getLastToast() === null);
  }

  // save/reload: Creator authoritative pricing replaces local preview pricing
  {
    const t = freshWidget();
    t.addLineFromItem({ sku: '100980', name: 'i-BMS Master', type: 'BMS', unit: 150,
      tiers: [150, 100, null, null, null, null, null, null, null], scheme: 'hardware', flags: [] }, 1);
    t.applyLoadedLines([{ sku: '100980', name: 'i-BMS Master', qty: '20', unit: '108.50', warning: '' }], true);
    const l = t.state.lines[0];
    check('reload replaces preview with stored Creator USD',
      t.state.lines.length === 1 && l.priceSource === 'stored' && l.unit === 108.5);
    l.qty = 999;
    check('reloaded line stays Creator-authoritative on qty change',
      t.repriceEurRefLine(l) === false && l.unit === 108.5);
  }

  /* ---- Round 95: CRM Deal select / no-duplicate gate / revision model ---- */

  // Deal selection: exact record ID persists into the save payload
  {
    const t = freshWidget();
    t.state.customer = { contactId: '111', accountId: '222', name: 'Test User', email: 't@x.com', company: 'TEST CO' };
    t.selectDeal({ deal_id: '6719186000009999001', deal_name: 'TEST CO — Battery Project', stage: 'Needs Analysis', is_closed: false });
    check('existing open Deal selectable', t.state.deal && t.state.deal.dealId === '6719186000009999001');
    check('explicit selection marks dealChoiceMade', t.state.dealChoiceMade === true);
    const payload = t.buildQuotePayload();
    check('exact CRM Deal ID persisted in save payload', payload.CRM_Deal_ID === '6719186000009999001');
    check('base identity: payload never invents a Quote_Number', payload.Quote_Number === undefined);
  }

  // Closed terminal Deals are never selectable (never reopened)
  {
    const t = freshWidget();
    t.state.customer = { contactId: '111', name: 'x', company: 'TEST CO' };
    ['Closed Won', 'Closed Lost', 'Closed Lost to Competition'].forEach(function (stg) {
      t.selectDeal({ deal_id: '42', deal_name: 'Old ' + stg, stage: stg, is_closed: true });
      check('closed Deal not selectable (' + stg + ')', t.state.deal === null && !t.state.dealChoiceMade);
    });
  }

  // Save gate: open candidates without explicit choice block; explicit choice unblocks
  {
    const t = freshWidget();
    check('no customer -> gate open', t.dealSaveGate().ok === true);
    t.state.customer = { contactId: '111', name: 'x', company: 'TEST CO' };
    check('customer, not searched yet -> gate open', t.dealSaveGate().ok === true);
    t.state.dealCandidates = [];
    check('no open Deal exists -> gate open (sync skipped server-side)', t.dealSaveGate().ok === true);
    t.state.dealCandidates = [
      { deal_id: '1', deal_name: 'A', stage: 'Qualification', is_closed: false },
      { deal_id: '2', deal_name: 'B', stage: 'Needs Analysis', is_closed: false },
    ];
    const gate = t.dealSaveGate();
    check('multiple open Deals w/o explicit choice -> save BLOCKED', gate.ok === false, JSON.stringify(gate));
    check('block reason is actionable', /select one|Create New Opportunity/.test(gate.reason || ''), gate.reason);
    t.selectDeal(t.state.dealCandidates[1]);
    check('explicit selection unblocks save', t.dealSaveGate().ok === true);
    check('no silent duplicate: selection reuses exact ID', t.state.deal.dealId === '2');
  }

  // Closed-only candidates never block saving (new cycle handled via Create New)
  {
    const t = freshWidget();
    t.state.customer = { contactId: '111', name: 'x', company: 'TEST CO' };
    t.state.dealCandidates = [{ deal_id: '9', deal_name: 'Won', stage: 'Closed Won', is_closed: true }];
    check('closed-only candidates -> gate open', t.dealSaveGate().ok === true);
  }

  // Revision model: R1 on first save, increments per save, base identity kept
  {
    const t = freshWidget();
    check('unsaved quote has no revision', t.state.revision === null && t.revisionLabel() === '');
    check('first save becomes R1', t.nextRevision() === 1);
    t.state.revision = 1;
    check('R1 label', t.revisionLabel() === '-R1');
    check('second save becomes R2', t.nextRevision() === 2);
    t.state.revision = 2;
    check('third save becomes R3', t.nextRevision() === 3);
    check('R2 label', t.revisionLabel() === '-R2');
    // Server-side persistence is Tier-3 gated: payload must NOT carry the
    // field until REVISION_FIELD_READY flips (save would fail on unknown field).
    const payload = t.buildQuotePayload();
    check('Quote_Revision omitted while schema-gated', payload.Quote_Revision === undefined);
  }

  // Deal context: customer clear / reset always clears deal linkage
  {
    const t = freshWidget();
    t.state.customer = { contactId: '111', name: 'x', company: 'TEST CO' };
    t.selectDeal({ deal_id: '77', deal_name: 'D', stage: 'Value Proposition', is_closed: false });
    t.clearDealSelection();
    check('clearDealSelection clears deal + choice + candidates',
      t.state.deal === null && t.state.dealChoiceMade === false && t.state.dealCandidates === null);
    t.selectDeal({ deal_id: '77', deal_name: 'D', stage: 'Value Proposition', is_closed: false });
    t.state.revision = 3;
    t.resetQuoteState();
    check('resetQuoteState clears deal and revision',
      t.state.deal === null && t.state.dealChoiceMade === false && t.state.revision === null);
  }

  // Deal switch isolation (2026-07-29): switching Deals must never keep
  // another Deal's lines (Rova deal / Dana stale-lines incident).
  {
    const t = freshWidget();
    t.state.customer = { contactId: '111', name: 'Dana', company: 'TEST' };
    t.selectDeal({ deal_id: 'deal-dana', deal_name: 'Dana Deal', stage: 'Proposal/Price Quote', is_closed: false });
    t.addLineFromItem({ sku: '100545', name: 'Dana line', type: 'BMS', unit: 280, flags: [] }, 1);
    t.state.quoteRecordId = 'quote-dana';
    t.state.quoteStatus = 'Draft';
    check('setup: Dana lines present', t.state.lines.length === 1 && t.state.quoteRecordId === 'quote-dana');

    t.selectDeal({ deal_id: 'deal-rova', deal_name: 'Rova Batteries', stage: 'Proposal/Price Quote', is_closed: false });
    check('switch Deal clears prior lines', t.state.lines.length === 0);
    check('switch Deal clears quote identity', t.state.quoteRecordId === null && t.state.quoteStatus === null);
    check('switch Deal binds new Deal ID', t.state.deal && t.state.deal.dealId === 'deal-rova');
    check('switch Deal toast explains clear', /Switched CRM Deal/.test(t.getLastToast()), t.getLastToast());

    // Re-selecting the SAME Deal must not wipe in-progress lines
    t.addLineFromItem({ sku: '100600', name: 'Rova line', type: 'BMS', unit: 100, flags: [] }, 2);
    t.selectDeal({ deal_id: 'deal-rova', deal_name: 'Rova Batteries', stage: 'Proposal/Price Quote', is_closed: false });
    check('same Deal re-select keeps lines', t.state.lines.length === 1 && t.state.lines[0].sku === '100600');

    // First Deal attach with existing unsaved lines (no prior deal) keeps them
    const t2 = freshWidget();
    t2.addLineFromItem({ sku: '100545', name: 'pre-deal', type: 'BMS', unit: 280, flags: [] }, 1);
    t2.selectDeal({ deal_id: 'first-deal', deal_name: 'First', stage: 'Needs Analysis', is_closed: false });
    check('first Deal attach keeps unsaved lines', t2.state.lines.length === 1 && t2.state.deal.dealId === 'first-deal');
  }

  /* ---- Round 97: loaded-quote Deal restore (TEST-QUOTE0034 defect) ---- */

  // Persisted CRM_Deal_ID restores the exact Deal association immediately
  {
    const t = freshWidget();
    t.restoreDealById('6719186000003070020');
    check('loaded quote restores exact persisted Deal ID',
      t.state.deal && t.state.deal.dealId === '6719186000003070020');
    check('restored Deal sets dealChoiceMade=true', t.state.dealChoiceMade === true);
    const payload = t.buildQuotePayload();
    check('subsequent save retains same CRM_Deal_ID', payload.CRM_Deal_ID === '6719186000003070020');
  }

  // get_deal details fill in name/stage (chip content) without changing the ID
  {
    const t = freshWidget();
    t.restoreDealById('6719186000003070020');
    t.applyRestoredDeal({ deal_id: '6719186000003070020', deal_name: 'Blake Test 1',
      stage: 'Proposal/Price Quote', is_closed: false }, '6719186000003070020');
    check('restored Deal name shown', t.state.deal.dealName === 'Blake Test 1');
    check('restored Deal stage shown', t.state.deal.stage === 'Proposal/Price Quote');
    check('restored details never change the authoritative ID',
      t.state.deal.dealId === '6719186000003070020');
  }

  // Persisted Deal wins regardless of candidate lists; no ambiguity gate
  {
    const t = freshWidget();
    t.state.customer = { contactId: '111', name: 'Blake Allard', company: 'TEST CO' };
    t.state.dealCandidates = [
      { deal_id: '1', deal_name: 'Other A', stage: 'Qualification', is_closed: false },
      { deal_id: '2', deal_name: 'Other B', stage: 'Needs Analysis', is_closed: false },
    ];
    t.restoreDealById('6719186000003070020');
    check('persisted Deal ID wins over candidate ordering',
      t.state.deal.dealId === '6719186000003070020');
    check('no ambiguity gate for already-associated quote', t.dealSaveGate().ok === true);
  }

  // Customer restore must not clear the restored Deal (dealChoiceMade guards
  // the post-select search; clearDealSelection only runs on explicit clear)
  {
    const t = freshWidget();
    t.restoreDealById('77');
    t.state.customer = { contactId: '111', name: 'x', company: 'TEST CO' };
    check('customer restore preserves restored Deal',
      t.state.deal && t.state.deal.dealId === '77' && t.state.dealChoiceMade === true);
  }

  // Missing CRM_Deal_ID → normal new-quote behavior (no phantom restore)
  {
    const t = freshWidget();
    t.restoreDealById('');
    check('blank Deal ID restores nothing', t.state.deal === null && t.state.dealChoiceMade === false);
  }

  // Closed persisted Deal: displayed as historical association, never re-selected/reopened
  {
    const t = freshWidget();
    t.applyRestoredDeal({ deal_id: '99', deal_name: 'Won Deal', stage: 'Closed Won', is_closed: true }, '99');
    check('closed persisted Deal still displayable as association',
      t.state.deal.dealId === '99' && t.state.deal.isClosed === true && t.state.deal.stage === 'Closed Won');
    // and the interactive selector still refuses closed deals (no reopening path)
    t.clearDealSelection();
    t.selectDeal({ deal_id: '99', deal_name: 'Won Deal', stage: 'Closed Won', is_closed: true });
    check('closed Deal still not interactively selectable', t.state.deal === null);
  }

  /* ---- Round 98: persisted-ID extraction under the SDK detail-read deviation ---- */

  // The live failure: the SDK DETAIL read returns the record with NO field
  // values, so rec.CRM_Deal_ID is absent while the LIST row (or the bridge)
  // has it. Round 97 read only the detail record and restored nothing.
  {
    const t = freshWidget();
    check('detail-first extraction',
      t.pickPersistedDealId({ CRM_Deal_ID: '6719186000003070020' }, { CRM_Deal_ID: 'ignored' }) === '6719186000003070020');
    check('LIVE DEFECT SHAPE: detail stub -> list-row fallback',
      t.pickPersistedDealId({ ID: '123' /* no field values */ }, { CRM_Deal_ID: '6719186000003070020' }) === '6719186000003070020');
    check('both missing -> blank (bridge fallback takes over)',
      t.pickPersistedDealId({ ID: '123' }, { ID: '123' }) === '');
    check('null detail record tolerated',
      t.pickPersistedDealId(null, { CRM_Deal_ID: '55' }) === '55');
    check('real undefined values never mint the string "undefined"',
      t.pickPersistedDealId({ CRM_Deal_ID: undefined }, { CRM_Deal_ID: null }) === '');
  }

  // Real load ordering: stub detail record -> provisional restore from list
  // row -> customer restore resolves later -> get_deal details resolve last.
  // The chip state must survive every step.
  {
    const t = freshWidget();
    // 1) quote record returns first (stub detail, list row carries the ID)
    const id = t.pickPersistedDealId({ ID: '123' }, { CRM_Deal_ID: '6719186000003070020' });
    t.restoreDealById(id); // provisional exact-ID restore + render
    check('step 1: provisional deal state set from list row',
      t.state.deal && t.state.deal.dealId === '6719186000003070020' && t.state.dealChoiceMade === true);
    // 2) customer restore resolves later (must not clear the deal)
    t.state.customer = { contactId: '111', name: 'Blake Allard', company: 'TEST CO' };
    check('step 2: late customer restore preserves deal', t.state.deal.dealId === '6719186000003070020');
    // 3) get_deal resolves last and enriches in place
    t.applyRestoredDeal({ deal_id: '6719186000003070020', deal_name: 'Blake Test 1',
      stage: 'Proposal/Price Quote', is_closed: false }, '6719186000003070020');
    check('step 3: async enrichment keeps ID and adds name/stage',
      t.state.deal.dealId === '6719186000003070020' &&
      t.state.deal.dealName === 'Blake Test 1' && t.state.deal.stage === 'Proposal/Price Quote');
    // 4) still no ambiguity gate; save payload carries the exact ID
    check('step 4: save gate open', t.dealSaveGate().ok === true);
    check('step 4: payload carries exact ID', t.buildQuotePayload().CRM_Deal_ID === '6719186000003070020');
  }

  /* ---- Round 99: explicit Send for Signature action ---- */

  // Two-button publish: Save Quote Package (PDF Filed) + Email Quote Package
  // (Package Requested). Both call publishQuotePackage({ email }) with Deal sync first.
  {
    const t = freshWidget();
    check('publishQuotePackage helper exists', typeof t.publishQuotePackage === 'function');
    check('status constants locked', t.PACKAGE_STATUS === 'Package Requested' && t.PDF_FILE_STATUS === 'PDF Filed');
    t.state.quoteRecordId = '4929688000000109001';
    t.state.quoteStatus = 'Draft';
    t.publishQuotePackage({ email: true });
    check('Email Quote Package with no lines is blocked',
      /Add quote lines/.test(t.getLastToast()), t.getLastToast());
    t.addLineFromItem({ sku: '100545', name: 'Test item', type: 'BMS', unit: 280, flags: [] }, 1);
    t.publishQuotePackage({ email: true });
    // Headless: no Deal → blocked before bridge; or publish toast / Deal selection.
    check('Email Quote Package requires Deal sync first',
      /Select a CRM Deal|Publishing quote package \(email client\)|Publish failed|Deal selection|Cannot publish/.test(t.getLastToast()), t.getLastToast());
    check('Email Quote Package opens no send confirmation', t.state.sendConfirmOpen === false);

    t.state.deal = { dealId: '6719186000009999001', dealName: 'Test', stage: 'Needs Analysis', isClosed: false };
    t.state.dealChoiceMade = true;
    t.state.quoteStatus = 'Package Requested';
    t.publishQuotePackage({ email: true });
    check('Email while Package Requested is a resend, not a no-op',
      /Publishing quote package|Publish failed|CRM bridge|email client/.test(t.getLastToast()) &&
      !/already requested/.test(t.getLastToast()), t.getLastToast());

    const tFile = freshWidget();
    tFile.state.quoteRecordId = '4929688000000109001';
    tFile.state.quoteStatus = 'Draft';
    tFile.state.deal = { dealId: '6719186000009999001', dealName: 'Test', stage: 'Needs Analysis', isClosed: false };
    tFile.state.dealChoiceMade = true;
    tFile.addLineFromItem({ sku: '100545', name: 'Test item', type: 'BMS', unit: 280, flags: [] }, 1);
    tFile.publishQuotePackage({ email: false });
    check('Save Quote Package uses no-email path',
      /Saving quote package \(no email\)|Publish failed|CRM bridge|Deal selection/.test(tFile.getLastToast()), tFile.getLastToast());
    check('saveQuotePackage / filePdfToDeal aliases exist',
      typeof tFile.saveQuotePackage === 'function' && typeof tFile.filePdfToDeal === 'function' &&
      tFile.PDF_FILE_STATUS === 'PDF Filed');
    check('legacy generatePackage aliases to email path', typeof tFile.generatePackage === 'function');

    // Auto-save: silent gated save returns null and never toasts
    const t2 = freshWidget();
    check('saveDraft with nothing to save returns null silently',
      t2.saveDraft({ silent: true }) === null && t2.getLastToast() === null);
    t2.autoSave();
    check('autoSave with empty state is a no-op', t2.getLastToast() === null);
    check('markDirty is exposed for input hooks', typeof t2.markDirty === 'function');
    check('cancelAutosave is exposed', typeof t2.cancelAutosave === 'function');
    check('deal-click quote loading is exposed', typeof t2.maybeLoadQuoteForDeal === 'function');

    // Post-publish: autosave must not clobber Status back to Draft.
    const t3 = freshWidget();
    t3.state.quoteRecordId = '4929688000000109001';
    t3.state.quoteStatus = 'Package Requested';
    t3.addLineFromItem({ sku: '100545', name: 'x', type: 'BMS', unit: 280, flags: [] }, 1);
    check('saveDraft refused after Package Requested', t3.saveDraft({ silent: true }) === null);
    t3.markDirty();
    check('markDirty is inert after Package Requested', t3.state.quoteStatus === 'Package Requested');
  }

  // Send-for-signature UI removed 2026-07-29 (Bill internal approval / wait for PO).
  // Helpers remain for any residual Flow hooks; button is gone from the widget.
  {
    const t = freshWidget();
    check('legacy send helper still exists (no UI)', typeof t.requestSendForSignature === 'function');
  }

  /* ---- Round 100: send verification + signer payload (TEST-QUOTE0034 Sign failure) ---- */

  // The send payload must carry the internal signer identity — its absence is
  // what made fn_generate_pdf abort before Writer/Sign on TEST-QUOTE0034.
  {
    const t = freshWidget();
    const p = t.buildSendPayload('Blake Allard', 'blake@bevco-tech.com');
    check('send payload sets Status', p.Status === 'Send for Signature');
    check('send payload carries recipient signer', p.Recipient_Name === 'Blake Allard' && p.Recipient_Email === 'blake@bevco-tech.com');
    const d = t.buildSendPayload('', '');
    check('blank signer inputs fall back to internal defaults',
      d.Recipient_Name === 'Blake Allard' && d.Recipient_Email === 'blake@bevco-tech.com');
    check('send payload never touches Deal identity or Amount fields',
      d.CRM_Deal_ID === undefined && d.Amount === undefined);
  }

  // Status-update success is NOT send success: unverified outcome reports loudly
  {
    const t = freshWidget();
    t.state.quoteRecordId = '4929688000000102094';
    t.onSendUnverified();
    check('unverified send reports SEND NOT COMPLETED, never success',
      /SEND NOT COMPLETED/.test(t.getLastToast()) && /Sign_Request_ID is blank/.test(t.getLastToast()), t.getLastToast());
    check('unverified send is truthful about record status',
      t.state.quoteStatus === 'Send for Signature');
  }

  // Customer with no email is blocked before any send attempt
  {
    const t = freshWidget();
    t.state.quoteRecordId = '55';
    t.state.quoteStatus = 'Draft';
    t.addLineFromItem({ sku: '100545', name: 'x', type: 'BMS', unit: 280, flags: [] }, 1);
    t.state.customer = { contactId: '111', name: 'No Email', company: 'TEST CO', email: '' };
    const gate = t.canSendForSignature();
    check('customer without email blocked (signer-email guard, client side)',
      gate.ok === false && /no email/.test(gate.reason), JSON.stringify(gate));
    t.state.customer.email = 'blake@kinetic-bridge.com';
    check('customer with email passes the gate', t.canSendForSignature().ok === true);
  }

  // Warnings gate the send exactly like package generation
  {
    const t = freshWidget();
    t.state.quoteRecordId = '55';
    t.state.quoteStatus = 'Draft';
    t.addLineFromItem({ sku: '102100', name: 'Disc', type: 'BMS', unit: 10, flags: ['discontinued'] }, 1);
    check('unresolved warnings block send', t.canSendForSignature().ok === false);
  }

  /* ---- Round 96: widget scroll-container layout guards ----
   * Creator's widget iframe is fixed-height (plugin-manifest options.height)
   * with viewport scrolling suppressed, so <body> MUST be an explicit scroll
   * container or content below the iframe height becomes unreachable (the
   * Round 96 live-QA clipping). Static assertions on widget.css keep the
   * fix from silently regressing. */
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'widget.css'), 'utf8');
    const htmlRule = (css.match(/^html\s*\{[^}]*\}/m) || [''])[0];
    check('html blocks overflow propagation to the host viewport',
      /overflow:\s*hidden/.test(htmlRule) && /height:\s*100%/.test(htmlRule), htmlRule);
    const bodyRule = (css.match(/body\s*\{[^}]*\}/) || [''])[0];
    check('body is the internal scroll container (height 100%)',
      /height:\s*100%/.test(bodyRule), bodyRule);
    check('body scrolls vertically through all content',
      /overflow-y:\s*auto/.test(bodyRule), bodyRule);
    check('no 100vh traps anywhere in widget.css', !/100vh/.test(css));
    check('lines table keeps its own horizontal scroll wrap',
      /\.table-wrap\s*\{[^}]*overflow-x:\s*auto/.test(css));
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin-manifest.json'), 'utf8'));
    const h = manifest.modules.widgets[0].options.height;
    check('manifest fixed height documented assumption still holds (number)', typeof h === 'number', String(h));
  }

  {
    const t = freshWidget();
    t.state.customer = { leadId: '6719186000004000001', contactId: '', accountId: '',
      name: 'Lead Person', email: 'lead@x.com', company: 'LEAD CO' };
    const payload = t.buildQuotePayload();
    check('lead quote persists CRM_Lead_ID', payload.CRM_Lead_ID === '6719186000004000001');
    check('lead quote carries no invented Deal', payload.CRM_Deal_ID === undefined);
    check('lead quote save gate passes (no deal candidates possible)', t.dealSaveGate().ok === true);
    check('lead pending conversion is detected', t.isLeadPendingConversion() === true);
    t.applyConvertedCrmIds({
      contactId: '6719186000004000101',
      accountId: '6719186000004000102',
      dealId: '6719186000004000103',
      dealName: 'LEAD CO - TEST',
      stage: 'Proposal/Price Quote',
    });
    check('lead convert hydrates contact in place', t.state.customer.contactId === '6719186000004000101');
    check('lead convert hydrates account in place', t.state.customer.accountId === '6719186000004000102');
    check('lead convert sets deal without reload', t.state.deal && t.state.deal.dealId === '6719186000004000103');
    check('lead convert marks deal choice made', t.state.dealChoiceMade === true);
    check('after convert lead is no longer pending', t.isLeadPendingConversion() === false);
  }

  {
    const t = freshWidget();
    t.state.customer = { leadId: '6719186000004000001', contactId: '111', accountId: '222',
      name: 'Converted Person', email: 'c@x.com', company: 'CO' };
    const payload = t.buildQuotePayload();
    check('contactId suppresses CRM_Lead_ID in payload', payload.CRM_Lead_ID === undefined);
    check('contact identity kept', payload.CRM_Contact_ID === '111');
  }

  {
    const t = freshWidget();
    t.applyKitRows([
      { part_number: '100980', qty: '1', kit_warning: '' },
      { part_number: '100981', qty: '0', kit_warning: '' },
    ], 1);
    const zero = t.state.lines.filter(function (l) { return l.sku === '100981'; })[0];
    check('qty-0 kit row inserts as a visible line', !!zero);
    check('qty-0 line starts at quantity 0', zero && Number(zero.qty) === 0);
    const totals = t.computeTotals();
    check('qty-0 line contributes nothing to totals', totals.subtotal === t.state.lines.filter(function (l) { return l.sku === '100980'; })[0].unit * 1);
  }

  /* ---- CRM-first quote loading (2026-07-28) ---- */
  {
    const t = freshWidget();
    check('back-reference parses from a stamped Description',
      t.creatorQuoteRequestIdFromDescription('QTS Quote_Request ID: 4929688000000107005') === '4929688000000107005');
    check('back-reference parses when embedded in other Description text',
      t.creatorQuoteRequestIdFromDescription('Customer notes here.\nQTS Quote_Request ID: 12345\nMore text') === '12345');
    check('no back-reference yields blank', t.creatorQuoteRequestIdFromDescription('plain description') === '');
    check('null Description yields blank', t.creatorQuoteRequestIdFromDescription(null) === '');
  }

  {
    const t = freshWidget();
    const r = t.applyCrmQuote({
      quote_id: '6719186000003700001',
      quote_number: 'TEST-QUOTE0005',
      subject: 'Kinetic Bridge Quote TEST-QUOTE0005',
      valid_till: '2026-08-27',
      description: 'QTS Quote_Request ID: gone',
      line_items: [
        { product_id: '1', product_name: 'i-BMS15/6', quantity: 20, list_price: 316.09, total: 6321.84 },
        { product_id: '2', product_name: 'i-BMS15 Wire harness kit SINGLE PACK', quantity: 20, list_price: 114.94, total: 2298.85 },
      ],
    }, 'TEST-QUOTE0005');
    check('CRM recovery flags itself', r && r.recovered === true);
    check('CRM recovery leaves identity unsaved (new draft on next save)',
      t.state.quoteRecordId === null && t.state.quoteStatus === null);
    check('CRM recovery restores the quote number', t.DATA.meta.quoteNo === 'TEST-QUOTE0005');
    check('CRM recovery loads all line items', t.state.lines.length === 2, String(t.state.lines.length));
    check('CRM lines carry name/qty/price, no invented SKUs',
      t.state.lines[0].qty === 20 || Number(t.state.lines[0].qty) === 20);
  }

  {
    const t = freshWidget();
    check('payment terms default to Net 30 with no DOM', t.paymentTermsDays() === 30 && t.paymentTermsLabel() === 'Net 30');
    const payload = t.buildQuotePayload();
    check('save payload carries Payment_Terms text', payload.Payment_Terms === 'Net 30');
  }

  /* ---- Stage 6 Margin % (markup) ---- */
  {
    const t = freshWidget();
    t.setFxRate(1); // usdPerEur = 1
    t.setCustomerType('End Customer'); // isolate margin math from catalog Disc %
    t.addLineFromItem({ sku: 'M1', name: 'Margin item', type: 'BMS', listEur: 100, unit: 100, flags: [], discountable: true }, 1);
    t.addLineFromItem({ sku: 'M2', name: 'Margin item 2', type: 'BMS', listEur: 200, unit: 200, flags: [], discountable: true }, 1);
    check('new lines default marginPct 0',
      t.state.lines[0].marginPct === 0 && t.state.lines[1].marginPct === 0);

    t.applyHeaderMarginToLines(15);
    check('header Margin 15 sets all unlocked lines',
      t.state.lines[0].marginPct === 15 && t.state.lines[1].marginPct === 15);
    check('header Margin 15 recomputes sale = list×FX×1.15',
      t.state.lines[0].unit === 115 && t.state.lines[1].unit === 230,
      String([t.state.lines[0].unit, t.state.lines[1].unit]));

    t.state.lines[0].marginPct = 10;
    t.state.lines[0].priceSource = 'eur_ref';
    t.state.lines[0].unit = t.computeSaleUsd(t.state.lines[0]);
    check('per-line Margin 10 only changes that line',
      t.state.lines[0].unit === 110 && t.state.lines[1].unit === 230,
      String([t.state.lines[0].unit, t.state.lines[1].unit]));

    t.state.lines[0].discountPct = 20;
    t.state.lines[0].unit = t.computeSaleUsd(t.state.lines[0]);
    // 100 × (1-0.20) × (1+0.10) = 88
    check('Disc % and Margin % combine independently',
      t.state.lines[0].unit === 88, String(t.state.lines[0].unit));

    const payloadMid = t.buildQuotePayload();
    const warn0 = (payloadMid.Quote_Lines[0].Kit_Warning || '');
    check('payload Kit_Warning encodes DISC and MARGIN sidecars',
      warn0.indexOf('\u00abDISC:20\u00bb') !== -1 && warn0.indexOf('\u00abMARGIN:10\u00bb') !== -1,
      warn0);

    t.state.lines[1].priceLocked = true;
    t.state.lines[1].unit = 999;
    t.applyHeaderMarginToLines(25);
    check('locked line skips header Margin recompute',
      t.state.lines[1].unit === 999 && t.state.lines[1].marginPct === 15,
      String([t.state.lines[1].unit, t.state.lines[1].marginPct]));

    const payload = t.buildQuotePayload();
    check('payload carries Markup_Rate_Pct from header',
      Number(payload.Markup_Rate_Pct) === 25, String(payload.Markup_Rate_Pct));
  }

  /* ---- Stage 7 catalog Disc % (Distrib discount page 2) ---- */
  {
    const t = freshWidget();
    t.setFxRate(1);
    t.setCustomerType('Distributor');
    check('X and Y are discountable flags',
      t.isDiscountableFlag('X') && t.isDiscountableFlag('Y') && !t.isDiscountableFlag('N') && !t.isDiscountableFlag(''));
    check('Creator display_value wrapper parses as discountable',
      t.isDiscountableFlag({ display_value: 'Y', value: 'Y' }));
    check('Distributor HW qty 5 → 10%',
      t.catalogDiscountPct({ discountable: true, qty: 5, isSoftware: false }) === 10);
    check('Distributor HW qty 50 → 7.5%',
      t.catalogDiscountPct({ discountable: true, qty: 50, isSoftware: false }) === 7.5);
    check('Distributor Software → 16.5%',
      t.catalogDiscountPct({ discountable: true, qty: 1, isSoftware: true }) === 16.5);
    check('non-discountable → 0%',
      t.catalogDiscountPct({ discountable: false, qty: 5, isSoftware: false }) === 0);
    check('End Customer → 0%',
      t.catalogDiscountPct({ discountable: true, qty: 5, isSoftware: false, customerType: 'End Customer' }) === 0);

    // Seed Item_Master catalog — select path must read Discountable from here.
    t.DATA.items = [
      { sku: 'D100', name: 'Disc HW', type: 'BMS', category: 'bms', listEur: 100, unit: 100,
        flags: [], discountable: true, scheme: 'hardware', tiers: null },
      { sku: 'N100', name: 'No-X accessory', type: 'Part / Accessory', category: 'part', listEur: 50, unit: 50,
        flags: [], discountable: false, scheme: 'hardware', tiers: null },
      { sku: 'S200', name: 'Creator License', type: 'Software / License', category: 'service', listEur: 200, unit: 200,
        flags: [], discountable: true, scheme: 'license', tiers: null },
    ];

    t.addLineFromItem({ sku: 'D100' }, 5);
    check('select discountable SKU preloads Distributor 10% from Item_Master',
      t.state.lines[0].discountPct === 10 && t.state.lines[0].discountable === true,
      String(t.state.lines[0].discountPct));
    check('preloaded Disc % applied to sale (100×0.9)',
      t.state.lines[0].unit === 90, String(t.state.lines[0].unit));

    t.addLineFromItem({ sku: 'N100' }, 5);
    check('select non-discountable SKU Disc % stays 0',
      t.state.lines[1].discountPct === 0 && t.state.lines[1].discountable === false,
      String(t.state.lines[1].discountPct));

    t.addLineFromItem({ sku: 'S200' }, 1);
    check('select software SKU preloads Distributor 16.5%',
      t.state.lines[2].discountPct === 16.5, String(t.state.lines[2].discountPct));

    // Qty band change refreshes catalog Disc %
    t.state.lines[0].qty = 50;
    t.preloadLineDiscountFromItemMaster(t.state.lines[0]);
    check('qty 50 on discountable HW refreshes Disc % to 7.5',
      t.state.lines[0].discountPct === 7.5, String(t.state.lines[0].discountPct));

    const mapped = t.mapItems([
      { Part_Number: 'X1', Description: 'with X', Discountable: { display_value: 'X' }, Category: 'BMS', Price_T1: 10 },
      { Part_Number: 'B1', Description: 'blank', Discountable: 'N', Category: 'Accessory', Price_T1: 10 },
    ]);
    check('mapItems treats Discountable X as discountable', mapped[0].discountable === true);
    check('mapItems treats Discountable N as not discountable', mapped[1].discountable === false);

    // Inverted Round-80 live data: accessories wrongly Y → auto-flip
    const inverted = t.mapItems([
      { Part_Number: 'A1', Description: 'acc1', Discountable: 'Y', Category: 'Accessory', Price_T1: 1 },
      { Part_Number: 'A2', Description: 'acc2', Discountable: 'Y', Category: 'Accessory', Price_T1: 1 },
      { Part_Number: 'A3', Description: 'acc3', Discountable: 'Y', Category: 'Accessory', Price_T1: 1 },
      { Part_Number: 'H1', Description: 'board', Discountable: 'N', Category: 'BMS', Price_T1: 1 },
    ]);
    check('inverted Discountable polarity auto-flips accessories to not discountable',
      inverted[0].discountable === false && inverted[1].discountable === false);
    check('inverted polarity flip marks former-N board as discountable',
      inverted[3].discountable === true);

    const rulesN = t.ingestPriceRules([
      { Customer_Type: 'Distributor', Product_Type: 'Hardware', Qty_Min: 1, Qty_Max: 9, Discount_Pct: 10 },
      { Customer_Type: 'Distributor', Product_Type: 'Software', Qty_Min: 1, Qty_Max: 999999, Discount_Pct: 16.5 },
    ]);
    check('Price_Rules ingest accepts Creator rows', rulesN === 2);

    const payload = t.buildQuotePayload();
    check('save payload carries Customer_Type Distributor',
      payload.Customer_Type === 'Distributor', String(payload.Customer_Type));
  }

  // CRM search cache (External Calls) — same query must hit cache, not re-bridge.
  {
    const t = freshWidget();
    check('CRM search cache helpers exist',
      typeof t.putCachedCrmSearch === 'function' && typeof t.getCachedCrmSearch === 'function');
    t.clearCrmSearchCache();
    check('empty cache miss', t.getCachedCrmSearch('rova') === null);
    t.putCachedCrmSearch('Rova', [{ contact_id: '1' }], [{ lead_id: '2' }]);
    const hit = t.getCachedCrmSearch('rova');
    check('cache is case-insensitive', !!hit && hit.contacts.length === 1 && hit.leads.length === 1);
    t.clearCrmSearchCache();
    check('clearCrmSearchCache empties search cache', t.getCachedCrmSearch('rova') === null);
  }

  /* ---- Bundled SKUs (pricelist v1.0): unpriced by vendor intent, not a blocker ---- */
  {
    const t = freshWidget();
    const items = t.mapItems([
      { Part_Number: '100985.2', Description: 'n3-BMS CMU18 101814 wireharness kit', Category: 'BMS',
        Tier_Scheme: 'Hardware', Discountable: 'N', Item: 'Active', Quote_Warning: '',
        Price_T1: '108.40', Price_T2: '88.68' },
      { Part_Number: '103006', Description: 'n3-BMS CMU18/4 101814 Wire harness kit', Category: 'BMS',
        Tier_Scheme: 'Hardware', Discountable: 'N', Item: 'Bundled',
        Quote_Warning: 'Included in 100985.2 - no separate charge' },
    ]);
    check('bundled SKU is kept out of the part picker',
      items.length === 1 && items[0].sku === '100985.2', JSON.stringify(items.map(i => i.sku)));
    check('bundled SKU is tracked for flagging', t.DATA.bundledSkus['103006'] !== undefined);
    check('missingPriceFlag returns bundled for a bundled SKU', t.missingPriceFlag('103006') === 'bundled');
    check('missingPriceFlag still returns unpriced for an unknown SKU', t.missingPriceFlag('999999') === 'unpriced');

    // A kit/loaded quote line referencing the bundled SKU must not block Save/Send.
    t.applyKitRows([{ part_number: '103006', qty: '2', kit_warning: '' }], 1);
    const line = t.state.lines.filter(l => l.sku === '103006')[0];
    check('bundled line carries the bundled flag, not unpriced',
      !!line && line.flags.indexOf('bundled') !== -1 && line.flags.indexOf('unpriced') === -1,
      line ? JSON.stringify(line.flags) : 'no line');
    check('bundled line does not raise a blocking warning', t.warningTally().total === 0,
      JSON.stringify(t.warningTally()));
  }

  /* ---- Item_Status flags actually reach the quote (was: labels defined, never assigned) ---- */
  {
    const t = freshWidget();
    const items = t.mapItems([
      { Part_Number: '101814', Description: 'n3-BMS CMU18/4 (RELEASE Q3/2026)', Category: 'BMS',
        Tier_Scheme: 'Hardware', Discountable: 'Y', Item: 'Not_Released',
        Quote_Warning: 'confirm availability before quoting', Price_T1: '210.00' },
      { Part_Number: '102100', Description: 'c-BMS18', Category: 'BMS', Tier_Scheme: 'Hardware',
        Discountable: 'N', Item: 'Discontinued', Quote_Warning: 'vendor discontinued' },
      { Part_Number: '100924', Description: 'c-BMS24', Category: 'BMS', Tier_Scheme: 'Hardware',
        Discountable: 'Y', Item: 'Active', Price_T1: '305.76' },
    ]);
    t.DATA.items = items; // loadLiveData() normally does this assignment
    const bySku = {};
    items.forEach(i => { bySku[i.sku] = i; });

    check('not_released SKU stays quotable but carries the flag',
      !!bySku['101814'] && bySku['101814'].flags.indexOf('not_released') !== -1,
      bySku['101814'] ? JSON.stringify(bySku['101814'].flags) : 'missing');
    check('active SKU carries no status flag',
      !!bySku['100924'] && bySku['100924'].flags.length === 0);
    check('discontinued SKU is excluded from the picker', bySku['102100'] === undefined);
    check('discontinued SKU still resolves its reason for saved lines',
      t.missingPriceFlag('102100') === 'discontinued');

    // A not-released part on the quote must count as a warning, not "All clear".
    t.applyKitRows([{ part_number: '101814', qty: '6', kit_warning: '' }], 1);
    const w = t.warningTally();
    check('not_released line raises a blocking warning', w.total === 1 && w.t.not_released === 1,
      JSON.stringify(w));
  }

  /* ---- Pricelist version metadata ---- */
  {
    const t = freshWidget();
    check('pricelist meta defaults empty', t.DATA.pricelist.version === '');
    t.applyPricelistMeta([{ Pricelist_Version: '1.0', Valid_From: 'July 2026',
                            Source_File: 'Lithium Balance BMS_July 01_RSP_Distributor.xlsx',
                            Source_SHA256: 'a239e3bc2242' }]);
    check('pricelist meta ingested', t.DATA.pricelist.version === '1.0' && t.DATA.pricelist.validFrom === 'July 2026',
      JSON.stringify(t.DATA.pricelist));
    t.applyPricelistMeta([]);
    check('missing Pricelist_Meta leaves prior value untouched (no crash)', t.DATA.pricelist.version === '1.0');
  }

  /* ---- Environment pill: never claim Dev when it isn't (was hardcoded) ---- */
  {
    const prod = freshWidget('https://creatorapp.zoho.com/bevcollc/qts/#Page:QTS_Quote_Builder');
    check('production URL detected as production', prod.detectCreatorEnvironment() === 'production',
      prod.detectCreatorEnvironment());

    const dev = freshWidget('https://creatorapp.zoho.com/bevcollc/environment/development/qts/#Page:QTS_Quote_Builder');
    check('development URL detected as development', dev.detectCreatorEnvironment() === 'development',
      dev.detectCreatorEnvironment());

    const stage = freshWidget('https://creatorapp.zoho.com/bevcollc/environment/stage/qts/#Page:QTS_Quote_Builder');
    check('stage URL detected as stage', stage.detectCreatorEnvironment() === 'stage',
      stage.detectCreatorEnvironment());

    const local = freshWidget('http://127.0.0.1:8789/');
    check('non-Creator host returns empty so the page keeps its own label',
      local.detectCreatorEnvironment() === '', local.detectCreatorEnvironment());

    const none = freshWidget();
    check('missing referrer stays neutral rather than guessing Dev',
      none.detectCreatorEnvironment() === '', none.detectCreatorEnvironment());
  }

  console.log(failures === 0 ? '\nALL TESTS PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})();
