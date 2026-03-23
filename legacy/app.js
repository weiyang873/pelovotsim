const state = {
  activeTeam: null,
  teams: [],
  persistenceMode: "local",
  engineConfig: null
};
const llmUi = {
  busySince: 0,
  timer: null,
  sendBtnText: "↑",
  promptVersionFallback: "",
  bottleneckFallback: "未启动会话"
};
let vpSessionId = "";
const VP_MAX_SCORING_ROUNDS = 3;
let vpReviewState = {
  scoringRounds: 0,
  maxScoringRounds: VP_MAX_SCORING_ROUNDS,
  canContinue: true,
  mustConfirm: false,
  lastAction: "chat"
};
let marketingSessionId = "";
let radarChart = null;
let rdCardCatalog = [];
let rdGridMeta = null;
let rdCompatRules = null;
let rdBudgetCap = 2700;
let rdCapacityCap = 24;
let rdIsCalculating = false;
const rdSelections = new Map();
let rdValidation = { violations: [], soft: null };
const LOCAL_STATE_KEY = "emba_ai_sim_state_v1";

const els = {
  teamName: document.getElementById("team-name"),
  startTeam: document.getElementById("start-team"),
  activeTeam: document.getElementById("active-team"),
  customerType: document.getElementById("customer-type"),
  strategy: document.getElementById("strategy"),
  ageGroup: document.getElementById("age-group"),
  archTag: document.getElementById("arch-tag"),
  fitText: document.getElementById("fit-text"),
  r1Channel1: document.getElementById("r1-channel-1"),
  r1Channel2: document.getElementById("r1-channel-2"),
  r1ChannelShare: document.getElementById("r1-channel-share"),
  r1ChannelShareLabel: document.getElementById("r1-channel-share-label"),
  r1ChannelFeePreview: document.getElementById("r1-channel-fee-preview"),
  r1TargetGm: document.getElementById("r1-target-gm"),
  r1TargetGmLabel: document.getElementById("r1-target-gm-label"),
  r1GmError: document.getElementById("r1-gm-error"),
  freezeTargetGm: document.getElementById("freeze-target-gm"),
  resetRound1: document.getElementById("reset-round1"),
  runRound1: document.getElementById("run-round1"),
  round1Output: document.getElementById("round1-output"),
  llmContext: document.getElementById("llm-context"),
  coachPinnedCard: document.getElementById("coach-pinned-card"),
  coachMessageList: document.getElementById("coach-message-list"),
  coachCreateSession: document.getElementById("coach-create-session"),
  coachUserInput: document.getElementById("coach-user-input"),
  coachSend: document.getElementById("coach-send"),
  coachGenerate: document.getElementById("coach-generate"),
  coachApplyRound1: document.getElementById("coach-apply-round1"),
  llmPain: document.getElementById("llm-pain"),
  llmArchetypes: document.getElementById("llm-archetypes"),
  llmFeatures: document.getElementById("llm-features"),
  llmSummary: document.getElementById("llm-summary"),
  llmApplyRound1: document.getElementById("llm-apply-round1"),
  llmStatus: document.getElementById("llm-status"),
  llmPainOutput: document.getElementById("llm-pain-output"),
  llmArchetypesOutput: document.getElementById("llm-archetypes-output"),
  llmFeaturesTable: document.getElementById("llm-features-table"),
  llmStory30s: document.getElementById("llm-story-30s"),
  llmStory2min: document.getElementById("llm-story-2min"),
  llmSummaryOutput: document.getElementById("llm-summary-output"),
  vpContext: document.getElementById("vp-context"),
  vpSolutionWay: document.getElementById("vp-solution-way"),
  vpHint1: document.getElementById("vp-hint-1"),
  vpHint2: document.getElementById("vp-hint-2"),
  vpFeedback1: document.getElementById("vp-feedback-1"),
  vpFeedback2: document.getElementById("vp-feedback-2"),
  vpLock1: document.getElementById("vp-lock-1"),
  vpLock2: document.getElementById("vp-lock-2"),
  vpGenerate: document.getElementById("vp-generate"),
  vpStepHint: document.getElementById("vp-step-hint"),
  vpHintModal: document.getElementById("vp-hint-modal"),
  vpHintClose: document.getElementById("vp-hint-close"),
  vpSuggestedAnswers: document.getElementById("vp-suggested-answers"),
  vpFinalState: document.getElementById("vp-final-state"),
  vpFeedbackCard: document.getElementById("vp-feedback-card"),
  vpFeedbackChoices: document.getElementById("vp-feedback-choices"),
  vpApplyCandidate: document.getElementById("vp-apply-candidate"),
  vpGenerateOutput: document.getElementById("vp-generate-output"),
  vpEvaluateOutput: document.getElementById("vp-evaluate-output"),
  vpSection: document.getElementById("vp-section"),
  vpCanvasBlock: document.getElementById("vp-canvas-block"),
  vpChatBlock: document.getElementById("vp-chat-block"),
  vpResultBlock: document.getElementById("vp-result-block"),
  vpSubmitCanvasBtn: document.getElementById("vp-submit-canvas-btn"),
  vpChatMessages: document.getElementById("vp-chat-messages"),
  vpChatInput: document.getElementById("vp-chat-input"),
  vpChatSendBtn: document.getElementById("vp-chat-send-btn"),
  vpChatSubmitBtn: document.getElementById("vp-chat-submit-btn"),
  vpCustomerJobs: document.getElementById("vp-customerJobs"),
  vpPains: document.getElementById("vp-pains"),
  vpGains: document.getElementById("vp-gains"),
  vpProducts: document.getElementById("vp-products"),
  vpPainRelievers: document.getElementById("vp-painRelievers"),
  vpGainCreators: document.getElementById("vp-gainCreators"),
  vpPmfDetails: document.getElementById("vp-pmf-details"),
  vpFinalGm: document.getElementById("vp-final-gm"),
  vpCoachFeedback: document.getElementById("vp-coach-feedback"),
  vpResultJson: document.getElementById("vp-result-json"),
  vpContinueBtn: document.getElementById("vp-continue-btn"),
  vpConfirmBtn: document.getElementById("vp-confirm-btn"),
  vpRestartBtn: document.getElementById("vp-restart-btn"),
  vpDownloadBtn: document.getElementById("vp-download-btn"),
  coachPromptVersion: document.getElementById("coach-prompt-version"),
  coachDebugPanel: document.getElementById("coach-debug-panel"),
  coachDebugOutput: document.getElementById("coach-debug-output"),
  frozenGmDisplay: document.getElementById("frozen-gm-display"),
  subscriptionTier: document.getElementById("subscription-tier"),
  complianceTier: document.getElementById("compliance-tier"),
  contentTier: document.getElementById("content-tier"),
  channel1: document.getElementById("channel-1"),
  channel2: document.getElementById("channel-2"),
  personaQuestion: document.getElementById("persona-question"),
  askPersona: document.getElementById("ask-persona"),
  personaAnswer: document.getElementById("persona-answer"),
  featureCards: document.getElementById("feature-cards"),
  runRound2: document.getElementById("run-round2"),
  round2Output: document.getElementById("round2-output"),
  change1: document.getElementById("change-1"),
  change2: document.getElementById("change-2"),
  changeSubTier: document.getElementById("change-sub-tier"),
  changeComplianceTier: document.getElementById("change-compliance-tier"),
  applyIteration: document.getElementById("apply-iteration"),
  iterationLog: document.getElementById("iteration-log"),
  freezeTeam: document.getElementById("freeze-team"),
  refreshDb: document.getElementById("refresh-db"),
  exportDb: document.getElementById("export-db"),
  dbStatus: document.getElementById("db-status"),
  clearAll: document.getElementById("clear-all"),
  teamSummary: document.getElementById("team-summary"),
  rankingBody: document.getElementById("ranking-body"),
  marketingSection: document.getElementById("marketing-section"),
  marketingStartBlock: document.getElementById("marketing-start-block"),
  marketingStartBtn: document.getElementById("marketing-start-btn"),
  marketingStartLoading: document.getElementById("marketing-start-loading"),
  marketingInterviewBlock: document.getElementById("marketing-interview-block"),
  marketingPersonaCard: document.getElementById("marketing-persona-card"),
  marketingTurnCount: document.getElementById("marketing-turn-count"),
  marketingCanEndHint: document.getElementById("marketing-can-end-hint"),
  marketingChatMessages: document.getElementById("marketing-chat-messages"),
  marketingChatInput: document.getElementById("marketing-chat-input"),
  marketingSendBtn: document.getElementById("marketing-send-btn"),
  endInterviewBtn: document.getElementById("end-interview-btn"),
  marketingScoreBlock: document.getElementById("marketing-score-block"),
  marketingTagsDisplay: document.getElementById("marketing-tags-display"),
  marketingRadarChart: document.getElementById("marketing-radar-chart"),
  marketingDimensionDetails: document.getElementById("marketing-dimension-details"),
  marketingDownloadBtn: document.getElementById("marketing-download-btn"),
  marketingProceedRdBtn: document.getElementById("marketing-proceed-rd-btn"),
  panelRound2: document.getElementById("panel-round2"),
  rdBlock: document.getElementById("rd-block"),
  rdStatusBar: document.getElementById("rd-status-bar"),
  rdAlerts: document.getElementById("rd-alerts"),
  totalCount: document.getElementById("total-count"),
  budgetFill: document.getElementById("budget-fill"),
  budgetLabel: document.getElementById("budget-label"),
  capacityFill: document.getElementById("capacity-fill"),
  capacityLabel: document.getElementById("capacity-label"),
  cardCountBadge: document.getElementById("card-count-badge"),
  rdValidateHint: document.getElementById("rd-validate-hint"),
  cardGrid: document.getElementById("card-grid"),
  btnCalculateRd: document.getElementById("btn-calculate-rd"),
  rdSubmitStatus: document.getElementById("rd-submit-status"),
  rdResultBlock: document.getElementById("rd-result-block"),
  rdShare: document.getElementById("rd-share"),
  rdUnits: document.getElementById("rd-units"),
  rdProfit: document.getElementById("rd-profit"),
  rdProfitHw: document.getElementById("rd-profit-hw"),
  rdProfitSub: document.getElementById("rd-profit-sub"),
  rdAttach: document.getElementById("rd-attach"),
  rdFit: document.getElementById("rd-fit"),
  rdCovercore: document.getElementById("rd-covercore"),
  rdCovernice: document.getElementById("rd-covernice"),
  rdEvi: document.getElementById("rd-evi"),
  rdEviDetail: document.getElementById("rd-evi-detail"),
  rdI: document.getElementById("rd-I"),
  rdZ: document.getElementById("rd-z"),
  rdRisk: document.getElementById("rd-risk"),
  rdComplexity: document.getElementById("rd-complexity"),
  rdDcogs: document.getElementById("rd-dcogs"),
  rdLoad: document.getElementById("rd-load"),
  rdBudgetStatus: document.getElementById("rd-budget-status"),
  rdZPenalty: document.getElementById("rd-z-penalty"),
  rdEmoji: document.getElementById("rd-emoji"),
  rdEmojiLabel: document.getElementById("rd-emoji-label"),
  btnAnalysis: document.getElementById("btn-analysis"),
  rdAnalysisContent: document.getElementById("rd-analysis-content"),
  rdAnalysisText: document.getElementById("rd-analysis-text"),
  rdSelectProgressText: document.getElementById("rd-select-progress-text"),
  rdSelectProgressFill: document.getElementById("rd-select-progress-fill"),
  rdPreviewPlaceholder: document.getElementById("rd-preview-placeholder"),
  rdPreviewBars: document.getElementById("rd-preview-bars"),
  rdBarHwValue: document.getElementById("rd-bar-hw-value"),
  rdBarSubValue: document.getElementById("rd-bar-sub-value"),
  rdBarProfitValue: document.getElementById("rd-bar-profit-value"),
  rdBarHwFill: document.getElementById("rd-bar-hw-fill"),
  rdBarSubFill: document.getElementById("rd-bar-sub-fill"),
  rdBarProfitFill: document.getElementById("rd-bar-profit-fill"),
  rdKpiDcogs: document.getElementById("rd-kpi-dcogs"),
  rdKpiPerf: document.getElementById("rd-kpi-perf"),
  rdKpiSublift: document.getElementById("rd-kpi-sublift"),
  rdKpiShare: document.getElementById("rd-kpi-share")
};

