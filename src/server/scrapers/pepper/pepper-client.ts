import "server-only";

import crypto from "crypto";
import { toLocalISODate } from "@/server/lib/date-utils";
import type { ScrapedAccount, ScrapedTransaction } from "../types";
import { TRANSACTIONS, USER_DATA_V2 } from "./queries";

/**
 * API-direct Pepper (by Bank Leumi) client, ported from
 * eshaham/israeli-bank-scrapers PR #1210 (src/scrapers/pepper.ts), which is
 * not merged upstream yet. It talks to the same endpoints as the Android app:
 *
 *   - Transmit Security identity API (sa.pepper.co.il) for login. The first
 *     login binds a new "device" (an EC P-256 keypair) and needs an SMS OTP.
 *     The keypair, device id and JWT are packed into a persistent token so
 *     later logins only need the password.
 *   - GraphQL (fe-sec.pepper.co.il) for accounts and transactions.
 *
 * Unlike the library's BaseScraper, this returns the refreshed persistent
 * token from every login so the caller can store it.
 */

const IDENTITY_BASE_URL = "https://sa.pepper.co.il";
const GRAPHQL_API_URL = "https://fe-sec.pepper.co.il/graphql";
const AID = "DIGITAL_BLL";
const LOCALE = "en-US";
const APK_VERSION = "11.11.1";
const APP_VERSION_HEADER = "11.11.1-202610131543";
const TS_CLIENT_VERSION = "8.2.3 (10870);[1,2,3,6,7,8,10,11,12,14,28,19,27]";
const SDK_VERSION_METADATA = "8.2.3 (10870)";
const STATIC_AUTH_HEADER =
  "TSToken 7cf2d7a7-681d-450a-ab23-06e48d2b8fd6; tid=digital_client_token_token";
const USER_AGENT = "okhttp/4.12.0";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const TOKEN_FRESHNESS_MARGIN_SECONDS = 60;

const APP_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "com.google.android.c2dm.permission.RECEIVE",
  "com.google.android.gms.permission.AD_ID",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.DOWNLOAD_WITHOUT_NOTIFICATION",
  "android.permission.ACCESS_ADSERVICES_ATTRIBUTION",
  "android.permission.USE_FINGERPRINT",
  "android.permission.USE_BIOMETRIC",
  "android.permission.READ_PROFILE",
  "android.permission.ACCESS_ADSERVICES_AD_ID",
  "android.permission.FOREGROUND_SERVICE",
  "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
  "com.google.android.providers.gsf.permission.READ_GSERVICES",
  "com.pepper.ldb.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
  "android.permission.NFC",
  "android.permission.USE_FULL_SCREEN_INTENT",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.ACCESS_NOTIFICATION_POLICY",
].map((name) => ({ name, granted: true }));

interface PepperPersistentState {
  v: 1;
  deviceId: string;
  clientInstanceId: string;
  ecPrivateKeyPkcs8Base64: string;
  token: string;
}

interface EcSigningBundle {
  privateKey: crypto.KeyObject;
  publicKeyBase64: string;
  keyIdHex: string;
  pkcs8Base64: string;
}

interface PepperAccount {
  accountId: string;
  accountNumber?: string;
  accountCategory?: string | null;
}

interface PepperRawTransaction {
  transactionId?: string | null;
  transactionAmount: number;
  bookingDate: string;
  effectiveDate?: string | null;
  currency?: string | null;
  description?: string | null;
  title?: string | null;
  subTitle?: string | null;
  referenceNumber?: string | null;
  liquidityStatus?: string | null;
}

interface TransmitMethod {
  type?: string;
  assertion_id?: string;
  channels?: Array<{ type?: string; assertion_id?: string }>;
}

interface TransmitResponse {
  data?: {
    challenge?: string;
    token?: string;
    control_flow?: Array<{ type?: string; methods?: TransmitMethod[] }>;
  };
  headers?: Array<Record<string, unknown>>;
  error_message?: string;
}

