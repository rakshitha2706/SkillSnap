import os
import json
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
import database

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Initialize database
database.init_db()

# Setup Groq Client
groq_api_key = os.getenv("GROQ_API_KEY", "")
client = Groq(api_key=groq_api_key) if groq_api_key else None

# Use a supported Groq model and allow overriding via .env
GROQ_MODEL = os.getenv("GROQ_MODEL", "groq-llama2-8b")

def get_word_target(duration):
    """Maps duration to approximate word count (avg reading speed ~200 wpm)"""
    try:
        mins = int(duration)
        return mins * 150  # slightly lower to account for concept density
    except:
        return 500

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/generate-lesson', methods=['POST'])
def generate_lesson():
    if not client:
        return jsonify({"error": "Groq API key not configured. Add GROQ_API_KEY to .env file."}), 500

    data = request.json
    topic = data.get('topic', 'Machine Learning')
    duration = data.get('duration', 5)
    language = data.get('language', 'English')

    word_target = get_word_target(duration)

    prompt = f"""
    Explain the topic '{topic}' in approximately {word_target} words for a {language} audience.
    Structure the response with:
    1. A brief introduction.
    2. One deep, easily understandable analogy.
    3. Core concepts explained simply without overly complex jargon.
    4. A quick summary or conclusion.
    Format your response in clean HTML, using <h3> for sections, and <p> for paragraphs. Do not wrap in markdown code blocks like ```html.
    """

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a world-class teacher who excels at explaining complex topics simply and concisely."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        lesson_content = response.choices[0].message.content.strip()

        # Log session to db
        database.log_session(user_id=1, topic=topic, time_spent=int(duration))

        return jsonify({"lesson": lesson_content, "topic": topic})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/generate-quiz', methods=['POST'])
def generate_quiz():
    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    text = data.get('text', '')

    if not text:
        return jsonify({"error": "No text provided for quiz generation."}), 400

    prompt = f"""
    Based on the following text, generate 3 multiple-choice questions to test the reader's understanding.
    You MUST return strictly valid JSON and nothing else — no explanation, no markdown.
    Use this exact schema:
    {{
        "questions": [
            {{
                "question": "The question text",
                "options": ["Option A", "Option B", "Option C", "Option D"],
                "correct_answer": "The exact wording of the correct option"
            }}
        ]
    }}

    Text: {text[:2000]}
    """

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a quiz generator. You only output valid JSON based on the provided schema. No markdown, no explanation."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
        )
        raw = response.choices[0].message.content.strip()

        # Strip markdown code fences if model wraps response in them
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        quiz_json = json.loads(raw)
        return jsonify(quiz_json)
    except json.JSONDecodeError:
        return jsonify({"error": "Model returned invalid JSON. Try again."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/evaluate', methods=['POST'])
def evaluate():
    data = request.json
    results = data.get('results', [])
    topic = data.get('topic', 'Unknown')

    if not results:
        return jsonify({"error": "No results provided"}), 400

    score = sum(1 for r in results if r.get('is_correct'))
    max_score = len(results)

    # Log score
    database.log_quiz_score(user_id=1, topic=topic, score=score, max_score=max_score)

    accuracy = (score / max_score) * 100 if max_score > 0 else 0
    feedback = "Great job!"
    requires_simplification = False

    if accuracy < 60:
        feedback = "Looks like you struggled a bit. We've added a simpler explanation for your weak areas below."
        requires_simplification = True

    return jsonify({
        "score": score,
        "max_score": max_score,
        "accuracy": accuracy,
        "feedback": feedback,
        "requires_simplification": requires_simplification
    })

@app.route('/api/clarify-doubt', methods=['POST'])
def clarify_doubt():
    if not client:
        return jsonify({"error": "Groq API key not configured."}), 500

    data = request.json
    doubt = data.get('doubt', '')
    topic = data.get('topic', '')

    prompt = f"The user is confused about '{doubt}' within the context of '{topic}'. Re-explain it conceptually to a 10-year old in 1-2 short paragraphs. Keep it very simple."

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You simplify complex concepts for users struggling to understand."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
        )
        return jsonify({"explanation": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/dashboard', methods=['GET'])
def dashboard():
    stats = database.get_dashboard_stats(user_id=1)
    return jsonify(stats)

if __name__ == '__main__':
    app.run(debug=True, port=5000)