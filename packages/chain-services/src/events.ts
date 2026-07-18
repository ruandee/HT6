/**
 * Chain event seam (§10.3). The program emits an event on every state change; the indexer
 * subscribes and writes the read model. On devnet these come off the Anchor event log; on the
 * mock they come off `MockChainAdapter.emitter` — SAME shape, so SWAP A does not touch the
 * indexer.
 *
 * These events DESCRIBE authoritative chain state; they are not themselves authoritative
 * (§0 money-authority rule). `tx_sig` is the idempotency key — the indexer dedupes on it, so a
 * replay/backfill/restart cannot double-apply a trade.
 */
import type {
  Address,
  Bps,
  EventKind,
  PoolId,
  TxSig,
  UnixSeconds,
  UsdcBaseUnits,
  UserId,
} from '@ttr/shared-types';

/** Fields every chain event carries. */
export interface ChainEventBase {
  tx_sig: TxSig;
  pool_id: PoolId;
  /** chain block time (seconds). On the mock this is the injectable clock (§ mock `now`). */
  block_time: UnixSeconds;
  /** post-event curve state, so the indexer never has to call back into the chain. */
  n_sold: number;
  theta_bps: Bps;
  /** post-event reserve balance in USDC base units (cached mirror only). */
  reserve_balance: UsdcBaseUnits;
}

export interface PoolCreatedEvent extends ChainEventBase {
  kind: 'create';
  authority: Address;
  mint: Address;
  p0: UsdcBaseUnits;
  k: UsdcBaseUnits;
  n_max: number;
  phi_bps: Bps;
  service_time: UnixSeconds;
  tc_seconds: number;
  party_size: number;
}

export interface BuyEvent extends ChainEventBase {
  kind: 'buy';
  user_id: UserId;
  price_paid: UsdcBaseUnits;
  /** next buy price after this fill (what the UI shows as spot). */
  buy_price: UsdcBaseUnits;
  sell_price: UsdcBaseUnits;
}

export interface SellEvent extends ChainEventBase {
  kind: 'sell';
  user_id: UserId;
  /** net of the φ royalty. */
  payout: UsdcBaseUnits;
  buy_price: UsdcBaseUnits;
  sell_price: UsdcBaseUnits;
}

export interface RedeemEvent extends ChainEventBase {
  kind: 'redeem';
  user_id: UserId;
}

/** Issuer marked the diner arrived. Always accompanied by the redeem it triggers. */
export interface CheckInEvent extends ChainEventBase {
  kind: 'checkin';
  user_id: UserId;
  restaurant_authority: Address;
}

export interface SweepEvent extends ChainEventBase {
  kind: 'sweep';
  restaurant_authority: Address;
  amount_swept: UsdcBaseUnits;
  consumed_count: number;
  forfeited_count: number;
  credits_to_honor: UsdcBaseUnits;
}

export type ChainEvent =
  | PoolCreatedEvent
  | BuyEvent
  | SellEvent
  | RedeemEvent
  | CheckInEvent
  | SweepEvent;

/** Compile-time guard that our event kinds stay in lockstep with the frozen §10.3 EventKind. */
export type _EventKindsMatch = ChainEvent['kind'] extends EventKind ? true : never;

/**
 * The per-kind fields of an event, minus the curve snapshot the emitter fills in. Distributive
 * so each variant keeps its OWN extra fields — a plain `Omit<ChainEvent, ...>` over a union
 * collapses to the keys common to every variant and would reject `user_id`/`authority`.
 */
export type ChainEventPayload<E extends ChainEvent = ChainEvent> = E extends ChainEvent
  ? Omit<E, 'pool_id' | 'block_time' | 'n_sold' | 'theta_bps' | 'reserve_balance'>
  : never;

export type ChainEventListener = (event: ChainEvent) => void;

/**
 * Deliberately tiny: a synchronous fan-out with no backpressure or async semantics, because the
 * mock is in-process and the real adapter will bridge Anchor's log subscription into the same
 * call. A listener that throws must not break the trade that emitted it — the chain already
 * committed, and the read model is only a cache.
 */
export class ChainEventEmitter {
  private listeners: ChainEventListener[] = [];

  on(listener: ChainEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  emit(event: ChainEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        // Read-cache failures never fail a chain operation (§0).
        console.error('[chain-services] event listener threw:', err);
      }
    }
  }
}
