import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { verifyPrivyToken } from './middleware/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS with support for frontend clients
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

// Root Route: API Landing Page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>TicketChain Backend API</title>
      <style>
        body {
          background-color: #0b0f19;
          color: #f1f5f9;
          font-family: system-ui, -apple-system, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
        .container {
          text-align: center;
          padding: 2.5rem;
          background-color: #1e2538;
          border: 1px solid #334155;
          border-radius: 1.5rem;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
          max-width: 500px;
        }
        h1 {
          color: #6366f1;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        p {
          color: #94a3b8;
          font-size: 0.95rem;
          line-height: 1.6;
        }
        .badge {
          display: inline-block;
          padding: 0.35rem 0.75rem;
          background-color: #059669;
          color: white;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: bold;
          margin-top: 1rem;
        }
        .links {
          margin-top: 1.5rem;
        }
        a {
          color: #38bdf8;
          text-decoration: none;
          font-size: 0.9rem;
          margin: 0 0.75rem;
          font-weight: 500;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>TicketChain API</h1>
        <p>This is the secure backend verification server for TicketChain. It authenticates users using Privy JWT tokens and validates them via cryptographic public keys.</p>
        <span class="badge">SYSTEM STATUS: ONLINE</span>
        <div class="links">
          <a href="/api/health">🏥 Health Status</a>
          <a href="/api/user/profile">🔒 Protected Profile</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Public health check route
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'TicketChain Backend Auth Verification Services'
  });
});

// Protected route to test Privy JWT verification
// The verifyPrivyToken middleware ensures only valid authenticated users can access it
app.get('/api/user/profile', verifyPrivyToken, (req, res) => {
  res.json({
    success: true,
    message: 'Authentication successful. You have access to this protected backend resource.',
    user: {
      userId: req.user.sub, // User's Privy DID (e.g. did:privy:cmp...)
      issuer: req.user.iss,
      audience: req.user.aud,
      expiresAt: new Date(req.user.exp * 1000).toISOString(),
      issuedAt: new Date(req.user.iat * 1000).toISOString()
    }
  });
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 TicketChain Backend Server is running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔒 Privy App ID: ${process.env.PRIVY_APP_ID || 'cmpwse3mr000i0ejp1lre5fy9'}`);
  console.log(`🔑 JWKS Endpoint: ${process.env.PRIVY_JWKS_URI || 'https://auth.privy.io/api/v1/apps/cmpwse3mr000i0ejp1lre5fy9/jwks.json'}`);
  console.log(`=================================================`);
});
