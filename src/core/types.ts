export type Mode = 'student' | 'business' | 'individual';
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'cost' | 'expense';
export interface Account { code: string; name: string; type: AccountType; nature: 'debit' | 'credit'; parentCode?: string; satCode?: string; }
export interface SourceDocument { id: string; name: string; mime: string; hash: string; importedAt: string; uuid?: string; text?: string; contentBase64?: string; reviewNotes?: string[]; status: 'pending' | 'confirmed' | 'duplicate'; }
export type OperationType = 'purchase' | 'sale' | 'collection' | 'payment' | 'purchase_return' | 'sale_return' | 'expense' | 'contribution' | 'adjustment';
export interface Operation { id: string; date: string; type: OperationType; description: string; amount: string; vatRate: string; paymentMethod: 'cash' | 'bank' | 'credit'; accountCode?: string; counterpartyCode?: string; productId?: string; quantity?: string; unitCost?: string; relatedOperationId?: string; invoiceId?: string; sourceIds: string[]; confirmed: boolean; taxDeductible?: boolean; referenceOnly?: boolean; openingOutstandingBase?: string; }
export interface JournalLine { id: string; accountCode: string; description?: string; debit: string; credit: string; sourceAmount?: 'base' | 'vat' | 'gross' | 'inventory'; }
export interface JournalEntry { id: string; date: string; concept: string; kind: 'opening' | 'income' | 'expense' | 'diary' | 'adjustment'; lines: JournalLine[]; sourceIds: string[]; operationId?: string; }
export interface Issue { id: string; code: string; severity: 'error' | 'warning' | 'info'; title: string; detail: string; location?: string; suggestion: string; sourceId?: string; operationId?: string; }
export interface InventoryLot { id: string; productId: string; date: string; quantity: string; unitCost: string; }
export interface InventoryRow { operationId: string; productId: string; date: string; description: string; incoming: string; outgoing: string; quantity: string; unitCost: string; cost: string; balance: string; }
export interface BankTransaction { id: string; date: string; description: string; amount: string; matchedOperationId?: string; sourceId?: string; }
export interface FixedAsset { id: string; name: string; type: 'depreciation' | 'amortization'; cost: string; residual: string; usefulLifeMonths: number; startDate: string; accountCode: string; expenseAccountCode: string; }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; at: string; proposal?: ChatProposal; }
export interface ChatProposal { kind: 'period' | 'method' | 'operation' | 'note' | 'clarification'; message: string; patch?: Partial<Pick<Project,'period'|'inventorySystem'|'valuation'>>; operation?: Operation; note?: string; }
export interface Revision { id: string; at: string; label: string; snapshot: string; }
export interface Project {
  schemaVersion: 1; id: string; name: string; mode: Mode; period: string; rfc: string; regime: 'school' | '601' | '612';
  inventorySystem: 'analytical' | 'perpetual'; valuation: 'fifo' | 'average'; currency: 'MXN'; jurisdiction: 'MX'; ruleSetId: string;
  accounts: Account[]; documents: SourceDocument[]; operations: Operation[]; manualEntries: JournalEntry[]; inventoryInitial: InventoryLot[];
  bankTransactions: BankTransaction[]; assets: FixedAsset[]; chat: ChatMessage[]; revisions: Revision[]; notes: string[]; closed: boolean;
  taxConfig: { coefficient: string; previousIsr: string; priorTaxableIncome: string; priorDeductions: string; priorRetentions: string; openingBalancesConfirmed: boolean; finalInventory: string; priorPeriodConfirmed?: boolean; vatRetentions?: string; retentionsConfirmed?: boolean; };
  createdAt: string; updatedAt: string;
}
export interface TrialBalanceRow { account: Account; openingDebit: string; openingCredit: string; debit: string; credit: string; balanceDebit: string; balanceCredit: string; }
export interface TaxSummary { vatCollected: string; vatPaid: string; vatDue: string; taxableRevenue: string; deductions: string; isr: string | null; isrBase: string | null; status: 'draft' | 'incomplete'; notes: string[]; }
export interface ProcessingResult {
  entries: JournalEntry[]; trialBalance: TrialBalanceRow[]; inventory: InventoryRow[]; issues: Issue[];
  incomeStatement: { revenue: string; costOfSales: string; expenses: string; profit: string; };
  balanceSheet: { assets: string; liabilities: string; equity: string; profit: string; difference: string; };
  taxes: TaxSummary; bankReconciliation: { ledgerBalance: string; statementBalance: string; difference: string; unmatchedCount: number; };
}