function fmt(n) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Math.round(n));
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeCoachDisplayText(text) {
  return String(text || "")
    .replace(/【\s*复述\s*】/g, "")
    .replace(/【\s*critical判断\s*】/gi, "")
    .replace(/【\s*下一步怎么补\s*】/g, "")
    .replace(/【\s*三条可选机制\s*】/g, "")
    .replace(/【\s*请你回复\s*】/g, "")
    .replace(/\[\s*复述\s*\]/g, "")
    .replace(/\[\s*critical判断\s*\]/gi, "")
    .replace(/\[\s*下一步怎么补\s*\]/g, "")
    .replace(/\[\s*三条可选机制\s*\]/g, "")
    .replace(/\[\s*请你回复\s*\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function saveLocalState() {
  try {
    const snapshot = {
      activeTeam: state.activeTeam,
      teams: state.teams
    };
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(snapshot));
  } catch (_) {}
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.activeTeam = parsed?.activeTeam || null;
    state.teams = Array.isArray(parsed?.teams) ? parsed.teams : [];
  } catch (_) {}
}

function refreshActiveTeamHint() {
  if (!state.activeTeam) {
    if (els.activeTeam) els.activeTeam.textContent = "";
    if (els.frozenGmDisplay) els.frozenGmDisplay.textContent = "Frozen target_gm (from Round 1): 未冻结";
    return;
  }
  if (els.activeTeam) els.activeTeam.textContent = `当前小组: ${state.activeTeam.name}`;
  if (state.activeTeam.round1?.isFrozen) {
    if (els.frozenGmDisplay) {
      els.frozenGmDisplay.textContent = `Frozen target_gm (from Round 1): ${(Number(state.activeTeam.round1.targetGm || 0) * 100).toFixed(1)}%`;
    }
  } else {
    if (els.frozenGmDisplay) els.frozenGmDisplay.textContent = "Frozen target_gm (from Round 1): 未冻结";
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mapComplianceTier(value) {
  const map = { basic: "LOW", enhanced: "MID", strong: "HIGH" };
  return map[value] || "LOW";
}

function mapSubTier(value) {
  const map = { lite: "LOW", plus: "MID", pro: "HIGH" };
  return map[value] || "MID";
}

function defaultValueWeights(archTag) {
  const templates = {
    Experience: { emotion: 0.28, intelligence: 0.14, privacy: 0.1, fun: 0.28, value_for_money: 0.1, function: 0.1 },
    Hybrid: { emotion: 0.17, intelligence: 0.2, privacy: 0.15, fun: 0.15, value_for_money: 0.16, function: 0.17 },
    Function: { emotion: 0.08, intelligence: 0.2, privacy: 0.17, fun: 0.05, value_for_money: 0.22, function: 0.28 }
  };
  return templates[archTag] || templates.Hybrid;
}

function mapCustomerTypeToRound1(v) {
  return v === "B2B" ? "ToB" : "ToC";
}

function mapStrategyToRound1(v) {
  return v === "COST" ? "COST" : "DIFF";
}

function mapArchToValueProp(archTag) {
  if (archTag === "Experience") return "体验";
  if (archTag === "Function") return "功能";
  return "混合";
}

function mapChannelNameForLlm(code) {
  if (code === "DIRECT") return "Direct";
  if (code === "DISTRIBUTOR") return "Distributor";
  return "Ecommerce";
}

function cellKey(customerType, strategy, archTag) {
  const strategyZh = strategy === "COST" ? "成本领先" : "差异化";
  const valuePropZh = mapArchToValueProp(archTag);
  return `${customerType}|${strategyZh}|${valuePropZh}`;
}

function ensureActiveTeamForLlm() {
  if (!state.activeTeam) {
    throw new Error("请先开始一个小组。");
  }
  if (!state.activeTeam.round1) {
    throw new Error("请先完成 Round 1 计算以锁定硬约束。");
  }
}

function buildDecisionStateFromForm() {
  if (state.activeTeam?.round1) {
    return {
      customer_type: mapCustomerTypeToRound1(state.activeTeam.round1.customerType),
      strategy: mapStrategyToRound1(state.activeTeam.round1.strategy),
      age_group: state.activeTeam.round1.ageGroup,
      arch_tag: state.activeTeam.round1.archTag,
      channels: [
        {
          name: mapChannelNameForLlm(state.activeTeam.round1.round1Channels[0]),
          share: state.activeTeam.round1.round1ChannelShare[0]
        },
        {
          name: mapChannelNameForLlm(state.activeTeam.round1.round1Channels[1]),
          share: state.activeTeam.round1.round1ChannelShare[1]
        }
      ]
    };
  }
  const r1Channels = round1ChannelsAndShare();
  return {
    customer_type: mapCustomerTypeToRound1(els.customerType.value),
    strategy: mapStrategyToRound1(els.strategy.value),
    age_group: els.ageGroup.value,
    arch_tag: els.archTag.value,
    channels: [
      { name: mapChannelNameForLlm(r1Channels.channels[0]), share: r1Channels.channelShare[0] },
      { name: mapChannelNameForLlm(r1Channels.channels[1]), share: r1Channels.channelShare[1] }
    ]
  };
}

function getSelectedArchetypeFromCache(llmData) {
  const arch = els.archTag.value;
  if (!llmData?.archetypes) return null;
  if (arch === "Experience") return llmData.archetypes.A_experience || null;
  if (arch === "Function") return llmData.archetypes.B_function || null;
  return llmData.archetypes.C_hybrid || null;
}

function llmIdentity() {
  return {
    team_id: state.activeTeam?.id || "",
    team_name: state.activeTeam?.name || ""
  };
}

function coachState() {
  if (!state.activeTeam) return null;
  if (!state.activeTeam.coach) {
    state.activeTeam.coach = {
      sessionId: "",
      chatSession: {
        phase: "CONTEXT",
        context_final: "",
        solution_final: "",
        vp_final: "",
        draft: "",
        last_options: { CONTEXT: [], SOLUTION: [] },
        ready: false
      },
      messages: [],
      lastParsed: null,
      lastMode: "",
      canSubmit: false,
      promptVersion: "",
      bottleneckTitle: "",
      debugPrompt: null
    };
  }
  return state.activeTeam.coach;
}

function resetCoachSessionData(coach, promptVersion) {
  if (!coach || typeof coach !== "object") return;
  coach.sessionId = "";
  coach.chatSession = {
    phase: "CONTEXT",
    context_final: "",
    solution_final: "",
    vp_final: "",
    draft: "",
    last_options: { CONTEXT: [], SOLUTION: [] },
    ready: false
  };
  coach.messages = [];
  coach.lastParsed = null;
  coach.lastMode = "";
  coach.canSubmit = false;
  coach.bottleneckTitle = "";
  coach.debugPrompt = null;
  if (promptVersion) coach.promptVersion = promptVersion;
}

function invalidateCoachByPromptVersion(expectedPromptVersion) {
  if (!expectedPromptVersion) return false;
  let changed = false;
  state.teams.forEach((team) => {
    const coach = team?.coach;
    if (!coach || typeof coach !== "object") return;
    const existing = String(coach.promptVersion || "");
    if (existing && existing !== expectedPromptVersion) {
      resetCoachSessionData(coach, expectedPromptVersion);
      changed = true;
      return;
    }
    if (!existing) {
      coach.promptVersion = expectedPromptVersion;
      changed = true;
    }
  });
  if (state.activeTeam?.coach && String(state.activeTeam.coach.promptVersion || "") !== expectedPromptVersion) {
    resetCoachSessionData(state.activeTeam.coach, expectedPromptVersion);
    changed = true;
  }
  return changed;
}

function renderCoachDebugHeader() {
  if (!els.coachPromptVersion) return;
  const c = state.activeTeam?.coach;
  const prompt = c?.promptVersion || llmUi.promptVersionFallback || "unknown";
  const bottleneck = c?.bottleneckTitle || llmUi.bottleneckFallback || "未启动会话";
  els.coachPromptVersion.textContent = `（prompt: ${prompt}｜瓶颈: ${bottleneck}）`;
}

function renderCoachPromptDebug() {
  if (!els.coachDebugPanel || !els.coachDebugOutput) return;
  const debug = state.activeTeam?.coach?.debugPrompt;
  const hasOld = Boolean(debug?.prompts);
  const hasNew = Boolean(debug?.system_preview || debug?.user_preview);
  if (!hasOld && !hasNew) {
    els.coachDebugPanel.style.display = "none";
    els.coachDebugOutput.textContent = "";
    return;
  }
  els.coachDebugPanel.style.display = "";
  const promptVersion = debug.prompt_version || debug.PROMPT_VERSION || "unknown";
  const systemPreview = debug.prompts?.system_preview || debug.system_preview || "";
  const userPreview = debug.prompts?.user_preview || debug.user_preview || "";
  els.coachDebugOutput.textContent = [
    `PROMPT_VERSION: ${promptVersion}`,
    "",
    "[system_preview]",
    String(systemPreview),
    "",
    "[user_preview]",
    String(userPreview)
  ].join("\n");
}

function renderCoachPinnedCard() {
  if (!els.coachPinnedCard) return;
  const r1 = state.activeTeam?.round1;
  if (!r1) {
    els.coachPinnedCard.textContent = "请先完成 Round 1 计算后再启动 Chat Coach。";
    return;
  }
  const ch0 = r1.round1Channels?.[0] || "-";
  const ch1 = r1.round1Channels?.[1] || "-";
  const s0 = Number(r1.round1ChannelShare?.[0] || 0);
  const s1 = Number(r1.round1ChannelShare?.[1] || 0);
  els.coachPinnedCard.textContent = [
    `Pinned 决策组合（只读）`,
    `segment: ${r1.customerType}/${r1.strategy}/${r1.ageGroup}`,
    `arch: ${r1.archTag}`,
    `channels: ${ch0} ${(s0 * 100).toFixed(0)}% + ${ch1} ${(s1 * 100).toFixed(0)}%`
  ].join("\n");
}

function renderCoachMessages() {
  if (!els.coachMessageList) return;
  const c = state.activeTeam?.coach;
  if (c && !c.sessionId && !c.chatSession && Array.isArray(c.messages) && c.messages.length) {
    // Avoid showing stale local history as if it belongs to current live session.
    c.messages = [];
  }
  if (!c || !Array.isArray(c.messages) || !c.messages.length) {
    els.coachMessageList.innerHTML = "";
    renderCoachDebugHeader();
    renderCoachPromptDebug();
    return;
  }
  els.coachMessageList.innerHTML = c.messages
    .map((m) => {
      const cls = m.role === "assistant" ? "assistant" : "user";
      const text = cls === "assistant" ? normalizeCoachDisplayText(m.content) : String(m.content || "");
      return `<div class="msg ${cls}"><strong>${cls === "assistant" ? "Coach" : "你"}:</strong><br/>${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;
    })
    .join("");
  els.coachMessageList.scrollTop = els.coachMessageList.scrollHeight;
  if (els.coachApplyRound1) {
    const canSubmit = Boolean(c?.canSubmit && String(c?.chatSession?.vp_final || "").trim());
    els.coachApplyRound1.disabled = !canSubmit;
  }
  renderCoachDebugHeader();
  renderCoachPromptDebug();
}

function addCoachMessage(role, content, parsedStruct, mode) {
  const c = coachState();
  if (!c) return;
  c.messages.push({ role, content: String(content || ""), parsed_struct: parsedStruct || null, mode: mode || "" });
  if (role === "assistant") {
    c.lastParsed = parsedStruct || null;
    c.lastMode = mode || "";
  }
}

function coachButtonsEnabled(enabled) {
  [
    els.coachCreateSession,
    els.coachSend,
    els.coachGenerate
  ].forEach((el) => {
    if (el) el.disabled = !enabled;
  });
}

async function coachCreateSession() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.round1Chat) throw new Error("后端 API 不可用，请启动 node server.js");
  const c = coachState();
  resetCoachSessionData(c, c.promptVersion || "");
  setLlmBusy(true, "正在创建对话...");
  try {
    const resp = await ApiClient.round1Chat({
      decision_state: buildDecisionStateFromForm(),
      session_state: c.chatSession,
      message: "给参考"
    });
    c.chatSession = resp.updated_session_state || c.chatSession;
    c.messages = [];
    c.promptVersion = String(resp?.debug?.PROMPT_VERSION || c.promptVersion || "");
    c.bottleneckTitle = String(c.chatSession?.phase || "");
    c.canSubmit = Boolean(resp?.enable_submit);
    c.debugPrompt = resp?.debug || null;
    addCoachMessage("assistant", resp.assistant_message, resp.parsed_struct, "chat");
    saveLocalState();
    renderCoachPinnedCard();
    renderCoachMessages();
    renderCoachDebugHeader();
    renderCoachPromptDebug();
  } finally {
    setLlmBusy(false);
  }
}

async function coachSend(userMessage) {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.round1Chat) throw new Error("后端 API 不可用，请启动 node server.js");
  const c = coachState();
  if (!c?.chatSession) throw new Error("请先启动对话");
  const text = String(userMessage || els.coachUserInput?.value || "").trim();
  if (!text) throw new Error("请输入消息");
  addCoachMessage("user", text, null, "");
  renderCoachMessages();
  if (els.coachUserInput) els.coachUserInput.value = "";
  setLlmBusy(true, "Coach 思考中...");
  try {
    const resp = await ApiClient.round1Chat({
      decision_state: buildDecisionStateFromForm(),
      session_state: c.chatSession,
      message: text
    });
    c.chatSession = resp.updated_session_state || c.chatSession;
    c.promptVersion = String(resp?.debug?.PROMPT_VERSION || c.promptVersion || "");
    c.bottleneckTitle = String(c.chatSession?.phase || c.bottleneckTitle || "");
    c.canSubmit = Boolean(resp?.enable_submit);
    c.debugPrompt = resp?.debug || c.debugPrompt || null;
    addCoachMessage("assistant", resp.assistant_message, resp.parsed_struct, "chat");
    saveLocalState();
    renderCoachMessages();
    renderCoachDebugHeader();
    renderCoachPromptDebug();
  } finally {
    setLlmBusy(false);
  }
}

async function coachGenerateVp() {
  return coachSend("生成VP");
}

function applyCoachToRound1() {
  ensureActiveTeamForLlm();
  if (!state.activeTeam.round1) throw new Error("请先完成 Round 1");
  const c = coachState();
  const vp = String(c?.chatSession?.vp_final || c?.lastParsed?.vp_text || "").trim();
  if (!c?.canSubmit || !vp) {
    throw new Error("当前VP还未达到提交标准，请继续完善。");
  }
  state.activeTeam.round1.vpOneLiner = vp;
  state.activeTeam.round1.vpSubmitted = true;
  saveLocalState();
  setLlmStatus("success", "VP已提交✅（可继续修改并重新提交）");
}

function getTeamKey() {
  return state.activeTeam?.id || localStorage.getItem("team_key") || "default";
}

function getStrategyFromForm() {
  const gm = Number(state.activeTeam?.round1?.targetGm || 0);
  return {
    market: els.customerType?.value || "",
    competitive: els.strategy?.value || "",
    segment: els.ageGroup?.value || "",
    architecture: els.archTag?.value || "",
    targetGm: Number.isFinite(gm) && gm > 0 ? Number((gm * 100).toFixed(1)) : ""
  };
}

function unlockVpSection() {
  if (els.vpSection) els.vpSection.style.display = "block";
}

function appendVpChatMessage(role, text) {
  if (!els.vpChatMessages) return;
  const div = document.createElement("div");
  div.style.marginBottom = "12px";
  div.style.padding = "10px 14px";
  div.style.borderRadius = "8px";
  if (role === "user") {
    div.style.background = "#d4edda";
    div.style.marginLeft = "40px";
    div.style.textAlign = "right";
  } else if (role === "coach") {
    div.style.background = "#fff";
    div.style.border = "1px solid #ddd";
  } else {
    div.style.background = "#fff3cd";
    div.style.fontSize = "12px";
  }
  const who = role === "user" ? "你" : role === "coach" ? "Coach" : "系统";
  div.innerHTML = `<strong>${who}：</strong><br>${escapeHtml(String(text || "")).replace(/\n/g, "<br>")}`;
  els.vpChatMessages.appendChild(div);
  els.vpChatMessages.scrollTop = els.vpChatMessages.scrollHeight;
}

function resetVpReviewState() {
  vpReviewState = {
    scoringRounds: 0,
    maxScoringRounds: VP_MAX_SCORING_ROUNDS,
    canContinue: true,
    mustConfirm: false,
    lastAction: "chat"
  };
  if (state.activeTeam?.round1) {
    state.activeTeam.round1.vpSubmitted = false;
    delete state.activeTeam.round1.vpCoachResult;
  }
  updateVpResultActions();
  if (els.vpCoachFeedback) els.vpCoachFeedback.innerHTML = "";
  if (els.vpPmfDetails) els.vpPmfDetails.innerHTML = "";
  if (els.vpFinalGm) els.vpFinalGm.textContent = "";
  if (els.vpResultJson) {
    els.vpResultJson.style.display = "none";
    els.vpResultJson.textContent = "";
  }
}

function updateVpResultActions() {
  if (els.vpChatSubmitBtn) {
    els.vpChatSubmitBtn.textContent = "查看评分";
  }
  if (els.vpContinueBtn) {
    els.vpContinueBtn.style.display = vpReviewState.canContinue ? "" : "none";
  }
  if (els.vpConfirmBtn) {
    els.vpConfirmBtn.style.display = vpReviewState.lastAction === "confirm" ? "none" : "";
    els.vpConfirmBtn.disabled = false;
  }
}

function formatVpScore(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n.toFixed(1) : "--";
}

function buildVpScoreRows(vpResult, scorePreview) {
  const scores = vpResult?.scores && typeof vpResult.scores === "object"
    ? {
        C: vpResult.scores.C,
        G: vpResult.scores.G,
        E: vpResult.scores.E
      }
    : {
        C: { score: scorePreview?.coverage, feedback: "" },
        G: { score: scorePreview?.generalizability, feedback: "" },
        E: { score: scorePreview?.effectiveness, feedback: "" }
      };

  return [
    { key: "C", label: "Coverage", color: "#2d6a4f", item: scores.C },
    { key: "G", label: "Generalizability", color: "#40916c", item: scores.G },
    { key: "E", label: "Effectiveness", color: "#74c69d", item: scores.E }
  ].map((row) => {
    const rawScore = row.item && typeof row.item === "object" ? row.item.score : row.item;
    const score = Number(rawScore);
    const feedback = row.item && typeof row.item === "object" ? String(row.item.feedback || "").trim() : "";
    return {
      key: row.key,
      label: row.label,
      color: row.color,
      score: Number.isFinite(score) ? Math.max(1, Math.min(5, score)) : null,
      feedback
    };
  });
}

function renderVpScoreSummary(vpResult, scorePreview, vpResultRaw) {
  const rows = buildVpScoreRows(vpResult, scorePreview);
  if (els.vpPmfDetails) {
    els.vpPmfDetails.innerHTML = rows
      .map((row) => {
        const numericScore = Number(row.score);
        const width = `${Number.isFinite(numericScore) ? Math.max(0, Math.min(100, (numericScore / 5) * 100)).toFixed(1) : "0.0"}%`;
        const feedback = row.feedback ? `<div style="margin-top:6px;color:#555;">${escapeHtml(row.feedback)}</div>` : "";
        return `
          <div style="background:#fff;border:1px solid #d9e2dc;border-radius:10px;padding:12px 14px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <strong>${row.key} · ${row.label}</strong>
              <span style="color:${row.color};font-weight:700;">${formatVpScore(row.score)}/5.0</span>
            </div>
            <div style="height:8px;background:#edf2ef;border-radius:999px;overflow:hidden;margin-top:10px;">
              <div style="height:100%;width:${width};background:${row.color};"></div>
            </div>
            ${feedback}
          </div>
        `;
      })
      .join("");
  }

  if (els.vpResultJson) {
    if (vpResultRaw) {
      els.vpResultJson.style.display = "block";
      els.vpResultJson.textContent = vpResultRaw;
    } else {
      els.vpResultJson.style.display = "none";
      els.vpResultJson.textContent = "";
    }
  }
}

function showVpResult(result) {
  const coachFeedback = String(result?.reply || "");
  const scoringRounds = Number(result?.scoringRounds || 0);
  const maxScoringRounds = Number(result?.maxScoringRounds || VP_MAX_SCORING_ROUNDS);
  const vpResult = result?.vpResult || null;

  vpReviewState = {
    scoringRounds,
    maxScoringRounds,
    canContinue: Boolean(result?.canContinue),
    mustConfirm: Boolean(result?.mustConfirm),
    lastAction: String(result?.action || "score")
  };

  if (els.vpChatBlock) els.vpChatBlock.style.display = "none";
  if (els.vpResultBlock) els.vpResultBlock.style.display = "block";
  if (els.vpCoachFeedback) {
    els.vpCoachFeedback.innerHTML = escapeHtml(coachFeedback).replace(/\n/g, "<br>");
  }

  renderVpScoreSummary(vpResult, result?.scorePreview || null, result?.vpResultRaw || "");

  if (els.vpFinalGm) {
    const roundLine = `评分轮次：${Math.min(scoringRounds, maxScoringRounds)}/${maxScoringRounds}`;
    const hintLine = vpReviewState.lastAction === "confirm"
      ? "已确认提交，流程结束。"
      : vpReviewState.mustConfirm
        ? "已达到最多评分次数，请确认提交。"
        : "你们可以继续修改后再次查看评分。";
    els.vpFinalGm.textContent = `${roundLine} ${hintLine}`;
  }

  if (vpReviewState.lastAction === "confirm" && vpResult && state.activeTeam?.round1) {
    state.activeTeam.round1.vpSubmitted = true;
    state.activeTeam.round1.vpCoachResult = vpResult;
    saveLocalState();
  }

  updateVpResultActions();
}

async function submitVpCanvas() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.vpCreateSession || !window.ApiClient?.vpSubmitCanvas) {
    throw new Error("后端 API 不可用，请启动 node server.js");
  }
  const strategy = getStrategyFromForm();
  const sessionOut = await ApiClient.vpCreateSession({ teamKey: getTeamKey(), strategy });
  vpSessionId = String(sessionOut.sessionId || "");
  const vpCanvas = {
    customerJobs: String(els.vpCustomerJobs?.value || ""),
    pains: String(els.vpPains?.value || ""),
    gains: String(els.vpGains?.value || ""),
    products: String(els.vpProducts?.value || ""),
    painRelievers: String(els.vpPainRelievers?.value || ""),
    gainCreators: String(els.vpGainCreators?.value || "")
  };
  localStorage.setItem("vp_canvas", JSON.stringify(vpCanvas));
  localStorage.setItem("round1_strategy", JSON.stringify(strategy));
  localStorage.setItem("vp_session_id", vpSessionId);
  resetVpReviewState();
  if (els.vpSubmitCanvasBtn) {
    els.vpSubmitCanvasBtn.disabled = true;
    els.vpSubmitCanvasBtn.textContent = "提交中...";
  }
  try {
    const out = await ApiClient.vpSubmitCanvas({ sessionId: vpSessionId, vpCanvas });
    if (els.vpCanvasBlock) els.vpCanvasBlock.style.display = "none";
    if (els.vpChatBlock) els.vpChatBlock.style.display = "block";
    if (els.vpChatMessages) els.vpChatMessages.innerHTML = "";
    appendVpChatMessage("coach", out.reply || "");
  } catch (err) {
    if (els.vpSubmitCanvasBtn) {
      els.vpSubmitCanvasBtn.disabled = false;
      els.vpSubmitCanvasBtn.textContent = "提交 VP -> 开始 AI 点评";
    }
    throw err;
  } finally {
  }
}

async function sendVpMessage(action) {
  if (!window.ApiClient?.vpChat) throw new Error("后端 API 不可用，请启动 node server.js");
  if (!vpSessionId) throw new Error("请先提交 VP Canvas");
  const mode = String(action || "chat");
  const text = String(els.vpChatInput?.value || "").trim();
  if (mode === "chat" && !text) return;
  if (text) {
    appendVpChatMessage("user", text);
  }
  if (els.vpChatInput) els.vpChatInput.value = "";
  const out = await ApiClient.vpChat({ sessionId: vpSessionId, message: text, action: mode });
  appendVpChatMessage("coach", out.reply || "");
  if (mode === "score" || mode === "confirm") {
    showVpResult(out);
  }
}

function continueImproving() {
  if (els.vpResultBlock) els.vpResultBlock.style.display = "none";
  if (els.vpChatBlock) els.vpChatBlock.style.display = "block";
  appendVpChatMessage("system", "你可以继续和教练对话，完善后再次点击“查看评分”。");
}

function restartVp() {
  if (!confirm("确定要重新开始吗？当前会话会保留在服务器，页面将重置。")) return;
  vpSessionId = "";
  resetVpReviewState();
  if (els.vpResultBlock) els.vpResultBlock.style.display = "none";
  if (els.vpChatBlock) els.vpChatBlock.style.display = "none";
  if (els.vpCanvasBlock) els.vpCanvasBlock.style.display = "";
  if (els.vpSubmitCanvasBtn) {
    els.vpSubmitCanvasBtn.disabled = false;
    els.vpSubmitCanvasBtn.textContent = "提交 VP -> 开始 AI 点评";
  }
  if (els.vpChatMessages) els.vpChatMessages.innerHTML = "";
  [els.vpCustomerJobs, els.vpPains, els.vpGains, els.vpProducts, els.vpPainRelievers, els.vpGainCreators].forEach((el) => {
    if (el) el.value = "";
  });
}

function downloadRecord() {
  if (!vpSessionId) {
    alert("没有可下载的记录");
    return;
  }
  window.open(`/api/vp/export/${encodeURIComponent(vpSessionId)}`, "_blank");
}

function getStrategyFromRound1() {
  try {
    const cached = JSON.parse(localStorage.getItem("round1_strategy") || "{}");
    if (cached && Object.keys(cached).length) return cached;
  } catch (_) {}
  if (state.activeTeam?.round1) {
    return getStrategyFromForm();
  }
  return {};
}

function checkMarketingUnlock() {
  if (!els.marketingSection) return;
  const hasVp = Boolean(localStorage.getItem("vp_session_id")) && Boolean(localStorage.getItem("vp_canvas"));
  els.marketingSection.style.display = hasVp ? "block" : "none";

  const hasSpec = Boolean(localStorage.getItem("market_research_scores"));
  if (els.panelRound2) {
    els.panelRound2.style.display = hasSpec ? "block" : "none";
  }
  if (hasSpec) {
    renderCardGrid().catch(() => {});
  }
}

function appendInterviewMessage(role, text) {
  if (!els.marketingChatMessages) return;
  const div = document.createElement("div");
  div.style.marginBottom = "12px";
  div.style.padding = "10px 14px";
  div.style.borderRadius = "8px";
  if (role === "user") {
    div.style.background = "#d4edda";
    div.style.marginLeft = "40px";
  } else if (role === "assistant") {
    div.style.background = "#fff";
    div.style.border = "1px solid #ddd";
  } else {
    div.style.background = "#fff3cd";
    div.style.fontSize = "12px";
  }
  const label = role === "user" ? "你(Marketing)" : role === "assistant" ? "客户" : "系统";
  div.innerHTML = `<strong>${label}：</strong><br>${escapeHtml(String(text || "")).replace(/\n/g, "<br>")}`;
  els.marketingChatMessages.appendChild(div);
  els.marketingChatMessages.scrollTop = els.marketingChatMessages.scrollHeight;
}

async function startMarketing() {
  if (!window.ApiClient?.marketingStart) throw new Error("后端 API 不可用，请启动 node server.js");
  const vpCanvas = JSON.parse(localStorage.getItem("vp_canvas") || "{}");
  const strategy = getStrategyFromRound1();
  const teamKey = getTeamKey();
  if (!Object.keys(vpCanvas).length) throw new Error("缺少 Round 1 VP Canvas，请先完成 Round 1 提交");
  if (!strategy || !Object.keys(strategy).length) throw new Error("缺少 Round 1 策略参数");

  if (els.marketingStartBtn) els.marketingStartBtn.style.display = "none";
  if (els.marketingStartLoading) els.marketingStartLoading.style.display = "block";

  try {
    const out = await ApiClient.marketingStart({ teamKey, strategy, vpCanvas });
    marketingSessionId = String(out.sessionId || "");
    if (els.marketingPersonaCard) {
      els.marketingPersonaCard.innerHTML = String(out.persona || "")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
    }
    if (els.marketingStartBlock) els.marketingStartBlock.style.display = "none";
    if (els.marketingInterviewBlock) els.marketingInterviewBlock.style.display = "block";
    if (els.marketingScoreBlock) els.marketingScoreBlock.style.display = "none";
    if (els.marketingTurnCount) els.marketingTurnCount.textContent = "0";
    if (els.marketingCanEndHint) els.marketingCanEndHint.textContent = "";
    if (els.marketingChatMessages) els.marketingChatMessages.innerHTML = "";
    appendInterviewMessage("system", "客户已就位。请开始访谈，重点挖掘深层需求而不是表面功能。");
  } catch (err) {
    if (els.marketingStartLoading) els.marketingStartLoading.style.display = "none";
    if (els.marketingStartBtn) els.marketingStartBtn.style.display = "";
    throw err;
  }
}

async function sendInterviewMessage() {
  if (!window.ApiClient?.marketingInterview) throw new Error("后端 API 不可用，请启动 node server.js");
  if (!marketingSessionId) throw new Error("请先开始访谈");
  const text = String(els.marketingChatInput?.value || "").trim();
  if (!text) return;

  if (els.marketingChatInput) els.marketingChatInput.value = "";
  appendInterviewMessage("user", text);

  const out = await ApiClient.marketingInterview({ sessionId: marketingSessionId, message: text });
  appendInterviewMessage("assistant", out.reply || "");
  if (els.marketingTurnCount) els.marketingTurnCount.textContent = String(out.turnCount || 0);
  if (els.marketingCanEndHint) els.marketingCanEndHint.textContent = String(out.hint || "");
  if (out.reachedLimit) {
    if (els.marketingChatInput) els.marketingChatInput.disabled = true;
    if (els.marketingSendBtn) els.marketingSendBtn.disabled = true;
  }
}

async function endInterview() {
  if (!window.ApiClient?.marketingEndInterview) throw new Error("后端 API 不可用，请启动 node server.js");
  if (!marketingSessionId) throw new Error("请先开始访谈");
  if (!confirm("确定结束访谈？结束后将自动分析市场需求。")) return;
  if (els.endInterviewBtn) {
    els.endInterviewBtn.disabled = true;
    els.endInterviewBtn.textContent = "分析中...";
  }
  try {
    const out = await ApiClient.marketingEndInterview({ sessionId: marketingSessionId });
    renderTags(out.tags || []);
    renderRadarChart(out.scores || {}, out.dimensions || []);
    renderDimensionDetails(out.scores || {}, out.dimensions || []);
    localStorage.setItem(
      "market_research_scores",
      JSON.stringify({
        scores: out.scores || {},
        tags: out.tags || [],
        anchorVersion: out.anchorVersion || ""
      })
    );
    localStorage.setItem("market_research_tags", JSON.stringify(out.tags || []));
    localStorage.setItem("marketing_session_id", marketingSessionId);
    if (els.marketingInterviewBlock) els.marketingInterviewBlock.style.display = "none";
    if (els.marketingScoreBlock) els.marketingScoreBlock.style.display = "block";
  } catch (err) {
    if (els.endInterviewBtn) {
      els.endInterviewBtn.disabled = false;
      els.endInterviewBtn.textContent = "结束访谈";
    }
    throw err;
  }
}

function renderTags(tags) {
  if (!els.marketingTagsDisplay) return;
  const rows = Array.isArray(tags) ? tags : [];
  els.marketingTagsDisplay.innerHTML = rows
    .map(
      (t) => {
        const isPositive = String(t?.polarity || "") === "positive";
        const bg = isPositive ? "#e8f5e9" : "#fdecea";
        const fg = isPositive ? "#2d6a4f" : "#8e2e21";
        const bd = isPositive ? "#c8e6c9" : "#f5c6c2";
        const prefix = isPositive ? "✓" : "✗";
        return `
    <span style="background:${bg};color:${fg};padding:4px 10px;border-radius:12px;font-size:14px;border:1px solid ${bd};">
      ${prefix} ${escapeHtml(String(t?.tag || ""))}
    </span>`
      }
    )
    .join("");
}

function renderRadarChart(scores, dimensions) {
  if (!els.marketingRadarChart || typeof Chart === "undefined") return;
  const dims = Array.isArray(dimensions) ? dimensions : [];
  const labels = dims.map((d) => d.label_cn || d.key);
  const values = dims.map((d) => Number(scores?.[d.key] || 0));
  const ctx = els.marketingRadarChart.getContext("2d");
  if (radarChart) radarChart.destroy();
  radarChart = new Chart(ctx, {
    type: "radar",
    data: {
      labels,
      datasets: [
        {
          label: "市场需求强度",
          data: values,
          backgroundColor: "rgba(45, 106, 79, 0.2)",
          borderColor: "rgba(45, 106, 79, 0.8)",
          borderWidth: 2,
          pointBackgroundColor: "rgba(45, 106, 79, 1)",
          pointRadius: 4
        }
      ]
    },
    options: {
      scales: {
        r: {
          min: 0,
          max: 10,
          ticks: { stepSize: 2, display: false },
          grid: { color: "rgba(0,0,0,0.1)" },
          pointLabels: { font: { size: 13 } }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function renderDimensionDetails(scores, dimensions) {
  if (!els.marketingDimensionDetails) return;
  const dims = Array.isArray(dimensions) ? dimensions : [];
  els.marketingDimensionDetails.innerHTML = dims
    .map((d) => {
      const score = Number(scores?.[d.key] || 0);
      const safe = Math.max(0, Math.min(10, Math.round(score)));
      const stars = `${"★".repeat(safe)}${"☆".repeat(Math.max(0, 10 - safe))}`;
      return `
      <div style="padding:10px;background:#f8f9fa;border-radius:6px;text-align:center;">
        <div style="font-size:13px;color:#555;margin-bottom:4px;">${escapeHtml(d.label_cn || d.key)}</div>
        <div style="font-size:18px;color:#2d6a4f;">${stars}</div>
        <div style="font-size:12px;color:#888;">${safe}/10</div>
      </div>`;
    })
    .join("");
}

function downloadMarketingRecord() {
  if (!marketingSessionId) {
    alert("没有可下载的记录");
    return;
  }
  window.open(`/api/marketing/export/${encodeURIComponent(marketingSessionId)}`, "_blank");
}

function proceedToRD() {
  if (els.marketingSection) els.marketingSection.style.display = "none";
  if (els.panelRound2) {
    els.panelRound2.style.display = "block";
    els.panelRound2.scrollIntoView({ behavior: "smooth" });
  }
  renderCardGrid().catch((err) => {
    alert(`加载功能卡失败: ${err.message || err}`);
  });
}

function normalizeGridId(strategy) {
  const fromStorage = String(strategy?.gridId || "").trim();
  if (fromStorage) return fromStorage;
  const marketRaw = String(strategy?.market || strategy?.customerType || state.activeTeam?.round1?.customerType || "B2C").toUpperCase();
  const compRaw = String(strategy?.competitive || strategy?.strategy || state.activeTeam?.round1?.strategy || "DIFF").toUpperCase();
  const archRaw = String(strategy?.architecture || strategy?.archTag || state.activeTeam?.round1?.archTag || "Experience").toLowerCase();

  const market = marketRaw.includes("B2B") || marketRaw.includes("TOB") ? "B2B" : "B2C";
  const comp = compRaw.includes("COST") ? "Cost" : "Differentiation";
  let arch = "Experience";
  if (archRaw.includes("mix") || archRaw.includes("hybrid") || archRaw.includes("混")) arch = "Mixed";
  if (archRaw.includes("func") || archRaw.includes("功能")) arch = "Function";
  if (archRaw.includes("exp") || archRaw.includes("体验")) arch = "Experience";
  return `${market}_${comp}_${arch}`;
}

async function renderCardGrid() {
  if (!els.cardGrid) return;
  const [cardsRes, rulesRes] = await Promise.all([
    fetch("/api/rd/cards").then((r) => r.json()),
    fetch("/api/rd/rules").then((r) => r.json()).catch(() => ({ ok: false }))
  ]);
  if (!cardsRes.ok) throw new Error(cardsRes.error || "cards api failed");

  const groups = Array.isArray(cardsRes.groups) ? cardsRes.groups : [];
  rdCompatRules = rulesRes.ok ? rulesRes : null;
  rdCapacityCap = Number(cardsRes.global_capacity?.capacity_points || 24);
  rdCardCatalog = groups.flatMap((g) =>
    (g.capabilities || []).map((cap) => ({
      ...cap,
      group_id: g.group_id,
      group_name: g.name,
      group_min: Number(g.min_select || 1),
      group_max: Number(g.max_select || 3)
    }))
  );
  rdGridMeta = null;
  const strategy = JSON.parse(localStorage.getItem("round1_strategy") || "{}");
  const gridId = normalizeGridId(strategy);
  try {
    const gridRes = await fetch(`/api/rd/grid/${encodeURIComponent(gridId)}`);
    const gridData = await gridRes.json();
    if (gridData.ok && gridData.grid) rdGridMeta = gridData.grid;
  } catch (_) {}
  updateBudgetCap();
  const recommendedCaps = Array.isArray(rdGridMeta?.recommended_capabilities) ? rdGridMeta.recommended_capabilities : [];

  els.cardGrid.innerHTML = groups
    .map((group) => {
      const cardsHtml = (group.capabilities || [])
        .map((card) => {
          const tiers = card.tiers || {};
          const low = tiers.low || {};
          const mid = tiers.mid || {};
          const high = tiers.high || {};
          const perf = Math.round(Math.exp(-2 * Number(mid.risk || 0)) * 100);
          const covers = Array.isArray(card.covers) ? card.covers.join("、") : "";
          const isRecommended = recommendedCaps.includes(card.cap_id);
          return `
          <div class="card-item cap-card" id="card-${card.cap_id}">
            <div class="card-checkbox" id="check-${card.cap_id}">☐</div>
            ${isRecommended ? '<div class="cap-badge">★ 推荐</div>' : ""}
            <div class="card-name">${escapeHtml(card.name || card.cap_id)}</div>
            <div class="cap-covers">${escapeHtml(covers || "—")}</div>
            <div class="card-stats">
              <span>ΔBOM(low-mid-high): ${Number(low.dCOGS || 0)} / ${Number(mid.dCOGS || 0)} / ${Number(high.dCOGS || 0)} 元</span>
              <span>性能指数(mid) ${perf}/100</span>
            </div>
            <div class="card-tier-picker tier-selector" id="tier-sel-${card.cap_id}">
              <button type="button" class="tier-btn" data-cap="${card.cap_id}" data-tier="low" id="tier-${card.cap_id}-low" onclick="toggleCardTier('${card.cap_id}','low')">low</button>
              <button type="button" class="tier-btn" data-cap="${card.cap_id}" data-tier="mid" id="tier-${card.cap_id}-mid" onclick="toggleCardTier('${card.cap_id}','mid')">mid</button>
              <button type="button" class="tier-btn" data-cap="${card.cap_id}" data-tier="high" id="tier-${card.cap_id}-high" onclick="toggleCardTier('${card.cap_id}','high')">high</button>
            </div>
            <div class="cap-dep-hint" id="dep-hint-${card.cap_id}"></div>
            <div class="card-tooltip">
              <div><strong>【覆盖需求】</strong>${escapeHtml(covers || "无")}</div>
              <div><strong>【说明】</strong>档位越高，通常成本/风险/load 同步上升</div>
            </div>
          </div>`;
        })
        .join("");
      return `
      <div class="rd-group-block">
        <div class="rd-group-head">
          <strong>${escapeHtml(group.name || group.group_id)}</strong>
          <span id="group-count-${group.group_id}" class="hint">0/${group.min_select}-${group.max_select}</span>
        </div>
        <div id="group-progress-track-${group.group_id}" class="group-progress-track">
          <div id="group-progress-fill-${group.group_id}" class="group-progress-fill"></div>
        </div>
        <div class="rd-group-cards">${cardsHtml}</div>
      </div>`;
    })
    .join("");

  rdSelections.clear();
  rdValidation = { violations: [], soft: null };
  updateCardUI();
  updateRdSelectionUi();
  renderRdPreview();
  validateRdSelections().catch(() => {});
}

function updateRdSelectionUi() {
  const count = rdSelections.size;
  const hasHardViolation = Array.isArray(rdValidation.violations) && rdValidation.violations.length > 0;
  const totalOk = count >= 8 && count <= 10;
  if (els.cardCountBadge) {
    els.cardCountBadge.textContent = `(已选 ${count} / 8-10)`;
  }
  if (els.btnCalculateRd) {
    els.btnCalculateRd.disabled = rdIsCalculating || !totalOk || hasHardViolation;
  }
  if (els.rdSelectProgressText) els.rdSelectProgressText.textContent = `${count}/10`;
  if (els.rdSelectProgressFill) els.rdSelectProgressFill.style.width = `${Math.round((count / 10) * 100)}%`;

  const groupCounts = {};
  for (const cap of rdCardCatalog) {
    if (rdSelections.has(cap.cap_id)) {
      groupCounts[cap.group_id] = (groupCounts[cap.group_id] || 0) + 1;
    }
  }
  const groupMeta = {};
  for (const cap of rdCardCatalog) {
    if (!groupMeta[cap.group_id]) {
      groupMeta[cap.group_id] = {
        min: cap.group_min,
        max: cap.group_max
      };
    }
  }
  Object.keys(groupMeta).forEach((gid) => {
    const el = document.getElementById(`group-count-${gid}`);
    const trackEl = document.getElementById(`group-progress-track-${gid}`);
    const fillEl = document.getElementById(`group-progress-fill-${gid}`);
    if (!el) return;
    const c = groupCounts[gid] || 0;
    const { min, max } = groupMeta[gid];
    el.textContent = `${c}/${min}-${max}`;
    const ratio = Math.max(0, Math.min(1, c / Math.max(1, max)));
    if (fillEl) fillEl.style.width = `${Math.round(ratio * 100)}%`;
    if (c < min) {
      el.style.color = "#d97706";
      if (trackEl) trackEl.dataset.state = "low";
    } else if (c > max) {
      el.style.color = "#b42318";
      if (trackEl) trackEl.dataset.state = "over";
    } else {
      el.style.color = "#157347";
      if (trackEl) trackEl.dataset.state = "ok";
    }
  });

  if (els.rdValidateHint) {
    if (!rdValidation.violations || rdValidation.violations.length === 0) {
      els.rdValidateHint.textContent = "约束校验通过";
      els.rdValidateHint.style.color = "#157347";
    } else {
      const sample = rdValidation.violations.slice(0, 2).map((v) => v.message).join("；");
      const more = rdValidation.violations.length > 2 ? `（另有${rdValidation.violations.length - 2}条）` : "";
      els.rdValidateHint.textContent = `约束未通过：${sample}${more}`;
      els.rdValidateHint.style.color = "#b42318";
    }
  }
  updateBars();
  renderRdAlerts();
}

function setRdCalculating(isBusy) {
  rdIsCalculating = Boolean(isBusy);
  if (els.btnCalculateRd) {
    els.btnCalculateRd.classList.toggle("loading", rdIsCalculating);
    els.btnCalculateRd.textContent = rdIsCalculating ? "计算中…" : "计算 Round 2";
  }
  if (els.rdSubmitStatus) {
    els.rdSubmitStatus.style.display = rdIsCalculating ? "flex" : "none";
  }
  updateRdSelectionUi();
}

function updateBudgetCap() {
  const strategy = JSON.parse(localStorage.getItem("round1_strategy") || "{}");
  const COGSbase = Number(strategy.cogsBase || 6000);
  const gridId = normalizeGridId(strategy);
  const strategyType = gridId.includes("Differentiation")
    ? "Differentiation"
    : gridId.includes("CostLeadership") || gridId.includes("Cost")
      ? "CostLeadership"
      : "Focus";
  const multipliers = { Differentiation: 0.45, CostLeadership: 0.2, Focus: 0.35 };
  rdBudgetCap = Math.round(COGSbase * (multipliers[strategyType] || 0.35));
  rdCapacityCap = rdCapacityCap || Number(rdCompatRules?.selection_constraints?.capacity_points || 0) || 24;
}

function updateBars() {
  let positiveDCOGS = 0;
  let totalLoad = 0;
  for (const [capId, tier] of rdSelections.entries()) {
    const cap = rdCardCatalog.find((c) => c.cap_id === capId);
    if (!cap) continue;
    const t = (cap.tiers || {})[tier] || {};
    positiveDCOGS += Math.max(0, Number(t.dCOGS || 0));
    totalLoad += Number(t.load || 0);
  }

  const budgetCap = rdBudgetCap || 2700;
  const budgetPct = Math.min(100, (positiveDCOGS / Math.max(1, budgetCap)) * 100);
  if (els.budgetFill) {
    els.budgetFill.style.width = `${budgetPct}%`;
    els.budgetFill.className = `bar-fill budget-fill ${positiveDCOGS > budgetCap ? "over" : ""}`;
  }
  if (els.budgetLabel) els.budgetLabel.textContent = `${fmt(positiveDCOGS)} / ${fmt(budgetCap)} 元`;

  const capCap = rdCapacityCap || 24;
  const capPct = Math.min(100, (totalLoad / Math.max(1, capCap)) * 100);
  if (els.capacityFill) {
    els.capacityFill.style.width = `${capPct}%`;
    els.capacityFill.className = `bar-fill capacity-fill ${totalLoad > capCap ? "over" : ""}`;
  }
  if (els.capacityLabel) els.capacityLabel.textContent = `${totalLoad} / ${capCap} 点`;
  if (els.totalCount) els.totalCount.textContent = String(rdSelections.size);
}

function renderRdAlerts() {
  if (!els.rdAlerts) return;
  const out = [];
  for (const v of rdValidation.violations || []) {
    out.push(`<div class="alert alert-hard">🚫 ${escapeHtml(v.message || "")}</div>`);
  }
  for (const d of rdValidation.soft?.details || []) {
    if (d.rule === "S1_budget") {
      out.push(`<div class="alert alert-soft">⚠️ 超预算 ${fmt(d.over)} 元 → share 惩罚 ${d.z_penalty}</div>`);
    } else if (d.rule === "S2_capacity") {
      out.push(`<div class="alert alert-soft">⚠️ 超负载 ${d.over} 点 → share 惩罚 ${d.z_penalty}，风险 +${d.risk_add}</div>`);
    } else if (d.rule === "soft_requires") {
      out.push(`<div class="alert alert-soft">⚠️ ${escapeHtml(d.reason || "存在软依赖未满足")}</div>`);
    }
  }
  els.rdAlerts.innerHTML = out.join("");
}

async function validateRdSelections() {
  const strategy = JSON.parse(localStorage.getItem("round1_strategy") || "{}");
  const payload = {
    gridId: normalizeGridId(strategy),
    COGSbase: Number(strategy.cogsBase || 6000),
    selections: Array.from(rdSelections.entries()).map(([cap_id, tier]) => ({ cap_id, tier }))
  };
  try {
    const res = await fetch("/api/rd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (out.ok) {
      rdValidation = { violations: out.violations || [], soft: out.soft || null };
    }
  } catch (_) {}
  updateRdSelectionUi();
  updateCardUI();
}

function updateCardUI() {
  rdCardCatalog.forEach((c) => {
    const tier = rdSelections.get(c.cap_id) || "";
    const checkEl = document.getElementById(`check-${c.cap_id}`);
    const cardEl = document.getElementById(`card-${c.cap_id}`);
    if (checkEl) checkEl.textContent = tier ? `☑ ${tier}` : "☐";
    if (cardEl) {
      cardEl.classList.toggle("selected", Boolean(tier));
      cardEl.classList.remove("disabled");
    }
    ["low", "mid", "high"].forEach((lv) => {
      const btn = document.getElementById(`tier-${c.cap_id}-${lv}`);
      if (btn) {
        btn.classList.toggle("active", tier === lv);
        btn.classList.remove("disabled");
      }
    });
    const hintEl = document.getElementById(`dep-hint-${c.cap_id}`);
    if (hintEl) hintEl.innerHTML = "";
  });

  for (const [capId, tier] of rdSelections.entries()) {
    const cap = rdCardCatalog.find((c) => c.cap_id === capId);
    const tierData = (cap?.tiers || {})[tier] || {};
    for (const exc of tierData.excludes || []) {
      if (exc.type !== "hard") continue;
      const targetCard = document.getElementById(`card-${exc.cap}`);
      if (targetCard && !rdSelections.has(exc.cap)) {
        targetCard.classList.add("disabled");
      }
      if (Array.isArray(exc.tier_in)) {
        for (const lv of exc.tier_in) {
          const targetBtn = document.getElementById(`tier-${exc.cap}-${lv}`);
          if (targetBtn && !rdSelections.has(exc.cap)) targetBtn.classList.add("disabled");
        }
      }
    }
  }

  for (const [capId, tier] of rdSelections.entries()) {
    const cap = rdCardCatalog.find((c) => c.cap_id === capId);
    const tierData = (cap?.tiers || {})[tier] || {};
    const hints = [];
    for (const req of tierData.requires || []) {
      const reqTier = rdSelections.get(req.cap);
      const order = { low: 1, mid: 2, high: 3 };
      const met = reqTier && order[reqTier] >= order[req.min_tier];
      if (!met) {
        const reqCap = rdCardCatalog.find((c) => c.cap_id === req.cap);
        const reqName = reqCap ? reqCap.name : req.cap;
        const cls = req.type === "hard" ? "dep-hard" : "dep-soft";
        const icon = req.type === "hard" ? "🚫" : "⚠️";
        hints.push(`<span class="${cls}">${icon} 需要「${escapeHtml(reqName)}」≥ ${escapeHtml(req.min_tier)}</span>`);
      }
    }
    const hintEl = document.getElementById(`dep-hint-${capId}`);
    if (hintEl) hintEl.innerHTML = hints.join("");
  }
}

function toggleCardTier(capId, tier) {
  if (!capId || !tier) return;
  const cap = rdCardCatalog.find((c) => c.cap_id === capId);
  if (!cap) return;
  const current = rdSelections.get(capId);
  const groupCount = rdCardCatalog.filter((c) => c.group_id === cap.group_id && rdSelections.has(c.cap_id)).length;

  if (current === tier) {
    rdSelections.delete(capId);
  } else if (current) {
    rdSelections.set(capId, tier);
  } else {
    if (rdSelections.size >= 10) {
      showToast("最多选 10 张");
      return;
    }
    if (groupCount >= cap.group_max) {
      showToast(`「${cap.group_name}」最多选 ${cap.group_max} 张`);
      return;
    }
    rdSelections.set(capId, tier);
  }

  updateCardUI();
  updateRdSelectionUi();
  renderRdPreview();
  validateRdSelections().catch(() => {});
}

function clip(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function renderRdPreview() {
  const selected = rdCardCatalog
    .filter((c) => rdSelections.has(c.cap_id))
    .map((c) => {
      const tier = rdSelections.get(c.cap_id);
      const tp = (c.tiers || {})[tier] || {};
      return { ...c, selectedTier: tier, tierParams: tp };
    });
  const count = selected.length;
  const countSafe = Math.max(1, count);

  const strategy = JSON.parse(localStorage.getItem("round1_strategy") || "{}");
  const P = Number(strategy.price || 12800);
  const f = Number(strategy.channelFee ?? state.activeTeam?.round1?.round1ChannelFee ?? 0.15);
  const COGSbase = Number(strategy.cogsBase || 6000);
  const TAMunits = Number(strategy.tamUnits || 500000);
  const H = Number(strategy.reachRate || 0.05);

  const dCOGS = selected.reduce((acc, c) => acc + Number(c.tierParams.dCOGS || 0), 0);
  const risk = selected.reduce((acc, c) => acc + Number(c.tierParams.risk || 0), 0);
  const riskAvg = risk / countSafe;
  const subLiftSum = selected.reduce((acc, c) => acc + Number(c.tierParams.sub_lift || 0), 0);
  const subLiftAvg = subLiftSum / countSafe;
  const perfAvg =
    selected.reduce((acc, c) => acc + Math.round(Math.exp(-2 * Number(c.tierParams.risk || 0)) * 100), 0) / countSafe;

  const high = selected.filter((c) => Number(c.tierParams.sub_lift || 0) >= 0.07).length;
  const med = selected.filter(
    (c) => Number(c.tierParams.sub_lift || 0) >= 0.04 && Number(c.tierParams.sub_lift || 0) < 0.07
  ).length;
  const low = selected.filter((c) => Number(c.tierParams.sub_lift || 0) >= 0 && Number(c.tierParams.sub_lift || 0) < 0.04).length;
  const neg = selected.filter((c) => Number(c.tierParams.sub_lift || 0) < 0).length;

  let fit = 0;
  const recommended = Array.isArray(rdGridMeta?.recommended_capabilities) ? rdGridMeta.recommended_capabilities : [];
  const w = rdGridMeta?.recommended_capability_weights_v4 || {};
  for (const c of selected) {
    if (recommended.includes(c.cap_id) && w[c.cap_id]) fit += Number(w[c.cap_id]);
  }

  const shareMid = clip((0.05 + fit * 0.22 - risk * 0.03) * (count / 10 || 0), 0.01, 0.45);
  const shareLow = clip(shareMid - 0.04, 0.01, 0.45);
  const shareHigh = clip(shareMid + 0.04, 0.01, 0.55);

  const hwPerUnit = P * (1 - f) - (COGSbase + dCOGS);
  const attach = clip(0.08 + 0.08 * 0.7 + 0.25 * subLiftAvg - 0.10 * riskAvg, 0.02, 0.50);
  const subLtv = attach * 199 * 0.7 * 12;
  const estUnits = TAMunits * H * shareMid;
  const totalProfit = (hwPerUnit + subLtv) * estUnits;

  if (els.rdKpiDcogs) {
    els.rdKpiDcogs.textContent = `${dCOGS >= 0 ? "+" : ""}${fmt(dCOGS)} 元`;
    els.rdKpiDcogs.style.color = dCOGS > 800 ? "#b42318" : "";
  }
  if (els.rdKpiPerf) els.rdKpiPerf.textContent = `${Math.round(perfAvg)}/100`;
  if (els.rdKpiSublift) {
    els.rdKpiSublift.textContent = `高${high} / 中${med} / 低${low}${neg ? ` / 负${neg}` : ""}`;
  }
  if (els.rdKpiShare) {
    els.rdKpiShare.textContent =
      `低${(shareLow * 100).toFixed(0)}% / 中${(shareMid * 100).toFixed(0)}% / 高${(shareHigh * 100).toFixed(0)}%`;
  }

  if (els.rdBarHwValue) els.rdBarHwValue.textContent = `¥${fmt(hwPerUnit)}`;
  if (els.rdBarSubValue) els.rdBarSubValue.textContent = `¥${fmt(subLtv)}`;
  if (els.rdBarProfitValue) els.rdBarProfitValue.textContent = `¥${fmt(totalProfit)}`;

  const barReady = count >= 8 && count <= 10;
  if (els.rdPreviewPlaceholder) els.rdPreviewPlaceholder.style.display = barReady ? "none" : "block";
  if (els.rdPreviewBars) els.rdPreviewBars.classList.toggle("is-placeholder", !barReady);

  const maxAbs = Math.max(Math.abs(hwPerUnit), Math.abs(subLtv), Math.abs(totalProfit), 1);
  const hwW = `${Math.max(8, Math.round((Math.abs(hwPerUnit) / maxAbs) * 100))}%`;
  const subW = `${Math.max(8, Math.round((Math.abs(subLtv) / maxAbs) * 100))}%`;
  const profitW = `${Math.max(8, Math.round((Math.abs(totalProfit) / maxAbs) * 100))}%`;
  if (els.rdBarHwFill) els.rdBarHwFill.style.width = hwW;
  if (els.rdBarSubFill) els.rdBarSubFill.style.width = subW;
  if (els.rdBarProfitFill) els.rdBarProfitFill.style.width = profitW;
}

async function calculateRD() {
  const strategy = JSON.parse(localStorage.getItem("round1_strategy") || "{}");
  const radarStore = JSON.parse(localStorage.getItem("market_research_scores") || "{}");
  const tagStore = JSON.parse(localStorage.getItem("market_research_tags") || "[]");
  const radarScores = radarStore.scores || radarStore;
  const tags = Array.isArray(tagStore) && tagStore.length ? tagStore : radarStore.tags || [];
  const selections = Array.from(rdSelections.entries()).map(([cap_id, tier]) => ({ cap_id, tier }));
  if (selections.length < 8 || selections.length > 10) {
    alert("总选卡必须在 8-10 张之间");
    return;
  }
  if (Array.isArray(rdValidation.violations) && rdValidation.violations.length > 0) {
    showToast("存在硬性约束冲突，请先修正");
    return;
  }

  const payload = {
    gridId: normalizeGridId(strategy),
    P: Number(strategy.price || 12800),
    Pmax: Number(strategy.priceMax || 15000),
    f: Number(strategy.channelFee ?? state.activeTeam?.round1?.round1ChannelFee ?? 0.15),
    COGSbase: Number(strategy.cogsBase || 6000),
    TAMunits: Number(strategy.tamUnits || 500000),
    H: Number(strategy.reachRate || 0.05),
    radarScores,
    tags,
    priceSensitive: Boolean(strategy.priceSensitive || false),
    selections
  };
  setRdCalculating(true);
  let result;
  try {
    const res = await fetch("/api/rd/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    result = await res.json();
    if (!result.ok) {
      alert(`计算失败：${result.error || "unknown error"}`);
      return;
    }

    const saveResult = { ...result, radarScores, tags };
    localStorage.setItem("rd_result", JSON.stringify(saveResult));

  if (els.rdShare) els.rdShare.textContent = `${(Number(result.share || 0) * 100).toFixed(1)}%`;
  if (els.rdUnits) els.rdUnits.textContent = `${Number(result.units || 0).toLocaleString()} 台`;
  if (els.rdProfit) els.rdProfit.textContent = `¥${Number(result.profit || 0).toLocaleString()}`;
  if (els.rdProfitHw) els.rdProfitHw.textContent = `¥${Number(result.profit_hw || 0).toLocaleString()}`;
  if (els.rdProfitSub) els.rdProfitSub.textContent = `¥${Number(result.profit_sub || 0).toLocaleString()}`;
  if (els.rdAttach) els.rdAttach.textContent = `${(Number(result.attach || 0) * 100).toFixed(0)}%`;
  if (els.rdFit) els.rdFit.textContent = Number(result.fit || 0).toFixed(3);
  if (els.rdCovercore) els.rdCovercore.textContent = `${(Number(result.covercore || 0) * 100).toFixed(0)}%`;
  if (els.rdCovernice) els.rdCovernice.textContent = `${(Number(result.covernice || 0) * 100).toFixed(0)}%`;
  if (els.rdEvi) els.rdEvi.textContent = Number(result.evi || 0).toFixed(2);
  if (els.rdEviDetail) {
    if (result.evi_detail && result.evi_detail.evidence) {
      const d = result.evi_detail;
      els.rdEviDetail.textContent =
        `(q=${Number(d.q || 0).toFixed(2)} × pT=${Number(d.pT || 0).toFixed(2)} | ` +
        `守约束:${d.evidence.adherence} 角色:${d.evidence.role} 一致性:${d.evidence.coherence})`;
    } else {
      els.rdEviDetail.textContent = "";
    }
  }
  if (els.rdI) els.rdI.textContent = Number(result.I || 0).toFixed(3);
  if (els.rdZ) els.rdZ.textContent = Number(result.z || 0).toFixed(3);
  if (els.rdRisk) els.rdRisk.textContent = Number(result.risk || 0).toFixed(2);
  if (els.rdComplexity) els.rdComplexity.textContent = Number(result.complexity || 0).toFixed(2);
  if (els.rdDcogs) {
    const dCogs = Number(result.dCOGS || 0);
    els.rdDcogs.textContent = `${dCogs >= 0 ? "+" : ""}${dCogs} 元/台`;
  }
  if (els.rdLoad) {
    const cap = Number(result.softPenalties?.capacity?.capacityCap || rdCapacityCap || 24);
    els.rdLoad.textContent = `${Number(result.load || 0)} / ${cap}`;
  }
  if (els.rdBudgetStatus) {
    const b = result.softPenalties?.budget || {};
    const over = b.overBudget ? " ⚠️超预算" : " ✓";
    els.rdBudgetStatus.textContent = `${Number(b.positiveDCOGS || 0)} / ${Number(b.budgetCap || 0)}${over}`;
  }
  if (els.rdZPenalty) els.rdZPenalty.textContent = Number(result.z_penalty || 0).toFixed(2);
  updateEmoji(Number(result.covercore || 0));

    if (els.rdResultBlock) els.rdResultBlock.style.display = "block";
  } finally {
    setRdCalculating(false);
  }
}

async function generateAnalysis() {
  const result = JSON.parse(localStorage.getItem("rd_result") || "{}");
  const strategy = JSON.parse(localStorage.getItem("round1_strategy") || "{}");
  const tags = result.tags || JSON.parse(localStorage.getItem("market_research_tags") || "[]");
  if (!result || (!result.selectedCards && !result.selections)) {
    alert("请先完成 R&D 计算");
    return;
  }

  if (els.btnAnalysis) {
    els.btnAnalysis.textContent = "生成中...";
    els.btnAnalysis.disabled = true;
  }

  try {
    const res = await fetch("/api/rd/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result, strategy, tags })
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(`分析失败: ${text || res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    if (els.rdAnalysisContent) els.rdAnalysisContent.style.display = "block";
    if (els.rdAnalysisText) els.rdAnalysisText.innerHTML = "";

    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const text = parsed.delta?.text || "";
          if (els.rdAnalysisText) {
            els.rdAnalysisText.innerHTML += escapeHtml(text).replace(/\n/g, "<br>");
          }
        } catch (_) {}
      }
    }
  } finally {
    if (els.btnAnalysis) {
      els.btnAnalysis.textContent = "重新生成";
      els.btnAnalysis.disabled = false;
    }
  }
}

window.toggleCardTier = toggleCardTier;
window.calculateRD = calculateRD;
window.generateAnalysis = generateAnalysis;

function updateEmoji(covercore) {
  if (!els.rdEmoji || !els.rdEmojiLabel) return;
  if (covercore >= 0.7) {
    els.rdEmoji.textContent = "😊";
    els.rdEmojiLabel.textContent = "客户核心需求高度满足";
    els.rdEmojiLabel.style.color = "#16a34a";
  } else if (covercore >= 0.4) {
    els.rdEmoji.textContent = "😐";
    els.rdEmojiLabel.textContent = "客户核心需求部分满足";
    els.rdEmojiLabel.style.color = "#d97706";
  } else {
    els.rdEmoji.textContent = "😞";
    els.rdEmojiLabel.textContent = "客户核心需求未被满足";
    els.rdEmojiLabel.style.color = "#dc2626";
  }
}

function showToast(msg) {
  let toast = document.getElementById("rd-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "rd-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = String(msg || "");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function setLlmStatus(kind, text) {
  if (!els.llmStatus) return;
  els.llmStatus.textContent = text || "";
  if (kind) {
    els.llmStatus.dataset.state = kind;
  } else {
    delete els.llmStatus.dataset.state;
  }
}

function setLlmBusy(isBusy, label) {
  if (isBusy) {
    const startLabel = String(label || "AI正在思考");
    llmUi.busySince = Date.now();
    setLlmStatus("busy", `${startLabel} · 0s`);
    if (llmUi.timer) clearInterval(llmUi.timer);
    llmUi.timer = setInterval(() => {
      const sec = Math.max(0, Math.floor((Date.now() - llmUi.busySince) / 1000));
      setLlmStatus("busy", `${startLabel} · ${sec}s`);
    }, 400);
  } else {
    if (llmUi.timer) {
      clearInterval(llmUi.timer);
      llmUi.timer = null;
    }
    if (els.llmStatus?.dataset?.state === "busy") {
      setLlmStatus("", "");
    }
  }
  if (els.coachSend) {
    if (isBusy) {
      llmUi.sendBtnText = els.coachSend.textContent || llmUi.sendBtnText;
      els.coachSend.textContent = "…";
      els.coachSend.title = "AI 思考中";
    } else {
      els.coachSend.textContent = llmUi.sendBtnText || "↑";
      els.coachSend.title = "发送";
    }
  }
  [els.llmPain, els.llmArchetypes, els.llmFeatures, els.llmSummary, els.llmApplyRound1].forEach((btn) => {
    if (btn) btn.disabled = Boolean(isBusy);
  });
  coachButtonsEnabled(!isBusy);
  if (els.coachApplyRound1) {
    if (isBusy) {
      els.coachApplyRound1.disabled = true;
    } else {
      const c = state.activeTeam?.coach;
      els.coachApplyRound1.disabled = !(c?.canSubmit && String(c?.chatSession?.vp_final || "").trim());
    }
  }
}

function renderFeatureCausalTable(features) {
  if (!els.llmFeaturesTable) return;
  const rows = Array.isArray(features?.core_features) ? features.core_features : [];
  if (!rows.length) {
    els.llmFeaturesTable.innerHTML = "";
    return;
  }
  const tr = rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${r.action || ""}</td><td>${r.mechanism || ""}</td><td>${r.benefit || ""}</td><td>${r.proof || ""}</td></tr>`
    )
    .join("");
  els.llmFeaturesTable.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>action</th><th>mechanism</th><th>benefit</th><th>proof</th></tr></thead>
      <tbody>${tr}</tbody>
    </table>
  `;
}

function refreshLlmOutputPanels() {
  const llm = state.activeTeam?.llmRound1 || {};
  if (els.llmPainOutput) {
    els.llmPainOutput.textContent = llm.pain ? JSON.stringify(llm.pain, null, 2) : "";
  }
  if (els.llmArchetypesOutput) {
    els.llmArchetypesOutput.textContent = llm.archetypes ? JSON.stringify(llm.archetypes, null, 2) : "";
  }
  renderFeatureCausalTable(llm.features);
  if (els.llmSummaryOutput) {
    const s = llm.summary;
    els.llmSummaryOutput.textContent = s
      ? JSON.stringify(
          {
            vp_one_liner: s.vp_one_liner,
            drivers: s.drivers,
            objections: s.objections,
            parameter_card: s.parameter_card,
            weakest_link: s.weakest_link,
            one_missing_evidence: s.one_missing_evidence
          },
          null,
          2
        )
      : "";
  }
  if (els.llmStory30s) {
    els.llmStory30s.value = llm.summary?.story_30s || "";
  }
  if (els.llmStory2min) {
    els.llmStory2min.value = llm.summary?.story_2min || "";
  }
}

async function llmRound1Pain() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.llmRound1Pain) throw new Error("后端 API 不可用，请启动 node server.js");
  setLlmBusy(true, "正在生成 Pain Card...");
  const payload = {
    ...llmIdentity(),
    decision_state: buildDecisionStateFromForm(),
    input_context: {
      free_text: String(els.llmContext?.value || "")
    }
  };
  try {
    const resp = await ApiClient.llmRound1Pain(payload);
    state.activeTeam.llmRound1 = state.activeTeam.llmRound1 || {};
    state.activeTeam.llmRound1.pain = resp.result;
    saveLocalState();
    refreshLlmOutputPanels();
  } finally {
    setLlmBusy(false);
  }
}

async function llmRound1Archetypes() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.llmRound1Archetypes) throw new Error("后端 API 不可用，请启动 node server.js");
  const pain = state.activeTeam?.llmRound1?.pain;
  if (!pain) throw new Error("请先生成 Pain Card");
  setLlmBusy(true, "正在生成 Archetypes...");
  const payload = {
    ...llmIdentity(),
    decision_state: buildDecisionStateFromForm(),
    pain_card: pain
  };
  try {
    const resp = await ApiClient.llmRound1Archetypes(payload);
    state.activeTeam.llmRound1 = state.activeTeam.llmRound1 || {};
    state.activeTeam.llmRound1.archetypes = resp.result;
    saveLocalState();
    refreshLlmOutputPanels();
  } finally {
    setLlmBusy(false);
  }
}

