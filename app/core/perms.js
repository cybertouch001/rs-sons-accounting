// R&S Sons Accounting - which company actions each role may run.
// Shared by the desktop app (main.js) and the multi-user server, so the rules are the same everywhere.
// viewer = read only · operator = data entry · admin = everything (delete, settings, users)
const READ = new Set(['settings', 'fyList', 'groups', 'ledgers', 'ledger', 'list', 'items', 'item', 'itemInfo', 'priceListItems', 'bom', 'voucher', 'vouchers', 'nextNumber', 'pendingBills', 'pendingOrders', 'ledgerBalance', 'convertVoucher',
  'trialBalance', 'groupSummary', 'profitLoss', 'balanceSheet', 'dayBook', 'ledgerStatement', 'cashBook', 'bankBook', 'register', 'monthlySummary', 'stockSummary', 'itemLedger', 'godownStock', 'batchStock', 'reorderReport', 'slowMoving',
  'itemAnalysis', 'partyAnalysis', 'salesmanReport', 'outstanding', 'interestReport', 'cashFlow', 'ratios', 'budgetReport', 'budgets', 'costCentreReport', 'brs', 'tdsReport', 'depreciationChart', 'payrollCompute', 'payrollRuns', 'salaryRegister',
  'auditLog', 'auditDetail', 'verifyData', 'dashboard', 'gstr1', 'gstr1Json', 'gstr3b', 'gstr3bJson', 'gstSummary', 'einvoiceJson', 'ewayJson', 'stockValuation', 'placeIsInter', 'hsnLookup',
  // v2.0 automation
  'itrProfile', 'itrBooks', 'itrCompute', 'itrSheet', 'gstr2bList', 'gstr2bRecon', 'bankStatements', 'bankLines', 'recurringList', 'recurringDue', 'dueDates', 'taxRules']);
const WRITE = new Set(['saveGroup', 'saveLedger', 'saveSimple', 'savePriceListItems', 'saveBom', 'saveItem', 'saveVoucher', 'duplicateVoucher', 'setVoucherStatus', 'setBankDate', 'saveBudget', 'postDepreciation', 'payrollProcess',
  // v2.0 automation
  'saveItrProfile', 'gstr2bImport', 'bankImport', 'bankRematch', 'bankMatch', 'bankUnmatch', 'bankCreateVoucher', 'saveRecurring', 'runRecurring']);
const ADMIN = new Set(['deleteGroup', 'deleteLedger', 'deleteSimple', 'deleteItem', 'deleteVoucher', 'saveSettings', 'payrollDelete', 'sqlQuery',
  'gstr2bDelete', 'bankDeleteStatement', 'deleteRecurring']);
const RANK = { viewer: 0, operator: 1, admin: 2 };
function roleFor(method) { if (READ.has(method)) return 'viewer'; if (WRITE.has(method)) return 'operator'; if (ADMIN.has(method)) return 'admin'; return null; }
function allowed(userRole, needRole) { return RANK[userRole] != null && RANK[userRole] >= RANK[needRole]; }
module.exports = { READ, WRITE, ADMIN, RANK, roleFor, allowed };
