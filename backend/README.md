# TicketChain optional authentication backend

This Express API verifies Privy access tokens using the application's JWKS keys,
ES256 signatures, issuer `privy.io`, audience and expiration. The main React
application does not depend on this server for its core ticket flows.

```sh
npm ci
npm start
# or: npm run dev
npm test
```

On a fresh setup, copy `.env.example` to `.env`. The existing environment should
be preserved. `PORT` defaults to 5000; `ALLOWED_ORIGINS` is a comma-separated list
of frontend origins. The JWKS URL defaults to the configured `PRIVY_APP_ID`.

- `GET /api/health`: public health response.
- `GET /api/user/profile`: requires `Authorization: Bearer <Privy access token>`.
  The frontend can obtain that token using `getAccessToken()` from `usePrivy()`.
  Missing, malformed, expired, wrongly signed or wrongly scoped tokens receive 401.

Tests use locally generated P-256 keys and do not need a real user's token or
access to Privy. The middleware can be instantiated with `createPrivyTokenVerifier`
for a controlled key resolver in tests.

This is a token-verification service. It does not issue Firebase custom tokens
or secure direct Firestore access; see [the status report](../docs/PRESENTATION_STATUS.md).

Specification: [Privy access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens).
