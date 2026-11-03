# R&S Sons Accounting — PDF feature catalogue vs the app (gap analysis, v2.4.0)

Source: the PDF "Accounting Software Feature Catalogue" (22 sections, 885 feature lines in sections 1–21; section 22 is the phase plan).
Compared against: v2.3.0 (what the app already had) and v2.4.0 (this release).  Date: 3 Nov 2026.

## How "Core" is counted (important)
The PDF does **not** mark individual lines as Core/Advanced. It only gives a phase plan (22.3: Phase 1 accounting core, Phase 2 sales/purchases,
Phase 3 inventory, Phase 4 tax/banking, Phase 5 advanced, Phase 6 extensions). So in this file:
- **Core** = every line in the areas that belong to Phases 1–4 (listed per area below as P1…P4), minus lines that need an outside
  integration (🔌) or are for other countries (➖). Phase 5/6 areas, and 9.6 (marked "optional" in the PDF), are not Core.
- The classification of areas into phases was done by me from the PDF's phase text; it is a judgement call, written down so it can be checked.

## Summary
| | Core lines | All lines |
|---|---|---|
| ✅ had in v2.3 | 357 | 453 |
| 🆕 added in v2.4 | 12 | 14 |
| 🟡 partly (basic version exists, details missing) | 103 | 167 |
| ❌ not done | 103 | 228 |
| 🔌 needs outside integration (not done) | – | 21 |
| ➖ not applicable (other countries) | – | 2 |
| **Total** | **575** | **885** |

**Core coverage: 369 of 575 core lines fully done (64%), another 103 partly done.**
Counting "partly" as half: 73%.

Honest limits:
- No GST/ITR/e-invoice/e-way **filing or portal upload** — the app makes the JSON/Excel files; uploading is done by the user on the portal.
- No bank feeds, payment gateways, WhatsApp Business API, SMS — these need outside accounts/services (🔌).
- Desktop **offline mode** (data on that PC only) is not touched by server-side "log out device / remove user"; those act on online logins.

## What v2.4.0 added
Main asks:
1. **Units** — "+ Create new unit…" inside the item screen's Unit drop-down (and a "+ New unit" link); the new unit is saved in the company,
   so every user of that company sees it at once. Units master: list with "used by N items", edit, delete only when unused (shows which items use it),
   duplicate names refused, GST UQC list, decimals 0–4.
2. **Remove / kick a user** — Users screen and Logged-in Devices screen: "Remove user…" → deactivate (can be re-activated) or delete.
   Every session of that user is ended on the server immediately; open desktop/Android/web apps return to the login screen within seconds and
   show the reason ("deactivated by the admin"). Deactivating or resetting a password from the user form also logs the user out everywhere.
3. **Logged-in Devices** (admin, Utilities menu + Users screen) — per user: device name, Windows/Android/Web app + version, OS, IP, approximate place
   (city/region/country), login time, last active; "Log out this device", "Log out all devices"; login history (logins, failed logins, log-outs).
   **My Devices** for every user (own devices, log out other devices).

From the PDF (Core items):
- Voucher number **gap / repeat** report per series and year (6.7).
- **Duplicate supplier bill** warning on save + "Duplicate Bills Check" report (6.5, 8.5, 14.7).
- **Active / inactive** ledgers and items (4.3, 5.1, 5.2, 5.6) — inactive ones are hidden from new entries; history and reports unchanged.
- Master lists: **sort by any column**, **export the shown list to Excel** (1.3, 15.2).
- Session/device list and login history (3.1, 20.1).

## Detail — module → feature → status


### 1. Product shell, navigation and global search


**1.1 Application shell** — _P1 · Core_

- Home/dashboard — ✅ had (v2.3)
- Main navigation menu — ✅ had (v2.3)
- Contextual action bar — ✅ had (v2.3)
- Breadcrumbs/back navigation — ✅ had (v2.3)
- Recent screens and favourites — ❌ not done → plan v2.5
- Help centre and keyboard shortcut overlay — ✅ had (v2.3)
- About/version/build information — ✅ had (v2.3)
- Connection and service status — ✅ had (v2.3)

**1.2 Navigation** — _P1 · Core_

- Search by feature name — ❌ not done → plan v2.5
- Search reports, masters and transactions — 🟡 partly → plan v2.5
- Open recently used tasks — ❌ not done → plan v2.5
- Pinned tasks — ❌ not done → plan v2.5
- Switch between open screens — 🟡 partly → plan v2.5
- Role-aware menu visibility — ✅ had (v2.3)

**1.3 Lists and grids** — _P1 · Core_

- Sort ascending/descending — 🆕 added in v2.4 — v2.4: click any column heading in every master list (ledgers, items, units, users…) — click again to reverse
- Column show/hide/reorder — ❌ not done → plan v2.5
- Column width — ❌ not done → plan v2.5
- Quick search — ✅ had (v2.3) — search box on every list; Ctrl+K quick search (party, item, invoice no., amount, narration)
- Advanced filters — 🟡 partly → plan v2.5
- Multi-select — ❌ not done → plan v2.5
- Expand/collapse groups — 🟡 partly → plan v2.5
- Pagination/virtual scrolling — ❌ not done → plan v2.5
- Save personal view — ❌ not done → plan v2.5
- Export current list — 🆕 added in v2.4 — v2.4: "⬇ Excel" on every master list exports exactly what is shown (after search + sort); reports already had Excel/PDF

**1.4 Global interaction** — _P1 · Core_

- Keyboard shortcuts — ✅ had (v2.3)
- Mouse/touch support — ✅ had (v2.3)
- Create master from transaction screen — ✅ had (v2.3) — ledger/item "+ Create new" inside vouchers (v2.x); v2.4 adds "+ Create new unit" inside the item screen (so also from a voucher → new item → new unit)
- Context menu — ❌ not done → plan v2.5
- Inline validation — ✅ had (v2.3)
- Unsaved-change warning — ✅ had (v2.3)
- Confirmation for destructive actions — ✅ had (v2.3)
- Accessible labels and keyboard navigation — 🟡 partly → plan v2.5

### 2. Organisation, company, branches and financial periods


**2.1 Organisation setup** — _P1 · Core_

- Legal/display name — ✅ had (v2.3)
- Address and contact details — ✅ had (v2.3)
- Country/state/postal code — ✅ had (v2.3)
- Base currency — 🟡 partly → plan v2.6
- Tax identifiers — ✅ had (v2.3)
- Industry/business type — ❌ not done → plan v2.6
- Logo and branding — 🟡 partly → plan v2.6
- Timezone and locale — 🟡 partly → plan v2.6
- Date/number/decimal formats — 🟡 partly → plan v2.6

**2.2 Company lifecycle** — _P1 · Core_

- Create — ✅ had (v2.3)
- Open/select — ✅ had (v2.3)
- Edit/alter — ✅ had (v2.3)
- Close/switch — ✅ had (v2.3)
- Archive — ❌ not done → plan v2.5
- Deactivate — ❌ not done → plan v2.6
- Delete with approval — 🟡 partly → plan v2.6
- Duplicate/template company — ❌ not done → plan v2.6
- Import opening data — ✅ had (v2.3)

**2.3 Financial period** — _P1 · Core_

- Financial year start/end — ✅ had (v2.3)
- Books beginning date — 🟡 partly → plan v2.6
- Opening balances — ✅ had (v2.3)
- Period lock — ✅ had (v2.3) — "Lock books up to" date in company settings (admin)
- Year-end closing — 🟡 partly → plan v2.6
- Carry-forward balances — ✅ had (v2.3)
- Prior-year comparisons — ❌ not done → plan v2.6
- Period reopening with permission — 🟡 partly → plan v2.6

**2.4 Multi-entity structure** — _P5 · advanced (not Core)_

