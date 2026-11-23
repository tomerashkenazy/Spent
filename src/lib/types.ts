export interface Workspace {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: number;
  accountNumber: string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency: string | null;
  description: string;
  memo: string | null;
  type: "normal" | "installments";
  status: "completed" | "pending";
  identifier: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  categoryId: number | null;
  categorySource: "ai" | "user" | null;
  aiConfidence: number | null;
  provider: string;
  credentialId: number | null;
  accountLabel: string | null;
  syncRunId: number;
  kind: "expense" | "income" | "transfer";
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionWithCategory extends Transaction {
  categoryName: string | null;
  categoryColor: string | null;
  isExcluded: boolean;
  /** The project this transaction is assigned to, if any. */
  projectId: number | null;
  projectName: string | null;
}

export type ProjectItemStatus = "unpaid" | "deposit" | "paid";

export const PROJECT_ITEM_STATUSES: readonly ProjectItemStatus[] = [
  "paid",
  "deposit",
  "unpaid",
];

export interface Project {
  id: number;
  name: string;
  budgetAmount: number | null;
  /** When true, linked transactions are left out of monthly spending. */
  excludesFromSpending: boolean;
  /** Paid in full or as a deposit. */
  spent: number;
  /** Committed but not paid yet. */
  unpaid: number;
  itemCount: number;
  createdAt: string;
}

export interface ProjectItem {
  id: number;
  projectId: number;
  /** Set when the row comes from a synced transaction. */
  transactionId: number | null;
  date: string;
  description: string;
  /** Positive number = money spent. */
  amount: number;
  paidFromCredentialId: number | null;
  /** Label of the connected account it was paid from. */
  paidFromLabel: string | null;
  /** Free-text payer for money outside connected accounts (cash, gifts). */
  paidFromText: string | null;
  category: string | null;
  status: ProjectItemStatus;
  notes: string | null;
}

export interface ProjectItemInput {
  date?: string;
  description?: string;
  amount?: number;
  paidFromCredentialId?: number | null;
  paidFromText?: string | null;
  category?: string | null;
  status?: ProjectItemStatus;
  notes?: string | null;
}

export interface ProjectInput {
  name?: string;
  budgetAmount?: number | null;
  excludesFromSpending?: boolean;
}

export type CategoryKind = "expense" | "income";

export type BudgetMode = "budgeted" | "tracking";

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  color: string;
  icon: string | null;
  kind: CategoryKind;
  budgetMode: BudgetMode;
  description: string | null;
}

export type CategoryViewMode = "collapsed" | "expanded";

export type BudgetSource = "own" | "rollup" | "leaf";

export interface SyncRun {
  id: number;
  provider: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed";
  errorMessage: string | null;
  transactionsAdded: number;
  transactionsUpdated: number;
  scrapeFromDate: string;
  createdAt: string;
}

export interface MonthlySummary {
  month: string;
  amount: number;
}

export interface MerchantSummary {
  name: string;
  amount: number;
  count: number;
}

export interface CategoryBreakdown {
  categoryId: number;
  name: string;
  color: string;
  amount: number;
  count: number;
}

export type BudgetStatus =
  | "plenty-left"
  | "on-track"
  | "heads-up"
  | "over";

export interface CategoryWithData {
  categoryId: number;
  parentId: number | null;
  parentName: string | null;
  isParent: boolean;
  budgetSource: BudgetSource;
  childCount?: number;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string | null;
  budgetMode: BudgetMode;
  spent: number;
  transactionCount: number;
  topMerchant: string | null;
  budget: number;
  isAutoBudget: boolean;
  vsLastMonth: number | null;
  remaining: number;
  perDayRemaining: number | null;
  percentSpent: number;
  status: BudgetStatus;
  needsReviewCount: number;
  vsTypical: { typical: number; percentDiff: number } | null;
}

export interface DashboardSummary {
  periodTotal: number;
  transactionCount: number;
  monthlySpend: MonthlySummary[];
  topMerchants: MerchantSummary[];
  categoryBreakdown: CategoryBreakdown[];
  categoriesWithData: CategoryWithData[];
  totalBudget: number;
  budgetedSpent: number;
  overallPercentSpent: number;
  timeElapsedPercent: number;
  daysUntilPayday: number;
  paydayDay: number;
  todayLabel: string;
  monthLabel: string;
  pacePhrase: string;
  typicalMonthly: number | null;
}

