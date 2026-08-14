<!-- 中文版：README.md -->
[中文](README.md) · **English**

# YAEO — Yet Another Engine Optimization

**Yet another engine optimization. The difference: every rule cites a source.**

SEO → AEO → GEO → LLMO — a new acronym every quarter. This repo doesn't add one.
It does a single thing: **turn "how visible a site is to search engines and AI engines"
into something you can check rule by rule, where every rule has a source you can look up.**

---

## Why another one

There are plenty of SEO skills around. Two problems keep showing up:

**① Percentage claims with no source.** Numbers like "adding FAQ schema lifts CTR by 30%"
circulate widely, and tracing them back usually turns up no original research.
Every rule here either comes from Google's own documentation, from peer-reviewed work,
or is explicitly labelled "practitioner consensus, weak evidence."
**When a rule is uncertain, label it weak rather than attach a number to it.**

**② Judging Chinese sites by English thresholds.** "60 characters for `<title>`,
160 for the description" are English rules of thumb. Applied to Chinese they flag a whole
batch of perfectly normal titles as too long — the information density is different.
This checker detects the CJK character ratio and switches thresholds.

The same "the two languages simply aren't symmetric" idea shows up elsewhere.
`L1-LANG-CONTENT-MISMATCH` compares the declared language against the language the body
text is actually in, and its criterion is deliberately one-directional: a page declaring
English with whole blocks of CJK can be reported; a page declaring Chinese with whole
blocks of Latin **cannot**. Brand names, code and acronyms are normal on a Chinese page,
so applying it in reverse would misfire across the board.

---

## What's here

| Path | What it is |
|---|---|
| `skills/seo-aeo-audit/` | Claude Code skill: four layers of checks, **52 rules** (L1 12 / L2 23 / L3 4 / SITE 13) |
| `skills/seo-aeo-audit/scripts/seo-check.mjs` | Zero-dependency static checker (Node, no `npm install`) |
| `skills/seo-aeo-audit/scripts/psi-check.mjs` | PageSpeed Insights wrapper (bring your own API key) |
| `skills/seo-aeo-audit/test/` | Regression tests — only for rules whose **criteria have gone wrong before**; see "Which rules deserve a test" |
| `watch/` | A monthly sweep: have the sources moved, has the crawler list changed, has a new acronym appeared |

> **The complete rule index lives in `skills/seo-aeo-audit/SKILL.md`, under 〈完整規則索引〉**
> — code, severity, and what it means, with nothing left out. You shouldn't have to read
> a 45 KB script to find out what the rules are.
>
> "52" counts distinct rule codes, and you can re-derive it: take the second argument of
> every `add()` call in the script and count the unique values. This repo asks every number
> to have a source; that applies to its own headline number too.

## The four layers

| Layer | Covers | How it's decided |
|---|---|---|
| **L1 Technical basics** | title / description / canonical / OG / lang / sitemap / robots | Fully automatic |
| **L2 Content structure** | **how much body text is actually visible**, heading hierarchy, empty headings, fake headings, alt text, internal links, JSON-LD | Fully automatic |
| **L3 AI visibility** | site-level reachability (`SITE-*`) plus page-level citability (`L3-*`) | Semi-automatic |
| **L4 YMYL / E-E-A-T** | authorship, credentials, consistency with consensus | Human judgement |

## How to use it

Build first — **what gets checked is the build output a crawler sees, not your source**:

```bash
npm run build
```

```bash
node skills/seo-aeo-audit/scripts/seo-check.mjs --dir ./dist --site https://example.com
```

Inside Claude Code, drop `skills/seo-aeo-audit/` into `~/.claude/skills/`; after that,
saying "check this site's SEO" triggers it.

### Running the tests

```bash
node skills/seo-aeo-audit/test/dead-link.test.mjs
node skills/seo-aeo-audit/test/bilingual-concat.test.mjs
node skills/seo-aeo-audit/test/lang-content-mismatch.test.mjs
```

Zero dependencies, run them directly; the output is written for humans
(each scenario prints what it is testing).

You can also use Node's built-in test runner for aggregate counts (`node --test <file>`),
but **don't hand it a directory** — `node --test <dir>` fails outright on Node 24,
while each test passes on its own. The symptom looks like broken tests; it's the invocation.

---

## Four design positions

**① Check the build output, not the source.**
They can differ completely. A real case: one page interpolated its experience descriptions
as strings, so the HTML contained the literal text `&lt;a href=...&gt;`. Users saw working
links (JS re-rendered after load), but crawlers got escaped plain text — nine outbound
links that, as far as they were concerned, did not exist.

**② This script does not execute JavaScript — that's a feature, not a limitation.**
Most crawlers and LLMs don't either. If the script sees nothing, so do they.

**③ Weak signals are never errors.**
`L3-GEO-*` only reports `info`, and deliberately gives no target number — the paper says
"adding these improves visibility," not "omitting them is wrong," and offers no threshold.

**④ When a rule misfires, fix the script — don't widen the threshold until it stops firing.**
`SITE-DEAD-INTERNAL-LINK` once had a 67% false-positive rate on static hosts that serve
clean URLs: the link says `/gallery`, the output file is `gallery.html`, and the two never
match. Cloudflare Pages, Netlify and GitHub Pages **all** support clean URLs by default —
and this was an **error**-level rule.
**A rule that misfires in bulk is worse than one that misses things**: missing something
costs you one finding, while systematic false positives make people stop trusting the whole report.

