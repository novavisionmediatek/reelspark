// Razorpay Checkout is a web-only, script-injected overlay. This app is a
// react-native-web build that always runs in a browser, so we load checkout.js
// lazily the first time the user taps "Pay" and reuse it after that.

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const LOAD_TIMEOUT_MS = 15000;

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name?: string;
  description?: string;
  image?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler?: (response: RazorpayHandlerResponse) => void;
  modal?: { ondismiss?: () => void };
}

export interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', cb: (e: { error?: { description?: string } }) => void) => void;
}

let loadPromise: Promise<void> | null = null;

/** Inject checkout.js once; resolves when window.Razorpay is available. */
export function loadCheckoutScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Razorpay is only available in the browser.'));
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      loadPromise = null;
      reject(new Error('Could not load the payment form — disable blockers and retry.'));
    }, LOAD_TIMEOUT_MS);

    const onLoad = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (window.Razorpay) resolve();
      else {
        loadPromise = null;
        reject(new Error('Payment form failed to initialise.'));
      }
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      loadPromise = null;
      reject(new Error('Could not load the payment form — disable blockers and retry.'));
    };

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.head.appendChild(script);
    } else if (window.Razorpay) {
      onLoad();
    }
  });

  return loadPromise;
}

/** Construct + open the Checkout widget. Call loadCheckoutScript() first. */
export function openCheckout(options: RazorpayOptions): RazorpayInstance {
  if (typeof window === 'undefined' || !window.Razorpay) {
    throw new Error('Payment form is not ready.');
  }
  const rzp = new window.Razorpay(options);
  rzp.open();
  return rzp;
}

/** Razorpay's `contact` prefill wants a bare 10-digit / +91 number or it nags. */
export function looksLikePhone(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^(\+91)?[6-9]\d{9}$/.test(value.replace(/[\s-]/g, ''));
}
