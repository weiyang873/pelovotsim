import { useState, useMemo, useCallback } from "react";

// ── Constants ──
const MC = ["#E8634A","#3B82C4","#2FAB6E","#D4A03C"];
const MN = ["李婷","张磊","王建国","陈晓萱"];
const DIMS = [
  { id:"interaction", l:"交互与表达", icon:"💬", c:"#D97706", desc:"AI机器人怎么和用户沟通" },
  { id:"perception", l:"感知与理解", icon:"👁", c:"#7C3AED", desc:"AI机器人怎么理解用户" },
  { id:"motion", l:"运动与导航", icon:"🦿", c:"#0891B2", desc:"AI机器人怎么移动" },
  { id:"safety", l:"安全与信任", icon:"🛡", c:"#DC2626", desc:"数据隐私与安全保障" },
  { id:"extend", l:"可扩展与连接", icon:"🔌", c:"#059669", desc:"与外部设备和服务的连接" },
  { id:"ops", l:"可运营与可维护", icon:"🔧", c:"#4F46E5", desc:"长期维护与运营支撑" },
];
const ASGN = [
  { m:0, dims:["interaction","safety"] },
  { m:1, dims:["perception","motion"] },
  { m:2, dims:["extend","ops"] },
  { m:3, dims:["perception","interaction"] },
];
const IMP = { interaction:"高", perception:"高", motion:"中", safety:"中", extend:"低", ops:"中" };
const IMP_C = { "高":"#DC2626", "中":"#D4A03C", "低":"#9CA3AF" };

const STEPS = ["第一轮回顾","用户访谈","个人选卡","团队合并","研发与定价","确认提交"];

