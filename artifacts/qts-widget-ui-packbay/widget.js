/* QTS Quote Builder — app logic (live Creator dev wiring, read-only)
 *
 * Data source: Zoho Creator widget SDK (ZOHO.CREATOR.API.getAllRecords) against
 * Item_Master_Report and Kit_Components_Report in the current app context.
 * Picker unit prices are reference/display only — actual quote pricing is owned
 * by the existing Creator pricing backend (fn_calc_quote_lines et al).
 * Dynamic kit quantity expansion is owned by fn_get_kit_components / Expand_Kit
 * on the backend and is NOT reimplemented here.
 */
(function () {
  'use strict';

  var DATA = {
    meta: { quoteNo: 'QTS-DRAFT', currency: 'USD', source: 'creator' },
    categories: [
      { key: 'all', label: 'All' },
      { key: 'bms', label: 'BMS' },
      { key: 'non_bms', label: 'Non-BMS' },
      { key: 'part', label: 'Parts' },
      { key: 'service', label: 'Service / SW / License' },
    ],
    items: [],
    bmsKits: [],
    pendingReferenced: [],
    seedLines: [],
  };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var FLAG_LABEL = {
    discontinued:     'Discontinued',
    not_released:     'Not released',
    unpriced:         'Unpriced',
    pending_business: 'Pending business',
  };
  var FLAG_STRIPE = {
    discontinued: 'var(--sev-disc)',
    not_released: 'var(--sev-notrel)',
    unpriced: 'var(--sev-unpriced)',
    pending_business: 'var(--sev-pending)',
  };

  /* ---------------- State ---------------- */
  var state = {
    filter: 'all',
    query: '',
    lines: [],
    kitId: null,        // set from data in boot()
    kitQty: 1,
    kitCells: '',       // Series Cell Count for dynamic (CMU-based) kits
    discount: 0,
    dismissedPending: {},
    seq: 1,
    customer: null,       // selected/created CRM customer {contactId, accountId, ...}
    deal: null,           // selected/created CRM Deal {dealId, dealName, stage} — exact record ID is authoritative
    dealCandidates: null, // null = not searched yet; [] = searched, none open; [..] = open candidates
    dealChoiceMade: false,// true only after explicit "use existing" or "Create New Opportunity"
    revision: null,       // client revision counter (R1, R2, …); server persistence gated on REVISION_FIELD_READY
    quoteRecordId: null,  // Creator Quote_Request record ID once saved/loaded
    quoteStatus: null,    // saved record's Status ("Draft"/"Send for Signature"/…); null until saved/loaded
    discardConfirmOpen: false, // in-widget discard confirmation panel visibility
    sendConfirmOpen: false,    // in-widget send-for-signature confirmation panel visibility
  };

  // Normalize SKU strings so kit bridge values ("100916") match Item_Master rows.
  function normalizeSku(sku) {
    var s = fieldText(sku);
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s;
  }

  function itemBySku(sku) {
    var want = normalizeSku(sku);
    if (!want) return null;
    for (var i = 0; i < DATA.items.length; i++) {
      if (normalizeSku(DATA.items[i].sku) === want) return DATA.items[i];
    }
    return null;
  }

  // Kit helper contents (from Kit_Components) — name fallback when Item_Master misses.
  function kitComponentBySku(sku) {
    var want = normalizeSku(sku);
    if (!want) return null;
    for (var k = 0; k < DATA.bmsKits.length; k++) {
      var contents = DATA.bmsKits[k].contents || [];
      for (var i = 0; i < contents.length; i++) {
        if (normalizeSku(contents[i].sku) === want) return contents[i];
      }
    }
    return null;
  }

  function kitRowField(row, snake, pascal) {
    if (!row || typeof row !== 'object') return '';
    if (row[snake] !== undefined && row[snake] !== null && row[snake] !== '') return row[snake];
    if (row[pascal] !== undefined && row[pascal] !== null && row[pascal] !== '') return row[pascal];
    return row[snake] != null ? row[snake] : row[pascal];
  }
  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return null;
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function moneyEur(n) {
    if (n === null || n === undefined || isNaN(n)) return null;
    return '€' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Item_Master tiers are EUR list. FX_Rates_Cache.Rate for EUR = EUR per 1 USD
  // (same as fn_calc_quote_lines). usdPerEur = 1 / Rate.
  var PRICE_LOCKED_MARK = 'PRICE_LOCKED';
  var DISC_MARK_RE = /\u00abDISC:([-\d.]+)\u00bb/;
  var MARGIN_MARK_RE = /\u00abMARGIN:([-\d.]+)\u00bb/;
  var DATA_FX = { eurPerUsd: null, usdPerEur: null };
  // Header Margin % bulk-applies to unlocked lines (Stage 6).
  var headerMarginPct = 0;

  // Distrib discount sheet (workbook page 2) → Price_Rules bands.
  // Percents match functions/fn_get_discount.deluge (returned there as fractions).
  var PRICE_RULES = {
    Partner: {
      Hardware: [
        { min: 1, max: 9, pct: 20 },
        { min: 10, max: 99, pct: 15 },
        { min: 100, max: 249, pct: 12 },
        { min: 250, max: 499, pct: 9 },
        { min: 500, max: 999, pct: 7 },
        { min: 1000, max: 2499, pct: 5 },
        { min: 2500, max: 25000, pct: 3.5 },
      ],
      Software: [{ min: 1, max: 999999, pct: 33 }],
    },
    Distributor: {
      Hardware: [
        { min: 1, max: 9, pct: 10 },
        { min: 10, max: 99, pct: 7.5 },
        { min: 100, max: 249, pct: 6 },
        { min: 250, max: 499, pct: 4.5 },
        { min: 500, max: 999, pct: 3.5 },
      ],
      Software: [{ min: 1, max: 999999, pct: 16.5 }],
    },
  };
  // Default matches distributor quote builder; End Customer → 0% catalog disc.
  var customerType = 'Distributor';
  // Live Creator Price_Rules rows (when report loads); else embedded PRICE_RULES.
  var DATA_PRICE_RULES = null;

  function clampPct(pct, max) {
    var n = parseFloat(pct);
    if (!isFinite(n) || n < 0) n = 0;
    if (n > max) n = max;
    return n;
  }

  // Creator choice/lookup fields often arrive as { display_value, value }.
  function fieldText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'Y' : 'N';
    if (typeof v === 'number' && isFinite(v)) return String(v);
    if (typeof v === 'object') {
      if (Array.isArray(v) && v.length) return fieldText(v[0]);
      if (v.display_value !== undefined && v.display_value !== null) return fieldText(v.display_value);
      if (v.zc_display_value !== undefined && v.zc_display_value !== null) return fieldText(v.zc_display_value);
      if (v.value !== undefined && v.value !== null && typeof v.value !== 'object') return fieldText(v.value);
    }
    return String(v).trim();
  }

  // Item_Master: vendor X / Creator Y = discountable; blank/N = not.
  function isDiscountableFlag(val) {
    if (val === true || val === 1) return true;
    if (val === false || val === 0) return false;
    var v = fieldText(val).toUpperCase();
    return v === 'Y' || v === 'X' || v === 'YES' || v === 'TRUE' || v === '1';
  }

  // Round-80 import stored polarity inverted (X→N). Correct CSV has accessories
  // all N. If live data still shows accessories as discountable, flip the catalog.
  function fixDiscountablePolarityIfInverted(items) {
    var accessories = (items || []).filter(function (it) {
      return it && (it.category === 'part' || /accessor/i.test(str(it.type)));
    });
    if (accessories.length < 3) return false;
    var accYes = 0;
    accessories.forEach(function (it) { if (it.discountable) accYes++; });
    if (accYes < accessories.length * 0.5) return false;
    items.forEach(function (it) {
      if (!it || it.custom) return;
      it.discountable = !it.discountable;
    });
    try {
      console.warn('[QTS] Item_Master.Discountable looked inverted (accessories marked discountable) — flipped for Disc % preload. Re-import from import_preview CSV to fix Creator data.');
    } catch (e) { /* ignore */ }
    return true;
  }

  function getCustomerType() {
    var el = typeof document !== 'undefined' ? $('#f-customer-type') : null;
    var v = el ? fieldText(el.value).trim() : '';
    if (v) customerType = v;
    return customerType || 'Distributor';
  }

  function setCustomerType(type) {
    var v = str(type).trim() || 'Distributor';
    customerType = v;
    var el = typeof document !== 'undefined' ? $('#f-customer-type') : null;
    if (el) el.value = v;
  }

  function lineIsSoftware(l) {
    if (!l) return false;
    var scheme = str(l.scheme).toLowerCase();
    if (scheme === 'license') return true;
    var type = str(l.type).toLowerCase();
    if (type.indexOf('software') !== -1 || type.indexOf('license') !== -1) return true;
    var cat = str(l.category).toLowerCase();
    return cat === 'software' || cat === 'service';
  }

  function activePriceRules() {
    return DATA_PRICE_RULES || PRICE_RULES;
  }

  // Catalog Disc % from Item_Master discountable gate + Distrib discount / Price_Rules
  // (hardware vs software × qty band × customer type). Returns percent, not fraction.
  function catalogDiscountPct(opts) {
    opts = opts || {};
    if (!opts.discountable) return 0;
    var ctype = str(opts.customerType || getCustomerType());
    var table = activePriceRules();
    var rules = table[ctype];
    if (!rules) return 0; // End Customer and unknown types → 0%
    var bands = opts.isSoftware ? rules.Software : rules.Hardware;
    if (!bands || !bands.length) return 0;
    var qty = Math.max(0, Math.round(parseFloat(opts.qty) || 0));
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      if (qty >= b.min && qty <= b.max) return b.pct;
    }
    return 0;
  }

  // Fill Disc % from catalog rules unless the user overrode the field.
  function applyCatalogDiscountToLine(l, force) {
    if (!l || l.custom) return false;
    if (!force && l.discountManual) return false;
    var next = catalogDiscountPct({
      discountable: !!l.discountable,
      qty: l.qty,
      isSoftware: lineIsSoftware(l),
      customerType: getCustomerType(),
    });
    if (!l.discountable) next = 0;
    if (l.discountPct === next) return false;
    l.discountPct = next;
    return true;
  }

  // On SKU select: re-read Item_Master discountable + preload Disc % (HW/SW × qty).
  function preloadLineDiscountFromItemMaster(line, item) {
    if (!line || line.custom) return 0;
    var src = item || itemBySku(line.sku);
    if (src) {
      line.discountable = !!src.discountable;
      if (src.scheme) line.scheme = src.scheme;
      if (src.type) line.type = src.type;
      if (src.category) line.category = src.category;
      if (src.tiers) line.tiers = src.tiers;
    } else {
      line.discountable = false;
    }
    line.discountManual = false;
    applyCatalogDiscountToLine(line, true);
    return clampPct(line.discountPct, 100);
  }

  function applyCatalogDiscountToAllLines(force) {
    var changed = false;
    state.lines.forEach(function (l) {
      if (applyCatalogDiscountToLine(l, force)) {
        if (!l.priceLocked && (l.priceSource === 'eur_ref' || l.priceSource === 'stored')) {
          l.priceSource = 'eur_ref';
          refreshLineSale(l);
        }
        changed = true;
      } else if (!l.priceLocked && l.priceSource === 'eur_ref') {
        if (refreshLineSale(l)) changed = true;
      }
    });
    return changed;
  }

  function stripPriceMetaMarks(warn) {
    return str(warn)
      .replace(/\s*PRICE_LOCKED/g, '')
      .replace(/\s*\u00abPRICE_LOCKED\u00bb/g, '')
      .replace(/\s*\u00abDISC:[-\d.]+\u00bb/g, '')
      .replace(/\s*\u00abMARGIN:[-\d.]+\u00bb/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // Back-compat alias used elsewhere in this file.
  function stripPriceLockMark(warn) { return stripPriceMetaMarks(warn); }

  function withPriceMetaMarks(warn, locked, discountPct, marginPct) {
    var base = stripPriceMetaMarks(warn);
    var parts = [];
    if (base) parts.push(base);
    var d = clampPct(discountPct, 100);
    var m = clampPct(marginPct, 1000);
    if (d > 0) parts.push('\u00abDISC:' + d + '\u00bb');
    if (m > 0) parts.push('\u00abMARGIN:' + m + '\u00bb');
    if (locked) parts.push(PRICE_LOCKED_MARK);
    return parts.join(' ');
  }
  function withPriceLockMark(warn, locked) {
    return withPriceMetaMarks(warn, locked, 0, 0);
  }
  function warnIsPriceLocked(warn) {
    var w = str(warn);
    return w.indexOf(PRICE_LOCKED_MARK) !== -1 || w.indexOf('\u00abPRICE_LOCKED\u00bb') !== -1;
  }
  function parseDiscPctFromWarn(warn) {
    var m = DISC_MARK_RE.exec(str(warn));
    return m ? clampPct(m[1], 100) : null;
  }
  function parseMarginPctFromWarn(warn) {
    var m = MARGIN_MARK_RE.exec(str(warn));
    return m ? clampPct(m[1], 1000) : null;
  }

  function eurListToUsd(eur) {
    if (eur === null || eur === undefined || isNaN(eur)) return null;
    if (!DATA_FX.usdPerEur || !isFinite(DATA_FX.usdPerEur) || DATA_FX.usdPerEur <= 0) return null;
    return Math.round(Number(eur) * DATA_FX.usdPerEur * 100) / 100;
  }

  function lineDiscountFrac(l) {
    return clampPct(l && l.discountPct, 100) / 100;
  }
  function lineMarginFrac(l) {
    return clampPct(l && l.marginPct, 1000) / 100;
  }

  // Sale USD = List_EUR × FX × (1 − Disc%/100) × (1 + Margin%/100).
  // Locked / manual / stored lines keep unit.
  function computeSaleUsd(l) {
    if (!l) return null;
    if (l.priceLocked || l.priceSource === 'manual' || l.custom || l.priceSource === 'stored') {
      return (l.unit === null || l.unit === undefined || isNaN(l.unit)) ? null : Number(l.unit);
    }
    var listEur = l.listEur;
    if (listEur === null || listEur === undefined || isNaN(listEur)) return null;
    var usd = eurListToUsd(listEur);
    if (usd === null) return null;
    return Math.round(usd * (1 - lineDiscountFrac(l)) * (1 + lineMarginFrac(l)) * 100) / 100;
  }

  function applyHeaderMarginToLines(pct) {
    headerMarginPct = clampPct(pct, 1000);
    var changed = false;
    state.lines.forEach(function (l) {
      if (!l || l.priceLocked || l.custom || l.priceSource === 'manual') return;
      l.marginPct = headerMarginPct;
      if (l.priceSource === 'eur_ref' || l.priceSource === 'stored') {
        l.priceSource = 'eur_ref';
        if (refreshLineSale(l)) changed = true;
      }
    });
    return changed;
  }

  function refreshLineSale(l) {
    if (!l || l.priceSource !== 'eur_ref' || l.priceLocked || l.custom) return false;
    var sale = computeSaleUsd(l);
    if (sale === null || sale === l.unit) return false;
    l.unit = sale;
    if (l.flags) l.flags = l.flags.filter(function (f) { return f !== 'unpriced'; });
    return true;
  }

  // Current quote currency = the visible selector (falls back to DATA.meta for
  // headless/test contexts). Also written to Quote_Request.Currency on save so
  // Creator FX mode matches the UI.
  function getCurrentCurrency() {
    var el = typeof document !== 'undefined' ? $('#f-currency') : null;
    var v = el ? str(el.value) : '';
    return v || str(DATA.meta.currency) || 'USD';
  }

  function refPillLabel() {
    return 'EUR list';
  }

  /* ---------------- Data load (live Creator, read-only) ---------------- */

  var PAGE_SIZE = 200; // documented max for JS API v1 getAllRecords
  var MAX_PAGES = 50; // hard stop against a runaway loop; 10k records is far beyond current scale

  // Fetch every record of a report, paging until a short page. Some SDK builds
  // reject with code 3100 ("no records") on the first empty page — treat that
  // as end-of-data rather than a failure, but only for pages after the first.
  function fetchAllRecords(reportName) {
    var all = [];
    function fetchPage(page) {
      var config = { reportName: reportName, page: page, pageSize: PAGE_SIZE };
      return ZOHO.CREATOR.API.getAllRecords(config).then(function (resp) {
        if (typeof resp === 'string') { // some SDK builds resolve with raw JSON text
          try { resp = JSON.parse(resp); } catch (e) { /* fall through to shape check */ }
        }
        var code = resp && resp.code;
        if (code === 3100 || code === '3100') return all; // resolved-style "no records"
        var rows = resp && resp.data;
        if (typeof rows === 'string') {
          try { rows = JSON.parse(rows); } catch (e) { /* fall through */ }
        }
        if (!Array.isArray(rows)) {
          throw new Error(reportName + ': unexpected response shape (no data array; code=' + code + ')');
        }
        all = all.concat(rows);
        if (rows.length < PAGE_SIZE || page >= MAX_PAGES) return all;
        return fetchPage(page + 1);
      }, function (err) {
        var code = err && (err.code || (err.responseText && err.responseText.code));
        if (page > 1 && (code === 3100 || code === '3100')) return all; // past the last page
        throw normalizeError(reportName + ' fetch failed', err);
      });
    }
    return fetchPage(1);
  }

  function normalizeError(prefix, err) {
    var detail = '';
    if (err) {
      if (typeof err === 'string') detail = err;
      else if (err.message) detail = err.message;
      else { try { detail = JSON.stringify(err); } catch (e) { detail = String(err); } }
    }
    return new Error(prefix + (detail ? ' — ' + detail : ''));
  }

  function str(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

  /* Creator app date format is dd-MMM-yyyy (form metadata; write+readback
   * verified live on TEST-QUOTE0017). The <input type="date"> side is ISO. */
  var MONTHS_3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function isoToCreatorDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
    if (!m) return '';
    return m[3] + '-' + MONTHS_3[Number(m[2]) - 1] + '-' + m[1];
  }

  function creatorDateToIso(val) {
    var s = str(val);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
    if (!m) return '';
    var idx = MONTHS_3.map(function (x) { return x.toLowerCase(); }).indexOf(m[2].toLowerCase());
    if (idx === -1) return '';
    var mm = String(idx + 1); if (mm.length < 2) mm = '0' + mm;
    return m[3] + '-' + mm + '-' + m[1];
  }

  function isoLocal(d) {
    var mm = String(d.getMonth() + 1); if (mm.length < 2) mm = '0' + mm;
    var dd = String(d.getDate()); if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  function plus30(iso) {
    var parts = iso.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + 30);
    return isoLocal(d);
  }
  // New-quote defaults: Quote Date = today's LOCAL calendar date (not UTC —
  // avoids the evening off-by-one); Valid Until = Quote Date + 30 calendar
  // days. Only fills EMPTY inputs, so loaded/stored dates are never clobbered.
  function seedDefaultDates() {
    var dateIn = $('#f-date');
    var validIn = $('#f-valid');
    if (dateIn && !dateIn.value) dateIn.value = isoLocal(new Date());
    if (validIn && !validIn.value && dateIn && dateIn.value) validIn.value = plus30(dateIn.value);
    var payEl = $('#f-payment-terms');
    if (payEl && !str(payEl.value)) payEl.value = DEFAULT_PAYMENT_TERMS;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function firstTierPrice(rec) {
    for (var i = 1; i <= 9; i++) {
      var raw = str(rec['Price_T' + i]);
      if (raw === '') continue;
      var n = parseFloat(raw.replace(/[$,]/g, ''));
      if (!isNaN(n)) return n;
    }
    return null;
  }

  /* ---------------- Quantity-tier pricing (mirrors fn_get_tier_price.deluge) ----------------
   * Display-tier correctness only for unsaved eur_ref lines: Creator save-time
   * pricing (fn_calc_quote_lines -> fn_get_tier_price) stays authoritative. */

  // Price_T1..T9 as numbers-or-null. The Item_Master report currently exposes
  // only T1..T7; T8/T9 read as blank -> null, which the walk-down handles.
  function tierPricesFromRecord(rec) {
    var tiers = [];
    for (var i = 1; i <= 9; i++) {
      var raw = str(rec['Price_T' + i]);
      var n = raw === '' ? NaN : parseFloat(raw.replace(/[$,]/g, ''));
      tiers.push(isNaN(n) ? null : n);
    }
    return tiers;
  }

  // Same fallback as the Deluge side: blank/unknown Tier_Scheme defaults to
  // hardware; license only when Tier_Scheme or Category says license/Software.
  function tierSchemeFromRecord(rec) {
    var tier = str(rec.Tier_Scheme).toLowerCase();
    var cat = str(rec.Category).toLowerCase();
    return (tier === 'license' || cat === 'software') ? 'license' : 'hardware';
  }

  // Band tables copied from fn_get_tier_price.deluge, including the walk-down
  // to the highest published tier at or below the nominal band. Returns null
  // (never an invented price) when no usable tier exists.
  function tierPriceForQty(tiers, scheme, qty) {
    if (!tiers || !tiers.length) return null;
    var q = Math.max(0, parseInt(qty, 10) || 0);
    var idx;
    if (scheme === 'license') {
      idx = q <= 1 ? 0 : q <= 2 ? 1 : q <= 4 ? 2 : q <= 9 ? 3 : q <= 24 ? 4 : 5;
    } else {
      idx = q <= 19 ? 0 : q <= 99 ? 1 : q <= 259 ? 2 : q <= 499 ? 3 : q <= 999 ? 4 :
        q <= 2499 ? 5 : q <= 4999 ? 6 : q <= 9999 ? 7 : 8;
    }
    if (idx >= tiers.length) idx = tiers.length - 1;
    for (var i = idx; i >= 0; i--) {
      if (tiers[i] !== null && tiers[i] !== undefined && !isNaN(tiers[i])) return tiers[i];
    }
    return null;
  }

  // Re-derive EUR list from tiers, then USD sale via FX + disc% (unless locked).
  function repriceEurRefLine(l) {
    if (!l || l.priceLocked || l.custom || l.priceSource !== 'eur_ref') return false;
    var changed = false;
    if (l.tiers) {
      var list = tierPriceForQty(l.tiers, l.scheme, l.qty);
      if (list !== null && list !== l.listEur) {
        l.listEur = list;
        changed = true;
      }
    }
    if (refreshLineSale(l)) changed = true;
    return changed;
  }

  // Live Item_Master Category values (verified 2026-07-09 via report read):
  // BMS, CMU, MCU, Accessory, Software. Tier_Scheme is not exposed by the
  // report (blank fields are omitted), so Category is the authoritative basis;
  // the license check is kept as a harmless forward-compat fallback.
  function deriveCategory(rec) {
    var tier = str(rec.Tier_Scheme).toLowerCase();
    var cat = str(rec.Category).toLowerCase();
    if (tier === 'license' || cat === 'software') return 'service';
    if (cat.indexOf('bms') !== -1 || cat === 'cmu' || cat === 'mcu') return 'bms';
    if (cat.indexOf('part') !== -1 || cat.indexOf('accessor') !== -1) return 'part';
    return 'non_bms';
  }

  function deriveTypeLabel(rec) {
    var cat = str(rec.Category);
    var catL = cat.toLowerCase();
    var tier = str(rec.Tier_Scheme).toLowerCase();
    if (catL === 'software' || tier === 'license') return 'Software / License';
    if (catL === 'accessory') return 'Part / Accessory';
    if (cat !== '') return cat; // BMS / CMU / MCU / Hardware — verified live values shown as-is
    return 'Product';
  }

  function mapItems(records) {
    var items = records.map(function (rec) {
      // Normalize Creator choice wrappers so Discountable/Category always parse.
      var norm = {
        Part_Number: fieldText(rec.Part_Number),
        Description: fieldText(rec.Description),
        Category: fieldText(rec.Category),
        Tier_Scheme: fieldText(rec.Tier_Scheme),
        Discountable: fieldText(rec.Discountable),
        Price_T1: rec.Price_T1, Price_T2: rec.Price_T2, Price_T3: rec.Price_T3,
        Price_T4: rec.Price_T4, Price_T5: rec.Price_T5, Price_T6: rec.Price_T6,
        Price_T7: rec.Price_T7, Price_T8: rec.Price_T8, Price_T9: rec.Price_T9,
      };
      var unit = firstTierPrice(norm);
      return {
        sku: norm.Part_Number,
        name: norm.Description,
        category: deriveCategory(norm),
        type: deriveTypeLabel(norm),
        unit: unit, // EUR list (first tier) — NOT USD sale
        listEur: unit,
        discountable: isDiscountableFlag(norm.Discountable),
        rawDiscountable: norm.Discountable,
        tiers: tierPricesFromRecord(norm),
        scheme: tierSchemeFromRecord(norm),
        flags: unit === null ? ['unpriced'] : [],
      };
    }).filter(function (it) { return it.sku !== ''; });
    fixDiscountablePolarityIfInverted(items);
    return items;
  }

  function ingestPriceRules(records) {
    var built = {};
    var count = 0;
    (records || []).forEach(function (rec) {
      var ct = fieldText(rec.Customer_Type);
      var pt = fieldText(rec.Product_Type);
      if (!ct || (pt !== 'Hardware' && pt !== 'Software')) return;
      var min = parseInt(fieldText(rec.Qty_Min), 10);
      var max = parseInt(fieldText(rec.Qty_Max), 10);
      var pct = parseFloat(fieldText(rec.Discount_Pct));
      if (!isFinite(min) || !isFinite(max) || !isFinite(pct)) return;
      if (pct > 0 && pct < 1) pct = Math.round(pct * 1000) / 10; // 0.10 → 10
      if (!built[ct]) built[ct] = { Hardware: [], Software: [] };
      built[ct][pt].push({ min: min, max: max, pct: pct });
      count++;
    });
    Object.keys(built).forEach(function (ct) {
      ['Hardware', 'Software'].forEach(function (pt) {
        built[ct][pt].sort(function (a, b) { return a.min - b.min; });
      });
    });
    if (count > 0) DATA_PRICE_RULES = built;
    return count;
  }

  function loadPriceRulesSafe() {
    return fetchAllRecords('Price_Rules_Report').catch(function () {
      return fetchAllRecords('Price_Rules').catch(function () { return []; });
    });
  }

  // Display labels only — the two n3 kits share main SKU 100816 ("n3-BMS MCU"),
  // so the derived names were ambiguous in the dropdown. Kit KEYS are unchanged.
  var KIT_LABELS = {
    n3bms_cmu12: 'n3-BMS MCU — CMU12',
    n3bms_cmu18: 'n3-BMS MCU — CMU18',
  };

  function mapKits(records) {
    var byKey = {};
    var order = [];
    records.forEach(function (rec) {
      var key = str(rec.Kit_Key);
      if (key === '') return;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(rec);
    });
    return order.map(function (key) {
      var rows = byKey[key];
      var mainRow = null;
      var contents = rows.map(function (rec) {
        var req = str(rec.Requirement).toLowerCase();
        var rule = str(rec.Qty_Rule).toLowerCase();
        if (req === 'main' && !mainRow) mainRow = rec;
        var qty = null;
        if (rule === 'fixed') {
          var n = parseFloat(str(rec.Qty_Value));
          if (!isNaN(n)) qty = n;
        }
        return {
          sku: str(rec.Component_SKU),
          name: str(rec.Description),
          qty: qty,
          qtyRule: rule,
          channelsPerCmu: str(rec.Channels_Per_CMU),
          requirement: req,
          blocked: str(rec.Is_Blocked) === 'Y',
          holdReason: str(rec.Hold_Reason),
          warningText: str(rec.Warning_Text),
          confidence: str(rec.Confidence),
          notes: str(rec.Notes),
          alternateSku: str(rec.Alternate_SKU),
        };
      });
      var dynamicCount = 0, heldCount = 0;
      contents.forEach(function (c) {
        if (c.qtyRule !== 'fixed') dynamicCount++;
        if (c.blocked || c.holdReason !== '' || c.confidence === 'pending_business') heldCount++;
      });
      var note = contents.length + ' component' + (contents.length === 1 ? '' : 's');
      if (dynamicCount) note += ', ' + dynamicCount + ' with calculated quantity';
      if (heldCount) note += ', ' + heldCount + ' held/blocked';
      return {
        id: key,
        name: KIT_LABELS[key] || (mainRow ? (str(mainRow.Description) || key) : key),
        note: note,
        contents: contents,
      };
    });
  }

  function mapPendingReferenced(records) {
    var seen = {};
    var out = [];
    records.forEach(function (rec) {
      var sku = str(rec.Component_SKU);
      if (sku === '' || seen[sku]) return;
      var pending = str(rec.Hold_Reason) !== '' ||
        str(rec.Confidence) === 'pending_business' ||
        str(rec.Is_Blocked) === 'Y';
      if (pending) { seen[sku] = true; out.push(sku); }
    });
    return out;
  }

  function applyFxRates(records) {
    DATA_FX.eurPerUsd = null;
    DATA_FX.usdPerEur = null;
    (records || []).forEach(function (rec) {
      if (str(rec.Currency).toUpperCase() !== 'EUR') return;
      var rate = parseFloat(rec.Rate);
      if (!isFinite(rate) || rate <= 0) return;
      DATA_FX.eurPerUsd = rate;
      DATA_FX.usdPerEur = 1 / rate;
    });
  }

  function loadFxRatesSafe() {
    return fetchAllRecords('FX_Rates_Cache_Report').catch(function () {
      return fetchAllRecords('FX_Rates_Cache').catch(function () { return []; });
    });
  }

  function loadLiveData() {
    return Promise.all([
      fetchAllRecords('Item_Master_Report'),
      fetchAllRecords('Kit_Components_Report'),
      loadFxRatesSafe(),
      loadPriceRulesSafe(),
    ]).then(function (results) {
      var itemRecords = results[0];
      var kitRecords = results[1];
      var fxRecords = results[2] || [];
      var priceRuleRecords = results[3] || [];
      if (!itemRecords.length) throw new Error('Item_Master_Report returned 0 records — cannot build the picker.');
      DATA.items = mapItems(itemRecords);
      DATA.bmsKits = mapKits(kitRecords);
      DATA.pendingReferenced = mapPendingReferenced(kitRecords);
      applyFxRates(fxRecords);
      var ruleCount = ingestPriceRules(priceRuleRecords);
      if (!ruleCount) {
        try { console.warn('[QTS] Price_Rules report empty/missing — using embedded Distrib discount bands for Disc %'); } catch (e) { /* ignore */ }
      }
      if (!DATA_FX.usdPerEur) {
        try { console.warn('[QTS] FX_Rates_Cache EUR rate missing — sale USD cannot convert until rates load'); } catch (e) { /* ignore */ }
      }
      var discCount = 0;
      DATA.items.forEach(function (it) { if (it.discountable) discCount++; });
      try {
        console.info('[QTS] Item_Master loaded: ' + DATA.items.length + ' SKUs, ' + discCount +
          ' discountable; Price_Rules bands: ' + (ruleCount || 'embedded'));
      } catch (e) { /* ignore */ }
      if (!DATA.items.length) {
        throw new Error('Item_Master_Report returned ' + itemRecords.length + ' records but none mapped ' +
          '(Part_Number missing/empty on every row — the report response shape may have changed).');
      }
    });
  }

  // Manual picker clicks only: re-clicking a SKU already on the quote bumps its
  // quantity instead of appending a duplicate row. Kit expansion deliberately
  // does NOT use this — kit multiplicity follows the stored kit quantities.
  function addOrIncrementLine(item) {
    if (!item) return;
    // Always resolve from the loaded Item_Master catalog (source of Discountable).
    var catalog = itemBySku(item.sku) || item;
    var sku = str(catalog.sku);
    if (sku !== '') {
      for (var i = 0; i < state.lines.length; i++) {
        var l = state.lines[i];
        if (!l.custom && str(l.sku) === sku) {
          l.qty = (parseFloat(l.qty) || 0) + 1;
          var discBump = preloadLineDiscountFromItemMaster(l, catalog);
          repriceEurRefLine(l);
          render();
          markDirty();
          toast(sku + ' qty ' + l.qty + (catalog.discountable ? (' · Disc ' + discBump + '%') : ' · not discountable'));
          return;
        }
      }
    }
    addLineFromItem(catalog, 1);
    render();
    markDirty();
    var added = state.lines[state.lines.length - 1];
    var discMsg = added && added.discountable
      ? (' · Disc ' + clampPct(added.discountPct, 100) + '% preloaded')
      : ' · not discountable (Item_Master)';
    toast('Added ' + catalog.sku + discMsg);
  }

  function addLineFromItem(item, qty) {
    if (!item) return;
    // Enforce the critical rule: pending-business SKUs are never added to the quote.
    if (item.flags && item.flags.indexOf('pending_business') !== -1) {
      toast('“' + item.sku + '” needs confirmation — see the Needs confirmation panel', 'warn');
      return;
    }
    // Prefer live Item_Master row so Discountable / scheme always match the catalog.
    var catalog = itemBySku(item.sku) || item;
    var listEur = catalog.listEur != null ? catalog.listEur : catalog.unit;
    var line = {
      id: 'L' + state.seq++, sku: catalog.sku, name: catalog.name, type: catalog.type,
      qty: qty || 1, listEur: listEur, discountPct: 0, marginPct: headerMarginPct || 0, unit: null,
      flags: (catalog.flags || []).slice(), custom: false,
      tiers: catalog.tiers || null, scheme: catalog.scheme || 'hardware',
      category: catalog.category || '',
      priceSource: 'eur_ref', priceLocked: false, discountable: !!catalog.discountable,
      discountManual: false,
    };
    preloadLineDiscountFromItemMaster(line, catalog);
    repriceEurRefLine(line);
    if (line.unit === null && listEur !== null) {
      // FX missing — show EUR list as unavailable USD rather than lying with $EUR
      line.flags = line.flags.indexOf('unpriced') === -1 ? line.flags.concat(['unpriced']) : line.flags;
    }
    state.lines.push(line);
  }

  /* ---------------- CRM customer bridge (Creator-native) ----------------
   * The widget SDK cannot call CRM directly. It writes a CRM_Bridge record
   * (Action/Query_Text/Payload_JSON); that form's on-create Deluge workflow
   * performs the zoho.crm.* work synchronously and writes Result_jSON +
   * Request_Status back onto the record, which we then read by ID.
   * Deploy packet: docs/CRM_CUSTOMER_LOOKUP_PACKET.md (BI1-T71 repo).
   */
  var BRIDGE_FORM = 'CRM_Bridge';
  var BRIDGE_REPORT = 'CRM_Bridge_Report';
  var QUOTE_FORM = 'Quote_Request';
  var QUOTE_REPORT = 'Quote_Request_Report';
  // Flip to true ONLY after Quote_Request gains CRM_Contact_ID / CRM_Account_ID /
  // CRM_Deal_ID (packet step 3); until then Save Draft omits them so it can't fail.
  var CRM_ID_FIELDS_READY = true; // Quote_Request CRM ID fields deployed 2026-07-09
  // Flip to true ONLY after Quote_Request gains a Quote_Revision field (Tier 3
  // schema gate, Round 95). Until then the revision counter is display-only and
  // Save Draft omits it so persistence can't fail (CRM_ID_FIELDS_READY pattern).
  var REVISION_FIELD_READY = false;
  // Single Line text on Quote_Request (Payment_Terms). Writer merge key: payment_terms.
  var PAYMENT_TERMS_FIELD_READY = true;
  var DEFAULT_PAYMENT_TERMS = 'Net 30';

  // Wrap a promise with a hard deadline — the v1 SDK can leave its promise
  // forever-pending on malformed requests, which must never hang the UI.
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error(label + ' timed out after ' + Math.round(ms / 1000) + 's — the Creator API did not respond'));
      }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
        function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function addRecord(formName, fieldMap) {
    // Bundled v1 SDK exposes API.addRecord (SINGULAR) — addRecords does not exist
    // in widgetsdk-min.js (grep-verified), so calling it threw a synchronous
    // TypeError that escaped the promise chain (the STEP-3 hang). Field map stays
    // nested per the official doc: data: {"data": {...}}.
    var api = ZOHO.CREATOR.API;
    var addFn = api.addRecord || api.addRecords;
    if (typeof addFn !== 'function') {
      return Promise.reject(new Error('Creator SDK exposes no addRecord/addRecords API'));
    }
    var sdkPromise;
    try {
      sdkPromise = addFn.call(api, { formName: formName, data: { data: fieldMap } });
    } catch (syncErr) {
      return Promise.reject(new Error('addRecord threw synchronously: ' +
        (syncErr && syncErr.message ? syncErr.message : String(syncErr))));
    }
    return withTimeout(sdkPromise, 20000, formName + ' add').then(function (resp) {
      if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { /* shape check below */ } }
      // Envelope variants seen across SDK builds:
      //   {code:3000, data:{ID}} | {data:[{ID}]} | {result:[{code:3000, data:{ID}}]}
      var d = resp && resp.data;
      var id = d && (d.ID || (d[0] && d[0].ID));
      if (!id && resp && Array.isArray(resp.result) && resp.result[0] && resp.result[0].data) {
        id = resp.result[0].data.ID;
      }
      if (!id) {
        var keys = resp && typeof resp === 'object' ? Object.keys(resp).join(',') : typeof resp;
        throw new Error(formName + ' add returned no record ID (code=' + (resp && resp.code) + ', keys=' + keys + ')');
      }
      return String(id);
    }, function (err) { throw normalizeError(formName + ' add failed', err); });
  }

  // In-place record update. Bundled SDK signature (verified in widgetsdk-min.js):
  // updateRecord({reportName, id, data}) -> EDIT_RECORDS with listOfRecords:[id],
  // body:e.data — so the field map keeps the same data:{data:{...}} nesting as add.
  // NOTE: Quote_Lines subform replace-vs-append semantics through this API are
  // UNPROVEN until live QA on a TEST quote confirms them.
  function updateRecord(reportName, id, fieldMap) {
    if (typeof ZOHO === 'undefined' || !ZOHO.CREATOR || !ZOHO.CREATOR.API) {
      return Promise.reject(new Error('ZOHO is not defined'));
    }
    var api = ZOHO.CREATOR.API;
    if (typeof api.updateRecord !== 'function') {
      return Promise.reject(new Error('Creator SDK exposes no updateRecord API'));
    }
    var sdkPromise;
    try {
      sdkPromise = api.updateRecord({ reportName: reportName, id: String(id), data: { data: fieldMap } });
    } catch (syncErr) {
      return Promise.reject(new Error('updateRecord threw synchronously: ' +
        (syncErr && syncErr.message ? syncErr.message : String(syncErr))));
    }
    return withTimeout(sdkPromise, 20000, reportName + ' update').then(function (resp) {
      if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { /* shape check below */ } }
      var code = resp && (resp.code || (Array.isArray(resp.result) && resp.result[0] && resp.result[0].code));
      if (code !== undefined && code !== 3000) {
        throw new Error(reportName + ' update returned code ' + code);
      }
      return String(id);
    }, function (err) { throw normalizeError(reportName + ' update failed', err); });
  }

  function getRecordById(reportName, id) {
    var call = ZOHO.CREATOR.API.getRecordById({ reportName: reportName, id: id });
    return withTimeout(call, 15000, reportName + ' read').then(function (resp) {
      if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { /* shape check below */ } }
      var rec = resp && resp.data;
      if (!rec) throw new Error(reportName + ' read returned no record (code=' + (resp && resp.code) + ')');
      return rec;
    }, function (err) { throw normalizeError(reportName + ' read failed', err); });
  }

  // Poll the bridge record until Request_Status is done/error. The workflow runs
  // synchronously on add, so the first read is usually final; the retries only
  // cover propagation lag. Bounded: 5 reads x 1.2s spacing, then a clear timeout.
  function readBridgeResult(recordId, attempt) {
    attempt = attempt || 1;
    return getRecordById(BRIDGE_REPORT, recordId).then(function (rec) {
      var status = str(rec.Request_Status);
      if (status === 'done' || status === 'error') return rec;
      if (attempt >= 5) {
        throw new Error('CRM bridge did not finish (Request_Status="' + status +
          '" after ' + attempt + ' reads) — check the CRM_Bridge workflow in Creator dev');
      }
      return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(function () {
        return readBridgeResult(recordId, attempt + 1);
      });
    });
  }

  function bridgeCall(action, queryText, payloadObj) {
    var fields = { Action_field: action, Query_Text: queryText || '' }; // live link name is Action_field (Creator reserves "Action")
    if (payloadObj) fields.Payload_JSON = JSON.stringify(payloadObj);
    return addRecord(BRIDGE_FORM, fields).then(function (id) {
      return readBridgeResult(id);
    }).then(function (rec) {
      var status = str(rec.Request_Status);
      var raw = rec.Result_jSON; // live link name is Result_jSON (lowercase j)
      var result = {};
      try { result = JSON.parse(raw || '{}'); } catch (e) { throw new Error('CRM bridge returned unparseable Result_jSON (' + String(raw).slice(0, 80) + ')'); }
      if (status !== 'done') throw new Error('CRM bridge error: ' + (result.error || 'Request_Status=' + (status || 'blank')));
      return result;
    });
  }

  // CRM search cache — repeated SEARCH CRM for the same query must not burn
  // Creator External Calls. TTL covers a sales session; clear on new search miss.
  var CRM_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
  var crmSearchCache = Object.create(null);
  function crmSearchCacheKey(q) {
    return str(q).trim().toLowerCase();
  }
  function getCachedCrmSearch(q) {
    var k = crmSearchCacheKey(q);
    if (!k) return null;
    var hit = crmSearchCache[k];
    if (!hit) return null;
    if ((Date.now() - hit.at) > CRM_SEARCH_CACHE_TTL_MS) {
      delete crmSearchCache[k];
      return null;
    }
    return hit;
  }
  function putCachedCrmSearch(q, contacts, leads) {
    var k = crmSearchCacheKey(q);
    if (!k) return;
    crmSearchCache[k] = {
      at: Date.now(),
      contacts: Array.isArray(contacts) ? contacts : [],
      leads: Array.isArray(leads) ? leads : [],
    };
  }
  function clearCrmSearchCache() {
    crmSearchCache = Object.create(null);
    dealSearchCache = Object.create(null);
  }

  function crmStatus(msg, isErr) {
    var el = $('#crm-status');
    el.textContent = msg || '';
    el.className = 'crm-status' + (isErr ? ' err' : '');
  }

  function bridgeUnavailable(err) {
    // Missing form/report → bridge not deployed yet; anything else is a real error.
    crmStatus('CRM lookup unavailable: ' + (err && err.message ? err.message : err) +
      ' (if this mentions a missing form/report, the CRM_Bridge deploy packet has not been applied yet)', true);
  }

  function renderCrmResults(matches) {
    var box = $('#crm-results');
    box.innerHTML = '';
    if (!matches.length) {
      crmStatus('No CRM contacts or leads matched. Use “+ New customer” to create one.');
      return;
    }
    crmStatus(matches.length + ' match' + (matches.length === 1 ? '' : 'es') + ' — select one:');
    matches.forEach(function (m) {
      var isLead = !m.contact_id && !!m.lead_id;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'result crm-result';
      btn.innerHTML = '<div class="name"></div><div class="type-tag"></div>';
      var label = (m.name || '(no name)') + ((m.account_name || m.company) ? ' — ' + (m.account_name || m.company) : '');
      btn.firstChild.textContent = isLead ? '[LEAD] ' + label : label;
      btn.lastChild.textContent = m.email || m.phone || 'no email on record';
      if (isLead) {
        btn.addEventListener('click', function () { selectLead(m.lead_id); });
      } else {
        btn.addEventListener('click', function () { selectCustomer(m.contact_id); });
      }
      box.appendChild(btn);
    });
  }

  function selectCustomer(contactId, opts) {
    opts = opts || {};
    var keepQuote = !!opts.keepQuote;
    var prevContactId = state.customer && state.customer.contactId ? str(state.customer.contactId) : '';
    var nextContactId = str(contactId);
    crmStatus('Loading CRM contact ' + contactId + '…');
    bridgeCall('get_customer', contactId).then(function (c) {
      // Switching contacts must never keep another customer's quote lines / Deal.
      // keepQuote=true is for load-restore paths only.
      if (!keepQuote && prevContactId && nextContactId && prevContactId !== nextContactId) {
        clearQuoteContextForDealSwitch();
        clearDealSelection();
        toast('Switched CRM contact — previous quote lines cleared');
        renderLines();
        renderTotals();
      }
      state.customer = {
        contactId: str(c.contact_id), accountId: str(c.account_id),
        name: str(c.name), email: str(c.email), phone: str(c.phone),
        company: str(c.account_name),
        billing: c.billing_address || null, shipping: c.shipping_address || null,
        mailing: c.mailing_address || null,
      };
      $('#f-contact').value = state.customer.name;
      $('#f-customer').value = state.customer.company || state.customer.name;
      $('#crm-results').innerHTML = '';
      renderSelectedCustomer();
      crmStatus('');
      // Normal flow (approved 2026-07-13): after the customer is known,
      // discover their existing open Deals — the existing Deal is PRIMARY.
      // Skip only when this quote already carries an explicit Deal choice
      // (loading a saved quote restores its persisted CRM_Deal_ID).
      markDirty();
      if (!state.dealChoiceMade) return searchDeals();
    }).catch(bridgeUnavailable);
  }

  function selectLead(leadId) {
    crmStatus('Loading CRM lead ' + leadId + '…');
    bridgeCall('get_lead', leadId).then(function (c) {
      state.customer = {
        leadId: str(c.lead_id), contactId: '', accountId: '',
        name: str(c.name), email: str(c.email), phone: str(c.phone),
        company: str(c.company),
        billing: c.address || null, shipping: null, mailing: null,
      };
      $('#f-contact').value = state.customer.name;
      $('#f-customer').value = state.customer.company || state.customer.name;
      $('#crm-results').innerHTML = '';
      clearDealSelection();
      markDirty();
      renderSelectedCustomer();
      renderDealPanel();
      crmStatus('');
    }).catch(bridgeUnavailable);
  }

  function fmtAddr(a) {
    if (!a) return '';
    return [a.street, a.city, a.state, a.code, a.country].filter(function (x) { return str(x) !== ''; }).join(', ');
  }

  function renderSelectedCustomer() {
    var box = $('#crm-selected');
    var c = state.customer;
    if (!c) { box.innerHTML = ''; return; }
    box.innerHTML =
      '<div class="crm-chip">' +
        '<div><b></b><span class="crm-ids"></span></div>' +
        '<div class="crm-addr"></div>' +
        '<button type="button" class="mini-btn subtle" id="crm-clear">Clear</button>' +
      '</div>';
    box.querySelector('b').textContent = c.name + (c.company ? ' — ' + c.company : '') + (c.email ? ' · ' + c.email : '');
    var idLabel = c.leadId
      ? ' CRM Lead ' + c.leadId + ' (converts to Contact + Account + Deal on save)'
      : ' CRM Contact ' + c.contactId + (c.accountId ? ' · Account ' + c.accountId : '');
    box.querySelector('.crm-ids').textContent = idLabel;
    var addr = fmtAddr(c.billing) || fmtAddr(c.mailing);
    box.querySelector('.crm-addr').textContent = addr ? ('Billing: ' + addr + (fmtAddr(c.shipping) ? ' · Shipping: ' + fmtAddr(c.shipping) : '')) : 'No address on the CRM record.';
    box.querySelector('#crm-clear').addEventListener('click', function () {
      state.customer = null;
      clearDealSelection(); // a Deal belongs to its customer — never keep it across a customer change
      clearQuoteContextForDealSwitch(); // lines belong to the prior CRM context — never orphan them
      renderSelectedCustomer();
      renderDealPanel();
      renderLines();
      renderTotals();
    });
  }

  /* ---------------- CRM Deal search / select (Round 95) ----------------
   * Approved flow: search customer → discover relevant open Deals → user
   * EXPLICITLY selects an existing Deal OR clicks "Create New Opportunity".
   * The exact CRM Deal record ID is the authoritative identity; it is
   * persisted to Quote_Request.CRM_Deal_ID at save. Closed terminal Deals
   * are shown for context but never selectable. No auto-selection, ever.
   */
  function clearDealSelection() {
    state.deal = null;
    state.dealCandidates = null;
    state.dealChoiceMade = false;
  }

  // Pure save-gate: may this quote be saved given the Deal-choice state?
  // Blocks only the ambiguous case — open candidates exist and the user has
  // made no explicit choice. No customer / no candidates found → allowed
  // (Deal sync is simply skipped server-side; fn_sync_to_crm logs it).
  function dealSaveGate() {
    if (!state.customer) return { ok: true };
    if (state.dealChoiceMade) return { ok: true };
    if (Array.isArray(state.dealCandidates)) {
      var open = state.dealCandidates.filter(function (d) { return !d.is_closed; });
      if (open.length) {
        return { ok: false, reason: open.length + ' open CRM Deal(s) exist for this customer — select one or choose Create New Opportunity before saving (no silent duplicates)' };
      }
    }
    return { ok: true };
  }

  // Unconverted Lead: quoting is the conversion moment (fn_sync_to_crm).
  function isLeadPendingConversion() {
    var c = state.customer;
    return !!(c && str(c.leadId) && !str(c.contactId));
  }

  // After sync converts a Lead (or restores IDs), update chip + Deal in place —
  // do not force the user to re-search the Contact.
  function applyConvertedCrmIds(opts) {
    opts = opts || {};
    var contactId = str(opts.contactId);
    var accountId = str(opts.accountId);
    var dealId = str(opts.dealId);
    var dealName = str(opts.dealName);
    var stage = str(opts.stage);
    if (state.customer && contactId) {
      state.customer.contactId = contactId;
      if (accountId) state.customer.accountId = accountId;
    }
    if (dealId) {
      state.deal = {
        dealId: dealId,
        dealName: dealName || (state.deal && state.deal.dealName) || '',
        stage: stage || (state.deal && state.deal.stage) || 'Proposal/Price Quote',
      };
      state.dealChoiceMade = true;
    }
    try { renderSelectedCustomer(); } catch (e1) { /* headless */ }
    try { renderDealPanel(); } catch (e2) { /* headless */ }
  }

  function hydrateCrmIdsAfterSync(syncRes) {
    var dealFromSync = str(syncRes && (syncRes.crm_deal_id || syncRes.CRM_Deal_ID));
    var contactFromSync = str(syncRes && (syncRes.crm_contact_id || syncRes.CRM_Contact_ID));
    var accountFromSync = str(syncRes && (syncRes.crm_account_id || syncRes.CRM_Account_ID));
    if (!state.quoteRecordId) {
      applyConvertedCrmIds({
        contactId: contactFromSync,
        accountId: accountFromSync,
        dealId: dealFromSync,
      });
      return Promise.resolve(syncRes);
    }
    return getRecordById(QUOTE_REPORT, state.quoteRecordId).then(function (rec) {
      applyConvertedCrmIds({
        contactId: str(rec && rec.CRM_Contact_ID) || contactFromSync,
        accountId: str(rec && rec.CRM_Account_ID) || accountFromSync,
        dealId: str(rec && rec.CRM_Deal_ID) || dealFromSync,
      });
      return syncRes;
    }).catch(function () {
      applyConvertedCrmIds({
        contactId: contactFromSync,
        accountId: accountFromSync,
        dealId: dealFromSync,
      });
      return syncRes;
    });
  }

  var dealSearchCache = Object.create(null);
  function dealSearchCacheKey(c) {
    if (!c) return '';
    return 'c:' + str(c.contactId) + '|a:' + str(c.accountId);
  }
  function searchDeals() {
    var c = state.customer;
    if (!c || (!c.contactId && !c.accountId)) return Promise.resolve();
    var cacheKey = dealSearchCacheKey(c);
    var cached = cacheKey ? dealSearchCache[cacheKey] : null;
    if (cached && (Date.now() - cached.at) <= CRM_SEARCH_CACHE_TTL_MS) {
      state.dealCandidates = cached.deals.slice();
      renderDealPanel();
      crmStatus('Deal list (cached)');
      return Promise.resolve();
    }
    crmStatus('Finding existing CRM Deals…');
    var payload = {};
    if (c.contactId) payload.contact_id = c.contactId;
    if (c.accountId) payload.account_id = c.accountId;
    return bridgeCall('search_deals', '', payload).then(function (r) {
      var deals = Array.isArray(r.deals) ? r.deals : [];
      // Rank: open before closed, then most recently modified first.
      deals.sort(function (a, b) {
        if (!!a.is_closed !== !!b.is_closed) return a.is_closed ? 1 : -1;
        return String(b.modified_time || '').localeCompare(String(a.modified_time || ''));
      });
      if (cacheKey) {
        dealSearchCache[cacheKey] = { at: Date.now(), deals: deals.slice() };
      }
      state.dealCandidates = deals;
      renderDealPanel();
      crmStatus('');
    }).catch(bridgeUnavailable);
  }

  function clearQuoteContextForDealSwitch() {
    // Drop in-widget quote identity + lines. Does NOT delete Creator/CRM records.
    // Used when the user switches CRM Deal/Contact so another deal's lines cannot
    // island in the form (2026-07-29 Rova deal / Dana stale-lines incident).
    state.lines = [];
    state.seq = 1;
    state.quoteRecordId = null;
    state.quoteStatus = null;
    state.revision = null;
    state.dismissedPending = {};
    DATA.meta.quoteNo = 'QTS-DRAFT';
    var qEl = $('#quote-no');
    if (qEl) qEl.textContent = DATA.meta.quoteNo;
  }

  function selectDeal(deal) {
    if (!deal || !str(deal.deal_id)) return;
    if (deal.is_closed) { toast('“' + deal.deal_name + '” is ' + deal.stage + ' — closed Deals are never reused; use Create New Opportunity', 'warn'); return; }
    var newId = str(deal.deal_id);
    var prevId = state.deal && state.deal.dealId ? str(state.deal.dealId) : '';
    var switching = !!(prevId && prevId !== newId);

    state.deal = { dealId: newId, dealName: str(deal.deal_name), stage: str(deal.stage) };
    state.dealChoiceMade = true;

    if (switching) {
      clearQuoteContextForDealSwitch();
      toast('Switched CRM Deal — previous quote lines cleared. Loading this Deal’s saved quote if one exists…');
      renderLines();
      renderTotals();
    }

    markDirty();
    maybeLoadQuoteForDeal(newId);
    renderDealPanel();
  }

  // Deal-click quote loading (2026-07-27 / isolation fix 2026-07-29):
  // Selecting a Deal loads its Creator quote when one exists. Never keep
  // another Deal's lines (selectDeal clears on switch). Manual CRM
  // Associated Products are NOT imported — they have no QTS tier prices;
  // blank form until lines are added here and saved (fn_sync_to_crm pushes
  // Creator → CRM). If no Creator quote for this Deal, stay blank.
  function maybeLoadQuoteForDeal(dealId) {
    var sameDeal = state.deal && str(state.deal.dealId) === str(dealId);
    // Already editing this Deal's saved quote — do not reload/clobber.
    if (sameDeal && state.quoteRecordId && state.lines.length) return;
    // Unsaved in-progress lines already attached to this Deal — keep them.
    if (sameDeal && !state.quoteRecordId && state.lines.length) return;
    if (typeof ZOHO === 'undefined') return;
    withTimeout(ZOHO.CREATOR.API.getAllRecords({
      reportName: QUOTE_REPORT, page: 1, pageSize: 2,
      criteria: 'CRM_Deal_ID == "' + String(dealId).replace(/"/g, '') + '"',
    }), 15000, 'Deal quote lookup').then(function (resp) {
      if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { /* shape check below */ } }
      var rows = resp && resp.data;
      if (Array.isArray(rows) && rows.length && str(rows[0].Quote_Number)) {
        toast('This Deal has saved quote ' + str(rows[0].Quote_Number) + ' — loading it');
        loadQuoteByNumber(str(rows[0].Quote_Number));
      } else if (!state.lines.length) {
        toast('No QTS quote on this Deal yet — form is blank. Add lines here (CRM Associated Products are not auto-imported).');
      }
    }).catch(function () { /* lookup is best-effort; manual load still works */ });
  }

  // Round 98 TEMPORARY diagnostics for the live Deal-restore trace. Console
  // only (no UI, no secrets — record IDs are not credentials). Remove after
  // the load-restore QA passes.
  function dbg(msg) {
    try { console.log('[QTS-CRM] ' + msg); } catch (e) { /* console unavailable */ }
  }

  // Round 98: the SDK DETAIL read can return the record with NO field values
  // (same known deviation as applyQuoteIdentity / the subform-stub fallback),
  // so the persisted Deal ID must be picked detail-first with a LIST-row
  // fallback — and if both miss, the get_quote_lines bridge response carries
  // it authoritatively (Deluge reads the record directly).
  function pickPersistedDealId(rec, listRow) {
    return str(rec && rec.CRM_Deal_ID) || str(listRow && listRow.CRM_Deal_ID) || '';
  }

  // Round 97: deterministic Deal restore for loaded quotes. The persisted
  // CRM_Deal_ID is authoritative the moment it's read (provisional chip with
  // the exact ID renders immediately, dealChoiceMade=true so no ambiguity
  // gate and no post-customer-restore deal search); the read-only get_deal
  // bridge action then fills in name/stage. NO name matching anywhere. A
  // bridge failure keeps the exact-ID chip — the association is never lost.
  function applyRestoredDeal(d, fallbackId) {
    var id = str(d && d.deal_id) || str(fallbackId);
    if (!id) return;
    state.deal = {
      dealId: id,
      dealName: str(d && d.deal_name),
      stage: str(d && d.stage),
      isClosed: !!(d && d.is_closed), // display-only; restored closed Deals are shown as the historical association, never re-staged (fn_sync_to_crm never touches terminal stages)
    };
    state.dealChoiceMade = true;
    dbg('applyRestoredDeal: deal=' + id + ' name="' + state.deal.dealName + '" stage="' + state.deal.stage + '"');
    renderDealPanel();
  }

  function restoreDealById(dealId) {
    var id = str(dealId);
    if (!id) { dbg('restoreDealById: blank id — nothing to restore'); return; }
    dbg('restoreDealById: entry id=' + id);
    applyRestoredDeal(null, id); // exact ID is authoritative immediately
    try {
      dbg('restoreDealById: requesting get_deal ' + id);
      return bridgeCall('get_deal', id).then(function (d) {
        dbg('restoreDealById: get_deal ok name="' + str(d && d.deal_name) + '" stage="' + str(d && d.stage) + '"');
        applyRestoredDeal(d, id);
      }).catch(function (err) {
        // Details unavailable (bridge not deployed / transient) — the exact-ID
        // chip stays; save continues to update this same Deal by ID.
        dbg('restoreDealById: get_deal FAILED (' + (err && err.message ? err.message : err) + ') — keeping exact-ID chip');
      });
    } catch (e) {
      // Headless/bridge-less context: provisional exact-ID restore is enough.
      dbg('restoreDealById: bridge unavailable (' + (e && e.message ? e.message : e) + ') — keeping exact-ID chip');
    }
  }

  function createNewOpportunity() {
    var c = state.customer;
    if (!c) { crmStatus('Select a customer before creating an opportunity.', true); return; }
    var dealName = (c.company || c.name || 'New Customer') + ' — Opportunity';
    crmStatus('Creating new CRM opportunity…');
    var payload = { deal_name: dealName };
    if (c.contactId) payload.contact_id = c.contactId;
    if (c.accountId) payload.account_id = c.accountId;
    if (!c.accountId && c.company) payload.account_name = c.company;
    return bridgeCall('create_deal', '', payload).then(function (r) {
      state.deal = { dealId: str(r.deal_id), dealName: str(r.deal_name), stage: str(r.stage) };
      state.dealChoiceMade = true;
      renderDealPanel();
      crmStatus('');
      toast('New opportunity created (' + state.deal.dealId + ') — quote will attach to it on save');
    }).catch(bridgeUnavailable);
  }

  // The Deal panel lives in a JS-created container under #crm-selected so no
  // widget.html change is needed (Round 82 precedent). Null-safe headless.
  function dealPanelEl() {
    var host = $('#crm-selected');
    if (!host || !host.parentNode) return null;
    var panel = $('#crm-deal-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'crm-deal-panel';
      host.parentNode.insertBefore(panel, host.nextSibling);
    }
    return panel;
  }

  function renderDealPanel() {
    var panel = dealPanelEl();
    if (!panel) return; // headless / bridge-less contexts
    panel.innerHTML = '';
    // A restored Deal renders even before the async customer restore lands —
    // the persisted association must never be invisible (Round 97 fix).
    if (!state.customer && !state.deal) return;
    if (state.deal) {
      panel.innerHTML =
        '<div class="crm-chip"><div><b></b><span class="crm-ids"></span></div>' +
        '<button type="button" class="mini-btn subtle" id="deal-clear">Change</button></div>';
      panel.querySelector('b').textContent = 'Deal: ' + (state.deal.dealName || 'CRM ' + state.deal.dealId) +
        (state.deal.stage ? ' · ' + state.deal.stage : '');
      panel.querySelector('.crm-ids').textContent = ' CRM Deal ' + state.deal.dealId;
      panel.querySelector('#deal-clear').addEventListener('click', function () {
        clearDealSelection();
        renderDealPanel();
        searchDeals();
      });
      return;
    }
    if (state.customer && state.customer.leadId) {
      var leadNote = document.createElement('div');
      leadNote.className = 'crm-status';
      leadNote.textContent = 'Lead selected — saving this quote converts it to a Contact + Account and creates the Deal automatically.';
      panel.appendChild(leadNote);
      return;
    }
    var deals = Array.isArray(state.dealCandidates) ? state.dealCandidates : [];
    var head = document.createElement('div');
    head.className = 'crm-status';
    head.textContent = deals.length
      ? 'Existing CRM Deals for this customer — select the sales opportunity this quote belongs to:'
      : (state.dealCandidates === null ? '' : 'No open CRM Deals found for this customer.');
    panel.appendChild(head);
    deals.forEach(function (d) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'result crm-result' + (d.is_closed ? ' closed-deal' : '');
      btn.disabled = !!d.is_closed;
      btn.innerHTML = '<div class="name"></div><div class="type-tag"></div>';
      btn.firstChild.textContent = (d.deal_name || '(unnamed deal)') + ' — ' + (d.stage || 'unknown stage');
      btn.lastChild.textContent = (d.amount !== '' && d.amount != null ? '$' + d.amount + ' · ' : '') +
        (d.account_name ? d.account_name + ' · ' : '') + (d.modified_time ? 'updated ' + String(d.modified_time).slice(0, 10) : '') +
        (d.is_closed ? ' · CLOSED (not selectable)' : '');
      btn.addEventListener('click', function () { selectDeal(d); });
      panel.appendChild(btn);
    });
    if (state.dealCandidates !== null) {
      var createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'mini-btn';
      createBtn.id = 'deal-create-new';
      createBtn.textContent = '+ Create New Opportunity';
      createBtn.addEventListener('click', createNewOpportunity);
      panel.appendChild(createBtn);
    }
  }

  function createCustomer() {
    var last = str($('#nc-last').value);
    if (!last) { crmStatus('Last name is required to create a CRM contact.', true); return; }
    var payload = {
      first_name: str($('#nc-first').value), last_name: last,
      email: str($('#nc-email').value), phone: str($('#nc-phone').value),
      company: str($('#nc-company').value),
      billing_street: str($('#nc-street').value), billing_city: str($('#nc-city').value),
      billing_state: str($('#nc-state').value), billing_code: str($('#nc-code').value),
      billing_country: str($('#nc-country').value),
    };
    crmStatus('Creating customer in CRM…');
    bridgeCall('create_customer', '', payload).then(function (r) {
      if (r.duplicate) {
        crmStatus('A CRM contact with this email already exists — loading it instead (no duplicate created).');
      } else {
        toast('CRM contact created (' + r.contact_id + ')');
      }
      $('#crm-new-form').hidden = true;
      return selectCustomer(String(r.contact_id));
    }).catch(bridgeUnavailable);
  }

  /* Tax feature removed 2026-07-12: Kinetic Bridge does not charge or collect
   * tax on quotes (services untaxed; materials are reseller pass-through) —
   * management/Bryan Ovalle decision, see the 2026-07-10 descope note in
   * docs/CURRENT_HANDOFF.md. Totals are subtotal − discount, no tax line. */

  /* ---------------- Quote save / load (Quote_Request) ---------------- */

  function paymentTermsText() {
    var el = typeof document !== 'undefined' ? $('#f-payment-terms') : null;
    var raw = el ? str(el.value) : '';
    raw = raw.trim();
    return raw || DEFAULT_PAYMENT_TERMS;
  }

  // Back-compat for tests / any caller that still expects days.
  function paymentTermsDays() {
    var m = paymentTermsText().match(/(\d{1,3})/);
    if (!m) return 30;
    var n = parseInt(m[1], 10);
    if (!isFinite(n) || n < 1) return 30;
    if (n > 365) return 365;
    return n;
  }

  function paymentTermsLabel() {
    return paymentTermsText();
  }

  function buildQuotePayload() {
    var c = state.customer;
    // Null-guard the form inputs so the payload builder stays pure enough for
    // the headless harness (no DOM there — same guard style as toast()).
    var contactIn = $('#f-contact');
    var customerIn = $('#f-customer');
    var data = {
      Customer_Name: c ? c.name : str(contactIn ? contactIn.value : ''),
      Customer_Company: c ? (c.company || str(customerIn ? customerIn.value : '')) : str(customerIn ? customerIn.value : ''),
      Customer_Email: c ? c.email : '',
      Status: 'Draft',
      Quote_Lines: state.lines.map(function (l) {
        var row = { Part_Number: l.sku === 'CUSTOM' ? '' : l.sku, Qty: l.qty };
        if (l.custom) row.Description = l.name;
        // Disc/Margin sidecar in Kit_Warning (no Creator line field required yet).
        // PRICE_LOCKED + «DISC:»/«MARGIN:» tell fn_calc not to wipe widget sale math.
        var warn = withPriceMetaMarks(l.kitWarning, !!l.priceLocked, l.discountPct, l.marginPct);
        if (warn) row.Kit_Warning = warn;
        // Always send sale USD when known so Creator + CRM see the same number.
        if (l.unit !== null && l.unit !== undefined && !isNaN(l.unit)) {
          row.Unit_Price = Number(l.unit);
          row.Line_Total_USD = Math.round(Number(l.unit) * (parseFloat(l.qty) || 0) * 100) / 100;
        }
        return row;
      }),
      // Header Margin % → quote-level Markup_Rate_Pct (existing Creator field).
      Markup_Rate_Pct: clampPct(headerMarginPct, 1000),
      // Drives Creator fn_get_discount / Price_Rules (Distributor / Partner / End Customer).
      Customer_Type: getCustomerType(),
    };
    var curEl = $('#f-currency');
    if (curEl && str(curEl.value)) data.Currency = str(curEl.value);
    if (CRM_ID_FIELDS_READY && c) {
      data.CRM_Contact_ID = c.contactId;
      if (c.accountId) data.CRM_Account_ID = c.accountId;
      if (!c.contactId && c.leadId) data.CRM_Lead_ID = c.leadId;
    }
    // Exact CRM Deal record ID — authoritative identity for the sales cycle
    // this quote belongs to (explicit user selection or Create New Opportunity).
    if (CRM_ID_FIELDS_READY && state.deal && state.deal.dealId) {
      data.CRM_Deal_ID = state.deal.dealId;
    }
    // Revision persists server-side only after the Quote_Revision field exists
    // (Tier 3 gate); nextRevision() is what THIS save will be (R1 on first save).
    if (REVISION_FIELD_READY) data.Quote_Revision = nextRevision();
    // Dates from the visible inputs, converted to the app format (dd-MMM-yyyy).
    var dateIn = $('#f-date');
    var validIn = $('#f-valid');
    var quoteDate = isoToCreatorDate(dateIn ? dateIn.value : '');
    var validUntil = isoToCreatorDate(validIn ? validIn.value : '');
    if (quoteDate) data.Quote_Date = quoteDate;
    if (validUntil) data.Valid_Until = validUntil;
    if (PAYMENT_TERMS_FIELD_READY) data.Payment_Terms = paymentTermsText();
    return data;
  }

  // Pull the authoritative stored lines (Creator-calculated USD pricing) for a
  // quote record via the get_quote_lines bridge action and replace widget state.
  // Used after save/update and by the load fallback — the widget never presents
  // its own EUR reference numbers as saved pricing.
  // CRITICAL: never replace a known client price with a blank server Unit_Price
  // (autosave often refreshes before fn_calc_quote_lines finishes writing).
  function refreshLinesFromServer(recordId, silent) {
    var keep = snapshotPricedLines();
    return bridgeCall('get_quote_lines', String(recordId)).then(function (r) {
      // Round 98 last-resort Deal restore: the bridge reads the Quote_Request
      // record in Deluge, so its crm_deal_id is authoritative even when both
      // the SDK detail read AND the list row omitted the field. Never
      // overrides an already-restored/selected Deal.
      if (CRM_ID_FIELDS_READY && !state.deal && str(r.crm_deal_id)) {
        dbg('refreshLinesFromServer: restoring Deal from bridge crm_deal_id=' + str(r.crm_deal_id));
        restoreDealById(str(r.crm_deal_id));
      }
      var bl = Array.isArray(r.lines) ? r.lines : [];
      applyLoadedLines(bl.map(function (row) {
        return { sku: str(row.part_number), name: str(row.description), qty: str(row.qty),
          unit: str(row.unit_price), warning: str(row.kit_warning) };
      }), silent, keep);
    });
  }

  function linePriceKey(sku, warning) {
    return str(sku) + '\0' + str(warning || '');
  }

  function snapshotPricedLines() {
    var keep = {};
    state.lines.forEach(function (l) {
      if (!l || l.unit === null || l.unit === undefined || isNaN(l.unit)) return;
      keep[linePriceKey(l.sku, l.kitWarning)] = {
        unit: l.unit,
        listEur: l.listEur,
        discountPct: l.discountPct,
        marginPct: l.marginPct,
        priceLocked: !!l.priceLocked,
        priceSource: l.priceSource,
        tiers: l.tiers || null,
        scheme: l.scheme || 'hardware',
        flags: (l.flags || []).slice(),
        name: l.name,
        type: l.type,
      };
    });
    return keep;
  }

  // Post-save completion: refresh the stored Creator-priced lines SILENTLY,
  // then emit the save/update toast LAST — the toast surface is single-slot,
  // so a non-silent refresh's "Loaded …" toast would overwrite the save
  // confirmation (the Round 28/78 visual-QA defect).
  function finishSave(isUpdate, qno, refresh) {
    return refresh().then(function () {
      toast((isUpdate ? 'Draft updated — ' : 'Draft saved — ') + qno + ' (pricing/sync run on the Creator side)');
    });
  }

  // Revision model (D4, approved 2026-07-13): the base Quote_Number never
  // changes on a revision; every Draft save/update of the SAME quote record
  // increments R1 → R2 → R3. nextRevision() = the revision the in-flight save
  // will become; state.revision is committed only after the save succeeds.
  function nextRevision() {
    return (state.revision || 0) + 1;
  }
  function revisionLabel() {
    if (!state.revision) return '';
    return '-R' + state.revision;
  }

  /* ---------------- Auto-save (2026-07-27) ----------------
   * Sales never presses Save. Any state mutation calls markDirty(); silent
   * saveDraft runs immediately (delay 0). Status stays 'Draft' so the
   * document/email Flow never fires from autosave.
   */
  var AUTOSAVE_DELAY_MS = 0;
  var AUTOSAVE_BUSY_RETRY_MS = 200;
  var autosaveTimer = null;
  var autosaveBusy = false;
  var PACKAGE_STATUS = 'Package Requested'; // Writer PDF + email client
  var PDF_FILE_STATUS = 'PDF Filed';         // Writer PDF + CRM attach only (no client email)
  // Statuses where a silent Draft save would clobber the lifecycle flag and
  // (for Package Requested / PDF Filed) re-trigger the document Flow.
  function isPostDraftStatus(status) {
    return status === PACKAGE_STATUS || status === PDF_FILE_STATUS ||
      status === 'Send for Signature' || status === 'Signed';
  }
  function autosaveStatus(msg) {
    if (typeof document === 'undefined') return;
    var el = $('#autosave-status');
    if (el) el.textContent = msg;
  }
  function cancelAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  function markDirty() {
    if (state.loadingQuote) return;
    if (isPostDraftStatus(state.quoteStatus)) return;
    cancelAutosave();
    autosaveStatus('Unsaved changes…');
    autosaveTimer = setTimeout(autoSave, AUTOSAVE_DELAY_MS);
  }
  function autoSave() {
    autosaveTimer = null;
    if (autosaveBusy) { autosaveTimer = setTimeout(autoSave, AUTOSAVE_BUSY_RETRY_MS); return; }
    if (isPostDraftStatus(state.quoteStatus)) return;
    if (!state.lines.length && !state.customer) return;
    var run = saveDraft({ silent: true });
    if (!run) return;
    autosaveBusy = true;
    run.then(function () { autosaveBusy = false; }, function () { autosaveBusy = false; });
  }

  function saveDraft(opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    if (!state.lines.length && !state.customer) { if (!silent) toast('Nothing to save yet — add lines or select a customer', 'warn'); return null; }
    // Never write Status: Draft over Package Requested / Send for Signature —
    // that both loses the lifecycle flag and can double-fire the email Flow.
    if (isPostDraftStatus(state.quoteStatus)) {
      if (silent) { autosaveStatus('Auto-save paused — quote is ' + state.quoteStatus); }
      else { toast('Quote is "' + state.quoteStatus + '" — start a new draft to edit', 'warn'); }
      return null;
    }
    var gate = dealSaveGate();
    if (!gate.ok) {
      if (silent) { autosaveStatus('Auto-save paused — ' + gate.reason); } else { toast(gate.reason, 'warn'); }
      return null;
    }
    var payload = buildQuotePayload();
    var isUpdate = !!state.quoteRecordId;
    // Loaded/saved quote -> update the SAME Quote_Request record (same quote
    // number). Only a blank/new quote creates a record. A separate "save as new"
    // action would be an explicit future affordance, never an accident.
    var op;
    if (isUpdate) {
      if (!silent) toast('Updating ' + (DATA.meta.quoteNo || 'draft') + ' in Creator…');
      op = updateRecord(QUOTE_REPORT, state.quoteRecordId, payload);
    } else {
      if (!silent) toast('Saving draft to Creator…');
      op = addRecord(QUOTE_FORM, payload);
    }
    return op.then(function (id) {
      state.quoteRecordId = String(id);
      state.quoteStatus = 'Draft'; // payload always saves Status: 'Draft'
      // Silent update of an existing draft: skip getRecordById (saves an API
      // round-trip). CRM sync is explicit via Save/Email Quote Package publish.
      if (silent && isUpdate && DATA.meta.quoteNo) {
        autosaveStatus('Saved ' + DATA.meta.quoteNo + revisionLabel() + ' · ' + new Date().toLocaleTimeString());
        return;
      }
      return getRecordById(QUOTE_REPORT, id);
    }).then(function (rec) {
      if (!rec) return;
      var qno = str(rec.Quote_Number) || 'DRAFT';
      DATA.meta.quoteNo = qno;
      // Revision advances only on deliberate acts (Generate / manual save),
      // never on debounced autosaves — R-numbers mean "versions a human
      // chose to cut", not keystroke checkpoints (Blake, 2026-07-27).
      if (opts.bumpRevision || !silent) {
        state.revision = nextRevision();
      }
      var qEl = $('#quote-no');
      if (qEl) qEl.textContent = qno + revisionLabel();
      if (silent) {
        autosaveStatus('Saved ' + qno + revisionLabel() + ' · ' + new Date().toLocaleTimeString());
        return;
      }
      return finishSave(isUpdate, qno, function () {
        return refreshLinesFromServer(state.quoteRecordId, true);
      });
    }).catch(function (err) {
      var msg = err && err.message ? err.message : err;
      if (silent) { autosaveStatus('Auto-save failed — ' + msg); } else { toast('Save failed: ' + msg, 'warn'); }
      throw err;
    });
  }

  // Push current lines to the selected CRM Deal (Associated Products + Amount)
  // without Package Requested / email. Safe for Draft and post-Draft quotes.
  function syncCrmDeal() {
    if (!state.deal || !str(state.deal.dealId)) {
      toast('Select a CRM Deal first — nothing to sync', 'warn');
      return null;
    }
    if (!state.lines.length) {
      toast('Add quote lines before updating the CRM Deal', 'warn');
      return null;
    }
    cancelAutosave();
    toast('Updating CRM Deal (no email)…');
    var prep;
    if (!state.quoteRecordId) {
      prep = saveDraft({ silent: true });
      if (!prep) { toast('Cannot save draft — resolve Deal / customer first', 'warn'); return null; }
    } else if (isPostDraftStatus(state.quoteStatus)) {
      // Do NOT write Status: Draft (would clobber Package Requested). Lines only.
      var lineOnly = {
        Quote_Lines: state.lines.map(function (l) {
          var row = { Part_Number: l.sku === 'CUSTOM' ? '' : l.sku, Qty: l.qty };
          if (l.custom) row.Description = l.name;
          var warn = withPriceMetaMarks(l.kitWarning, !!l.priceLocked, l.discountPct, l.marginPct);
          if (warn) row.Kit_Warning = warn;
          if (l.unit !== null && l.unit !== undefined && !isNaN(l.unit)) {
            row.Unit_Price = Number(l.unit);
            row.Line_Total_USD = Math.round(Number(l.unit) * (parseFloat(l.qty) || 0) * 100) / 100;
          }
          return row;
        }),
      };
      if (CRM_ID_FIELDS_READY) lineOnly.CRM_Deal_ID = str(state.deal.dealId);
      prep = updateRecord(QUOTE_REPORT, state.quoteRecordId, lineOnly);
    } else {
      prep = saveDraft({ silent: true }) || Promise.resolve(state.quoteRecordId);
    }
    return Promise.resolve(prep).then(function () {
      if (!state.quoteRecordId) throw new Error('Quote was not saved');
      return bridgeCall('sync_quote_to_crm', String(state.quoteRecordId));
    }).then(function (r) {
      toast('CRM Deal updated — Associated Products synced (no email sent)');
      autosaveStatus('CRM Deal updated · ' + new Date().toLocaleTimeString());
      return r;
    }).catch(function (err) {
      toast('CRM update failed: ' + (err && err.message ? err.message : err), 'warn');
    });
  }

  // Round 75: authoritative quote identity (record ID + Status) from a load.
  // The v1 SDK DETAIL read is known to deviate from the REST shape (it returns
  // subform stubs without field values), so Status/ID may be absent there while
  // present on the LIST row from the widened Quote_Request_Report. Prefer the
  // detail value, fall back to the list row; str() guards against the literal
  // "undefined"/"null" strings String() would mint from missing fields. Blank
  // everywhere stays null so Discard can never enable blind.
  function applyQuoteIdentity(rec, listRow) {
    state.quoteRecordId = (str(rec && rec.ID) || str(listRow && listRow.ID)) || null;
    state.quoteStatus = (str(rec && rec.Status) || str(listRow && listRow.Status)) || null;
    return { recordId: state.quoteRecordId, status: state.quoteStatus };
  }

  // Header "Status" and the discard gate read the SAME authoritative state.
  function quoteStatusLabel() {
    if (!state.quoteRecordId) return 'Draft (unsaved)';
    return state.quoteStatus || 'Unknown';
  }

  /* ---------------- Quote loading (CRM-first, 2026-07-28) ----------------
   * The CRM Quote is the durable record (Blake, 2026-07-27): LOAD QUOTE asks
   * the bridge's get_quote_by_number first, follows the "QTS Quote_Request
   * ID: <id>" back-reference the executor stamps into the Quote Description
   * to reach the full-fidelity Creator record, and only when CRM has no
   * quote at all (draft saved but never generated) or the bridge is down
   * falls back to the legacy Creator report search. A deleted Quote_Request
   * therefore no longer orphans a quote: the form is repopulated from the
   * CRM record alone, and the next save creates a fresh Creator draft.
   */
  function creatorQuoteRequestIdFromDescription(desc) {
    var m = /QTS Quote_Request ID:\s*(\d+)/.exec(str(desc));
    return m ? m[1] : '';
  }

  function loadQuoteByNumber(qno) {
    if (!qno) { toast('Enter a quote number to load', 'warn'); return; }
    toast('Loading ' + qno + '…');
    state.loadingQuote = true;
    return bridgeCall('get_quote_by_number', qno).then(function (crmQuote) {
      var reqId = creatorQuoteRequestIdFromDescription(crmQuote.description);
      if (reqId) {
        return getRecordById(QUOTE_REPORT, reqId).then(function (rec) {
          return applyCreatorQuoteRecord(rec, null, qno);
        }, function (err) {
          dbg('load: Creator record ' + reqId + ' unreadable (' +
            (err && err.message ? err.message : err) + ') — recovering from CRM');
          return applyCrmQuote(crmQuote, qno);
        });
      }
      return applyCrmQuote(crmQuote, qno);
    }, function (err) {
      dbg('load: CRM lookup failed (' + (err && err.message ? err.message : err) +
        ') — falling back to Creator report search');
      return loadQuoteFromCreatorSearch(qno);
    }).then(function (r) {
      state.loadingQuote = false;
      if (r && r.recovered) {
        autosaveStatus('Recovered ' + (DATA.meta.quoteNo || qno) + ' from CRM — next save creates a new draft');
      } else {
        autosaveStatus('Loaded ' + (DATA.meta.quoteNo || qno) + ' — auto-save on');
      }
      return r;
    }, function (err) {
      state.loadingQuote = false;
      toast('Load failed: ' + (err && err.message ? err.message : err), 'warn');
    });
  }

  // Legacy path: Creator report search by Quote_Number. Still the only way to
  // load a draft the document Flow never ran on (no CRM Quote exists yet).
  function loadQuoteFromCreatorSearch(qno) {
    var listRow = null;
    return withTimeout(ZOHO.CREATOR.API.getAllRecords({
      reportName: QUOTE_REPORT, page: 1, pageSize: 5,
      criteria: 'Quote_Number == "' + qno.replace(/"/g, '') + '"',
    }), 15000, 'Quote lookup').then(function (resp) {
      if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { /* shape check below */ } }
      var rows = resp && resp.data;
      if (!Array.isArray(rows) || !rows.length) throw new Error('No Quote_Request found with Quote_Number "' + qno + '"');
      listRow = rows[0];
      return getRecordById(QUOTE_REPORT, String(rows[0].ID)); // detail read includes subform rows
    }).then(function (rec) {
      return applyCreatorQuoteRecord(rec, listRow, qno);
    });
  }

  // CRM-only population: the Creator record is gone, so identity stays null
  // (unsaved) — editing then saving cuts a NEW Quote_Request draft rather
  // than resurrecting a deleted one. No values are invented: CRM carries no
  // part numbers, quote date, currency or revision, so those keep defaults.
  function applyCrmQuote(crmQuote, qno) {
    state.quoteRecordId = null;
    state.quoteStatus = null;
    DATA.meta.quoteNo = str(crmQuote.quote_number) || qno;
    var qnoEl = $('#quote-no'); if (qnoEl) qnoEl.textContent = DATA.meta.quoteNo;
    var validEl = $('#f-valid'); if (validEl && str(crmQuote.valid_till)) validEl.value = str(crmQuote.valid_till);
    var contactEl = $('#f-contact'); if (contactEl && str(crmQuote.contact_name)) contactEl.value = str(crmQuote.contact_name);
    // Deal before customer, same reason as the Creator path: dealChoiceMade
    // suppresses the post-select deal search so the exact Deal ID survives.
    if (CRM_ID_FIELDS_READY && str(crmQuote.deal_id)) {
      restoreDealById(str(crmQuote.deal_id));
    }
    if (CRM_ID_FIELDS_READY && str(crmQuote.contact_id)) {
      selectCustomer(str(crmQuote.contact_id), { keepQuote: true });
    }
    var rows = Array.isArray(crmQuote.line_items) ? crmQuote.line_items : [];
    applyLoadedLines(rows.map(function (row) {
      return { sku: '', name: str(row.product_name), qty: str(row.quantity),
        unit: str(row.list_price), warning: '' };
    }));
    return { recovered: true };
  }

  function applyCreatorQuoteRecord(rec, listRow, qno) {
      applyQuoteIdentity(rec, listRow);
      DATA.meta.quoteNo = str(rec.Quote_Number) || qno;
      $('#quote-no').textContent = DATA.meta.quoteNo;
      $('#f-contact').value = str(rec.Customer_Name);
      $('#f-customer').value = str(rec.Customer_Company);
      var cur = $('#f-currency');
      if (str(rec.Currency)) cur.value = str(rec.Currency);
      // Restore saved dates exactly when present; records without saved dates
      // keep the new-quote defaults (today / +30) rather than being blanked.
      var savedQuoteDate = creatorDateToIso(rec.Quote_Date);
      var savedValidUntil = creatorDateToIso(rec.Valid_Until);
      if (savedQuoteDate) $('#f-date').value = savedQuoteDate;
      if (savedValidUntil) $('#f-valid').value = savedValidUntil;
      if (PAYMENT_TERMS_FIELD_READY) {
        var payEl = $('#f-payment-terms');
        var savedTerms = str(rec.Payment_Terms).trim();
        if (!savedTerms && str(rec.Payment_Terms_Days)) {
          var legacyDays = parseInt(str(rec.Payment_Terms_Days), 10);
          if (isFinite(legacyDays) && legacyDays >= 1) savedTerms = 'Net ' + legacyDays;
        }
        if (payEl) payEl.value = savedTerms || DEFAULT_PAYMENT_TERMS;
      }
      // Restore header Margin % from quote Markup_Rate_Pct when present.
      if (rec.Markup_Rate_Pct !== undefined && rec.Markup_Rate_Pct !== null && str(rec.Markup_Rate_Pct) !== '') {
        headerMarginPct = clampPct(rec.Markup_Rate_Pct, 1000);
        var hdrEl = $('#hdr-margin');
        if (hdrEl) hdrEl.value = String(headerMarginPct);
      }
      if (str(rec.Customer_Type)) setCustomerType(rec.Customer_Type);
      // Restore the persisted Deal linkage BEFORE selectCustomer so the
      // post-select deal search is skipped (dealChoiceMade) and the loaded
      // quote keeps its exact CRM Deal record ID. restoreDealById renders the
      // chip immediately and fetches name/stage via get_deal (Round 97).
      // Round 98: detail-read fields can be ENTIRELY absent (known SDK
      // deviation) — fall back to the list row here, and to the
      // get_quote_lines bridge response below (refreshLinesFromServer).
      dbg('load: CRM_Deal_ID detail="' + str(rec.CRM_Deal_ID) + '" list="' + str(listRow && listRow.CRM_Deal_ID) + '"');
      var savedDealId = pickPersistedDealId(rec, listRow);
      if (CRM_ID_FIELDS_READY && savedDealId) {
        restoreDealById(savedDealId);
      }
      // Restore the persisted revision when the field exists; otherwise the
      // client counter restarts (display-only until the Tier 3 field lands).
      if (REVISION_FIELD_READY && str(rec.Quote_Revision)) {
        state.revision = parseInt(str(rec.Quote_Revision), 10) || null;
        $('#quote-no').textContent = DATA.meta.quoteNo + revisionLabel();
      }
      var savedContactId = str(rec.CRM_Contact_ID) || str(listRow && listRow.CRM_Contact_ID);
      if (CRM_ID_FIELDS_READY && savedContactId) {
        selectCustomer(savedContactId, { keepQuote: true }); // restores CRM linkage; do not wipe loaded lines
      } else {
        var savedLeadId = str(rec.CRM_Lead_ID) || str(listRow && listRow.CRM_Lead_ID);
        if (CRM_ID_FIELDS_READY && savedLeadId) {
          selectLead(savedLeadId);
        }
      }
      var rows = Array.isArray(rec.Quote_Lines) ? rec.Quote_Lines : [];
      var first = rows[0];
      // The SDK's report-detail read returns subform rows WITHOUT field values
      // (ID/display_value stubs). If real fields are present use them; otherwise
      // fetch the authoritative rows via the bridge (Deluge reads the subform).
      var hasFields = first && typeof first === 'object' &&
        (first.Part_Number !== undefined || first.Qty !== undefined);
      if (!rows.length || hasFields) {
        applyLoadedLines(rows.map(function (row) {
          return { sku: str(row.Part_Number), name: str(row.Description), qty: str(row.Qty),
            unit: str(row.Unit_Price), warning: str(row.Kit_Warning) };
        }));
        return;
      }
      return refreshLinesFromServer(rec.ID);
  }

  // Normalized loaded rows -> widget lines. qty/unit stay as stored.
  // keepPrev: optional snapshot from snapshotPricedLines() — if server unit is
  // blank, keep the previous on-screen price instead of forcing UNPRICED.
  function applyLoadedLines(normRows, silent, keepPrev) {
    keepPrev = keepPrev || {};
    state.lines = []; state.seq = 1;
    normRows.forEach(function (row) {
      var sku = row.sku;
      var unit = parseFloat(String(row.unit).replace(/[$,]/g, ''));
      var item = itemBySku(sku);
      var prev = keepPrev[linePriceKey(sku, row.warning)];
      var kept = false;
      if (isNaN(unit) && prev && prev.unit !== null && prev.unit !== undefined && !isNaN(prev.unit)) {
        unit = prev.unit;
        kept = true;
      }
      var locked = warnIsPriceLocked(row.warning) || (kept && prev && prev.priceLocked);
      var listEur = item && item.listEur != null ? item.listEur : (kept && prev ? prev.listEur : null);
      var discFromWarn = parseDiscPctFromWarn(row.warning);
      var marginFromWarn = parseMarginPctFromWarn(row.warning);
      var hadPersistedDisc = discFromWarn != null
        || (kept && prev && prev.discountPct != null);
      var discPct = discFromWarn != null ? discFromWarn
        : (kept && prev && prev.discountPct != null ? prev.discountPct : 0);
      var margPct = marginFromWarn != null ? marginFromWarn
        : (kept && prev && prev.marginPct != null ? prev.marginPct
          : (headerMarginPct || 0));
      var line = {
        id: 'L' + state.seq++, sku: sku || 'CUSTOM',
        name: row.name || (item ? item.name : '') || (prev && prev.name) || '',
        type: (item || {}).type || (prev && prev.type) || 'Product',
        qty: parseFloat(String(row.qty).replace(/,/g, '')) || 0,
        listEur: listEur,
        discountPct: discPct,
        marginPct: margPct,
        unit: isNaN(unit) ? null : unit,
        flags: (isNaN(unit) ? ['unpriced'] : (kept && prev.flags ? prev.flags.filter(function (f) { return f !== 'unpriced'; }) : [])),
        custom: sku === '',
        kitWarning: stripPriceMetaMarks(row.warning),
        priceSource: locked ? 'manual' : (kept ? (prev.priceSource || 'stored') : 'stored'),
        priceLocked: !!locked,
        discountable: item ? !!item.discountable : false,
        // Persisted Disc % (sidecar / prior UI) counts as a manual keep.
        discountManual: !!hadPersistedDisc || !!(kept && prev && prev.discountManual),
      };
      if (kept) {
        if (prev.tiers) line.tiers = prev.tiers;
        if (prev.scheme) line.scheme = prev.scheme;
      } else if (item) {
        line.tiers = item.tiers || null;
        line.scheme = item.scheme || 'hardware';
      }
      if (!hadPersistedDisc && !line.custom) {
        applyCatalogDiscountToLine(line, true);
        line.discountManual = false;
      }
      if (!line.priceLocked && line.priceSource === 'eur_ref') repriceEurRefLine(line);
      state.lines.push(line);
    });
    if (typeof document !== 'undefined' && $('#chips')) render(); // null-safe headless (test context)
    if (!silent) toast('Loaded ' + DATA.meta.quoteNo + ' (' + state.lines.length + ' lines)');
  }

  /* ---------------- Discard draft (saved Draft records only) ---------------- */

  // Discard is offered ONLY for a saved Quote_Request currently loaded in the
  // widget whose last-known Status is exactly "Draft". New/unsaved quotes have
  // no record to delete; any other status (Send for Signature, Signed, …) must
  // never be deletable from here.
  function canDiscardDraft() {
    return !!state.quoteRecordId && state.quoteStatus === 'Draft';
  }

  // Pure state reset — returns the widget state to the same shape as a fresh
  // blank quote (record ID, quote number, customer/CRM IDs, lines, totals
  // inputs, kit state). DOM refresh is the caller's job (resetQuoteUi).
  function resetQuoteState() {
    state.lines = [];
    state.seq = 1;
    state.customer = null;
    state.deal = null;
    state.dealCandidates = null;
    state.dealChoiceMade = false;
    state.revision = null;
    state.quoteRecordId = null;
    state.quoteStatus = null;
    state.discount = 0;
    headerMarginPct = 0;
    var hdrM = typeof document !== 'undefined' ? $('#hdr-margin') : null;
    if (hdrM) hdrM.value = '0';
    setCustomerType('Distributor');
    state.kitQty = 1;
    state.kitCells = '';
    state.kitId = DATA.bmsKits.length ? DATA.bmsKits[0].id : null;
    state.dismissedPending = {};
    state.discardConfirmOpen = false;
    state.sendConfirmOpen = false;
    DATA.meta.quoteNo = 'QTS-DRAFT';
  }

  // SDK delete wrapper. Bundled v1 SDK signature (verified in widgetsdk-min.js):
  // deleteRecord({reportName, criteria}) -> DELETE_RECORDS. The criteria carries
  // a SERVER-SIDE Status guard so even a stale client can never delete a
  // non-Draft record: only `ID == <id> && Status == "Draft"` can match.
  function deleteQuoteRecord(recordId) {
    var api = ZOHO.CREATOR.API;
    if (typeof api.deleteRecord !== 'function') {
      return Promise.reject(new Error('Creator SDK exposes no deleteRecord API — discard is unavailable in this SDK build'));
    }
    var idDigits = String(recordId).replace(/\D/g, '');
    if (!idDigits) return Promise.reject(new Error('Invalid Creator record ID for delete: ' + recordId));
    var sdkPromise;
    try {
      sdkPromise = api.deleteRecord({
        reportName: QUOTE_REPORT,
        criteria: 'ID == ' + idDigits + ' && Status == "Draft"',
      });
    } catch (syncErr) {
      return Promise.reject(new Error('deleteRecord threw synchronously: ' +
        (syncErr && syncErr.message ? syncErr.message : String(syncErr))));
    }
    return withTimeout(sdkPromise, 20000, 'Quote delete').then(function (resp) {
      if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { /* shape check below */ } }
      var code = resp && (resp.code || (Array.isArray(resp.result) && resp.result[0] && resp.result[0].code));
      if (code === 3100 || code === '3100') {
        throw new Error('Nothing was deleted — the record no longer matches Status "Draft" (it may have changed or been removed on the server).');
      }
      if (code !== undefined && code !== 3000) {
        throw new Error('Quote delete returned code ' + code);
      }
      return String(recordId);
    }, function (err) { throw normalizeError('Quote delete failed', err); });
  }

  // Round 76: authoritative live-status re-read for the discard guard. The v1
  // SDK DETAIL read (getRecordById) does NOT expose Status on this report
  // (proven live in Round 75 QA: load-path list row said "Draft", the pre-delete
  // re-read came back blank and correctly blocked). The LIST read on the same
  // widened report DOES return Status live — so the re-read is a fresh
  // getAllRecords constrained to the exact record ID. Returns
  // {recordId, status, source}; status null when unreadable (guard blocks).
  function getQuoteStatusById(recordId) {
    var idDigits = String(recordId).replace(/\D/g, '');
    if (!idDigits) return Promise.reject(new Error('Invalid Creator record ID for status re-read: ' + recordId));
    return withTimeout(ZOHO.CREATOR.API.getAllRecords({
      reportName: QUOTE_REPORT, page: 1, pageSize: 2,
      criteria: 'ID == ' + idDigits,
    }), 15000, 'Quote status re-read').then(function (resp) {
      if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { /* shape check below */ } }
      var rows = resp && resp.data;
      if (!Array.isArray(rows) || !rows.length) {
        throw new Error('Status re-read found no Quote_Request with ID ' + idDigits +
          ' — the record may already be deleted. Nothing was deleted by this widget.');
      }
      return { recordId: idDigits, status: str(rows[0].Status) || null, source: 'report-list ID criteria' };
    }, function (err) { throw normalizeError('Quote status re-read failed', err); });
  }

  // Core discard flow, DOM-free so the headless test harness can drive it with
  // injected deps: {getStatus(recordId), deleteRecord(id)}. Sequence:
  //   1. eligibility gate (saved record + last-known Status Draft)
  //   2. authoritative server re-read (getQuoteStatusById — live LIST read,
  //      never the in-memory state.quoteStatus) — must return exactly "Draft"
  //   3. delete (deleteQuoteRecord adds its own criteria-level Draft guard)
  //   4. full state reset ONLY after a confirmed successful delete
  // Any failure leaves the loaded state fully intact.
  function discardDraftCore(deps) {
    if (!canDiscardDraft()) {
      return Promise.reject(new Error('Discard is only available for a saved quote in Draft status.'));
    }
    var recordId = state.quoteRecordId;
    return deps.getStatus(recordId).then(function (res) {
      var liveStatus = str(res && res.status);
      if (liveStatus !== 'Draft') {
        if (liveStatus !== '') state.quoteStatus = liveStatus; // sync stale UI state
        throw new Error('Discard blocked: the saved record’s current status is "' +
          (liveStatus || 'unknown — Status not readable from Quote_Request_Report') +
          '", not "Draft". Nothing was deleted.');
      }
      return deps.deleteRecord(recordId);
    }).then(function () {
      resetQuoteState();
      return recordId;
    });
  }

  // DOM-side reset of everything resetQuoteState cannot reach: header quote
  // number, customer/CRM UI, dates back to new-quote defaults, totals inputs,
  // kit inputs, then a full re-render.
  function resetQuoteUi() {
    $('#quote-no').textContent = DATA.meta.quoteNo;
    $('#f-contact').value = '';
    $('#f-customer').value = '';
    var proj = $('#f-project'); if (proj) proj.value = '';
    $('#crm-results').innerHTML = '';
    $('#crm-selected').innerHTML = '';
    crmStatus('');
    var loadIn = $('#load-quote-no'); if (loadIn) loadIn.value = '';
    var dateIn = $('#f-date'); var validIn = $('#f-valid');
    if (dateIn) { dateIn.value = ''; }
    if (validIn) { validIn.value = ''; }
    var payEl = $('#f-payment-terms');
    if (payEl) payEl.value = '';
    seedDefaultDates();
    var disc = $('#discount'); if (disc) disc.value = 0;
    var kq = $('#kit-qty'); if (kq) kq.value = 1;
    var kc = $('#kit-cells'); if (kc) kc.value = '';
    $('#kit-notices').innerHTML = '';
    render();
  }

  /* In-widget confirmation. window.confirm() is SILENTLY suppressed (returns
   * false, no dialog) inside the sandboxed Creator widget iframe (no
   * allow-modals), which made the Round 70 button a no-op in live QA — so the
   * confirmation is a widget-rendered panel, never a browser-native dialog.
   * Open/closed state lives in state.discardConfirmOpen so the flow is
   * testable headlessly; updateDiscardConfirmUi() is null-safe without a DOM.
   */

  function updateDiscardConfirmUi() {
    var panel = typeof document !== 'undefined' ? $('#discard-confirm') : null;
    if (!panel) return;
    panel.hidden = !state.discardConfirmOpen;
    var txt = $('#discard-confirm-text');
    if (txt && state.discardConfirmOpen) {
      txt.textContent = 'Saved draft ' + (DATA.meta.quoteNo || '(unnumbered)') +
        ' and its quote lines will be permanently deleted from Zoho Creator. ' +
        'This cannot be undone. The widget will reset to a new blank quote.';
    }
  }

  // First press on "Discard draft": open the confirmation panel (no side
  // effects, nothing verified or deleted yet). Returns whether it opened.
  function requestDiscard() {
    if (!canDiscardDraft()) {
      toast('Discard is only available for a saved quote in Draft status', 'warn');
      return false;
    }
    state.discardConfirmOpen = true;
    updateDiscardConfirmUi();
    return true;
  }

  /* Round 73: DELEGATED click handling for the discard controls.
   * Round 72 live QA proved the current bundle was loaded (via the
   * then-temporary visible build markers) and bindStatic() completed,
   * yet a click on #btn-discard never entered requestDiscard(). No widget
   * code replaces that DOM node, so the direct node binding is being
   * defeated somewhere outside our code (Creator runtime DOM handling /
   * event interception inside the iframe). Document-level CAPTURE
   * delegation is immune to node replacement and to bubble-phase
   * stopPropagation, so the three discard controls are routed here and
   * their direct node bindings are removed (no double-fire).
   */

  // Ancestor walkers (no Element.closest dependency; ES5-safe like the rest
  // of this file).
  function closestById(node, id) {
    while (node) { if (node.id === id) return node; node = node.parentNode; }
    return null;
  }

  /* Round 74: Round 73 live QA proved even document-level CAPTURE `click`
   * never fires for these controls inside the Creator iframe (no captured
   * toast, no probe toast, current bundle proven loaded). The activation
   * path therefore moves EARLIER in the event sequence: document-capture
   * `pointerdown` (primary), `mousedown` (fallback for non-pointer-event
   * environments), and `click` (last resort / synthetic events). A
   * per-gesture flag suppresses duplicate activation when several of these
   * fire for one physical press: the first matching event in a gesture
   * activates, later ones are swallowed; `pointerdown` (or a non-matching
   * `click`) starts/ends a gesture and clears the flag.
   */
  var discardGestureHandled = false;

  // Returns which discard control (if any) the event target sits inside.
  function matchDiscardControl(t) {
    if (closestById(t, 'btn-discard')) return 'discard';
    if (closestById(t, 'discard-cancel')) return 'cancel';
    if (closestById(t, 'discard-confirm-btn')) return 'confirm';
    return null;
  }

  function handleDiscardEvent(e) {
    var t = e && e.target;
    var type = (e && e.type) || 'click';
    if (type === 'pointerdown') discardGestureHandled = false; // new gesture
    if (!t) return;
    var control = matchDiscardControl(t);
    if (!control) {
      if (type === 'click') discardGestureHandled = false; // gesture over
      return;
    }
    if (discardGestureHandled) {
      if (type === 'click') discardGestureHandled = false; // gesture over
      return; // duplicate event of an already-activated gesture
    }
    discardGestureHandled = true;
    if (type === 'click') discardGestureHandled = false; // click is terminal
    if (control === 'discard') {
      requestDiscard();
    } else if (control === 'cancel') {
      cancelDiscard();
    } else {
      confirmDiscard().catch(function () { /* surfaced via toast */ });
    }
  }

  // Cancel: close the panel, change nothing.
  function cancelDiscard() {
    state.discardConfirmOpen = false;
    updateDiscardConfirmUi();
  }

  // Confirm: close the panel and run the existing guarded flow (authoritative
  // live-status re-read + criteria-guarded delete). deps injectable for the
  // headless tests; production always passes the real SDK wrappers.
  function confirmDiscard(deps) {
    state.discardConfirmOpen = false;
    updateDiscardConfirmUi();
    var qno = DATA.meta.quoteNo || 'this draft';
    toast('Verifying ' + qno + ' is still a draft…');
    return discardDraftCore(deps || {
      getStatus: getQuoteStatusById,
      deleteRecord: deleteQuoteRecord,
    }).then(function (recordId) {
      if (typeof document !== 'undefined' && $('#quote-no')) resetQuoteUi();
      toast('Draft discarded — ' + qno + ' was permanently deleted. Starting a new blank quote.');
      return recordId;
    }, function (err) {
      if (typeof document !== 'undefined' && $('#chips')) {
        render(); // discard button may need to hide if status turned out non-Draft
      }
      toast('Discard failed: ' + (err && err.message ? err.message : err), 'warn');
      throw err;
    });
  }

  function updateDiscardBtn() {
    if (typeof document === 'undefined') return;
    // Header Status renders from the SAME state the discard gate reads —
    // never a hardcoded label (Round 75: the old static "Draft" masked a
    // null state.quoteStatus in live QA).
    var st = $('#quote-status');
    if (st) st.textContent = quoteStatusLabel();
    var btn = $('#btn-discard');
    if (!btn) return;
    var on = canDiscardDraft();
    btn.hidden = !on;
    btn.disabled = !on;
    if (!on) state.discardConfirmOpen = false; // never leave a stale confirm panel up
    updateDiscardConfirmUi();
  }

  /* ---------------- Picker ---------------- */
  function filteredItems() {
    var q = state.query.trim().toLowerCase();
    return DATA.items.filter(function (it) {
      if (state.filter !== 'all' && it.category !== state.filter) return false;
      if (!q) return true;
      return (it.sku + ' ' + it.name).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderChips() {
    var wrap = $('#chips');
    wrap.innerHTML = '';
    DATA.categories.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = c.label;
      b.setAttribute('aria-pressed', state.filter === c.key ? 'true' : 'false');
      b.addEventListener('click', function () { state.filter = c.key; render(); });
      wrap.appendChild(b);
    });
    var custom = document.createElement('button');
    custom.className = 'chip ghost';
    custom.type = 'button';
    custom.textContent = '+ Custom line';
    custom.addEventListener('click', addCustomLine);
    wrap.appendChild(custom);
  }

  function renderResults() {
    var box = $('#results');
    var items = filteredItems();
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML =
        '<div class="state">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="7" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
          '<div class="state-title">No matching items</div>' +
          '<div>Adjust your search or filter, or add a custom line.</div>' +
        '</div>';
      return;
    }
    items.forEach(function (it) {
      var pending = it.flags.indexOf('pending_business') !== -1;
      var btn = document.createElement('button');
      btn.className = 'result';
      btn.type = 'button';
      btn.disabled = pending;
      btn.title = pending ? 'Pending business — confirm before adding' : 'Add to quote';

      var sku = document.createElement('div'); sku.className = 'sku num'; sku.textContent = it.sku;
      var mid = document.createElement('div');
      mid.innerHTML = '<div class="name">' + esc(it.name) + '</div><div class="type-tag">' + esc(it.type) + '</div>';
      var badges = document.createElement('div'); badges.className = 'badge-stack';
      it.flags.forEach(function (f) { badges.appendChild(badgeEl(f)); });
      var price = document.createElement('div');
      var m = money(it.unit);
      price.className = 'price num' + (m ? '' : ' none');
      price.textContent = m || '—';

      btn.appendChild(sku); btn.appendChild(mid); btn.appendChild(badges); btn.appendChild(price);
      if (!pending) btn.addEventListener('click', function () { addOrIncrementLine(it); });
      box.appendChild(btn);
    });
  }

  function badgeEl(flag) {
    var b = document.createElement('span');
    b.className = 'badge ' + flag;
    b.innerHTML = '<span class="bdot"></span>' + (FLAG_LABEL[flag] || flag);
    return b;
  }

  /* ---------------- BMS kit helper ---------------- */
  function renderKits() {
    var sel = $('#kit-select');
    sel.innerHTML = '';
    DATA.bmsKits.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k.id; o.textContent = k.name;
      if (k.id === state.kitId) o.selected = true;
      sel.appendChild(o);
    });
    var kit = DATA.bmsKits.filter(function (k) { return k.id === state.kitId; })[0];
    var prev = $('#kit-preview');
    if (kit) {
      var rows = kit.contents.map(function (c) {
        var it = itemBySku(c.sku);
        var name = (it ? it.name : (c.name || c.sku));
        var qtyLabel = kitQtyLabel(c);
        var extra = '';
        if (c.blocked) extra = ' — <b>blocked</b>' + (c.holdReason ? ' (' + esc(c.holdReason) + ')' : '');
        else if (c.holdReason) extra = ' — <b>held</b> (' + esc(c.holdReason) + ')';
        else if (c.confidence === 'pending_business') extra = ' — <b>pending business</b>';
        return '<li>' + esc(qtyLabel) + ' · ' + esc(c.sku) + ' — ' + esc(name) + extra + '</li>';
      }).join('');
      prev.innerHTML = 'Kit contains <b>' + kit.contents.length + ' components</b> (' + kit.note + '):<ul>' + rows + '</ul>';
    } else {
      prev.innerHTML = '';
    }
  }

  // Quantity label per Qty_Rule. Dynamic rules are resolved by the Creator
  // backend (fn_get_kit_components / Expand_Kit), never calculated here.
  function kitQtyLabel(c) {
    switch (c.qtyRule) {
      case 'fixed':
        return (c.qty === null ? '?' : (c.qty * state.kitQty)) + '×';
      case 'cmu_from_series_cells':
        return 'Calculated from series cell count';
      case 'match_cmu_qty':
        return 'Matches calculated CMU quantity';
      case 'match_mcu_qty':
        return 'Matches calculated MCU quantity';
      case 'manual':
        return 'Manual quantity';
      default:
        return 'Quantity rule: ' + (c.qtyRule || 'unknown');
    }
  }

  // Merge backend-expanded kit rows into quote state. Re-adding the same kit
  // must NOT duplicate rows: an incoming row merges (qty +=) into an existing
  // line when the stable line identity matches — non-custom line, same SKU,
  // same Kit_Warning text. Custom/manual lines are never merge targets, and
  // rows with different warnings stay separate (preserves Q1/Q2 hold + warning
  // variants as distinct lines). Otherwise the row is appended as before.
  function applyKitRows(rows, kitQty) {
    var added = 0, merged = 0, catalogMiss = 0;
    rows.forEach(function (row) {
      // Bridge emits snake_case; fn_get_kit_components uses Part_Number — accept both.
      var sku = normalizeSku(kitRowField(row, 'part_number', 'Part_Number'));
      if (sku === '') return; // never add a blank-SKU row
      var qtyRaw = kitRowField(row, 'qty', 'Qty');
      var qty = (parseFloat(qtyRaw) || 0) * kitQty;
      if (qty < 0) return;
      var warn = fieldText(kitRowField(row, 'kit_warning', 'Kit_Warning'));
      var it = itemBySku(sku);
      var kitComp = !it ? kitComponentBySku(sku) : null;
      if (!it) catalogMiss++;
      var target = null;
      for (var i = 0; i < state.lines.length; i++) {
        var l = state.lines[i];
        if (!l.custom && normalizeSku(l.sku) === sku && str(l.kitWarning || '') === warn) { target = l; break; }
      }
      if (target) {
        target.qty = (parseFloat(target.qty) || 0) + qty;
        preloadLineDiscountFromItemMaster(target, it);
        repriceEurRefLine(target); // merged qty may cross a tier band
        merged++;
        return;
      }
      var listEur = it ? (it.listEur != null ? it.listEur : it.unit) : null;
      var line = {
        id: 'L' + state.seq++, sku: sku,
        name: it ? it.name : (kitComp && kitComp.name ? kitComp.name : sku),
        type: it ? it.type : 'Product',
        qty: qty, listEur: listEur, discountPct: 0, marginPct: headerMarginPct || 0, unit: null,
        flags: it ? it.flags.slice() : ['unpriced'], custom: false,
        tiers: it ? (it.tiers || null) : null, scheme: it ? (it.scheme || 'hardware') : 'hardware',
        category: it ? (it.category || '') : '',
        kitWarning: warn, priceSource: 'eur_ref', priceLocked: false,
        discountable: it ? !!it.discountable : false,
        discountManual: false,
      };
      // Disc % + sale only when Item_Master has the SKU (Discountable + Price_T*).
      preloadLineDiscountFromItemMaster(line, it);
      repriceEurRefLine(line); // kit quantities routinely land past the first band
      state.lines.push(line);
      added++;
    });
    return { added: added, merged: merged, catalogMiss: catalogMiss };
  }

  // Backend-authoritative kit expansion. Quantities, rules, holds and blocks are
  // resolved by the deployed fn_get_kit_components via the CRM_Bridge expand_kit
  // action — the SAME resolver the QA-passed Expand_Kit record button uses.
  // Nothing is calculated client-side except the Kit-qty multiplicity (identical
  // to the previous fixed-row behavior). On any backend failure NO rows are
  // added — no partial/guessed expansion, ever.
  function addKit() {
    var kit = DATA.bmsKits.filter(function (k) { return k.id === state.kitId; })[0];
    if (!kit) return;
    var noticesBox = $('#kit-notices');
    noticesBox.innerHTML = '';
    var cellsText = String(state.kitCells || '').trim();
    toast('Expanding ' + kit.name + ' via Creator…');
    bridgeCall('expand_kit', '', {
      kit_key: kit.id,
      series_cell_count: cellsText, // blank is fine for fixed-only kits; backend validates
    }).then(function (r) {
      var lines = Array.isArray(r.lines) ? r.lines : [];
      var notices = Array.isArray(r.notices) ? r.notices : [];
      if (!lines.length && !notices.length) {
        throw new Error('expand_kit returned no lines and no notices for ' + kit.id);
      }
      var counts = applyKitRows(lines, state.kitQty);
      var added = counts.added, merged = counts.merged, catalogMiss = counts.catalogMiss || 0;
      render();
      if (notices.length) {
        noticesBox.innerHTML = '<b>Kit notices:</b><ul>' + notices.map(function (n) {
          return '<li>' + esc(n) + '</li>';
        }).join('') + '</ul>';
      }
      var parts = [];
      if (added) parts.push('added ' + added + ' line' + (added === 1 ? '' : 's'));
      if (merged) parts.push('increased quantity on ' + merged + ' existing line' + (merged === 1 ? '' : 's'));
      var msg = (parts.length ? parts.join(', ') : 'no lines changed') + ' from ' + kit.name +
        (state.kitQty > 1 ? ' × ' + state.kitQty : '');
      msg = msg.charAt(0).toUpperCase() + msg.slice(1);
      if (catalogMiss) {
        toast(msg + ' — ' + catalogMiss + ' SKU(s) not in Item_Master (no List/Disc %). Import Item_Master or check Item_Master_Report.', 'warn');
      } else if (notices.length) {
        toast(msg + ' · ' + notices.length + ' notice' + (notices.length === 1 ? '' : 's') +
          ' to review below the kit helper', 'warn');
      } else {
        toast(msg + ' — edit them like any other line');
      }
    }).catch(function (err) {
      var text = err && err.message ? err.message : String(err);
      if (text.indexOf('Unknown Action') !== -1) {
        text = 'Kit expansion needs the updated CRM_Bridge workflow (expand_kit action) — re-paste the bridge script in Creator dev.';
      }
      toast('Kit not added — ' + text, 'warn');
    });
  }

  /* ---------------- Custom line ---------------- */
  function addCustomLine() {
    state.lines.push({
      id: 'L' + state.seq++, sku: 'CUSTOM', name: '', type: 'Custom',
      qty: 1, listEur: null, discountPct: 0, marginPct: 0, unit: 0, flags: [], custom: true,
      priceSource: 'manual', priceLocked: true, discountable: true,
    });
    render();
    // focus the new description field
    var inputs = document.querySelectorAll('.line-name-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  /* ---------------- Lines table ---------------- */
  function lineTotal(l) {
    if (l.unit === null || l.unit === undefined || isNaN(l.unit)) return null;
    return l.qty * l.unit;
  }

  function renderLines() {
    var body = $('#lines-body');
    if (!body) return; // headless / pre-DOM
    body.innerHTML = '';
    var countEl = $('#lines-count');
    if (countEl) countEl.textContent = state.lines.length;

    if (!state.lines.length) {
      var empty = document.createElement('tr'); empty.className = 'lines-empty';
      var td = document.createElement('td'); td.colSpan = 10;
      td.innerHTML =
        '<div class="state">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 10h18M8 15h5" stroke="currentColor" stroke-width="1.5"/></svg>' +
          '<div class="state-title">No line items yet</div>' +
          '<div>Search a SKU above, add a custom line, or use the BMS kit helper.</div>' +
        '</div>';
      empty.appendChild(td); body.appendChild(empty);
      addCustomFooter(body);
      return;
    }

    state.lines.forEach(function (l, idx) {
      var tr = document.createElement('tr');
      var warnFlags = l.flags.filter(function (f) { return f !== 'pending_business'; });
      if (warnFlags.length) {
        tr.className = 'has-warn';
        tr.style.setProperty('--stripe', FLAG_STRIPE[warnFlags[0]]);
      }

      var tdIdx = document.createElement('td'); tdIdx.className = 'line-idx num'; tdIdx.textContent = idx + 1;
      var tdSku = document.createElement('td'); tdSku.className = 'line-sku'; tdSku.textContent = l.sku;
      var tdName = document.createElement('td');
      var nameIn = document.createElement('textarea');
      nameIn.className = 'line-name-input';
      nameIn.rows = 2;
      nameIn.value = l.name;
      nameIn.placeholder = l.custom ? 'Describe this custom line…' : '';
      nameIn.readOnly = !l.custom;
      nameIn.setAttribute('aria-label', 'Line description');
      if (l.custom) nameIn.addEventListener('input', function () { l.name = nameIn.value; markDirty(); });
      tdName.appendChild(nameIn);
      if (warnFlags.length) {
        var stack = document.createElement('div'); stack.className = 'badge-stack'; stack.style.marginTop = '5px';
        warnFlags.forEach(function (f) { stack.appendChild(badgeEl(f)); });
        tdName.appendChild(stack);
      }
      if (l.priceLocked) {
        var lockTag = document.createElement('div');
        lockTag.className = 'type-pill'; lockTag.textContent = 'Manual price';
        lockTag.title = 'Sale price locked — auto FX/tier will not overwrite until you clear the lock by resetting disc % or re-adding the SKU';
        tdName.appendChild(lockTag);
      }
      var tdType = document.createElement('td');
      tdType.innerHTML = '<span class="type-pill">' + l.type + '</span>';

      var tdQty = document.createElement('td'); tdQty.className = 'c';
      var qtyIn = document.createElement('input');
      qtyIn.className = 'line-cell-input qty-input num'; qtyIn.type = 'number'; qtyIn.min = '0'; qtyIn.step = '1';
      qtyIn.value = l.qty;
      tdQty.appendChild(qtyIn);

      // List EUR (read-only catalog reference)
      var tdList = document.createElement('td'); tdList.className = 'r num';
      if (l.listEur === null || l.listEur === undefined || isNaN(l.listEur)) {
        tdList.classList.add('none'); tdList.textContent = '—';
      } else {
        tdList.textContent = moneyEur(l.listEur);
        var eurTag = document.createElement('div');
        eurTag.className = 'type-pill'; eurTag.textContent = refPillLabel();
        eurTag.title = 'Item_Master EUR list (tier for current qty)';
        tdList.appendChild(eurTag);
      }

      // Disc % (editable)
      var tdDisc = document.createElement('td'); tdDisc.className = 'r';
      var discIn = document.createElement('input');
      discIn.className = 'line-cell-input disc-input num'; discIn.type = 'number';
      discIn.min = '0'; discIn.max = '100'; discIn.step = '0.1';
      discIn.value = l.discountPct != null ? l.discountPct : 0;
      discIn.title = l.discountable === false
        ? 'Item_Master: no X (not discountable) — catalog Disc % stays 0; override only for incentives'
        : 'Auto-filled from Distrib discount (page 2) for ' + getCustomerType() + '; edit to override';
      discIn.addEventListener('input', function () {
        markDirty();
        l.discountManual = true;
        l.discountPct = clampPct(discIn.value, 100);
        if (!l.priceLocked) {
          l.priceSource = 'eur_ref';
          refreshLineSale(l);
          saleIn.value = (l.unit === null ? '' : l.unit);
        }
        var ltNow = lineTotal(l);
        tdTotal.textContent = ltNow === null ? '—' : money(ltNow);
        tdTotal.classList.toggle('none', ltNow === null);
        updateTotalsOnly();
      });
      tdDisc.appendChild(discIn);

      // Margin % (editable markup; independent of Disc %)
      var tdMargin = document.createElement('td'); tdMargin.className = 'r';
      var marginIn = document.createElement('input');
      marginIn.className = 'line-cell-input margin-input num'; marginIn.type = 'number';
      marginIn.min = '0'; marginIn.max = '1000'; marginIn.step = '0.1';
      marginIn.value = l.marginPct != null ? l.marginPct : 0;
      marginIn.title = 'Company profit markup % — Sale = List×FX×(1−Disc%)×(1+Margin%)';
      marginIn.addEventListener('input', function () {
        markDirty();
        l.marginPct = clampPct(marginIn.value, 1000);
        if (!l.priceLocked) {
          l.priceSource = 'eur_ref';
          refreshLineSale(l);
          saleIn.value = (l.unit === null ? '' : l.unit);
        }
        var ltNow = lineTotal(l);
        tdTotal.textContent = ltNow === null ? '—' : money(ltNow);
        tdTotal.classList.toggle('none', ltNow === null);
        updateTotalsOnly();
      });
      tdMargin.appendChild(marginIn);

      // Sale USD (always editable)
      var tdSale = document.createElement('td'); tdSale.className = 'r';
      var saleIn = document.createElement('input');
      saleIn.className = 'line-cell-input unit-input num'; saleIn.type = 'number';
      saleIn.min = '0'; saleIn.step = '0.01';
      saleIn.value = (l.unit === null ? '' : l.unit);
      saleIn.placeholder = DATA_FX.usdPerEur ? 'USD sale' : 'set USD (no FX)';
      saleIn.addEventListener('input', function () {
        markDirty();
        l.unit = saleIn.value === '' ? null : Math.max(0, parseFloat(saleIn.value) || 0);
        l.priceLocked = true;
        l.priceSource = 'manual';
        if (l.unit !== null) l.flags = l.flags.filter(function (f) { return f !== 'unpriced'; });
        var ltNow = lineTotal(l);
        tdTotal.textContent = ltNow === null ? '—' : money(ltNow);
        tdTotal.classList.toggle('none', ltNow === null);
        updateTotalsOnly();
      });
      tdSale.appendChild(saleIn);

      qtyIn.addEventListener('input', function () {
        markDirty();
        l.qty = Math.max(0, parseInt(qtyIn.value, 10) || 0);
        if (applyCatalogDiscountToLine(l)) discIn.value = l.discountPct != null ? l.discountPct : 0;
        if (!l.priceLocked) repriceEurRefLine(l);
        saleIn.value = (l.unit === null ? '' : l.unit);
        var ltNow = lineTotal(l);
        tdTotal.textContent = ltNow === null ? '—' : money(ltNow);
        tdTotal.classList.toggle('none', ltNow === null);
        if (l.listEur != null && !isNaN(l.listEur)) {
          tdList.textContent = moneyEur(l.listEur);
          var tag = document.createElement('div');
          tag.className = 'type-pill'; tag.textContent = refPillLabel();
          tdList.appendChild(tag);
        }
        updateTotalsOnly();
      });

      var tdTotal = document.createElement('td'); tdTotal.className = 'r num line-total';
      var lt = lineTotal(l);
      if (lt === null) { tdTotal.classList.add('none'); tdTotal.textContent = '—'; }
      else tdTotal.textContent = money(lt);

      var tdRm = document.createElement('td'); tdRm.className = 'c';
      var rm = document.createElement('button');
      rm.className = 'row-remove'; rm.type = 'button'; rm.setAttribute('aria-label', 'Remove line'); rm.innerHTML = '&times;';
      rm.addEventListener('click', function () {
        markDirty();
        state.lines = state.lines.filter(function (x) { return x.id !== l.id; });
        render();
      });
      tdRm.appendChild(rm);

      [tdIdx, tdSku, tdName, tdType, tdQty, tdList, tdDisc, tdMargin, tdSale, tdTotal, tdRm].forEach(function (cell) { tr.appendChild(cell); });
      body.appendChild(tr);
    });

    addCustomFooter(body);
  }

  function addCustomFooter(body) {
    var addTr = document.createElement('tr'); addTr.className = 'add-custom-row';
    var addTd = document.createElement('td'); addTd.colSpan = 11;
    var addBtn = document.createElement('button');
    addBtn.className = 'add-custom-btn'; addBtn.type = 'button';
    addBtn.textContent = '+ Add custom / manual line';
    addBtn.addEventListener('click', addCustomLine);
    addTd.appendChild(addBtn); addTr.appendChild(addTd); body.appendChild(addTr);
  }

  /* ---------------- Pending business ---------------- */
  function activePending() {
    return DATA.pendingReferenced.filter(function (sku) { return !state.dismissedPending[sku]; });
  }
  function renderPending() {
    var card = $('#pending-card');
    var list = $('#pending-list');
    var pend = activePending();
    if (!pend.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    $('#pending-count').textContent = pend.length;
    list.innerHTML = '';
    pend.forEach(function (sku) {
      var it = itemBySku(sku);
      var row = document.createElement('div'); row.className = 'pending-item';
      row.innerHTML =
        '<div>' +
          '<div class="sku num">' + esc(sku) + '</div>' +
          '<div class="name">' + esc(it ? it.name : sku) + '</div>' +
          '<div class="why">Confirm pricing & availability before adding to a quote.</div>' +
        '</div>';
      var actions = document.createElement('div'); actions.className = 'row-actions';
      var review = document.createElement('button'); review.className = 'mini-btn'; review.type = 'button'; review.textContent = 'Review';
      review.addEventListener('click', function () { toast('Flagged ' + sku + ' for business review (local only — no Zoho write)'); });
      var dismiss = document.createElement('button'); dismiss.className = 'mini-btn subtle'; dismiss.type = 'button'; dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', function () { state.dismissedPending[sku] = true; render(); });
      actions.appendChild(review); actions.appendChild(dismiss);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  /* ---------------- Totals & warnings ---------------- */
  function computeTotals() {
    var subtotal = 0, unpricedCount = 0;
    state.lines.forEach(function (l) {
      var lt = lineTotal(l);
      if (lt === null) unpricedCount++;
      else subtotal += lt;
    });
    var discount = Math.max(0, state.discount || 0);
    return { subtotal: subtotal, discount: discount, total: Math.max(0, subtotal - discount), unpricedCount: unpricedCount };
  }

  function warningTally() {
    var t = { discontinued: 0, not_released: 0, unpriced: 0, pending_business: activePending().length };
    state.lines.forEach(function (l) {
      l.flags.forEach(function (f) { if (t[f] !== undefined && f !== 'pending_business') t[f]++; });
    });
    var total = t.discontinued + t.not_released + t.unpriced + t.pending_business;
    return { t: t, total: total };
  }

  function renderTotals() {
    var subEl = $('#t-subtotal');
    var totEl = $('#t-total');
    if (!subEl || !totEl) return; // headless / pre-DOM
    var tot = computeTotals();
    subEl.textContent = money(tot.subtotal);
    totEl.textContent = money(tot.total);

    // Price-basis note removed (cluttered Quote total). FX still applied to Sale (USD).


    var w = warningTally();
    var box = $('#warn-summary');
    if (w.total === 0) {
      box.className = 'warn-summary clean';
      box.innerHTML = '<div class="warn-line" style="color:var(--ok)"><span class="badge ok"><span class="bdot"></span>All clear</span> No blocking warnings on this quote.</div>';
      return;
    }
    box.className = 'warn-summary';
    var rows = '';
    [['not_released', 'Not released'], ['discontinued', 'Discontinued'], ['unpriced', 'Unpriced'], ['pending_business', 'Pending business']]
      .forEach(function (pair) {
        var n = w.t[pair[0]];
        if (n > 0) rows += '<div class="warn-line"><span class="badge ' + pair[0] + '"><span class="bdot"></span>' + pair[1] + '</span><span class="cnt">' + n + '</span></div>';
      });
    box.innerHTML = '<div class="warn-head"><span class="n">⚠</span> ' + w.total + ' warning' + (w.total === 1 ? '' : 's') + ' to review</div>' + rows;
  }

  // lightweight path used by qty typing (avoids full re-render / focus loss)
  function updateTotalsOnly() {
    var tot = computeTotals();
    // update visible line totals in place
    var body = $('#lines-body');
    var rows = body.querySelectorAll('tr');
    var li = 0;
    state.lines.forEach(function (l) {
      var tr = rows[li++]; if (!tr) return;
      var cell = tr.querySelector('.line-total');
      var lt = lineTotal(l);
      if (cell) {
        if (lt === null) { cell.classList.add('none'); cell.textContent = '—'; }
        else { cell.classList.remove('none'); cell.textContent = money(lt); }
      }
    });
    $('#t-subtotal').textContent = money(tot.subtotal);
    $('#t-total').textContent = money(tot.total);
  }

  /* ---------------- Actions ---------------- */
  // Auto-reprice unlocked lines (qty/tier/FX/disc). Manual/locked lines untouched.
  function recalculate() {
    var repriced = 0;
    state.lines.forEach(function (l) { if (repriceEurRefLine(l)) repriced++; });
    if (typeof document !== 'undefined' && $('#chips')) render();
    return repriced;
  }
  // publishQuotePackage({ email: true|false })
  // Shared path for both buttons. Always syncs Deal Associated Products first,
  // then persists Status (PDF Filed | Package Requested) to trigger Flow.
  // email true  → Package Requested → Flow: shared + CONFIRMED + Quotes + sendmail + stage
  // email false → PDF Filed → Flow: shared only (NO Quotes / email / stage APIs)
  var publishInFlight = false;
  function publishQuotePackage(opts) {
    opts = opts || {};
    var emailClient = !!opts.email;
    // Both buttons write Package Requested so the live Flow trigger fires.
    // Save stamps a Deal note (publish_mode=save) that publish_quote_package
    // reads to suppress client email / CRM Quotes / stage. PDF Filed alone
    // often never reaches Flow on the live canvas.
    var targetStatus = PACKAGE_STATUS;
    if (publishInFlight) {
      toast('Publish already in progress — wait for it to finish', 'warn');
      return null;
    }
    var w = warningTally();
    if (w.total > 0) {
      toast(w.total + ' warning' + (w.total === 1 ? '' : 's') + ' unresolved — review before publishing', 'warn');
      return null;
    }
    if (!state.lines.length) { toast('Add quote lines before publishing the quote package', 'warn'); return null; }
    cancelAutosave();
    if (state.quoteStatus === 'Send for Signature' || state.quoteStatus === 'Signed') {
      toast('Quote status is "' + state.quoteStatus + '" — publish is for Draft / filed packages', 'warn');
      return null;
    }
    var gate = dealSaveGate();
    if (!gate.ok) { toast(gate.reason || 'Cannot publish — resolve the Deal selection first', 'warn'); return null; }
    var leadPending = isLeadPendingConversion();
    if (!leadPending && (!state.deal || !str(state.deal.dealId))) {
      toast('Select a CRM Deal first — publish always syncs Associated Products', 'warn');
      return null;
    }
    publishInFlight = true;
    toast(leadPending
      ? (emailClient
        ? 'Converting lead + emailing quote package…'
        : 'Converting lead + saving quote package…')
      : (emailClient
        ? 'Publishing quote package (email client)…'
        : 'Saving quote package (no email)…'));

    try {
      // Step 1 — Deal sync (always). Persist lines first if needed, then bridge sync.
      // Lead path: CRM_Lead_ID is saved on the quote; fn_sync_to_crm converts
      // Lead → Contact + Account + Deal, then Associated Products sync runs.
      var prep;
      if (!state.quoteRecordId) {
        prep = saveDraft({ silent: true });
        if (!prep) { toast('Cannot save draft — resolve Deal / customer first', 'warn'); publishInFlight = false; return null; }
      } else if (isPostDraftStatus(state.quoteStatus)) {
        var lineOnly = {
          Quote_Lines: state.lines.map(function (l) {
            var row = { Part_Number: l.sku === 'CUSTOM' ? '' : l.sku, Qty: l.qty };
            if (l.custom) row.Description = l.name;
            var warn = withPriceMetaMarks(l.kitWarning, !!l.priceLocked, l.discountPct, l.marginPct);
            if (warn) row.Kit_Warning = warn;
            if (l.unit !== null && l.unit !== undefined && !isNaN(l.unit)) {
              row.Unit_Price = Number(l.unit);
              row.Line_Total_USD = Math.round(Number(l.unit) * (parseFloat(l.qty) || 0) * 100) / 100;
            }
            return row;
          }),
        };
        if (CRM_ID_FIELDS_READY && state.deal && state.deal.dealId) {
          lineOnly.CRM_Deal_ID = str(state.deal.dealId);
        }
        prep = updateRecord(QUOTE_REPORT, state.quoteRecordId, lineOnly);
      } else {
        prep = saveDraft({ silent: true }) || Promise.resolve(state.quoteRecordId);
      }

      return Promise.resolve(prep).then(function () {
        if (!state.quoteRecordId) throw new Error('Quote was not saved before Deal sync');
        return bridgeCall('sync_quote_to_crm', String(state.quoteRecordId), {
          publish_mode: emailClient ? 'email' : 'save',
        });
      }).then(function (syncRes) {
        return Promise.resolve(hydrateCrmIdsAfterSync(syncRes)).then(function () {
          return syncRes;
        });
      }).then(function (syncRes) {
        if (!state.deal || !str(state.deal.dealId)) {
          throw new Error(leadPending
            ? 'Lead convert did not produce a CRM Deal — check Creator fn_sync_to_crm logs'
            : 'CRM Deal missing after sync');
        }
        // Save must have stamped QTS_SAVE_ONLY|{qno} or Package Requested would email the client.
        if (!emailClient && str(syncRes && syncRes.save_only_marker) !== 'yes') {
          throw new Error('Save marker missing — need a Quote_Number on this draft before Save Quote Package (load/email once to number it, then Save)');
        }
        // Step 2 — Status write triggers Flow. Both buttons use Package Requested
        // (live trigger). Bounce off PDF Filed when already Package Requested so
        // re-Save / re-Email still create a Status transition.
        if (!state.quoteRecordId) {
          throw new Error('Quote was not saved before Status write');
        }
        var prior = str(state.quoteStatus);
        var arm = Promise.resolve();
        if (prior === PACKAGE_STATUS) {
          arm = updateRecord(QUOTE_REPORT, state.quoteRecordId, { Status: PDF_FILE_STATUS });
        }
        return arm.then(function () {
          return updateRecord(QUOTE_REPORT, state.quoteRecordId, { Status: targetStatus });
        });
      }).then(function (id) {
        if (!state.quoteRecordId) state.quoteRecordId = String(id);
        state.quoteStatus = emailClient ? PACKAGE_STATUS : PDF_FILE_STATUS;
        state.revision = nextRevision();
        if (emailClient) {
          toast('Email Quote Package requested — PDF + CONFIRMED + CRM Quote + client email');
          autosaveStatus('Package emailed · ' + new Date().toLocaleTimeString());
        } else {
          toast('Save Quote Package requested — PDF filed (no email, no CRM Quotes)');
          autosaveStatus('Quote package saved · ' + new Date().toLocaleTimeString());
        }
        return getRecordById(QUOTE_REPORT, state.quoteRecordId);
      }).then(function (rec) {
        if (!rec) return;
        var qno = str(rec.Quote_Number) || DATA.meta.quoteNo || 'DRAFT';
        DATA.meta.quoteNo = qno;
        var qEl = $('#quote-no');
        if (qEl) qEl.textContent = qno + revisionLabel();
        // Keep UI label as PDF Filed for Save; Creator Status stays Package Requested
        // so the live Flow trigger can fire.
        if (!emailClient) {
          state.quoteStatus = PDF_FILE_STATUS;
        }
      }).catch(function (err) {
        toast('Publish failed: ' + (err && err.message ? err.message : err), 'warn');
      }).then(function () {
        publishInFlight = false;
      });
    } catch (e) {
      publishInFlight = false;
      toast('Publish failed: ' + (e && e.message ? e.message : e), 'warn');
      return null;
    }
  }

  // Legacy aliases → single publish path
  function requestQuoteDocument(opts) {
    opts = opts || {};
    return publishQuotePackage({ email: opts.email !== false });
  }
  function generatePackage() {
    return publishQuotePackage({ email: true });
  }
  function filePdfToDeal() {
    return publishQuotePackage({ email: false });
  }
  function saveQuotePackage() {
    return publishQuotePackage({ email: false });
  }
  function emailQuotePackage() {
    return publishQuotePackage({ email: true });
  }

  /* ---------------- Send for Signature (Round 99) ----------------
   * The REAL send path already exists and is live-proven server-side:
   * setting Quote_Request.Status = "Send for Signature" makes the Creator
   * save workflow run fn_calc_quote_lines -> fn_sync_to_crm (stage ->
   * Negotiation/Review on the SAME persisted CRM Deal ID) and fires
   * fn_generate_pdf (Writer merge -> real Zoho Sign request ->
   * Sign_Request_ID writeback; R66 loud-fail guard aborts on unpriced/FX
   * markers). The widget therefore only flips the Status on the EXACT
   * saved Quote_Request record — after an explicit confirmation. One
   * ambiguous click can never send a customer-facing Sign request.
   */
  function canSendForSignature() {
    if (!state.quoteRecordId) return { ok: false, reason: 'Save the draft first — Send for Signature works on the saved Creator record' };
    if (state.quoteStatus !== 'Draft') return { ok: false, reason: 'Quote status is "' + (state.quoteStatus || 'unknown') + '" — only a Draft can be sent for signature' };
    if (!state.lines.length) return { ok: false, reason: 'Add quote lines before sending for signature' };
    // Round 100: fn_generate_pdf hard-aborts when either signer email is blank
    // (R6000 guard) — catch the customer side client-side when it is knowable.
    if (state.customer && !str(state.customer.email)) {
      return { ok: false, reason: 'The CRM customer has no email — both signer emails are required for the Zoho Sign request' };
    }
    var w = warningTally();
    if (w.total > 0) return { ok: false, reason: w.total + ' warning' + (w.total === 1 ? '' : 's') + ' unresolved — resolve before sending' };
    return { ok: true };
  }

  // Round 100: the send update must carry the INTERNAL signer identity —
  // widget-created quotes have BLANK Recipient_Name/Recipient_Email (the save
  // payload never included them and the form has no default), which made
  // fn_generate_pdf's missing-signer-email guard abort the whole Writer/Sign
  // leg on TEST-QUOTE0034. Pure builder so tests can pin the payload shape.
  var DEFAULT_RECIPIENT_NAME = 'Blake Allard';
  var DEFAULT_RECIPIENT_EMAIL = 'blake@bevco-tech.com';
  function buildSendPayload(recipientName, recipientEmail) {
    return {
      Status: 'Send for Signature',
      Recipient_Name: str(recipientName) || DEFAULT_RECIPIENT_NAME,
      Recipient_Email: str(recipientEmail) || DEFAULT_RECIPIENT_EMAIL,
    };
  }

  function sendConfirmEl() {
    var anchor = $('#btn-send-sign');
    if (!anchor || !anchor.parentNode || !anchor.parentNode.parentNode) return null;
    var panel = $('#send-confirm');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'send-confirm';
      panel.className = 'discard-confirm'; // reuse the proven confirm styling
      anchor.parentNode.parentNode.appendChild(panel);
    }
    return panel;
  }

  function renderSendConfirm() {
    var panel = sendConfirmEl();
    if (!panel) return; // headless / pre-boot
    if (!state.sendConfirmOpen) { panel.hidden = true; panel.innerHTML = ''; return; }
    panel.hidden = false;
    panel.innerHTML =
      '<div class="dc-title">Send this quote for signature?</div>' +
      '<div class="dc-body"></div>' +
      '<div class="dc-body"><label>Internal signer name <input type="text" id="send-rn"></label> ' +
      '<label>Internal signer email <input type="text" id="send-re"></label></div>' +
      '<div class="dc-actions">' +
        '<button type="button" class="btn danger" id="send-confirm-yes">Send for signature</button>' +
        '<button type="button" class="btn ghost" id="send-confirm-no">Cancel</button>' +
      '</div>';
    panel.querySelector('.dc-body').textContent =
      (DATA.meta.quoteNo || 'This draft') + ' will be set to "Send for Signature" in Creator dev. ' +
      'Creator merges the Writer PDF and creates a REAL Zoho Sign request — signer 1 below (internal), signer 2 ' +
      (state.customer && state.customer.email ? state.customer.email : 'the Customer_Email on the record') +
      '. The linked CRM Deal advances to Negotiation/Review.';
    panel.querySelector('#send-rn').value = DEFAULT_RECIPIENT_NAME;
    panel.querySelector('#send-re').value = DEFAULT_RECIPIENT_EMAIL;
    panel.querySelector('#send-confirm-yes').addEventListener('click', confirmSendForSignature);
    panel.querySelector('#send-confirm-no').addEventListener('click', cancelSendForSignature);
  }

  function requestSendForSignature() {
    var gate = canSendForSignature();
    if (!gate.ok) { toast(gate.reason, 'warn'); return; }
    state.sendConfirmOpen = true;
    renderSendConfirm();
  }

  function cancelSendForSignature() {
    state.sendConfirmOpen = false;
    renderSendConfirm();
  }

  // Pure success/failure appliers (testable without the SDK).
  // Round 100 PRINCIPLE: "Sent for signature" is claimed ONLY on authoritative
  // downstream proof — a non-blank Sign_Request_ID read back via the bridge.
  // A successful Status update alone proves nothing about the Sign leg
  // (TEST-QUOTE0034: status flipped + CRM advanced while fn_generate_pdf
  // aborted on the blank Recipient_Email and no Sign request ever existed).
  function onSendVerified(signRequestId) {
    state.quoteStatus = 'Send for Signature';
    var st = $('#quote-status');
    if (st) st.textContent = quoteStatusLabel();
    toast('Sent for signature — ' + (DATA.meta.quoteNo || 'quote') + ' (Zoho Sign request ' + signRequestId + ' created; check the signer inboxes)');
  }

  function onSendUnverified() {
    // The status DID change (be truthful about record state) but the Sign leg
    // did not produce a request — this is a FAILURE, reported loudly.
    state.quoteStatus = 'Send for Signature';
    var st = $('#quote-status');
    if (st) st.textContent = quoteStatusLabel();
    toast('SEND NOT COMPLETED: status is "Send for Signature" but NO Zoho Sign request exists (Sign_Request_ID is blank) — no email was sent. Check signer emails and the Creator workflow log, then re-save to retry.', 'warn');
  }

  function onSendFailed(err) {
    // Status stays Draft — never report a send that did not happen.
    toast('Send for Signature FAILED: ' + (err && err.message ? err.message : err) + ' — the quote remains a Draft; nothing was sent', 'warn');
  }

  // Poll the authoritative Deluge read (get_quote_lines header) for the
  // Sign_Request_ID writeback. It is admin-only + not report-exposed, so the
  // bridge is the ONLY place the widget can prove the send.
  function verifySignRequest(attempt) {
    attempt = attempt || 1;
    return bridgeCall('get_quote_lines', String(state.quoteRecordId)).then(function (r) {
      var signId = str(r.sign_request_id);
      if (signId) { onSendVerified(signId); return true; }
      if (attempt >= 4) { onSendUnverified(); return false; }
      return new Promise(function (resolve) { setTimeout(resolve, 2500); }).then(function () {
        return verifySignRequest(attempt + 1);
      });
    });
  }

  function confirmSendForSignature() {
    if (!state.sendConfirmOpen) return; // confirmation is mandatory
    // Read the internal-signer inputs while the panel is still up.
    var rnEl = $('#send-rn');
    var reEl = $('#send-re');
    var payload = buildSendPayload(rnEl ? rnEl.value : '', reEl ? reEl.value : '');
    if (payload.Recipient_Email.indexOf('@') === -1) {
      toast('Internal signer email looks invalid ("' + payload.Recipient_Email + '") — fix it before sending', 'warn');
      return; // panel stays open for correction
    }
    state.sendConfirmOpen = false;
    renderSendConfirm();
    var gate = canSendForSignature(); // re-check: state may have changed while the panel was open
    if (!gate.ok) { toast(gate.reason, 'warn'); return; }
    dbg('send: updating ' + state.quoteRecordId + ' -> Send for Signature, recipient=' + payload.Recipient_Email);
    toast('Setting ' + (DATA.meta.quoteNo || 'draft') + ' to Send for Signature…');
    try {
      return updateRecord(QUOTE_REPORT, state.quoteRecordId, payload)
        .then(function () { return verifySignRequest(); })
        .catch(onSendFailed);
    } catch (e) {
      onSendFailed(e);
    }
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  var lastToastMsg = null; // test-observable record of the most recent toast
  function toast(msg, kind) {
    lastToastMsg = msg;
    var wrap = $('#toasts');
    if (!wrap) return; // headless/test context — no toast surface
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'warn' ? ' warn' : '');
    el.innerHTML = '<span class="tdot"></span><span></span>';
    el.lastChild.textContent = msg;
    wrap.innerHTML = '';
    wrap.appendChild(el);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { wrap.innerHTML = ''; }, 3200);
  }

  /* ---------------- Render ---------------- */
  function render() {
    renderChips();
    renderResults();
    renderKits();
    renderLines();
    renderPending();
    renderTotals();
    updateDiscardBtn();
  }

  /* ---------------- Wire up ---------------- */
  function bindStatic() {
    var search = $('#search');
    search.addEventListener('input', function () { state.query = search.value; renderResults(); });

    // Currency change: save Currency to Creator + reprice unlocked EUR→USD sales.
    $('#f-currency').addEventListener('change', function (e) {
      markDirty();
      DATA.meta.currency = str(e.target.value) || 'USD';
      recalculate();
    });

    var ctypeEl = $('#f-customer-type');
    if (ctypeEl) {
      ctypeEl.addEventListener('change', function (e) {
        markDirty();
        setCustomerType(e.target.value);
        // Customer type change reloads catalog Disc % for every catalog line.
        state.lines.forEach(function (l) {
          if (!l.custom) l.discountManual = false;
        });
        applyCatalogDiscountToAllLines(true);
        render();
      });
    }

    $('#kit-select').addEventListener('change', function (e) { state.kitId = e.target.value; renderKits(); });
    $('#kit-qty').addEventListener('input', function (e) { state.kitQty = Math.max(1, parseInt(e.target.value, 10) || 1); renderKits(); });
    $('#kit-cells').addEventListener('input', function (e) { state.kitCells = e.target.value; });
    $('#kit-add').addEventListener('click', addKit);

    var discEl = $('#discount');
    if (discEl) discEl.addEventListener('input', function (e) { state.discount = parseFloat(e.target.value) || 0; renderTotals(); markDirty(); });

    var hdrMargin = $('#hdr-margin');
    if (hdrMargin) {
      hdrMargin.addEventListener('input', function (e) {
        markDirty();
        applyHeaderMarginToLines(e.target.value);
        render();
      });
    }

    // Save-draft button removed 2026-07-28 (Blake): auto-save owns persistence;
    // saveDraft() stays — autoSave and generatePackage call it directly.
    // Discard controls are DELEGATED (document-level capture) across the
    // whole event sequence — see handleDiscardEvent. Direct node bindings
    // intentionally absent; duplicate activation suppressed per gesture.
    document.addEventListener('pointerdown', handleDiscardEvent, true);
    document.addEventListener('mousedown', handleDiscardEvent, true);
    document.addEventListener('click', handleDiscardEvent, true);

    var doCrmSearch = function () {
      var q = str($('#crm-search').value);
      // Minimum 3 chars reduces API load (server also enforces this)
      if (q.length < 3) { crmStatus('Type at least 3 characters to search CRM.', true); return; }
      var cached = getCachedCrmSearch(q);
      if (cached) {
        crmStatus('CRM results (cached) — ' + (cached.contacts.length + cached.leads.length) + ' match(es)');
        renderCrmResults(cached.contacts.concat(cached.leads));
        return;
      }
      crmStatus('Searching CRM…');
      Promise.all([
        bridgeCall('search_customers', q),
        bridgeCall('search_leads', q).catch(function () { return { lead_matches: [] }; }),
      ]).then(function (results) {
        var contacts = Array.isArray(results[0].matches) ? results[0].matches : [];
        var leads = Array.isArray(results[1].lead_matches) ? results[1].lead_matches : [];
        putCachedCrmSearch(q, contacts, leads);
        renderCrmResults(contacts.concat(leads));
      }).catch(bridgeUnavailable);
    };
    $('#crm-search-btn').addEventListener('click', doCrmSearch);
    $('#crm-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') doCrmSearch(); });
    $('#crm-new-btn').addEventListener('click', function () {
      var f = $('#crm-new-form');
      f.hidden = !f.hidden;
    });
    $('#crm-create-btn').addEventListener('click', createCustomer);
    $('#load-quote-btn').addEventListener('click', function () { loadQuoteByNumber(str($('#load-quote-no').value)); });
    $('#load-quote-no').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadQuoteByNumber(str($('#load-quote-no').value)); });
    var emailPkgBtn = $('#btn-email-package') || $('#btn-generate');
    if (emailPkgBtn) emailPkgBtn.addEventListener('click', emailQuotePackage);
    var savePkgBtn = $('#btn-save-package') || $('#btn-file-pdf');
    if (savePkgBtn) savePkgBtn.addEventListener('click', saveQuotePackage);
    // Standalone Update CRM deal removed — Deal sync runs inside publishQuotePackage.

    $('#theme-toggle').addEventListener('click', toggleTheme);
    restoreAppearance();
    $('#quote-no').textContent = DATA.meta.quoteNo;



    // New-quote defaults: Quote Date = today's LOCAL calendar date (not UTC —
    // avoids the evening off-by-one); Valid Until = Quote Date + 30 calendar
    // days. Both editable. Loading a saved quote overwrites these only with
    // dates actually stored on the record (Quote_Date/Valid_Until).
    var dateIn = $('#f-date');
    var validIn = $('#f-valid');
    seedDefaultDates();
    if (dateIn && validIn) {
      // User edits to Quote Date re-derive Valid Until (+30). Quote loads never
      // programmatically change #f-date, so stored dates are never clobbered.
      dateIn.addEventListener('change', function () {
        if (dateIn.value) validIn.value = plus30(dateIn.value);
        markDirty();
      });
      validIn.addEventListener('change', markDirty);
    }
    var payEl = $('#f-payment-terms');
    if (payEl) {
      payEl.addEventListener('change', markDirty);
      payEl.addEventListener('input', markDirty);
    }
  }

  function persistAppearance() {
    try {
      var root = document.documentElement;
      localStorage.setItem('qts-theme', root.getAttribute('data-theme') || 'dark');
    } catch (e) { /* private mode / iframe storage blocked */ }
  }

  function restoreAppearance() {
    var root = document.documentElement;
    try {
      var theme = localStorage.getItem('qts-theme');
      if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    } catch (e) { /* ignore */ }
    if (!root.getAttribute('data-theme')) root.setAttribute('data-theme', 'dark');
  }

  function toggleTheme() {
    var root = document.documentElement;
    var cur = root.getAttribute('data-theme') || 'dark';
    root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
    persistAppearance();
  }

  // Loading state — shown while ZOHO.CREATOR.API fetches the two reports.
  function renderLoading() {
    renderChips();
    var sk = function (cols) {
      var r = '<div class="skeleton-row">';
      for (var i = 0; i < cols; i++) r += '<div class="skeleton-bar" style="width:' + (55 + (i * 17) % 40) + '%"></div>';
      return r + '</div>';
    };
    $('#results').innerHTML = sk(3) + sk(3) + sk(3);
    $('#lines-body').innerHTML = '<tr><td colspan="11" style="padding:0">' + sk(3) + sk(3) + '</td></tr>';
    $('#pending-card').style.display = 'none';
  }

  // Error state — shown when the SDK is unavailable, init fails, or a report
  // fetch fails/returns malformed data. Offers a retry (re-runs boot()).
  function renderError(msg) {
    var body = $('#lines-body');
    body.innerHTML =
      '<tr><td colspan="11"><div class="state error">' +
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3l9 16H3L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4M12 16.5v.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
        '<div class="state-title">Couldn’t load item data</div>' +
        '<div>' + (msg || 'The Item_Master source is unavailable.') + '</div>' +
        '<button class="btn secondary" id="err-retry" type="button" style="margin-top:10px">Retry</button>' +
      '</div></td></tr>';
    var r = $('#err-retry');
    if (r) r.addEventListener('click', boot);
  }

  var bound = false;

  function boot() {
    if (!bound) { bindStatic(); bound = true; }
    renderLoading();

    if (!window.ZOHO || !ZOHO.CREATOR || typeof ZOHO.CREATOR.init !== 'function') {
      renderError('The Zoho Creator widget SDK did not load. This widget must run inside Zoho Creator (check the SDK script tag and network access to js.zohostatic.com).');
      return;
    }

    ZOHO.CREATOR.init().then(function () {
      return loadLiveData();
    }, function (err) {
      throw normalizeError('Creator SDK initialization failed', err);
    }).then(function () {
      // Live mode opens with an empty quote — no mock seed lines.
      state.lines = []; state.seq = 1; state.dismissedPending = {};
      state.kitId = DATA.bmsKits.length ? DATA.bmsKits[0].id : null;
      render();
    }).catch(function (err) {
      try { console.error('[QTS Quote Builder]', err); } catch (e) { /* console unavailable */ }
      renderError(err && err.message ? err.message : 'Unexpected error while loading Creator data.');
    });
  }

  // Headless test hooks (tests/ node harness). Inert inside Creator: only pure
  // state helpers are exposed; nothing reads them at runtime.
  if (typeof window !== 'undefined') {
    window.__QTS_TEST__ = {
      state: state,
      DATA: DATA,
      DATA_FX: DATA_FX,
      setFxRate: function (eurPerUsd) {
        var rate = parseFloat(eurPerUsd);
        if (!isFinite(rate) || rate <= 0) {
          DATA_FX.eurPerUsd = null;
          DATA_FX.usdPerEur = null;
          return;
        }
        DATA_FX.eurPerUsd = rate;
        DATA_FX.usdPerEur = 1 / rate;
      },
      moneyEur: moneyEur,
      computeSaleUsd: computeSaleUsd,
      applyHeaderMarginToLines: applyHeaderMarginToLines,
      getHeaderMarginPct: function () { return headerMarginPct; },
      setHeaderMarginPct: function (pct) { headerMarginPct = clampPct(pct, 1000); },
      catalogDiscountPct: catalogDiscountPct,
      applyCatalogDiscountToLine: applyCatalogDiscountToLine,
      applyCatalogDiscountToAllLines: applyCatalogDiscountToAllLines,
      preloadLineDiscountFromItemMaster: preloadLineDiscountFromItemMaster,
      fixDiscountablePolarityIfInverted: fixDiscountablePolarityIfInverted,
      ingestPriceRules: ingestPriceRules,
      fieldText: fieldText,
      getCustomerType: getCustomerType,
      setCustomerType: setCustomerType,
      isDiscountableFlag: isDiscountableFlag,
      withPriceMetaMarks: withPriceMetaMarks,
      parseDiscPctFromWarn: parseDiscPctFromWarn,
      parseMarginPctFromWarn: parseMarginPctFromWarn,
      applyKitRows: applyKitRows,
      addLineFromItem: addLineFromItem,
      mapItems: mapItems,
      tierPriceForQty: tierPriceForQty,
      repriceEurRefLine: repriceEurRefLine,
      recalculate: recalculate,
      computeTotals: computeTotals,
      refPillLabel: refPillLabel,
      getCurrentCurrency: getCurrentCurrency,
      canDiscardDraft: canDiscardDraft,
      applyQuoteIdentity: applyQuoteIdentity,
      quoteStatusLabel: quoteStatusLabel,
      applyLoadedLines: applyLoadedLines,
      snapshotPricedLines: snapshotPricedLines,
      AUTOSAVE_DELAY_MS: AUTOSAVE_DELAY_MS,
      finishSave: finishSave,
      getLastToast: function () { return lastToastMsg; },
      resetQuoteState: resetQuoteState,
      buildQuotePayload: buildQuotePayload,
      paymentTermsDays: paymentTermsDays,
      paymentTermsLabel: paymentTermsLabel,
      paymentTermsText: paymentTermsText,
      dealSaveGate: dealSaveGate,
      isLeadPendingConversion: isLeadPendingConversion,
      applyConvertedCrmIds: applyConvertedCrmIds,
      selectDeal: selectDeal,
      clearDealSelection: clearDealSelection,
      clearQuoteContextForDealSwitch: clearQuoteContextForDealSwitch,
      restoreDealById: restoreDealById,
      applyRestoredDeal: applyRestoredDeal,
      pickPersistedDealId: pickPersistedDealId,
      nextRevision: nextRevision,
      revisionLabel: revisionLabel,
      publishQuotePackage: publishQuotePackage,
      saveQuotePackage: saveQuotePackage,
      emailQuotePackage: emailQuotePackage,
      getCachedCrmSearch: getCachedCrmSearch,
      putCachedCrmSearch: putCachedCrmSearch,
      clearCrmSearchCache: clearCrmSearchCache,
      CRM_SEARCH_CACHE_TTL_MS: CRM_SEARCH_CACHE_TTL_MS,
      generatePackage: generatePackage,
      filePdfToDeal: filePdfToDeal,
      requestQuoteDocument: requestQuoteDocument,
      PACKAGE_STATUS: PACKAGE_STATUS,
      PDF_FILE_STATUS: PDF_FILE_STATUS,
      syncCrmDeal: syncCrmDeal,
      saveDraft: saveDraft,
      markDirty: markDirty,
      cancelAutosave: cancelAutosave,
      autoSave: autoSave,
      maybeLoadQuoteForDeal: maybeLoadQuoteForDeal,
      loadQuoteByNumber: loadQuoteByNumber,
      loadQuoteFromCreatorSearch: loadQuoteFromCreatorSearch,
      applyCrmQuote: applyCrmQuote,
      applyCreatorQuoteRecord: applyCreatorQuoteRecord,
      creatorQuoteRequestIdFromDescription: creatorQuoteRequestIdFromDescription,
      canSendForSignature: canSendForSignature,
      requestSendForSignature: requestSendForSignature,
      cancelSendForSignature: cancelSendForSignature,
      confirmSendForSignature: confirmSendForSignature,
      onSendVerified: onSendVerified,
      onSendUnverified: onSendUnverified,
      onSendFailed: onSendFailed,
      buildSendPayload: buildSendPayload,
      discardDraftCore: discardDraftCore,
      requestDiscard: requestDiscard,
      cancelDiscard: cancelDiscard,
      confirmDiscard: confirmDiscard,
      handleDiscardEvent: handleDiscardEvent,
      handleDocumentClick: handleDiscardEvent, // legacy alias (typeless events treated as click)
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
