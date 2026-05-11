import os
import stripe
import bcrypt
import jwt
import random
import string
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_pymongo import PyMongo
try:
    from .config import config
    from .models import User, DeleteLog
except Exception:
    # Fallback for running the module as a script (non-package context)
    from config import config
    from models import User, DeleteLog
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
env = os.getenv('FLASK_ENV', 'development')
app.config.from_object(config[env])

# Configure MongoDB
app.config['MONGO_URI'] = os.getenv('MONGO_URI')
mongo = PyMongo(app)

# Enable CORS for extension and page requests
# Allow all origins for now so content-script fetches from the ChatGPT page aren't blocked.
# In production you should restrict this to the known origins (chrome-extension://*, https://chat.openai.com, etc.)
CORS(app, resources={r"/*": {"origins": ["*"]}})

FREE_DAILY_DELETE_LIMIT = 10


def get_bootstrap_admin_emails():
    """Read bootstrap admin emails from env var ADMIN_EMAILS."""
    raw = os.getenv('ADMIN_EMAILS', '')
    return {email.strip().lower() for email in raw.split(',') if email.strip()}


def is_bootstrap_admin_email(email):
    return (email or '').strip().lower() in get_bootstrap_admin_emails()


def apply_bootstrap_admin_if_needed(user):
    """Ensure configured bootstrap admins always have admin role in DB."""
    if not user:
        return user

    email = (user.get('email') or '').strip().lower()
    if is_bootstrap_admin_email(email) and not user.get('is_admin', False):
        User.update(mongo.db, user['_id'], {'is_admin': True})
        user['is_admin'] = True
    return user

# Initialize Stripe
stripe.api_key = app.config['STRIPE_SECRET_KEY']

# JWT authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'error': 'Missing authorization token'}), 401
        
        try:
            data = jwt.decode(token, app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
            user = User.find_by_id(mongo.db, data['user_id'])
            if not user:
                return jsonify({'error': 'User not found'}), 401
            user = apply_bootstrap_admin_if_needed(user)
            request.user = user
            request.user_id = user['_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = getattr(request, 'user', None)
        if not user or not user.get('is_admin', False):
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated

# Health check endpoint
@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'message': 'Backend is running'}), 200


@app.route('/feedback', methods=['GET'])
def feedback_page():
    """Serve the public uninstall feedback page."""
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    return send_from_directory(static_dir, 'feedback.html')


@app.route('/terms', methods=['GET'])
def terms_page():
    """Serve the public terms / click-through agreement page."""
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    return send_from_directory(static_dir, 'terms.html')


