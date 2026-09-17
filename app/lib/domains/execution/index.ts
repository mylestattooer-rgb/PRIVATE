// Public surface of the execution domain.

export type {
  BrokerAccount,
  BrokerOrderState,
  BrokerPosition,
  Halt,
  HaltReason,
  OrderIntent,
  OrderRecord,
  OrderRequest,
  OrderSide,
  OrderStatus,
} from "./types";
export { isTerminal, TERMINAL_STATUSES } from "./types";

export { deriveClientOrderId, MAX_CLIENT_ORDER_ID_LENGTH } from "./client-order-id";
export type { OrderIdentity } from "./client-order-id";

export { LiveGatewayRefusedError } from "./gateway";
export type { BrokerGateway, CancelOutcome, SubmitOutcome } from "./gateway";

export { createInMemoryOrderStore } from "./order-store";
export type { OrderStore } from "./order-store";

export { submitOrder } from "./submit";
export type { SubmitContext, SubmitResult } from "./submit";

export { derivePositionsFromOrders, deriveWorkingQuantities, reconcile } from "./reconcile";
export type {
  Discrepancy,
  DiscrepancyKind,
  PositionQuantity,
  ReconcileContext,
  ReconciliationReport,
} from "./reconcile";

export { createFakeGateway } from "./fake-gateway";
export type { FakeGateway, FakeGatewayOptions, QueryFault, SubmitFault } from "./fake-gateway";