// ── Card data: human-readable, cost/risk per tier ──
// cost: number (hidden in individual, shown in team). costLabel: shown in individual
// riskNote: specific risk explanation per card
const CC = {
interaction: [
  { id:"voice_basic", n:"语音基础", what:"能听懂指令并用语音回应",
    riskNote:"技术成熟度高，风险可控",
    tiers:{ low:{l:"基础",d:"固定指令，预设回复",cost:60,cl:"轻",rk:"低"}, mid:{l:"标准",d:"日常对话，自然语调",cost:120,cl:"中",rk:"低"}, high:{l:"旗舰",d:"多方言+情感语调",cost:180,cl:"较重",rk:"低"} } },
  { id:"persona_dialog", n:"多轮对话个性化", what:"记住上下文，越聊越懂你，像朋友一样对话",
    riskNote:"依赖大模型能力，对话质量波动大",
    tiers:{ low:{l:"基础",d:"简单多轮，记住近期话题",cost:180,cl:"中",rk:"中"}, mid:{l:"标准",d:"个性化风格+长期记忆",cost:260,cl:"较重",rk:"中高"}, high:{l:"旗舰",d:"深度个性化，模拟角色性格",cost:380,cl:"重",rk:"高"} },
    deps:[{tier:"high",type:"需要",target:"cloud_update",tl:"标准",cross:true}] },
  { id:"touch_hug", n:"触摸/拥抱交互增强", what:"感知拥抱和抚摸，做出温暖回应",
    riskNote:"传感器硬件成熟，集成风险低",
    tiers:{ low:{l:"基础",d:"基本触摸感应",cost:60,cl:"轻",rk:"低"}, mid:{l:"标准",d:"多区域触感，不同反应",cost:120,cl:"中",rk:"中"}, high:{l:"旗舰",d:"全身压力感应+体温变化",cost:200,cl:"较重",rk:"中"} } },
  { id:"visual_expr", n:"视觉表达（OLED/灯效）", what:"通过屏幕表情或灯光变化表达情绪",
    riskNote:"OLED 供应链稳定，旗舰版功耗较高",
    tiers:{ low:{l:"基础",d:"LED 灯光表达",cost:60,cl:"轻",rk:"低"}, mid:{l:"标准",d:"OLED 丰富表情动画",cost:220,cl:"中",rk:"中"}, high:{l:"旗舰",d:"全彩表情+氛围灯联动",cost:340,cl:"较重",rk:"中"} },
    conflicts:["no_screen"] },
  { id:"no_screen", n:"无屏降本（删OLED）", what:"去掉屏幕降成本，改用纯语音+灯光",
    riskNote:"用户体验可能受限，需验证接受度", tag:"降本",
    tiers:{ low:{l:"基础",d:"去屏保留LED",cost:-120,cl:"省",rk:"中"}, mid:{l:"标准",d:"去屏+简化外壳",cost:-220,cl:"省更多",rk:"中高"}, high:{l:"旗舰",d:"极简纯语音方案",cost:-300,cl:"省最多",rk:"高"} },
    conflicts:["visual_expr"] },
],
perception: [
  { id:"percep_base", n:"基础感知（摄像头/语音）", what:"看到和听到周围环境，识别人脸和物体",
    riskNote:"硬件方案成熟",
    tiers:{ low:{l:"基础",d:"单摄像头+麦克风",cost:80,cl:"轻",rk:"低"}, mid:{l:"标准",d:"广角+多物体识别",cost:160,cl:"中",rk:"中"}, high:{l:"旗舰",d:"双目视觉+阵列麦克风",cost:240,cl:"较重",rk:"中"} } },
  { id:"emotion_recog", n:"情绪识别与表情捕捉", what:"读懂表情和语气，判断开心还是难过",
    riskNote:"算法精度不稳定，光线条件影响大",
    tiers:{ low:{l:"基础",d:"5种基本情绪",cost:160,cl:"中",rk:"中"}, mid:{l:"标准",d:"多模态融合（表情+语气+体态）",cost:260,cl:"较重",rk:"中高"}, high:{l:"旗舰",d:"细粒度识别+趋势追踪",cost:380,cl:"重",rk:"高"} },
    deps:[{tier:"low",type:"需要",target:"percep_base",tl:"基础"},{tier:"mid",type:"需要",target:"percep_base",tl:"标准"},{tier:"high",type:"需要",target:"percep_base",tl:"旗舰"}] },
  { id:"adaptive_learn", n:"自适应学习（习惯/偏好）", what:"越用越懂你——记住习惯、喜好、作息",
    riskNote:"数据积累周期长，冷启动体验差",
    tiers:{ low:{l:"基础",d:"记住常用设置",cost:160,cl:"中",rk:"中"}, mid:{l:"标准",d:"学习日常规律",cost:260,cl:"较重",rk:"中高"}, high:{l:"旗舰",d:"跨场景预测需求",cost:380,cl:"重",rk:"高"} },
    deps:[{tier:"mid",type:"需要",target:"cloud_update",tl:"标准",cross:true}] },
  { id:"scene_trigger", n:"场景识别与触发", what:"判断吃饭/睡觉/有客人等场景，自动调整行为",
    riskNote:"场景误判可能导致不当行为",
    tiers:{ low:{l:"基础",d:"3-5种固定场景",cost:60,cl:"轻",rk:"中"}, mid:{l:"标准",d:"10+场景自动切换",cost:120,cl:"中",rk:"中"}, high:{l:"旗舰",d:"自定义场景+联动",cost:200,cl:"较重",rk:"中高"} } },
],
motion: [
  { id:"basic_avoid", n:"基础避障", what:"遇到障碍物会停下或绕开",
    riskNote:"传感器方案成熟",
    tiers:{ low:{l:"基础",d:"碰撞传感器",cost:40,cl:"轻",rk:"中"}, mid:{l:"标准",d:"红外提前减速",cost:100,cl:"中",rk:"中"}, high:{l:"旗舰",d:"超声波+红外融合",cost:160,cl:"中",rk:"中"} } },
  { id:"lidar_nav", n:"室内导航（LiDAR）", what:"自主在家走动，记住房间布局",
    riskNote:"LiDAR 硬件成本波动大，供货周期长",
    tiers:{ low:{l:"基础",d:"单线LiDAR简单建图",cost:260,cl:"较重",rk:"中高"}, mid:{l:"标准",d:"多线精准导航",cost:380,cl:"重",rk:"高"}, high:{l:"旗舰",d:"3D多楼层记忆",cost:480,cl:"很重",rk:"高"} },
    conflicts:["no_lidar"] },
  { id:"auto_dock", n:"自动充电/回桩", what:"电量低时自动找到充电桩",
    riskNote:"对接精度要求不高，风险可控",
    tiers:{ low:{l:"基础",d:"手动放回",cost:80,cl:"轻",rk:"中"}, mid:{l:"标准",d:"自动寻桩对接",cost:140,cl:"中",rk:"中"}, high:{l:"旗舰",d:"无线充电",cost:220,cl:"较重",rk:"中"} } },
  { id:"follow_mode", n:"跟随/伴行模式", what:"像小宠物一样跟着你在家走",
    riskNote:"跟随速度匹配有延迟风险",
    tiers:{ low:{l:"基础",d:"声音定位跟随",cost:60,cl:"轻",rk:"中"}, mid:{l:"标准",d:"视觉跟随",cost:120,cl:"中",rk:"中"}, high:{l:"旗舰",d:"预测路径伴行",cost:200,cl:"较重",rk:"中高"} } },
  { id:"no_lidar", n:"轻量降本（删LiDAR）", what:"去掉激光雷达，用纯视觉+红外",
    riskNote:"导航精度下降，可能走丢", tag:"降本",
    tiers:{ low:{l:"基础",d:"去LiDAR保留红外",cost:-120,cl:"省",rk:"中高"}, mid:{l:"标准",d:"纯视觉SLAM",cost:-220,cl:"省更多",rk:"高"}, high:{l:"旗舰",d:"极简移动方案",cost:-300,cl:"省最多",rk:"高"} },
    conflicts:["lidar_nav"] },
],
safety: [
  { id:"privacy_trust", n:"隐私与信任保障", what:"数据加密，用户可控制自己的数据",
    riskNote:"合规要求明确，实施风险低",
    tiers:{ low:{l:"基础",d:"本地加密存储",cost:60,cl:"轻",rk:"低"}, mid:{l:"标准",d:"端到端加密+数据面板",cost:140,cl:"中",rk:"低"}, high:{l:"旗舰",d:"零知识架构",cost:220,cl:"较重",rk:"低"} } },
  { id:"family_guardian", n:"家庭监护", what:"家长远程查看孩子/老人状态，设置使用边界",
    riskNote:"隐私与监护的平衡是难点，用户反感过度监控",
    tiers:{ low:{l:"基础",d:"使用时长限制",cost:180,cl:"中",rk:"中"}, mid:{l:"标准",d:"远程查看+行为边界",cost:340,cl:"较重",rk:"高"}, high:{l:"旗舰",d:"多角色权限+异常报警",cost:480,cl:"重",rk:"高"} },
    deps:[{tier:"low",type:"需要",target:"privacy_trust",tl:"基础"},{tier:"mid",type:"需要",target:"privacy_trust",tl:"标准"}] },
  { id:"kids_mode", n:"儿童模式", what:"专为儿童设计——内容过滤、防沉迷、使用时长",
    riskNote:"内容审核需要持续投入",
    tiers:{ low:{l:"基础",d:"内容白名单",cost:60,cl:"轻",rk:"低"}, mid:{l:"标准",d:"年龄分级+时长管理",cost:120,cl:"中",rk:"中"}, high:{l:"旗舰",d:"AI实时审核+家长报告",cost:200,cl:"较重",rk:"中"} },
    deps:[{tier:"mid",type:"需要",target:"content_comply",tl:"标准"}] },
  { id:"elder_mode", n:"老人模式", what:"为老年用户优化——大字体、简化操作、紧急呼叫",
    riskNote:"适老化设计经验要求高",
    tiers:{ low:{l:"基础",d:"大字体+简化界面",cost:80,cl:"轻",rk:"中"}, mid:{l:"标准",d:"语音优先+紧急呼叫",cost:160,cl:"中",rk:"中"}, high:{l:"旗舰",d:"健康提醒+跌倒检测",cost:260,cl:"较重",rk:"中高"} } },
  { id:"content_comply", n:"内容合规审核", what:"确保生成内容安全合规",
    riskNote:"技术方案成熟",
    tiers:{ low:{l:"基础",d:"关键词过滤",cost:60,cl:"轻",rk:"低"}, mid:{l:"标准",d:"AI语义审核",cost:120,cl:"中",rk:"低"}, high:{l:"旗舰",d:"实时审核+人工复核",cost:180,cl:"中",rk:"低"} } },
],
extend: [
  { id:"connect_base", n:"基础联网同步", what:"连接WiFi，接收更新和同步数据",
    riskNote:"标准方案",
    tiers:{ low:{l:"基础",d:"WiFi手动同步",cost:20,cl:"轻",rk:"低"}, mid:{l:"标准",d:"自动同步+蓝牙",cost:50,cl:"轻",rk:"低"}, high:{l:"旗舰",d:"5G+WiFi双模",cost:90,cl:"中",rk:"低"} } },
  { id:"mobile_app", n:"手机App联动", what:"通过手机远程控制、查看状态",
    riskNote:"开发周期可控",
    tiers:{ low:{l:"基础",d:"查看状态",cost:40,cl:"轻",rk:"低"}, mid:{l:"标准",d:"远程控制+通知",cost:90,cl:"中",rk:"低"}, high:{l:"旗舰",d:"完整控制+家庭共享",cost:140,cl:"中",rk:"中"} } },
  { id:"home_iot", n:"家庭IoT联动", what:"连接智能家居——灯光、空调、窗帘",
    riskNote:"协议兼容性测试工作量大",
    tiers:{ low:{l:"基础",d:"2-3个品牌",cost:60,cl:"轻",rk:"中"}, mid:{l:"标准",d:"主流平台全兼容",cost:120,cl:"中",rk:"中"}, high:{l:"旗舰",d:"场景联动自动化",cost:200,cl:"较重",rk:"中"} } },
  { id:"skill_store", n:"第三方插件/技能商店", what:"让开发者为产品开发新技能",
    riskNote:"生态冷启动风险高，初期没人开发",
    tiers:{ low:{l:"基础",d:"官方精选插件",cost:80,cl:"轻",rk:"中"}, mid:{l:"标准",d:"开放SDK+审核",cost:160,cl:"中",rk:"中高"}, high:{l:"旗舰",d:"完整生态+分成",cost:260,cl:"较重",rk:"高"} } },
  { id:"offline_mode", n:"离线模式", what:"断网后仍能正常工作",
    riskNote:"边缘推理对芯片要求高",
    tiers:{ low:{l:"基础",d:"核心功能离线",cost:40,cl:"轻",rk:"低"}, mid:{l:"标准",d:"大部分功能离线",cost:90,cl:"中",rk:"低"}, high:{l:"旗舰",d:"完整离线AI推理",cost:140,cl:"中",rk:"中"} } },
],
ops: [
  { id:"cloud_update", n:"云端智能更新（OTA）", what:"自动接收新功能和修复",
    riskNote:"灰度发布可降低更新风险",
    tiers:{ low:{l:"基础",d:"手动触发",cost:60,cl:"轻",rk:"中"}, mid:{l:"标准",d:"自动静默+回滚",cost:120,cl:"中",rk:"中"}, high:{l:"旗舰",d:"灰度发布+AB测试",cost:200,cl:"较重",rk:"中"} } },
  { id:"remote_diag", n:"远程诊断", what:"出问题时远程排查，不用寄回维修",
    riskNote:"技术方案成熟",
    tiers:{ low:{l:"基础",d:"错误日志上报",cost:40,cl:"轻",rk:"低"}, mid:{l:"标准",d:"远程诊断+一键修复",cost:90,cl:"轻",rk:"低"}, high:{l:"旗舰",d:"预测性维护预警",cost:140,cl:"中",rk:"低"} } },
  { id:"qa_system", n:"质量体系", what:"更严格的质控，降低故障率", tag:"降险",
    riskNote:"投入确定，回报明确",
    tiers:{ low:{l:"基础",d:"标准质检流程",cost:40,cl:"轻",rk:"降险"}, mid:{l:"标准",d:"全链路追溯",cost:90,cl:"中",rk:"降险"}, high:{l:"旗舰",d:"六西格玛+AI质检",cost:140,cl:"中",rk:"降险"} } },
  { id:"cost_eng", n:"成本工程", what:"设计优化+供应链管理降低制造成本", tag:"降本",
    riskNote:"需要供应链谈判周期",
    tiers:{ low:{l:"基础",d:"基础供应链优化",cost:-60,cl:"省",rk:"低"}, mid:{l:"标准",d:"模块化+集中采购",cost:-120,cl:"省更多",rk:"低"}, high:{l:"旗舰",d:"DFM深度优化",cost:-200,cl:"省最多",rk:"中"} } },
  { id:"sla_support", n:"客服/SLA保障", what:"售后服务体系", tag:"降险",
    riskNote:"人力成本可预测",
    tiers:{ low:{l:"基础",d:"在线客服+FAQ",cost:40,cl:"轻",rk:"降险"}, mid:{l:"标准",d:"7×12客服+48h响应",cost:90,cl:"中",rk:"降险"}, high:{l:"旗舰",d:"7×24+上门+延保",cost:140,cl:"较重",rk:"降险"} } },
],
};
const ALL = Object.values(CC).flat();
const fc = id => ALL.find(c => c.id === id);
const TI = {low:0,mid:1,high:2};
const TS = ["low","mid","high"];
const CL_C = {"轻":"#2FAB6E","中":"#D4A03C","较重":"#E8634A","重":"#DC2626","很重":"#991B1B","省":"#2FAB6E","省更多":"#166534","省最多":"#166534"};
const RK_C = {"低":"#2FAB6E","中":"#D4A03C","中高":"#E8634A","高":"#DC2626","降险":"#3B82C4"};

