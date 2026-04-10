import { describe, it, expect } from 'vitest';
import { matchBridgePath, type BridgePathRecord } from '../src/handle';

describe('matchBridgePath', () => {
  const record: BridgePathRecord = {
    handleName: 'MyGameProject',
    absolutePath: '/Users/me/MyGameProject',
  };

  it('returns the absolute path when handle names match', () => {
    expect(matchBridgePath(record, 'MyGameProject')).toBe(
      '/Users/me/MyGameProject',
    );
  });

  it('returns null when no record is stored', () => {
    expect(matchBridgePath(null, 'MyGameProject')).toBeNull();
  });

  it('returns null when handle names differ', () => {
    expect(matchBridgePath(record, 'OtherProject')).toBeNull();
  });

  it('returns null when the stored absolute path is empty', () => {
    expect(
      matchBridgePath(
        { handleName: 'MyGameProject', absolutePath: '' },
        'MyGameProject',
      ),
    ).toBeNull();
  });

  it('is case-sensitive on handle name (matches FSAPI semantics)', () => {
    expect(matchBridgePath(record, 'mygameproject')).toBeNull();
  });
});