- Branches — ❌ not done → plan v2.7
- Departments — 🟡 partly → plan v2.7
- Locations — 🟡 partly → plan v2.7
- Business units — ❌ not done → plan v2.7
- Separate tax registrations — ❌ not done → plan v2.7
- Inter-branch transfers — ❌ not done → plan v2.7
- Inter-company balances — ❌ not done → plan v2.7
- Consolidated reports — ❌ not done → plan v2.7
- Branch-wise permissions — 🟡 partly → plan v2.7

**2.5 Company settings** — _P1 · Core_

- Accounting on/off — ❌ not done → plan v2.6
- Inventory on/off — ❌ not done → plan v2.6
- Tax modules — 🟡 partly → plan v2.6
- Payroll module — 🟡 partly → plan v2.6
- Cost centres — 🟡 partly → plan v2.6
- Bill-wise tracking — ✅ had (v2.3)
- Multi-currency — ❌ not done → plan v2.9
- Order processing — 🟡 partly → plan v2.6
- Batch/expiry tracking — ✅ had (v2.3)
- Audit log policy — 🟡 partly → plan v2.6

### 3. Users, roles, permissions and audit


**3.1 Identity and access** — _P1 · Core_

- Create/deactivate user — ✅ had (v2.3) — had in v2.3; v2.4 adds "Remove user…" (deactivate or delete) that also logs the user out of every device at once
- Password reset — ✅ had (v2.3) — admin reset + "Forgot password?" by email code (v2.3)
- Multi-factor authentication — ✅ had (v2.3) — email OTP at login + one-time backup codes (v2.2)
- Session timeout — ✅ had (v2.3)
- Device/session list — 🆕 added in v2.4 — v2.4: Utilities › Logged-in Devices (admin: every user, every device — app type, device name, OS, IP, approx. place, login time, last active) and My Devices (every user)
- Login history — 🆕 added in v2.4 — v2.4: login history (logins with device, failed logins, device log-outs, user removals) on both device screens
- Failed-login controls — ✅ had (v2.3)

**3.2 Roles and permissions** — _P1 · Core_

- Administrator — ✅ had (v2.3)
- Accountant — 🟡 partly → plan v2.5
- Data-entry operator — ✅ had (v2.3)
- Approver — ❌ not done → plan v2.5
- Auditor/read-only — ✅ had (v2.3)
- Sales user — ❌ not done → plan v2.5
- Inventory user — ❌ not done → plan v2.5
- Payroll user — ❌ not done → plan v2.5
- Custom role — ❌ not done → plan v2.5
- Module-level access — ❌ not done → plan v2.5
- Company/branch scope — ✅ had (v2.3)
- Report-only permission — ✅ had (v2.3)

**3.3 Action permissions** — _P1 · Core_

- View — ✅ had (v2.3)
- Create — ✅ had (v2.3)
- Edit — ✅ had (v2.3)
- Delete — ✅ had (v2.3)
- Cancel — ✅ had (v2.3)
- Approve — ❌ not done → plan v2.5
- Post — ❌ not done → plan v2.5
- Export — 🟡 partly → plan v2.5
- Print/share — ✅ had (v2.3)
- Change settings — ✅ had (v2.3)
- Manage users — ✅ had (v2.3)
- Manage backups — ✅ had (v2.3)
- Access sensitive fields — ❌ not done → plan v2.5

**3.4 Audit and approvals** — _P1 · Core_

- Created by/time — ✅ had (v2.3)
- Altered by/time — ✅ had (v2.3)
- Deleted/cancelled record log — ✅ had (v2.3)
- Before/after values — ✅ had (v2.3) — audit trail keeps before/after of every voucher/master change
- Version history — 🟡 partly → plan v2.5
- Reason for change — ❌ not done → plan v2.5
- Approval queue — ❌ not done → plan v2.5
- Maker-checker workflow — ❌ not done → plan v2.5
- Period lock/unlock log — 🟡 partly → plan v2.5
- Exportable audit report — ✅ had (v2.3)

### 4. Accounting configuration and chart of accounts


**4.1 Accounting model** — _P1 · Core_

- Double-entry ledger — ✅ had (v2.3)
- Debit/credit validation — ✅ had (v2.3)
- Accrual/cash reporting options — ❌ not done → plan v2.5
- Accounting period — ✅ had (v2.3)
- Base currency — 🟡 partly → plan v2.5
- Rounding rules — ✅ had (v2.3)
- Voucher numbering policy — ✅ had (v2.3)
- Posting rules — ✅ had (v2.3)

**4.2 Groups** — _P1 · Core_

- Create group — ✅ had (v2.3)
- Parent/subgroup hierarchy — ✅ had (v2.3)
- Balance-sheet/P&L; classification — ✅ had (v2.3)
- Group nature — ✅ had (v2.3)
- Group summary — ✅ had (v2.3)
- Move/reclassify ledger — ✅ had (v2.3)
- Prevent circular hierarchy — ✅ had (v2.3)

**4.3 Ledgers/accounts** — _P1 · Core_

- Ledger name/code — 🟡 partly → plan v2.5
- Group — ✅ had (v2.3)
- Opening balance — ✅ had (v2.3)
- Dr/Cr balance — ✅ had (v2.3)
- Mailing/contact details — ✅ had (v2.3)
- Tax IDs — ✅ had (v2.3)
- Bank details — ✅ had (v2.3)
- Credit terms — ✅ had (v2.3)
- Bill-wise tracking — ✅ had (v2.3)
- Cost-centre allocation — 🟡 partly → plan v2.5
- Interest rules — ✅ had (v2.3)
- Currency — ❌ not done → plan v2.9
- Inactive/blocked status — 🆕 added in v2.4 — v2.4: "Active" tick on the ledger form; inactive ledgers are hidden from new entries, history and reports stay; list shows an "inactive" tag

**4.4 Reconciliation and controls** — _P1 · Core_

- Trial balance validation — ✅ had (v2.3)
- Suspense account review — 🟡 partly → plan v2.5
- Duplicate account detection — 🟡 partly → plan v2.5
- Opening balance verification — 🟡 partly → plan v2.5
- Period-end adjustment journal — ✅ had (v2.3)
- Journal approval — ❌ not done → plan v2.5
- Negative balance warning — ❌ not done → plan v2.5
- Posting lock — ✅ had (v2.3)

**4.5 Financial dimensions** — _P5 · advanced (not Core)_

- Cost centres — ✅ had (v2.3)
- Cost categories — 🟡 partly → plan v2.7
- Departments — 🟡 partly → plan v2.7
- Projects/jobs — ❌ not done → plan v2.7
- Branches — ❌ not done → plan v2.7
- Locations — ❌ not done → plan v2.7
- Custom dimensions — ❌ not done → plan v2.7
- Allocation rules — ❌ not done → plan v2.7

### 5. Masters and reference data


**5.1 Party masters** — _P2 · Core_

- Customers — ✅ had (v2.3)
- Suppliers — ✅ had (v2.3)
- Other parties — ✅ had (v2.3)
- Contact persons — ✅ had (v2.3)
- Billing/shipping addresses — 🟡 partly → plan v2.5
- Tax registration — ✅ had (v2.3)
- Credit limit/period — ✅ had (v2.3)
- Payment terms — ✅ had (v2.3)
- Opening receivable/payable — 🟡 partly → plan v2.5
- Blocked/on-hold status — 🆕 added in v2.4 — v2.4: same "Active" tick (inactive = cannot be picked in new vouchers); no separate on-hold reason yet

**5.2 Product/service masters** — _P3 · Core_

