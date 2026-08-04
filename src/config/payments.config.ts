import { registerAs } from '@nestjs/config';

export const PAYMENTS_CONFIG_KEY = 'payments';

/**
 * Payment gateway credentials and endpoints.
 *
 * Every gateway is optional. Credentials are issued per merchant and are not
 * available in development, so an unconfigured gateway is a first-class state:
 * it is reported as unavailable at checkout rather than failing at the point of
 * payment, and the rest of the platform — cash on delivery and the wallet —
 * keeps working without it.
 */
export const paymentsConfig = registerAs(PAYMENTS_CONFIG_KEY, () => {
  const publicUrl = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  return {
    /** Where the gateways send the customer's browser and their callbacks. */
    publicBaseUrl: publicUrl,

    /** Minutes a hosted checkout stays valid before the attempt expires. */
    checkoutTtlMinutes: Number(process.env.PAYMENT_CHECKOUT_TTL_MINUTES ?? 15),

    jazzcash: {
      merchantId: process.env.JAZZCASH_MERCHANT_ID ?? '',
      password: process.env.JAZZCASH_PASSWORD ?? '',
      /** Shared secret the HMAC over the request fields is keyed with. */
      integritySalt: process.env.JAZZCASH_INTEGRITY_SALT ?? '',
      checkoutUrl:
        process.env.JAZZCASH_CHECKOUT_URL ??
        'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform',
      /** Server-to-server status inquiry and refund endpoint. */
      apiUrl:
        process.env.JAZZCASH_API_URL ??
        'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/PaymentInquiry/Inquire',
    },

    easypaisa: {
      storeId: process.env.EASYPAISA_STORE_ID ?? '',
      /** Key the request parameters are encrypted with to form the hash. */
      hashKey: process.env.EASYPAISA_HASH_KEY ?? '',
      checkoutUrl:
        process.env.EASYPAISA_CHECKOUT_URL ?? 'https://easypay.easypaisa.com.pk/easypay/Index.jsf',
      apiUrl:
        process.env.EASYPAISA_API_URL ?? 'https://easypay.easypaisa.com.pk/easypay-service/rest/v4',
    },
  };
});
