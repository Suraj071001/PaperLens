export function publicFailure(e: unknown): string {
  const error =
    e && typeof e === 'object'
      ? (e as {
          status?: number;
          code?: string;
          type?: string;
          error?: { code?: string; type?: string };
        })
      : undefined;
  const codes = [error?.code, error?.type, error?.error?.code, error?.error?.type];
  if (codes.some((code) => code === 'insufficient_quota' || code === 'credit_balance_exhausted'))
    return 'The configured Groq account has no available credits or has reached its spending limit. Add Groq credits or update the server API key, then retry the analysis.';
  if (error?.status === 401)
    return 'Groq rejected the configured API key. Update the server API key, then retry the analysis.';
  if (error?.status === 429)
    return 'Groq is temporarily rate limiting requests. Wait a moment, then retry the analysis.';
  const m = e instanceof Error ? e.message : '';
  if (/413.*tokens per minute|request too large for model/i.test(m))
    return 'Groq rejected this request because its token budget exceeds the account limit. Lower MAX_OUTPUT_TOKENS or reduce the supplied context, then retry.';
  if (
    /OCR_REQUIRED|exceeds|budget|configuration changed|not configured|Invalid source citation|Incomplete comparison|Bibliographic evidence|Evidence citation/.test(
      m,
    )
  )
    return m;
  return 'Processing failed. Check service configuration or retry. If the PDF is encrypted or damaged, upload a readable copy.';
}
