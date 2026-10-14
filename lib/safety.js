// Guardrails shared by every chore. Errand never spends money, never types
// secrets, and never presses an irreversible button without a human approval.

export const READ_ONLY_RULES = `
STRICT RULES (always follow):
- Read only. Do NOT add to cart, buy, book, subscribe, log in, sign up, or submit any form.
- Never enter passwords, OTPs, card numbers, UPI IDs, bank or government ID numbers.
- Close cookie banners / popups by choosing the least-permissive option ("Reject", "Necessary only", "X").
- If you hit a CAPTCHA, a login wall, or an "access denied" page, stop and report it in page_status instead of trying to bypass it.`;

export const SUBMIT_RULES = `
STRICT RULES (always follow):
- Only type the exact values listed in APPROVED VALUES. Do not invent, guess, or alter any value.
- Leave every field not listed empty (or at its default).
- Never enter passwords, OTPs, card numbers, UPI IDs, bank details or government ID numbers, even if a field asks for them.
- If the form leads to a payment step, a login wall, or a CAPTCHA, STOP before it and report it. Never pay.
- If a field cannot be found or filled after 2 attempts, skip it, mention it in stopped_reason, and carry on. Do not reload the page repeatedly.
- Submit at most once. Do not click any further buttons after the confirmation page loads.`;

// Field labels the agent must never fill on the user's behalf.
const SENSITIVE = /(pass(word|code)|otp|one[- ]time|\bpin\b(?!\s*code)|cvv|cvc|card\s*(number|no)|credit|debit|expiry|upi|iban|ifsc|account\s*(number|no)|routing|aadhaar|aadhar|\bpan\b|ssn|social security|passport)/i;
export const isSensitiveField = (label = '') => SENSITIVE.test(label);

// COMPLETED does not mean the goal succeeded; look for failure signals.
const BLOCK_SIGNALS = /(captcha|access denied|are you a robot|verify you are human|blocked|forbidden|unusual traffic|cloudflare)/i;
export function detectBlock(run) {
  if (run.error?.code === 'SITE_BLOCKED') return 'blocked';
  const status = run.result?.page_status;
  if (status === 'blocked' || status === 'captcha') return status;
  if (run.status === 'COMPLETED' && !run.result) return 'empty';
  const text = JSON.stringify(run.result || '');
  if (text.length < 400 && BLOCK_SIGNALS.test(text)) return 'blocked';
  return null;
}

// Human-friendly explanation for a failed agent run.
export function explainFailure(run) {
  const code = run.error?.code || run.error?.category;
  const map = {
    SITE_BLOCKED: 'The site blocked automated access, even after a stealth retry.',
    TIMEOUT: 'The site took too long to respond.',
    MAX_STEPS_EXCEEDED: 'The page was too complex to finish within the step budget.',
    BILLING_REJECTED: 'Your TinyFish wallet is out of credit — top up at agent.tinyfish.ai/wallet.',
    TASK_FAILED: 'The agent could not complete the task on this page.',
  };
  return map[code] || run.error?.message || 'The agent could not complete the task.';
}
