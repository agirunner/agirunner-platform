export type TestScope = 'admin' | 'worker' | 'agent';

export interface TestIdentity {
  id: string;
  tenantId: string;
  scope: TestScope;
  ownerType: string;
  ownerId: string | null;
  keyPrefix: string;
}

const DEFAULT_TEST_IDENTITY: TestIdentity = {
  id: 'test-key-id',
  tenantId: '00000000-0000-0000-0000-000000000001',
  scope: 'admin',
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'ar_admin_tst',
};

export function createTestIdentity(overrides: Partial<TestIdentity> = {}): TestIdentity {
  return {
    ...DEFAULT_TEST_IDENTITY,
    ...overrides,
  };
}

export function createBearerHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
