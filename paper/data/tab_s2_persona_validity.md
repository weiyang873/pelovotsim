# T7 — Does the biography carry the persona? (Study 2)

## T7a. Manipulation check: can a reader recover the 8 assigned traits from the biography?
LLM judge reads only the biography, rates each trait 0–1; correlated with the assigned value (41 personas). Binary agreement = share of personas on the same side of the median.

| Trait | r | binary agreement |
|---|---|---|
| Maximizing (vs satisficing) | .70 | .80 |
| Need for cognition | .66 | .68 |
| Actively open-minded thinking | .65 | .71 |
| Business risk propensity | .76 | .85 |
| Ambiguity tolerance | .59 | .68 |
| Promotion focus | .38 | .59 |
| Consideration of future consequences | .57 | .71 |
| Action orientation | .70 | .78 |
| **Mean** | **.63** | **.72** |

Reading: the assigned traits are recoverable from the biography the agent reads.

## T7b. What produces human-scale dispersion? A build-up from the benchmark to the full design (individual line, 42 personas per cell)

Start from the benchmark individual cell and change one thing at a time; then move the full design to teams and compare with the human teams. Dispersion = price SD across units (frozen five-round values where available, otherwise one round); market coverage = how many of the 12 market cells (ToB/ToC × cost/differentiation × child/adult/elder) get chosen.

| Step | Persona | Process | Price SD | Loss rate | Cost-leadership share | Market cells used (/12) |
|---|---|---|---|---|---|---|
| 0. Benchmark | attribute list | fixed script | 512 | .12 | .01 | 8/12 |
| 1. Upgrade the persona only | biography | fixed script | 483 | .12 | .02 | 6/12 |
| 2. Upgrade the process only | attribute list | roleplay | 479 | .83 | .00 | 4/12 |
| 3. Upgrade both (full design) | biography | roleplay | **909** (CV .21) | .56 | .32 | 10/12 |
| 4. Full design, 5-member teams | biography | roleplay | **1016** (CV .28) | .63 | .30 | — |
| Human (16 teams, price mapped to the simulation band) | — | — | 1129 (CV .28) | .62 | .25 | — |

Within step 3, swapping out either half of the biography's content changes little: keep only the fact card (traits removed) SD 844, keep only the traits (fact card removed) SD 838 — the fact card carries who the person is (removing it collapses demographics to the prior mode: 36/42 male, 42/42 master's, age SD 2.2 vs 7.5), not how much behaviour disperses.

Reading: neither a better persona nor a freer process alone moves dispersion (steps 1 and 2 stay at benchmark level; the attribute-list persona in a free process even collapses onto one strategy — 85% ToC-differentiation, loss .83). Only the combination — a life-story persona read by an agent that walks the pages itself — produces human-scale dispersion and a realistic strategy mix; moving it to five-member teams (step 4) lands on the human teams' dispersion, loss rate and strategy mix. This mirrors Study 1: the device and the persona must match; content details within the biography matter less.

Caveats: the benchmark process shows the task tips (锦囊) while the roleplay process hides them, so the process factor bundles an information-set difference; the benchmark persona text is not task-blind. Steps 1–2 are single rounds (single-round SD fluctuates ±50–150; step 3's matched single round was 756).
Sources: step 0 = benchmark individual simple 5×42 (frozen); step 1 = `ablation_bio_x_script_indiv_20260820`; step 2 = `solo_r2_v2Q_attrlist_20260820`; step 3 = solo v2Q frozen 5×42; card-only/trait-only = `solo_r2_v2Q_cardonly_20260819` / `solo_r2_v2Q_traitonly_rep1_20260816`.
