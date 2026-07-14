"use strict";

const { THEME_RULES } = require("./chain_map_search_effort");

const DEFAULT_PARAMS = {
  B0: 20,
  lambda: 3,
  B_min: 8,
  recency_weight: 1.2,
  stack_summary_stages: ["D4", "D5"],
  stack_summary_max_chars: 50
};

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function themeNames(text) {
  const joined = String(text || "");
  return THEME_RULES
    .filter(([, pattern]) => pattern.test(joined))
    .map(([name]) => name);
}

function truncate(text, maxChars) {
  const raw = String(text || "");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, Math.max(0, maxChars - 1))}…`;
}

function summarizeStackRecord(record, maxChars) {
  return {
    point: record.point,
    summary: truncate(record.summary, maxChars)
  };
}

function stackTexts(stack) {
  return (stack || []).map((record) => ({
    point: record.point,
    summary: String(record.summary || "")
  }));
}

class BandwidthLayer {
  constructor(options = {}) {
    if (!options.embeddingService) throw new Error("BandwidthLayer requires embeddingService");
    this.embeddingService = options.embeddingService;
    this.params = { ...DEFAULT_PARAMS, ...(options.params || {}) };
    this.vectorCache = new Map();
  }

  budgetFor(stackLen) {
    return Math.max(
      Number(this.params.B_min),
      Number(this.params.B0) - Number(this.params.lambda) * Number(stackLen || 0)
    );
  }

  async embedCached(key, text) {
    if (!this.vectorCache.has(key)) {
      this.vectorCache.set(key, await this.embeddingService.embed(String(text || "")));
    }
    return this.vectorCache.get(key);
  }

  buildFocusText(stage, taskDescription, stack) {
    const latest = (stack || []).slice(-1)[0];
    return [
      `stage=${stage}`,
      String(taskDescription || "").trim(),
      latest?.summary ? `最近一条栈摘要：${latest.summary}` : ""
    ].filter(Boolean).join("\n");
  }

  summarizeStack(stage, stack) {
    const before = stackTexts(stack);
    const shouldSummarize = new Set(this.params.stack_summary_stages || []).has(stage);
    const after = shouldSummarize
      ? before.map((record) => summarizeStackRecord(record, Number(this.params.stack_summary_max_chars || 50)))
      : before.map((record) => ({ ...record }));
    return {
      applied: shouldSummarize,
      before,
      after
    };
  }

  async scoreMapItems(persona, focusText, stack) {
    const focusVec = await this.embedCached(`focus:${focusText}`, focusText);
    const recentText = (stack || []).slice(-2).map((record) => record.summary).join("\n");
    const recentThemes = themeNames(recentText);
    const recentThemeSet = new Set(recentThemes);
    const rows = [];

    for (let index = 0; index < (persona.map_items || []).length; index += 1) {
      const item = persona.map_items[index];
      const text = `${item.id} ${item.type} ${item.content}`;
      const itemVec = await this.embedCached(`map:${persona.id}:${item.id}`, text);
      const baseSimilarity = cosine(focusVec, itemVec);
      const itemThemes = themeNames(text);
      const recencyMatchedThemes = itemThemes.filter((theme) => recentThemeSet.has(theme));
      const boosted = recencyMatchedThemes.length > 0;
      const weightedSimilarity = boosted
        ? baseSimilarity * Number(this.params.recency_weight || 1)
        : baseSimilarity;
      rows.push({
        id: item.id,
        type: item.type,
        content_preview: truncate(item.content, 96),
        original_index: index,
        themes: itemThemes,
        recency_matched_themes: recencyMatchedThemes,
        base_similarity: Number(baseSimilarity.toFixed(6)),
        weighted_similarity: Number(weightedSimilarity.toFixed(6)),
        recency_boost_applied: boosted
      });
    }

    rows.sort((left, right) => {
      if (right.weighted_similarity !== left.weighted_similarity) {
        return right.weighted_similarity - left.weighted_similarity;
      }
      return left.original_index - right.original_index;
    });
    rows.forEach((row, index) => {
      row.rank = index + 1;
    });
    return { rows, recentThemes };
  }

  async prepare({ persona, stage, stack = [], taskDescription = "", callId = stage }) {
    const budgetRaw = this.budgetFor(stack.length);
    const budget = Math.min((persona.map_items || []).length, budgetRaw);
    const focusText = this.buildFocusText(stage, taskDescription, stack);
    const { rows, recentThemes } = await this.scoreMapItems(persona, focusText, stack);
    const selectedIds = new Set(rows.slice(0, budget).map((row) => row.id));
    const itemById = new Map((persona.map_items || []).map((item) => [item.id, item]));
    const selectedItems = rows
      .filter((row) => selectedIds.has(row.id))
      .sort((left, right) => left.original_index - right.original_index)
      .map((row) => itemById.get(row.id))
      .filter(Boolean);

    const mapAuditRows = rows.map((row) => {
      const selected = selectedIds.has(row.id);
      let omittedReason = "";
      if (!selected) {
        omittedReason = row.weighted_similarity <= 0 ? "低相关" : "预算外";
      }
      return {
        ...row,
        selected,
        omitted_reason: omittedReason
      };
    });
    const stackAudit = this.summarizeStack(stage, stack);
    const promptStack = stackAudit.after.map((record) => ({ ...record }));

    return {
      persona: {
        ...persona,
        map_items: selectedItems
      },
      stack: promptStack,
      audit: {
        call_id: callId,
        stage,
        task_description: taskDescription,
        focus_text: focusText,
        stack_len: stack.length,
        budget_formula: "B=max(B_min,B0-lambda*stack_len)",
        B: budget,
        B_raw: budgetRaw,
        map_total: (persona.map_items || []).length,
        selected_ids: Array.from(selectedIds),
        omitted_count: Math.max(0, (persona.map_items || []).length - selectedIds.size),
        recent_themes: recentThemes,
        map_items: mapAuditRows,
        stack_summary: stackAudit
      }
    };
  }
}

module.exports = {
  DEFAULT_PARAMS,
  BandwidthLayer,
  themeNames,
  truncate,
  summarizeStackRecord
};