export interface PepperLoginResult {
  success: boolean;
  errorMessage?: string;
  /** True when the saved device is unusable and a fresh SMS OTP login is required. */
  needsOtp?: boolean;
  /** Updated persistent token. Store it after every successful login. */
  otpLongTermToken?: string;
}

export interface PepperCredentials {
  phoneNumber: string;
  password: string;
}

export function normalizePepperPhone(
  raw: string
): { uid: string; localUserId: string } | null {
  const digits = raw.replace(/\D/g, "");
  if (/^05\d{8}$/.test(digits)) {
    return { uid: `972${digits.slice(1)}`, localUserId: digits };
  }
  if (/^9725\d{8}$/.test(digits)) {
    return { uid: digits, localUserId: `0${digits.slice(3)}` };
  }
  return null;
}

function generateEcP256Bundle(): EcSigningBundle {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const pkcs8Der = privateKey.export({ type: "pkcs8", format: "der" });
  return {
    privateKey,
    publicKeyBase64: publicKeyDer.toString("base64"),
    keyIdHex: crypto.createHash("sha256").update(publicKeyDer).digest("hex"),
    pkcs8Base64: pkcs8Der.toString("base64"),
  };
}

function importEcP256Bundle(pkcs8Base64: string): EcSigningBundle | null {
  try {
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(pkcs8Base64, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const publicKeyDer = crypto
      .createPublicKey(privateKey)
      .export({ type: "spki", format: "der" });
    return {
      privateKey,
      publicKeyBase64: publicKeyDer.toString("base64"),
      keyIdHex: crypto.createHash("sha256").update(publicKeyDer).digest("hex"),
      pkcs8Base64,
    };
  } catch {
    return null;
  }
}

function generateRsa2048PublicKeyBase64(): string {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

export function buildContentSignature(
  pathAndQuery: string,
  bodyJson: string,
  privateKey: crypto.KeyObject,
  keyIdHex: string
): string {
  const qi = pathAndQuery.indexOf("?");
  const sortedPathAndQuery =
    qi < 0
      ? pathAndQuery
      : `${pathAndQuery.slice(0, qi)}?${pathAndQuery
          .slice(qi + 1)
          .split("&")
          .sort((a, b) => a.localeCompare(b))
          .join("&")}`;
  const escapePart = (part: string) => part.split("%%").join("\\%");
  const canonical = [sortedPathAndQuery, TS_CLIENT_VERSION, bodyJson]
    .map(escapePart)
    .join("%%");
  const sigBase64 = crypto
    .sign("sha256", Buffer.from(canonical, "utf8"), {
      key: privateKey,
      dsaEncoding: "der",
    })
    .toString("base64");
  return `data:${sigBase64};key-id:${keyIdHex};scheme:4`;
}

// Device fingerprint the Transmit SDK collects. Copied verbatim from the
// upstream PR; the server accepts this emulator profile.
function buildCollectionResult(nowMs: number) {
  return {
    metadata: {
      scheme_version: 2,
      physical_app_id: "com.pepper.ldb",
      version: SDK_VERSION_METADATA,
      timestamp: Math.floor(nowMs / 1000),
    },
    content: {
      hw_authenticators: {
        device_biometrics: {
          supported: true,
          user_registered: false,
          possible_types: ["fingerprint"],
        },
        fingerprint: { supported: false, user_registered: false },
        face_id: { supported: false, user_registered: false },
      },
      device_details: {
        hw_type: "Phone",
        tampered: true,
        sim_operator: "310260",
        roaming: false,
        device_model: "Google/sdk_gphone64_x86_64",
        os_version: "13",
        jailbroken: true,
        security_patch: "2024-03-01",
        sim_operator_name: "T-Mobile",
        frontal_camera: false,
        device_name: "e71c2b2f5a0cbd94",
        has_hw_security: false,
        screen_lock: false,
        os_type: "Android",
        boot_loader: "unknown",
        base_os: "",
        logged_users: 0,
        persistence_mode: "false",
        last_reboot: 85993,
        tz: "GMT",
        sflags: -3,
        supported_abis: ["x86_64"],
        master_key_generated: nowMs,
      },
      app_permissions: APP_PERMISSIONS,
      capabilities: {
        fido2_user_verifying_platform_authenticator_available: false,
        audio_acquisition_supported: true,
        finger_print_supported: false,
        image_acquisition_supported: true,
        persistent_keys_supported: true,
        face_id_key_bio_protection_supported: false,
        fido2_client_present: true,
        dyadic_present: false,
        installed_plugins: [],
        host_provided_features: "19",
      },
      collector_state: {
        accounts: "active",
        devicedetails: "active",
        contacts: "active",
        owner: "active",
        locationcountry: "active",
        bluetooth: "active",
        externalsdkdetails: "active",
        hwauthenticators: "active",
        capabilities: "active",
        largedata: "active",
        localenrollments: "active",
        devicefingerprint: "active",
        apppermissions: "active",
        software: "disabled",
        location: "disabled",
      },
      local_enrollments: {},
    },
  };
}

export function isJwtFresh(token: string): boolean {
  try {
    const [, payloadPart] = token.split(".");
    if (!payloadPart) return false;
    const payload: unknown = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8")
    );
    const exp = (payload as { exp?: unknown } | null)?.exp;
    if (typeof exp !== "number") return false;
    return exp > Math.floor(Date.now() / 1000) + TOKEN_FRESHNESS_MARGIN_SECONDS;
  } catch {
    return false;
  }
}

export function encodePersistentState(state: PepperPersistentState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodePersistentState(
  encoded: string
): PepperPersistentState | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<PepperPersistentState> | null;
    if (
      parsed?.v === 1 &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.clientInstanceId === "string" &&
      typeof parsed.ecPrivateKeyPkcs8Base64 === "string" &&
      typeof parsed.token === "string"
    ) {
      return parsed as PepperPersistentState;
    }
    return null;
  } catch {
    return null;
  }
}