async function llmRound1Features() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.llmRound1Features) throw new Error("后端 API 不可用，请启动 node server.js");
  const llm = state.activeTeam?.llmRound1 || {};
  if (!llm.pain) throw new Error("请先生成 Pain Card");
  if (!llm.archetypes) throw new Error("请先生成 Archetypes");
  const selected = getSelectedArchetypeFromCache(llm);
  if (!selected) throw new Error("未找到匹配当前架构标签的 archetype");
  setLlmBusy(true, "Step3 生成 Feature Causal Chain...");
  const payload = {
    ...llmIdentity(),
    decision_state: buildDecisionStateFromForm(),
    pain_card: llm.pain,
    selected_archetype: selected
  };
  try {
    const resp = await ApiClient.llmRound1Features(payload);
    state.activeTeam.llmRound1.features = resp.result;
    saveLocalState();
    refreshLlmOutputPanels();
  } finally {
    setLlmBusy(false);
  }
}

async function llmRound1Summary() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.llmRound1Summary) throw new Error("后端 API 不可用，请启动 node server.js");
  const llm = state.activeTeam?.llmRound1 || {};
  if (!llm.pain || !llm.archetypes || !llm.features) {
    throw new Error("请先完成 pain / archetypes / features");
  }
  const selected = getSelectedArchetypeFromCache(llm);
  setLlmBusy(true, "Step4 生成 Story + Summary...");
  const payload = {
    ...llmIdentity(),
    decision_state: buildDecisionStateFromForm(),
    pain_card: llm.pain,
    selected_archetype: selected,
    feature_cards: llm.features
  };
  try {
    const resp = await ApiClient.llmRound1Summary(payload);
    state.activeTeam.llmRound1.summary = resp.result;
    saveLocalState();
    refreshLlmOutputPanels();
  } finally {
    setLlmBusy(false);
  }
}

