/* QTS Quote Builder — mock data (design pass only)
 *
 * This file stands in for live Zoho Creator data. When the widget is wired to
 * real data, replace the contents of window.QTS_MOCK with the result of a
 * ZOHO.CREATOR.API.getAllRecords('Item_Master', ...) call in widget.js.
 * The shape below mirrors the fields the render layer expects.
 *
 * Warning flags a line/item can carry:
 *   'discontinued'      — no longer sold
 *   'not_released'      — exists in Item_Master but not yet available
 *   'unpriced'          — active item with no unit price on record
 *   'pending_business'  — Q1/Q2 SKU awaiting business confirmation (never auto-added)
 */
window.QTS_MOCK = {
  meta: {
    quoteNo: 'QTS-DRAFT-0007',
    currency: 'USD',
    source: 'mock', // 'mock' until wired to Item_Master
  },

  // Categories used by the picker filter chips.
  categories: [
    { key: 'all', label: 'All' },
    { key: 'bms', label: 'BMS' },
    { key: 'non_bms', label: 'Non-BMS' },
    { key: 'part', label: 'Parts' },
    { key: 'service', label: 'Service / SW / License' },
  ],

  // Item_Master stand-in. `type` is the human line type; `category` drives the filter.
  items: [
    { sku: 'SKU-1024', name: 'Cell Module 48V (14s)',      category: 'non_bms', type: 'Product', unit: 420.00, flags: [] },
    { sku: 'SKU-1090', name: 'Cell Module 24V (7s)',       category: 'non_bms', type: 'Product', unit: 268.00, flags: [] },
    { sku: 'SKU-2210', name: 'BMS Controller v3',          category: 'bms',     type: 'Product', unit: null,   flags: ['not_released'] },
    { sku: 'SKU-2180', name: 'BMS Controller v2',          category: 'bms',     type: 'Product', unit: 355.00, flags: [] },
    { sku: 'SKU-1330', name: 'BMS Sense Harness',          category: 'part',    type: 'Replacement Part', unit: 65.00, flags: [] },
    { sku: 'SKU-1331', name: 'BMS Temp Sensor',            category: 'part',    type: 'Replacement Part', unit: 22.00, flags: [] },
    { sku: 'SKU-5501', name: 'Enclosure Bracket',          category: 'part',    type: 'Replacement Part', unit: 18.00, flags: [] },
    { sku: 'SKU-7000', name: 'Rapid Cell Pack 96V',        category: 'non_bms', type: 'Product', unit: null,   flags: ['unpriced'] },
    { sku: 'SKU-4400', name: 'Legacy Charger 24V',         category: 'non_bms', type: 'Product', unit: 310.00, flags: ['discontinued'] },
    { sku: 'SKU-9001', name: 'On-site Install Service',    category: 'service', type: 'Service', unit: 150.00, flags: [] },
    { sku: 'SKU-9002', name: 'Commissioning (per day)',    category: 'service', type: 'Service', unit: 900.00, flags: [] },
    { sku: 'SKU-9100', name: 'QTS Software License (annual)', category: 'service', type: 'License', unit: 1200.00, flags: [] },
    // Pending-business SKUs — surfaced in the picker as blocked, never auto-added.
    { sku: 'Q1-SKU-5500', name: 'Prototype Pack (Q1)',     category: 'non_bms', type: 'Product', unit: null, flags: ['pending_business'] },
    { sku: 'Q2-SKU-5600', name: 'Pilot Module (Q2)',       category: 'bms',     type: 'Product', unit: null, flags: ['pending_business'] },
  ],

  // Optional helper only. Each kit expands into individual, editable line items.
  bmsKits: [
    {
      id: 'kit-48v-starter',
      name: '48V Starter BMS Kit',
      note: 'Controller + harness + 2 sensors',
      contents: [
        { sku: 'SKU-2180', qty: 1 },
        { sku: 'SKU-1330', qty: 1 },
        { sku: 'SKU-1331', qty: 2 },
      ],
    },
    {
      id: 'kit-24v-compact',
      name: '24V Compact BMS Kit',
      note: 'Controller + harness',
      contents: [
        { sku: 'SKU-2180', qty: 1 },
        { sku: 'SKU-1330', qty: 1 },
      ],
    },
  ],

  // SKUs referenced by the source meeting/request but awaiting confirmation.
  // These are shown in the "Needs confirmation" panel and are NOT added to the quote.
  pendingReferenced: ['Q1-SKU-5500', 'Q2-SKU-5600'],

  // Seed lines so the builder opens with representative content for review.
  seedLines: [
    { sku: 'SKU-1024', qty: 2 },
    { sku: 'SKU-2210', qty: 1 }, // carries a not_released warning
    { sku: 'SKU-9001', qty: 1 },
    { custom: true, name: 'Custom freight & crating', type: 'Custom', qty: 1, unit: 240.00 },
  ],
};
