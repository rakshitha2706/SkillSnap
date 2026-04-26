import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import json
import html
from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for, Response
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


def wrap_svg_text(text, max_chars=26, max_lines=3):
    words = (text or "").replace("\n", " ").split()
    if not words:
        return []

    lines = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            lines.append(current)
            current = word
            if len(lines) >= max_lines - 1:
                break

    if len(lines) < max_lines and current:
        lines.append(current)

    remaining_words = words[len(" ".join(lines).split()):]
    if remaining_words and lines:
        trimmed = lines[-1][:max(0, max_chars - 1)].rstrip()
        lines[-1] = f"{trimmed}..."

    return [html.escape(line) for line in lines[:max_lines]]


def normalize_diagram_spec(concept, summary, main_visual):
    diagram = (main_visual or {}).get("diagram", {}) if isinstance(main_visual, dict) else {}
    raw_panels = diagram.get("panels", []) if isinstance(diagram.get("panels", []), list) else []
    panels = []

    for panel in raw_panels[:4]:
        if not isinstance(panel, dict):
            continue
        heading = str(panel.get("heading", "")).strip()
        detail = str(panel.get("detail", "")).strip()
        if heading or detail:
            panels.append({
                "heading": heading[:60] or "Key Idea",
                "detail": detail[:180] or heading[:120]
            })

    if not panels:
        fallback_points = []
        if isinstance(main_visual, dict):
            deep_text = str(main_visual.get("deep_explanation", "")).strip()
            fallback_points = [segment.strip() for segment in deep_text.split(".") if segment.strip()]
        if not fallback_points:
            fallback_points = [summary or concept]

        for idx, point in enumerate(fallback_points[:4], start=1):
            panels.append({
                "heading": f"Point {idx}",
                "detail": point[:180]
            })

    raw_connections = diagram.get("connections", []) if isinstance(diagram.get("connections", []), list) else []
    connections = []
    for connection in raw_connections[:4]:
        if not isinstance(connection, dict):
            continue
        from_idx = connection.get("from")
        to_idx = connection.get("to")
        if isinstance(from_idx, int) and isinstance(to_idx, int) and 0 <= from_idx < len(panels) and 0 <= to_idx < len(panels) and from_idx != to_idx:
            connections.append({
                "from": from_idx,
                "to": to_idx,
                "label": str(connection.get("label", "")).strip()[:24]
            })

    if not connections and len(panels) > 1:
        for idx in range(len(panels) - 1):
            connections.append({"from": idx, "to": idx + 1, "label": ""})

    return {
        "title": str((main_visual or {}).get("title", concept)).strip()[:80] or concept,
        "visual_summary": str(diagram.get("visual_summary", summary)).strip()[:180] or summary or concept,
        "panels": panels,
        "connections": connections
    }


