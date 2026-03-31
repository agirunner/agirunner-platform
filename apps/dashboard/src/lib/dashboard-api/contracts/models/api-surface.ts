import type { DashboardApiMethodsPart1 } from './api-methods-part-1.js';
import type { DashboardApiMethodsPart2 } from './api-methods-part-2.js';
import type { DashboardApiMethodsPart3 } from './api-methods-part-3.js';
import type { DashboardApiMethodsPart4 } from './api-methods-part-4.js';

export interface DashboardApi
  extends DashboardApiMethodsPart1,
    DashboardApiMethodsPart2,
    DashboardApiMethodsPart3,
    DashboardApiMethodsPart4
{}