- Stock item — ✅ had (v2.3)
- Service item — ✅ had (v2.3)
- Item code/SKU — ✅ had (v2.3)
- Description — ✅ had (v2.3)
- Group/category/brand — ✅ had (v2.3)
- Unit of measure — ✅ had (v2.3) — had (units master with GST UQC); v2.4: create a unit right from the item screen ("+ Create new unit…" in the drop-down + "+ New unit" link), Units master shows how many items use each unit, edit, delete only when unused, duplicate names refused
- Alternate units/conversion — ❌ not done → plan v2.5
- Sales price — ✅ had (v2.3)
- Purchase cost — ✅ had (v2.3)
- Tax code/rate — ✅ had (v2.3)
- HSN/SAC or local classification — ✅ had (v2.3)
- Reorder level — ✅ had (v2.3)
- Batch/serial tracking — 🟡 partly → plan v2.5
- Expiry/manufacturing dates — ✅ had (v2.3)
- Active/inactive — 🆕 added in v2.4 — v2.4: "Active" tick on the item form (pickers already skipped inactive items, but there was no way to set it)

**5.3 Finance masters** — _P2 · Core_

- Banks — ✅ had (v2.3)
- Currencies — ❌ not done → plan v2.9
- Exchange rates — ❌ not done → plan v2.9
- Payment methods — 🟡 partly → plan v2.5
- Tax ledgers — ✅ had (v2.3)
- Discount ledgers — ✅ had (v2.3)
- Expense/income ledgers — ✅ had (v2.3)
- Fixed assets — ✅ had (v2.3)
- Depreciation methods — 🟡 partly → plan v2.5
- Voucher types — 🟡 partly → plan v2.5

**5.4 Inventory masters** — _P3 · Core_

- Stock groups — ✅ had (v2.3)
- Categories — ✅ had (v2.3)
- Godowns/warehouses — ✅ had (v2.3)
- Bins/locations — ❌ not done → plan v2.6
- Batches — ✅ had (v2.3)
- Serial numbers — ❌ not done → plan v2.5
- Price lists — ✅ had (v2.3)
- Price levels — 🟡 partly → plan v2.5
- Valuation methods — ✅ had (v2.3)

**5.5 Tax/payroll masters** — _P5 · advanced (not Core)_

- Tax rates — ✅ had (v2.3)
- Tax classifications — 🟡 partly → plan v2.7
- Withholding tax codes — ✅ had (v2.3)
- Employee groups — ❌ not done → plan v2.7
- Employees — ✅ had (v2.3)
- Pay heads — 🟡 partly → plan v2.7
- Attendance types — ❌ not done → plan v2.7
- Payroll periods — ✅ had (v2.3)
- Statutory scheme settings — 🟡 partly → plan v2.7

**5.6 Master maintenance** — _P5 · advanced (not Core)_

- Create — ✅ had (v2.3)
- Alter — ✅ had (v2.3)
- Duplicate — ❌ not done → plan v2.5
- Deactivate — 🆕 added in v2.4 — v2.4: ledgers and items (Active tick)
- Bulk import — ✅ had (v2.3)
- Bulk edit — ❌ not done → plan v2.5
- Merge duplicates with audit — ❌ not done → plan v2.5
- Usage/reference lookup — 🟡 partly → plan v2.5 — v2.4: units show "used by N items"; deleting any master that is in use is refused (v2.x); no general "where used" screen yet
- Master change history — ✅ had (v2.3)

### 6. Voucher / transaction engine


**6.1 Common transaction fields** — _P1 · Core_

- Transaction date — ✅ had (v2.3)
- Voucher type/number — ✅ had (v2.3)
- External reference — ✅ had (v2.3)
- Party/account — ✅ had (v2.3)
- Line items — ✅ had (v2.3)
- Quantity/rate/value — ✅ had (v2.3)
- Tax allocation — ✅ had (v2.3)
- Narration/memo — ✅ had (v2.3)
- Attachments — ❌ not done → plan v2.5
- Cost-centre/project tags — ✅ had (v2.3)
- Created/altered metadata — ✅ had (v2.3)

**6.2 Voucher states** — _P1 · Core_

- Draft — 🟡 partly → plan v2.5 — "Optional" vouchers (no accounting effect) work as a draft; no approval flow
- Pending approval — ❌ not done → plan v2.5
- Approved — ❌ not done → plan v2.5
- Posted — ✅ had (v2.3)
- Cancelled — ✅ had (v2.3)
- Reversed — ❌ not done → plan v2.5
- Voided — 🟡 partly → plan v2.5
- Locked by closed period — ✅ had (v2.3)

**6.3 Voucher type catalogue** — _P2 · Core_

- Contra/bank transfer — ✅ had (v2.3)
- Payment — ✅ had (v2.3)
- Receipt — ✅ had (v2.3)
- Journal — ✅ had (v2.3)
- Sales invoice — ✅ had (v2.3)
- Purchase bill — ✅ had (v2.3)
- Credit note — ✅ had (v2.3)
- Debit note — ✅ had (v2.3)
- Sales order — ✅ had (v2.3)
- Purchase order — ✅ had (v2.3)
- Delivery note — ✅ had (v2.3)
- Goods receipt note — ✅ had (v2.3)
- Sales return — ✅ had (v2.3)
- Purchase return — ✅ had (v2.3)
- Stock journal — ✅ had (v2.3)
- Physical stock — ✅ had (v2.3)
- Attendance — ❌ not done → plan v2.7
- Payroll — ✅ had (v2.3)
- Fixed asset acquisition/disposal — 🟡 partly → plan v2.5

**6.4 Entry modes** — _P2 · Core_

- Accounting-only entry — ✅ had (v2.3)
- Item/inventory invoice — ✅ had (v2.3)
- Service invoice — ✅ had (v2.3)
- Single-entry form — 🟡 partly → plan v2.5
- Double-entry form — ✅ had (v2.3)
- Recurring template — ✅ had (v2.3)
- Copy existing voucher — ✅ had (v2.3)
- Bulk entry/import — 🟡 partly → plan v2.5
- Optional/provisional entry — ✅ had (v2.3)
- Post-dated entry — 🟡 partly → plan v2.5

**6.5 Validation rules** — _P1 · Core_

- Debits equal credits — ✅ had (v2.3)
- Required fields — ✅ had (v2.3)
- Date in open period — ✅ had (v2.3)
- Unique numbering — ✅ had (v2.3)
- Party/tax validation — ✅ had (v2.3)
- Stock availability policy — 🟡 partly → plan v2.5
- Tax arithmetic — ✅ had (v2.3)
- Duplicate invoice detection — 🆕 added in v2.4 — v2.4: saving a purchase bill / debit note with a supplier bill no. already entered for that supplier warns at once (spaces, dashes, slashes, case ignored); voucher numbers were already unique
- Credit-limit warning — ✅ had (v2.3)
- Approval threshold — ❌ not done → plan v2.5

**6.6 Transaction actions** — _P1 · Core_

- Save — ✅ had (v2.3)
- Save as draft — 🟡 partly → plan v2.5 — "Optional" voucher
- Submit for approval — ❌ not done → plan v2.5
- Approve/post — ❌ not done → plan v2.5
- Edit — ✅ had (v2.3)
- Duplicate — ✅ had (v2.3)
- Cancel — ✅ had (v2.3)
- Reverse — ❌ not done → plan v2.5
- Delete with permission — ✅ had (v2.3)
- Print/export/share — ✅ had (v2.3)
- View audit trail — ✅ had (v2.3)
- Open related records — 🟡 partly → plan v2.5

**6.7 Numbering and sequences** — _P1 · Core_

- Automatic/manual — ✅ had (v2.3)
- Prefix/suffix — 🟡 partly → plan v2.5
- Financial-year reset — ✅ had (v2.3)
- Branch series — ❌ not done → plan v2.7
- Voucher-type series — ✅ had (v2.3)
- Tax-registration series — ❌ not done → plan v2.7
- Gap detection — 🆕 added in v2.4 — v2.4: Reports › Voucher Number Gaps — missing and repeated numbers in each series of a financial year
- Concurrent-user-safe numbering — ✅ had (v2.3)

### 7. Sales, receivables and customer management


**7.1 Sales flow** — _P2 · Core_

