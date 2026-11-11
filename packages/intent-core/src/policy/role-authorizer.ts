import type {
  AnyDescriptor,
  Authorizer,
  Decision,
  Failure,
  PrincipalRoles,
} from '../contracts/index.js';

const deny = (code: 'UNAUTHORIZED' | 'AGENT_FORBIDDEN'): Decision => {
  const failure: Failure = { stage: 'policy', code, retryable: false };
  return { allowed: false, failure };
};

const decide = (descriptor: AnyDescriptor, roles: PrincipalRoles<string>): Decision => {
  if (!roles.granted.includes(roles.active)) {
    return deny('UNAUTHORIZED');
  }
  if (descriptor.agent === 'never') {
    return deny('AGENT_FORBIDDEN');
  }
  if (!descriptor.roles.includes(roles.active)) {
    return deny('UNAUTHORIZED');
  }
  return { allowed: true };
};

export const createRoleAuthorizer = <TPrincipal, TRole extends string>(
  rolesOf: (principal: TPrincipal) => PrincipalRoles<TRole>,
): Authorizer<TPrincipal> => ({
  authorize: async (principal, descriptor) => decide(descriptor, rolesOf(principal)),
});