def build_diagram_svg(concept, summary, main_visual):
    diagram = normalize_diagram_spec(concept, summary, main_visual)
    width = 1200
    height = 760
    panel_positions = [
        {"x": 90, "y": 210},
        {"x": 630, "y": 210},
        {"x": 90, "y": 470},
        {"x": 630, "y": 470}
    ]
    panel_width = 480
    panel_height = 170
    colors = [
        ("#0f172a", "#22d3ee"),
        ("#111827", "#60a5fa"),
        ("#0b1120", "#34d399"),
        ("#131a2b", "#f59e0b")
    ]

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%" role="img" aria-label="{html.escape(diagram["title"])}">',
        "<defs>",
        '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
        '<stop offset="0%" stop-color="#07111f" />',
        '<stop offset="100%" stop-color="#111827" />',
        "</linearGradient>",
        '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">',
        '<path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />',
        "</marker>",
        "</defs>",
        f'<rect width="{width}" height="{height}" rx="28" fill="url(#bg)" />',
        '<rect x="40" y="34" width="1120" height="96" rx="22" fill="#0f172a" stroke="#334155" stroke-width="2" />',
        f'<text x="600" y="76" text-anchor="middle" fill="#f8fafc" font-size="34" font-weight="700" font-family="Arial, sans-serif">{html.escape(diagram["title"])}</text>'
    ]

    summary_lines = wrap_svg_text(diagram["visual_summary"], max_chars=70, max_lines=2)
    for idx, line in enumerate(summary_lines):
        y = 104 + (idx * 24)
        svg_parts.append(
            f'<text x="600" y="{y}" text-anchor="middle" fill="#cbd5e1" font-size="20" font-family="Arial, sans-serif">{line}</text>'
        )

    centers = []
    for idx, panel in enumerate(diagram["panels"][:4]):
        pos = panel_positions[idx]
        fill, stroke = colors[idx % len(colors)]
        centers.append((pos["x"] + panel_width / 2, pos["y"] + panel_height / 2))
        svg_parts.extend([
            f'<rect x="{pos["x"]}" y="{pos["y"]}" width="{panel_width}" height="{panel_height}" rx="24" fill="{fill}" stroke="{stroke}" stroke-width="2" />',
            f'<rect x="{pos["x"] + 18}" y="{pos["y"] + 18}" width="86" height="28" rx="14" fill="{stroke}" opacity="0.18" />',
            f'<text x="{pos["x"] + 32}" y="{pos["y"] + 38}" fill="{stroke}" font-size="16" font-weight="700" font-family="Arial, sans-serif">STEP {idx + 1}</text>'
        ])

        heading_lines = wrap_svg_text(panel["heading"], max_chars=24, max_lines=2)
        for line_idx, line in enumerate(heading_lines):
            y = pos["y"] + 78 + (line_idx * 24)
            svg_parts.append(
                f'<text x="{pos["x"] + 28}" y="{y}" fill="#f8fafc" font-size="24" font-weight="700" font-family="Arial, sans-serif">{line}</text>'
            )

        detail_lines = wrap_svg_text(panel["detail"], max_chars=42, max_lines=3)
        for line_idx, line in enumerate(detail_lines):
            y = pos["y"] + 118 + (line_idx * 22)
            svg_parts.append(
                f'<text x="{pos["x"] + 28}" y="{y}" fill="#cbd5e1" font-size="18" font-family="Arial, sans-serif">{line}</text>'
            )

    for connection in diagram["connections"]:
        from_idx = connection["from"]
        to_idx = connection["to"]
        if from_idx >= len(centers) or to_idx >= len(centers):
            continue
        x1, y1 = centers[from_idx]
        x2, y2 = centers[to_idx]
        svg_parts.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#94a3b8" stroke-width="4" stroke-linecap="round" marker-end="url(#arrow)" opacity="0.8" />'
        )
        if connection["label"]:
            label_x = (x1 + x2) / 2
            label_y = (y1 + y2) / 2 - 10
            label = html.escape(connection["label"])
            svg_parts.extend([
                f'<rect x="{label_x - 54}" y="{label_y - 18}" width="108" height="30" rx="15" fill="#0f172a" stroke="#475569" stroke-width="1.5" />',
                f'<text x="{label_x}" y="{label_y + 2}" text-anchor="middle" fill="#e2e8f0" font-size="15" font-family="Arial, sans-serif">{label}</text>'
            ])

    svg_parts.extend([
        '<rect x="40" y="680" width="1120" height="42" rx="18" fill="#0f172a" stroke="#334155" stroke-width="1.5" />',
        f'<text x="600" y="707" text-anchor="middle" fill="#93c5fd" font-size="18" font-family="Arial, sans-serif">{html.escape(concept[:100])}</text>',
        "</svg>"
    ])
    return "".join(svg_parts)


