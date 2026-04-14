## Final Validation Phase

This repo now has four complementary validation layers for the AmeriVet assistant:

1. `npm run eval:deterministic`
- Runs the existing `tests/eval/eval-runner.test.ts`
- Covers the golden `eval-dataset.jsonl`
- Measures deterministic pass/fail conditions using `mustContain` / `mustNotContain`
- Includes categories like carrier attribution, geography, pricing mode, STD/leave pay, HSA/FSA rules, plan comparison, banned entities, and context carryover

2. `npm run eval:qa-v2-transcripts`
- Runs the new `qa-v2` multi-turn replay suite
- Measures conversational continuity for the new orchestration layer
- Covers follow-up comparison behavior, state correction, decision guidance, topic pivots, HSA follow-ups, and package-guidance flow

3. `npm run eval:validation`
- Runs both layers together for a fast readiness check

4. `npm run eval:retrieval-live`
- Runs a live retrieval benchmark against the AmeriVet search index
- Verifies expected chunk recall, MRR, gate pass, and repeated-run ranking stability

5. `npm run eval:judge-live`
- Runs the live LLM-as-judge semantic suite against Azure OpenAI
- Scores factual accuracy, completeness, and absence of hallucination across three judge calls per case

6. `npm run eval:validation-live`
- Runs deterministic, transcript, retrieval-live, and judge-live together
- Use this as the closest thing to a client-readiness gate

### Current readiness targets

- Deterministic suite: target `>= 90%` pass rate per category
- `qa-v2` transcript eval: target `>= 90%` turn-level pass rate
- Retrieval-live suite: target stable repeated rankings with `Recall@5 >= 0.9` and `MRR >= 0.9`
- LLM judge suite: target average `>= 4.0 / 5` when run with live credentials

### Notes

- The transcript eval is intentionally separate from `eval-dataset.jsonl` because it validates multi-turn session behavior, not just single-question correctness.
- Retrieval-live currently uses a small curated set of AmeriVet queries with known-good chunk IDs so we can verify stability honestly instead of pretending the whole dataset already has retrieval ground truth.
- The next expansion step is to add more retrieval cases with `expectedChunkIds` into the broader eval dataset as we validate them.
