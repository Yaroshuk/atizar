// Delivery resolution moved to @platform/core (pure, server-reusable). This re-export keeps
// existing client imports stable; prefer importing from '@platform/core' directly in new code.
export { resolveDelivery, deliveryKey, type DeliveryResult } from '@platform/core'
