import type { TenantConfig } from './tenant';

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantConfig;
    }
  }
}

export {};
