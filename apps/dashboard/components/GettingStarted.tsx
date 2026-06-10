/**
 * First-run experience: shown on the overview page when the org has no
 * events yet. Walks through sending the first event with copy-paste snippets
 * wired to the dev seed key, so the time-to-first-chart is minutes.
 */

const PY_SNIPPET = `import costobs
from openai import OpenAI

costobs.configure(
    ingest_url="http://localhost:8080",
    api_key="costobs_dev_secret_key",   # seeded dev key (see .env)
)

client = costobs.wrap(OpenAI(), team="payments", environment="dev")

with costobs.request_context(customer_id="cust-42"):
    client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello, CostObs!"}],
        feature="hello",
    )

costobs.flush()`;

const TS_SNIPPET = `import OpenAI from "openai";
import { wrap, flush, configure } from "@costobs/sdk";

configure({
  ingestUrl: "http://localhost:8080",
  apiKey: "costobs_dev_secret_key", // seeded dev key (see .env)
});

const client = wrap(new OpenAI(), { team: "payments", environment: "dev" });

await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello, CostObs!" }],
  costobs: { feature: "hello", customer_id: "cust-42" },
});

await flush();`;

const DEMO_SNIPPET = `# No provider key handy? Seed 30k synthetic events instead:
make demo-data`;

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0">
      <p className="label-mono mb-2">{title}</p>
      <pre className="overflow-x-auto rounded-tremor-small border border-carbon-600 bg-carbon-900 p-4 font-mono text-xs leading-relaxed text-dark-tremor-content-emphasis">
        {code}
      </pre>
    </div>
  );
}

export function GettingStarted() {
  return (
    <section className="panel panel--ticked reveal reveal-2 p-6">
      <p className="label-mono text-ember">first run</p>
      <h2 className="mt-1.5 font-display text-xl font-semibold text-dark-tremor-content-strong">
        No events yet — send your first one
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-dark-tremor-content">
        Wrap your provider client with one line. The call goes straight to the
        provider; CostObs prices it locally and ships only metadata — never
        prompt or response content. Charts appear seconds after the first
        event lands.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Snippet title="python · pip install costobs" code={PY_SNIPPET} />
        <Snippet title="typescript · npm i @costobs/sdk" code={TS_SNIPPET} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Snippet title="or: instant demo data" code={DEMO_SNIPPET} />
        <div>
          <p className="label-mono mb-2">then explore</p>
          <ul className="space-y-2 text-sm text-dark-tremor-content">
            <li>
              <span className="mr-2 font-mono text-xs text-ember">02</span>
              Breakdown — slice spend by customer, feature, team, or any tag
            </li>
            <li>
              <span className="mr-2 font-mono text-xs text-ember">05</span>
              Forecast — projected month-end spend after a few days of data
            </li>
            <li>
              <span className="mr-2 font-mono text-xs text-ember">06</span>
              Reconcile — compare tracked spend against real provider bills
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