- Quotation/estimate — ✅ had (v2.3)
- Sales order — ✅ had (v2.3)
- Delivery/dispatch — ✅ had (v2.3)
- Sales invoice — ✅ had (v2.3)
- Credit note/sales return — ✅ had (v2.3)
- Receipt allocation — ✅ had (v2.3)
- Customer statement — ✅ had (v2.3)
- Sales cancellation — ✅ had (v2.3)

**7.2 Invoice fields/options** — _P2 · Core_

- Customer/billing address — ✅ had (v2.3)
- Ship-to address — ✅ had (v2.3)
- Invoice date/number — ✅ had (v2.3)
- Order reference — ✅ had (v2.3)
- Item/service lines — ✅ had (v2.3)
- Quantity/unit/rate — ✅ had (v2.3)
- Line/invoice discount — ✅ had (v2.3)
- Tax calculation — ✅ had (v2.3)
- Freight/packing/other charges — 🟡 partly → plan v2.6
- Round-off — ✅ had (v2.3)
- Payment terms/due date — ✅ had (v2.3)
- Notes/terms — ✅ had (v2.3)
- E-invoice reference — 🟡 partly → plan v2.6

**7.3 Receivables** — _P2 · Core_

- Bill-wise references — ✅ had (v2.3)
- Advance receipts — ✅ had (v2.3)
- Part payments — ✅ had (v2.3)
- Credit-note adjustment — ✅ had (v2.3)
- On-account receipts — ✅ had (v2.3)
- Ageing buckets — ✅ had (v2.3)
- Overdue reminders — ✅ had (v2.3)
- Customer statement — ✅ had (v2.3)
- Credit limit/hold — 🟡 partly → plan v2.6
- Bad-debt/write-off workflow — ❌ not done → plan v2.6

**7.4 Sales analysis** — _P2 · Core_

- Sales register — ✅ had (v2.3)
- Customer/item/salesperson-wise sales — ✅ had (v2.3)
- Branch-wise sales — ❌ not done → plan v2.7
- Margin/profitability — ✅ had (v2.3)
- Discount analysis — ❌ not done → plan v2.6
- Returns/cancellations — 🟡 partly → plan v2.6
- Tax summary — ✅ had (v2.3)
- Outstanding orders — ✅ had (v2.3)

**7.5 Customer service** — _P5 · advanced (not Core)_

- Customer history — ✅ had (v2.3)
- Notes/attachments — 🟡 partly → plan v2.6
- Dispute/hold reason — ❌ not done → plan v2.6
- Communication log — ❌ not done → plan v2.6
- Payment reminder templates — ✅ had (v2.3)
- Statement sharing — ✅ had (v2.3)

### 8. Purchases, payables and supplier management


**8.1 Purchase flow** — _P2 · Core_

- Purchase request (optional) — ❌ not done → plan v2.6
- Purchase order — ✅ had (v2.3)
- Goods receipt — ✅ had (v2.3)
- Supplier bill — ✅ had (v2.3)
- Debit note/purchase return — ✅ had (v2.3)
- Supplier payment — ✅ had (v2.3)
- Supplier statement reconciliation — 🟡 partly → plan v2.6

**8.2 Purchase invoice options** — _P2 · Core_

- Supplier and bill number — ✅ had (v2.3)
- Bill/accounting date — ✅ had (v2.3)
- Order/receipt references — ✅ had (v2.3)
- Item/service lines — ✅ had (v2.3)
- Quantity/rate — ✅ had (v2.3)
- Freight/landed cost — 🟡 partly → plan v2.6
- Discount — ✅ had (v2.3)
- Tax/withholding — ✅ had (v2.3)
- Bill-wise reference — ✅ had (v2.3)
- Due date — ✅ had (v2.3)
- Attachments — ❌ not done → plan v2.6

**8.3 Payables** — _P2 · Core_

- Bill-wise outstanding — ✅ had (v2.3)
- Advance to supplier — ✅ had (v2.3)
- Part payment — ✅ had (v2.3)
- Credit/debit note adjustment — ✅ had (v2.3)
- Payment proposal — ❌ not done → plan v2.6
- Due-date sorting — ✅ had (v2.3)
- Ageing buckets — ✅ had (v2.3)
- Payment hold — ❌ not done → plan v2.6
- Supplier statement reconciliation — 🟡 partly → plan v2.6

**8.4 Procurement analysis** — _P2 · Core_

- Supplier-wise purchases — ✅ had (v2.3)
- Item-wise purchase cost — ✅ had (v2.3)
- Purchase price variance — ❌ not done → plan v2.6
- Pending purchase orders — ✅ had (v2.3)
- Delivery delays — ❌ not done → plan v2.6
- Purchase returns — ✅ had (v2.3)
- Tax/ITC reconciliation — ✅ had (v2.3)
- Supplier performance — ❌ not done → plan v2.6

**8.5 Controls** — _P2 · Core_

- Duplicate supplier invoice check — 🆕 added in v2.4 — v2.4: warning on save + Reports › Duplicate Bills Check
- Supplier bank-detail change approval — ❌ not done → plan v2.6
- Purchase approval limits — ❌ not done → plan v2.6
- Order/receipt/bill matching — 🟡 partly → plan v2.6
- Blocked supplier warning — 🟡 partly → plan v2.6

### 9. Inventory and warehouse operations


**9.1 Stock tracking** — _P3 · Core_

- Opening/closing stock — ✅ had (v2.3)
- Receipts/issues — ✅ had (v2.3)
- Transfers — ✅ had (v2.3)
- Adjustments — ✅ had (v2.3)
- Physical count — ✅ had (v2.3)
- Stock valuation — ✅ had (v2.3)
- Negative stock control — 🟡 partly → plan v2.6
- Stock ageing — 🟡 partly → plan v2.6
- Slow-moving stock — ✅ had (v2.3)

**9.2 Warehouse structure** — _P3 · Core_

- Warehouse/godown — ✅ had (v2.3)
- Sub-location/bin — ❌ not done → plan v2.6
- Transfer order — 🟡 partly → plan v2.6
- Inter-branch transfer — ❌ not done → plan v2.6
- In-transit stock — ❌ not done → plan v2.6
- Location-wise balances — ✅ had (v2.3)
- Pick/pack/dispatch status — ❌ not done → plan v2.6

**9.3 Advanced tracking** — _P3 · Core_

- Batch number — ✅ had (v2.3)
- Serial number — ❌ not done → plan v2.5
- Manufacturing date — ✅ had (v2.3)
- Expiry date — ✅ had (v2.3)
- Warranty — ❌ not done → plan v2.6
- Lot traceability — 🟡 partly → plan v2.6
- Recall lookup — ❌ not done → plan v2.6
- Barcode/SKU scan — ✅ had (v2.3)

**9.4 Costing** — _P3 · Core_

- FIFO — ✅ had (v2.3)
- Weighted average — ✅ had (v2.3)
- Other valuation methods — ✅ had (v2.3)
- Landed cost allocation — ❌ not done → plan v2.6
- Purchase freight/duty allocation — ❌ not done → plan v2.6
- Cost-of-goods-sold calculation — ✅ had (v2.3)
- Stock valuation by period — ✅ had (v2.3)

**9.5 Replenishment** — _P3 · Core_

- Minimum/reorder quantity — ✅ had (v2.3)
- Maximum stock — ✅ had (v2.3)
- Lead time — ❌ not done → plan v2.6
- Suggested purchase order — 🟡 partly → plan v2.6
- Demand history — 🟡 partly → plan v2.6
- Supplier/item mapping — 🟡 partly → plan v2.6
- Slow/obsolete stock alerts — ✅ had (v2.3)

**9.6 Manufacturing/job work (optional)** — _P5 · advanced (not Core)_

- Bill of materials — ✅ had (v2.3)
- Raw material consumption — ✅ had (v2.3)
- Finished goods output — ✅ had (v2.3)
- By-products/wastage — ❌ not done → plan v2.6
- Production order — ❌ not done → plan v2.6
- Job work sent/received — ❌ not done → plan v2.6
- Material issued/returned — 🟡 partly → plan v2.6
- Work-in-progress costing — ❌ not done → plan v2.6