export interface Budget {
  categoryId: number;
  monthlyAmount: number;
  isAuto: boolean;
}

export type HomeSection =
  | "thisMonth"
  | "cashFlow"
  | "categorySnapshot"
  | "historicalTrend"
  | "recentTransactions"
  | "topMerchants"
  | "needsAttention"
  | "bankHealth";

export interface HomeThisMonth {
  spent: number;
  budget: number;
  deltaVsLastMonth: number | null;
  pacePhrase: string;
  daysUntilPayday: number;
  timeElapsedPercent: number;
  monthLabel: string;
}

export interface HomeCashFlow {
  income: number;
  expenses: number;
  net: number;
}

export interface HomeCategorySnapshotItem {
  categoryId: number;
  name: string;
  color: string;
  spent: number;
  budget: number;
  percentSpent: number;
}

export interface HomeHistoricalTrendPoint {
  month: string;
  label: string;
  total: number;
  isCurrent: boolean;
}

export interface HomeRecentTransaction {
  id: number;
  date: string;
  description: string;
  chargedAmount: number;
  chargedCurrency: string | null;
  kind: "expense" | "income" | "transfer";
  categoryName: string | null;
  categoryColor: string | null;
}

export interface HomeTopMerchant {
  name: string;
  total: number;
  count: number;
}

export interface HomeNeedsAttention {
  uncategorized: number;
  lowConfidence: number;
  flagged: number;
}

export interface HomeBankHealthItem {
  provider: string;
  providerName: string;
  lastSyncAt: string | null;
  status: "ok" | "stale" | "error" | "never";
  errorMessage: string | null;
}

export interface HomeSectionError {
  section: HomeSection;
  message: string;
}

export interface HomePayload {
  thisMonth: HomeThisMonth | null;
  cashFlow: HomeCashFlow | null;
  categorySnapshot: HomeCategorySnapshotItem[] | null;
  historicalTrend: HomeHistoricalTrendPoint[] | null;
  recentTransactions: HomeRecentTransaction[] | null;
  topMerchants: HomeTopMerchant[] | null;
  needsAttention: HomeNeedsAttention | null;
  bankHealth: HomeBankHealthItem[] | null;
  nextScheduledSync: string | null;
  errors: HomeSectionError[];
}

export type InvestmentKind =
  | "brokerage"
  | "pension"
  | "gemel"
  | "hishtalmut"
  | "gemel_lehashkaa";

/**
 * The Investments page has two screens. `investments` holds money the user
 * can reach (brokerage, gemel lehashkaa); `savings` holds retirement and
 * study funds (pension, kupat gemel, keren hishtalmut).
 */
export type InvestmentGroup = "investments" | "savings";

export const INVESTMENT_GROUPS: Record<InvestmentGroup, readonly InvestmentKind[]> = {
  investments: ["brokerage", "gemel_lehashkaa"],
  savings: ["pension", "hishtalmut", "gemel"],
};

export function investmentGroup(kind: InvestmentKind): InvestmentGroup {
  return INVESTMENT_GROUPS.savings.includes(kind) ? "savings" : "investments";
}

export interface InvestmentHolding {
  symbol: string | null;
  name: string;
  quantity: number | null;
  price: number | null;
  value: number;
  currency: string;
  changePct: number | null;
  profitLoss: number | null;
}

export interface InvestmentAccount {
  id: number;
  credentialId: number;
  credentialLabel: string;
  provider: string;
  externalId: string;
  kind: InvestmentKind;
  name: string;
  currency: string;
  asOf: string;
  totalValue: number;
  cashValue: number | null;
  /** Total of the previous snapshot, for the change since the last sync. */
  previousValue: number | null;
  previousAsOf: string | null;
  monthlyDeposit: number | null;
  ytdReturnPct: number | null;
  mgmtFeeDepositPct: number | null;
  mgmtFeeBalancePct: number | null;
  holdings: InvestmentHolding[];
}

export interface InvestmentHistoryPoint {
  date: string;
  investments: number;
  savings: number;
  total: number;
}

export type InvestmentsSection = "accounts" | "history";

export interface InvestmentsPayload {
  accounts: InvestmentAccount[] | null;
  history: InvestmentHistoryPoint[] | null;
  errors: { section: InvestmentsSection; message: string }[];
}

