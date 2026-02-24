---
tags:
  - community
  - kaoyan
  - automation
---

# Community Edition (Minimal)

This folder is the public-safe subset of the vault.
It keeps basic automation features without exposing private agent prompts, orchestration logic, or personal workflow details.

## Included Features

1. `scripts/auto_daily_plan_min.py`
- Generate a deterministic daily study plan from `config/plan_config.example.json`.
- No private prompt engineering.

2. `scripts/paper_digest_min.py`
- Fetch recent arXiv papers and write an Obsidian markdown digest.
- No private AI summarization pipeline.

3. `templates/math-problem-board.md`
- Minimal math problem-solving board template for Obsidian.

## Quick Start

```bash
python community/scripts/auto_daily_plan_min.py
python community/scripts/paper_digest_min.py --max-results 5
```

## Design Boundary

- Public: runnable baseline features.
- Private: advanced prompt design, orchestration strategy, personal data, session traces.