### 10. Taxation and statutory compliance


**10.1 Tax engine** — _P4 · Core_

- Tax jurisdiction — ✅ had (v2.3)
- Registration number/type — ✅ had (v2.3)
- Tax period — ✅ had (v2.3)
- Effective-dated rates — 🟡 partly → plan v2.8
- Tax-inclusive/exclusive prices — ✅ had (v2.3)
- Exempt/zero-rated/out-of-scope — 🟡 partly → plan v2.8
- Place-of-supply rules — ✅ had (v2.3)
- Reverse charge — ✅ had (v2.3)
- Withholding taxes — ✅ had (v2.3)
- Rounding and adjustment — ✅ had (v2.3)

**10.2 India GST setup** — _P4 · Core_

- GSTIN/registration — ✅ had (v2.3)
- Regular/composition applicability — 🟡 partly → plan v2.8
- Multiple registrations where required — 🟡 partly → plan v2.8
- HSN/SAC — ✅ had (v2.3)
- CGST/SGST/IGST — ✅ had (v2.3)
- ITC classification — 🟡 partly → plan v2.8
- Reverse charge — ✅ had (v2.3)
- Credit/debit notes — ✅ had (v2.3)
- Export/SEZ scenarios — 🟡 partly → plan v2.8
- E-invoice/IRN — 🟡 partly → plan v2.8 — e-invoice JSON for upload is made; IRN generation needs the IRP portal/API (integration)
- E-way bill — 🟡 partly → plan v2.8 — e-way bill JSON is made; generating the EWB number needs the portal/API (integration)

**10.3 GST reports/workflows** — _P4 · Core_

- Sales/outward supplies — ✅ had (v2.3)
- GSTR-1 data — ✅ had (v2.3)
- GSTR-3B data — ✅ had (v2.3)
- Purchase/inward supplies — ✅ had (v2.3)
- GSTR-2A/2B reconciliation — ✅ had (v2.3)
- IMS actions where applicable — 🔌 not done — needs outside integration → only if the outside service/account is arranged — needs the GST portal (integration)
- HSN summary — ✅ had (v2.3)
- Tax liability summary — ✅ had (v2.3)
- Uncertain transactions — 🟡 partly → plan v2.8
- Mismatch report — ✅ had (v2.3)
- JSON/Excel/CSV export — ✅ had (v2.3)
- Portal upload/download — 🔌 not done — needs outside integration → only if the outside service/account is arranged — JSON/Excel files are made for upload by the user; the app does not file on the GST portal

**10.4 Other tax modules** — _P4 · Core_

- TDS — ✅ had (v2.3)
- TCS — ✅ had (v2.3)
- Income-tax reports — ✅ had (v2.3) — ITR computation sheet + PDF (no ITR filing)
- VAT/sales tax for relevant jurisdictions — ➖ not applicable (India-only app) — not applicable (India GST app)
- Legacy excise/service-tax data where required — ➖ not applicable (India-only app) — not applicable
- Withholding certificate/reporting — 🟡 partly → plan v2.8
- Tax challan and return files — ❌ not done → plan v2.8

**10.5 Compliance controls** — _P4 · Core_

- Tax rule effective dates — 🟡 partly → plan v2.8
- Validation against current formats — 🟡 partly → plan v2.8
- Filing status — ❌ not done → plan v2.8
- Submission acknowledgement — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Return version/history — ❌ not done → plan v2.8
- Reconciliation before filing — ✅ had (v2.3)
- Exception resolution — 🟡 partly → plan v2.8
- Access control for filing — 🟡 partly → plan v2.8

### 11. Banking, payments and reconciliation


**11.1 Bank masters** — _P4 · Core_

- Bank account — ✅ had (v2.3)
- Account number/masked display — 🟡 partly → plan v2.6
- IFSC/SWIFT/local routing code — ✅ had (v2.3)
- Currency — ❌ not done → plan v2.9
- Opening balance — ✅ had (v2.3)
- Cheque settings — ✅ had (v2.3)
- Statement import format — ✅ had (v2.3)

**11.2 Bank reconciliation** — _P4 · Core_

- Manual match — ✅ had (v2.3)
- Exact auto-match — ✅ had (v2.3) — bank statement import (Excel/CSV) with auto-match
- Suggested match — ✅ had (v2.3)
- One-to-many/many-to-one matching — ❌ not done → plan v2.6
- Unmatched items — ✅ had (v2.3)
- Bank charges/interest — ✅ had (v2.3)
- Duplicate detection — ✅ had (v2.3)
- Reconciliation lock — ❌ not done → plan v2.6
- Reconciliation report — ✅ had (v2.3)

**11.3 Payment operations** — _P4 · Core_

- Cash — ✅ had (v2.3)
- Cheque — ✅ had (v2.3)
- Bank transfer — ✅ had (v2.3)
- Electronic payment — 🟡 partly → plan v2.6
- Bulk payment file — ❌ not done → plan v2.6
- Payment approval — ❌ not done → plan v2.6
- Payment status — ❌ not done → plan v2.6
- Remittance advice — 🟡 partly → plan v2.6
- Payment failure/retry — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Payment request link/QR — 🟡 partly → plan v2.6

**11.4 Connected banking (integration-dependent)** — _P5 · advanced (not Core)_

- Bank connection setup — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Consent/authorisation — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Fetch balances/statements — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Create voucher from bank line — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Payment initiation — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Status refresh — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Single/daily limits — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Connection health — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Revoke connection — 🔌 not done — needs outside integration → only if the outside service/account is arranged

**11.5 Cash controls** — _P4 · Core_

- Cash book — ✅ had (v2.3)
- Cash count — ❌ not done → plan v2.6
- Petty cash — 🟡 partly → plan v2.6
- Cash transfer — ✅ had (v2.3)
- Cash expense voucher — ✅ had (v2.3)
- Cash balance alerts — ❌ not done → plan v2.6

### 12. Cost accounting, budgets and projects


**12.1 Cost allocation** — _P5 · advanced (not Core)_

- Cost centres/categories — ✅ had (v2.3)
- Departments — 🟡 partly → plan v2.7
- Projects/jobs — 🟡 partly → plan v2.7
- Branches — ❌ not done → plan v2.7
- Custom dimensions — ❌ not done → plan v2.7
- Allocation percentage/value — ❌ not done → plan v2.7
- Default allocation rules — ❌ not done → plan v2.7

**12.2 Budgets** — _P5 · advanced (not Core)_

- Annual/quarterly/monthly budget — 🟡 partly → plan v2.7
- Ledger/group budget — 🟡 partly → plan v2.7
- Department/project budget — ❌ not done → plan v2.7
- Budget revision/version — ❌ not done → plan v2.7
- Actual vs budget — ✅ had (v2.3)
- Variance amount/percentage — ✅ had (v2.3)
- Over-budget alerts — ❌ not done → plan v2.7

**12.3 Project/job costing** — _P5 · advanced (not Core)_

- Project master — 🟡 partly → plan v2.7
- Revenue/expense allocation — 🟡 partly → plan v2.7
- Material/labour allocation — ❌ not done → plan v2.7
- Committed costs — ❌ not done → plan v2.7
- Work in progress — ❌ not done → plan v2.7
- Project profitability — 🟡 partly → plan v2.7
- Project balance report — 🟡 partly → plan v2.7

**12.4 Interest and finance charges** — _P5 · advanced (not Core)_

- Interest rules — ✅ had (v2.3)
- Rate/effective date — 🟡 partly → plan v2.7
- Simple/compound method where required — 🟡 partly → plan v2.7
- Overdue days — ✅ had (v2.3)
- Party/ledger applicability — ✅ had (v2.3)
- Interest report — ✅ had (v2.3)
- Adjustment voucher — ❌ not done → plan v2.7

