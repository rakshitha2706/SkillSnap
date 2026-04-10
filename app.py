import os
import json
from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect, generate_csrf
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from groq import Groq
from dotenv import load_dotenv
import database
import io
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from werkzeug.security import generate_password_hash, check_password_hash

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "super-secret-skillsnap-key-123")
CORS(app, supports_credentials=True)

# Initialize CSRF Protection
csrf = CSRFProtect(app)

# Initialize Rate Limiter
limiter = Limiter(
    app=app,
    key_func=lambda: session.get('user_id', get_remote_address()),
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Initialize database
database.init_db()

# ==================== ENV VALIDATION ====================
def validate_environment():
    """Validate required environment variables on startup."""
    errors = []
    
    groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
    secret_key = os.getenv("SECRET_KEY", "").strip()
    mongo_uri = os.getenv("MONGO_URI", "").strip()
    
    if not groq_api_key:
        errors.append("❌ GROQ_API_KEY is not set in .env file")
    else:
        print("✓ GROQ_API_KEY is configured")
    
    if not secret_key or secret_key == "super-secret-skillsnap-key-123":
        errors.append("⚠️  SECRET_KEY should be changed from default in .env file")
    else:
        print("✓ SECRET_KEY is configured")
    
    if not mongo_uri or mongo_uri == "mongodb://localhost:27017/":
        print("⚠️  MONGO_URI not explicitly set, using default: mongodb://localhost:27017/")
    else:
        print(f"✓ MONGO_URI is configured as: {mongo_uri[:50]}...")
    
    if errors:
        print("\n" + "="*60)
        print("CONFIGURATION ERRORS:")
        for error in errors:
            print(f"  {error}")
        print("="*60)
        print("\nPlease create a .env file with the following variables:")
        print("  GROQ_API_KEY=your_groq_api_key_here")
        print("  SECRET_KEY=your_random_secret_key_here")
        print("  MONGO_URI=mongodb://localhost:27017/ (or your MongoDB URI)")
        print("="*60 + "\n")
        raise RuntimeError("Missing required environment variables. Check .env configuration.")
    
    print("✓ All critical environment variables validated successfully!\n")

# Validate environment on startup
try:
    validate_environment()
except RuntimeError as e:
    print(f"STARTUP ERROR: {e}")
    exit(1)

# Setup Groq Client
groq_api_key = os.getenv("GROQ_API_KEY", "")
if not groq_api_key:
    print("ERROR: GROQ_API_KEY not found. Please check your .env file.")
    client = None
else:
    try:
        client = Groq(api_key=groq_api_key)
        print("✓ Groq client initialized successfully")
    except Exception as e:
        print(f"ERROR: Failed to initialize Groq client: {e}")
        client = None

# Use a supported Groq model
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

def get_word_target(duration):
    """Maps duration to approximate word count (avg reading speed ~200 wpm)"""
    try:
        mins = int(duration)
        return mins * 160
    except:
        return 500


@app.route('/api/csrf-token', methods=['GET'])
def get_csrf_token():
    """Return CSRF token for AJAX requests"""
    token = generate_csrf()
    return jsonify({"csrf_token": token})

@app.route('/')
def landing():
    if 'user_id' in session:
        return redirect(url_for('app_home'))
    return render_template('landing.html')

@app.route('/app')
def app_home():
    if 'user_id' not in session:
        return redirect(url_for('landing'))
    user = database.get_user_by_id(session['user_id'])
    return render_template('index.html', user=user)

# ==================== AUTHENTICATION API ====================

@app.route('/api/register', methods=['POST'])
@limiter.limit("5 per minute")
def register():
    data = request.json
    name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not name or not email or not password:
        return jsonify({"error": "All fields are required"}), 400

    existing_user = database.get_user_by_email(email)
    if existing_user:
        return jsonify({"error": "Email already in use"}), 400

    hashed_pw = generate_password_hash(password)
    user_id = database.create_user(name, email, hashed_pw)
    session['user_id'] = user_id
    return jsonify({"message": "Registration successful", "user_id": user_id})

@app.route('/api/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    data = request.json
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    user = database.get_user_by_email(email)
    if not user or not check_password_hash(user.get('password_hash', ''), password):
        return jsonify({"error": "Invalid email or password"}), 401

    user_id = str(user['_id'])
    session['user_id'] = user_id
    return jsonify({"message": "Login successful", "user_id": user_id})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    return jsonify({"message": "Logged out"})

# ==================== CORE API ====================

@app.route('/api/generate-lesson', methods=['POST'])
@limiter.limit("10 per hour")
def generate_lesson():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
    
    if not client:
        return jsonify({"error": "Groq API key not configured. Add GROQ_API_KEY to .env file."}), 500

    data = request.json
    topic = data.get('topic', 'Machine Learning')
    duration = int(data.get('duration', 5))
    language = data.get('language', 'English')

    # Construct prompt dynamically based on time constraints
    if duration == 5:
        structure = """
        <h3>💡 Summary</h3>
        <p>A high-level overview of the concept (2-3 sentences).</p>
        <h3>🌍 The Quick Analogy</h3>
        <p>One extremely relatable analogy.</p>
        """
        word_target = 150
    elif duration == 15:
        structure = """
        <h3>🧠 Detailed Breakdown</h3>
        <p>Explain the core concepts, mechanisms, and background comprehensively.</p>
        <h3>🌍 Case Study</h3>
        <p>A detailed real-world example or historical case study.</p>
        <h3>🔑 Key Takeaways</h3>
        <ul><li>Point 1</li><li>Point 2</li></ul>
        """
        word_target = 500
    else: # 10 mins
        structure = """
        <h3>💡 The Core Idea</h3>
        <p>A solid explanation of the core concept.</p>
        <h3>🌍 Real-Life Example</h3>
        <p>One vivid, relatable real-world analogy.</p>
        <h3>🔑 Key Takeaways</h3>
        <ul><li>Point 1</li><li>Point 2</li></ul>
        """
        word_target = 300

    prompt = f"""
You are a world-class teacher. Explain the topic '{topic}' to a curious solo-learner in {language}.
Aim for approximately {word_target} words total. Structure your response using clean HTML (no markdown code blocks).

Use this exact structure:
{structure}

Do NOT wrap in markdown. Do NOT use code blocks. Output only HTML as described above.
    """

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a world-class teacher who excels at explaining complex topics in a simple, engaging, and structured way."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        lesson_content = response.choices[0].message.content.strip()

        # Strip accidental markdown code fences
        if lesson_content.startswith("```"):
            parts = lesson_content.split("```")
            lesson_content = parts[1] if len(parts) > 1 else lesson_content
            if lesson_content.startswith("html"):
                lesson_content = lesson_content[4:]
            lesson_content = lesson_content.strip()

        # Log session to db and update streak
        database.log_session(user_id=session['user_id'], topic=topic, duration=duration, explanation=lesson_content)

        return jsonify({"lesson": lesson_content, "topic": topic})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/generate-quiz', methods=['POST'])
@limiter.limit("10 per hour")
def generate_quiz():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    text = data.get('text', '')
    topic = data.get('topic', '')

    if not text:
        return jsonify({"error": "No text provided for quiz generation."}), 400

    prompt = f"""
You are a quiz generator. Based exclusively on the following lesson content about '{topic}', generate exactly 3 multiple-choice questions to test the reader's understanding.

STRICT RULES:
- Questions must be based ONLY on the provided text
- Each question must have exactly 4 options
- Only one option is correct
- Return ONLY valid JSON, no markdown, no explanation

Schema:
{{
    "questions": [
        {{
            "question": "The question text",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correct_answer": "The exact wording of the correct option"
        }}
    ]
}}

Lesson Text:
{text[:3000]}
    """

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a quiz generator. Output ONLY valid JSON. No markdown. No explanation."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
        )
        raw = response.choices[0].message.content.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        quiz_json = json.loads(raw)
        return jsonify(quiz_json)
    except json.JSONDecodeError:
        return jsonify({"error": "Model returned invalid JSON. Please try again."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/evaluate', methods=['POST'])
@limiter.limit("20 per hour")
def evaluate():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    data = request.json
    results = data.get('results', [])
    topic = data.get('topic', 'Unknown')

    if not results:
        return jsonify({"error": "No results provided"}), 400

    score = sum(1 for r in results if r.get('is_correct'))
    max_score = len(results)

    accuracy = (score / max_score) * 100 if max_score > 0 else 0

    database.log_quiz_score(user_id=session['user_id'], topic=topic, score=score, max_score=max_score, accuracy=accuracy)

    requires_simplification = False

    if accuracy == 100:
        feedback = "🎉 Perfect score! You've mastered this concept!"
    elif accuracy >= 66:
        feedback = "✅ Great job! You have a solid grasp of the topic."
    elif accuracy >= 33:
        feedback = "📚 Good effort! A little more review will help."
        requires_simplification = True
    else:
        feedback = "🔄 Let's revisit this topic with a simpler explanation."
        requires_simplification = True

    return jsonify({
        "score": score,
        "max_score": max_score,
        "accuracy": round(accuracy),
        "feedback": feedback,
        "requires_simplification": requires_simplification
    })


@app.route('/api/clarify-doubt', methods=['POST'])
@limiter.limit("20 per hour")
def clarify_doubt():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    doubt = data.get('doubt', '')
    topic = data.get('topic', '')
    language = data.get('language', 'English')

    prompt = f"""
The student is confused about '{doubt}' within the context of '{topic}'.
Re-explain this concept in {language} language as if talking to a 12-year-old, using a simple everyday analogy.
Keep it to 2-3 short paragraphs. Be warm, encouraging, and clear.
    """

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a patient tutor who simplifies complex concepts for struggling students."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
        )
        return jsonify({"explanation": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/simplify', methods=['POST'])
@limiter.limit("10 per hour")
def simplify():
    """Generate a simpler re-explanation when the student scores poorly."""
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    topic = data.get('topic', '')
    language = data.get('language', 'English')

    prompt = f"""
The student struggled with understanding '{topic}'. 
Create an ultra-simple re-explanation in {language} language using:
- A very simple analogy from everyday life
- Short, punchy sentences (max 15 words each)
- 3-4 sentences maximum
Be encouraging and supportive in tone.
    """

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a patient, encouraging tutor for struggling students."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
        )
        return jsonify({"explanation": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/dashboard', methods=['GET'])
def dashboard():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    stats = database.get_dashboard_stats(user_id=session['user_id'])
    return jsonify(stats)


@app.route('/api/download-pdf', methods=['POST'])
@limiter.limit("50 per day")
def download_pdf():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    data = request.json
    topic = data.get('topic', 'Lesson')
    html_content = data.get('lessonText', '')

    # Convert basic HTML-like strings to purely text if needed, or use reportlab to render it.
    # We will simply parse the text out for ReportLab paragraph generation
    stripped_text = html_content.replace('<h3>', '\\n\\n').replace('</h3>', '\\n').replace('<p>', '').replace('</p>', '\\n').replace('<ul>', '\\n').replace('<li>', '- ').replace('</li>', '\\n').replace('</ul>', '\\n')
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    Story = []

    # Title
    Story.append(Paragraph(f"<b>Snap-Note: {topic}</b>", styles['Title']))
    Story.append(Spacer(1, 12))

    # Split roughly by newlines
    for paragraph in stripped_text.split('\\n'):
        if paragraph.strip():
            Story.append(Paragraph(paragraph.strip(), styles['Normal']))
            Story.append(Spacer(1, 6))

    doc.build(Story)
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"SnapNote_{topic.replace(' ', '_')}.pdf",
        mimetype='application/pdf'
    )


if __name__ == '__main__':
    app.run(debug=True, port=5000)