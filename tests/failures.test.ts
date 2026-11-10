import { describe, expect, it } from 'vitest';
import { publicFailure } from '../packages/ai/src/failures.js';

describe('public processing errors', () => {
  it('distinguishes exhausted credits from transient rate limits', () => {
    expect(
      publicFailure(
        Object.assign(new Error('private provider response'), {
          status: 429,
          code: 'credit_balance_exhausted',
          type: 'insufficient_quota',
        }),
      ),
    ).toContain('no available credits');
    expect(publicFailure({ status: 429, error: { code: 'insufficient_quota' } })).toContain(
      'no available credits',
    );
    expect(publicFailure({ status: 429 })).toContain('temporarily rate limiting');
  });
  it('does not expose provider responses or credentials', () => {
    const failure = publicFailure(Object.assign(new Error('secret-key'), { status: 401 }));
    expect(failure).toContain('rejected the configured API key');
    expect(failure).not.toContain('secret-key');
    expect(publicFailure(new Error('private response'))).not.toContain('private response');
  });
  it('preserves actionable document errors', () => {
    expect(publicFailure(new Error('OCR_REQUIRED: upload searchable text'))).toContain(
      'OCR_REQUIRED',
    );
  });
});
