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
        lastScore: null,
        csrfToken: "",
        memoryBoost: null,
        flashcards: [],
        lastQuizResults: [],
        historyLessons: []
    };

    let availableVoices = [];

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

    function loadVoices() {
        availableVoices = speechSynthesis.getVoices() || [];
        return availableVoices;
    }

    function ensureVoicesLoaded(timeoutMs = 1200) {
        return new Promise((resolve) => {
            const existing = loadVoices();
            if (existing.length) {
                resolve(existing);
                return;
            }

            const startedAt = Date.now();
            const interval = setInterval(() => {
                const voices = loadVoices();
                if (voices.length || (Date.now() - startedAt) >= timeoutMs) {
                    clearInterval(interval);
                    resolve(voices);
                }
            }, 100);
        });
    }

    loadVoices();
    if ('onvoiceschanged' in speechSynthesis) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }

    function getNativeVoice(langCode) {
        const voices = availableVoices.length ? availableVoices : loadVoices();
        const baseLang = langCode.split('-')[0].toLowerCase();
        const languageNames = {
            en: 'english',
            hi: 'hindi',
            te: 'telugu',
            es: 'spanish'
        };
        const preferredVoiceHints = {
            hi: ['google हिन्दी', 'google hindi', 'microsoft heera', 'microsoft ravi'],
            es: ['google español', 'google español de estados unidos', 'microsoft helena', 'microsoft sabina'],
            te: ['telugu']
        };

        const matchesBaseLang = (voice) => voice.lang && voice.lang.toLowerCase().startsWith(baseLang);
        const preferredHints = preferredVoiceHints[baseLang] || [];

        let nativeVoice = voices.find(v => v.lang && v.lang.toLowerCase() === langCode.toLowerCase());
        if (!nativeVoice && preferredHints.length) {
            nativeVoice = voices.find(v =>
                matchesBaseLang(v) &&
                preferredHints.some(hint => v.name.toLowerCase().includes(hint) || (v.voiceURI && v.voiceURI.toLowerCase().includes(hint)))
            );
        }
        if (!nativeVoice) {
            nativeVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(baseLang));
        }
        if (!nativeVoice) {
            const langName = languageNames[baseLang] || state.language.toLowerCase();
            nativeVoice = voices.find(v =>
                v.name.toLowerCase().includes(langName) ||
                (v.voiceURI && v.voiceURI.toLowerCase().includes(langName))
            );
        }
        return nativeVoice;
    }

    function splitTextForSpeech(text) {
        if (!text) return [];

        const normalized = text
            .replace(/\r/g, ' ')
            .replace(/\n+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalized) return [];

        const roughChunks = normalized.match(/[^.!?।]+[.!?।]?/g) || [normalized];
        const finalChunks = [];

        roughChunks.forEach((chunk) => {
            const trimmed = chunk.trim();
            if (!trimmed) return;

            if (trimmed.length <= 180) {
                finalChunks.push(trimmed);
                return;
            }

            const words = trimmed.split(' ');
            let current = '';
            words.forEach((word) => {
                const candidate = current ? `${current} ${word}` : word;
                if (candidate.length > 180) {
                    if (current) finalChunks.push(current);
                    current = word;
                } else {
                    current = candidate;
                }
            });
            if (current) finalChunks.push(current);
        });

        return finalChunks;
    }

    function getImageFallbackDataUrl(title) {
        const safeTitle = (title || 'Educational Diagram')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
                <defs>
                    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#0f172a"/>
                        <stop offset="100%" stop-color="#1e293b"/>
                    </linearGradient>
                </defs>
                <rect width="1024" height="768" fill="url(#bg)"/>
                <rect x="60" y="60" width="904" height="648" rx="24" fill="#111827" stroke="#334155" stroke-width="2"/>
                <text x="512" y="320" text-anchor="middle" fill="#f8fafc" font-size="42" font-family="Arial, sans-serif" font-weight="700">${safeTitle}</text>
                <text x="512" y="380" text-anchor="middle" fill="#94a3b8" font-size="26" font-family="Arial, sans-serif">Image unavailable</text>
                <text x="512" y="440" text-anchor="middle" fill="#64748b" font-size="22" font-family="Arial, sans-serif">Using visual fallback</text>
            </svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    const MEMORY_STYLE_LABELS = {
        story: 'Story Hook',
        acronym: 'Acronyms',
        rhyme: 'Rhymes',
        funny: 'Funny Associations'
    };

    function styleKeyFromLabel(label) {
        const normalized = (label || '').trim().toLowerCase();
        if (normalized.includes('acronym')) return 'acronym';
        if (normalized.includes('rhyme')) return 'rhyme';
        if (normalized.includes('funny')) return 'funny';
        return 'story';
    }

    function setActiveMemoryStyle(styleKey) {
        document.querySelectorAll('.memory-style-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.style === styleKey);
        });
    }

    function renderMemoryBoost(memoryBoost) {
        if (!memoryBoost) return;

        const selectedLabel = memoryBoost.selected_style || MEMORY_STYLE_LABELS[memoryBoost.selected_style_key] || 'Story Hook';
        const suggestedLabel = memoryBoost.suggested_style || 'Story Hook';

        document.getElementById('memory-title').textContent = memoryBoost.mnemonic_title || 'Memory Hook';
        document.getElementById('memory-text').textContent = memoryBoost.mnemonic_text || 'No mnemonic available yet.';
        document.getElementById('memory-why').textContent = memoryBoost.why_it_works || '';
        document.getElementById('memory-selected-style').textContent = selectedLabel;
        document.getElementById('memory-suggested-style').textContent = `Recommended: ${suggestedLabel}`;
        setActiveMemoryStyle(memoryBoost.selected_style_key || styleKeyFromLabel(selectedLabel));
    }

    function setLearningExtrasVisibility(visible) {
        document.getElementById('memory-boost-section')?.classList.toggle('hidden', !visible);
        document.getElementById('flashcards-section')?.classList.toggle('hidden', !visible);
        document.querySelector('.doubt-section')?.classList.toggle('hidden', !visible);
        document.querySelector('.action-footer')?.classList.toggle('hidden', !visible);
    }

    function renderFlashcards(cards) {
        const grid = document.getElementById('flashcards-grid');
        if (!grid) return;

        if (!cards || !cards.length) {
            grid.innerHTML = '<div class="flashcard-empty">No flashcards available yet.</div>';
            return;
        }

        grid.innerHTML = cards.map((card, index) => `
            <div class="flashcard" data-flashcard-index="${index}">
                <div class="flashcard-inner">
                    <div class="flashcard-face flashcard-front">
                        <span class="flashcard-label">Front</span>
                        <p class="flashcard-text">${card.front || 'Quick recall prompt'}</p>
                        <span class="flashcard-hint">Tap to flip</span>
                    </div>
                    <div class="flashcard-face flashcard-back">
                        <span class="flashcard-label">Back</span>
                        <p class="flashcard-text">${card.back || 'Answer unavailable'}</p>
                        <span class="flashcard-hint">Tap to flip back</span>
                    </div>
                </div>
            </div>
        `).join('');

        grid.querySelectorAll('.flashcard').forEach((card) => {
            card.addEventListener('click', () => card.classList.toggle('flipped'));
        });
    }

    async function generateFlashcards() {
        const loadingEl = document.getElementById('flashcards-loading');
        loadingEl?.classList.remove('hidden');

        try {
            const resp = await fetch('/api/generate-flashcards', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({
                    topic: state.topic,
                    lesson_text: state.lessonText,
                    language: state.language
                })
            });
            const data = await resp.json();
            if (!resp.ok || data.error) throw new Error(data.error || 'Failed to generate flashcards');
            state.flashcards = data.cards || [];
            renderFlashcards(state.flashcards);
        } catch (error) {
            console.error(error);
            showToast(error.message || 'Failed to generate flashcards.', 'error');
            renderFlashcards([]);
        } finally {
            loadingEl?.classList.add('hidden');
        }
    }

    function renderAdaptiveRevision(revisionData) {
        document.getElementById('revision-title').textContent = revisionData.revision_title || 'Revision Sprint';
        document.getElementById('revision-body').innerHTML = revisionData.revision_html || '';
        document.getElementById('revision-tip').textContent = revisionData.practice_tip || '';
        document.getElementById('revision-focus-list').innerHTML = (revisionData.focus_areas || [])
            .map((item) => `<span class="revision-focus-pill">${item}</span>`)
            .join('');
        document.getElementById('adaptive-revision-area')?.classList.remove('hidden');
        document.getElementById('revision-loading')?.classList.add('hidden');
        document.getElementById('revision-content')?.classList.remove('hidden');
    }

    async function generateMnemonicForStyle(styleKey) {
        const loadingEl = document.getElementById('memory-loading');
        const textEl = document.getElementById('memory-text');

        loadingEl.classList.remove('hidden');
        textEl.textContent = 'Refreshing mnemonic...';
        setActiveMemoryStyle(styleKey);

        try {
            const resp = await fetch('/api/generate-mnemonic', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({
                    topic: state.topic,
                    lesson_text: state.lessonText,
                    language: state.language,
                    style: styleKey
                })
            });
            const data = await resp.json();
            if (!resp.ok || data.error) {
                throw new Error(data.error || 'Failed to generate mnemonic');
            }

            state.memoryBoost = data;
            renderMemoryBoost(state.memoryBoost);
        } catch (error) {
            console.error(error);
            showToast(error.message || 'Failed to update mnemonic.', 'error');
            if (state.memoryBoost) renderMemoryBoost(state.memoryBoost);
        } finally {
            loadingEl.classList.add('hidden');
        }
    }

    function buildLessonMarkupFromPayload(data) {
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
            const imgUrl = `/api/image?prompt=${encodeURIComponent(data.main_visual.visual)}&topic=${encodeURIComponent(data.concept || state.topic)}`;
            const fallbackImageUrl = getImageFallbackDataUrl(data.main_visual.title || 'Educational Diagram');
            const flowchartMarkup = data.main_visual.svg
                ? `<div class="diagram-stage" style="width: 100%; max-width: 100%; border-radius: 12px; overflow: hidden; background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.7)); margin-bottom: 18px;">${data.main_visual.svg}</div>`
                : '';
            const imageMarkup = `<div class="reference-image-wrap" style="width: 100%; margin-top: 8px;">
                        <div style="display: inline-flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 6px 12px; border-radius: 999px; background: rgba(96, 165, 250, 0.08); border: 1px solid rgba(96, 165, 250, 0.18); color: #93c5fd; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;">
                            <i class="fa-solid fa-image"></i> Related Reference Image
                        </div>
                        <img src="${imgUrl}" alt="${data.main_visual.title}" style="width: 100%; max-height: 520px; object-fit: contain; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); background: rgba(2, 6, 23, 0.72); padding: 10px; image-rendering: -webkit-optimize-contrast;" onerror="this.onerror=null;this.src='${fallbackImageUrl}'">
                    </div>`;

            visualsHTML = `
                <div class="main-visual-container mt-4" style="border: 1px solid var(--border-color); border-radius: 16px; padding: 20px; background: rgba(15, 23, 42, 0.4);">
                    <h3 style="color: var(--accent-blue); text-align: center; margin-bottom: 15px;">${data.main_visual.title}</h3>
                    <div class="visual-representation" style="background: rgba(0,0,0,0.4); border-radius: 12px; padding: 10px; text-align: center; min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05); box-shadow: inset 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px;">
                        ${flowchartMarkup}
                        ${imageMarkup}
                        <div class="educational-insight" style="background: rgba(6, 182, 212, 0.05); border-left: 4px solid var(--accent-cyan); padding: 15px; border-radius: 4px; text-align: left; margin-top: 10px;">
                            <h4 style="color: var(--accent-cyan); font-size: 0.9rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;"><i class="fa-solid fa-microscope"></i> Detailed Analysis</h4>
                            <p style="margin: 0; color: #e2e8f0; font-size: 1rem; line-height: 1.6; font-weight: 400;">${data.main_visual.deep_explanation || ""}</p>
                        </div>
                    </div>
                </div>
            `;
        }

        return `${summaryHTML}${keyPointsHTML}${visualsHTML}`;
    }

    function applyLessonPayload(data, options = {}) {
        state.topic = data.concept || data.topic || state.topic;
        state.lessonHTML = buildLessonMarkupFromPayload(data);
        state.lessonText = (data.summary || "") + "\n\n";
        if (data.key_points && data.key_points.length > 0) {
            state.lessonText += "KEY POINTS:\n" + data.key_points.join("\n- ") + "\n\n";
        }
        if (data.main_visual) {
            state.lessonText += `TECHNICAL ANALYSIS: ${data.main_visual.title}\n${data.main_visual.deep_explanation || ""}`;
        }

        document.getElementById('lesson-title').innerText = state.topic;
        document.getElementById('lesson-body').innerHTML = state.lessonHTML;
        document.getElementById('lesson-lang-badge').textContent = options.language || state.language;
        document.getElementById('lesson-duration-badge').textContent = `${options.duration || state.time} Mins`;
        state.memoryBoost = data.memory_boost || state.memoryBoost;
        if (state.memoryBoost) renderMemoryBoost(state.memoryBoost);
        document.getElementById('memory-style-picker')?.classList.add('hidden');
        document.getElementById('memory-loading')?.classList.add('hidden');
        setLearningExtrasVisibility(!options.readOnly);
    }

    function openHistoryItem(index) {
        const item = state.historyLessons[index];
        if (!item) return;

        try {
            const payload = JSON.parse(item.explanation || '{}');
            if (payload.revision_html) {
                document.getElementById('lesson-title').innerText = item.topic;
                document.getElementById('lesson-body').innerHTML = payload.revision_html;
                document.getElementById('lesson-lang-badge').textContent = state.language;
                document.getElementById('lesson-duration-badge').textContent = `${item.duration || 5} Mins`;
                setLearningExtrasVisibility(false);
            } else {
                applyLessonPayload(payload, { duration: item.duration });
                generateFlashcards();
            }
            setActiveNav('home-view');
            switchView('learning-view');
            showToast(`${item.topic} reopened from history.`, 'success');
        } catch (error) {
            console.error(error);
            showToast('Could not reopen this history item.', 'error');
        }
    }

    function getSpeechSupportMessage() {
        const isSecure = window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (!isSecure) {
            return 'Voice input needs HTTPS or localhost to access the microphone.';
        }
        return 'Voice input is not supported in this browser. Try Chrome or Edge on desktop.';
    }

    function getSpeechErrorMessage(errorCode) {
        const messages = {
            'not-allowed': 'Microphone permission was blocked. Allow mic access in the browser settings and try again.',
            'service-not-allowed': 'Speech recognition is disabled in this browser.',
            'no-speech': 'No speech was detected. Please speak a little closer to the microphone and try again.',
            'audio-capture': 'No microphone was found. Check your microphone connection and browser permissions.',
            'network': 'Speech recognition hit a network issue. Please check your connection and try again.',
            'aborted': 'Voice input was stopped before speech was captured.',
            'language-not-supported': 'The selected language is not supported for voice input in this browser.'
        };
        return messages[errorCode] || 'Voice input failed to start. Try Chrome or Edge with microphone permission enabled.';
    }

    if (SpeechRecognition) {
        const topicRecognition = new SpeechRecognition();
        topicRecognition.continuous = false;
        topicRecognition.interimResults = false;
        topicRecognition.maxAlternatives = 1;

        let isTopicRecording = false;
        topicMicBtn.addEventListener('click', (event) => {
            event.preventDefault();
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

        topicRecognition.onerror = (event) => {
            isTopicRecording = false;
            topicMicBtn.classList.remove('recording');
            showToast(getSpeechErrorMessage(event.error), 'error');
        };
    } else {
        if (topicMicBtn) {
            topicMicBtn.disabled = true;
            topicMicBtn.title = getSpeechSupportMessage();
        }
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

            applyLessonPayload(data);
            state.memoryBoost = data.memory_boost || {
                selected_style: 'Story Hook',
                selected_style_key: 'story',
                suggested_style: 'Story Hook',
                mnemonic_title: 'Memory Hook',
                mnemonic_text: 'No mnemonic available yet.',
                why_it_works: ''
            };
            renderMemoryBoost(state.memoryBoost);
            document.getElementById('adaptive-revision-area')?.classList.add('hidden');
            document.getElementById('revision-content')?.classList.add('hidden');
            document.getElementById('revision-loading')?.classList.add('hidden');
            generateFlashcards();

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
    ttsBtn?.addEventListener('click', async () => {
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
            ttsBtn.classList.remove('playing');
            ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Listen</span>';
            return;
        }

        if (!window.speechSynthesis) {
            showToast('Text-to-speech is not supported in this browser.', 'error');
            return;
        }

        const chunks = splitTextForSpeech(state.lessonText);
        if (!chunks.length) {
            showToast('No lesson text is available to read aloud yet.', 'error');
            return;
        }

        ttsBtn.classList.add('playing');
        ttsBtn.innerHTML = '<i class="fa-solid fa-stop"></i><span>Stop</span>';
        speechSynthesis.cancel();

        const langCode = getLangCode(state.language);
        await ensureVoicesLoaded();
        const nativeVoice = getNativeVoice(langCode);
        let chunkIndex = 0;

        if (!nativeVoice && state.language !== 'English') {
            showToast(`No dedicated ${state.language} voice is installed in this browser/Windows setup. Install that language's speech voice in Windows and restart the browser.`, 'info');
        }

        const speakNextChunk = () => {
            if (chunkIndex >= chunks.length) {
                ttsBtn.classList.remove('playing');
                ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Listen</span>';
                return;
            }

            const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
            utterance.lang = langCode;
            utterance.rate = 0.95;

            if (nativeVoice) {
                utterance.voice = nativeVoice;
            }

            utterance.onend = () => {
                chunkIndex += 1;
                speakNextChunk();
            };

            utterance.onerror = () => {
                ttsBtn.classList.remove('playing');
                ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Listen</span>';
                showToast(`Text-to-speech failed for ${state.language}. Your browser may not have that voice installed.`, 'error');
            };

            speechSynthesis.speak(utterance);
        };

        speakNextChunk();
    });

    // ==================== BACK BUTTON ====================
    document.getElementById('lesson-back-btn')?.addEventListener('click', () => {
        if (speechSynthesis.speaking) speechSynthesis.cancel();
        setActiveNav('home-view');
        switchView('home-view');
    });

    document.getElementById('toggle-memory-styles-btn')?.addEventListener('click', () => {
        document.getElementById('memory-style-picker')?.classList.toggle('hidden');
    });

    document.getElementById('refresh-flashcards-btn')?.addEventListener('click', () => {
        generateFlashcards();
    });

    document.querySelectorAll('.memory-style-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            generateMnemonicForStyle(btn.dataset.style);
        });
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
        doubtRecognition.maxAlternatives = 1;

        let isDoubtRecording = false;
        micBtn.addEventListener('click', (event) => {
            event.preventDefault();
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
        
        doubtRecognition.onerror = (event) => {
            isDoubtRecording = false;
            micBtn.classList.remove('recording');
            showToast(getSpeechErrorMessage(event.error), 'error');
        };
    } else if (micBtn) {
        micBtn.disabled = true;
        micBtn.title = getSpeechSupportMessage();
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
            state.lastQuizResults = results;
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

        document.getElementById('revision-loading')?.classList.add('hidden');
        document.getElementById('revision-content')?.classList.add('hidden');
        if (data.requires_simplification) {
            document.getElementById('adaptive-revision-area')?.classList.remove('hidden');
        } else {
            document.getElementById('adaptive-revision-area')?.classList.add('hidden');
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

    document.getElementById('start-revision-btn')?.addEventListener('click', async () => {
        document.getElementById('revision-loading')?.classList.remove('hidden');
        document.getElementById('revision-content')?.classList.add('hidden');

        try {
            const resp = await fetch('/api/adaptive-revision', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': state.csrfToken
                },
                body: JSON.stringify({
                    topic: state.topic,
                    lesson_text: state.lessonText,
                    language: state.language,
                    results: state.lastQuizResults
                })
            });
            const data = await resp.json();
            if (!resp.ok || data.error) throw new Error(data.error || 'Failed to generate adaptive revision');
            renderAdaptiveRevision(data);
        } catch (error) {
            console.error(error);
            document.getElementById('revision-loading')?.classList.add('hidden');
            showToast(error.message || 'Failed to generate adaptive revision.', 'error');
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

            state.historyLessons = data.recent_lessons || [];
            const historyList = document.getElementById('lesson-history-list');
            if (historyList) {
                historyList.innerHTML = state.historyLessons.length
                    ? state.historyLessons.map((item, index) => `
                        <div class="history-card">
                            <div class="history-card-main">
                                <h4>${item.topic}</h4>
                                <div class="history-card-meta">
                                    <span class="history-pill ${item.session_type || 'lesson'}">${item.session_type || 'lesson'}</span>
                                    <span>${item.duration || 0} mins</span>
                                    <span>${item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Recently'}</span>
                                    ${item.parent_topic ? `<span>from ${item.parent_topic}</span>` : ''}
                                </div>
                            </div>
                            <button type="button" class="primary-btn outline history-open-btn" data-history-index="${index}">
                                Reopen
                            </button>
                        </div>
                    `).join('')
                    : '<div class="history-card"><div class="history-card-main"><h4>No lesson history yet</h4><div class="history-card-meta"><span>Generate a lesson to start building your learning trail.</span></div></div></div>';

                historyList.querySelectorAll('.history-open-btn').forEach((btn) => {
                    btn.addEventListener('click', () => openHistoryItem(parseInt(btn.dataset.historyIndex, 10)));
                });
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
