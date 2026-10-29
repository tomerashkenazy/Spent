import "server-only";

import type {
  AIProvider,
  CategoryForCategorization,
  CategoryMapping,
  PastCorrection,
  TransactionForCategorization,
} from "../types";
import { buildCategorizationPrompt, SYSTEM_PROMPT } from "../prompts";

// parseResponse picks the first JSON array out of the reply, so wrapping the
// array in an object (Ollama structured outputs need an object root) is fine.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          categoryName: { type: "string" },
          confidence: { type: "integer" },
          isNew: { type: "boolean" },
        },
        required: ["index", "categoryName", "confidence"],
      },
    },
  },
  required: ["results"],
};

function parseConfidence(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.round(n);
  if (clamped < 1 || clamped > 7) return undefined;
  return clamped;
}

export class OllamaProvider implements AIProvider {
  constructor(
    private baseUrl: string,
    private model: string
  ) {}

  async categorize(
    transactions: TransactionForCategorization[],
    categories: CategoryForCategorization[],
    options?: { allowProposals?: boolean; pastCorrections?: PastCorrection[] }
  ): Promise<CategoryMapping[]> {
    const allowProposals = options?.allowProposals ?? false;
    const pastCorrections = options?.pastCorrections ?? [];
    const prompt = buildCategorizationPrompt(
      transactions,
      categories,
      allowProposals,
      pastCorrections
    );

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        stream: false,
        // A schema instead of plain "json": small models in JSON mode can
        // emit whitespace forever and only stop at Ollama's 5 minute limit,
        // blocking every request queued behind them.
        format: RESPONSE_SCHEMA,
        options: {
          temperature: 0,
          num_predict: Math.max(1024, transactions.length * 60),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
    };
    const text = data.message?.content ?? "";

    return parseResponse(text, categories.map((c) => c.name), allowProposals);
  }
}

function parseResponse(
  text: string,
  validCategories: string[],
  allowProposals: boolean
): CategoryMapping[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed: unknown[] = JSON.parse(jsonMatch[0]);
    const validSet = new Set(validCategories.map((c) => c.toLowerCase()));
    const results: CategoryMapping[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as Record<string, unknown>).index !== "number" ||
        typeof (item as Record<string, unknown>).categoryName !== "string"
      ) {
        continue;
      }
      const typed = item as {
        index: number;
        categoryName: string;
        confidence?: unknown;
      };
      const name = typed.categoryName.trim();
      const isExisting = validSet.has(name.toLowerCase());
      if (!isExisting && !allowProposals) continue;
      results.push({
        index: typed.index,
        categoryName: name,
        isNew: !isExisting,
        confidence: parseConfidence(typed.confidence),
      });
    }
    return results;
  } catch {
    return [];
  }
}
