# TicketChain Backend: Privy Authentication Integration

This is the backend server for TicketChain V2, responsible for verifying user identities and securing API endpoints using **Privy JWT Authentication**.

It utilizes Privy's JSON Web Key Set (JWKS) to fetch public signing keys on the fly and verify access tokens sent by the client.

---

## 🚀 Setup & Execution

### 1. Install Dependencies
Navigate to the `backend` directory and run:
```bash
cd backend
npm install
```

### 2. Configure Environment Variables
A `.env` file has been automatically created for you in this directory:
```env
PORT=5000
PRIVY_APP_ID=cmpwse3mr000i0ejp1lre5fy9
PRIVY_JWKS_URI=https://auth.privy.io/api/v1/apps/cmpwse3mr000i0ejp1lre5fy9/jwks.json
ALLOWED_ORIGINS=http://localhost:5173
```

### 3. Run the Server
Run the development server (with automatic reload on file changes):
```bash
npm run dev
```

Or start the production server:
```bash
npm start
```

---

## 🔒 How Authentication Works (Frontend ➡️ Backend)

### Step 1: Extract the Access Token on the Frontend
In your React code, you can fetch the Privy access token using Privy's `getAccessToken` function from the `usePrivy` hook:

```javascript
import { usePrivy } from '@privy-io/react-auth';

// Inside your React component:
const { getAccessToken, authenticated } = usePrivy();

const fetchProtectedData = async () => {
  if (!authenticated) {
    console.error("User is not authenticated");
    return;
  }
  
  try {
    // 1. Fetch the short-lived access token from Privy client
    const token = await getAccessToken();
    
    // 2. Transmit the token via the Authorization header
    const response = await fetch('http://localhost:5000/api/user/profile', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    console.log("Protected API Response:", data);
  } catch (error) {
    console.error("Failed to query backend:", error);
  }
};
```

### Step 2: Signature Validation on the Backend
When the client request hits the backend:
1. The `verifyPrivyToken` middleware extracts the token from the HTTP `Authorization` header.
2. It fetches Privy's public signing keys from `https://auth.privy.io/api/v1/apps/cmpwse3mr000i0ejp1lre5fy9/jwks.json` (caches keys locally to limit external traffic).
3. It validates that the token:
   * Is signed using an active Privy public key (`RS256` algorithm).
   * Has not expired (`exp` claim).
   * Was issued by Privy (`iss` claim = `privy.io`).
   * Is intended for your specific app (`aud` claim = `cmpwse3mr000i0ejp1lre5fy9`).
4. If valid, the decoded payload containing the user's Privy DID (`req.user.sub`) is attached to the request (`req.user`), and execution proceeds to your route handler.