### 13. Payroll and employee administration


**13.1 Employee master** — _P5 · advanced (not Core)_

- Employee ID/name/contact — ✅ had (v2.3)
- Department/designation — 🟡 partly → plan v2.7
- Joining/leaving date — 🟡 partly → plan v2.7
- Bank/payment details — ✅ had (v2.3)
- Tax identifiers — ✅ had (v2.3)
- Salary structure — ✅ had (v2.3)
- Active/inactive — ✅ had (v2.3)

**13.2 Pay heads** — _P5 · advanced (not Core)_

- Basic pay — ✅ had (v2.3)
- Allowances — ✅ had (v2.3)
- Bonus/incentives — ❌ not done → plan v2.7
- Reimbursements — ❌ not done → plan v2.7
- Employee deductions — ✅ had (v2.3)
- Employer contributions — ✅ had (v2.3)
- Taxable classification — ❌ not done → plan v2.7
- Calculation basis — 🟡 partly → plan v2.7

**13.3 Attendance** — _P5 · advanced (not Core)_

- Attendance type — ❌ not done → plan v2.7
- Present/absent/leave — ❌ not done → plan v2.7
- Paid/unpaid leave — ❌ not done → plan v2.7
- Overtime — ❌ not done → plan v2.7
- Production units — ❌ not done → plan v2.7
- Attendance import — ❌ not done → plan v2.7
- Approval — ❌ not done → plan v2.7

**13.4 Payroll processing** — _P5 · advanced (not Core)_

- Pay period — ✅ had (v2.3)
- Salary computation — ✅ had (v2.3)
- Arrears/adjustments — ❌ not done → plan v2.7
- Loans/advances — ❌ not done → plan v2.7
- Deductions — ✅ had (v2.3)
- Net pay — ✅ had (v2.3)
- Payslip — ✅ had (v2.3)
- Payroll posting — ✅ had (v2.3)
- Reversal/correction — 🟡 partly → plan v2.7

**13.5 Statutory payroll** — _P5 · advanced (not Core)_

- PF/ESI and applicable schemes — ✅ had (v2.3)
- Professional tax where applicable — ✅ had (v2.3)
- Income-tax/TDS calculations — 🟡 partly → plan v2.7
- Statutory registers — 🟡 partly → plan v2.7
- Return files — ❌ not done → plan v2.7
- Liability reports — 🟡 partly → plan v2.7
- Rule updates by effective date — ❌ not done → plan v2.7

### 14. Financial statements and management reports


**14.1 Core statements** — _P1 · Core_

- Trial balance — ✅ had (v2.3)
- Profit & loss — ✅ had (v2.3)
- Balance sheet — ✅ had (v2.3)
- Cash flow — ✅ had (v2.3)
- Funds flow — ❌ not done → plan v2.5
- Comparative period reports — ❌ not done → plan v2.5
- Opening/closing balances — ✅ had (v2.3)

**14.2 Books and registers** — _P1 · Core_

- Day book — ✅ had (v2.3)
- Cash book — ✅ had (v2.3)
- Bank book — ✅ had (v2.3)
- Ledger report — ✅ had (v2.3)
- Sales/purchase registers — ✅ had (v2.3)
- Journal register — ✅ had (v2.3)
- Receipt/payment register — ✅ had (v2.3)
- Credit/debit note register — ✅ had (v2.3)
- Voucher register — ✅ had (v2.3)

**14.3 Receivable/payable reports** — _P2 · Core_

- Outstanding bills — ✅ had (v2.3)
- Ageing — ✅ had (v2.3)
- Due-date analysis — ✅ had (v2.3)
- Party statement — ✅ had (v2.3)
- Advance balances — 🟡 partly → plan v2.5
- Overdue summary — ✅ had (v2.3)
- Collection/payment forecast — ❌ not done → plan v2.5

**14.4 Inventory reports** — _P3 · Core_

- Stock summary — ✅ had (v2.3)
- Item movement — ✅ had (v2.3)
- Group/category summary — 🟡 partly → plan v2.5
- Warehouse balances — ✅ had (v2.3)
- Batch/expiry report — ✅ had (v2.3)
- Stock ageing — 🟡 partly → plan v2.5
- Reorder list — ✅ had (v2.3)
- Negative stock exceptions — ✅ had (v2.3)
- Order outstanding — ✅ had (v2.3)

**14.5 Tax/payroll reports** — _P4 · Core_

- GST returns/summary — ✅ had (v2.3)
- Tax ledger — ✅ had (v2.3)
- ITC reconciliation — ✅ had (v2.3)
- TDS/TCS reports — ✅ had (v2.3)
- Payroll statement — ✅ had (v2.3)
- Pay sheet — ✅ had (v2.3)
- Attendance summary — ❌ not done → plan v2.7
- Statutory liability — 🟡 partly → plan v2.5

**14.6 Analysis and drill-down** — _P5 · advanced (not Core)_

- Ledger-to-voucher drill-down — ✅ had (v2.3)
- Filters — ✅ had (v2.3)
- Date range — ✅ had (v2.3)
- Group-by — 🟡 partly → plan v2.5
- Sort — 🟡 partly → plan v2.5
- Comparisons — ❌ not done → plan v2.5
- Variance — 🟡 partly → plan v2.5
- Ratios — ✅ had (v2.3)
- Charts — ✅ had (v2.3)
- Saved views — ❌ not done → plan v2.5
- Export current view — ✅ had (v2.3)

**14.7 Audit/exception reports** — _P5 · advanced (not Core)_

- Unapproved transactions — ❌ not done → plan v2.5
- Uncertain transactions — 🟡 partly → plan v2.5
- Altered/deleted records — ✅ had (v2.3)
- Duplicate invoices — 🆕 added in v2.4 — v2.4: Reports › Duplicate Bills Check (same supplier bill no.; same customer + date + amount)
- Negative stock — ✅ had (v2.3)
- Overdue bills — ✅ had (v2.3)
- Out-of-period entries — ❌ not done → plan v2.5
- Unreconciled bank items — ✅ had (v2.3)
- Import exceptions — 🟡 partly → plan v2.5

### 15. Import, export, integrations and APIs


**15.1 Import** — _P5 · advanced (not Core)_

- Excel/XLSX — ✅ had (v2.3)
- CSV — ✅ had (v2.3)
- XML — ❌ not done → plan v2.8
- JSON — 🟡 partly → plan v2.8
- API import — ❌ not done → plan v2.8
- Template mapping — ✅ had (v2.3)
- Field mapping — 🟡 partly → plan v2.8
- Preview/validation — 🟡 partly → plan v2.8
- Dry run — ❌ not done → plan v2.8
- Error file — ❌ not done → plan v2.8
- Duplicate handling — ✅ had (v2.3)
- Rollback/import batch log — 🟡 partly → plan v2.8

**15.2 Export** — _P2 · Core_

- PDF — ✅ had (v2.3)
- Excel/XLSX — ✅ had (v2.3)
- CSV — 🟡 partly → plan v2.8
- XML — ❌ not done → plan v2.8
- JSON — ✅ had (v2.3)
- Print-ready reports — ✅ had (v2.3)
- Selected records — ❌ not done → plan v2.8
- Filtered data — 🆕 added in v2.4 — v2.4: list export = the filtered, sorted list
- Export history — ❌ not done → plan v2.8

**15.3 Integration framework** — _P5 · advanced (not Core)_

- REST API — ❌ not done → plan v2.9
- Webhooks — ❌ not done → plan v2.9
- OAuth/API keys — ❌ not done → plan v2.9
- Rate limits — ❌ not done → plan v2.9
- Retry queue — ❌ not done → plan v2.9
- Idempotency keys — ❌ not done → plan v2.9
- Error logging — ❌ not done → plan v2.9
- Versioned endpoints — ❌ not done → plan v2.9
- Sandbox/test environment — ❌ not done → plan v2.9