@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    """Store anonymous or identified extension feedback."""
    try:
        data = request.json or {}
        feedback = {
            'email': (data.get('email') or '').strip().lower() or None,
            'rating': data.get('rating'),
            'reason': (data.get('reason') or '').strip() or None,
            'comments': (data.get('comments') or '').strip() or None,
            'source': (data.get('source') or 'unknown').strip(),
            'page_url': (data.get('page_url') or '').strip() or None,
            'user_agent': request.headers.get('User-Agent', ''),
            'created_at': datetime.utcnow(),
        }

        if not feedback['email'] and not feedback['reason'] and not feedback['comments']:
            return jsonify({'error': 'Please add a reason or comment'}), 400

        mongo.db.feedback.insert_one(feedback)
        return jsonify({'success': True}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/uninstall/cancel-subscription', methods=['POST'])
def cancel_subscription_on_uninstall():
    """Schedule subscription cancellation when the user uninstalls the extension.

    The user account remains active; only the paid plan is scheduled to stop at the end
    of the current billing period.
    """
    try:
        data = request.json or {}
        email = (data.get('email') or '').strip().lower()

        if not email:
            return jsonify({'error': 'Email is required'}), 400

        user = User.find_by_email(mongo.db, email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        subscription_id = user.get('subscription_id')
        if not subscription_id:
            return jsonify({
                'success': True,
                'canceled': False,
                'message': 'No active subscription found'
            }), 200

        stripe.Subscription.modify(subscription_id, cancel_at_period_end=True)

        return jsonify({
            'success': True,
            'canceled': True,
            'message': 'Subscription will cancel at the end of the billing period'
        }), 200
    except stripe.error.StripeError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Register with email/password
def send_verification_code(email, code):
    """Send verification code to user email."""
    # For development: just log it. In production, use SendGrid, AWS SES, etc.
    print(f"[VERIFICATION EMAIL] To: {email} | Code: {code}")
    # TODO: Integrate with SendGrid or AWS SES for production
    return True

@app.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new user with email and password."""
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        terms_accepted = bool(data.get('termsAccepted', False))
        
        if not email or not password:
            return jsonify({'error': 'Email and password required'}), 400

        if not terms_accepted:
            return jsonify({'error': 'You must accept the Terms of Use to register'}), 400
        
        # Check if user exists
        if User.find_by_email(mongo.db, email):
            return jsonify({'error': 'User already exists'}), 400
        
        # Hash password
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Create user (not verified yet)
        user_id = User.create(mongo.db, email, password_hash=password_hash, auth_provider='email')

        # Bootstrap admin role from environment for selected accounts
        if is_bootstrap_admin_email(email):
            User.update(mongo.db, user_id, {'is_admin': True})

        # Generate verification code (6 digits)
        verification_code = ''.join(random.choices(string.digits, k=6))
        verification_expires = datetime.utcnow() + timedelta(minutes=15)
        
        User.update(mongo.db, user_id, {
            'terms_accepted': True,
            'terms_version': '1.0',
            'terms_accepted_at': datetime.utcnow(),
            'verification_code': verification_code,
            'verification_code_expires': verification_expires
        })
        
        # Send verification code to email
        send_verification_code(email, verification_code)
        
        return jsonify({
            'message': 'Registration successful. Check your email for verification code.',
            'user_id': str(user_id),
            'email': email,
            'requires_verification': True
        }), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Login with email/password
@app.route('/api/auth/login', methods=['POST'])
def login():
    """Login with email and password."""
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Email and password required'}), 400
        
        # Find user
        user = User.find_by_email(mongo.db, email)
        if not user or not bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8')):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Check if user is verified
        if not user.get('is_verified', False):
            return jsonify({
                'error': 'Please verify your email first',
                'requires_verification': True,
                'user_id': str(user['_id']),
                'email': user['email']
            }), 403
        
        user = apply_bootstrap_admin_if_needed(user)
        
        # Generate JWT token
        token = jwt.encode(
            {'user_id': str(user['_id']), 'exp': datetime.utcnow() + timedelta(days=30)},
            app.config['JWT_SECRET_KEY'],
            algorithm='HS256'
        )
        
        return jsonify({
            'token': token,
            'user_id': str(user['_id']),
            'email': user['email'],
            'is_pro': user.get('is_pro', False),
            'is_admin': user.get('is_admin', False)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/verify', methods=['POST'])
def verify_email():
    """Verify email with verification code."""
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        code = data.get('code', '').strip()
        
        if not email or not code:
            return jsonify({'error': 'Email and verification code required'}), 400
        
        # Find user
        user = User.find_by_email(mongo.db, email)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Check if already verified
        if user.get('is_verified', False):
            return jsonify({'message': 'Email already verified'}), 200
        
        # Check verification code
        stored_code = user.get('verification_code')
        expires_at = user.get('verification_code_expires')
        
        if not stored_code or stored_code != code:
            return jsonify({'error': 'Invalid verification code'}), 400
        
        if expires_at and datetime.utcnow() > expires_at:
            return jsonify({'error': 'Verification code expired. Request a new one'}), 400
        
        # Mark user as verified
        User.update(mongo.db, user['_id'], {
            'is_verified': True,
            'verification_code': None,
            'verification_code_expires': None
        })
        
        # Generate JWT token
        token = jwt.encode(
            {'user_id': str(user['_id']), 'exp': datetime.utcnow() + timedelta(days=30)},
            app.config['JWT_SECRET_KEY'],
            algorithm='HS256'
        )
        
        return jsonify({
            'message': 'Email verified successfully',
            'token': token,
            'user_id': str(user['_id']),
            'email': user['email'],
            'is_pro': user.get('is_pro', False),
            'is_admin': user.get('is_admin', False)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/resend-code', methods=['POST'])
def resend_verification_code():
    """Resend verification code to email."""
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        
        if not email:
            return jsonify({'error': 'Email required'}), 400
        
        # Find user
        user = User.find_by_email(mongo.db, email)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Check if already verified
        if user.get('is_verified', False):
            return jsonify({'message': 'Email already verified'}), 200
        
        # Generate new verification code
        verification_code = ''.join(random.choices(string.digits, k=6))
        verification_expires = datetime.utcnow() + timedelta(minutes=15)
        
        User.update(mongo.db, user['_id'], {
            'verification_code': verification_code,
            'verification_code_expires': verification_expires
        })
        
        # Send verification code to email
        send_verification_code(email, verification_code)
        
        return jsonify({
            'message': 'Verification code resent to your email'
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# OAuth token exchange (placeholder for Google OAuth)
@app.route('/api/auth/oauth', methods=['POST'])
def oauth_login():
    """Handle OAuth token exchange (Google, etc)."""
    try:
        data = request.json
        provider = data.get('provider')  # 'google', etc.
        id_token = data.get('id_token')
        email = data.get('email')
        provider_id = data.get('provider_id')
        
        if not provider or not email:
            return jsonify({'error': 'Provider and email required'}), 400
        
        # Check if user exists
        user = User.find_by_provider(mongo.db, provider, provider_id)
        if not user:
            # Create new user
            user_id = User.create(mongo.db, email, auth_provider=provider, provider_id=provider_id)
            user = User.find_by_id(mongo.db, user_id)

        user = apply_bootstrap_admin_if_needed(user)
        
        # Generate JWT token
        token = jwt.encode(
            {'user_id': str(user['_id']), 'exp': datetime.utcnow() + timedelta(days=30)},
            app.config['JWT_SECRET_KEY'],
            algorithm='HS256'
        )
        
        return jsonify({
            'token': token,
            'user_id': str(user['_id']),
            'email': user['email'],
            'is_pro': user.get('is_pro', False),
            'is_admin': user.get('is_admin', False)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Get user profile
@app.route('/api/user/profile', methods=['GET'])
@token_required
def get_profile():
    """Get user profile."""
    try:
        user = request.user
        is_unlimited = user.get('is_pro', False) or user.get('is_admin', False)
        stats = DeleteLog.get_stats(mongo.db, user['_id'], is_unlimited=is_unlimited)
        
        return jsonify({
            'user_id': str(user['_id']),
            'email': user['email'],
            'is_pro': user.get('is_pro', False),
            'is_admin': user.get('is_admin', False),
            'created_at': user['created_at'].isoformat() if 'created_at' in user else None,
            'delete_stats': stats
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Log a delete action
@app.route('/api/user/log-delete', methods=['POST'])
@token_required
def log_delete():
    """Log a delete action for the user."""
    try:
        data = request.json
        count = data.get('count', 1)
        user_id = request.user_id
        
        # Check if free user is at limit
        user = request.user
        has_unlimited_deletes = user.get('is_pro', False) or user.get('is_admin', False)
        if not has_unlimited_deletes:
            today_count = DeleteLog.get_today_delete_count(mongo.db, user_id)
            if today_count >= FREE_DAILY_DELETE_LIMIT:
                return jsonify({
                    'error': 'Daily delete limit reached',
                    'limit': FREE_DAILY_DELETE_LIMIT,
                    'used': today_count,
                    'remaining': 0
                }), 429
        
        # Log the delete
        DeleteLog.log_delete(mongo.db, user_id, count)
        
        # Get updated stats
        stats = DeleteLog.get_stats(mongo.db, user_id, is_unlimited=has_unlimited_deletes)
        
        return jsonify({
            'success': True,
            'delete_stats': stats
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/user', methods=['GET'])
@token_required
@admin_required
def get_user_for_admin():
    """Look up a user by email for admin management."""
    try:
        email = request.args.get('email', '').strip().lower()
        if not email:
            return jsonify({'error': 'Email is required'}), 400

        user = User.find_by_email(mongo.db, email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        return jsonify({
            'user': {
                'user_id': str(user['_id']),
                'email': user['email'],
                'is_pro': user.get('is_pro', False),
                'is_admin': user.get('is_admin', False),
                'created_at': user['created_at'].isoformat() if 'created_at' in user else None
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/set-admin', methods=['POST'])
@token_required
@admin_required
def set_admin_role():
    """Grant or revoke admin role for a specific account."""
    try:
        data = request.json or {}
        email = data.get('email', '').strip().lower()
        is_admin = bool(data.get('is_admin', False))

        if not email:
            return jsonify({'error': 'Email is required'}), 400

        user = User.find_by_email(mongo.db, email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if is_bootstrap_admin_email(email) and not is_admin:
            return jsonify({'error': 'This account is pinned as admin by ADMIN_EMAILS'}), 400

        User.update(mongo.db, user['_id'], {'is_admin': is_admin})
        updated_user = User.find_by_id(mongo.db, user['_id'])

        return jsonify({
            'success': True,
            'user': {
                'user_id': str(updated_user['_id']),
                'email': updated_user['email'],
                'is_pro': updated_user.get('is_pro', False),
                'is_admin': updated_user.get('is_admin', False)
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Create Stripe checkout session
@app.route('/api/create-checkout-session', methods=['POST'])
@token_required
def create_checkout_session():
    """Create a Stripe checkout session for subscription."""
    try:
        data = request.json
        price_type = data.get('priceType', 'monthly')
        user_id = str(request.user_id)
        user = request.user
        
        # Determine price
        if price_type == 'yearly':
            price = app.config['PRO_YEARLY_PRICE']
            description = 'Bulk Manager Pro - Yearly'
        else:
            price = app.config['PRO_MONTHLY_PRICE']
            description = 'Bulk Manager Pro - Monthly'
        
        # Create checkout session
        session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'product_data': {
                        'name': description,
                        'description': 'Unlimited actions & priority support',
                    },
                    'unit_amount': price,
                    'recurring': {
                        'interval': 'year' if price_type == 'yearly' else 'month',
                        'interval_count': 1,
                    }
                },
                'quantity': 1,
            }],
            mode='subscription',
            success_url='https://mail.google.com?success=true',
            cancel_url='https://mail.google.com?canceled=true',
            metadata={
                'user_id': user_id,
                'email': user['email'],
            }
        )
        
        return jsonify({'sessionId': session.id}), 200
    
    except stripe.error.StripeError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

# Webhook handler for Stripe events
@app.route('/api/webhook', methods=['POST'])
def webhook():
    """Handle Stripe webhook events."""
    payload = request.get_data()
    sig_header = request.headers.get('Stripe-Signature')
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, app.config['STRIPE_WEBHOOK_SECRET']
        )
    except ValueError:
        return jsonify({'error': 'Invalid payload'}), 400
    except stripe.error.SignatureVerificationError:
        return jsonify({'error': 'Invalid signature'}), 400
    
    # Handle events
    if event['type'] == 'customer.subscription.created':
        subscription = event['data']['object']
        user_id = subscription.metadata.get('user_id')
        if user_id:
            User.update(mongo.db, user_id, {
                'is_pro': True,
                'subscription_id': subscription.id,
                'stripe_customer_id': subscription.customer
            })
    
    elif event['type'] == 'customer.subscription.deleted':
        subscription = event['data']['object']
        user_id = subscription.metadata.get('user_id')
        if user_id:
            User.update(mongo.db, user_id, {
                'is_pro': False,
                'subscription_id': None
            })
    
    elif event['type'] == 'customer.subscription.updated':
        subscription = event['data']['object']
        user_id = subscription.metadata.get('user_id')
        if user_id:
            # Check if subscription is scheduled for cancellation
            if subscription.get('cancel_at'):
                User.update(mongo.db, user_id, {
                    'cancel_scheduled_at': datetime.utcfromtimestamp(subscription['cancel_at'])
                })
            else:
                # Cancellation was revoked
                User.update(mongo.db, user_id, {
                    'cancel_scheduled_at': None
                })
    
    return jsonify({'success': True}), 200

# Error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(debug=app.config['DEBUG'], host='127.0.0.1', port=5000)
