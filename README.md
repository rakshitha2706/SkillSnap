<div align="center">
  <h1>SkillSnap AI</h1>
  <p><b>Adaptive micro-learning powered by AI, turning small time gaps into personalized lessons.</b></p>
  <p><i>Built for the <b>Witchhunt Hackathon</b> by <b>Team Vertex</b></i></p>
</div>

---

## Team Vertex
- **Rakshitha Poshetty**
- **Bommareddy Odithi Reddy**
- **Nallari Ranga Sai Shivani**

---

## Overview

SkillSnap AI is a micro-learning app for solo learners. It generates short AI lessons for a chosen topic, supports voice input, reads lessons aloud, quizzes the learner, tracks progress, and exports a PDF summary.

Whether you have 5, 10, or 15 minutes, you can enter or speak a topic, get an AI-generated lesson with a visual explanation, listen with text-to-speech, take a short quiz, and download a PDF summary.

---

## Key Features

- **Time-Constrained Lessons:** Lesson depth changes based on 5, 10, or 15 minutes.
- **Voice Input:** Uses the browser Web Speech API for topic and doubt capture.
- **Text-to-Speech:** Lessons can be read aloud in the selected language.
- **Quiz Flow:** Generates a 3-question quiz from the lesson content.
- **Dashboard Tracking:** Stores sessions, quiz accuracy, streaks, and weak topics in MongoDB.
- **PDF Export:** Downloads a lesson summary as a PDF using ReportLab.

---

## Architecture

SkillSnap uses:

- Flask for the backend and routing
- MongoDB for users, sessions, and quiz scores
- Groq for lesson, quiz, doubt, and simplification generation
- Vanilla HTML/CSS/JS for the UI
- ReportLab for PDF export

---

## Tech Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend UI** | HTML5, CSS3, Vanilla JS, Chart.js |
| **Frontend Utilities** | Web Speech API |
| **Backend Core** | Python, Flask, Flask-CORS |
| **Database** | MongoDB (`pymongo`) |
| **Auth & Security** | Werkzeug Password Hashing, Flask Sessions, Flask-WTF, Flask-Limiter |
| **Generative AI** | Groq API |
| **Offline Export** | `reportlab` |

---

## Installation & Workflow

### 1. Requirements
- Python 3.9+
- MongoDB instance running locally or in the cloud

### 2. Setup Guide

```bash
git clone https://github.com/your-username/skillsnap-ai.git
cd skillsnap-ai
pip install -r requirements.txt
```

Create a `.env` file manually and add:

```env
GROQ_API_KEY=your_key_here
SECRET_KEY=your_secret_here
MONGO_URI=mongodb://localhost:27017/
```

### 3. Running the App

```bash
python app.py
```

Then open `http://localhost:5000/`.

---

## Notes

- The active lesson flow uses the visual lesson generator route.
- Browser speech features depend on browser support.
- The `scratch/` folder was only for local experiments and is not part of the production app.

---

## Future Improvements

- Adaptive review recommendations based on weak quiz topics
- Lesson history and saved notes
- Real automated tests for API routes and dashboard logic
- Better fallback handling for image generation failures