MEMORY_STYLE_CONFIG = {
    "story": {
        "label": "Story Hook",
        "emoji": "🎭",
        "instruction": "Create a vivid, short story-based mnemonic with a memorable hook and easy recall."
    },
    "acronym": {
        "label": "Acronyms",
        "emoji": "🔤",
        "instruction": "Create a compact acronym or acrostic mnemonic that helps remember the core ideas in order."
    },
    "rhyme": {
        "label": "Rhymes",
        "emoji": "🎵",
        "instruction": "Create a short rhyme or rhythmic phrase that makes the concept easy to recall."
    },
    "funny": {
        "label": "Funny Associations",
        "emoji": "😂",
        "instruction": "Create a funny, unusual association that makes the concept memorable without losing accuracy."
    }
}


def normalize_memory_style(style):
    style = (style or "story").strip().lower()
    aliases = {
        "story hook": "story",
        "story": "story",
        "acronyms": "acronym",
        "acronym": "acronym",
        "rhymes": "rhyme",
        "rhyme": "rhyme",
        "funny associations": "funny",
        "funny": "funny"
    }
    return aliases.get(style, "story")


def build_memory_boost(topic, lesson_text, language, preferred_style="story"):
    style_key = normalize_memory_style(preferred_style)
    style_info = MEMORY_STYLE_CONFIG[style_key]

    prompt = f"""
You are an expert memory coach for students.

Topic: {topic}
Language: {language}
Requested style: {style_info["label"]}

Lesson content:
{lesson_text[:3500]}

Return ONLY valid JSON in this exact schema:
{{
  "suggested_style": "One of: Story Hook, Acronyms, Rhymes, Funny Associations",
  "selected_style": "{style_info["label"]}",
  "mnemonic_title": "Short title in {language}",
  "mnemonic_text": "The actual mnemonic in {language}",
  "why_it_works": "One short sentence explaining why this helps memory in {language}"
}}

Rules:
- {style_info["instruction"]}
- Keep the mnemonic concise, memorable, and directly tied to the lesson.
- Do not change the academic meaning of the concept.
- The mnemonic should be understandable to a student.
- The suggested_style should be the single best style for this topic overall, even if the selected style is different.
- Return valid JSON only.
    """

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": "You create strong educational mnemonics and always return valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5,
        response_format={"type": "json_object"}
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    memory_json = json.loads(raw)
    memory_json["selected_style_key"] = style_key
    return memory_json


def build_flashcards(topic, lesson_text, language):
    prompt = f"""
You are a flashcard generator for focused revision.

Topic: {topic}
Language: {language}

Lesson content:
{lesson_text[:3500]}

Return ONLY valid JSON in this exact schema:
{{
  "deck_title": "Short deck title in {language}",
  "cards": [
    {{
      "front": "A short question, cue, or concept title in {language}",
      "back": "A concise but useful answer in {language}"
    }}
  ]
}}

Rules:
- Generate exactly 4 flashcards.
- Keep the front short and memorable.
- Keep the back crisp, accurate, and easy to revise quickly.
- Cover different important parts of the lesson, not the same idea four times.
- Return valid JSON only.
    """

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": "You generate high-quality educational flashcards and always return valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.4,
        response_format={"type": "json_object"}
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)


def build_adaptive_revision(topic, lesson_text, language, results):
    incorrect_points = []
    for item in results:
        if not item.get("is_correct"):
            incorrect_points.append(
                f"Question: {item.get('question', '')}\nSelected: {item.get('selected', '')}\nCorrect: {item.get('correct', '')}"
            )

    incorrect_block = "\n\n".join(incorrect_points) if incorrect_points else "No incorrect answers were provided."

    prompt = f"""
You are an adaptive revision coach.

Topic: {topic}
Language: {language}

Original lesson content:
{lesson_text[:3000]}

Incorrect quiz areas:
{incorrect_block[:1800]}

Return ONLY valid JSON in this exact schema:
{{
  "revision_title": "A short follow-up lesson title in {language}",
  "focus_areas": ["focus area 1 in {language}", "focus area 2 in {language}", "focus area 3 in {language}"],
  "revision_html": "<h3>...</h3><p>...</p><ul><li>...</li></ul>",
  "practice_tip": "One short practice tip in {language}"
}}

Rules:
- This is a mini revision lesson, not a full lesson.
- Focus only on the ideas the learner likely misunderstood.
- Keep it encouraging, clearer, and more concrete than the original explanation.
- The HTML must be clean and simple.
- Return valid JSON only.
    """

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": "You create targeted adaptive revision lessons and always return valid JSON."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.45,
        response_format={"type": "json_object"}
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)


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


