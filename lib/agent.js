// Runs a TinyFish Agent goal with Errand's failure handling:
// - streams progress + the live browser URL into the job log
// - detects "COMPLETED but actually blocked/captcha" results
// - retries once in stealth mode with a residential proxy when blocked
import { runAgent, AGENT_PROXY_COUNTRIES } from './tinyfish.js';
import { detectBlock, explainFailure } from './safety.js';

export async function smartRun(ctx, { url, goal, schema, country, label, maxSeconds = 240, stealthFirst = false, extra = {} }) {
  const attempts = stealthFirst ? ['stealth'] : ['lite', 'stealth'];
  let last;
  for (const mode of attempts) {
    const body = {
      url,
      goal,
      browser_profile: mode,
      agent_config: { max_duration_seconds: maxSeconds },
      ...extra,
    };
    if (schema) body.output_schema = schema;
    if (mode === 'stealth') {
      const cc = AGENT_PROXY_COUNTRIES.includes(country) ? country : 'US';
      body.proxy_config = { enabled: true, country_code: cc };
    }
    ctx.log(`${label}: agent started${mode === 'stealth' ? ' (stealth retry)' : ''}`, { tag: label });
    let run;
    try {
      run = await runAgent(body, {
        onEvent: (ev) => {
          if (ev.type === 'STREAMING_URL') ctx.log(`${label}: live view ready`, { tag: label, live: ev.streaming_url });
          if (ev.type === 'PROGRESS') ctx.log(`${label}: ${ev.purpose}`, { tag: label });
        },
      });
    } catch (err) {
      run = { status: 'FAILED', error: { code: err.code, message: err.message } };
    }
    ctx.log(`${label}: agent finished (${run.steps ?? '?'} steps)`, { tag: label, liveEnd: true });
    ctx.usage('agentRuns');
    if (run.steps) ctx.usage('agentSteps', run.steps);
    last = run;

    const block = run.status === 'COMPLETED' ? detectBlock(run) : (run.error?.code === 'SITE_BLOCKED' ? 'blocked' : null);
    if (run.status === 'COMPLETED' && !block) return { ok: true, ...run, mode };
    if (block && mode === 'lite' && attempts.length > 1) {
      ctx.log(`${label}: site looks ${block === 'captcha' ? 'CAPTCHA-protected' : 'blocked'} — retrying in stealth mode`, { tag: label, level: 'warn' });
      continue;
    }
    if (!block) break; // non-block failure: retrying the same goal rarely helps
  }
  const reason = detectBlock(last) ? 'This site blocks automated browsers (CAPTCHA / bot wall). Check it yourself.' : explainFailure(last);
  ctx.log(`${label}: ${reason}`, { tag: label, level: 'error' });
  return { ok: false, reason, ...last };
}
