/**
 * Types shared by the HTTP layer: the Hono environment (variables set by the
 * auth middleware) and the dependencies every route module receives.
 */
import type {Context} from 'hono';
import type {Config} from '../config.ts';
import type {Db} from '../db/db.ts';
import type {LoginLimits} from '../auth/service.ts';
import type {SessionUser} from '../../../shared/logistics/contracts.ts';

export interface AppEnv {
  Variables: {
    user: SessionUser;
    token: string;
  };
}

export type AppContext = Context<AppEnv>;

export interface Deps {
  db: Db;
  config: Config;
  now: () => Date;
  limits: LoginLimits;
  clientIp: (c: Context) => string;
}