export type SyncKind = "manual" | "scheduled";

export interface ActivitySnapshot {
  sync: {
    active: boolean;
    since: string | null;
    kind: SyncKind | null;
    stale: boolean;
  };
  scheduler: {
    armed: boolean;
    nextRunAt: string | null;
  };
  ollama: {
    running: boolean;
    spawnedBySpent: boolean;
  };
}

export interface Integration {
  id: number;
  provider: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
  transactionCount: number;
  /** True when the user has flagged this bank as needing manual 2FA (showBrowser fallback). */
  requiresManualTwoFactor: boolean;
  /** True when a long-term OTP token is already stored (programmatic 2FA banks only). */
  hasTwoFactorToken: boolean;
}

export interface SetupStatus {
  isConfigured: boolean;
  hasBankCredentials: boolean;
  hasAIProvider: boolean;
}

export interface AppSettings {
  monthsToSync: number;
  aiProvider: "claude" | "ollama" | "none";
  ollamaUrl: string;
  ollamaModel: string;
  showBrowser: boolean;
  paydayDay: number;
  monthlyTarget: number | null;
  autoSyncEnabled: boolean;
  autoSyncTime: string;
  language: "en" | "he";
  /** Which browser opens visible login windows. Global, not per workspace. */
  loginBrowser: LoginBrowser;
  /** Read-only: whether a Firefox install was found on this machine. */
  firefoxInstalled: boolean;
}

export type LoginBrowser = "chrome" | "firefox";

export type BankProvider =
  | "isracard"
  | "cal"
  | "max"
  | "amex"
  | "hapoalim"
  | "leumi"
  | "mizrahi"
  | "discount"
  | "mercantile"
  | "beinleumi"
  | "otsarHahayal"
  | "union"
  | "pagi"
  | "yahav"
  | "massad"
  | "beyahadBishvilha"
  | "behatsdaa"
  | "oneZero"
  | "pepper"
  | "psagot"
  | "harel"
  | "menora"
  | "analyst"
  | "more";

export interface CredentialField {
  key: string;
  label: string;
  type: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  exactLength?: number;
  numeric?: boolean;
}

/** "investment" providers return portfolios only, no transactions. */
export type BankKind = "bank" | "card" | "investment";

export interface BankProviderInfo {
  id: BankProvider;
  name: string;
  kind: BankKind;
  color: string;
  blurb: string;
  /** Domain used to fetch the favicon logo via Google's S2 API. */
  domain: string;
  credentialFields: CredentialField[];
  enabled: boolean;
  /**
   * True when the underlying scraper supports OTP-driven login flows that we
   * can drive in-process (OneZero, Pepper, Hapoalim, Psagot and the pension
   * portals). Leumi/etc. expose
   * the methods on the base interface but no concrete implementation, so 2FA
   * on those banks falls back to the manual (showBrowser) path.
   */
  supportsProgrammaticTwoFactor?: boolean;
  /** Replaces the default "SMS once, then a saved token" 2FA explanation. */
  twoFactorNote?: string;
}

export interface OllamaModelInfo {
  name: string;
  /** Display name, for models whose pullable name is a long hf.co path. */
  label?: string;
  sizeGb: number;
  description: string;
  recommended?: boolean;
}

export const RECOMMENDED_OLLAMA_MODELS: OllamaModelInfo[] = [
  {
    name: "llama3.2:3b",
    sizeGb: 2.0,
    description: "Recommended. Fast and accurate enough for categorizing.",
    recommended: true,
  },
  {
    name: "llama3.2:1b",
    sizeGb: 1.3,
    description: "Smallest and fastest. Slightly less accurate.",
  },
  {
    name: "llama3.1:8b",
    sizeGb: 4.7,
    description: "Higher quality, slower, larger download.",
  },
  {
    name: "qwen2.5:3b",
    sizeGb: 1.9,
    description: "Alternative 3B model from Alibaba.",
  },
  {
    name: "hf.co/dicta-il/DictaLM-3.0-Nemotron-12B-Instruct-GGUF:Q4_K_M",
    label: "DictaLM 3.0 12B",
    sizeGb: 7.5,
    description: "Hebrew-first model from Dicta. Best for Hebrew merchant names, slower.",
  },
];

