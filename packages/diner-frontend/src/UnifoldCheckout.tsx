/**
 * Launches the real Unifold checkout modal for a locked-quote payment intent
 * (UNIFOLD_INTEGRATION.md §6).
 *
 * Rendered ONLY inside <UnifoldProvider>, and only when a publishable key is configured — so
 * `useUnifold()` is never called outside its context and the keyless stub demo is unaffected.
 *
 * Mounting is the trigger: App sets a client_secret in state, this component appears and opens the
 * modal. It renders nothing itself; the modal is portalled by the SDK.
 *
 * CRITICAL — the callbacks below are UI FEEDBACK ONLY. The reservation token is minted by
 * app-services when Unifold delivers `payment_intent.succeeded` to POST /webhooks/unifold, never
 * from `onSuccess` here. A client callback is not proof of settlement (the user can close the tab
 * mid-flight, and a hostile client could call it outright), which is why fulfillment lives behind
 * the signature-verified webhook. See unifold-gateway.ts `normalizeUnifoldEvent`.
 */
import { useEffect, useRef } from 'react';
import { useUnifold } from '@unifold/connect-react';
import { errText } from './api';

interface Props {
  /** client_secret from POST /pools/:id/buy → `checkout.client_secret`. */
  clientSecret: string;
  /** Diner finished paying. Settlement is still pending on the webhook. */
  onSubmitted: () => void;
  /** Modal reported a failure, or the diner dismissed it without paying. */
  onFailed: (message: string) => void;
  onDismissed: () => void;
}

export function UnifoldCheckout({ clientSecret, onSubmitted, onFailed, onDismissed }: Props) {
  const { beginCheckout, closeCheckout } = useUnifold();

  // Callbacks are read through a ref so that a re-render with new closures never re-triggers the
  // effect below — reopening a modal mid-payment would be a real bug, not just a flicker.
  const cbs = useRef({ onSubmitted, onFailed, onDismissed });
  cbs.current = { onSubmitted, onFailed, onDismissed };

  useEffect(() => {
    if (!clientSecret) return;
    let live = true;

    // React 18 StrictMode double-invokes effects in dev; `live` + the cleanup's closeCheckout()
    // keep that from leaving a second orphaned modal behind.
    void beginCheckout({
      clientSecret,
      // The diner funds from Solana USDC by default, matching the gateway's source_currency /
      // source_network. They can still pick any other token in the modal.
      defaultSourceChainType: 'solana',
      defaultSourceChainId: 'mainnet',
      defaultSourceSymbol: 'USDC',
      onSuccess: () => {
        if (live) cbs.current.onSubmitted();
      },
      onError: (e) => {
        // The SDK's CheckoutError is not an Error instance, and its useful text is not always on
        // `.message` — a wallet with no gas for the transaction surfaces nested. errText digs.
        if (live) cbs.current.onFailed(errText(e, 'Checkout failed.'));
      },
      onClose: () => {
        if (live) cbs.current.onDismissed();
      },
    }).catch((e: unknown) => {
      if (live) cbs.current.onFailed(e instanceof Error ? e.message : String(e));
    });

    return () => {
      live = false;
      closeCheckout();
    };
    // Intentionally keyed on clientSecret alone: one modal per intent.
  }, [clientSecret, beginCheckout, closeCheckout]);

  return null;
}