function formatVpEvaluateResult(result) {
  const recap = String(result?.recap || "");
  const score = Number(result?.coherence_score || 0);
  const d = result?.coherence_diagnosis || {};
  const pf = result?.part_feedback || {};
  const risks = Array.isArray(result?.top_risks) ? result.top_risks : [];
  const qs = Array.isArray(result?.next_iteration_questions) ? result.next_iteration_questions : [];
  return [
    `复述：${recap}`,
    `一致性评分：${score}/100`,
    "",
    "一致性诊断：",
    `1) 场景-痛点：${d?.persona_pain?.status || ""}｜${d?.persona_pain?.why || ""}｜最小改动：${d?.persona_pain?.fix || ""}`,
    `2) 痛点-解法：${d?.pain_solution?.status || ""}｜${d?.pain_solution?.why || ""}｜最小改动：${d?.pain_solution?.fix || ""}`,
    `3) 解法-选择项：${d?.solution_choices?.status || ""}｜${d?.solution_choices?.why || ""}｜最小改动：${d?.solution_choices?.fix || ""}`,
    "",
    "分项反馈：",
    `场景+痛点 优势：${(pf?.persona?.strengths || []).join("；")}｜问题：${(pf?.persona?.issues || []).join("；")}｜改写：${pf?.persona?.rewrite_suggestion || ""}`,
    `解决方式 优势：${(pf?.pain?.strengths || []).join("；")}｜问题：${(pf?.pain?.issues || []).join("；")}｜改写：${pf?.pain?.rewrite_suggestion || ""}`,
    `价值主张 优势：${(pf?.solution?.strengths || []).join("；")}｜问题：${(pf?.solution?.issues || []).join("；")}｜改写：${pf?.solution?.rewrite_suggestion || ""}`,
    "",
    "Top 风险：",
    ...risks.map((x, i) => `${i + 1}. ${x}`),
    "",
    "下一轮追问：",
    ...qs.map((x, i) => `${i + 1}. ${x?.q || ""} 选项：${Array.isArray(x?.choices) ? x.choices.join(" / ") : ""}`),
    "",
    `VP 候选：${result?.vp_one_liner_candidate || ""}`
  ].join("\n");
}

