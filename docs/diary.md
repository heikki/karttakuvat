# Development Diary

<project-description></project-description>

## Updating This Diary

Run these commands to gather data:

```bash
bunx ccusage                    # Token usage and cost per day
git log --oneline | wc -l       # Total commits
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1  # Lines
git log --pretty=format:"%ad|%s" --date=format:"%Y-%m-%d" | head -50  # Recent commits
```

**Style guide:**

- Include token usage and cost from `bunx ccusage` when available
- Use flat bullet lists (no bold subsections or nested structure)
- Focus on significant features and fixes, skip minor tweaks
- Describe final outcomes, not intermediate attempts that were reverted

<example>
## Project Stats (as of 05.01.2026)

- **TypeScript files**: XX
- **Lines of code**: YY
- **Total commits**: ZZ

## 05.01.2026 — Performance & Code Simplification

**Tokens**: 89M | **Cost**: $56.84

- Added FPS stats panel using r3f-perf (unified for browser and XR modes)
- Performance: optimized client render loop for high target count scenarios
- Performance: avoided color string allocation per frame in world state
  </example>
