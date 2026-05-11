# Bulk Manager Backend

A Flask backend server for handling user authentication, delete tracking, and Stripe subscription payments for the Bulk Manager Chrome extension.

## Setup

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Set Up MongoDB Atlas

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free account
3. Create a new cluster (free tier)
4. In "Database Access", create a user with username and password
5. In "Network Access", add your IP (or `0.0.0.0` for testing)
6. Click "Connect" on your cluster and copy the connection string
7. The URL should look like: `mongodb+srv://username:password@cluster.mongodb.net/bulk-manager?retryWrites=true&w=majority`

### 3. Set Up Environment Variables

Create a `.env` file in the `backend` folder:

```bash
cp .env.example .env
```

Then edit `.env` and fill in all values:

```
FLASK_ENV=development
SECRET_KEY=your-secret-key-here
JWT_SECRET_KEY=your-jwt-secret-key-here
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/bulk-manager?retryWrites=true&w=majority
STRIPE_PUBLIC_KEY=pk_test_your_key
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_test_your_webhook_secret
```

### 4. Run the Backend

```bash
python app.py
```

The backend will start on `http://127.0.0.1:5000`

## API Endpoints

### Authentication

#### Register
- **POST** `/api/auth/register`
- Body:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword"
  }
  ```
- Returns: `{ "token": "jwt_token", "user_id": "...", "email": "...", "is_pro": false }`

#### Login
- **POST** `/api/auth/login`
- Body:
  ```json
  {
    "email": "user@example.com",
    "password": "securepassword"
  }
  ```
- Returns: `{ "token": "jwt_token", "user_id": "...", "email": "...", "is_pro": false }`

#### OAuth (Google, etc.)
- **POST** `/api/auth/oauth`
- Body:
  ```json
  {
    "provider": "google",
    "email": "user@example.com",
    "provider_id": "google_user_id",
    "id_token": "google_id_token"
  }
  ```
- Returns: `{ "token": "jwt_token", "user_id": "...", "email": "...", "is_pro": false }`

### User Management (requires auth token)

#### Get Profile
- **GET** `/api/user/profile`
- Headers: `Authorization: Bearer <jwt_token>`
- Returns: User profile with delete stats

#### Log Delete
- **POST** `/api/user/log-delete`
- Headers: `Authorization: Bearer <jwt_token>`
- Body:
  ```json
  {
    "count": 1
  }
  ```
- Returns: Updated delete stats or error if limit reached

### Payments

#### Create Checkout Session
- **POST** `/api/create-checkout-session`
- Headers: `Authorization: Bearer <jwt_token>`
- Body:
  ```json
  {
    "priceType": "monthly"
  }
  ```
- Returns: `{ "sessionId": "stripe_session_id" }`

### Health Check

- **GET** `/health`
- Returns: `{ "status": "ok" }`

## Delete Limits

- **Free users**: 10 deletes per day (resets every 24 hours)
- **Pro users**: Unlimited deletes

## Database Collections

### users
```json
{
  "_id": ObjectId,
  "email": "user@example.com",
  "password_hash": "bcrypt_hash",
  "auth_provider": "email|google",
  "provider_id": "oauth_provider_id",
  "is_pro": false,
  "stripe_customer_id": "cus_...",
  "subscription_id": "sub_...",
  "created_at": ISODate,
  "updated_at": ISODate
}
```

### delete_logs
```json
{
  "_id": ObjectId,
  "user_id": ObjectId,
  "deleted_count": 1,
  "date": ISODate
}
```

## Development vs Production

- **Development**: Uses in-memory auth and local MongoDB
- **Production**: Use Stripe live keys, secure JWT secret, MongoDB Atlas production cluster

Set `FLASK_ENV=production` for production deployments.

## Troubleshooting

**CORS errors**: Make sure your Chrome extension domain is in the CORS allowed list

**MongoDB connection failed**: Check your MONGO_URI and IP whitelist in MongoDB Atlas

**Authentication failed**: Verify JWT_SECRET_KEY is set correctly

**Stripe errors**: Check your API keys are correct and match your environment (test vs. live)

## Next Steps

1. Wire login UI to the extension
2. Store JWT token in chrome.storage
3. Send token with delete requests to backend
4. Update delete counter based on server response
5. Configure Stripe keys for payments

