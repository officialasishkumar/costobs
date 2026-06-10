# Engineering ROI: cost per PR, per engineer, per experiment

Every CostObs event carries a free-form `tags` map, and the **Breakdown** page
can slice spend by any tag key (the "Tag key" control, or
`/breakdown?tag=<key>`). That turns cost attribution into a general primitive:
tag your calls with `pr`, `engineer`, `experiment`, `agent`, … and CostObs
answers "what did this PR / person / experiment cost?".

## Tag once at the edge

Tags follow the same three-layer precedence as all metadata
(wrap-time < request-context < per-call):

```python
# Wrap-time default — every call from this process
client = costobs.wrap(OpenAI(), team="ml", pr=os.environ.get("PR_NUMBER", ""))

# Request-scoped
with costobs.request_context(experiment="prompt-v3-ab"):
    ...

# Decorator
@costobs.trace(engineer="asish")
def review_diff(diff): ...
```

```typescript
const client = wrap(new OpenAI(), { team: "ml", pr: process.env.PR_NUMBER ?? "" });
```

## Cost per merged PR from CI

In CI / preview deployments, export the PR number into the environment and
fold it into your wrap-time tags:

```yaml
# .github/workflows/preview.yml
env:
  PR_NUMBER: ${{ github.event.pull_request.number }}
  PR_AUTHOR: ${{ github.event.pull_request.user.login }}
```

```python
client = costobs.wrap(
    OpenAI(),
    environment="preview",
    pr=os.environ.get("PR_NUMBER", ""),
    engineer=os.environ.get("PR_AUTHOR", ""),
)
```

Then open `/breakdown?tag=pr` for cost per PR, or `/breakdown?tag=engineer`
for cost per author. Combine with `environment=preview` filtering on the
Requests page to keep production traffic out of the comparison.

## Coding-agent / Cursor-style attribution

Agent sessions that route through any supported provider SDK are tagged the
same way — set `agent="cursor"` (or the session id) at wrap time in the tool's
integration layer, or call `costobs.record()` from a post-run hook with the
session's token totals if no SDK sits in the path.