function ensureVpState() {
  if (!state.activeTeam) return null;
  state.activeTeam.vpFlow = state.activeTeam.vpFlow || {
    step: 1,
    context_final: "",
    solution_final: "",
    vp_final: "",
    feedback: null
  };
  const vf = state.activeTeam.vpFlow;
  if (!vf.context_final && vf.persona_final) vf.context_final = vf.persona_final;
  if (!vf.solution_final && vf.pain_final) vf.solution_final = vf.pain_final;
  if (vf.step > 3 && !vf.vp_final) vf.step = 3;
  return state.activeTeam.vpFlow;
}

function vpInvalidReason(text) {
  const t = String(text || "").trim();
  if (t.length < 12) return "至少输入12个字";
  const placeholders = ["不知道", "不清楚", "随便", "na", "无", "机器人"];
  const low = t.toLowerCase();
  for (const p of placeholders) {
    if (low === p) return `不能使用占位词：${p}`;
  }
  return "";
}

function renderVpState() {
  const vf = state.activeTeam?.vpFlow || ensureVpState();
  if (!vf) return;
  if (els.vpFinalState) {
    els.vpFinalState.textContent = [
      `当前步骤: ${vf.step}`,
      `已锁定 context_final: ${vf.context_final || "（未锁定）"}`,
      `已锁定 solution_final: ${vf.solution_final || "（未锁定）"}`
    ].join("\n");
  }
  const contextText = String(els.vpContext?.value || "");
  const solutionText = String(els.vpSolutionWay?.value || "");
  const step = Number(vf.step || 1);
  if (els.vpHint1) els.vpHint1.disabled = step !== 1;
  if (els.vpHint2) els.vpHint2.disabled = step !== 2;
  if (els.vpFeedback1) els.vpFeedback1.disabled = step !== 1;
  if (els.vpFeedback2) els.vpFeedback2.disabled = step !== 2;
  if (els.vpLock1) els.vpLock1.disabled = step !== 1 || Boolean(vpInvalidReason(contextText));
  if (els.vpLock2) els.vpLock2.disabled = step !== 2 || Boolean(vpInvalidReason(solutionText));
  if (els.vpGenerate) els.vpGenerate.disabled = !(vf.context_final && vf.solution_final);
  const fb = vf.feedback || null;
  const readyForStep = fb && Number(fb.step) === step && fb.ready === true;
  if (els.vpLock1) els.vpLock1.classList.toggle("btn-ready", Boolean(readyForStep && step === 1));
  if (els.vpLock2) els.vpLock2.classList.toggle("btn-ready", Boolean(readyForStep && step === 2));
  if (els.vpApplyCandidate) els.vpApplyCandidate.disabled = !(fb && fb.rewrite_candidate);
}

function formatVpHintResult(result) {
  const how = Array.isArray(result?.how_to_answer) ? result.how_to_answer : [];
  const pitfalls = Array.isArray(result?.common_pitfalls) ? result.common_pitfalls : [];
  const q = result?.one_choice_question || {};
  return [
    result?.one_liner || "",
    "",
    "如何作答（3点）：",
    ...how.map((x, i) => `${i + 1}. ${x}`),
    "",
    "常见问题（2点）：",
    ...pitfalls.map((x, i) => `${i + 1}. ${x}`),
    "",
    `选择题：${q?.q || ""}`,
    Array.isArray(q?.choices) ? `选项：${q.choices.join(" / ")}` : ""
  ].join("\n");
}

function openVpHintModal() {
  if (els.vpHintModal) els.vpHintModal.style.display = "flex";
}

function closeVpHintModal() {
  if (els.vpHintModal) els.vpHintModal.style.display = "none";
}