**15.4 External systems** — _P5 · advanced (not Core)_

- Banking — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Tax portals — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Payment gateways — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- POS — ❌ not done → plan v2.8
- CRM — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- E-commerce — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Payroll/HR — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Document storage — 🔌 not done — needs outside integration → only if the outside service/account is arranged
- Email — 🟡 partly → plan v2.8
- Business messaging — 🟡 partly → plan v2.8
- BI/data warehouse — 🔌 not done — needs outside integration → only if the outside service/account is arranged

**15.5 Data exchange controls** — _P5 · advanced (not Core)_

- Source/target mapping — ❌ not done → plan v2.9
- Master-data ownership — ❌ not done → plan v2.9
- Sync direction — ❌ not done → plan v2.9
- Conflict resolution — ❌ not done → plan v2.9
- Duplicate prevention — 🟡 partly → plan v2.9
- Sync status — ❌ not done → plan v2.9
- Failed-record queue — ❌ not done → plan v2.9
- Post-sync reconciliation — ❌ not done → plan v2.9

### 16. Backup, restore, migration and data integrity


**16.1 Backup** — _P1 · Core_

- Manual backup — ✅ had (v2.3)
- Scheduled backup — ✅ had (v2.3) — daily automatic copy when a company is opened, last 15 kept
- Local/cloud destination — ✅ had (v2.3)
- Retention policy — ✅ had (v2.3)
- Encryption — 🟡 partly → plan v2.8
- Backup status log — 🟡 partly → plan v2.8
- Multiple versions — ✅ had (v2.3)
- Restore-point selection — ✅ had (v2.3)

**16.2 Restore/disaster recovery** — _P1 · Core_

- Restore to original/new location — 🟡 partly → plan v2.8
- Pre-restore snapshot — 🟡 partly → plan v2.8
- Integrity validation — ✅ had (v2.3)
- Restore report — 🟡 partly → plan v2.8
- Recovery test — ❌ not done → plan v2.8
- Recovery point/time objectives — ❌ not done → plan v2.8

**16.3 Migration** — _P5 · advanced (not Core)_

- Legacy-system import — 🟡 partly → plan v2.8
- Chart-of-accounts mapping — ❌ not done → plan v2.8
- Opening balances — ✅ had (v2.3)
- Outstanding bills — ❌ not done → plan v2.8
- Stock quantities/values — ✅ had (v2.3)
- Historical vouchers — ❌ not done → plan v2.8
- Tax history — ❌ not done → plan v2.8
- Migration summary — 🟡 partly → plan v2.8
- Exception list — 🟡 partly → plan v2.8

**16.4 Data integrity** — _P1 · Core_

- Unique IDs — ✅ had (v2.3)
- Referential integrity — ✅ had (v2.3)
- Balanced journals — ✅ had (v2.3)
- Duplicate detection — 🟡 partly → plan v2.8
- Orphan record detection — 🟡 partly → plan v2.8
- Validation jobs — ✅ had (v2.3)
- Repair workflow — ❌ not done → plan v2.8
- Immutable audit events — 🟡 partly → plan v2.8

**16.5 Sync/multi-user** — _P5 · advanced (not Core)_

- Concurrent edits — ✅ had (v2.3)
- Record locking — 🟡 partly → plan v2.8
- Conflict warning — ✅ had (v2.3)
- Transaction consistency — ✅ had (v2.3)
- Network interruption recovery — ✅ had (v2.3)
- Sync queue — ❌ not done → plan v2.8
- Offline/online status where supported — ✅ had (v2.3)

### 17. Print, document templates and sharing


**17.1 Document types** — _P2 · Core_

- Sales invoice — ✅ had (v2.3)
- Purchase order — ✅ had (v2.3)
- Sales order — ✅ had (v2.3)
- Delivery note — ✅ had (v2.3)
- Receipt note — ✅ had (v2.3)
- Credit/debit note — ✅ had (v2.3)
- Payment advice — ✅ had (v2.3)
- Party statement — ✅ had (v2.3)
- Payslip — ✅ had (v2.3)
- Financial report — ✅ had (v2.3)

**17.2 Template settings** — _P2 · Core_

- Logo — 🟡 partly → plan v2.8
- Company/branch details — ✅ had (v2.3)
- Font/size — ❌ not done → plan v2.8
- Page size/orientation — 🟡 partly → plan v2.8
- Margins — ❌ not done → plan v2.8
- Header/footer — 🟡 partly → plan v2.8
- Column order — ❌ not done → plan v2.8
- Tax breakup — ✅ had (v2.3)
- Bank/payment details — ✅ had (v2.3)
- Terms and conditions — ✅ had (v2.3)
- Signature area — ✅ had (v2.3)
- Watermark — ❌ not done → plan v2.8

**17.3 Output channels** — _P2 · Core_

- Print — ✅ had (v2.3)
- PDF export — ✅ had (v2.3)
- Email — 🟡 partly → plan v2.8
- Business messaging — 🟡 partly → plan v2.8 — WhatsApp share link; no WhatsApp Business API (integration)
- Download — ✅ had (v2.3)
- Secure link — ❌ not done → plan v2.8
- Digital signature where supported — ❌ not done → plan v2.8 (needs a DSC token — partly integration)

**17.4 Output controls** — _P2 · Core_

- Preview — ✅ had (v2.3)
- Copies — 🟡 partly → plan v2.8
- Page breaks — 🟡 partly → plan v2.8
- Language — 🟡 partly → plan v2.8
- Currency formatting — ✅ had (v2.3)
- Bilingual format where needed — ❌ not done → plan not planned (English-only UI rule)
- Document access expiry — ❌ not done → plan v2.8
- Share log — ❌ not done → plan v2.8
- Redaction of sensitive fields — ❌ not done → plan v2.8

### 18. Dashboard, analytics and notifications


**18.1 Dashboard tiles** — _P5 · advanced (not Core)_

- Cash/bank position — ✅ had (v2.3)
- Receivables — ✅ had (v2.3)
- Payables — ✅ had (v2.3)
- Sales — ✅ had (v2.3)
- Purchases — ✅ had (v2.3)
- Profit/loss trend — ✅ had (v2.3)
- Stock value — ✅ had (v2.3)
- Tax liabilities — ✅ had (v2.3)
- Overdue items — ✅ had (v2.3)
- Budget variance — ❌ not done → plan v2.7

**18.2 Analytics** — _P5 · advanced (not Core)_

- Period comparison — 🟡 partly → plan v2.7
- Branch comparison — ❌ not done → plan v2.7
- Customer/supplier analysis — ✅ had (v2.3)
- Product margin — ✅ had (v2.3)
- Expense trend — 🟡 partly → plan v2.7
- Cash-flow forecast — ❌ not done → plan v2.7
- Top/bottom items — ✅ had (v2.3)
- Drill-down to transactions — ✅ had (v2.3)

**18.3 Alerts** — _P5 · advanced (not Core)_

- Overdue invoice — ✅ had (v2.3)
- Low stock — ✅ had (v2.3)
- Expiry approaching — ✅ had (v2.3)
- Credit limit exceeded — ✅ had (v2.3)
- Bank reconciliation pending — 🟡 partly → plan v2.7
- Tax deadline — ✅ had (v2.3)
- Unapproved voucher — ❌ not done → plan v2.7
- Backup failed — ❌ not done → plan v2.7
- Integration failure — ❌ not done → plan v2.7
- License/service status — 🟡 partly → plan v2.7

**18.4 Notification settings** — _P5 · advanced (not Core)_

- In-app/email/push where supported — 🟡 partly → plan v2.7
- Frequency — ❌ not done → plan v2.7
- Recipient/role — ❌ not done → plan v2.7
- Severity — ❌ not done → plan v2.7
- Dismiss/snooze — 🟡 partly → plan v2.7
- Alert history — 🟡 partly → plan v2.7

### 19. Multi-company, multi-currency and consolidation