export const BANK_PROVIDERS: BankProviderInfo[] = [
  {
    id: "isracard",
    name: "Isracard",
    kind: "card",
    color: "#E50019",
    blurb: "Israeli Mastercard / Visa",
    domain: "isracard.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        hint: "Your 9-digit Israeli national ID (Teudat Zehut). Not your card number.",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "card6Digits",
        label: "Last 6 Digits of Your Card",
        type: "text",
        placeholder: "e.g. 123456",
        hint: "The last 6 digits of your Isracard credit card number. This is NOT your ID.",
        exactLength: 6,
        numeric: true,
      },
      {
        key: "password",
        label: "Isracard Password",
        type: "password",
        placeholder: "Password you use on digital.isracard.co.il",
        hint: "The same password you use to log in on the Isracard website.",
      },
    ],
    enabled: true,
  },
  {
    id: "cal",
    name: "Visa Cal",
    kind: "card",
    color: "#1B4E97",
    blurb: "Cal-branded cards",
    domain: "cal-online.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "max",
    name: "Max",
    kind: "card",
    color: "#FF6B00",
    blurb: "Formerly Leumi Card",
    domain: "max.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "hapoalim",
    name: "Bank Hapoalim",
    kind: "bank",
    color: "#E2231A",
    blurb: "Includes Poalim wallets and securities",
    domain: "bankhapoalim.co.il",
    credentialFields: [
      { key: "userCode", label: "User Code", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
  },
  {
    id: "leumi",
    name: "Bank Leumi",
    kind: "bank",
    color: "#1976A4",
    blurb: "Personal & business accounts, plus securities",
    domain: "leumi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "mizrahi",
    name: "Mizrahi Tefahot",
    kind: "bank",
    color: "#0066B3",
    blurb: "Personal & mortgage banking",
    domain: "mizrahi-tefahot.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "discount",
    name: "Bank Discount",
    kind: "bank",
    color: "#2E9C5C",
    blurb: "Personal & business accounts",
    domain: "discountbank.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
      {
        key: "num",
        label: "Identifier Code",
        type: "text",
        placeholder: "Your קוד מזהה",
        hint: "The 'קוד מזהה' you set up for Discount online banking. May contain letters and numbers, not the same as your account number.",
      },
    ],
    enabled: true,
  },
  {
    id: "mercantile",
    name: "Mercantile Discount",
    kind: "bank",
    color: "#1B6A3C",
    blurb: "Discount-owned subsidiary",
    domain: "mercantile.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
      {
        key: "num",
        label: "Identifier Code",
        type: "text",
        placeholder: "Your קוד מזהה",
        hint: "The 'קוד מזהה' you set up for Mercantile online banking. May contain letters and numbers, not the same as your account number.",
      },
    ],
    enabled: true,
  },
  {
    id: "beinleumi",
    name: "First International (FIBI)",
    kind: "bank",
    color: "#C8102E",
    blurb: "Beinleumi / FIBI",
    domain: "fibi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "otsarHahayal",
    name: "Otsar Hahayal",
    kind: "bank",
    color: "#7A1F2B",
    blurb: "FIBI subsidiary (merged 2020)",
    domain: "fibi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "pagi",
    name: "Bank Pagi",
    kind: "bank",
    color: "#9F2241",
    blurb: "Hapoalim's religious-community branch",
    domain: "bankpagi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "yahav",
    name: "Bank Yahav",
    kind: "bank",
    color: "#0F4D8C",
    blurb: "Public-sector employees · 6 months history",
    domain: "bank-yahav.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      {
        key: "nationalID",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "massad",
    name: "Bank Massad",
    kind: "bank",
    color: "#2B5F2B",
    blurb: "Teachers' bank",
    domain: "bankmassad.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "union",
    name: "Union Bank",
    kind: "bank",
    color: "#003F87",
    blurb: "Merged into Mizrahi-Tefahot (2019)",
    domain: "unionbank.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "amex",
    name: "American Express IL",
    kind: "card",
    color: "#006FCF",
    blurb: "Isracard-issued Amex cards",
    domain: "americanexpress.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "card6Digits",
        label: "Last 6 Digits of Your Card",
        type: "text",
        placeholder: "e.g. 123456",
        exactLength: 6,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "beyahadBishvilha",
    name: "Beyahad Bishvilha",
    kind: "card",
    color: "#7E3F8F",
    blurb: "Histadrut benefits / credit",
    domain: "beyahad-bishvilha.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "behatsdaa",
    name: "Behatsdaa",
    kind: "card",
    color: "#6E3A7A",
    blurb: "Histadrut subsidies / credit",
    domain: "behatsdaa.org.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "oneZero",
    name: "One Zero",
    kind: "bank",
    color: "#000000",
    blurb: "Programmatic 2FA via SMS code",
    domain: "onezerobank.com",
    credentialFields: [
      {
        key: "email",
        label: "Email",
        type: "email",
        placeholder: "you@example.com",
        hint: "The email you use to sign in to One Zero.",
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        placeholder: "Your One Zero password",
      },
      {
        key: "phoneNumber",
        label: "Phone number",
        type: "tel",
        placeholder: "+972501234567",
        hint: "Where the SMS one-time code will be sent. International format including the country code.",
      },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
  },
  {
    id: "pepper",
    name: "Pepper",
    kind: "bank",
    color: "#E6007E",
    blurb: "SMS code once, then automatic",
    domain: "pepper.co.il",
    credentialFields: [
      {
        key: "phoneNumber",
        label: "Phone number",
        type: "tel",
        placeholder: "0501234567",
        hint: "The mobile number you sign in to Pepper with. A one-time SMS code is sent to it on the first sync.",
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        placeholder: "Your Pepper password",
      },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
  },
  {
    id: "psagot",
    name: "Psagot",
    kind: "investment",
    color: "#2B2A7A",
    blurb: "Trading account portfolio",
    domain: "psagot.co.il",
    credentialFields: [
      {
        key: "username",
        label: "User name",
        type: "text",
        hint: "The user name you sign in to Psagot Trade with.",
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
    twoFactorNote:
      "Psagot texts a code every time you sign in. Spent keeps the session while Psagot allows it, so a sync soon after another one skips the code. Otherwise enter the code in the sync window.",
  },
  {
    id: "harel",
    name: "Harel",
    kind: "investment",
    color: "#1F5FAD",
    blurb: "Pension, gemel and study funds",
    domain: "harel-group.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "phoneNumber",
        label: "Phone number",
        type: "tel",
        placeholder: "0501234567",
        hint: "The mobile number registered with Harel. The SMS code is sent to it.",
      },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
    twoFactorNote:
      "Harel signs in with an SMS code instead of a password. Spent keeps the session while Harel allows it, so later syncs often skip the code. Otherwise enter the code in the sync window.",
  },
  {
    id: "menora",
    name: "Menora Mivtachim",
    kind: "investment",
    color: "#5B2A86",
    blurb: "Pension, gemel and study funds",
    domain: "menoramivt.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "phoneNumber",
        label: "Phone number",
        type: "tel",
        placeholder: "0501234567",
        hint: "The mobile number registered with Menora. Spent fills it in for you in the sign-in window.",
      },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
    twoFactorNote:
      "Menora's sign-in page has a security check that only a person can pass. When needed, Run Sync now opens a Chrome window with your details filled in: pass the check and enter the SMS code there. Spent keeps the session, so later syncs run without the window until Menora signs you out.",
  },
  {
    id: "analyst",
    name: "Analyst",
    kind: "investment",
    color: "#1E2C6E",
    blurb: "Gemel and study funds",
    domain: "analyst.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "phoneNumber",
        label: "Phone number",
        type: "tel",
        placeholder: "0501234567",
        hint: "The mobile number registered with Analyst. Spent fills it in for you in the sign-in window.",
      },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
    twoFactorNote:
      "Analyst's sign-in has a security check that turns away automated browsers. When needed, Run Sync now opens a window with your details filled in: click \"שלחו לי קוד\" and enter the SMS code there. Spent keeps the session, so later syncs run without the window until Analyst signs you out.",
  },
  {
    id: "more",
    name: "More",
    kind: "investment",
    color: "#E6007E",
    blurb: "Gemel, study and pension funds",
    domain: "more.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "phoneNumber",
        label: "Phone number",
        type: "tel",
        placeholder: "0501234567",
        hint: "The mobile number registered with More. The SMS code is sent to it.",
      },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
    twoFactorNote:
      "More signs in with an SMS code instead of a password. Spent keeps the session while More allows it, so later syncs often skip the code. Otherwise enter the code in the sync window.",
  },
];

export interface ExcludedMerchant {
  id: number;
  provider: string;
  merchantKey: string;
  createdAt: string;
}
