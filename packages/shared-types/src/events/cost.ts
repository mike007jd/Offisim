export interface CostAggregatedPayload {
  readonly companyId: string;
  readonly totalCost: number;
  readonly todayCost: number;
  readonly totalCalls: number;
  readonly todayCalls: number;
}