// Other members' selections (demo)
const OTHER = {
  1:{percep_base:"mid",scene_trigger:"mid",basic_avoid:"mid",auto_dock:"mid"},
  2:{connect_base:"mid",mobile_app:"mid",cloud_update:"mid",remote_diag:"mid",cost_eng:"mid"},
  3:{emotion_recog:"high",percep_base:"high",persona_dialog:"mid"},
};

const calcCost = (s) => {
  let cost=0, cnt=0;
  Object.entries(s).forEach(([id,t]) => { const c=fc(id); if(c) { cost+=c.tiers[t].cost; cnt++; } });
  return {cost, cnt};
};

// Real parameters from framework doc §12.2, §11.3, §16.1
const V = 4200;         // variable cost per unit
const F_PRICE = 14000;  // demo reference price (ToB_DIFF_ELDER typical)
const F_CHANNEL = 0.15; // ToB channel fee
// GM = (P×(1-f) - V - dCOGS) / P
const calcGM = (dCOGS, price, f) => {
  const netRev = price * (1 - f);
  return ((netRev - V - dCOGS) / price) * 100;
};
const GM_FLOOR = 20; // below this = danger zone

// ── Main App ──
export default function App() {
  const [step, setStep] = useState(0);
  const [am, setAm] = useState(0);
  const [sel, setSel] = useState({});
  const [teamPrice, setTeamPrice] = useState(12000);
  const [submitted, setSubmitted] = useState(false);

  const myA = ASGN[am];
  const tog = useCallback((id) => { setSel(p => { const n={...p}; if(n[id]) delete n[id]; else n[id]="mid"; return n; }); }, []);
  const stier = useCallback((id, t) => { setSel(p => ({...p, [id]: t})); }, []);

  const teamSel = useMemo(() => {
    if (step < 3) return sel;
    const m = {...sel};
    Object.entries(OTHER).forEach(([mi, cards]) => {
      if (parseInt(mi) !== am) Object.entries(cards).forEach(([cid, t]) => { if (!m[cid]) m[cid] = t; });
    });
    return m;
  }, [sel, am, step]);

  const indCalc = useMemo(() => calcCost(sel), [sel]);
  const teamCalc = useMemo(() => calcCost(teamSel), [teamSel]);
  const teamGM = useMemo(() => calcGM(teamCalc.cost, F_PRICE, F_CHANNEL), [teamCalc.cost]);
  const marginDanger = teamGM < GM_FLOOR;

  const BS = {marginTop:12,width:"100%",padding:"12px",borderRadius:10,background:"#1a5c3a",color:"#fff",border:"none",fontSize:14,fontWeight:700,cursor:"pointer"};

  // ── Render card (individual mode: no cost numbers) ──
  const renderCard = (card, dim, sels, showCost) => {
    const isOn = !!sels[card.id];
    const tier = sels[card.id] || "mid";
    const hasConflict = card.conflicts?.some(cid => !!sels[cid]);

    return (
      <div key={card.id} style={{
        padding:"12px 14px", borderRadius:10, position:"relative",
        border: isOn ? `2px solid ${card.tag==="降本"?"#2FAB6E":dim.c}` : hasConflict ? "1.5px dashed #d1d5db" : "1.5px solid #e5e7eb",
        background: card.tag==="降本"?"#fafff8":card.tag==="降险"?"#f8faff":"#fff",
        opacity: hasConflict && !isOn ? 0.5 : 1,
      }}>
        {card.tag && <div style={{position:"absolute",top:6,right:8,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:4,background:card.tag==="降本"?"#DCFCE7":"#DBEAFE",color:card.tag==="降本"?"#166534":"#1E40AF"}}>{card.tag}</div>}

        {/* Header */}
        <div style={{display:"flex",gap:8,marginBottom:6,paddingRight:card.tag?50:0}}>
          <input type="checkbox" checked={isOn} onChange={()=>!hasConflict&&tog(card.id)} disabled={hasConflict&&!isOn} style={{width:16,height:16,marginTop:2,cursor:hasConflict?"not-allowed":"pointer"}}/>
          <div>
            <div style={{fontSize:14,fontWeight:700,lineHeight:1.3}}>{card.n}</div>
            <div style={{fontSize:12,color:"#666",marginTop:2,lineHeight:1.5}}>{card.what}</div>
          </div>
        </div>

        {/* Risk note */}
        <div style={{marginLeft:24,fontSize:11,color:"#888",marginBottom:6,fontStyle:"italic"}}>
          ⚠ {card.riskNote}
        </div>

        {/* Tier selection */}
        <div style={{marginLeft:24,display:"flex",flexDirection:"column",gap:4}}>
          {TS.map(t => {
            const td = card.tiers[t];
            const active = tier===t && isOn;
            const ac = card.tag==="降本"?"#2FAB6E":dim.c;
            return (
              <div key={t} onClick={()=>isOn&&stier(card.id,t)} style={{
                display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:6,
                cursor:isOn?"pointer":"default",
                border:active?`2px solid ${ac}`:"1px solid #e5e7eb",
                background:active?ac+"08":"#fafafa", opacity:isOn?1:0.4, transition:"all 0.2s",
              }}>
                <div style={{width:14,height:14,borderRadius:"50%",border:active?`4px solid ${ac}`:"2px solid #d1d5db",background:"#fff",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <span style={{fontSize:12,fontWeight:700,color:active?ac:"#374151"}}>{td.l}</span>
                  <span style={{fontSize:11,color:"#888",marginLeft:6}}>{td.d}</span>
                </div>
                {/* Individual: qualitative labels only */}
                {!showCost && (
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    <span style={{fontSize:10,padding:"1px 6px",borderRadius:3,background:(CL_C[td.cl]||"#666")+"15",color:CL_C[td.cl],fontWeight:600}}>成本{td.cl.startsWith("省")?"":"："}{td.cl}</span>
                    <span style={{fontSize:10,padding:"1px 6px",borderRadius:3,background:(RK_C[td.rk]||"#666")+"15",color:RK_C[td.rk],fontWeight:600}}>风险：{td.rk}</span>
                  </div>
                )}
                {/* Team: show actual cost number */}
                {showCost && (
                  <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
                    <span style={{fontSize:12,fontWeight:700,color:td.cost<0?"#2FAB6E":td.cost>200?"#DC2626":"#374151"}}>{td.cost>0?"+":""}{td.cost}元</span>
                    <span style={{fontSize:10,padding:"1px 6px",borderRadius:3,background:(RK_C[td.rk]||"#666")+"15",color:RK_C[td.rk],fontWeight:600}}>风险：{td.rk}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Dependencies */}
        {isOn && card.deps?.filter(d => TS.indexOf(d.tier) <= TS.indexOf(tier)).map((dep,i) => (
          <div key={i} style={{marginTop:6,marginLeft:24,padding:"4px 8px",borderRadius:4,background:dep.cross?"#EFF6FF":"#FEF3C7",border:dep.cross?"1px solid #BFDBFE":"1px solid #FDE68A",fontSize:11,color:dep.cross?"#1E40AF":"#92400E"}}>
            {dep.type} <strong>{fc(dep.target)?.n||dep.target}</strong> 达到{dep.tl}以上{dep.cross && <span style={{opacity:0.7}}>（其他成员负责）</span>}
          </div>
        ))}
        {hasConflict && !isOn && <div style={{marginTop:6,marginLeft:24,fontSize:11,color:"#DC2626"}}>✕ 与已选能力卡冲突</div>}
      </div>
    );
  };

  const renderDimGroup = (dimId, sels, showCost) => {
    const dim = DIMS.find(d=>d.id===dimId);
    const cards = CC[dimId]||[];
    const cnt = cards.filter(c=>!!sels[c.id]).length;
    const imp = IMP[dimId];
    return (
      <div key={dimId} style={{marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",background:dim.c+"10",borderBottom:`3px solid ${dim.c}`,borderRadius:"10px 10px 0 0"}}>
          <div>
            <span style={{fontSize:15,fontWeight:800}}>{dim.icon} {dim.l}</span>
            <span style={{fontSize:12,color:"#666",marginLeft:8}}>{dim.desc}</span>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:4,background:IMP_C[imp]+"15",color:IMP_C[imp]}}>用户需求：{imp}</span>
            <span style={{fontSize:12,fontWeight:600,color:dim.c}}>{showCost ? `${cnt}/1-3` : (cnt > 0 ? `已选 ${cnt} 张` : "")}</span>
          </div>
        </div>
        <div style={{display:"grid",gap:8,padding:10,gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",background:"#fff",border:`1px solid ${dim.c}15`,borderTop:"none",borderRadius:"0 0 10px 10px"}}>
          {cards.map(card => renderCard(card, dim, sels, showCost))}
        </div>
      </div>
    );
  };

  // ── Simple radar chart (SVG) ──
  const RadarChart = ({sels}) => {
    const dimScores = DIMS.map(dim => {
      const cards = CC[dim.id]||[];
      let score = 0;
      cards.forEach(c => { if(sels[c.id]) { const ti = TI[sels[c.id]]; score += (ti+1); } });
      return Math.min(score / 6, 1); // normalize
    });
    const cx=120, cy=120, r=90;
    const pts = dimScores.map((s,i) => {
      const a = (Math.PI*2*i/6) - Math.PI/2;
      return [cx+r*s*Math.cos(a), cy+r*s*Math.sin(a)];
    });
    const bgPts = Array.from({length:6}).map((_,i) => {
      const a = (Math.PI*2*i/6) - Math.PI/2;
      return [cx+r*Math.cos(a), cy+r*Math.sin(a)];
    });
    return (
      <svg width={240} height={240} style={{display:"block",margin:"0 auto"}}>
        {[0.33,0.66,1].map(s => (
          <polygon key={s} points={bgPts.map(([x,y])=>`${cx+(x-cx)*s},${cy+(y-cy)*s}`).join(" ")} fill="none" stroke="#e5e7eb" strokeWidth={1}/>
        ))}
        {bgPts.map(([x,y],i) => (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" strokeWidth={1}/>
            <text x={cx+(x-cx)*1.15} y={cy+(y-cy)*1.15} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={DIMS[i].c} fontWeight={700}>{DIMS[i].icon}</text>
          </g>
        ))}
        <polygon points={pts.map(p=>p.join(",")).join(" ")} fill="#1a5c3a20" stroke="#1a5c3a" strokeWidth={2}/>
      </svg>
    );
  };

  return (
    <div style={{fontFamily:"'Noto Sans SC',-apple-system,sans-serif",background:"#fafaf8",minHeight:"100vh",padding:"16px 14px"}}>
    <div style={{maxWidth:1060,margin:"0 auto"}}>
      <h1 style={{fontSize:20,fontWeight:800,margin:"0 0 4px"}}>Round 2 · 第二轮决策：产品研发</h1>

      {/* Step bar */}
      <div style={{display:"flex",alignItems:"center",margin:"8px 0 16px"}}>
        {STEPS.map((s,i) => (
          <div key={i} style={{display:"flex",alignItems:"center",flex:i<STEPS.length-1?1:"none"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div onClick={()=>setStep(i)} style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,cursor:"pointer",background:i<step?"#2FAB6E":i===step?"#1a5c3a":"#e5e7eb",color:i<=step?"#fff":"#aaa",boxShadow:i===step?"0 0 0 3px #1a5c3a33":"none"}}>{i<step?"✓":i+1}</div>
              <span style={{fontSize:9,color:i===step?"#1a5c3a":i<step?"#2FAB6E":"#aaa",fontWeight:i===step?700:400,whiteSpace:"nowrap"}}>{s}</span>
            </div>
            {i<STEPS.length-1 && <div style={{flex:1,height:2,margin:"0 2px",marginBottom:18,background:i<step?"#2FAB6E":"#e5e7eb"}}/>}
          </div>
        ))}
      </div>

      {/* ═══ Step 0: 任务背景 + R1 回顾 + R2 预告 ═══ */}
      {step===0 && (
        <div style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>

          {/* Mission context */}
          <div style={{padding:"16px 20px",borderRadius:12,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:20}}>
            <div style={{fontSize:15,fontWeight:700,color:"#374151",marginBottom:6}}>
              📋 决策任务回顾：AI 硬件中国市场的创新战略
            </div>
            <div style={{fontSize:14,color:"#555",lineHeight:1.8}}>
              LOVOT 是一款 AI 机器人，你们的团队正在为它寻找<strong>中国市场的最佳定位</strong>，并基于这个定位进行<strong>产品创新改造</strong>。第一轮你们确定了战略方向，第二轮你们将把战略落地为具体的产品。
            </div>
          </div>

          {/* R1 summary - narrative style */}
          <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 12px"}}>第一轮你们做了什么决定</h2>

          <div style={{padding:"18px 20px",borderRadius:12,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:16}}>
            <div style={{fontSize:12,opacity:0.7,marginBottom:6}}>你们选定的战略方向</div>
            <div style={{fontSize:20,fontWeight:800}}>企业 (ToB) · 差异化 · 老人 · 体验型</div>
          </div>

          <div style={{padding:"16px 18px",borderRadius:10,border:"1px solid #e5e7eb",marginBottom:12,lineHeight:1.8}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>价值主张</div>
            <div style={{fontSize:14,color:"#555"}}>
              <strong>给谁：</strong>养老机构的运营负责人<br/>
              <strong>解决什么：</strong>老人日间独处时，家属和机构"看不到、管不到"的安全焦虑<br/>
              <strong>怎么解决：</strong>通过情感陪伴 + 跌倒检测 + 情绪预警，提供"有温度的安全守护"
            </div>
          </div>

          <div style={{padding:"16px 18px",borderRadius:10,border:"1px solid #e5e7eb",marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>价值主张评分</div>
            <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
              {[
                {l:"人群覆盖面",k:"C",s:4,fb:"目标人群清晰，覆盖了主要决策者"},
                {l:"痛点普遍性",k:"G",s:4,fb:"安全焦虑在养老机构普遍存在"},
                {l:"解法说服力",k:"E",s:4,fb:"陪伴+监测组合有差异化"},
              ].map(item => (
                <div key={item.k} style={{flex:"1 1 180px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                    <span style={{fontSize:13,fontWeight:600,color:"#374151"}}>{item.l}</span>
                    <span style={{fontSize:12,fontWeight:700,color:"#7c3aed",marginLeft:"auto"}}>{item.s}/5</span>
                  </div>
                  <div style={{display:"flex",gap:2,marginBottom:4}}>
                    {[1,2,3,4,5].map(n=><div key={n} style={{flex:1,height:6,borderRadius:2,background:n<=item.s?"#7c3aed":"#e5e7eb"}}/>)}
                  </div>
                  <div style={{fontSize:11,color:"#888"}}>{item.fb}</div>
                </div>
              ))}
            </div>
          </div>

          {/* R2 preview */}
          <div style={{padding:"18px 20px",borderRadius:12,background:"#1e293b",color:"#fff"}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:12}}>第二轮：基于定位的产品创新</div>
            <div style={{fontSize:13,opacity:0.9,lineHeight:1.8,marginBottom:16}}>
              战略方向已经定了，现在的问题是：<strong>产品到底做成什么样？</strong>
            </div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {[
                {num:"1",title:"挖掘需求",desc:"与 AI 模拟的目标用户深度访谈，验证你们的需求假设，发现隐藏需求"},
                {num:"2",title:"技术决策",desc:"为产品选择具体的技术能力组合——做什么、不做什么、做到什么程度"},
                {num:"3",title:"定价与结果",desc:"制定价格策略，系统根据你们的产品和定价自动计算市场表现"},
              ].map(item => (
                <div key={item.num} style={{flex:"1 1 180px",padding:"12px",background:"rgba(255,255,255,0.08)",borderRadius:8}}>
                  <div style={{width:24,height:24,borderRadius:6,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,marginBottom:6}}>{item.num}</div>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>{item.title}</div>
                  <div style={{fontSize:12,opacity:0.7,lineHeight:1.5}}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={()=>setStep(1)} style={BS}>进入第二轮 →</button>
        </div>
      )}

      {/* ═══ Step 1: 用户访谈 ═══ */}
      {step===1 && (
        <div style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 8px"}}>深度用户访谈</h2>
          <p style={{fontSize:14,color:"#555",margin:"0 0 16px",lineHeight:1.8}}>
            你将扮演产品经理，与一位 AI 模拟的目标用户进行深度对话。通过提问挖掘用户的真实需求和隐藏痛点——这些洞察将直接影响你后续的产品技术决策。
          </p>

          {/* Interview rules */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:700,color:"#92400e",marginBottom:6}}>📋 访谈规则</div>
            <div style={{fontSize:13,color:"#78350f",lineHeight:1.8}}>
              团队最多 <strong>3 位成员</strong>参与访谈，每人分别与一位 AI 模拟用户对话。
              每人最多 <strong>10 轮</strong>提问机会——问题越精准，挖掘的需求越深。
              系统会评估信息收集的完整度，当关键信息收集充分时会提示你可以结束。
            </div>
          </div>

          {/* Interview tips */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0",marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,color:"#166534",marginBottom:6}}>💡 访谈技巧</div>
            <div style={{fontSize:13,color:"#15803d",lineHeight:1.8}}>
              好的访谈不是问"你想要什么功能"，而是问"你平时遇到什么困扰"。
              用户不会直接告诉你答案——表面需求容易说出口，真正的痛点需要追问才会浮现。
              注意用户话语中的矛盾——那往往是最有价值的洞察。
            </div>
          </div>

          {/* Interview chat area (placeholder for real AI) */}
          <div style={{border:"1.5px solid #e5e7eb",borderRadius:12,overflow:"hidden",marginBottom:16}}>
            {/* Header */}
            <div style={{padding:"10px 16px",background:"#f9fafb",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <span style={{fontSize:13,fontWeight:700,color:"#374151"}}>访谈对象：</span>
                <span style={{fontSize:13,color:"#555"}}>王阿姨，68岁，养老机构住户</span>
              </div>
              <div style={{fontSize:12,color:"#888"}}>
                对话轮次：<strong style={{color:"#D97706"}}>0</strong> / 10
              </div>
            </div>

            {/* Chat messages (demo) */}
            <div style={{padding:"16px",minHeight:200,maxHeight:400,overflowY:"auto",background:"#fafafa"}}>
              <div style={{padding:"10px 14px",borderRadius:"10px 10px 10px 2px",background:"#e5e7eb",maxWidth:"80%",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:600,color:"#6b7280",marginBottom:4}}>王阿姨</div>
                <div style={{fontSize:13,color:"#374151",lineHeight:1.6}}>你好啊，听说你们在做一个什么机器人？我不太懂这些，你问吧。</div>
              </div>
              <div style={{padding:"10px 14px",borderRadius:"10px 10px 2px 10px",background:"#1a5c3a",color:"#fff",maxWidth:"80%",marginLeft:"auto",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:600,opacity:0.7,marginBottom:4}}>你</div>
                <div style={{fontSize:13,lineHeight:1.6}}>王阿姨您好！我想了解一下您平时在这里的日常生活，一天通常是怎么度过的？</div>
              </div>
              <div style={{padding:"10px 14px",borderRadius:"10px 10px 10px 2px",background:"#e5e7eb",maxWidth:"80%"}}>
                <div style={{fontSize:11,fontWeight:600,color:"#6b7280",marginBottom:4}}>王阿姨</div>
                <div style={{fontSize:13,color:"#374151",lineHeight:1.6}}>嗯……早上做操，吃早饭，然后就没什么事了。看看电视，打打牌。其实下午最难熬，从午饭到晚饭之间那几个小时，也没人说话。</div>
              </div>
            </div>

            {/* Input area */}
            <div style={{display:"flex",gap:8,padding:"12px 16px",borderTop:"1px solid #e5e7eb",background:"#fff"}}>
              <input type="text" placeholder="向用户提问……" style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1.5px solid #d1d5db",fontSize:13,outline:"none"}}/>
              <button style={{padding:"8px 20px",borderRadius:8,background:"#1a5c3a",color:"#fff",border:"none",fontSize:13,fontWeight:700,cursor:"pointer"}}>发送</button>
            </div>
          </div>

          {/* Progress indicator */}
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16}}>
            <div style={{flex:1,height:6,borderRadius:3,background:"#e5e7eb"}}>
              <div style={{width:"20%",height:"100%",borderRadius:3,background:"#D97706",transition:"width 0.3s"}}/>
            </div>
            <span style={{fontSize:11,color:"#888"}}>信息收集度：初步</span>
          </div>

          {/* Interview result summary (shown after interview ends) */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>访谈结果摘要（访谈结束后生成）</div>
            <p style={{fontSize:12,color:"#888",margin:"0 0 8px"}}>系统根据对话内容评估各维度对目标用户的重要程度：</p>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {DIMS.map(dim => (
                <span key={dim.id} style={{fontSize:11,padding:"4px 10px",borderRadius:6,background:IMP_C[IMP[dim.id]]+"12",color:IMP_C[IMP[dim.id]],fontWeight:600,border:`1px solid ${IMP_C[IMP[dim.id]]}30`}}>
                  {dim.icon} {dim.l}：{IMP[dim.id]}
                </span>
              ))}
            </div>
          </div>

          {/* Demo: member selector for prototype */}
          <div style={{padding:"12px 16px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:600,color:"#92400e",marginBottom:6}}>🎮 Prototype：选择身份体验不同维度</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {ASGN.map(a => (
                <button key={a.m} onClick={()=>setAm(a.m)} style={{
                  padding:"4px 12px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",
                  background:am===a.m?MC[a.m]+"15":"#fff",border:am===a.m?`2px solid ${MC[a.m]}`:"1px solid #e5e7eb",
                  color:am===a.m?MC[a.m]:"#666"
                }}>{MN[a.m]}</button>
              ))}
            </div>
          </div>

          <button onClick={()=>setStep(2)} style={BS}>访谈完成，开始选卡 →</button>
        </div>
      )}

      {/* ═══ Step 2: 个人选卡 (NO cost numbers) ═══ */}
      {step===2 && (
        <div>
          <div style={{background:"#fff",padding:"14px 18px",borderRadius:"14px 14px 0 0",border:"1px solid #e5e7eb",borderBottom:"none"}}>
            <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 4px"}}>个人选卡（{MN[am]}）</h2>
            <p style={{fontSize:13,color:"#666",margin:0,lineHeight:1.6}}>
              为你负责的维度选择能力卡。根据访谈结果和你的判断，把你认为产品应该具备的能力都选上，再选择合适的档次。
              <br/><span style={{color:"#999"}}>每个档位标注了<strong>成本</strong>（研发和量产投入的大小）和<strong>风险</strong>（技术实现的不确定性——选高了可能做不出来或延期）。当前只显示大致档位，具体研发成本将在全组合并后揭晓。</span>
            </p>
          </div>
          {/* Sticky bar — individual: no cost numbers */}
          <div style={{position:"sticky",top:0,zIndex:10,display:"flex",gap:10,padding:"10px 16px",background:"#fff",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 14px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
            <div style={{padding:"6px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13,color:"#374151"}}>
              已选 <strong>{indCalc.cnt}</strong> 张
            </div>
            <div style={{flex:1}}/>
            <button onClick={()=>setStep(3)} style={{padding:"6px 20px",borderRadius:8,background:indCalc.cnt>=1?"#1a5c3a":"#d1d5db",color:"#fff",border:"none",fontSize:13,fontWeight:700,cursor:indCalc.cnt>=1?"pointer":"not-allowed"}}>
              提交，等待队友 →
            </button>
          </div>

          {/* Interview summary for reference while selecting cards */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:"#166534",marginBottom:6}}>🎙️ 你的访谈洞察</div>
            <div style={{fontSize:13,color:"#374151",lineHeight:1.8,marginBottom:10}}>
              王阿姨最在意下午独处时的安全感和有人说话。对技术不排斥但要求操作极简。价格敏感度中等，但如果子女推荐会接受。意外发现：她其实不怕摔倒，更怕摔倒后没人知道。
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {myA.dims.map(d => {
                const dm = DIMS.find(x=>x.id===d);
                return (
                  <span key={d} style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:IMP_C[IMP[d]]+"12",color:IMP_C[IMP[d]],fontWeight:600,border:`1px solid ${IMP_C[IMP[d]]}30`}}>
                    {dm.icon} {dm.l}：{IMP[d]}
                  </span>
                );
              })}
            </div>
          </div>

          {myA.dims.map(dimId => renderDimGroup(dimId, sel, false))}
        </div>
      )}

      {/* ═══ Step 3: 团队合并 (radar + dimension insights + margin status) ═══ */}
      {step===3 && (() => {
        // Margin calculation for display
        const currentGM = calcGM(teamCalc.cost, F_PRICE, F_CHANNEL);
        const gmColor = currentGM >= 40 ? "#166534" : currentGM >= 25 ? "#D97706" : "#DC2626";
        const gmStatus = currentGM >= 40 ? "\u5065\u5EB7" : currentGM >= 25 ? "\u504F\u7D27" : "\u5371\u9669";
        return (
        <div style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 8px"}}>团队合并 — 能力全貌与利润影响</h2>
          <p style={{fontSize:13,color:"#666",margin:"0 0 16px",lineHeight:1.7}}>
            所有成员的选择已自动合并。先看看团队的整体能力分布、各维度的用户洞察和利润影响，再进入下一步讨论调整。
          </p>

          {/* Radar chart */}
          <div style={{marginBottom:20,textAlign:"center"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>团队能力雷达图</div>
            <RadarChart sels={teamSel}/>
            <div style={{display:"flex",justifyContent:"center",gap:12,marginTop:8,flexWrap:"wrap"}}>
              {DIMS.map(dim => {
                const cards = CC[dim.id]||[];
                const cnt = cards.filter(c=>!!teamSel[c.id]).length;
                return <span key={dim.id} style={{fontSize:11,color:dim.c,fontWeight:600}}>{dim.icon} {dim.l}: {cnt}张</span>;
              })}
            </div>
          </div>

          {/* Interview insights organized BY DIMENSION */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:10}}>🎙️ 访谈洞察（按维度）</div>
            {[
              {dim:"interaction", insight:"用户希望交互方式简单自然。老人偏好语音而非触屏，但对多轮对话的期望不高——能听懂、会回应就够了。机构负责人认为语音交互是加分项但非决定购买的因素。"},
              {dim:"perception", insight:"情绪识别是三位受访者共同提到的高价值需求。老人希望产品能感知自己的状态，家属希望远程了解情绪变化。但机构负责人更看重行为异常检测（如跌倒）而非情绪识别。"},
              {dim:"motion", insight:"移动能力需求中等。老人希望产品能跟着自己走动，但机构对自主导航有安全顾虑（走廊碰撞）。自动回桩充电是基本需求。"},
              {dim:"safety", insight:"安全是所有受访者的底线需求。家属最在意隐私保护——母亲拒绝装摄像头，希望监测方式不像监控。机构要求数据合规，老人要求操作简单不出错。"},
              {dim:"extend", insight:"扩展需求优先级较低。手机 App 联动被家属视为必要（远程查看），但老人本人对智能家居联动没有需求。"},
              {dim:"ops", insight:"机构负责人非常在意售后响应速度和远程更新能力——批量部署后不可能逐台维护。OTA 更新被视为必选。"},
            ].map(item => {
              const dim = DIMS.find(d=>d.id===item.dim);
              return (
                <div key={item.dim} style={{padding:"10px 14px",borderRadius:8,marginBottom:6,background:dim.c+"06",borderLeft:`4px solid ${dim.c}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                    <span style={{fontSize:13,fontWeight:700,color:dim.c}}>{dim.icon} {dim.l}</span>
                    <span style={{fontSize:11,padding:"2px 6px",borderRadius:3,background:IMP_C[IMP[item.dim]]+"12",color:IMP_C[IMP[item.dim]],fontWeight:600}}>用户需求：{IMP[item.dim]}</span>
                  </div>
                  <div style={{fontSize:12,color:"#555",lineHeight:1.7}}>{item.insight}</div>
                </div>
              );
            })}
          </div>

          {/* Margin-based budget status */}
          <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 260px",padding:"16px 20px",borderRadius:12,background:currentGM>=40?"#F0FDF4":currentGM>=25?"#FFFBEB":"#FEF2F2",border:currentGM>=40?"1.5px solid #BBF7D0":currentGM>=25?"1.5px solid #FDE68A":"1.5px solid #FECACA"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#6b7280",marginBottom:4}}>当前选择下的预估毛利率</div>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{fontSize:32,fontWeight:800,color:gmColor}}>{currentGM.toFixed(0)}%</span>
                <span style={{fontSize:14,fontWeight:600,color:gmColor}}>· {gmStatus}</span>
              </div>
              <div style={{width:"100%",height:8,borderRadius:4,background:"#e5e7eb",marginTop:8}}>
                <div style={{width:`${Math.min(Math.max(currentGM,0)/60*100,100)}%`,height:"100%",borderRadius:4,background:gmColor,transition:"width 0.3s"}}/>
              </div>
            </div>
            <div style={{flex:"0 0 auto",padding:"16px 20px",borderRadius:12,background:"#f9fafb",border:"1px solid #e5e7eb",textAlign:"center"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>已选能力卡</div>
              <div style={{fontSize:28,fontWeight:800,color:"#374151",marginTop:4}}>{teamCalc.cnt}</div>
              <div style={{fontSize:11,color:"#999"}}>目标 8-10 张</div>
            </div>
          </div>
          <div style={{fontSize:11,color:"#999",marginBottom:16,lineHeight:1.6}}>
            * 基于所选细分市场的平均水平预估。最终实际毛利率还取决于集体讨论中的选卡调整和定价决策。
          </div>

          {currentGM < 25 && (
            <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FECACA",fontSize:13,color:"#991B1B",marginBottom:12}}>
              ⚠ 当前技术选择成本过高，毛利率已降至危险区间。在下一步集体讨论中，你们需要砍掉或降档一些能力卡来恢复利润空间。
            </div>
          )}

          <div style={{padding:"10px 14px",borderRadius:8,background:"#FEF3C7",border:"1px solid #FDE68A",fontSize:12,color:"#92400E"}}>
            💡 接下来进入集体讨论，你们可以看到每张卡的具体成本，调整选卡和档位来优化毛利率。
          </div>
          <button onClick={()=>setStep(4)} style={BS}>进入集体讨论 →</button>
        </div>
        );
      })()}

      {/* ═══ Step 4: 集体讨论 (full cost info, adjustable) ═══ */}
      {step===4 && (() => {
        const currentGM = calcGM(teamCalc.cost, F_PRICE, F_CHANNEL);
        const gmOk = currentGM >= GM_FLOOR;
        const gmTier = currentGM >= 40 ? "健康" : currentGM >= 30 ? "良好" : currentGM >= 20 ? "偏紧" : "危险";
        const gmColor = currentGM >= 40 ? "#166534" : currentGM >= 30 ? "#2FAB6E" : currentGM >= 20 ? "#D97706" : "#DC2626";
        return (
        <div>
          <div style={{background:"#fff",padding:"14px 18px",borderRadius:"14px 14px 0 0",border:"1px solid #e5e7eb",borderBottom:"none"}}>
            <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 4px"}}>研发与定价决策</h2>
            <p style={{fontSize:13,color:"#666",margin:0,lineHeight:1.6}}>
              全组一起审视产品的技术能力组合。每增加一项能力或提升档次，研发成本都会上升。你们需要在"产品竞争力"和"成本可行性"之间找到平衡。
            </p>

            {/* Collapsible context panel */}
            <details style={{marginTop:12,borderRadius:8,border:"1px solid #e5e7eb",overflow:"hidden"}}>
              <summary style={{padding:"10px 14px",background:"#f9fafb",cursor:"pointer",fontSize:13,fontWeight:600,color:"#374151"}}>
                📋 查看战略背景（定位 · 价值主张 · 访谈洞察 · 雷达图）
              </summary>
              <div style={{padding:"14px 16px"}}>
                {/* R1 positioning */}
                <div style={{padding:"10px 14px",borderRadius:8,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:10}}>
                  <div style={{fontSize:11,opacity:0.7}}>战略定位</div>
                  <div style={{fontSize:16,fontWeight:800,marginTop:2}}>企业 (ToB) · 差异化 · 老人 · 体验型</div>
                </div>
                {/* VP */}
                <div style={{padding:"10px 14px",borderRadius:8,border:"1px solid #e5e7eb",marginBottom:10,fontSize:13,lineHeight:1.7}}>
                  <strong>价值主张：</strong>为养老机构提供"有温度的安全守护"——情感陪伴+跌倒检测+情绪预警
                </div>
                {/* Interview insights by dimension (condensed) */}
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:6}}>访谈洞察</div>
                  {[
                    {dim:"interaction", text:"用户偏好语音交互，但不需要复杂多轮对话"},
                    {dim:"perception", text:"情绪识别和跌倒检测是共同高价值需求"},
                    {dim:"safety", text:"隐私保护是底线，家属不想装摄像头式的监控"},
                    {dim:"ops", text:"机构要求远程更新和快速售后响应"},
                  ].map(item => {
                    const dim = DIMS.find(d=>d.id===item.dim);
                    return (
                      <div key={item.dim} style={{fontSize:11,color:"#555",padding:"3px 0",display:"flex",gap:6}}>
                        <span style={{color:dim.c,fontWeight:600,flexShrink:0}}>{dim.icon}</span>
                        <span>{item.text}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Mini radar */}
                <RadarChart sels={teamSel}/>
              </div>
            </details>
          </div>

          {/* Sticky metrics — qualitative margin */}
          <div style={{position:"sticky",top:0,zIndex:10,display:"flex",gap:10,padding:"10px 16px",background:"#fff",border:"1px solid #e5e7eb",borderTop:"none",borderRadius:"0 0 14px 14px",marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,0.04)",flexWrap:"wrap"}}>
            <div style={{padding:"6px 14px",borderRadius:8,background:gmOk?"#F0FDF4":"#FEF2F2",border:gmOk?"1px solid #BBF7D0":"1px solid #FECACA",fontSize:13,fontWeight:700,color:gmColor}}>
              预期毛利：{gmTier}
            </div>
            <div style={{padding:"6px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:13}}>
              已选 <strong>{teamCalc.cnt}</strong>/8-10 张
            </div>
            <div style={{flex:1}}/>
            <div style={{padding:"6px 14px",borderRadius:8,background:(teamCalc.cnt>=8&&teamCalc.cnt<=10&&gmOk)?"#F0FDF4":"#FEF2F2",border:(teamCalc.cnt>=8&&teamCalc.cnt<=10&&gmOk)?"1px solid #BBF7D0":"1px solid #FECACA",fontSize:12,fontWeight:600,color:(teamCalc.cnt>=8&&teamCalc.cnt<=10&&gmOk)?"#166534":"#DC2626"}}>
              {!gmOk?"\u26A0 预期毛利过低":teamCalc.cnt<8?`还需 ${8-teamCalc.cnt} 张`:teamCalc.cnt>10?`超出 ${teamCalc.cnt-10} 张`:"\u2713 选卡就绪，下方定价"}
            </div>
          </div>
          {DIMS.map(dim => renderDimGroup(dim.id, teamSel, true))}

          {/* ── Cost breakdown ── */}
          <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb",marginTop:12}}>
            <h3 style={{fontSize:16,fontWeight:800,margin:"0 0 12px"}}>📊 成本核算</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>基础制造成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#374151",marginTop:4}}>¥{V.toLocaleString()}</div>
                <div style={{fontSize:10,color:"#999"}}>材料+组装+包装/台</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:teamCalc.cost>0?"#FEF3C7":"#F0FDF4",border:teamCalc.cost>0?"1px solid #FDE68A":"1px solid #BBF7D0"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>研发增量成本</div>
                <div style={{fontSize:22,fontWeight:800,color:teamCalc.cost>0?"#D97706":"#2FAB6E",marginTop:4}}>{teamCalc.cost>0?"+":""}¥{teamCalc.cost.toLocaleString()}</div>
                <div style={{fontSize:10,color:"#999"}}>选卡带来的额外成本</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#EFF6FF",border:"1px solid #BFDBFE"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>单台总成本</div>
                <div style={{fontSize:22,fontWeight:800,color:"#1E40AF",marginTop:4}}>¥{(V + Math.max(0, teamCalc.cost)).toLocaleString()}</div>
                <div style={{fontSize:10,color:"#999"}}>定价须高于此才不亏</div>
              </div>
            </div>
            {/* Per-dimension cost breakdown */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {DIMS.map(dim => {
                const cards = CC[dim.id]||[];
                const dimCost = cards.reduce((sum,c) => sum + (teamSel[c.id] ? c.tiers[teamSel[c.id]].cost : 0), 0);
                if (dimCost === 0) return null;
                return (
                  <span key={dim.id} style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:dim.c+"10",color:dim.c,fontWeight:600,border:`1px solid ${dim.c}25`}}>
                    {dim.icon} {dimCost>0?"+":""}{dimCost}
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── Market reference (R1 results) ── */}
          <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb",marginTop:12}}>
            <h3 style={{fontSize:16,fontWeight:800,margin:"0 0 12px"}}>📈 市场参考（第一轮结果）</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>市场空间</div>
                <div style={{fontSize:22,fontWeight:800,color:"#166534",marginTop:4}}>中</div>
                <div style={{fontSize:10,color:"#888"}}>ToB·差异化·老人</div>
              </div>
              <div style={{padding:"12px 14px",borderRadius:10,background:"#faf5ff",border:"1.5px solid #e9d5ff"}}>
                <div style={{fontSize:11,color:"#6b7280"}}>价值主张对支付意愿的影响</div>
                <div style={{fontSize:22,fontWeight:800,color:"#7c3aed",marginTop:4}}>+8%</div>
                <div style={{fontSize:10,color:"#888"}}>VP 评分带来的溢价空间</div>
              </div>
            </div>
            <div style={{fontSize:12,color:"#555",lineHeight:1.7,padding:"10px 14px",borderRadius:8,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
              <strong>定价参考框架：</strong>单台成本 ¥{(V + Math.max(0, teamCalc.cost)).toLocaleString()} 是你们的盈亏底线。渠道抽走 {Math.round(F_CHANNEL*100)}% 后到手更少。定价越高单台利润越大但买的人越少——你们需要找到量和利润的最佳平衡。
            </div>
          </div>

          {/* ── Pricing section ── */}
          <div style={{background:"#fff",borderRadius:14,padding:20,border:"1px solid #e5e7eb",marginTop:12}}>
            <h3 style={{fontSize:16,fontWeight:800,margin:"0 0 8px"}}>定价决策</h3>

            {/* Pricing principles */}
            <div style={{padding:"12px 16px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb",marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>💡 定价须知</div>
              <div style={{fontSize:13,color:"#555",lineHeight:1.8}}>
                <div style={{marginBottom:6}}>
                  <strong>渠道成本：</strong>你们定的售价不等于到手收入。{F_CHANNEL===0.15 ? "ToB 渠道抽成约 15%——定价 ¥10,000，到手 ¥8,500。" : "ToC 渠道抽成约 25%——定价 ¥10,000，到手 ¥7,500。"}
                </div>
                <div style={{marginBottom:6}}>
                  <strong>量价权衡：</strong>价格越高，每台赚得越多，但愿意买的用户越少。价格越低，用户越多，但可能卖一台亏一台。
                </div>
                <div>
                  <strong>产品力影响：</strong>产品能力组合越精准匹配用户需求，用户对价格的敏感度越低——好产品可以卖更贵。
                </div>
              </div>
            </div>

            {/* Price slider */}
            <div style={{padding:"20px",borderRadius:12,background:"#f0fdf4",border:"1.5px solid #bbf7d0",marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:12}}>产品售价</div>
              <div style={{fontSize:36,fontWeight:800,color:"#1a5c3a",marginBottom:8}}>¥{teamPrice.toLocaleString()}</div>
              <input type="range" min={5000} max={20000} step={100} value={teamPrice} onChange={e=>setTeamPrice(+e.target.value)}
                style={{width:"100%",height:8,borderRadius:4,cursor:"pointer"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#999",marginTop:4}}>
                <span>¥5,000（低价走量）</span>
                <span>¥20,000（高端定位）</span>
              </div>
            </div>

            {/* Channel deduction - real-time */}
            <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center"}}>
              <div style={{flex:1,padding:"12px 16px",borderRadius:10,border:"1.5px solid #D9770630",background:"#D9770608",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:11,color:"#6b7280"}}>渠道抽成 {Math.round(F_CHANNEL*100)}% 后，每台到手</div>
                  <div style={{fontSize:24,fontWeight:800,color:"#D97706",marginTop:2}}>¥{Math.round(teamPrice*(1-F_CHANNEL)).toLocaleString()}</div>
                </div>
                <div style={{fontSize:12,color:"#999",textAlign:"right"}}>
                  售价 ¥{teamPrice.toLocaleString()}<br/>
                  − 渠道 ¥{Math.round(teamPrice*F_CHANNEL).toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{padding:"10px 14px",borderRadius:8,background:"#EFF6FF",border:"1px solid #BFDBFE",fontSize:12,color:"#1E40AF",marginBottom:12}}>
              提交后系统将根据你们的产品能力组合、定价和市场情况，自动计算销量和最终利润。
            </div>
            <button onClick={()=>(teamCalc.cnt>=8&&teamCalc.cnt<=10&&gmOk)&&setStep(5)} style={{...BS,background:(teamCalc.cnt>=8&&teamCalc.cnt<=10&&gmOk)?"#1a5c3a":"#d1d5db",cursor:(teamCalc.cnt>=8&&teamCalc.cnt<=10&&gmOk)?"pointer":"not-allowed"}}>
              {!gmOk?"预期毛利过低，请先调整选卡":teamCalc.cnt<8?`还需选 ${8-teamCalc.cnt} 张能力卡`:teamCalc.cnt>10?`能力卡超出 ${teamCalc.cnt-10} 张，请精简`:"确认产品方案与定价，查看结果 \u2192"}
            </button>
          </div>
        </div>
        );
      })()}

      {/* ═══ Step 5: 确认提交 ═══ */}
      {step===5 && !submitted && (
        <div style={{background:"#fff",borderRadius:14,padding:24,border:"1px solid #e5e7eb"}}>
          <h2 style={{fontSize:18,fontWeight:800,margin:"0 0 12px"}}>确认提交 — 请检查你们的决策</h2>

          {/* Positioning */}
          <div style={{padding:"16px 20px",borderRadius:12,background:"linear-gradient(135deg,#065f46,#14532d)",color:"#fff",marginBottom:16}}>
            <div style={{fontSize:12,opacity:0.7}}>战略定位</div>
            <div style={{fontSize:18,fontWeight:800,marginTop:4}}>企业 (ToB) · 差异化 · 老人 · 体验型</div>
            <div style={{fontSize:13,opacity:0.85,marginTop:6,lineHeight:1.6}}>价值主张：为养老机构提供"有温度的安全守护"——情感陪伴+跌倒检测+情绪预警</div>
          </div>

          {/* Radar */}
          <div style={{marginBottom:16,textAlign:"center"}}>
            <RadarChart sels={teamSel}/>
          </div>

          {/* Selected cards summary */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:8}}>产品能力组合（{teamCalc.cnt} 张）</div>
            {DIMS.map(dim => {
              const cards = CC[dim.id]||[];
              const picked = cards.filter(c=>!!teamSel[c.id]);
              if (!picked.length) return null;
              return (
                <div key={dim.id} style={{display:"flex",gap:6,alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f3f4f6"}}>
                  <span style={{fontSize:12,fontWeight:700,color:dim.c,minWidth:100}}>{dim.icon} {dim.l}</span>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {picked.map(card => {
                      const t = teamSel[card.id];
                      const td = card.tiers[t];
                      return (
                        <span key={card.id} style={{fontSize:11,padding:"2px 8px",borderRadius:4,background:dim.c+"10",color:dim.c,fontWeight:600}}>
                          {card.n}（{td.l}）
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cost & pricing summary */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#f9fafb",border:"1px solid #e5e7eb"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>单台总成本</div>
              <div style={{fontSize:20,fontWeight:800,color:"#374151",marginTop:4}}>¥{(V + Math.max(0, teamCalc.cost)).toLocaleString()}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#f0fdf4",border:"1.5px solid #bbf7d0"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>定价</div>
              <div style={{fontSize:20,fontWeight:800,color:"#166534",marginTop:4}}>¥{teamPrice.toLocaleString()}</div>
            </div>
            <div style={{padding:"12px 14px",borderRadius:10,background:"#D9770608",border:"1.5px solid #D9770630"}}>
              <div style={{fontSize:11,color:"#6b7280"}}>渠道抽成后到手</div>
              <div style={{fontSize:20,fontWeight:800,color:"#D97706",marginTop:4}}>¥{Math.round(teamPrice*(1-F_CHANNEL)).toLocaleString()}</div>
            </div>
          </div>

          {/* Confirm prompt */}
          <div style={{padding:"14px 18px",borderRadius:10,background:"#FFFBEB",border:"1px solid #FDE68A",marginBottom:16,fontSize:13,color:"#92400E",lineHeight:1.7}}>
            ⚠ 提交后不可修改。系统将根据你们的产品能力组合、定价和市场情况自动计算最终结果，结果将在课堂复盘时揭晓。
          </div>

          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setStep(4)} style={{...BS,background:"#f9fafb",color:"#374151",border:"1px solid #e5e7eb",flex:1}}>
              ← 返回修改
            </button>
            <button onClick={()=>setSubmitted(true)} style={{...BS,flex:1}}>
              确认提交 ✓
            </button>
          </div>
        </div>
      )}

      {/* ═══ Submitted success ═══ */}
      {step===5 && submitted && (
        <div style={{background:"#fff",borderRadius:14,padding:40,border:"1px solid #e5e7eb",textAlign:"center"}}>
          <div style={{fontSize:48,marginBottom:16}}>✅</div>
          <h2 style={{fontSize:22,fontWeight:800,color:"#166534",margin:"0 0 8px"}}>提交成功！</h2>
          <p style={{fontSize:15,color:"#555",lineHeight:1.8,margin:"0 0 24px"}}>
            你们的产品方案和定价已提交。
          </p>
          <div style={{padding:"22px",borderRadius:12,background:"#1e293b",color:"#fff",maxWidth:480,margin:"0 auto"}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>请放下手机/电脑</div>
            <div style={{fontSize:14,opacity:0.9,lineHeight:1.8,marginBottom:8}}>
              回到课堂参与集体复盘。
            </div>
            <div style={{padding:"10px",borderRadius:8,background:"rgba(255,255,255,0.08)",fontSize:13,opacity:0.8,lineHeight:1.7}}>
              老师将带领大家对比各组的产品选择、定价策略和最终利润，讨论"为什么同样的市场方向，不同的产品决策会导致截然不同的结果"。
            </div>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}
