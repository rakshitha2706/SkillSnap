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

    function getNativeVoice(langCode) {
        const voices = speechSynthesis.getVoices();
        // Try to find a voice that strictly matches the language code
        let nativeVoice = voices.find(v => v.lang === langCode || v.lang.startsWith(langCode.split('-')[0]));
        // Fallback to any voice that contains the language name if not found
        if (!nativeVoice) {
            const langName = state.language.toLowerCase();
            nativeVoice = voices.find(v => v.name.toLowerCase().includes(langName));
        }
        return nativeVoice;
    }

    if (SpeechRecognition) {
        const topicRecognition = new SpeechRecognition();
        topicRecognition.continuous = false;
        topicRecognition.interimResults = false;

        let isTopicRecording = false;
        topicMicBtn.addEventListener('click', () => {
            if (isTopicRecording) {
                topicRecognition.stop();
                return;
            }

            topicRecognition.lang = getLangCode(state.language);
            try {
                topicRecognition.start();
            } catch(err) {
                console.error("Mic start error:", err);
                topicRecognition.stop();
            }
        });

        topicRecognition.onstart = () => {
            isTopicRecording = true;
            topicMicBtn.classList.add('recording');
            showToast('Listening... Speak now 🎤', 'info');
        };

        topicRecognition.onend = () => {
            isTopicRecording = false;
            topicMicBtn.classList.remove('recording');
        };

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
            const resp = await fetch('/api/generate-visual', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({
                    concept: state.topic,
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

            // Create Visual Learning UI
            const summaryHTML = data.summary ? `<p class="lesson-summary" style="font-size: 1.1rem; line-height: 1.6;">${data.summary}</p>` : '';
            const keyPointsHTML = data.key_points && data.key_points.length > 0 ? `
                <div class="key-points-box mt-3" style="background: rgba(124, 58, 237, 0.1); padding: 15px; border-radius: 8px; border-left: 4px solid var(--accent-purple);">
                    <h4 style="margin-bottom: 10px; color: var(--accent-purple);"><i class="fa-solid fa-key"></i> Key Points</h4>
                    <ul style="margin-left: 20px; list-style-type: disc;">
                        ${data.key_points.map(kp => `<li style="margin-bottom: 5px;">${kp}</li>`).join('')}
                    </ul>
                </div>
            ` : '';

            let visualsHTML = '';
            if (data.main_visual) {
                // Pass the EXACT description to the proxy to ensure matching
                const imgUrl = `/api/image?prompt=${encodeURIComponent(data.main_visual.visual)}&topic=${encodeURIComponent(state.topic)}`;
                
                visualsHTML = `
                    <div class="main-visual-container mt-4" style="border: 1px solid var(--border-color); border-radius: 16px; padding: 20px; background: rgba(15, 23, 42, 0.4);">
                        <h3 style="color: var(--accent-blue); text-align: center; margin-bottom: 15px;">${data.main_visual.title}</h3>
                        <div class="visual-representation" style="background: rgba(0,0,0,0.4); border-radius: 12px; padding: 10px; text-align: center; min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05); box-shadow: inset 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px;">
                            <img src="${imgUrl}" alt="${data.main_visual.title}" style="width: 100%; max-height: 600px; object-fit: contain; border-radius: 8px; margin-bottom: 15px; image-rendering: -webkit-optimize-contrast;" onerror="this.src='https://via.placeholder.com/1024x1024?text=Educational+Diagram'">
                            <div class="educational-insight" style="background: rgba(6, 182, 212, 0.05); border-left: 4px solid var(--accent-cyan); padding: 15px; border-radius: 4px; text-align: left; margin-top: 10px;">
                                <h4 style="color: var(--accent-cyan); font-size: 0.9rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;"><i class="fa-solid fa-microscope"></i> Detailed Analysis</h4>
                                <p style="margin: 0; color: #e2e8f0; font-size: 1rem; line-height: 1.6; font-weight: 400;">${data.main_visual.deep_explanation || ""}</p>
                            </div>
                        </div>
                    </div>
                `;
            }

            const finalHTML = `
                ${summaryHTML}
                ${keyPointsHTML}
                ${visualsHTML}
            `;
            
            document.getElementById('lesson-title').innerText = data.concept || state.topic;
            document.getElementById('lesson-body').innerHTML = finalHTML;
            state.lessonHTML = finalHTML;
            state.concept = data.concept || state.topic; // Store the official concept

            // Generate plaintext for Quiz/TTS/PDF
            let mergedText = (data.summary || "") + "\n\n";
            if (data.key_points && data.key_points.length > 0) mergedText += "KEY POINTS:\n" + data.key_points.join("\n- ") + "\n\n";
            if (data.main_visual) {
                mergedText += `TECHNICAL ANALYSIS: ${data.main_visual.title}\n${data.main_visual.deep_explanation || ""}`;
            }
            state.lessonText = mergedText;

            // Setup Slideshow Logic (Removed since we only have one image)
            if (data.visual_scenes && data.visual_scenes.length > 0) {
                let currSlide = 0;
                const totalSlides = data.visual_scenes.length;
                let autoPlayInterval = null;

                const updateSlides = () => {
                    for(let i=0; i<totalSlides; i++) {
                         const slide = document.getElementById('slide-'+i);
                         if (slide) slide.style.display = i === currSlide ? 'block' : 'none';
                    }
                    const counter = document.getElementById('scene-counter');
                    if (counter) counter.innerText = `${currSlide + 1} / ${totalSlides}`;
                };

                const nextSlide = () => {
                    currSlide = (currSlide + 1) % totalSlides;
                    updateSlides();
                };

                const prevSlide = () => {
                    currSlide = (currSlide - 1 + totalSlides) % totalSlides;
                    updateSlides();
                };

                document.getElementById('next-scene-btn')?.addEventListener('click', () => {
                    if(autoPlayInterval) { clearInterval(autoPlayInterval); autoPlayInterval=null; document.getElementById('play-scenes-btn').innerHTML = '<i class="fa-solid fa-play"></i> Auto-Play Lesson'; }
                    nextSlide();
                });

                document.getElementById('prev-scene-btn')?.addEventListener('click', () => {
                    if(autoPlayInterval) { clearInterval(autoPlayInterval); autoPlayInterval=null; document.getElementById('play-scenes-btn').innerHTML = '<i class="fa-solid fa-play"></i> Auto-Play Lesson'; }
                    prevSlide();
                });

                document.getElementById('play-scenes-btn')?.addEventListener('click', (e) => {
                    if (autoPlayInterval) {
                        clearInterval(autoPlayInterval);
                        autoPlayInterval = null;
                        e.target.innerHTML = '<i class="fa-solid fa-play"></i> Auto-Play Lesson';
                    } else {
                        nextSlide();
                        autoPlayInterval = setInterval(nextSlide, 4000);
                        e.target.innerHTML = '<i class="fa-solid fa-pause"></i> Pause Lesson';
                    }
                });
            }

            const langBadge = document.getElementById('lesson-lang-badge');
            if (langBadge) langBadge.textContent = state.language;
            
            const durationBadge = document.getElementById('lesson-duration-badge');
            if (durationBadge) durationBadge.textContent = `${state.time} Mins`;

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
            const langCode = getLangCode(state.language);
            utterance.lang = langCode;
            
            // Set native voice to avoid English accent/slang
            const nativeVoice = getNativeVoice(langCode);
            if (nativeVoice) {
                utterance.voice = nativeVoice;
            }
            
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

        let isDoubtRecording = false;
        micBtn.addEventListener('click', () => {
            if (isDoubtRecording) {
                doubtRecognition.stop();
                return;
            }

            doubtRecognition.lang = getLangCode(state.language);
            try {
                doubtRecognition.start();
            } catch(err) {
                console.error("Mic start error:", err);
                doubtRecognition.stop();
            }
        });

        doubtRecognition.onstart = () => {
            isDoubtRecording = true;
            micBtn.classList.add('recording');
            showToast('Listening for doubt...', 'info');
        };

        doubtRecognition.onend = () => {
            isDoubtRecording = false;
            micBtn.classList.remove('recording');
        };

        doubtRecognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            doubtInputEl.value = transcript;
            showToast('Doubt recorded! You can now submit.', 'success');
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
                    lessonText: state.lessonText
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