function renderSuggestedAnswers(result, step) {
  if (!els.vpSuggestedAnswers) return;
  els.vpSuggestedAnswers.innerHTML = "";
  const list = Array.isArray(result?.suggested_answers) ? result.suggested_answers : [];
  list.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "btn secondary";
    btn.type = "button";
    btn.textContent = `${item?.label || "备选"}：${item?.text || ""}`;
    btn.addEventListener("click", () => {
      if (step === 1 && els.vpContext) els.vpContext.value = String(item?.text || "");
      if (step === 2 && els.vpSolutionWay) els.vpSolutionWay.value = String(item?.text || "");
      renderVpState();
    });
    els.vpSuggestedAnswers.appendChild(btn);
  });
}

function formatVpFeedbackCard(result) {
  const fixes = Array.isArray(result?.fixes) ? result.fixes : [];
  const q = result?.one_question || {};
  const choices = Array.isArray(q?.choices) ? q.choices : [];
  return [
    `结论: ${result?.verdict || "REVISE"}${result?.ready ? "（可最终确定）" : "（继续优化）"}`,
    result?.one_liner || "",
    "",
    "最小改法：",
    ...fixes.map((x, i) => `${i + 1}. ${x}`),
    "",
    `候选句：${result?.rewrite_candidate || ""}`,
    "",
    result?.ready
      ? "可最终确定：若你认同候选句，可直接应用后点“确定此版本”。"
      : `关键追问（单选）：${q?.q || ""}`,
    result?.ready ? "" : `选项：${choices.join(" / ")}`
  ].join("\n");
}

function renderVpFeedbackCard() {
  const vf = ensureVpState();
  const fb = vf?.feedback;
  if (!els.vpFeedbackCard) return;
  if (!fb) {
    els.vpFeedbackCard.textContent = "";
    if (els.vpFeedbackChoices) els.vpFeedbackChoices.innerHTML = "";
    return;
  }
  els.vpFeedbackCard.textContent = formatVpFeedbackCard(fb);
  renderVpFeedbackChoices(fb);
}

function appendChoiceToCurrentDraft(choiceText) {
  const vf = ensureVpState();
  const step = Number(vf?.step || 1);
  const text = String(choiceText || "").trim();
  if (!text) return;
  const inputEl = step === 1 ? els.vpContext : els.vpSolutionWay;
  if (!inputEl) return;
  const cur = String(inputEl.value || "").trim();
  const sep = cur ? "；" : "";
  inputEl.value = `${cur}${sep}${text}`;
  inputEl.focus();
  renderVpState();
}

function renderVpFeedbackChoices(fb) {
  if (!els.vpFeedbackChoices) return;
  els.vpFeedbackChoices.innerHTML = "";
  if (!fb || fb.ready) return;
  const q = fb.one_question || {};
  const choices = Array.isArray(q.choices) ? q.choices : [];
  choices.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn secondary";
    btn.textContent = String(c || "");
    btn.addEventListener("click", () => appendChoiceToCurrentDraft(c));
    els.vpFeedbackChoices.appendChild(btn);
  });
}

async function fetchVpFeedback(step) {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.round1VpFeedback) throw new Error("后端 API 不可用，请启动 node server.js");
  const vf = ensureVpState();
  if (Number(vf.step) !== Number(step)) throw new Error(`当前应进行第${vf.step}步`);
  const draft = step === 1 ? String(els.vpContext?.value || "").trim() : String(els.vpSolutionWay?.value || "").trim();
  const invalid = vpInvalidReason(draft);
  if (invalid) throw new Error(invalid);
  setLlmBusy(true, `正在点评 Step ${step}...`);
  try {
    const payload = {
      ...llmIdentity(),
      step,
      decision_state: buildDecisionStateFromForm(),
      draft_text: draft
    };
    if (step === 2) payload.context_final = String(vf.context_final || "");
    const resp = await ApiClient.round1VpFeedback(payload);
    vf.feedback = { ...(resp.result || {}), step };
    renderVpFeedbackCard();
    renderVpState();
    if (resp.debug?.prompts && els.vpFeedbackCard) {
      els.vpFeedbackCard.textContent += `\n\n[Debug]\nPROMPT_VERSION: ${resp.debug.prompt_version}\n\n[system_preview]\n${resp.debug.prompts.system_preview}\n\n[user_preview]\n${resp.debug.prompts.user_preview}`;
    }
    saveLocalState();
  } finally {
    setLlmBusy(false);
  }
}

function applyVpFeedbackCandidate() {
  ensureActiveTeamForLlm();
  const vf = ensureVpState();
  const fb = vf?.feedback;
  if (!fb?.rewrite_candidate) throw new Error("当前没有可应用的候选版本");
  if (Number(fb.step) === 1 && els.vpContext) {
    els.vpContext.value = String(fb.rewrite_candidate);
  } else if (Number(fb.step) === 2 && els.vpSolutionWay) {
    els.vpSolutionWay.value = String(fb.rewrite_candidate);
  }
  renderVpState();
}

async function fetchVpHint(step) {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.round1VpHint) throw new Error("后端 API 不可用，请启动 node server.js");
  const vf = ensureVpState();
  if (Number(vf.step) !== Number(step)) throw new Error(`当前应进行第${vf.step}步`);
  setLlmBusy(true, `正在生成 Step ${step} 写作提示...`);
  try {
    const resp = await ApiClient.round1VpHint({
      ...llmIdentity(),
      decision_state: buildDecisionStateFromForm(),
      step,
      action: "hint",
      context_final: vf.context_final,
      solution_final: vf.solution_final
    });
    if (resp.session_state) state.activeTeam.vpFlow = resp.session_state;
    if (els.vpStepHint) {
      els.vpStepHint.textContent = formatVpHintResult(resp.result);
      if (resp.debug?.prompts) {
        els.vpStepHint.textContent += `\n\n[Debug]\nPROMPT_VERSION: ${resp.debug.prompt_version}\n\n[system_preview]\n${resp.debug.prompts.system_preview}\n\n[user_preview]\n${resp.debug.prompts.user_preview}`;
      }
    }
    renderSuggestedAnswers(resp.result, step);
    openVpHintModal();
    renderVpState();
    saveLocalState();
  } finally {
    setLlmBusy(false);
  }
}

async function evaluateRound1VpFinal() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.round1VpEvaluate) throw new Error("后端 API 不可用，请启动 node server.js");
  const vf = ensureVpState();
  if (!vf.context_final || !vf.solution_final || !vf.vp_final) {
    throw new Error("请先锁定Step1/Step2并生成价值主张");
  }
  setLlmBusy(true, "正在评估与改进建议...");
  try {
    const resp = await ApiClient.round1VpEvaluate({
      ...llmIdentity(),
      decision_state: buildDecisionStateFromForm(),
      context_final: vf.context_final,
      solution_final: vf.solution_final,
      vp_final: vf.vp_final
    });
    if (resp.session_state) state.activeTeam.vpFlow = resp.session_state;
    if (els.vpEvaluateOutput) {
      els.vpEvaluateOutput.textContent = formatVpEvaluateResult(resp.result);
      if (resp.debug?.prompts) {
        els.vpEvaluateOutput.textContent += `\n\n[Debug]\nPROMPT_VERSION: ${resp.debug.prompt_version}\n\n[system_preview]\n${resp.debug.prompts.system_preview}\n\n[user_preview]\n${resp.debug.prompts.user_preview}`;
      }
    }
    renderVpState();
    saveLocalState();
  } finally {
    setLlmBusy(false);
  }
}

async function commitVpStep(step) {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.round1VpHint) throw new Error("后端 API 不可用，请启动 node server.js");
  const vf = ensureVpState();
  if (Number(vf.step) !== Number(step)) throw new Error(`当前应进行第${vf.step}步`);
  const text = step === 1 ? String(els.vpContext?.value || "").trim() : String(els.vpSolutionWay?.value || "").trim();
  if (!text) throw new Error(`Step ${step} 文本不能为空`);
  const invalid = vpInvalidReason(text);
  if (invalid) throw new Error(invalid);
  setLlmBusy(true, `正在锁定 Step ${step}...`);
  try {
    const resp = await ApiClient.round1VpHint({
      ...llmIdentity(),
      decision_state: buildDecisionStateFromForm(),
      step,
      action: "commit",
      current_text: text
    });
    if (resp.session_state) state.activeTeam.vpFlow = resp.session_state;
    if (state.activeTeam?.vpFlow) state.activeTeam.vpFlow.feedback = null;
    renderVpFeedbackCard();
    renderVpState();
    saveLocalState();
  } finally {
    setLlmBusy(false);
  }
}

async function generateVpFinal() {
  ensureActiveTeamForLlm();
  if (!window.ApiClient?.round1VpGenerate) throw new Error("后端 API 不可用，请启动 node server.js");
  const vf = ensureVpState();
  if (!vf.context_final || !vf.solution_final) throw new Error("请先锁定Step1和Step2");
  setLlmBusy(true, "正在生成价值主张...");
  try {
    const resp = await ApiClient.round1VpGenerate({
      ...llmIdentity(),
      decision_state: buildDecisionStateFromForm(),
      context_final: vf.context_final,
      solution_final: vf.solution_final
    });
    vf.vp_final = String(resp?.result?.vp_final || "");
    if (els.vpGenerateOutput) {
      els.vpGenerateOutput.textContent = `VP Final:\n${vf.vp_final || "（空）"}`;
      if (resp.debug?.prompts) {
        els.vpGenerateOutput.textContent += `\n\n[Debug]\nPROMPT_VERSION: ${resp.debug.prompt_version}\n\n[system_preview]\n${resp.debug.prompts.system_preview}\n\n[user_preview]\n${resp.debug.prompts.user_preview}`;
      }
    }
    await evaluateRound1VpFinal();
    renderVpState();
    saveLocalState();
  } finally {
    setLlmBusy(false);
  }
}

function applySummaryToRound1() {
  ensureActiveTeamForLlm();
  if (!state.activeTeam.round1) throw new Error("请先计算 Round 1");
  const summary = state.activeTeam?.llmRound1?.summary;
  if (!summary) throw new Error("请先生成 Final Summary");

  const story30 = String(els.llmStory30s?.value || summary.story_30s || "");
  const story2 = String(els.llmStory2min?.value || summary.story_2min || "");
  state.activeTeam.llmRound1.summary.story_30s = story30;
  state.activeTeam.llmRound1.summary.story_2min = story2;

  state.activeTeam.round1.vpOneLiner = summary.vp_one_liner;
  state.activeTeam.round1.drivers = Array.isArray(summary.drivers) ? summary.drivers : [];
  state.activeTeam.round1.parameterCard = summary.parameter_card || {};
  state.activeTeam.round1.story30s = story30;
  state.activeTeam.round1.story2min = story2;
  state.activeTeam.round1.objections = Array.isArray(summary.objections) ? summary.objections : [];
  state.activeTeam.round1.weakestLink = summary.weakest_link || "";

  saveLocalState();
  setLlmStatus("success", "已应用到 Round1 state（vpOneLiner/drivers/parameterCard）");
}

async function loadEngineConfigBrowser() {
  const read = async (name) => {
    const res = await fetch(`game_config_v0.1/${name}`);
    if (!res.ok) throw new Error(`load config failed: ${name}`);
    return res.json();
  };
  return {
    lovot_baseline: await read("lovot_baseline.json"),
    market_knowledge: await read("market_knowledge.json"),
    feature_cards: await read("feature_cards.json"),
    pricing_rules: await read("pricing_rules.json"),
    demand_model: await read("demand_model.json"),
    subscription_model: await read("subscription_model.json"),
    round1_gm_model: await read("round1_gm_model.json")
  };
}

function currentChannels() {
  const c1 = els.channel1.value;
  const c2 = els.channel2.value;
  const channels = [c1];
  if (c2 && c2 !== "none" && c2 !== c1) channels.push(c2);
  return channels;
}

function normalizeRound1Channel(c) {
  return c;
}

function round1ChannelsAndShare() {
  const c1 = normalizeRound1Channel(els.r1Channel1.value || "DIRECT");
  const c2 = normalizeRound1Channel(els.r1Channel2.value || "ECOM");
  const share1 = Number(els.r1ChannelShare.value) / 100;
  return { channels: [c1, c2], channelShare: [share1, 1 - share1] };
}

function updateRound1ChannelPreview() {
  const decision = round1ChannelsAndShare();
  const [c1, c2] = decision.channels;
  const [s1, s2] = decision.channelShare;
  if (c1 === c2) {
    els.r1ChannelShareLabel.textContent = "渠道1和渠道2不能相同。";
    els.r1ChannelFeePreview.textContent = "";
    return;
  }
  els.r1ChannelShareLabel.textContent = `${c1}: ${(s1 * 100).toFixed(0)}% | ${c2}: ${(s2 * 100).toFixed(0)}%`;

  const feeTable = state.engineConfig?.round1_gm_model?.channel_fee_rate;
  if (!feeTable) {
    els.r1ChannelFeePreview.textContent = "加权渠道费: 配置加载后显示";
    return;
  }
  const fee = s1 * Number(feeTable[c1] || 0) + s2 * Number(feeTable[c2] || 0);
  els.r1ChannelFeePreview.textContent = `加权渠道费（Round1）: ${(fee * 100).toFixed(1)}%`;
}

function updateTargetGmLabel() {
  const v = clamp(Number(state.activeTeam?.round1?.targetGmSuggested ?? 0.35), 0.2, 0.7);
  if (els.r1TargetGm) {
    els.r1TargetGm.value = v.toFixed(2);
  }
  if (els.r1TargetGmLabel) {
    els.r1TargetGmLabel.textContent = `target_gm 采用系统推荐值: ${(v * 100).toFixed(1)}%（计算 Round 1 后自动冻结；若要修改请重新开始 Round 1）`;
  }
}

function round1Diagnosis(pmfScore) {
  if (!Number.isFinite(pmfScore)) return "待计算";
  if (pmfScore >= 75) return "方向强，可进入落地";
  if (pmfScore >= 60) return "方向可行，但需在需求匹配上补强";
  return "方向偏弱，建议调整渠道/架构/分段";
}

function renderRound1Output(round1) {
  if (!els.round1Output || !round1) return;
  const frozenText = round1.isFrozen ? `${(Number(round1.targetGm || 0) * 100).toFixed(1)}%` : "未冻结";
  els.round1Output.textContent = [
    `目标格子: ${round1.key}`,
    `PMF宏观评分(经济代理): ${Number(round1.pmfScore || 0).toFixed(1)} / 100`,
    `诊断: ${round1Diagnosis(Number(round1.pmfScore || 0))}`,
    `channel_fee = ${(Number(round1.round1ChannelFee || 0) * 100).toFixed(1)}%`,
    `GM_max = ${(Number(round1.gmMax || 0) * 100).toFixed(1)}%`,
    `recommended target_gm = ${(Number(round1.targetGmSuggested || 0) * 100).toFixed(1)}%`,
    `frozen target_gm = ${frozenText}`,
    `note: Round2 uses frozen target_gm; cannot change in iterations`
  ].join("\n");
}

function setRound1FrozenUI(isFrozen) {
  if (els.r1TargetGm) {
    els.r1TargetGm.disabled = isFrozen;
  }
  if (els.freezeTargetGm) els.freezeTargetGm.disabled = isFrozen;
  els.r1Channel1.disabled = isFrozen;
  els.r1Channel2.disabled = isFrozen;
  els.r1ChannelShare.disabled = isFrozen;
}

function validateTargetGmSelection() {
  const team = state.activeTeam;
  const gmMax = Number(team?.round1?.gmMax);
  if (!Number.isFinite(gmMax)) {
    els.r1GmError.textContent = "请先计算 Round 1 以获得 GM_max。";
    if (els.freezeTargetGm) els.freezeTargetGm.disabled = true;
    return false;
  }
  const target = clamp(Number(team?.round1?.targetGmSuggested ?? 0.35), 0.2, 0.7);
  if (team?.round1) {
    team.round1.targetGm = target;
  }
  if (els.r1TargetGm) {
    els.r1TargetGm.value = target.toFixed(2);
  }
  if (target > gmMax) {
    els.r1GmError.textContent = `target_gm 不能高于 GM_max ${(gmMax * 100).toFixed(1)}%。`;
    if (els.freezeTargetGm) els.freezeTargetGm.disabled = true;
    return false;
  }
  els.r1GmError.textContent = "";
  if (!team.round1?.isFrozen) {
    if (els.freezeTargetGm) els.freezeTargetGm.disabled = false;
  }
  return true;
}

function refreshChannelOptionsForCell(cellMacroX) {
  const market = state.engineConfig?.market_knowledge?.[cellMacroX];
  if (!market) return;
  const keys = Object.keys(market.channel_fee_rate || {});
  if (!keys.length) return;
  const channel2Options = ["none", ...keys];
  populateSelect(els.channel1, keys);
  populateSelect(els.channel2, channel2Options, (v) => (v === "none" ? "无" : v));
  els.channel1.value = keys[0];
  els.channel2.value = "none";
}