function extractHeaderField(
  headers: TransmitResponse["headers"],
  key: string
): string | undefined {
  if (!Array.isArray(headers)) return undefined;
  for (const h of headers) {
    const value = h?.[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function firstControlFlowMethods(
  data: TransmitResponse["data"]
): TransmitMethod[] {
  const methods = data?.control_flow?.[0]?.methods;
  return Array.isArray(methods) ? methods : [];
}

function extractPasswordAssertionId(
  data: TransmitResponse["data"]
): string | undefined {
  const pwd = firstControlFlowMethods(data).find((m) => m?.type === "password");
  return typeof pwd?.assertion_id === "string" ? pwd.assertion_id : undefined;
}

function extractSmsAssertionId(
  data: TransmitResponse["data"]
): string | undefined {
  for (const method of firstControlFlowMethods(data)) {
    const sms = method?.channels?.find((ch) => ch?.type === "sms");
    if (typeof sms?.assertion_id === "string") return sms.assertion_id;
  }
  return undefined;
}

export class PepperClient {
  private accessToken?: string;
  private localUserId = "";
  private pepperClientId = crypto.randomUUID();
  private cookies = new Map<string, string>();

  private updateCookies(response: Response) {
    for (const rawCookie of response.headers.getSetCookie()) {
      const [pair] = rawCookie.split(";");
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        this.cookies.set(
          pair.slice(0, eqIdx).trim(),
          pair.slice(eqIdx + 1).trim()
        );
      }
    }
  }

  private async postTransmit(
    pathAndQuery: string,
    bodyObj: Record<string, unknown>,
    ec: EcSigningBundle
  ): Promise<TransmitResponse> {
    const bodyJson = JSON.stringify(bodyObj);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: STATIC_AUTH_HEADER,
      "X-TS-Client-Version": TS_CLIENT_VERSION,
      "User-Agent": USER_AGENT,
      "Content-Signature": buildContentSignature(
        pathAndQuery,
        bodyJson,
        ec.privateKey,
        ec.keyIdHex
      ),
    };
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    const response = await fetch(`${IDENTITY_BASE_URL}${pathAndQuery}`, {
      method: "POST",
      headers,
      body: bodyJson,
    });
    this.updateCookies(response);

    const text = await response.text();
    try {
      return JSON.parse(text) as TransmitResponse;
    } catch {
      throw new Error(
        `Pepper login server returned status ${response.status} with a non-JSON body`
      );
    }
  }

  private async resumeWithSavedState(
    uid: string,
    password: string,
    saved: PepperPersistentState
  ): Promise<PepperLoginResult> {
    if (isJwtFresh(saved.token)) {
      this.accessToken = saved.token;
      return { success: true, otpLongTermToken: encodePersistentState(saved) };
    }

    const ec = importEcP256Bundle(saved.ecPrivateKeyPkcs8Base64);
    if (!ec) {
      return {
        success: false,
        needsOtp: true,
        errorMessage:
          "Saved Pepper device key is invalid; SMS verification is required.",
      };
    }

    this.cookies.clear();
    const flowId = crypto.randomUUID();
    const nowMs = Date.now();
    const loginResp = await this.postTransmit(
      `/api/v2/auth/login?aid=${AID}&did=${saved.deviceId}&locale=${LOCALE}&tsm=${nowMs}`,
      {
        headers: [
          { type: "flow_id", flow_id: flowId },
          { type: "uid", uid },
        ],
        data: {
          collection_result: buildCollectionResult(nowMs),
          policy_request_id: "default",
          params: {
            CellPhoneID: saved.clientInstanceId,
            Version_App: APK_VERSION,
            transactionId: crypto.randomUUID(),
          },
        },
      },
      ec
    );

    const challenge = loginResp?.data?.challenge;
    const pwdAction = loginResp?.data?.control_flow?.[0]?.type || "authentication";
    const pwdAssertionId = extractPasswordAssertionId(loginResp?.data);
    const sessionId = extractHeaderField(loginResp?.headers, "session_id");

    if (!challenge || !pwdAssertionId || !sessionId) {
      return {
        success: false,
        needsOtp: true,
        errorMessage:
          loginResp?.error_message ||
          "Saved Pepper device session was rejected; SMS verification is required.",
      };
    }

    const assertMs = Date.now();
    const assertResp = await this.postTransmit(
      `/api/v2/auth/assert?aid=${AID}&did=${saved.deviceId}&sid=${sessionId}&locale=${LOCALE}&tsm=${assertMs}`,
      {
        headers: [
          { type: "flow_id", flow_id: flowId },
          { type: "uid", uid },
        ],
        data: {
          action: pwdAction,
          assert: "authenticate",
          assertion_id: pwdAssertionId,
          fch: challenge,
          data: { password },
          method: "password",
        },
      },
      ec
    );

    const token = assertResp?.data?.token;
    if (!token) {
      return {
        success: false,
        errorMessage:
          assertResp?.error_message || "Pepper rejected the password.",
      };
    }

    this.accessToken = token;
    return {
      success: true,
      otpLongTermToken: encodePersistentState({ ...saved, token }),
    };
  }

  /** Password-only login using a token saved by a previous OTP login. */
  async loginWithToken(
    creds: PepperCredentials,
    otpLongTermToken: string
  ): Promise<PepperLoginResult> {
    const normalized = normalizePepperPhone(creds.phoneNumber || "");
    if (!normalized) {
      return {
        success: false,
        errorMessage: "A valid Israeli mobile phone number is required for Pepper.",
      };
    }
    this.localUserId = normalized.localUserId;

    const savedState = decodePersistentState(otpLongTermToken);
    if (!savedState) {
      return {
        success: false,
        needsOtp: true,
        errorMessage:
          "Saved Pepper token is unreadable; SMS verification is required.",
      };
    }
    return this.resumeWithSavedState(
      normalized.uid,
      creds.password,
      savedState
    );
  }

  /** Binds a new device: password, then the SMS code from `awaitOtp`. */
  async loginWithOtp(
    creds: PepperCredentials,
    awaitOtp: () => Promise<string>
  ): Promise<PepperLoginResult> {
    const normalized = normalizePepperPhone(creds.phoneNumber || "");
    if (!normalized) {
      return {
        success: false,
        errorMessage: "A valid Israeli mobile phone number is required for Pepper.",
      };
    }
    this.localUserId = normalized.localUserId;

    this.cookies.clear();
    const ec = generateEcP256Bundle();
    const rsaPublicKeyBase64 = generateRsa2048PublicKeyBase64();
    const clientInstanceId = crypto.randomUUID();
    const flowId = crypto.randomUUID();
    const uidHeaders = [
      { type: "flow_id", flow_id: flowId },
      { type: "uid", uid: normalized.uid },
    ];

    const bindMs = Date.now();
    const bindResp = await this.postTransmit(
      `/api/v2/auth/bind?aid=${AID}&locale=${LOCALE}&tsm=${bindMs}`,
      {
        headers: uidHeaders,
        data: {
          collection_result: buildCollectionResult(bindMs),
          public_key: { key: ec.publicKeyBase64, type: "ec" },
          encryption_public_key: { key: rsaPublicKeyBase64, type: "rsa" },
          params: {
            CellPhoneID: clientInstanceId,
            Version_App: APK_VERSION,
            transactionId: crypto.randomUUID(),
          },
        },
      },
      ec
    );

    const challenge = bindResp?.data?.challenge;
    const pwdAssertionId = extractPasswordAssertionId(bindResp?.data);
    const sessionId = extractHeaderField(bindResp?.headers, "session_id");
    const deviceId = extractHeaderField(bindResp?.headers, "device_id");

    if (!challenge || !pwdAssertionId || !sessionId || !deviceId) {
      return {
        success: false,
        errorMessage:
          bindResp?.error_message || "Failed to start the Pepper login.",
      };
    }

    const pwdMs = Date.now();
    const pwdResp = await this.postTransmit(
      `/api/v2/auth/assert?aid=${AID}&did=${deviceId}&sid=${sessionId}&locale=${LOCALE}&tsm=${pwdMs}`,
      {
        headers: uidHeaders,
        data: {
          action: "authentication",
          assert: "authenticate",
          assertion_id: pwdAssertionId,
          fch: challenge,
          data: { password: creds.password },
          method: "password",
        },
      },
      ec
    );

    const smsAssertionId = extractSmsAssertionId(pwdResp?.data);
    if (!smsAssertionId) {
      return {
        success: false,
        errorMessage:
          pwdResp?.error_message ||
          "Pepper rejected the phone number or password.",
      };
    }

    const otpCode = await awaitOtp();

    const otpMs = Date.now();
    const otpResp = await this.postTransmit(
      `/api/v2/auth/assert?aid=${AID}&did=${deviceId}&sid=${sessionId}&locale=${LOCALE}&tsm=${otpMs}`,
      {
        headers: uidHeaders,
        data: {
          action: "authentication",
          assert: "authenticate",
          assertion_id: smsAssertionId,
          fch: challenge,
          data: { otp: otpCode },
          method: "otp",
        },
      },
      ec
    );

    const token = otpResp?.data?.token;
    if (!token) {
      return {
        success: false,
        errorMessage:
          otpResp?.error_message || "Pepper rejected the verification code.",
      };
    }

    this.accessToken = token;
    return {
      success: true,
      otpLongTermToken: encodePersistentState({
        v: 1,
        deviceId,
        clientInstanceId,
        ecPrivateKeyPkcs8Base64: ec.pkcs8Base64,
        token,
      }),
    };
  }

  private async queryGraphql<TResult>(
    queryname: string,
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<TResult> {
    const response = await fetch(GRAPHQL_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        authorization: this.accessToken || "",
        "x-pepper-id": this.pepperClientId,
        "x-user-id": this.localUserId,
        appversion: APP_VERSION_HEADER,
        queryname,
        "x-transaction-id": crypto.randomUUID(),
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await response.text();
    let parsed: { data?: TResult; errors?: Array<{ message: string }> };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Pepper API returned status ${response.status} with a non-JSON body`
      );
    }

    if (parsed.errors?.length) {
      throw new Error(parsed.errors[0].message);
    }
    if (!parsed.data) {
      throw new Error(`Pepper API returned no data for ${queryname}`);
    }
    return parsed.data;
  }

  private async fetchAccountTransactions(
    account: PepperAccount,
    from: string,
    to: string
  ): Promise<ScrapedAccount> {
    const transactions: ScrapedTransaction[] = [];
    const seenIds = new Set<string>();
    const push = (raw: PepperRawTransaction, status: "completed" | "pending") => {
      const txn = mapPepperTransaction(raw, status);
      const key = txn.identifier ? `${status}:${txn.identifier}` : "";
      if (key && seenIds.has(key)) return;
      if (key) seenIds.add(key);
      transactions.push(txn);
    };

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const txnData = await this.queryGraphql<{
        accounts?: {
          oshTransactionsNew?: {
            totalCount?: number;
            transactions?: PepperRawTransaction[];
            pendingTransactions?: PepperRawTransaction[];
          };
        };
      }>("Transactions", TRANSACTIONS, {
        accountId: account.accountId,
        from,
        to,
        pageNumber,
        pageCount: PAGE_SIZE,
      });

      const osh = txnData.accounts?.oshTransactionsNew;
      const posted = osh?.transactions ?? [];

      // Pending transactions are returned in full on every page.
      if (pageNumber === 1) {
        for (const raw of osh?.pendingTransactions ?? []) push(raw, "pending");
      }
      for (const raw of posted) push(raw, "completed");

      const totalCount = osh?.totalCount ?? 0;
      if (
        posted.length < PAGE_SIZE ||
        pageNumber * PAGE_SIZE >= totalCount
      ) {
        break;
      }
    }

    transactions.sort(
      (a, b) => new Date(a.date).valueOf() - new Date(b.date).valueOf()
    );

    return {
      accountNumber: account.accountNumber || account.accountId,
      transactions,
    };
  }

  async fetchAccounts(startDate: Date): Promise<ScrapedAccount[]> {
    if (!this.accessToken) {
      throw new Error("Pepper login() was not called");
    }

    // The app API only serves up to one year back.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    oneYearAgo.setDate(oneYearAgo.getDate() + 1);
    const effectiveStart = startDate > oneYearAgo ? startDate : oneYearAgo;
    const from = toLocalISODate(effectiveStart);
    const to = toLocalISODate(new Date());

    const userData = await this.queryGraphql<{
      userDataV2?: {
        getUserDataV2?: {
          customerAndAccounts?: Array<{
            customerId?: string;
            accounts?: PepperAccount[];
          }>;
        };
      };
    }>("UserDataV2", USER_DATA_V2);

    const customers =
      userData.userDataV2?.getUserDataV2?.customerAndAccounts ?? [];
    const shekelAccounts = customers
      .flatMap((c) => c.accounts ?? [])
      .filter(
        (acct) =>
          !acct.accountCategory?.trim() || acct.accountCategory === "Ils"
      );

    return Promise.all(
      shekelAccounts.map((account) =>
        this.fetchAccountTransactions(account, from, to)
      )
    );
  }
}

export function mapPepperTransaction(
  raw: PepperRawTransaction,
  status: "completed" | "pending"
): ScrapedTransaction {
  const amount = Number(raw.transactionAmount);
  const currency = raw.currency || "ILS";
  return {
    type: "normal",
    identifier: raw.transactionId || raw.referenceNumber || undefined,
    date: raw.bookingDate,
    processedDate: raw.effectiveDate || raw.bookingDate,
    originalAmount: amount,
    originalCurrency: currency,
    chargedAmount: amount,
    chargedCurrency: currency,
    description: (raw.title || raw.description || "").trim(),
    memo: raw.subTitle || undefined,
    status,
  };
}