**19.1 Multi-company** — _P5 · advanced (not Core)_

- Company switcher — ✅ had (v2.3)
- Cross-company search — ❌ not done → plan v2.9
- Company-specific roles/settings — 🟡 partly → plan v2.9
- Consolidated view where supported — ❌ not done → plan v2.9

**19.2 Foreign currency** — _P5 · advanced (not Core)_

- Currency master — ❌ not done → plan v2.9
- Exchange-rate table — ❌ not done → plan v2.9
- Transaction currency — ❌ not done → plan v2.9
- Base-currency conversion — ❌ not done → plan v2.9
- Realised forex gain/loss — ❌ not done → plan v2.9
- Unrealised revaluation — ❌ not done → plan v2.9
- Rate source/effective date — ❌ not done → plan v2.9

**19.3 Consolidation** — _P5 · advanced (not Core)_

- Entity mapping — ❌ not done → plan v2.9
- Inter-company transactions — ❌ not done → plan v2.9
- Elimination entries — ❌ not done → plan v2.9
- Currency translation — ❌ not done → plan v2.9
- Consolidated statements — ❌ not done → plan v2.9
- Entity-level drill-down — ❌ not done → plan v2.9
- Consolidation audit trail — ❌ not done → plan v2.9

### 20. Security, privacy, operations and administration


**20.1 Application security** — _P1 · Core_

- Encryption in transit/at rest — 🟡 partly → plan v2.8
- Secret/key management — 🟡 partly → plan v2.8
- Password policy — ✅ had (v2.3)
- MFA — ✅ had (v2.3)
- Session controls — 🆕 added in v2.4 — 12 h idle / 7 day sessions, "stay logged in" for apps (v2.1); v2.4: log out one device / all devices, remove user = instant logout
- Least-privilege access — ✅ had (v2.3)
- Audit logs — ✅ had (v2.3)

**20.2 Data privacy** — _P5 · advanced (not Core)_

- Personal-data minimisation — 🟡 partly → plan v2.8
- Sensitive-field permissions — ❌ not done → plan v2.8
- Retention policy — 🟡 partly → plan v2.8
- Export restrictions — 🟡 partly → plan v2.8
- Deletion/archival policy — 🟡 partly → plan v2.8
- Consent/notice where applicable — ❌ not done → plan v2.8

**20.3 Operations** — _P5 · advanced (not Core)_

- Health/status page — ✅ had (v2.3)
- Error logs — 🟡 partly → plan v2.8
- Performance metrics — ❌ not done → plan v2.8
- Job queue — ❌ not done → plan v2.8
- Scheduled jobs — 🟡 partly → plan v2.8
- Service alerts — ❌ not done → plan v2.8
- Database maintenance — 🟡 partly → plan v2.8
- Upgrade/migration status — 🟡 partly → plan v2.8

**20.4 Administration** — _P5 · advanced (not Core)_

- License/subscription status — ❌ not done → plan not planned (no licensing in this app)
- User/seat management — ✅ had (v2.3)
- Feature entitlements — ❌ not done → plan not planned
- Organisation settings — ✅ had (v2.3)
- Connected-app permissions — ❌ not done → plan v2.8
- API key rotation — ❌ not done → plan v2.8
- Support diagnostics — 🟡 partly → plan v2.8

### 21. Industry extensions and advanced workflows


**21.1 Retail/POS** — _P6 · extension_

- Fast billing — 🟡 partly → plan v2.9
- Barcode scanning — ✅ had (v2.3)
- Cash drawer — ❌ not done → plan not planned (hardware)
- Returns/exchanges — ✅ had (v2.3)
- Shift closing — ❌ not done → plan v2.9
- POS reconciliation — ❌ not done → plan v2.9
- Store-wise inventory — ✅ had (v2.3)

**21.2 Distribution/wholesale** — _P6 · extension_

- Price lists — ✅ had (v2.3)
- Trade discounts — ✅ had (v2.3)
- Credit limits — ✅ had (v2.3)
- Sales routes — ❌ not done → plan v2.9
- Order fulfilment — ✅ had (v2.3)
- Batch/expiry tracking — ✅ had (v2.3)

**21.3 Services** — _P6 · extension_

- Service invoice — ✅ had (v2.3)
- Time/project tracking — ❌ not done → plan v2.9
- Retainers/recurring invoices — ✅ had (v2.3)
- Milestone billing — ❌ not done → plan v2.9
- Expense reimbursement — ❌ not done → plan v2.9

**21.4 Manufacturing** — _P6 · extension_

- Bill of materials — ✅ had (v2.3)
- Production planning — ❌ not done → plan v2.9
- Material issue/receipt — 🟡 partly → plan v2.9
- Scrap/by-products — ❌ not done → plan v2.9
- Work-in-progress — ❌ not done → plan v2.9
- Job costing — ❌ not done → plan v2.9

**21.5 Accounting firm** — _P6 · extension_

- Multiple client companies — ✅ had (v2.3)
- Client-wise access — ✅ had (v2.3)
- Compliance calendar — ✅ had (v2.3)
- Task checklist — 🟡 partly → plan v2.9
- Review/approval workflow — ❌ not done → plan v2.9
- Document request list — ❌ not done → plan v2.9
- Client report pack — ❌ not done → plan v2.9


## Phase plan for what is left
Order is by value for a small Indian trading business; each release keeps old data working (backward-compatible migrations, tested on a copy first).

**v2.5 — controls & everyday speed**
- Draft → submit → approve → post (maker-checker), approval queue, approval limits, "Approver" role; reason box on edit/delete.
- Reverse a voucher (auto opposite entry); "unapproved" and "out-of-period" exception reports.
- Voucher attachments (photo/PDF of the bill, stored online).
- Alternate units with conversion (Box = 12 Pcs), serial numbers.
- Custom roles / module-level access (Accountant, Sales, Inventory, Payroll users), hide sensitive fields (rates, salaries).
- Previous-year comparison columns in P&L, Balance Sheet, Trial Balance; funds flow.
- Recent screens, favourites/pinned screens, search screens by name in Ctrl+K; column show/hide and saved list views.
- Archive / deactivate a company, copy a company as a template; bad-debt write-off helper; collection/payment forecast.

**v2.6 — purchase & stock depth**
- Purchase request, payment proposal (what to pay this week), payment hold, purchase price variance, supplier delivery/performance.
- Landed cost / freight allocation to items, bins inside godowns, transfer orders and stock in transit, lead time + suggested purchase order.
- Stock ageing buckets, negative-stock "block or warn" setting, warranty and batch recall lookup.
- Production order, scrap/by-products, job work, work-in-progress.

**v2.7 — payroll, budgets, branches**
- Attendance (present/absent/leave/overtime, import), configurable pay heads (bonus, reimbursements, loans, arrears), PF/ESI return data.
- Monthly/quarterly budgets for groups and cost centres, revisions, over-budget alerts; project costing (material, labour, committed cost).
- Branches / departments as dimensions, branch-wise series, inter-branch transfers.

**v2.8 — statutory files, documents, operations**
- TDS return data sheets (for the CA's utility), challan register, per-return "filed" status with acknowledgement no. and history (manual — no portal link).
- Invoice template designer (font, page size, margins, columns, watermark, logo upload), share log, expiring secure links.
- Password-protected backup files, pre-restore snapshot + restore report, backup-failed alerts.

**v2.9 — bigger structure**
- Multi-currency (currency master, rates, forex gain/loss), consolidated reports across companies, cross-company search.
- Accounting-firm pack (client task checklist, review, document requests, report pack), POS fast-billing screen with shift closing, sales routes,
  time/milestone billing, a documented public API with keys.

**Needs outside integration (only if the accounts/approvals are arranged):** bank feeds and payment initiation, payment-gateway links,
GST portal / IRP (IRN) / e-way bill APIs, IMS, WhatsApp Business / SMS, CRM / e-commerce / BI connectors.