Why it stayed hidden so long is worth recording: the site used during development emitted
directory-style output (`/a/b/index.html`), and **that was the one mode where it was already
correct**. In the only environment it was ever tested in, it had been right since day one.

> **How long a rule can stay broken is a function of how many environments you test it in.**

The fix inverted the direction. It used to guess what a link *should* look like
(normalise `/gallery`, then compare). Now it **first computes every URL form each output
file is actually reachable at**, then checks whether the link hits one of them. The former
means enumerating how authors write links; the latter means enumerating how hosts behave —
a much smaller set, and one you can look up.

### Which rules deserve a test

Not every rule has one. The criterion is: **when this rule is wrong, does it make people
distrust the entire report, or push them toward the wrong fix?** Not how complex it is.

There's also a fake fix for false positives that **looks identical to the real one**:
widen the rule until it stops firing, and the report looks fixed. So every test plants
**one genuinely reportable case** in each scenario and asserts that exactly that one is
reported — under-reporting and over-reporting both fail.

The three rules that have tests each went wrong differently:

| Rule | What went wrong |
|---|---|
| `SITE-DEAD-INTERNAL-LINK` | Misfired in bulk on clean-URL hosts, at **error** level |
| `L2-BILINGUAL-CONCAT` | The number was always right, but it **merged two situations with completely different fixes** |
| `L1-LANG-CONTENT-MISMATCH` | Its criterion is deliberately **asymmetric** — the kind of thing someone later "tidies up" into symmetry |

The two situations `L2-BILINGUAL-CONCAT` was merging:

| Situation | Nature | What to do |
|---|---|---|
| Both language versions of the same content sit in the DOM | Architecture | Move to separate per-language URLs |
| Untranslated content on an English page falls back to Chinese | Translation progress | Disappears once translated |

Two attempts at the criterion failed, both because they **relied on markup**. "Does it carry
a `lang` attribute" silently removed the first situation (common bilingual components tag
both halves). "Both sides declared, with different languages" missed hand-written pages using
`class="zh-only"` and no `lang` at all. What finally worked was **looking at the content**:
two adjacent elements where the first is mostly CJK and the second mostly Latin.
So that test isn't really about whether the number is right — it's about
**getting all three markup styles right**.

Half of the `L1-LANG-CONTENT-MISMATCH` test consists of **reverse assertions**:
organisation names inside links on an English page, a Chinese technical article full of code
and brand names, and a page that is entirely English — all three must stay silent.
An asymmetric criterion with no reverse assertions guarding it will eventually be made
symmetric, and then it misfires across the board.

---

## Sources

| Source | Used for |
|---|---|
| [Google Search Quality Rater Guidelines](https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf) (2025-09-11 edition) | Every page reference in L4 |
| [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735) (Aggarwal et al., KDD 2024) | The five tactics and `L3-GEO-*` |
| Google Search Central documentation | Most of L1 / L2 |

`watch/sources.json` is the machine-readable full list, checked monthly by GitHub Actions.

### What the monthly check actually checks

Rules expire, and **expiry is silent** — the checker still runs and still produces a report;
only the basis underneath has stopped holding. So `watch/` does three things every month and
opens the result as an issue. It **reports only, and never edits rules** (whether to follow
a change requires reading the original):

| | Check | How |
|---|---|---|
| ① | Are the sources still there, did they quietly change | Three modes by source type: PDFs compare file size, arXiv compares version number, Google devsite compares the page's own `Last updated` |
| ② | Has the AI crawler list changed | Forward: are the listed names still in the official docs. Reverse: are there crawlers in the docs that aren't on the list |
| ③ | Has anything appeared that we don't know about | Sweep Google Search Central's blog and GEO/AEO papers on arXiv, then have a model filter for items worth reading in full |

The reverse half of ② caught three unlisted crawlers on its first run in 2026-08
(`OAI-AdsBot`, `Google-CloudVertexBot`, `meta-externalads`). All three were checked and then
**deliberately left out of the rules** — the first two only fetch content the site owner has
submitted or requested, the third belongs to the ad ecosystem, and none of them affect
citation in AI answers or training consent. The reasoning is recorded per crawler in
`watch/crawlers.json`, so next month they aren't re-reported as new discoveries.

③ is the most dangerous step in the repo — having a language model read blogs and produce
conclusions is **exactly what this repo argues against**. So its output is defined explicitly
as *leads*, not rules: it lists items worth going back to the source for, always attaches the
original link, produces no rule text, edits no files, and **records which model made the call**
— an interpretation should be traceable to its interpreter.

The model isn't hard-coded either: `CF_AI_MODEL` wins if set, otherwise it queries the current
model list and picks one, printing which it actually used. Hard-coding a model is a landmine
that goes off the day the vendor retires it.

Environment variables (all optional — when unset, the corresponding check is marked
"not checked this run" rather than showing green):

| Variable | Used for |
|---|---|
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | Browser Rendering (Meta's crawler docs return 400 to ordinary fetches, so a real browser is needed) plus Workers AI (the judgement in ③) |
| `CF_AI_MODEL` | Overrides the automatic pick. Best left empty |

Token scopes: `Workers AI · Read` + `Workers AI · Edit` + `Browser Rendering · Edit`.

---

## Licence

MIT. The **sources** behind the rules carry their own licences; cite them per the original.
