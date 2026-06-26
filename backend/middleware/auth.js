import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import dotenv from 'dotenv';

dotenv.config();

const privyAppId = process.env.PRIVY_APP_ID || 'cmpwse3mr000i0ejp1lre5fy9';
const jwksUri = process.env.PRIVY_JWKS_URI || 'https://auth.privy.io/api/v1/apps/cmpwse3mr000i0ejp1lre5fy9/jwks.json';

// Initialize the JWKS client pointing to Privy's public keys
const client = jwksClient({
  jwksUri: jwksUri,
  cache: true, // Cache public keys to prevent hitting JWKS endpoint for every request
  rateLimit: true, // Rate limit requests to prevent abuse
  jwksRequestsPerMinute: 10
});

/**
 * Dynamically retrieves the public key matching the key ID (kid) of the JWT header.
 */
function getKey(header, callback) {
  client.getSigningKey(header.kid, function(err, key) {
    if (err) {
      console.error('Error fetching signing key from JWKS:', err);
      callback(err, null);
    } else {
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    }
  });
}

/**
 * Express Middleware to verify Privy JSON Web Tokens (JWT).
 * It extracts the token from the Authorization header (Bearer <token>),
 * verifies its signature using the JWKS endpoint, and validates claims.
 */
export const verifyPrivyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      error: 'Access denied. No authorization token provided or invalid format. Expected: Bearer <token>' 
    });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(
    token, 
    getKey, 
    {
      issuer: 'privy.io',
      audience: privyAppId,
      algorithms: ['RS256']
    }, 
    (err, decoded) => {
      if (err) {
        console.error('Token verification failed:', err.message);
        return res.status(401).json({ 
          success: false, 
          error: `Invalid token: ${err.message}` 
        });
      }
      
      // Attach the decoded token payload to the request object
      // This includes user identity details (e.g., req.user.sub)
      req.user = decoded;
      next();
    }
  );
};
