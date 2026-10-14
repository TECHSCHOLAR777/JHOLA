// FORM FILL — "Fill this registration / application / RSVP form for me."
//
// Two-phase commit so nothing is ever sent without the user seeing it:
//   Phase 1 (dry run): Agent reads the live form, maps each field to the user's
//                      saved profile, and types NOTHING.
//   Approval:          The user reviews/edits every value. Sensitive fields
//                      (passwords, OTP, card, ID numbers) are locked out.
//   Phase 2 (submit):  Agent fills exactly the approved values and submits once.
//                      If a new page reveals unknown fields, it stops and asks again.

import { smartRun } from '../agent.js';
import { READ_ONLY_RULES, SUBMIT_RULES, isSensitiveField } from '../safety.js';

const FIELD = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    type: { type: 'string' },
    required: { type: 'boolean' },
    options: { type: 'array', items: { type: 'string' } },
    proposed_value: { type: 'string', nullable: true },
    profile_key: { type: 'string', nullable: true },
  },
  required: ['label', 'type', 'required'],
};

const DRY_SCHEMA = {
  type: 'object',
  properties: {
    form_title: { type: 'string' },
    fields: { type: 'array', items: FIELD },
    submit_button_label: { type: 'string', nullable: true },
    multi_page: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    page_status: { type: 'string', enum: ['ok', 'blocked', 'captcha', 'not_found', 'no_form', 'login_required', 'closed'] },
  },
  required: ['form_title', 'fields', 'page_status'],
};

const SUBMIT_SCHEMA = {
  type: 'object',
  properties: {
    submitted: { type: 'boolean' },
    confirmation_text: { type: 'string', nullable: true },
    confirmation_id: { type: 'string', nullable: true },
    stopped_reason: { type: 'string', nullable: true },
    new_fields: { type: 'array', items: FIELD },
    page_status: { type: 'string', enum: ['ok', 'blocked', 'captcha', 'payment_required', 'login_required', 'error'] },
  },
  required: ['submitted', 'page_status'],
};

const safeProfile = (profile) => Object.fromEntries(
  Object.entries(profile || {}).filter(([k, v]) => v && !isSensitiveField(k)),
);

function lockSensitive(fields) {
  return fields.map((f) => isSensitiveField(f.label)
    ? { ...f, proposed_value: null, locked: true, note: 'Sensitive — Errand never fills this. Do it yourself.' }
    : { ...f, locked: false, missing: f.required && !f.proposed_value });
}

export async function formFill(ctx, input) {
  const url = String(input.url || '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error('Give me the full form URL (https://…).');
  const profile = safeProfile(input.profile);
  const instructions = (input.instructions || '').trim();

  ctx.step('dryrun', 'Reading the form (dry run — nothing is typed)');
  const dryGoal = `Inspect the form on this page${instructions ? ` (context from the user: "${instructions}")` : ''}.
List EVERY input field in order with its visible label, type, whether it's required, and its options for select/radio/checkbox.
For each field, propose a value using ONLY this saved profile (JSON): ${JSON.stringify(profile)}
${instructions ? `You may also use facts stated in the user's context above.` : ''}
Set proposed_value to null if the profile has no suitable value — never invent data. Set profile_key to the profile key you used.
Report blockers such as login required, CAPTCHA, payment, or "form closed".
Do NOT type into any field. Do NOT click submit/next. ${READ_ONLY_RULES}`;
  const dry = await smartRun(ctx, { url, goal: dryGoal, schema: DRY_SCHEMA, country: input.country, label: 'dry run', maxSeconds: 180 });
  if (!dry.ok) return { status: 'failed', message: dry.reason };
  const form = dry.result;
  if (form.page_status !== 'ok' || !form.fields?.length) {
    const why = { no_form: 'I could not find a form on that page.', login_required: 'This form needs you to log in first.', closed: 'This form is no longer accepting responses.' }[form.page_status]
      || `The page reported: ${form.page_status}${form.blockers?.length ? ` (${form.blockers.join('; ')})` : ''}`;
    return { status: 'needs_input', message: why, form };
  }

  let fields = lockSensitive(form.fields);
  let round = 0;
  while (round++ < 3) {
    ctx.step('review', `Waiting for your approval (${fields.length} field(s))`);
    const answer = await ctx.askApproval({
      kind: 'form_review',
      title: form.form_title,
      url,
      blockers: form.blockers || [],
      submitLabel: form.submit_button_label,
      fields,
      message: round === 1
        ? 'Review every value below. Nothing has been typed yet. Approve to fill & submit once.'
        : 'The form showed more fields after the first page. Review them to continue.',
    });
    if (!answer.approved) {
      ctx.step('done', 'You cancelled — nothing was submitted.');
      return { status: 'cancelled', message: 'Cancelled by you. Nothing was submitted.', form };
    }
    const approved = (answer.data.fields || fields)
      .filter((f) => !f.locked && !isSensitiveField(f.label) && f.value != null && String(f.value).trim() !== '')
      .map((f) => ({ label: f.label, value: String(f.value).trim() }));
    const missingRequired = (answer.data.fields || fields).filter((f) => f.required && !f.locked && !String(f.value ?? '').trim());
    if (missingRequired.length) ctx.log(`Note: ${missingRequired.length} required field(s) left blank: ${missingRequired.map((f) => f.label).join(', ')}`, { level: 'warn' });

    ctx.step('submit', `Filling ${approved.length} approved value(s) and submitting`);
    const submitGoal = `Fill the form on this page and submit it ONCE.
APPROVED VALUES (label → value):
${approved.map((a) => `- "${a.label}" → "${a.value}"`).join('\n')}
For select/radio/checkbox fields pick the option that matches the approved value.
If the form has multiple pages, click Next/Continue between them. If a later page shows required fields that are NOT in APPROVED VALUES, STOP without submitting and list them in new_fields.
After submitting, copy the confirmation message and any reference/confirmation number.
${SUBMIT_RULES}`;
    const sub = await smartRun(ctx, { url, goal: submitGoal, schema: SUBMIT_SCHEMA, country: input.country, label: 'submit', maxSeconds: 300 });
    if (!sub.ok) return { status: 'failed', message: sub.reason, approved };
    const r = sub.result;
    if (r.submitted) {
      const msg = `Submitted. ${r.confirmation_text || ''}${r.confirmation_id ? ` (ref: ${r.confirmation_id})` : ''}`.trim();
      ctx.step('done', msg);
      return { status: 'done', message: msg, submitted: r, approved, form: { title: form.form_title, url } };
    }
    if (r.new_fields?.length) {
      ctx.log(`Stopped before submitting: ${r.new_fields.length} new field(s) need your input`, { level: 'warn' });
      fields = [...fields.map((f) => ({ ...f, proposed_value: approved.find((a) => a.label === f.label)?.value ?? f.proposed_value })), ...lockSensitive(r.new_fields)];
      continue;
    }
    const why = r.stopped_reason || r.page_status;
    ctx.step('done', `Not submitted: ${why}`);
    return { status: 'needs_input', message: `Not submitted — ${why}. Nothing was paid or sent beyond this point.`, approved, submitted: r };
  }
  return { status: 'needs_input', message: 'The form kept asking for more fields; finish it yourself from here.' };
}