@app.route('/api/generate-visual', methods=['POST'])
@limiter.limit("10 per hour")
def generate_visual():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    concept = data.get('concept', '')
    language = data.get('language', 'English')
    duration = int(data.get('duration', 5))

    if not concept:
        return jsonify({"error": "No concept provided for visual generation."}), 400

    # Adjust content depth based on duration
    depth_directive = ""
    if duration <= 5:
        depth_directive = "Create a CONCISE overview. Provide 3 high-impact key points and a 2-paragraph analysis."
    elif duration <= 10:
        depth_directive = "Create a STANDARD depth lesson. Provide 6 technical key points and a 4-paragraph detailed analysis."
    else:
        depth_directive = "Create a MASTERCLASS depth lesson. Provide 10 expert-level key points, including advanced edge cases, and a 6-paragraph deep-dive technical analysis."

    prompt = f"""
You are a Senior Educational Content Designer. Your goal is to create a high-depth, expert-level micro-lesson on '{concept}'. 

DURATION: This is a {duration}-minute lesson. 
GUIDELINE: {depth_directive}

LANGUAGE REQUIREMENT: The lesson content (summary, key_points, title, deep_explanation) MUST BE WRITTEN IN {language}.
{"SPECIAL TELUGU DIRECTIVE: Since the user requested Telugu, use natural, conversational, and colloquial Telugu (slang) that sounds like a friendly local mentor explaining it in person. Avoid overly formal or archaic textbook Telugu." if language == 'Telugu' else ""}

OUTPUT STRICTLY AS JSON using the format below. NO markdown formatting, NO extra text.
{{
  "concept": "{concept}",
  "summary": "A high-level overview explaining the 'what' and 'why' in {language}.",
  "key_points": [
    "Technical detail 1 in {language}",
    "..."
  ],
  "main_visual": {{
      "title": "Specific Lesson Diagram Title in {language}",
      "visual": "A precise, technical description of a diagram in ENGLISH (for backup image generation only).",
      "diagram": {{
          "visual_summary": "One-sentence explanation of what the learner should understand from the diagram in {language}.",
          "panels": [
              {{
                  "heading": "Short panel heading in {language}",
                  "detail": "1-2 sentence panel explanation in {language}"
              }}
          ],
          "connections": [
              {{
                  "from": 0,
                  "to": 1,
                  "label": "short connector label in {language}"
              }}
          ]
      }},
      "deep_explanation": "The technical deep-dive explanation in {language} matching the requested {duration}-minute depth."
  }},
  "memory_boost": {{
      "suggested_style": "One of: Story Hook, Acronyms, Rhymes, Funny Associations",
      "mnemonic_title": "Short title in {language}",
      "mnemonic_text": "A story-style mnemonic in {language}",
      "why_it_works": "One short sentence in {language}"
  }},
  "suggested_audio": "educational voiceover text in {language}"
}}

Guidelines:
- The 'main_visual.visual' description MUST be highly specific to the technical content of this lesson.
- The 'diagram.panels' array must contain exactly 3 or 4 panels that explain the concept clearly and sequentially.
- Each panel must be concise, concrete, and educationally useful. Avoid vague headings like "More Info".
- If the lesson is about a sub-process (e.g., Calvin Cycle), the visual MUST describe that sub-process, not the general topic (e.g., Photosynthesis).
- Keep connector labels very short.
- The memory_boost should default to a story-style mnemonic because that is the default app behavior.
- Also choose the single best suggested style for this topic overall.
- Only return valid JSON.
    """

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a visual learning generator. Ensure output is strictly valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.4,
            response_format={"type": "json_object"}
        )
        raw = response.choices[0].message.content.strip()

        # Handle potential markdown code fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        visual_json = json.loads(raw)
        if isinstance(visual_json.get("main_visual"), dict):
            visual_json["main_visual"]["svg"] = build_diagram_svg(
                visual_json.get("concept", concept),
                visual_json.get("summary", ""),
                visual_json.get("main_visual")
            )
        if isinstance(visual_json.get("memory_boost"), dict):
            visual_json["memory_boost"]["selected_style"] = "Story Hook"
            visual_json["memory_boost"]["selected_style_key"] = "story"
        database.log_session(
            user_id=session['user_id'],
            topic=concept,
            duration=duration,
            explanation=json.dumps(visual_json, ensure_ascii=False),
            session_type='lesson'
        )
        return jsonify(visual_json)
    except json.JSONDecodeError:
        return jsonify({"error": "Model returned invalid JSON. Please try again."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/generate-mnemonic', methods=['POST'])
@limiter.limit("20 per hour")
def generate_mnemonic():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    topic = data.get('topic', '').strip()
    lesson_text = data.get('lesson_text', '').strip()
    language = data.get('language', 'English')
    style = data.get('style', 'story')

    if not topic or not lesson_text:
        return jsonify({"error": "Topic and lesson text are required for mnemonic generation."}), 400

    try:
        memory_json = build_memory_boost(topic, lesson_text, language, preferred_style=style)
        return jsonify(memory_json)
    except json.JSONDecodeError:
        return jsonify({"error": "Model returned invalid mnemonic JSON. Please try again."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/generate-flashcards', methods=['POST'])
@limiter.limit("20 per hour")
def generate_flashcards():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    topic = data.get('topic', '').strip()
    lesson_text = data.get('lesson_text', '').strip()
    language = data.get('language', 'English')

    if not topic or not lesson_text:
        return jsonify({"error": "Topic and lesson text are required for flashcards."}), 400

    try:
        flashcards_json = build_flashcards(topic, lesson_text, language)
        return jsonify(flashcards_json)
    except json.JSONDecodeError:
        return jsonify({"error": "Model returned invalid flashcards JSON. Please try again."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/adaptive-revision', methods=['POST'])
@limiter.limit("10 per hour")
def adaptive_revision():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    topic = data.get('topic', '').strip()
    lesson_text = data.get('lesson_text', '').strip()
    language = data.get('language', 'English')
    results = data.get('results', [])

    if not topic or not lesson_text or not results:
        return jsonify({"error": "Topic, lesson text, and quiz results are required for adaptive revision."}), 400

    try:
        revision_json = build_adaptive_revision(topic, lesson_text, language, results)
        database.log_session(
            user_id=session['user_id'],
            topic=f"{topic} Revision Sprint",
            duration=5,
            explanation=json.dumps(revision_json, ensure_ascii=False),
            session_type='revision',
            parent_topic=topic
        )
        return jsonify(revision_json)
    except json.JSONDecodeError:
        return jsonify({"error": "Model returned invalid revision JSON. Please try again."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/image', methods=['GET'])
def proxy_image():
    # 'prompt' here is the visual description generated by the AI
    description = request.args.get('prompt', 'educational illustration')
    topic = request.args.get('topic', '')
    import urllib.request
    import urllib.parse
    import json
    
    headers = {'User-Agent': 'Mozilla/5.0'}

    def fetch_binary(url, timeout=10):
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            content_type = response.headers.get('Content-Type', 'image/jpeg')
            return response.read(), content_type

    def svg_placeholder(title, subtitle):
        safe_title = (title or "Educational Diagram").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        safe_subtitle = (subtitle or "Image unavailable").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
<defs>
<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="#0f172a"/>
<stop offset="100%" stop-color="#1e293b"/>
</linearGradient>
</defs>
<rect width="1024" height="768" fill="url(#bg)"/>
<rect x="60" y="60" width="904" height="648" rx="24" fill="#111827" stroke="#334155" stroke-width="2"/>
<circle cx="160" cy="150" r="38" fill="#06b6d4" opacity="0.8"/>
<circle cx="864" cy="150" r="20" fill="#7c3aed" opacity="0.8"/>
<text x="512" y="320" text-anchor="middle" fill="#f8fafc" font-size="42" font-family="Arial, sans-serif" font-weight="700">{safe_title}</text>
<text x="512" y="380" text-anchor="middle" fill="#94a3b8" font-size="26" font-family="Arial, sans-serif">{safe_subtitle}</text>
<text x="512" y="450" text-anchor="middle" fill="#64748b" font-size="22" font-family="Arial, sans-serif">Image source unavailable</text>
</svg>"""
        return Response(svg, mimetype='image/svg+xml')

    # Step 1: Use Pollinations AI to generate an image that MATCHES the description
    # This ensures the text under the image and the image itself are in sync.
    try:
        # Requesting a high-resolution technical diagram specific to the lesson
        # We focus on the English description to avoid issues with non-ASCII topics
        clean_description = description.split('.')[0][:220]
        ai_prompt = f"Educational scientific diagram: {clean_description}. Sharp focus, labeled parts, technical illustration, professional white background, high resolution"
        
        # Increased resolution and specific seed
        ai_url = f"https://image.pollinations.ai/prompt/{urllib.parse.quote(ai_prompt)}?width=1024&height=768&nologo=true&seed=888"
        
        print(f"Generating Image: {ai_url}") # Server-side log for debugging

        image_bytes, content_type = fetch_binary(ai_url, timeout=20)
        return Response(image_bytes, mimetype=content_type)
    except Exception as e:
        print(f"AI Generation failed: {e}")

    # Step 2: Fallback to Wikipedia for the main topic if AI fails
    if topic:
        try:
            candidates = [topic]
            search_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(topic)}&format=json&srlimit=3"
            req = urllib.request.Request(search_url, headers=headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                search_data = json.loads(resp.read().decode())
                search_results = search_data.get('query', {}).get('search', [])
                candidates.extend(result.get('title', '') for result in search_results if result.get('title'))

            for candidate in candidates:
                wiki_url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(candidate)}&prop=pageimages&format=json&pithumbsize=1000&redirects=1"
                req = urllib.request.Request(wiki_url, headers=headers)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                    pages = data.get('query', {}).get('pages', {})
                    for page_id in pages:
                        if 'thumbnail' in pages[page_id]:
                            img_url = pages[page_id]['thumbnail']['source']
                            image_bytes, content_type = fetch_binary(img_url, timeout=10)
                            return Response(image_bytes, mimetype=content_type)
        except Exception as e:
            print(f"Wikipedia fallback failed: {e}")

    return svg_placeholder(topic or "Educational Diagram", "No matching image could be loaded")


@app.route('/api/dashboard', methods=['GET'])
def dashboard():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    stats = database.get_dashboard_stats(user_id=session['user_id'])
    stats["recent_lessons"] = database.get_recent_lessons(user_id=session['user_id'])
    return jsonify(stats)


@app.route('/api/download-pdf', methods=['POST'])
@limiter.limit("50 per day")
def download_pdf():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    data = request.json
    topic = data.get('topic', 'Lesson')
    html_content = data.get('lessonText', '')

    stripped_text = html_content
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    Story = []

    # Title
    Story.append(Paragraph(f"<b>Snap-Note: {topic}</b>", styles['Title']))
    Story.append(Spacer(1, 12))

    # Split roughly by newlines
    for paragraph in stripped_text.split('\n'):
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
