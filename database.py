import os
import json
from datetime import datetime, timedelta, date
from pymongo import MongoClient

# Get MongoDB URI from environment, default to local if not set
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")

# Global DB connection reference
client = None
db = None

def init_db():
    """Initialize MongoDB connection and collections."""
    global client, db
    try:
        client = MongoClient(MONGO_URI)
        db = client['skillsnap']
        
        # Test connection
        client.admin.command('ping')
        print("Connected to MongoDB successfully!")
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")

def get_collection(name):
    """Helper to get a collection."""
    if db is None:
        init_db()
    return db[name]

def fix_id(doc):
    """Helper to stringify ObjectId for JSON serialization"""
    if doc and '_id' in doc:
        doc['_id'] = str(doc['_id'])
    return doc

def create_user(name, email, password_hash):
    users = get_collection('users')
    result = users.insert_one({
        "name": name,
        "email": email,
        "password_hash": password_hash,
        "streak_days": 0,
        "last_activity_date": None,
        "concepts_learned": 0
    })
    return str(result.inserted_id)

def get_user_by_email(email):
    users = get_collection('users')
    return users.find_one({"email": email})

def get_user_by_id(user_id):
    from bson.objectid import ObjectId
    users = get_collection('users')
    try:
        return users.find_one({"_id": ObjectId(user_id)})
    except:
        return None

def init_demo_student():
    """Initialize a default learner (solo-mode)."""
    users = get_collection('users')
    learner = users.find_one({"role": "learner"})
    
    if not learner:
        # Create a fresh profile
        users.insert_one({
            "name": "Solo Learner",
            "role": "learner",
            "streak_days": 0,
            "last_activity_date": None,
            "concepts_learned": 0
        })

def update_streak(user_id):
    """Updates the user's login streak."""
    from bson.objectid import ObjectId
    users = get_collection('users')
    try:
        user = users.find_one({"_id": ObjectId(user_id)})
    except:
        user = None
    
    if not user:
        return
        
    today = date.today().isoformat()
    last_act = user.get('last_activity_date')
    streak = user.get('streak_days', 0)
    concepts = user.get('concepts_learned', 0)

    if last_act == today:
        # Already updated today
        new_streak = streak
    elif last_act == (date.today() - timedelta(days=1)).isoformat():
        # Active yesterday, increment
        new_streak = streak + 1
    else:
        # Gap -> reset
        new_streak = 1

    users.update_one(
        {"_id": user['_id']},
        {
            "$set": {
                "streak_days": new_streak,
                "last_activity_date": today,
            },
            "$inc": {"concepts_learned": 1}
        }
    )

def log_session(user_id, topic, duration, explanation):
    """Logs a learning session to MongoDB."""
    sessions = get_collection('sessions')
    session = {
        "user_id": str(user_id),
        "topic": topic,
        "duration": duration,
        "explanation": explanation,
        "timestamp": datetime.now()
    }
    sessions.insert_one(session)
    # Give them credit for the streak/concept
    update_streak(user_id)

def log_quiz_score(user_id, topic, score, max_score, accuracy):
    """Logs quiz score to MongoDB."""
    scores = get_collection('quiz_scores')
    scores.insert_one({
        "user_id": str(user_id),
        "topic": topic,
        "score": score,
        "max_score": max_score,
        "accuracy": accuracy,
        "timestamp": datetime.now()
    })

def get_dashboard_stats(user_id):
    """Retrieve stats for the specific user."""
    from bson.objectid import ObjectId
    users = get_collection('users')
    sessions = get_collection('sessions')
    scores = get_collection('quiz_scores')

    try:
        user = users.find_one({"_id": ObjectId(user_id)})
    except:
        user = None

    if not user:
        return {
            "total_time_mins": 0, "avg_accuracy": 0, "recent_topics": [],
            "weak_topics": [], "chart_data": [], "streak_days": 0, "concepts_learned": 0
        }

    str_uid = str(user_id)

    # Session stats
    total_time = sum(s.get('duration', 0) for s in sessions.find({"user_id": str_uid}))
    
    # Recent topics
    recent_sessions = list(sessions.find({"user_id": str_uid}).sort("timestamp", -1).limit(5))
    recent_topics = [s['topic'] for s in recent_sessions]

    # Quiz stats
    all_scores = list(scores.find({"user_id": str_uid}))
    avg_accuracy = 0
    weak_topics = []

    if all_scores:
        avg_accuracy = round(sum(s['accuracy'] for s in all_scores) / len(all_scores))
        
        # Calculate topic averages
        topic_acc = {}
        for s in all_scores:
            t = s['topic']
            if t not in topic_acc:
                topic_acc[t] = []
            topic_acc[t].append(s['accuracy'])
        
        # Weak topics -> average < 70%
        for t, accs in topic_acc.items():
            if (sum(accs) / len(accs)) < 70:
                weak_topics.append(t)

    # Chart data (last 7 quizzes - FIXED: filter by user_id and sort descending)
    chart_scores = list(scores.find({"user_id": str_uid}).sort("timestamp", -1).limit(7))
    chart_data = [{"topic": s["topic"], "accuracy": s["accuracy"]} for s in reversed(chart_scores)]  # Reverse for chronological order on chart

    return {
        "total_time_mins": total_time,
        "avg_accuracy": avg_accuracy,
        "recent_topics": list(set(recent_topics))[:3],
        "weak_topics": weak_topics[:3],
        "chart_data": chart_data,
        "streak_days": user.get('streak_days', 0),
        "concepts_learned": user.get('concepts_learned', 0)
    }
