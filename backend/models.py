from datetime import datetime, timedelta
from bson.objectid import ObjectId

class User:
    """User model for MongoDB."""
    
    @staticmethod
    def create(db, email, password_hash=None, auth_provider='email', provider_id=None):
        """Create a new user."""
        user = {
            '_id': ObjectId(),
            'email': email,
            'password_hash': password_hash,
            'auth_provider': auth_provider,  # 'email', 'google', etc.
            'provider_id': provider_id,  # ID from OAuth provider
            'is_pro': False,
            'is_admin': False,
            'is_verified': False,  # Email verification status
            'verification_code': None,  # 6-digit code for email verification
            'verification_code_expires': None,  # Expiration time for verification code
            'stripe_customer_id': None,
            'subscription_id': None,
            'cancel_scheduled_at': None,  # When subscription cancellation is scheduled
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }
        result = db.users.insert_one(user)
        return result.inserted_id
    
    @staticmethod
    def find_by_email(db, email):
        """Find user by email."""
        return db.users.find_one({'email': email})
    
    @staticmethod
    def find_by_id(db, user_id):
        """Find user by ID."""
        if isinstance(user_id, str):
            user_id = ObjectId(user_id)
        return db.users.find_one({'_id': user_id})
    
    @staticmethod
    def find_by_provider(db, auth_provider, provider_id):
        """Find user by OAuth provider and ID."""
        return db.users.find_one({
            'auth_provider': auth_provider,
            'provider_id': provider_id
        })
    
    @staticmethod
    def update(db, user_id, data):
        """Update user."""
        if isinstance(user_id, str):
            user_id = ObjectId(user_id)
        data['updated_at'] = datetime.utcnow()
        db.users.update_one({'_id': user_id}, {'$set': data})

class DeleteLog:
    """Delete activity log model."""
    
    @staticmethod
    def log_delete(db, user_id, deleted_count=1):
        """Log a delete action."""
        log_entry = {
            '_id': ObjectId(),
            'user_id': ObjectId(user_id) if isinstance(user_id, str) else user_id,
            'deleted_count': deleted_count,
            'date': datetime.utcnow(),
        }
        db.delete_logs.insert_one(log_entry)
    
    @staticmethod
    def get_today_delete_count(db, user_id):
        """Get delete count for today (last 24 hours)."""
        if isinstance(user_id, str):
            user_id = ObjectId(user_id)
        
        today = datetime.utcnow() - timedelta(hours=24)
        result = db.delete_logs.aggregate([
            {
                '$match': {
                    'user_id': user_id,
                    'date': {'$gte': today}
                }
            },
            {
                '$group': {
                    '_id': '$user_id',
                    'total': {'$sum': '$deleted_count'}
                }
            }
        ])
        
        result_list = list(result)
        return result_list[0]['total'] if result_list else 0
    
    @staticmethod
    def get_stats(db, user_id, is_unlimited=False):
        """Get user delete stats."""
        if isinstance(user_id, str):
            user_id = ObjectId(user_id)
        
        # Last 24 hours
        today_count = DeleteLog.get_today_delete_count(db, user_id)
        
        # All time
        all_time = db.delete_logs.aggregate([
            {
                '$match': {'user_id': user_id}
            },
            {
                '$group': {
                    '_id': '$user_id',
                    'total': {'$sum': '$deleted_count'}
                }
            }
        ])
        
        all_time_list = list(all_time)
        all_time_count = all_time_list[0]['total'] if all_time_list else 0
        
        if is_unlimited:
            return {
                'today': today_count,
                'all_time': all_time_count,
                'limit': None,
                'remaining': None
            }

        return {
            'today': today_count,
            'all_time': all_time_count,
            'limit': 10,
            'remaining': max(0, 10 - today_count)
        }
