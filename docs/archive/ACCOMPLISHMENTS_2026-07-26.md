# QTS session accomplishments — 2026-07-25/26

All items live-verified in Creator dev / CRM unless marked otherwise.

| # | Accomplishment | Integration | Proof / metric |
| --- | --- | --- | --- |
| 1 | Vendor kit config applied to repo BOM | repo | 49 → 42 rows; 3 validators PASS (`kit_bom_check`, `kit_expand_sim`, `kit_seed_prepare`); Q1 + Q2 open questions resolved |
| 2 | Kit config deployed to Creator | Zoho Creator (Kit_Components) | 7 deletes, 12 qty-0 edits, 4 rule swaps, 2 license swaps (200500→200600), 1 harness swap (100985.1→103006); read-back 42/42 matches CSV |
| 3 | Kit expansion live QA | Creator widget | 3 kits verified in-app (i-BMS15, c-BMS24, n3-CMU18@96); n3 total math exact: $5,199.40 |
| 4 | qty-0 kit lines fixed | widget | 1-line guard removed (`applyKitRows`); qty-0 rows now insert at $0; widget tests 189/189 PASS; ZIP 8/8 cmp-verified |
| 5 | Test-data purge | Creator | 29 Quote_Request + 34 Document_Number_Log records deleted; both reports verified empty; QUOTE counter reset 34 → 0 (next = QUOTE0001) |
| 6 | Lead search in QTS | Creator ⇄ CRM bridge | 2 new bridge actions (`search_leads`, `get_lead`); widget merges Contacts + Leads, `[LEAD]` tagged |
| 7 | Lead → quote conversion | Creator → CRM (Leads convert API) | Live PASS on TEST-QUOTE0001: Lead "Dana Whitfield" converted on Save Draft → Contact + Account + Deal created in one call; all 4 CRM IDs written back; Deal amount $5,976.33 = quote total |
| 8 | CRM Products catalog seeded | CRM Products | 44/44 records created from Item_Master (bulk createRecords, IDs …3527006-049); Product_Code = Part_Number join key; discontinued items inactive with warnings |
| 9 | Deal products on every save | Creator → CRM (Deals.Associated_Products subform) | 8/8 quote lines on the Deal incl. qty-0; edit-resync verified live (shunt 0 → 2 mirrored); replace-all semantics |
| 10 | CRM Quote record on every save | Creator → CRM (Quotes + Quoted_Items) | "Kinetic Bridge Quote TEST-QUOTE0001" on the Deal with 8 line items linked to real Products; upsert-by-subject so edits update, never duplicate |
| 11 | Send leg slimmed | Writer / Sign / CRM | `fn_generate_pdf` now attaches the Writer PDF to the Deal on send; CRM Quote creation moved to save-time (duplicate path removed) |
| 12 | Datasheet spec DB kicked off | Supabase (`kinetic-quote`) | Background agent building sourced spec tables from real LiBAL PDFs + scraper/parser scripts + LEARNING.md tutorial (in flight) |
| 13 | Everything committed + pushed | GitHub | 3 commits on `main` (`600c2a8`, `438e69a`, `21e7df9`), pushed to origin |

## Bugs found and killed today

| Bug | Root cause | Fix |
| --- | --- | --- |
| qty-0 kit items never appeared | widget `applyKitRows` dropped qty ≤ 0 | insert at qty 0 (D-K1) |
| Deal products never populated | wrote to `Associated_Products` as a module — Zoho rejects create ("NOT_SUPPORTED"); the failed call also killed the Quote-create code after it | write via Deals subform update (proven by direct API test first) |
| CRM Quote create rejected | 101814 seeded inactive; CRM forbids inactive products on Quotes | 101814 flipped active (release warning kept on the product) |

## Open items

- Send-for-Signature end-to-end (Writer PDF → Sign → Deal attachment) not yet re-tested this session.
- CRM Quote subtotal/discount fields carry List_Price only; QTS stays pricing source of truth.
- Quoted Items on the CRM Quote showed shunt qty 0 in Blake's screenshot while the Deal showed 2 — likely captured pre-resave; confirm the Quote row updated on the latest save.
- Products seed + test-quote deletes used Tier 2/3 paths on Blake's direct instruction — flag to Bill.
- Supabase mirror still holds the pre-update snapshot (kit_components 49); refresh after things settle.
