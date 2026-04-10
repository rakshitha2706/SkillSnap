/* ============================================================
   SKILLSNAP AI — Frontend Application Logic
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

    // ==================== STATE ====================
    let state = {
        time: 5,
        topic: "",
        language: "English",
        lessonHTML: "",
        lessonText: "",
        quizData: [],
        chartInstance: null,
        teacherChartInstance: null,
        lastScore: null,
        csrfToken: ""
    };

    // ==================== CSRF TOKEN INITIALIZATION ====================
    // Fetch and store CSRF token on page load for all AJAX requests
    fetch('/api/csrf-token')
        .then(res => res.json())
        .then(data => {
            state.csrfToken = data.csrf_token;
        })
        .catch(err => console.error('Warning: CSRF token fetch failed', err));

    // ==================== SVG DEFS FOR RING GRADIENT ====================
    // Inject gradient def into SVG for score ring
    const svgNS = "http://www.w3.org/2000/svg";
    const scoreRingSvg = document.querySelector('.score-ring');
    if (scoreRingSvg) {
        const defs = document.createElementNS(svgNS, 'defs');
        defs.innerHTML = `
            <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#7c3aed"/>
                <stop offset="100%" style="stop-color:#06b6d4"/>
            </linearGradient>`;
        scoreRingSvg.prepend(defs);
    }

    // ==================== HELPERS ====================
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', info: 'fa-circle-info' };
        toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${message}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
    }

    function animateCounter(el, target, suffix = '') {
        if (!el) return;
        const start = 0;
        const duration = 1200;
        const step = (timestamp) => {
            if (!start) start = timestamp;
            const progress = Math.min((timestamp - start) / duration, 1);
            const val = Math.round(progress * target);
            el.textContent = val + suffix;
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame((ts) => {
            let startTs = ts;
            const update = (timestamp) => {
                const progress = Math.min((timestamp - startTs) / duration, 1);
                el.textContent = Math.round(progress * target) + suffix;
                if (progress < 1) requestAnimationFrame(update);
            };
            requestAnimationFrame(update);
        });
    }

    // ==================== NAVIGATION ====================
    const navLinks = document.querySelectorAll('.nav-links li');
    const views = document.querySelectorAll('.view-section');

    function switchView(viewId) {
        views.forEach(v => v.classList.add('hidden'));
        const target = document.getElementById(viewId);
        if (target) {
            target.classList.remove('hidden');
            // Trigger animation restart
            target.style.animation = 'none';
            target.offsetHeight; // reflow
            target.style.animation = '';
        }
        if (viewId === 'dashboard-view') loadDashboard();
    }

    function setActiveNav(viewId) {
        navLinks.forEach(l => {
            l.classList.toggle('active', l.dataset.view === viewId);
        });
    }

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            setActiveNav(link.dataset.view);
            switchView(link.dataset.view);
        });
    });

    document.querySelector('.nav-to-dashboard')?.addEventListener('click', () => {
        setActiveNav('dashboard-view');
        switchView('dashboard-view');
    });

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', { 
                method: 'POST',
                headers: {
                    'X-CSRFToken': state.csrfToken
                }
            });
            window.location.href = '/';
        } catch (e) {
            console.error('Logout failed', e);
        }
    });

    document.getElementById('retry-btn')?.addEventListener('click', () => {
        setActiveNav('home-view');
        switchView('home-view');
    });

    // ==================== HOME: TIME SELECTOR ====================
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.time = parseInt(btn.dataset.time);
        });
    });

    // ==================== HOME: LANGUAGE SELECTOR ====================
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.language = btn.dataset.lang;
        });
    });

    // ==================== HOME: VOICE INPUT (Topic) ====================
    const topicMicBtn = document.getElementById('topic-mic-btn');
    const topicInput = document.getElementById('topic-input');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    function getLangCode(lang) {
        if (lang === 'Hindi') return 'hi-IN';
        if (lang === 'Telugu') return 'te-IN';
        if (lang === 'Spanish') return 'es-ES';
        return 'en-US';
    }

    if (SpeechRecognition) {
        const topicRecognition = new SpeechRecognition();
        topicRecognition.continuous = false;
        topicRecognition.interimResults = false;

        topicMicBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            topicRecognition.lang = getLangCode(state.language);
            try {
                topicRecognition.start();
                topicMicBtn.classList.add('recording');
                showToast('Listening for topic...', 'info');
            } catch(err) {}
        });

        topicMicBtn.addEventListener('mouseup', () => {
            topicRecognition.stop();
            topicMicBtn.classList.remove('recording');
        });

        topicMicBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            topicRecognition.lang = getLangCode(state.language);
            topicRecognition.start();
            topicMicBtn.classList.add('recording');
        });

        topicMicBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            topicRecognition.stop();
            topicMicBtn.classList.remove('recording');
        });

        topicRecognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            topicInput.value = transcript;
            showToast(`Topic set: "${transcript}"`, 'success');
        };

        topicRecognition.onerror = () => {
            topicMicBtn.classList.remove('recording');
            showToast('Voice recognition not available or no input detected.', 'error');
        };
    } else {
        if (topicMicBtn) topicMicBtn.style.display = 'none';
    }

    // ==================== GENERATE LESSON ====================
    const generateBtn = document.getElementById('generate-btn');

    function animateLoaderSteps() {
        const steps = ['ls-1', 'ls-2', 'ls-3'];
        let i = 0;
        steps.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('active', 'done');
                el.innerHTML = `<i class="fa-regular fa-circle"></i> ${el.textContent.trim().replace(/^.*? /, '')}`;
            }
        });

        const labels = ['Analyzing topic', 'Generating explanation', 'Preparing examples'];
        const interval = setInterval(() => {
            if (i > 0) {
                const prev = document.getElementById(steps[i - 1]);
                if (prev) {
                    prev.classList.remove('active');
                    prev.classList.add('done');
                    prev.innerHTML = `<i class="fa-solid fa-check"></i> ${labels[i - 1]}`;
                }
            }
            if (i < steps.length) {
                const cur = document.getElementById(steps[i]);
                if (cur) {
                    cur.classList.add('active');
                    cur.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${labels[i]}`;
                }
                i++;
            } else {
                clearInterval(interval);
            }
        }, 1200);
        return interval;
    }

    generateBtn.addEventListener('click', async () => {
        const topic = topicInput.value.trim();
        if (!topic) {
            showToast('Please enter a topic to learn!', 'error');
            return;
        }

        state.topic = topic;

        switchView('loading-view');
        const loaderInterval = animateLoaderSteps();

        try {
            const resp = await fetch('/api/generate-lesson', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({
                    topic: state.topic,
                    duration: state.time,
                    language: state.language
                })
            });
            const data = await resp.json();
            clearInterval(loaderInterval);

            if (data.error) {
                showToast(data.error, 'error');
                switchView('home-view');
                return;
            }

            state.lessonHTML = data.lesson;
            state.lessonText = '';

            document.getElementById('lesson-title').innerText = data.topic;
            document.getElementById('lesson-body').innerHTML = data.lesson;
            const lbEl = document.getElementById('lesson-body');
            state.lessonText = lbEl.innerText || lbEl.textContent;

            const langBadge = document.getElementById('lesson-lang-badge');
            if (langBadge) langBadge.textContent = state.language;

            // Reset doubt area
            const doubtInput = document.getElementById('doubt-input');
            if (doubtInput) doubtInput.value = '';
            const doubtAnswer = document.getElementById('doubt-answer');
            if (doubtAnswer) doubtAnswer.classList.add('hidden');

            // Stop any TTS
            if (speechSynthesis.speaking) speechSynthesis.cancel();
            const ttsBtn = document.getElementById('tts-btn');
            if (ttsBtn) {
                ttsBtn.classList.remove('playing');
                ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Listen</span>';
            }

            switchView('learning-view');
            showToast('Lesson ready! Start reading 📖', 'success');

        } catch (err) {
            clearInterval(loaderInterval);
            console.error(err);
            showToast('Failed to connect to server. Is Flask running?', 'error');
            switchView('home-view');
        }
    });

    // ==================== TTS ====================
    const ttsBtn = document.getElementById('tts-btn');
    ttsBtn?.addEventListener('click', () => {
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
            ttsBtn.classList.remove('playing');
            ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Listen</span>';
            return;
        }

        ttsBtn.classList.add('playing');
        ttsBtn.innerHTML = '<i class="fa-solid fa-stop"></i><span>Stop</span>';

        // Split text by punctuation to avoid silent failure on long utterances
        const sentences = state.lessonText.match(/[^.!?]+[.!?]+/g) || [state.lessonText];
        
        sentences.forEach((sentence, index) => {
            const utterance = new SpeechSynthesisUtterance(sentence.trim());
            utterance.lang = getLangCode(state.language);
            utterance.rate = 0.95;

            if (index === sentences.length - 1) {
                utterance.onend = () => {
                    ttsBtn.classList.remove('playing');
                    ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Listen</span>';
                };
            }
            
            speechSynthesis.speak(utterance);
        });
    });

    // ==================== BACK BUTTON ====================
    document.getElementById('lesson-back-btn')?.addEventListener('click', () => {
        if (speechSynthesis.speaking) speechSynthesis.cancel();
        setActiveNav('home-view');
        switchView('home-view');
    });

    // ==================== DOUBT CLARIFICATION ====================
    const doubtInputEl = document.getElementById('doubt-input');
    const submitDoubtBtn = document.getElementById('submit-doubt-btn');
    const micBtn = document.getElementById('mic-btn');

    async function submitDoubt() {
        const doubt = doubtInputEl.value.trim();
        if (!doubt) return;

        const answerDiv = document.getElementById('doubt-answer');
        answerDiv.classList.remove('hidden');
        answerDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Thinking...';

        try {
            const resp = await fetch('/api/clarify-doubt', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({ doubt, topic: state.topic, language: state.language })
            });
            const data = await resp.json();
            answerDiv.innerHTML = data.explanation || `<span style="color:var(--accent-red)">${data.error}</span>`;
        } catch (e) {
            answerDiv.innerHTML = '<span style="color:var(--accent-red)">Failed to fetch explanation.</span>';
        }
    }

    submitDoubtBtn?.addEventListener('click', submitDoubt);
    doubtInputEl?.addEventListener('keypress', (e) => { if (e.key === 'Enter') submitDoubt(); });

    // Voice input for doubt
    if (SpeechRecognition && micBtn) {
        const doubtRecognition = new SpeechRecognition();
        doubtRecognition.continuous = false;
        doubtRecognition.interimResults = false;

        micBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            doubtRecognition.lang = getLangCode(state.language);
            try {
                doubtRecognition.start();
                micBtn.classList.add('recording');
            } catch(err) {}
        });

        micBtn.addEventListener('mouseup', () => {
            doubtRecognition.stop();
            micBtn.classList.remove('recording');
        });

        micBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            doubtRecognition.lang = getLangCode(state.language);
            doubtRecognition.start();
            micBtn.classList.add('recording');
        });

        micBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            doubtRecognition.stop();
            micBtn.classList.remove('recording');
        });

        doubtRecognition.onresult = (event) => {
            doubtInputEl.value = event.results[0][0].transcript;
        };
    } else if (micBtn) {
        micBtn.style.display = 'none';
    }

    // ==================== QUIZ FLOW ====================
    document.getElementById('take-quiz-btn')?.addEventListener('click', async () => {
        if (speechSynthesis.speaking) speechSynthesis.cancel();
        switchView('quiz-loading-view');

        try {
            const resp = await fetch('/api/generate-quiz', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({ text: state.lessonText, topic: state.topic })
            });
            const data = await resp.json();

            if (data.error) {
                showToast(data.error, 'error');
                switchView('learning-view');
                return;
            }

            state.quizData = data.questions || [];
            renderQuiz();
            switchView('quiz-view');

        } catch (e) {
            console.error(e);
            showToast('Failed to generate quiz.', 'error');
            switchView('learning-view');
        }
    });

    function renderQuiz() {
        const container = document.getElementById('quiz-container');
        container.innerHTML = '';

        const totalQ = state.quizData.length;
        const progressBar = document.getElementById('quiz-progress-bar');
        if (progressBar) progressBar.style.width = '0%';

        state.quizData.forEach((q, index) => {
            const qDiv = document.createElement('div');
            qDiv.className = 'quiz-question';

            let optHtml = '';
            q.options.forEach((opt) => {
                const safeOpt = opt.replace(/"/g, '&quot;');
                optHtml += `
                    <label class="option-label">
                        <input type="radio" name="q${index}" value="${safeOpt}">
                        ${opt}
                    </label>`;
            });

            qDiv.innerHTML = `<h4>${index + 1}. ${q.question}</h4><div class="options-group">${optHtml}</div>`;
            container.appendChild(qDiv);
        });

        // Update progress bar as user answers
        container.addEventListener('change', () => {
            const answered = document.querySelectorAll('.quiz-container input[type="radio"]:checked').length;
            const progressBar = document.getElementById('quiz-progress-bar');
            if (progressBar) progressBar.style.width = `${(answered / totalQ) * 100}%`;
            const progressText = document.getElementById('quiz-progress-text');
            if (progressText) progressText.textContent = `${answered} of ${totalQ} answered`;
        });

        const progressText = document.getElementById('quiz-progress-text');
        if (progressText) progressText.textContent = `0 of ${totalQ} answered`;
    }

    document.getElementById('submit-quiz-btn')?.addEventListener('click', async () => {
        let results = [];
        let allAnswered = true;

        state.quizData.forEach((q, index) => {
            const selected = document.querySelector(`input[name="q${index}"]:checked`);
            if (!selected) {
                allAnswered = false;
            } else {
                const isCorrect = selected.value.trim() === q.correct_answer.trim();
                results.push({ question: q.question, is_correct: isCorrect, selected: selected.value, correct: q.correct_answer });
            }
        });

        if (!allAnswered) {
            showToast('Please answer all questions before submitting.', 'error');
            return;
        }

        const btn = document.getElementById('submit-quiz-btn');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Grading...';
        btn.disabled = true;

        try {
            const resp = await fetch('/api/evaluate', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({ results, topic: state.topic })
            });
            const data = await resp.json();

            state.lastScore = data;
            renderResult(data);
            switchView('result-view');

        } catch (e) {
            console.error(e);
            showToast('Failed to submit quiz.', 'error');
        } finally {
            btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Submit Answers';
            btn.disabled = false;
        }
    });

    function renderResult(data) {
        document.getElementById('score-text').textContent = `${data.score}/${data.max_score}`;
        document.getElementById('feedback-text').textContent = data.feedback;

        // Animate accuracy bar
        const accBar = document.getElementById('accuracy-bar-fill');
        const accPct = document.getElementById('accuracy-pct');
        if (accBar) {
            setTimeout(() => { accBar.style.width = `${data.accuracy}%`; }, 100);
        }
        if (accPct) accPct.textContent = `${data.accuracy}%`;

        // Animate SVG ring
        const ringFill = document.getElementById('ring-fill');
        if (ringFill) {
            const circumference = 2 * Math.PI * 52; // r=52
            const filled = (data.accuracy / 100) * circumference;
            setTimeout(() => {
                ringFill.style.strokeDasharray = `${filled} ${circumference}`;
            }, 150);
        }

        // Simplification
        const simpArea = document.getElementById('simplification-area');
        const simpText = document.getElementById('simplification-text');
        if (data.requires_simplification) {
            simpArea.classList.remove('hidden');
            if (simpText) simpText.textContent = 'Fetching a simpler explanation...';
            fetchSimplification(simpText);
        } else {
            simpArea.classList.add('hidden');
        }
    }

    async function fetchSimplification(el) {
        try {
            const resp = await fetch('/api/simplify', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({ topic: state.topic, language: state.language })
            });
            const data = await resp.json();
            if (el) el.textContent = data.explanation || 'Review the topic again with fresh eyes!';
        } catch (e) {
            if (el) el.textContent = 'Keep going — repeat the lesson with a focus on the key points.';
        }
    }

    // ==================== PDF DOWNLOAD (Snap-Note) ====================
    document.getElementById('download-pdf-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('download-pdf-btn');
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
        btn.disabled = true;

        try {
            const resp = await fetch('/api/download-pdf', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({
                    topic: state.topic,
                    lessonText: state.lessonHTML
                })
            });

            if (!resp.ok) throw new Error('Failed to download');

            // Download file blob
            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `SnapNote_${state.topic.replace(/\\s+/g, '_')}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            showToast('Snap-Note downloaded successfully!', 'success');
        } catch (e) {
            console.error(e);
            showToast('Failed to generate PDF.', 'error');
        } finally {
            btn.innerHTML = origHtml;
            btn.disabled = false;
        }
    });

    // ==================== STUDENT DASHBOARD ====================
    async function loadDashboard() {
        try {
            const resp = await fetch('/api/dashboard');
            const data = await resp.json();

            animateCounter(document.getElementById('total-time'), data.total_time_mins || 0);
            animateCounter(document.getElementById('avg-accuracy'), data.avg_accuracy || 0, '%');
            animateCounter(document.getElementById('concepts-learned'), data.concepts_learned || 0);
            animateCounter(document.getElementById('streak-days-card'), data.streak_days || 0);
            animateCounter(document.getElementById('streak-days'), data.streak_days || 0);

            // Recent Topics
            const recentList = document.getElementById('recent-topics-list');
            if (recentList) {
                recentList.innerHTML = data.recent_topics && data.recent_topics.length
                    ? data.recent_topics.map(t => `<li>${t}</li>`).join('')
                    : '<li>No topics yet — start learning!</li>';
            }

            // Weak Topics
            const weakList = document.getElementById('weak-topics-list');
            if (weakList) {
                weakList.innerHTML = data.weak_topics && data.weak_topics.length
                    ? data.weak_topics.map(t => `<li>${t}</li>`).join('')
                    : '<li>🎉 No weak areas found — great work!</li>';
            }

            renderAccuracyChart(data.chart_data);

        } catch (e) {
            console.error('Dashboard error:', e);
            showToast('Failed to load dashboard data.', 'error');
        }
    }

    function renderAccuracyChart(chartData) {
        if (!chartData || chartData.length === 0) return;
        if (state.chartInstance) state.chartInstance.destroy();

        const ctx = document.getElementById('accuracyChart');
        if (!ctx) return;

        state.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.map(d => d.topic.length > 12 ? d.topic.substring(0,12)+'…' : d.topic),
                datasets: [{
                    label: 'Quiz Accuracy (%)',
                    data: chartData.map(d => d.accuracy),
                    borderColor: '#7c3aed',
                    backgroundColor: 'rgba(124,58,237,0.12)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#7c3aed',
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#8888aa', font: { family: 'Outfit' } }
                    },
                    x: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#8888aa', font: { family: 'Outfit' } }
                    }
                }
            }
        });
    }



});
