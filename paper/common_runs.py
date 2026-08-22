# Shared loaders for paper tables (Studies 2-3). Run dirs: main repo (ROOT) + claude worktree (WT); see docs/DATA_MAP.md.
import json,glob,os,statistics as st
ROOT="/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01"; WT="/Users/weiyang/worktrees/emba-ai-sim-v01-claude"
def rows(patterns):
    out=[]
    for pat in patterns:
        for d in sorted(glob.glob(pat)):
            p=os.path.join(d,"settlement.json")
            if not os.path.exists(p): continue
            s=json.load(open(p)); pr=s.get("r2_price"); pr=pr.get("price") if isinstance(pr,dict) else pr
            if not isinstance(pr,(int,float)): continue
            m=json.load(open(os.path.join(d,"run_meta.json")))
            out.append(dict(dir=d,unit=tuple(m.get("profile_ids") or [])+(m.get("leader_id"),),seed=m.get("seed"),price=pr,cards=len(s.get("r2_cards") or []),loss=1 if s.get("profitable") is False else 0,
                            cost=1 if (s.get("r1") or {}).get("strategy")=="COST" else 0,grid=(s.get("r1") or {}).get("grid_id"),strategy=(s.get("r1") or {}).get("strategy"),profit=s.get("profit")))
    return out
BENCH_TEAM_S=[f"{ROOT}/runs_v4flash_0731/team_pilot/random42_free_0731_interface_team5_simple_teamlayerednomap_deepseek_20260814/SYN-*-simple-*"]+[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_team_rep{i}_20260816/SYN-*-simple-*" for i in range(2,6)]
BENCH_INDIV_S=[f"{ROOT}/runs_v4flash_0731/team_pilot/benchmark_indiv_orch_rep{i}_20260816/SYN-*-simple-*" for i in range(1,6)]
SOLO_V2Q=[f"{WT}/runs_v4flash_0731/team_r2_replay/solo_r2_v2Q_rep{i}_20260816/*" for i in range(1,6)]
TEAM_B=[f"{WT}/runs_v4flash_0731/team_r2_replay/team_r2_story3_B_rep{i}_20260816/*" for i in range(1,6)]
TEAM_A=[f"{WT}/runs_v4flash_0731/team_r2_replay/team_r2_story3_A_rep{i}_20260816/*" for i in range(1,6)]
def sd(v): return st.pstdev(v) if len(v)>1 else 0.0
