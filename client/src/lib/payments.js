import { api } from './api';

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the payment page. Check your internet.'));
    document.head.appendChild(s);
  });
}

/**
 * Pay for a held appointment. Resolves true when paid, false if the user
 * closed the payment window. Razorpay offers UPI, cards and net banking.
 * Without Razorpay keys (development) the server returns a "mock" order.
 */
export async function payForAppointment(appointment, { confirmMock, description, contact, method }) {
  const order = await api('/payments/order', { method: 'POST', body: { appointmentId: appointment.id } });

  if (order.provider === 'mock') {
    if (!(await confirmMock(order.amount / 100))) return false;
    await api('/payments/mock-complete', { method: 'POST', body: { orderId: order.orderId } });
    return true;
  }

  await loadCheckout();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'Swasthya Setu',
      description,
      // Opens on the method the patient picked (upi, card or netbanking); others stay available.
      prefill: { ...(contact ? { contact } : {}), ...(method ? { method } : {}) },
      theme: { color: '#1565D8' },
      handler: (resp) => api('/payments/verify', { method: 'POST', body: resp }).then(() => resolve(true), reject),
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on('payment.failed', (resp) => reject(new Error(resp.error?.description || 'Payment failed.')));
    rzp.open();
  });
}

/** Pay cash or UPI at the hospital counter on arrival (in-person visits only). */
export function payAtCounter(appointment) {
  return api('/payments/counter', { method: 'POST', body: { appointmentId: appointment.id } });
}
