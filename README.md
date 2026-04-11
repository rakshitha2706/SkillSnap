<div align="center">
  <h1>⚡ SkillSnap AI</h1>
  <p><b>Adaptive micro-learning powered by AI, transforming small idle time into personalized learning.</b></p>
  
  <p><i>Built for the <b>Witchhunt Hackathon</b> by <b>Team Vertex</b></i></p>
</div>

---

## 👥 Team Vertex
- **Rakshitha Poshetty**
- **Bommareddy Odithi Reddy**
- **Nallari Ranga Sai Shivani**

---

## 🚀 Overview

In today's fast-paced world, finding time for continuous learning is tough. SkillSnap AI is a frictionless, micro-learning productivity app designed specifically for the solo-learner. It eliminates cognitive overload by generating perfectly tailored, time-constrained lessons in seconds.

Whether you have 5, 10, or 15 minutes, you can simply speak your topic into the microphone, and SkillSnap AI will dynamically generate an optimized lesson, read it aloud to you, test your understanding, and provide a downloadable offline PDF.

---

## ✨ Key Features

- **⏱️ Time-Constrained Prompts:** Got 5 minutes? You get a high-level summary and an analogy. Got 15 minutes? You get detailed breakdowns and real-world case studies. The AI adjusts depth dynamically.
- **🎙️ Frictionless Voice Input:** Integrated **Web Speech API** allows you to dictate your topics without typing.
- **🎧 Text-to-Speech (TTS):** True hands-free learning; have your lessons narrated to you while you commute.
- **🧠 Interactive Verification:** AI-generated 3-question quizzes automatically test your retention right after reading. 
- **📈 Progress & Streaks:** Secure user authentication using MongoDB natively tracks your exact learning streaks, accuracy, and weak areas.
- **📥 Snap-Notes (PDF Generation):** Click a button to instantly compile and download a rich `.pdf` of your lesson for offline archiving (powered by ReportLab).

---

## 🏗️ Architecture

Below is the end-to-end framework of SkillSnap AI, showcasing exactly how the MongoDB Database, Flask Backend, user Interface, and our Generative AI Models connect.

<img width="1189" height="673" alt="Screenshot 2026-04-11 141127" src="https://github.com/user-attachments/assets/c6cc63ff-2f5e-48a0-bf44-e98e06bac633" />


---

## 💻 Tech Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend UI** | HTML5, CSS3, Vanilla JS, Chart.js, Glassmorphism UI |
| **Frontend Utilities**| Web Speech API (STT & TTS) |
| **Backend Core** | Python, Flask, Flask-CORS |
| **Database** | MongoDB (`pymongo`) |
| **Auth & Security** | Werkzeug Password Hashing, Flask Sessions |
| **Generative AI** | Groq API (`llama-3.1-8b-instant`) |
| **Offline Export** | `reportlab` (Dynamic PDF Generation) |

---

## ⚙️ Installation & Workflow

### 1. Requirements
- Python 3.9+
- MongoDB instance running locally (or a cloud cluster)

### 2. Setup Guide

```bash
# Clone the repository
git clone https://github.com/your-username/skillsnap-ai.git
cd skillsnap-ai

# Install Python dependencies
pip install -r requirements.txt

# Configure Environment Variables
cp .env.example .env
# Edit the .env file with your specific GROQ_API_KEY and MONGO_URI
```

### 3. Running the App
```bash
python app.py
```
Then, open your browser and navigate to `http://localhost:5000/`.

---

## 🗺️ Future Improvements
- **Adaptive Pathways:** Trigger consecutive lessons based explicitly on the weak areas identified in a quiz.
- **Vector Embeddings (RAG):** Integrate enterprise documentation to curate hyper-specialized training modules internally.
- **Gamification:** Introduce a global leaderboard tracking total minute streaks across the platform.

<br>
<div align="center">
  <i>"Turning idle time into continuous growth."</i>
</div>
