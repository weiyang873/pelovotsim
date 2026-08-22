# F1 — the methods figure: two simulation designs (benchmark vs roleplay) and the human reference, in plain language.
# Replaces T4 in the main text (detailed condition table -> appendix).
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt; from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
ROOT="/Users/weiyang/Dropbox/Github_indiswyang/try/emba-ai-sim-v01"
RED="#c8433b"; BLUE="#2b5d8a"; GREY="#8a8a8a"
fig,ax=plt.subplots(figsize=(13,6.0)); ax.set_xlim(-0.75,12.1); ax.set_ylim(-0.15,5.7); ax.axis("off")
def box(x,y,w,h,text,fc,ec,fs=8.2,tc="#222222"):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle="round,pad=0.02,rounding_size=0.09",fc=fc,ec=ec,lw=1.2))
    ax.text(x+w/2,y+h/2,text,ha="center",va="center",fontsize=fs,color=tc)
def arrow(x1,y1,x2,y2,c):
    ax.add_patch(FancyArrowPatch((x1,y1),(x2,y2),arrowstyle="-|>",mutation_scale=13,color=c,lw=1.2))
# column headers
for x,t in [(1.7,"Who is the participant?"),(5.05,"How is the task done?"),(8.6,"Round 1 → Round 2"),(11.05,"Compared on")]:
    ax.text(x,5.45,t,ha="center",fontsize=9.5,fontweight="bold")
# ---- Benchmark ----
ax.text(-0.05,4.55,"Benchmark\nsimulation",ha="right",fontsize=9.5,fontweight="bold",va="center",color=GREY)
box(0.35,4.0,2.7,1.1,"An attribute list\nage, industry, position, stance\n(+ an MBTI 'thinking style'\nparagraph in the layered version)",fc="#f0f0f0",ec=GREY)
box(3.75,4.0,2.6,1.1,"Follows a fixed script:\nspeaking order and discussion\nlength set by the program\n(teams: 7 turns per segment)",fc="#f0f0f0",ec=GREY)
box(7.05,4.0,3.1,1.1,"R1: pick a market and positioning\nR2: pick capability cards, set a price\n(42 individuals and 42 teams of 5,\neach run 5 times)",fc="#f0f0f0",ec=GREY)
# ---- Roleplay ----
ax.text(-0.05,2.75,"Roleplay\nsimulation",ha="right",fontsize=9.5,fontweight="bold",va="center",color=BLUE)
box(0.35,2.2,2.7,1.1,"A person with a life story\nrandom fact card (career, family,\nspending habits, personality) written\ninto a biography by a writer\nwho does not know the task",fc="#e4ecf5",ec=BLUE,fs=7.8)
box(3.75,2.2,2.6,1.1,"Behaves like a student:\nreads page by page, speaks when\nit wants to, discusses until the\nteam itself converges",fc="#e4ecf5",ec=BLUE)
box(7.05,2.2,3.1,1.1,"Same two rounds, same interface\n(42 individuals and 42 teams of 5,\neach run 5 times)",fc="#e4ecf5",ec=BLUE)
# ---- Human ----
ax.text(-0.05,0.95,"Human\nreference",ha="right",fontsize=9.5,fontweight="bold",va="center",color=RED)
box(0.35,0.4,2.7,1.1,"EMBA students\n16 teams with complete records",fc="#f7e4e2",ec=RED)
box(3.75,0.4,2.6,1.1,"The real classroom flow:\nindividual proposals,\ngroup discussion, submission",fc="#f7e4e2",ec=RED)
box(7.05,0.4,3.1,1.1,"Same two rounds,\nsame settlement engine",fc="#f7e4e2",ec=RED)
# outcomes box spanning rows
box(10.35,0.4,1.45,4.7,"Within-team\nspread of\nproposals\n\nPrice spread\n(CV)\n\nLoss rate\n\nStrategy mix\n\nCards chosen",fc="#ffffff",ec="#444444",fs=8)
for y in (4.55,2.75,0.95):
    arrow(3.05,y,3.75,y,"#666666"); arrow(6.35,y,7.05,y,"#666666"); arrow(10.15,y,10.35,y,"#666666")
ax.text(5.6,-0.05,"The two designs differ in exactly two things: who the participant is (attribute list vs life story) and who controls the flow (the program vs the agent).\nSame model, temperature and task everywhere.",ha="center",va="center",fontsize=8.2,style="italic")
fig.tight_layout(); fig.savefig(f"{ROOT}/paper/figs/fig1_pipeline.png",dpi=200); fig.savefig(f"{ROOT}/paper/figs/fig1_pipeline.pdf"); print("ok")