function computeRound2(input) {
  const { round1, selectedCards, subscriptionTierKey, complianceTierKey, iterations } = input;
  if (!state.engineConfig) throw new Error("引擎配置尚未加载完成");
  if (!window.Engine?.simulateRound2) throw new Error("Engine.simulateRound2 不可用");
  if (!round1?.isFrozen) throw new Error("请先在 Round 1 计算并冻结参数");

  const teamState = {
    cell_id: round1.key,
    cell_macro_x: round1.key,
    round1: {
      cell_id: round1.cellIdForEngine || round1.key,
      value_weights: round1.valueWeights || defaultValueWeights(round1.archTag),
      channels: round1.round1Channels,
      channel_share: round1.round1ChannelShare,
      target_gm: round1.targetGm,
      target_gm_suggested: round1.targetGmSuggested
    },
    round2: {
      selected_cards: selectedCards.map((c) => c.id),
      channels: currentChannels(),
      compliance_tier: mapComplianceTier(complianceTierKey),
      content_tier: els.contentTier.value || "MID",
      sub_price_tier: mapSubTier(subscriptionTierKey)
    }
  };

  const out = window.Engine.simulateRound2(teamState, state.engineConfig);
  return {
    selectedCardIds: selectedCards.map((c) => c.id),
    cardNames: selectedCards.map((c) => c.name),
    bomTotal: out.bom_total,
    cogs: out.cogs_unit,
    price: out.price,
    sales: out.units,
    hwRevenue: out.hw_revenue,
    hwProfit: out.hw_profit,
    fit: out.fit,
    subRevenue24: out.sub_revenue_24m,
    subProfit24: out.sub_profit_24m,
    totalProfit: out.total_profit,
    riskTag: out.risk_flag === "HIGH_RISK" ? "高风险/低合规" : `风险等级${out.risk_level}`,
    riskLevel: out.risk_level,
    riskFlag: out.risk_flag,
    channelFee: out.channel_fee,
    adoption: out.adoption,
    priceRatio: out.price_ratio,
    subPenetration: out.sub_penetration,
    subRetention: out.sub_retention,
    arpu: out.arpu,
    subTier: subscriptionTierKey,
    complianceTier: complianceTierKey,
    iterations
  };
}

function populateSelect(select, options, toLabel) {
  if (!select) return;
  select.innerHTML = "";
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = toLabel ? toLabel(value) : String(value);
    select.appendChild(option);
  });
}

function changeLabel(v) {
  const labels = {
    none: "无",
    swap_feature: "替换1张功能卡",
    change_sub: "调整订阅档",
    change_compliance: "调整合规档"
  };
  return labels[v];
}

function initialize() {
  loadLocalState();

  populateSelect(els.customerType, ["B2C", "B2B"]);
  populateSelect(els.strategy, ["DIFF", "COST"], (v) => (v === "DIFF" ? "差异化" : "成本领先"));
  populateSelect(els.ageGroup, ["ADULT", "ELDER", "CHILD"], (v) => ({ ADULT: "成人", ELDER: "老人", CHILD: "儿童" }[v]));
  populateSelect(els.archTag, ["Experience", "Hybrid", "Function"], (v) => ({ Experience: "体验", Hybrid: "混合", Function: "功能" }[v]));
  populateSelect(els.fitText, ["1.00", "0.95", "1.05"]);

  populateSelect(els.subscriptionTier, Object.keys(subscriptionTiers), (k) => subscriptionTiers[k].label);
  populateSelect(els.complianceTier, Object.keys(complianceTiers), (k) => complianceTiers[k].label);
  populateSelect(els.contentTier, ["LOW", "MID", "HIGH"], (v) => ({ LOW: "低", MID: "中", HIGH: "高" }[v]));
  populateSelect(els.channel1, ["DIRECT", "ECOM", "PARTNER", "SI"]);
  populateSelect(els.channel2, ["none", "DIRECT", "ECOM", "PARTNER", "SI"], (v) => (v === "none" ? "无" : v));
  populateSelect(els.r1Channel1, ["DIRECT", "DISTRIBUTOR", "ECOM"]);
  populateSelect(els.r1Channel2, ["DIRECT", "DISTRIBUTOR", "ECOM"]);
  populateSelect(els.changeSubTier, Object.keys(subscriptionTiers), (k) => subscriptionTiers[k].label);
  populateSelect(els.changeComplianceTier, Object.keys(complianceTiers), (k) => complianceTiers[k].label);

  populateSelect(els.personaQuestion, ["must", "budget", "process", "subscription", "privacy"], (q) => {
    const map = {
      must: "must-have / deal-breaker",
      budget: "预算逻辑",
      process: "采购流程",
      subscription: "订阅意愿",
      privacy: "隐私顾虑"
    };
    return map[q];
  });

  populateSelect(els.change1, ["none", "swap_feature", "change_sub", "change_compliance"], (v) => changeLabel(v));
  populateSelect(els.change2, ["none", "swap_feature", "change_sub", "change_compliance"], (v) => changeLabel(v));

  renderFeatureCards();
  bindEvents();
  els.customerType.value = LOVOT_CELL.customerType;
  els.strategy.value = "DIFF";
  els.ageGroup.value = "ADULT";
  els.archTag.value = "Experience";
  els.fitText.value = "1.00";
  els.r1Channel1.value = "DIRECT";
  els.r1Channel2.value = "ECOM";
  els.channel1.value = "ECOM";
  els.channel2.value = "none";
  els.contentTier.value = "MID";
  updateRound1ChannelPreview();
  updateTargetGmLabel();
  setRound1FrozenUI(Boolean(state.activeTeam?.round1?.isFrozen));
  refreshActiveTeamHint();
  if (state.activeTeam?.round1) {
    renderRound1Output(state.activeTeam.round1);
    unlockVpSection();
  }
  refreshLlmOutputPanels();
  renderCoachPinnedCard();
  renderCoachMessages();
  renderVpState();
  renderRanking();
  bootstrapPersistence();
  bootstrapEngineConfig();
  bootstrapCoachVersion();
  checkMarketingUnlock();
  if (!state.activeTeam) {
    startTeam("第1组");
  }
}

async function bootstrapPersistence() {
  if (window.ApiClient) {
    try {
      await ApiClient.health();
      state.persistenceMode = "server";
    } catch (_) {
      state.persistenceMode = "local";
    }
  }
  refreshDbStatus();
  refreshRankingFromServer();
}

async function bootstrapEngineConfig() {
  try {
    state.engineConfig = await loadEngineConfigBrowser();
    const key = cellKey(els.customerType.value, els.strategy.value, els.archTag.value);
    refreshChannelOptionsForCell(key);
  } catch (err) {
    els.round2Output.textContent = `引擎配置加载失败: ${err.message || err}`;
  }
}

async function bootstrapCoachVersion() {
  if (!els.coachPromptVersion) return;
  renderCoachDebugHeader();
  if (!window.ApiClient?.round1ChatHealth) {
    llmUi.promptVersionFallback = "n/a";
    renderCoachDebugHeader();
    return;
  }
  try {
    const out = await ApiClient.round1ChatHealth();
    llmUi.promptVersionFallback = String(out.prompt_version || "unknown");
    const changed = invalidateCoachByPromptVersion(llmUi.promptVersionFallback);
    const c = coachState();
    if (c) c.promptVersion = String(out.prompt_version || "unknown");
    if (changed) {
      saveLocalState();
      renderCoachMessages();
      setLlmStatus("success", `已切换到新Prompt版本（${llmUi.promptVersionFallback}），旧Coach会话已清空`);
    }
    renderCoachDebugHeader();
  } catch (_) {
    llmUi.promptVersionFallback = "offline";
    renderCoachDebugHeader();
  }
}

function renderFeatureCards() {
  if (!els.featureCards) return;
  els.featureCards.innerHTML = "";
  featureCards.forEach((card) => {
    const row = document.createElement("label");
    row.className = "card";
    row.innerHTML = `
      <input type="checkbox" value="${card.id}" />
      <div>
        <strong>${card.name}</strong>
        <div class="meta">ΔBOM ${card.deltaBom} | 风险 ${card.risk.toFixed(2)} | 订阅拉动 ${card.subLift.toFixed(2)}</div>
      </div>
    `;
    els.featureCards.appendChild(row);
  });
}

function getSelectedCards() {
  if (!els.featureCards) return [];
  const selectedIds = [...els.featureCards.querySelectorAll("input:checked")].map((el) => el.value);
  return featureCards.filter((c) => selectedIds.includes(c.id));
}

function startTeam(nameOverride) {
  const inputName = String(els.teamName?.value || "").trim();
  const team = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: String(nameOverride || inputName || `第${state.teams.length + 1}组`),
    setup: {},
    round1: null,
    round2: null,
    llmRound1: null,
    vpFlow: null,
    coach: null,
    iterations: 0,
    history: [],
    frozen: false
  };

  state.activeTeam = team;
  refreshActiveTeamHint();
  els.round1Output.textContent = "";
  els.round2Output.textContent = "";
  els.personaAnswer.textContent = "";
  els.iterationLog.textContent = "";
  els.teamSummary.textContent = "";
  if (els.llmPainOutput) els.llmPainOutput.textContent = "";
  if (els.llmArchetypesOutput) els.llmArchetypesOutput.textContent = "";
  if (els.llmFeaturesTable) els.llmFeaturesTable.innerHTML = "";
  if (els.llmSummaryOutput) els.llmSummaryOutput.textContent = "";
  if (els.vpEvaluateOutput) els.vpEvaluateOutput.textContent = "";
  if (els.vpFeedbackCard) els.vpFeedbackCard.textContent = "";
  if (els.vpFeedbackChoices) els.vpFeedbackChoices.innerHTML = "";
  if (els.vpStepHint) els.vpStepHint.textContent = "";
  if (els.vpFinalState) els.vpFinalState.textContent = "";
  if (els.llmStory30s) els.llmStory30s.value = "";
  if (els.llmStory2min) els.llmStory2min.value = "";
  if (els.llmStatus) els.llmStatus.textContent = "";
  setLlmStatus("", "");
  vpSessionId = "";
  resetVpReviewState();
  marketingSessionId = "";
  ["vp_session_id", "vp_canvas", "round1_strategy", "frozen_target_gm", "marketing_session_id", "market_research_scores"].forEach((k) =>
    localStorage.removeItem(k)
  );
  if (els.vpSection) els.vpSection.style.display = "none";
  if (els.vpCanvasBlock) els.vpCanvasBlock.style.display = "";
  if (els.vpChatBlock) els.vpChatBlock.style.display = "none";
  if (els.vpResultBlock) els.vpResultBlock.style.display = "none";
  if (els.vpChatMessages) els.vpChatMessages.innerHTML = "";
  if (els.marketingSection) els.marketingSection.style.display = "none";
  if (els.marketingStartBlock) els.marketingStartBlock.style.display = "";
  if (els.marketingInterviewBlock) els.marketingInterviewBlock.style.display = "none";
  if (els.marketingScoreBlock) els.marketingScoreBlock.style.display = "none";
  if (els.marketingChatMessages) els.marketingChatMessages.innerHTML = "";
  if (els.marketingTagsDisplay) els.marketingTagsDisplay.innerHTML = "";
  if (els.marketingDimensionDetails) els.marketingDimensionDetails.innerHTML = "";
  if (els.panelRound2) els.panelRound2.style.display = "none";
  renderCoachPinnedCard();
  renderCoachMessages();
  renderVpState();
  els.frozenGmDisplay.textContent = "Frozen target_gm (from Round 1): 未冻结";
  els.r1GmError.textContent = "";
  if (els.r1TargetGm) {
    els.r1TargetGm.value = "0.35";
  }
  updateTargetGmLabel();
  setRound1FrozenUI(false);
  if (els.featureCards) {
    els.featureCards.querySelectorAll("input").forEach((c) => {
      c.checked = false;
    });
  }
  saveLocalState();
}

async function runRound1() {
  if (!state.activeTeam) {
    alert("请先开始一个小组。");
    return;
  }
  if (state.activeTeam.round1?.isFrozen) {
    alert("Round 1 参数已冻结。请点击“重新开始 Round 1”后再重算。");
    return;
  }

  const customerType = els.customerType.value;
  const strategy = els.strategy.value;
  const ageGroup = els.ageGroup.value;
  const archTag = els.archTag.value;
  const fitText = Number(els.fitText.value);
  const key = cellKey(customerType, strategy, archTag);
  if (!state.engineConfig || !window.Engine?.evaluateRound1) {
    alert("引擎配置尚未加载完成，请稍后再试。");
    return;
  }

  const round1ChannelDecision = round1ChannelsAndShare();
  if (round1ChannelDecision.channels[0] === round1ChannelDecision.channels[1]) {
    alert("Round 1 渠道策略要求3选2，两个渠道不能相同。");
    return;
  }
  let round1Econ;
  const round1Payload = {
    customer_type: mapCustomerTypeToRound1(customerType),
    strategy: mapStrategyToRound1(strategy),
    age_group: ageGroup,
    arch_tag: archTag,
    fit_text: fitText,
    channels: [
      { name: round1ChannelDecision.channels[0], share: round1ChannelDecision.channelShare[0] },
      { name: round1ChannelDecision.channels[1], share: round1ChannelDecision.channelShare[1] }
    ]
  };
  try {
    if (state.persistenceMode === "server" && window.ApiClient?.computeRound1) {
      const resp = await ApiClient.computeRound1(round1Payload);
      round1Econ = resp.result;
    } else {
      round1Econ = window.Engine.evaluateRound1(
        {
          round1: round1Payload
        },
        state.engineConfig
      );
    }
  } catch (err) {
    alert(`Round 1 计算失败: ${err.message || err}`);
    return;
  }
  const pmfScore = clamp(Number(round1Econ.gm_final ?? round1Econ.gm_max) * 100, 0, 100);
  const recommended = Number(round1Econ.target_gm_suggested);
  if (recommended > Number(round1Econ.gm_max)) {
    if (els.r1TargetGm) {
      els.r1TargetGm.value = String(recommended.toFixed(2));
    }
    els.r1GmError.textContent = "GM_max 已变化，target_gm 已自动调回推荐值。";
  }
  updateTargetGmLabel();

  const data = {
    customerType,
    strategy,
    ageGroup,
    archTag,
    fitText,
    key,
    valueProp: mapArchToValueProp(archTag),
    valueWeights: defaultValueWeights(archTag),
    cellIdForEngine: key,
    round1Channels: round1ChannelDecision.channels,
    round1ChannelShare: round1ChannelDecision.channelShare,
    round1ChannelFee: Number(round1Econ.channel_fee),
    targetGmSuggested: round1Econ.target_gm_suggested,
    gmMax: Number(round1Econ.gm_max),
    targetGm: recommended,
    isFrozen: true,
    pmfScore: clamp(pmfScore, 0, 100)
  };

  state.activeTeam.round1 = data;
  state.activeTeam.coach = null;
  refreshChannelOptionsForCell(key);
  renderCoachPinnedCard();
  renderCoachMessages();
  validateTargetGmSelection();
  setRound1FrozenUI(true);
  refreshActiveTeamHint();

  renderRound1Output(state.activeTeam.round1);
  saveLocalState();
  unlockVpSection();
  vpSessionId = "";
  resetVpReviewState();
  if (els.vpCanvasBlock) els.vpCanvasBlock.style.display = "";
  if (els.vpChatBlock) els.vpChatBlock.style.display = "none";
  if (els.vpResultBlock) els.vpResultBlock.style.display = "none";
  if (els.vpChatMessages) els.vpChatMessages.innerHTML = "";
  if (els.vpSubmitCanvasBtn) {
    els.vpSubmitCanvasBtn.disabled = false;
    els.vpSubmitCanvasBtn.textContent = "提交 VP -> 开始 AI 点评";
  }
}

function askPersona() {
  if (!state.activeTeam?.round1) {
    alert("请先完成 Round 1。");
    return;
  }
  const persona = personaDB[state.activeTeam.round1.key];
  const q = els.personaQuestion.value;
  els.personaAnswer.textContent = `${persona.name}: ${persona.answers[q]}`;
}

async function freezeTargetGm() {
  const team = state.activeTeam;
  if (!team?.round1) {
    alert("请先计算 Round 1。");
    return;
  }
  if (!validateTargetGmSelection()) return;

  const target = Number(team.round1.targetGmSuggested);
  team.round1.targetGm = target;
  team.round1.isFrozen = true;
  setRound1FrozenUI(true);
  refreshActiveTeamHint();

  renderRound1Output(team.round1);
  saveLocalState();

  try {
    await coachCreateSession();
  } catch (err) {
    setLlmStatus("error", `冻结成功，但自动启动 Coach 失败: ${err.message || err}`);
  }
}

function resetRound1() {
  const team = state.activeTeam;
  if (!team) return;
  team.round1 = null;
  team.round2 = null;
  team.llmRound1 = null;
  team.vpFlow = null;
  team.coach = null;
  team.iterations = 0;
  team.history = [];
  els.round1Output.textContent = "";
  els.round2Output.textContent = "";
  els.iterationLog.textContent = "";
  els.r1GmError.textContent = "";
  if (els.llmPainOutput) els.llmPainOutput.textContent = "";
  if (els.llmArchetypesOutput) els.llmArchetypesOutput.textContent = "";
  if (els.llmFeaturesTable) els.llmFeaturesTable.innerHTML = "";
  if (els.llmSummaryOutput) els.llmSummaryOutput.textContent = "";
  if (els.vpEvaluateOutput) els.vpEvaluateOutput.textContent = "";
  if (els.vpFeedbackCard) els.vpFeedbackCard.textContent = "";
  if (els.vpFeedbackChoices) els.vpFeedbackChoices.innerHTML = "";
  if (els.vpStepHint) els.vpStepHint.textContent = "";
  if (els.vpFinalState) els.vpFinalState.textContent = "";
  if (els.llmStory30s) els.llmStory30s.value = "";
  if (els.llmStory2min) els.llmStory2min.value = "";
  setLlmStatus("", "");
  renderCoachPinnedCard();
  renderCoachMessages();
  renderVpState();
  vpSessionId = "";
  resetVpReviewState();
  marketingSessionId = "";
  ["vp_session_id", "vp_canvas", "round1_strategy", "frozen_target_gm", "marketing_session_id", "market_research_scores"].forEach((k) =>
    localStorage.removeItem(k)
  );
  if (els.vpSection) els.vpSection.style.display = "none";
  if (els.vpCanvasBlock) els.vpCanvasBlock.style.display = "";
  if (els.vpChatBlock) els.vpChatBlock.style.display = "none";
  if (els.vpResultBlock) els.vpResultBlock.style.display = "none";
  if (els.vpChatMessages) els.vpChatMessages.innerHTML = "";
  if (els.marketingSection) els.marketingSection.style.display = "none";
  if (els.marketingStartBlock) els.marketingStartBlock.style.display = "";
  if (els.marketingInterviewBlock) els.marketingInterviewBlock.style.display = "none";
  if (els.marketingScoreBlock) els.marketingScoreBlock.style.display = "none";
  if (els.marketingChatMessages) els.marketingChatMessages.innerHTML = "";
  if (els.marketingTagsDisplay) els.marketingTagsDisplay.innerHTML = "";
  if (els.marketingDimensionDetails) els.marketingDimensionDetails.innerHTML = "";
  if (els.panelRound2) els.panelRound2.style.display = "none";
  refreshActiveTeamHint();
  setRound1FrozenUI(false);
  saveLocalState();
}

function runRound2() {
  if (!state.activeTeam?.round1) {
    alert("请先完成 Round 1。");
    return;
  }
  const selectedCards = getSelectedCards();
  if (selectedCards.length !== 6) {
    alert("请严格选择 6 张功能卡。");
    return;
  }

  let result;
  try {
    result = computeRound2({
      round1: state.activeTeam.round1,
      selectedCards,
      subscriptionTierKey: els.subscriptionTier.value,
      complianceTierKey: els.complianceTier.value,
      iterations: state.activeTeam.iterations
    });
  } catch (err) {
    alert(`Round 2 计算失败: ${err.message || err}`);
    return;
  }

  state.activeTeam.round2 = result;
  state.activeTeam.history.push({ ...result });
  els.round2Output.textContent = formatRound2Output(state.activeTeam);
  saveLocalState();
}

function formatRound2Output(team) {
  const r2 = team.round2;
  return [
    `Frozen target_gm: ${(Number(team.round1?.targetGm || 0) * 100).toFixed(1)}%`,
    `BOM_total: ${fmt(r2.bomTotal)} 元`,
    `自动定价 Price: ${fmt(r2.price)} 元`,
    `销量 Units: ${fmt(r2.sales)} 台`,
    `硬件收入: ${fmt(r2.hwRevenue)} 元`,
    `硬件利润: ${fmt(r2.hwProfit)} 元`,
    `订阅收入(24m): ${fmt(r2.subRevenue24)} 元`,
    `订阅利润(24m): ${fmt(r2.subProfit24)} 元`,
    `总利润: ${fmt(r2.totalProfit)} 元`,
    `价格比 r: ${r2.priceRatio.toFixed(2)} | adoption: ${r2.adoption.toFixed(3)} | fit: ${r2.fit.toFixed(2)}`,
    `渠道费: ${(r2.channelFee * 100).toFixed(1)}% | 渗透: ${(r2.subPenetration * 100).toFixed(1)}% | 留存: ${(r2.subRetention * 100).toFixed(1)}%`,
    `风险标签: ${r2.riskTag}`
  ].join("\n");
}

function applyIteration() {
  const team = state.activeTeam;
  if (!team?.round2) {
    alert("请先计算 Round 2。");
    return;
  }
  if (team.iterations >= 2) {
    alert("两次改参机会已用完。");
    return;
  }

  const changes = [els.change1.value, els.change2.value].filter((v) => v !== "none");
  if (changes.length === 0) {
    alert("请选择至少1项改参。");
    return;
  }

  const before = team.round2.totalProfit;
  const notes = [];

  changes.forEach((change) => {
    if (change === "change_sub") {
      els.subscriptionTier.value = els.changeSubTier.value;
      notes.push(`订阅档 -> ${subscriptionTiers[els.subscriptionTier.value].label}`);
    }
    if (change === "change_compliance") {
      els.complianceTier.value = els.changeComplianceTier.value;
      notes.push(`合规档 -> ${complianceTiers[els.complianceTier.value].label}`);
    }
    if (change === "swap_feature") {
      notes.push(autoSwapFeature(team.round1.valueProp));
    }
  });

  const selectedCards = getSelectedCards();
  if (selectedCards.length !== 6) {
    alert("改参后功能卡不是6张，请检查。\n建议使用清空后重新选择6张。");
    return;
  }

  team.iterations += 1;
  let result;
  try {
    result = computeRound2({
      round1: team.round1,
      selectedCards,
      subscriptionTierKey: els.subscriptionTier.value,
      complianceTierKey: els.complianceTier.value,
      iterations: team.iterations
    });
  } catch (err) {
    alert(`改参后计算失败: ${err.message || err}`);
    return;
  }

  team.round2 = result;
  team.history.push({ ...result });

  const delta = result.totalProfit - before;
  persistIteration(team, changes, delta);
  els.round2Output.textContent = formatRound2Output(team);
  els.iterationLog.textContent = `第${team.iterations}次改参: ${notes.join(" | ")} | Δ总利润: ${delta >= 0 ? "+" : ""}${fmt(delta)} 元`;
  saveLocalState();
}

function autoSwapFeature(valueProp) {
  const checked = [...els.featureCards.querySelectorAll("input:checked")];
  const unchecked = [...els.featureCards.querySelectorAll("input:not(:checked)")];
  if (!checked.length || !unchecked.length) return "功能卡替换失败";

  const key = valueProp === "体验" ? "exp" : valueProp === "混合" ? "hyb" : "fun";
  const selected = checked
    .map((el) => featureCards.find((c) => c.id === el.value))
    .sort((a, b) => a.value[key] + a.subLift - (b.value[key] + b.subLift));
  const candidates = unchecked
    .map((el) => featureCards.find((c) => c.id === el.value))
    .sort((a, b) => b.value[key] + b.subLift - (a.value[key] + a.subLift));

  const remove = selected[0];
  const add = candidates[0];

  const removeEl = els.featureCards.querySelector(`input[value="${remove.id}"]`);
  const addEl = els.featureCards.querySelector(`input[value="${add.id}"]`);
  if (removeEl && addEl) {
    removeEl.checked = false;
    addEl.checked = true;
    return `功能卡替换: ${remove.name} -> ${add.name}`;
  }
  return "功能卡替换失败";
}

function freezeTeam() {
  const team = state.activeTeam;
  if (!team?.round2) {
    alert("请先完成 Round 2 后再冻结成绩。");
    return;
  }

  team.frozen = true;
  const existing = state.teams.findIndex((t) => t.id === team.id);
  if (existing >= 0) {
    state.teams[existing] = { ...team };
  } else {
    state.teams.push({ ...team });
  }

  els.teamSummary.textContent = buildNarrative(team);
  renderRanking();
  persistTeamRun(team);
  refreshRankingFromServer();
  saveLocalState();
}

function buildNarrative(team) {
  const r1 = team.round1;
  const r2 = team.round2;
  const lovotStrategy = LOVOT_CELL.strategy === "差异化" ? "DIFF" : "COST";
  const lovotArch = "Experience";

  const shift = [];
  if (r1.customerType !== LOVOT_CELL.customerType) shift.push(`客户类型: ${LOVOT_CELL.customerType} -> ${r1.customerType}`);
  if (r1.strategy !== lovotStrategy) shift.push(`策略: ${lovotStrategy} -> ${r1.strategy}`);
  if (r1.archTag !== lovotArch) shift.push(`架构: ${lovotArch} -> ${r1.archTag}`);

  const first = team.history[0];
  const last = team.history[team.history.length - 1];
  const iterGain = first && last ? last.totalProfit - first.totalProfit : 0;

  return [
    `位置: ${r1.key}`,
    `相对LOVOT移动: ${shift.length ? shift.join("；") : "未移动（仍在LOVOT邻域）"}`,
    `成本-功能-价值取舍: BOM ${fmt(r2.bomTotal)} 元，选卡[${r2.cardNames.join("、")}]，架构 ${r1.archTag}`,
    `订阅LTV解释: 24个月订阅利润 ${fmt(r2.subProfit24)} 元，受渗透与留存（风险/合规）共同驱动。`,
    `迭代点评: 共${team.iterations}次改参，累计利润变化 ${iterGain >= 0 ? "+" : ""}${fmt(iterGain)} 元。`
  ].join("\n");
}

function renderRanking() {
  const ranked = [...state.teams].sort((a, b) => b.round2.totalProfit - a.round2.totalProfit);
  els.rankingBody.innerHTML = "";

  ranked.forEach((team, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${team.name}</td>
      <td>${fmt(team.round2.totalProfit)}</td>
      <td>${fmt(team.round2.hwProfit)}</td>
      <td>${fmt(team.round2.subProfit24)}</td>
      <td>${fmt(team.round2.price)}</td>
      <td>${fmt(team.round2.sales)}</td>
      <td>${team.round2.riskTag}</td>
    `;
    els.rankingBody.appendChild(tr);
  });
}

function renderRankingRows(rows) {
  els.rankingBody.innerHTML = "";
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${row.teamName}</td>
      <td>${fmt(Number(row.totalProfit || 0))}</td>
      <td>${fmt(Number(row.hwProfit || 0))}</td>
      <td>${fmt(Number(row.subProfit24 || 0))}</td>
      <td>${fmt(Number(row.price || 0))}</td>
      <td>${fmt(Number(row.sales || 0))}</td>
      <td>${row.riskTag || "-"}</td>
    `;
    els.rankingBody.appendChild(tr);
  });
}

async function refreshRankingFromServer() {
  if (state.persistenceMode !== "server" || !window.ApiClient) return;
  try {
    const result = await ApiClient.getRanking();
    renderRankingRows(result.rows || []);
  } catch (_) {
    // Keep local ranking if server call fails.
  }
}

function clearAll() {
  if (!confirm("确认清空所有小组结果？")) return;
  state.teams = [];
  state.activeTeam = null;
  refreshActiveTeamHint();
  els.round1Output.textContent = "";
  els.round2Output.textContent = "";
  els.teamSummary.textContent = "";
  els.iterationLog.textContent = "";
  els.rankingBody.innerHTML = "";
  els.personaAnswer.textContent = "";
  if (els.llmPainOutput) els.llmPainOutput.textContent = "";
  if (els.llmArchetypesOutput) els.llmArchetypesOutput.textContent = "";
  if (els.llmFeaturesTable) els.llmFeaturesTable.innerHTML = "";
  if (els.llmSummaryOutput) els.llmSummaryOutput.textContent = "";
  if (els.vpEvaluateOutput) els.vpEvaluateOutput.textContent = "";
  if (els.vpFeedbackCard) els.vpFeedbackCard.textContent = "";
  if (els.vpFeedbackChoices) els.vpFeedbackChoices.innerHTML = "";
  if (els.vpStepHint) els.vpStepHint.textContent = "";
  if (els.vpFinalState) els.vpFinalState.textContent = "";
  if (els.llmStory30s) els.llmStory30s.value = "";
  if (els.llmStory2min) els.llmStory2min.value = "";
  setLlmStatus("", "");
  renderCoachPinnedCard();
  renderCoachMessages();
  renderVpState();
  if (els.featureCards) {
    els.featureCards.querySelectorAll("input").forEach((c) => {
      c.checked = false;
    });
  }
  saveLocalState();
}

async function persistIteration(team, changes, delta) {
  try {
    const payload = {
      id: `${team.id}-iter-${team.iterations}-${Date.now()}`,
      teamId: team.id,
      teamName: team.name,
      iterationNo: team.iterations,
      changes,
      deltaProfit: delta,
      round2: team.round2,
      createdAt: new Date().toISOString()
    };
    if (state.persistenceMode === "server" && window.ApiClient) {
      await ApiClient.saveIterationEvent(payload);
    } else {
      await SimDB.saveIterationEvent(payload);
    }
    refreshDbStatus();
  } catch (err) {
    els.dbStatus.textContent = `数据库写入失败(iteration): ${err.message || err}`;
  }
}

async function persistTeamRun(team) {
  try {
    const payload = {
      id: `${team.id}-freeze-${Date.now()}`,
      teamId: team.id,
      teamName: team.name,
      setup: team.setup,
      round1: team.round1,
      round2: team.round2,
      history: team.history,
      createdAt: new Date().toISOString()
    };
    if (state.persistenceMode === "server" && window.ApiClient) {
      await ApiClient.saveTeamRun(payload);
    } else {
      await SimDB.saveTeamRun(payload);
    }
    refreshDbStatus();
  } catch (err) {
    els.dbStatus.textContent = `数据库写入失败(run): ${err.message || err}`;
  }
}

async function refreshDbStatus() {
  try {
    if (state.persistenceMode === "server" && window.ApiClient) {
      const s = await ApiClient.getDbStatus();
      els.dbStatus.textContent = `数据库模式: SQLite服务器 | 冻结成绩 ${s.runCount} 条，迭代事件 ${s.iterCount} 条`;
    } else {
      const [runs, iterations] = await Promise.all([SimDB.listTeamRuns(), SimDB.listIterations()]);
      els.dbStatus.textContent = `数据库模式: 本地IndexedDB | 冻结成绩 ${runs.length} 条，迭代事件 ${iterations.length} 条`;
    }
  } catch (err) {
    els.dbStatus.textContent = `数据库读取失败: ${err.message || err}`;
  }
}

async function exportDbJson() {
  try {
    const snapshot =
      state.persistenceMode === "server" && window.ApiClient
        ? await ApiClient.exportAll()
        : await SimDB.exportAll();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emba-sim-db-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    els.dbStatus.textContent = `导出失败: ${err.message || err}`;
  }
}

function bindEvents() {
  const bind = (el, event, fn) => {
    if (el) el.addEventListener(event, fn);
  };
  const bindAsyncClick = (el, fn) => {
    if (!el) return;
    el.addEventListener("click", async () => {
      try {
        await fn();
      } catch (err) {
        if (els.llmStatus) {
          setLlmStatus("error", `错误: ${err.message || err}`);
        }
        alert(err.message || err);
      }
    });
  };

  bind(els.startTeam, "click", startTeam);
  bind(els.runRound1, "click", runRound1);
  bind(els.r1Channel1, "change", updateRound1ChannelPreview);
  bind(els.r1Channel2, "change", updateRound1ChannelPreview);
  bind(els.r1ChannelShare, "input", updateRound1ChannelPreview);
  bind(els.r1TargetGm, "input", () => {
    updateTargetGmLabel();
    validateTargetGmSelection();
  });
  bindAsyncClick(els.freezeTargetGm, freezeTargetGm);
  bind(els.resetRound1, "click", resetRound1);
  bind(els.askPersona, "click", askPersona);
  bind(els.runRound2, "click", runRound2);
  bind(els.applyIteration, "click", applyIteration);
  bind(els.freezeTeam, "click", freezeTeam);
  bind(els.refreshDb, "click", refreshDbStatus);
  bind(els.exportDb, "click", exportDbJson);
  bind(els.clearAll, "click", clearAll);
  bindAsyncClick(els.coachCreateSession, coachCreateSession);
  bindAsyncClick(els.coachSend, () => coachSend());
  bindAsyncClick(els.coachGenerate, coachGenerateVp);
  bindAsyncClick(els.coachApplyRound1, () => applyCoachToRound1());
  bind(els.coachUserInput, "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      coachSend().catch((err) => {
        setLlmStatus("error", `错误: ${err.message || err}`);
        alert(err.message || err);
      });
    }
  });
  bindAsyncClick(els.llmPain, llmRound1Pain);
  bindAsyncClick(els.llmArchetypes, llmRound1Archetypes);
  bindAsyncClick(els.llmFeatures, llmRound1Features);
  bindAsyncClick(els.llmSummary, llmRound1Summary);
  bindAsyncClick(els.llmApplyRound1, async () => applySummaryToRound1());
  bindAsyncClick(els.vpHint1, () => fetchVpHint(1));
  bindAsyncClick(els.vpHint2, () => fetchVpHint(2));
  bindAsyncClick(els.vpFeedback1, () => fetchVpFeedback(1));
  bindAsyncClick(els.vpFeedback2, () => fetchVpFeedback(2));
  bindAsyncClick(els.vpLock1, () => commitVpStep(1));
  bindAsyncClick(els.vpLock2, () => commitVpStep(2));
  bindAsyncClick(els.vpApplyCandidate, async () => applyVpFeedbackCandidate());
  bindAsyncClick(els.vpGenerate, generateVpFinal);
  bind(els.vpContext, "input", renderVpState);
  bind(els.vpSolutionWay, "input", renderVpState);
  bind(els.vpHintClose, "click", closeVpHintModal);
  bind(els.vpHintModal, "click", (e) => {
    if (e.target === els.vpHintModal) closeVpHintModal();
  });
  bindAsyncClick(els.vpSubmitCanvasBtn, submitVpCanvas);
  bindAsyncClick(els.vpChatSendBtn, () => sendVpMessage("chat"));
  bindAsyncClick(els.vpChatSubmitBtn, () => sendVpMessage("score"));
  bind(els.vpContinueBtn, "click", continueImproving);
  bindAsyncClick(els.vpConfirmBtn, () => sendVpMessage("confirm"));
  bind(els.vpRestartBtn, "click", restartVp);
  bind(els.vpDownloadBtn, "click", downloadRecord);
  bindAsyncClick(els.marketingStartBtn, startMarketing);
  bindAsyncClick(els.marketingSendBtn, sendInterviewMessage);
  bindAsyncClick(els.endInterviewBtn, endInterview);
  bind(els.marketingDownloadBtn, "click", downloadMarketingRecord);
  bind(els.marketingProceedRdBtn, "click", proceedToRD);
  bind(els.marketingChatInput, "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendInterviewMessage().catch((err) => {
        setLlmStatus("error", `错误: ${err.message || err}`);
        alert(err.message || err);
      });
    }
  });
  bind(els.vpChatInput, "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendVpMessage("chat").catch((err) => {
        setLlmStatus("error", `错误: ${err.message || err}`);
        alert(err.message || err);
      });
    }
  });
}

initialize();
