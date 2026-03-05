/* ============================================
   NoteClass — App Logic
   Web Speech API + MediaRecorder + Notes
   ============================================ */

(function () {
    'use strict';

    // Automatically redirect if opened directly as a file (to avoid Chrome blocking download filenames)
    if (window.location.protocol === 'file:') {
        window.location.href = 'http://localhost:5000/';
    }

    // ==========================================
    // Mobile viewport height fix (address bar)
    // ==========================================
    function setMobileVH() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', vh + 'px');
    }
    setMobileVH();
    window.addEventListener('resize', setMobileVH);
    window.addEventListener('orientationchange', () => {
        setTimeout(setMobileVH, 150);
    });

    // ==========================================
    // Mobile / Browser detection helpers
    // ==========================================
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|SamsungBrowser/i.test(navigator.userAgent);
    const isSamsungBrowser = /SamsungBrowser/i.test(navigator.userAgent);
    const isEdgeMobile = /EdgA|EdgiOS/i.test(navigator.userAgent);

    // ==========================================
    // State
    // ==========================================
    const state = {
        isRecording: false,
        isPaused: false,
        sessionName: '',
        startTime: null,
        elapsed: 0,
        timerInterval: null,
        transcription: [],
        interimTranscript: '',
        wordCount: 0,
        markers: 0,
        audioChunks: [],
        audioBlob: null,
        mediaRecorder: null,
        mediaStream: null,
        recognition: null,
        audioContext: null,
        analyser: null,
        animFrameId: null,
        settings: {
            language: 'es-AR',
            mode: 'continuous',
            fontSize: 16,
            autosave: true
        },
        history: []
    };

    // ==========================================
    // DOM Elements
    // ==========================================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const els = {
        welcomeScreen: $('#welcome-screen'),
        sessionScreen: $('#session-screen'),
        summaryScreen: $('#summary-screen'),
        sessionInfo: $('#session-info'),
        sessionStatusText: $('#session-status-text'),
        timer: $('#timer'),
        sessionNameInput: $('#session-name'),
        btnStartSession: $('#btn-start-session'),
        btnPause: $('#btn-pause'),
        btnResume: $('#btn-resume'),
        btnStop: $('#btn-stop'),
        btnScreenshot: $('#btn-screenshot'),
        btnAddMarker: $('#btn-add-marker'),
        btnAddHighlight: $('#btn-add-highlight'),
        transcriptionContent: $('#transcription-content'),
        interimText: $('#interim-text'),
        wordCount: $('#word-count'),
        notesEditor: $('#notes-editor'),
        audioVisualizer: $('#audio-visualizer'),
        // Summary
        summarySessionName: $('#summary-session-name'),
        statDuration: $('#stat-duration'),
        statWords: $('#stat-words'),
        statMarkers: $('#stat-markers'),
        summaryTranscription: $('#summary-transcription'),
        summaryNotes: $('#summary-notes'),
        btnDownloadAudio: $('#btn-download-audio'),
        btnDownloadNotes: $('#btn-download-notes'),
        btnDownloadAll: $('#btn-download-all'),
        btnNewSession: $('#btn-new-session'),
        // Modals
        btnHistory: $('#btn-history'),
        btnSettings: $('#btn-settings'),
        historyModal: $('#history-modal'),
        settingsModal: $('#settings-modal'),
        btnCloseHistory: $('#btn-close-history'),
        btnCloseSettings: $('#btn-close-settings'),
        historyList: $('#history-list'),
        // Settings
        settingLanguage: $('#setting-language'),
        settingMode: $('#setting-mode'),
        settingFontSize: $('#setting-font-size'),
        fontSizeValue: $('#font-size-value'),
        settingAutosave: $('#setting-autosave'),
        // Toast
        toast: $('#toast'),
        toastMessage: $('#toast-message'),
        // Warning
        browserWarning: $('#browser-warning'),
        // Loading
        loadingOverlay: $('#loading-overlay'),
        loadingMessage: $('#loading-message'),
        // Session badge
        sessionBadge: null
    };

    // ==========================================
    // Initialization
    // ==========================================
    function init() {
        loadSettings();
        loadHistory();
        checkBrowserSupport();
        bindEvents();
        applySettings();
    }

    function checkBrowserSupport() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            els.browserWarning.classList.remove('hidden');
        }
    }

    // ==========================================
    // Event Bindings
    // ==========================================
    function bindEvents() {
        // Start session
        els.btnStartSession.addEventListener('click', startSession);
        els.sessionNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') startSession();
        });

        // Controls
        els.btnPause.addEventListener('click', pauseSession);
        els.btnResume.addEventListener('click', resumeSession);
        els.btnStop.addEventListener('click', stopSession);
        els.btnScreenshot.addEventListener('click', addTimestampMarker);
        els.btnAddMarker.addEventListener('click', addBookmark);
        els.btnAddHighlight.addEventListener('click', addHighlight);

        // Summary actions
        els.btnDownloadAudio.addEventListener('click', downloadAudio);
        els.btnDownloadNotes.addEventListener('click', downloadNotes);
        els.btnDownloadAll.addEventListener('click', downloadAll);
        els.btnNewSession.addEventListener('click', newSession);

        // Modals
        els.btnHistory.addEventListener('click', () => toggleModal(els.historyModal));
        els.btnSettings.addEventListener('click', () => toggleModal(els.settingsModal));
        els.btnCloseHistory.addEventListener('click', () => toggleModal(els.historyModal));
        els.btnCloseSettings.addEventListener('click', () => toggleModal(els.settingsModal));

        // Close modals on overlay click
        $$('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                els.historyModal.classList.add('hidden');
                els.settingsModal.classList.add('hidden');
            });
        });

        // Settings
        els.settingLanguage.addEventListener('change', (e) => {
            state.settings.language = e.target.value;
            saveSettings();
        });

        els.settingMode.addEventListener('change', (e) => {
            state.settings.mode = e.target.value;
            saveSettings();
        });

        els.settingFontSize.addEventListener('input', (e) => {
            state.settings.fontSize = parseInt(e.target.value);
            els.fontSizeValue.textContent = state.settings.fontSize + 'px';
            applySettings();
            saveSettings();
        });

        els.settingAutosave.addEventListener('change', (e) => {
            state.settings.autosave = e.target.checked;
            saveSettings();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboard);
    }

    function handleKeyboard(e) {
        if (!state.isRecording) return;

        // Ctrl+Space = pause/resume
        if (e.ctrlKey && e.code === 'Space') {
            e.preventDefault();
            if (state.isPaused) resumeSession();
            else pauseSession();
        }

        // Ctrl+Shift+M = add marker
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') {
            e.preventDefault();
            addTimestampMarker();
        }

        // Ctrl+Shift+S = stop
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') {
            e.preventDefault();
            stopSession();
        }
    }

    // ==========================================
    // Session Management
    // ==========================================
    async function startSession() {
        const name = els.sessionNameInput.value.trim();
        state.sessionName = name || `Clase ${new Date().toLocaleDateString('es')}`;

        try {
            // Request microphone
            // On mobile, avoid specifying sampleRate as many browsers reject it
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            };
            // Only set sampleRate on desktop (mobile browsers often reject it)
            if (!isMobile) {
                audioConstraints.sampleRate = 44100;
            }
            state.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints
            });

            // Setup audio recording
            setupMediaRecorder();

            // Setup speech recognition
            setupSpeechRecognition();

            // Setup audio visualizer
            setupAudioVisualizer();

            // Switch screens
            els.welcomeScreen.classList.add('hidden');
            els.sessionScreen.classList.remove('hidden');
            els.sessionInfo.classList.remove('hidden');

            // Start timer
            state.isRecording = true;
            state.isPaused = false;
            state.startTime = Date.now();
            state.elapsed = 0;
            state.transcription = [];
            state.wordCount = 0;
            state.markers = 0;
            state.audioChunks = [];
            els.transcriptionContent.innerHTML = '';
            els.notesEditor.value = '';
            els.interimText.textContent = '';

            startTimer();

            // Start recording
            state.mediaRecorder.start(1000); // Collect data every second

            // Start speech recognition
            // On mobile, delay recognition start to avoid microphone contention
            // with MediaRecorder
            if (isMobile && state.recognition) {
                setTimeout(() => {
                    if (state.isRecording && state.recognition) {
                        try {
                            state.recognition.start();
                            startRecognitionWatchdog();
                            console.log('[NoteClass] Speech recognition started (mobile, delayed)');
                        } catch (e) {
                            console.warn('[NoteClass] Could not start speech recognition:', e.message);
                            showToast('⚠️ No se pudo iniciar la transcripción. La grabación continúa.');
                        }
                    }
                }, 800);
            } else if (state.recognition) {
                state.recognition.start();
                startRecognitionWatchdog();
            }

            showToast('🎙️ Sesión iniciada: ' + state.sessionName);
        } catch (err) {
            console.error('Error starting session:', err);
            if (err.name === 'NotAllowedError') {
                showToast('⚠️ Necesitas permitir acceso al micrófono');
            } else {
                showToast('❌ Error al iniciar: ' + err.message);
            }
        }
    }

    function pauseSession() {
        state.isPaused = true;

        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.pause();
        }

        if (state.recognition) {
            state.recognition.stop();
        }

        clearInterval(state.timerInterval);

        els.btnPause.classList.add('hidden');
        els.btnResume.classList.remove('hidden');

        const badge = $('.session-badge');
        if (badge) {
            badge.classList.add('paused');
            els.sessionStatusText.textContent = 'Pausado';
        }

        showToast('⏸️ Sesión pausada');
    }

    function resumeSession() {
        state.isPaused = false;

        if (state.mediaRecorder && state.mediaRecorder.state === 'paused') {
            state.mediaRecorder.resume();
        }

        try {
            state.recognition.start();
        } catch (e) {
            // Recognition might throw if already started
        }

        state.startTime = Date.now() - state.elapsed;
        startTimer();

        els.btnResume.classList.add('hidden');
        els.btnPause.classList.remove('hidden');

        const badge = $('.session-badge');
        if (badge) {
            badge.classList.remove('paused');
            els.sessionStatusText.textContent = 'Grabando';
        }

        showToast('▶️ Sesión reanudada');
    }

    function stopSession() {
        state.isRecording = false;
        state.isPaused = false;

        // Stop timer
        clearInterval(state.timerInterval);

        // Stop media recorder
        if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
            state.mediaRecorder.stop();
        }

        // Stop speech recognition and watchdog
        stopRecognitionWatchdog();
        if (state.recognition) {
            try {
                state.recognition.stop();
            } catch (e) { /* ignore */ }
        }

        // Stop audio visualizer
        if (state.animFrameId) {
            cancelAnimationFrame(state.animFrameId);
        }

        // Stop media stream
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach(track => track.stop());
        }

        // Close audio context
        if (state.audioContext) {
            state.audioContext.close();
        }

        // Show summary after a brief delay
        setTimeout(() => showSummary(), 500);
    }

    function newSession() {
        els.summaryScreen.classList.add('hidden');
        els.welcomeScreen.classList.remove('hidden');
        els.sessionInfo.classList.add('hidden');

        els.sessionNameInput.value = '';
        els.timer.textContent = '00:00:00';

        els.btnPause.classList.remove('hidden');
        els.btnResume.classList.add('hidden');

        const badge = $('.session-badge');
        if (badge) {
            badge.classList.remove('paused');
            els.sessionStatusText.textContent = 'Grabando';
        }

        state.audioBlob = null;
    }

    // ==========================================
    // Media Recorder (multi-format support)
    // ==========================================
    function getSupportedMimeType() {
        // Try formats in order of preference, covering Chrome, Edge, Samsung Internet, Safari
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4;codecs=aac',
            'audio/mp4',
            'audio/ogg;codecs=opus',
            'audio/ogg',
            'audio/aac',
            'audio/wav',
            '' // empty string = let browser choose default
        ];

        for (const candidate of candidates) {
            if (candidate === '') return ''; // fallback: no mimeType specified
            try {
                if (MediaRecorder.isTypeSupported(candidate)) {
                    console.log('[NoteClass] Using audio MIME type:', candidate);
                    return candidate;
                }
            } catch (e) {
                // Some browsers throw on isTypeSupported
            }
        }
        return '';
    }

    function getFileExtensionFromMime(mimeType) {
        if (mimeType.includes('webm')) return 'webm';
        if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'mp4';
        if (mimeType.includes('ogg')) return 'ogg';
        if (mimeType.includes('wav')) return 'wav';
        return 'webm'; // default
    }

    function setupMediaRecorder() {
        const mimeType = getSupportedMimeType();
        const recorderOptions = {};
        if (mimeType) {
            recorderOptions.mimeType = mimeType;
        }

        try {
            state.mediaRecorder = new MediaRecorder(state.mediaStream, recorderOptions);
        } catch (e) {
            console.warn('[NoteClass] MediaRecorder with options failed, trying default:', e);
            state.mediaRecorder = new MediaRecorder(state.mediaStream);
        }

        // Store the actual mimeType used
        state.recordingMimeType = state.mediaRecorder.mimeType || mimeType || 'audio/webm';
        console.log('[NoteClass] MediaRecorder started with mimeType:', state.recordingMimeType);

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                state.audioChunks.push(e.data);
            }
        };

        state.mediaRecorder.onstop = () => {
            state.audioBlob = new Blob(state.audioChunks, { type: state.recordingMimeType });
        };

        // Handle unexpected errors (common on mobile)
        state.mediaRecorder.onerror = (e) => {
            console.error('[NoteClass] MediaRecorder error:', e);
            showToast('⚠️ Error en la grabación de audio');
        };
    }

    // ==========================================
    // Speech Recognition (mobile-compatible)
    // ==========================================

    // Track recognition health globally
    let recognitionHasProducedResults = false;
    let recognitionWatchdogTimer = null;
    let recognitionRestartAttempts = 0;
    let lastRecognitionRestartTime = 0;
    const MAX_RESTART_ATTEMPTS = 10;

    function createRecognitionInstance() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return null;

        const recognition = new SpeechRecognition();
        recognition.lang = state.settings.language;
        recognition.maxAlternatives = 1;

        // CRITICAL FOR MOBILE: On mobile Chromium browsers (Edge, Samsung Internet,
        // Mi Browser, etc.), continuous=true causes the recognition to start but
        // NEVER fire onresult. The fix is to use continuous=false and manually
        // restart after each result/end event.
        if (isMobile) {
            recognition.continuous = false;
            recognition.interimResults = false; // Mobile is more reliable without interim
            console.log('[NoteClass] Speech recognition: mobile mode (continuous=false, no interim)');
        } else {
            recognition.continuous = true;
            recognition.interimResults = true;
            console.log('[NoteClass] Speech recognition: desktop mode (continuous=true, interim=true)');
        }

        return recognition;
    }

    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            showToast('⚠️ Tu navegador no soporta reconocimiento de voz. La grabación de audio continuará.');
            return;
        }

        recognitionHasProducedResults = false;
        recognitionRestartAttempts = 0;

        // Create initial instance
        state.recognition = createRecognitionInstance();
        if (!state.recognition) return;

        attachRecognitionHandlers(state.recognition);

        // Watchdog will be started when recognition actually starts in startSession
    }

    function attachRecognitionHandlers(recognition) {
        recognition.onstart = () => {
            console.log('[NoteClass] Speech recognition started');
        };

        recognition.onaudiostart = () => {
            console.log('[NoteClass] Speech recognition: audio capture started');
        };

        recognition.onresult = (event) => {
            // Mark as working — clear watchdog warning
            if (!recognitionHasProducedResults) {
                recognitionHasProducedResults = true;
                console.log('[NoteClass] Speech recognition: first result received!');
            }
            // Reset restart counter on successful result
            recognitionRestartAttempts = 0;

            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Update interim text
            els.interimText.textContent = interimTranscript;

            // Add final transcript
            if (finalTranscript.trim()) {
                addTranscriptionEntry(finalTranscript.trim());
            }
        };

        recognition.onerror = (event) => {
            console.error('[NoteClass] Speech recognition error:', event.error);

            if (event.error === 'not-allowed') {
                showToast('⚠️ Permiso de micrófono denegado para transcripción');
            } else if (event.error === 'network') {
                showToast('⚠️ Error de red en reconocimiento de voz. Verifica tu conexión a internet.');
            } else if (event.error === 'service-not-allowed') {
                showToast('⚠️ Servicio de reconocimiento de voz no disponible en este navegador.');
            } else if (event.error === 'no-speech') {
                // Normal — just means silence was detected, will auto-restart
            } else if (event.error === 'aborted') {
                // Can happen on mobile when screen locks or app goes to background
            } else {
                console.warn('[NoteClass] Unhandled speech error:', event.error);
            }
        };

        recognition.onend = () => {
            console.log('[NoteClass] Speech recognition ended');

            // Auto-restart if still recording
            if (state.isRecording && !state.isPaused) {
                const now = Date.now();
                // Reset counter if enough time has passed
                if (now - lastRecognitionRestartTime > 5000) {
                    recognitionRestartAttempts = 0;
                }

                if (recognitionRestartAttempts < MAX_RESTART_ATTEMPTS) {
                    recognitionRestartAttempts++;
                    lastRecognitionRestartTime = now;

                    // On mobile, create a FRESH instance each time (critical fix!)
                    // Mobile Chromium browsers cache internal state and the old instance
                    // may silently fail to produce results on subsequent starts
                    const delay = isMobile
                        ? Math.min(500 + recognitionRestartAttempts * 200, 3000)
                        : Math.min(recognitionRestartAttempts * 200, 1500);

                    setTimeout(() => {
                        if (!state.isRecording || state.isPaused) return;

                        if (isMobile) {
                            // Create fresh instance for mobile
                            try {
                                const newRecognition = createRecognitionInstance();
                                if (newRecognition) {
                                    attachRecognitionHandlers(newRecognition);
                                    state.recognition = newRecognition;
                                    state.recognition.start();
                                    console.log('[NoteClass] Fresh recognition instance started (mobile)');
                                }
                            } catch (e) {
                                console.warn('[NoteClass] Could not create/start fresh recognition:', e.message);
                            }
                        } else {
                            // Desktop: reuse existing instance
                            try {
                                state.recognition.start();
                            } catch (e) {
                                console.warn('[NoteClass] Could not restart recognition:', e.message);
                            }
                        }
                    }, delay);
                } else {
                    console.warn('[NoteClass] Max speech restart attempts reached, waiting 8s...');
                    showToast('⚠️ Reconocimiento de voz pausado temporalmente. Reintentando...');
                    setTimeout(() => {
                        recognitionRestartAttempts = 0;
                        if (state.isRecording && !state.isPaused) {
                            try {
                                if (isMobile) {
                                    const newRecognition = createRecognitionInstance();
                                    if (newRecognition) {
                                        attachRecognitionHandlers(newRecognition);
                                        state.recognition = newRecognition;
                                        state.recognition.start();
                                    }
                                } else {
                                    state.recognition.start();
                                }
                            } catch (e) { /* ignore */ }
                        }
                    }, 8000);
                }
            }
        };
    }

    function startRecognitionWatchdog() {
        // Clear existing watchdog
        if (recognitionWatchdogTimer) {
            clearTimeout(recognitionWatchdogTimer);
        }

        recognitionWatchdogTimer = setTimeout(() => {
            if (state.isRecording && !recognitionHasProducedResults) {
                console.warn('[NoteClass] Watchdog: No speech results after 15 seconds');
                showToast('⚠️ La transcripción no está funcionando. Intentá hablar más fuerte o usá Google Chrome para mejor compatibilidad.');

                // Try one more time with a completely fresh instance
                if (isMobile && state.recognition) {
                    try {
                        state.recognition.stop();
                    } catch (e) { /* ignore */ }

                    setTimeout(() => {
                        if (!state.isRecording || state.isPaused) return;
                        try {
                            const freshRecognition = createRecognitionInstance();
                            if (freshRecognition) {
                                attachRecognitionHandlers(freshRecognition);
                                state.recognition = freshRecognition;
                                state.recognition.start();
                                console.log('[NoteClass] Watchdog: Retrying with fresh instance');
                            }
                        } catch (e) {
                            console.error('[NoteClass] Watchdog retry failed:', e);
                        }
                    }, 1000);
                }
            }
        }, 15000);
    }

    function stopRecognitionWatchdog() {
        if (recognitionWatchdogTimer) {
            clearTimeout(recognitionWatchdogTimer);
            recognitionWatchdogTimer = null;
        }
    }

    function addTranscriptionEntry(text) {
        const timestamp = formatTime(Date.now() - state.startTime);

        const entry = {
            time: timestamp,
            text: text,
            type: 'normal'
        };

        state.transcription.push(entry);

        // Update word count
        state.wordCount += text.split(/\s+/).filter(w => w.length > 0).length;
        els.wordCount.textContent = state.wordCount + ' palabras';

        // Render entry
        const entryEl = document.createElement('div');
        entryEl.className = 'transcription-entry';
        entryEl.innerHTML = `
            <span class="transcription-timestamp">${timestamp}</span>
            <span class="transcription-text">${escapeHtml(text)}</span>
        `;

        // Remove placeholder if exists
        const placeholder = els.transcriptionContent.querySelector('.transcription-placeholder');
        if (placeholder) placeholder.remove();

        els.transcriptionContent.appendChild(entryEl);

        // Auto-scroll
        const area = els.transcriptionContent.parentElement;
        area.scrollTop = area.scrollHeight;

        // Auto-save
        if (state.settings.autosave) {
            autosaveSession();
        }
    }

    // ==========================================
    // Audio Visualizer
    // ==========================================
    function setupAudioVisualizer() {
        const canvas = els.audioVisualizer;
        const ctx = canvas.getContext('2d');

        try {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Mobile browsers require resume after user gesture
            if (state.audioContext.state === 'suspended') {
                state.audioContext.resume();
            }
        } catch (e) {
            console.warn('[NoteClass] AudioContext not available, visualizer disabled:', e);
            return;
        }

        const source = state.audioContext.createMediaStreamSource(state.mediaStream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 256;
        source.connect(state.analyser);

        const bufferLength = state.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function resizeCanvas() {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
        }

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        function draw() {
            state.animFrameId = requestAnimationFrame(draw);
            state.analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const barCount = 64;
            const barWidth = canvas.width / barCount;
            const step = Math.floor(bufferLength / barCount);

            for (let i = 0; i < barCount; i++) {
                const value = dataArray[i * step];
                const percent = value / 255;
                const barHeight = percent * canvas.height * 0.9;

                const x = i * barWidth;
                const y = canvas.height - barHeight;

                // Gradient color per bar
                const hue = 240 + (i / barCount) * 80; // indigo to purple
                ctx.fillStyle = `hsla(${hue}, 80%, 65%, ${0.4 + percent * 0.6})`;

                const radius = Math.min(barWidth * 0.3, 3);
                roundedRect(ctx, x + 1, y, barWidth - 2, barHeight, radius);
            }
        }

        draw();
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        if (height < 1) return;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height);
        ctx.lineTo(x, y + height);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }

    // ==========================================
    // Timer
    // ==========================================
    function startTimer() {
        state.timerInterval = setInterval(() => {
            state.elapsed = Date.now() - state.startTime;
            els.timer.textContent = formatTime(state.elapsed);
        }, 100);
    }

    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    // ==========================================
    // Markers & Highlights
    // ==========================================
    function addTimestampMarker() {
        if (!state.isRecording) return;

        const timestamp = formatTime(Date.now() - state.startTime);
        state.markers++;

        const entryEl = document.createElement('div');
        entryEl.className = 'transcription-entry marker-entry';
        entryEl.innerHTML = `
            <span class="transcription-timestamp">${timestamp}</span>
            <span class="transcription-text">📌 Momento marcado <span class="marker-badge">Marcador #${state.markers}</span></span>
        `;

        els.transcriptionContent.appendChild(entryEl);

        // Also add to notes
        const currentNotes = els.notesEditor.value;
        els.notesEditor.value = currentNotes + (currentNotes ? '\n' : '') + `📌 [${timestamp}] Momento importante #${state.markers}`;

        state.transcription.push({
            time: timestamp,
            text: `📌 Momento marcado #${state.markers}`,
            type: 'marker'
        });

        const area = els.transcriptionContent.parentElement;
        area.scrollTop = area.scrollHeight;

        showToast(`📌 Marcador #${state.markers} añadido`);
    }

    function addBookmark() {
        if (!state.isRecording) return;

        const timestamp = formatTime(Date.now() - state.startTime);
        const currentNotes = els.notesEditor.value;
        els.notesEditor.value = currentNotes + (currentNotes ? '\n' : '') + `🔖 [${timestamp}] `;
        els.notesEditor.focus();

        showToast('🔖 Marcador añadido en apuntes');
    }

    function addHighlight() {
        if (!state.isRecording) return;

        const timestamp = formatTime(Date.now() - state.startTime);

        const entryEl = document.createElement('div');
        entryEl.className = 'transcription-entry highlight-entry';
        entryEl.innerHTML = `
            <span class="transcription-timestamp">${timestamp}</span>
            <span class="transcription-text">⭐ Marcado como importante</span>
        `;

        els.transcriptionContent.appendChild(entryEl);

        const currentNotes = els.notesEditor.value;
        els.notesEditor.value = currentNotes + (currentNotes ? '\n' : '') + `⭐ [${timestamp}] IMPORTANTE: `;
        els.notesEditor.focus();

        state.transcription.push({
            time: timestamp,
            text: '⭐ Marcado como importante',
            type: 'highlight'
        });

        showToast('⭐ Marcado como importante');
    }

    // ==========================================
    // Summary
    // ==========================================
    function showSummary() {
        els.sessionScreen.classList.add('hidden');
        els.summaryScreen.classList.remove('hidden');

        // Populate summary
        els.summarySessionName.textContent = state.sessionName;
        els.statDuration.textContent = formatTime(state.elapsed);
        els.statWords.textContent = state.wordCount;
        els.statMarkers.textContent = state.markers;

        // Transcription
        const transcriptionText = state.transcription
            .map(e => `[${e.time}] ${e.text}`)
            .join('\n\n');
        els.summaryTranscription.textContent = transcriptionText || 'No se generó transcripción';

        // Notes
        els.summaryNotes.textContent = els.notesEditor.value || 'No se escribieron apuntes';

        // Save to history
        saveToHistory();

        showToast('✅ Sesión finalizada y guardada');
    }

    // ==========================================
    // Download Functions
    // ==========================================

    async function downloadAudio() {
        if (!state.audioBlob) {
            showToast('⚠️ No hay audio disponible');
            return;
        }

        showLoading('Convirtiendo audio a MP3 en el servidor...');

        // Determine file extension from actual recording format
        const ext = getFileExtensionFromMime(state.recordingMimeType || 'audio/webm');

        try {
            const formData = new FormData();
            formData.append('audio', state.audioBlob, 'audio.' + ext);
            formData.append('sessionName', state.sessionName);
            formData.append('inputFormat', ext);

            const response = await fetch('/api/convert/audio', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Falló la conversión en el servidor');
            }

            const blob = await response.blob();
            triggerDownload(blob, `${sanitizeFilename(state.sessionName)}_audio.mp3`);
            showToast('🎵 Audio descargado (MP3)');
        } catch (error) {
            console.error('Error downloading MP3:', error);
            showToast('⚠️ Error generando MP3, descargando audio original...');
            triggerDownload(state.audioBlob, `${sanitizeFilename(state.sessionName)}_audio.${ext}`);
        } finally {
            hideLoading();
        }
    }

    async function downloadNotes() {
        showLoading('Generando PDF en el servidor...');

        const dateStr = new Date().toLocaleDateString('es-AR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const data = {
            sessionName: state.sessionName,
            elapsed: formatTime(state.elapsed),
            wordCount: state.wordCount,
            markers: state.markers,
            date: dateStr,
            transcription: state.transcription,
            notes: els.notesEditor.value
        };

        try {
            const response = await fetch('/api/convert/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error('Error generando PDF en el backend');
            }

            const blob = await response.blob();
            triggerDownload(blob, `${sanitizeFilename(state.sessionName)}_apuntes.pdf`);
            showToast('📄 Apuntes PDF descargados');
        } catch (error) {
            console.error('Error in PDF backend:', error);
            showToast('⚠️ Falló la generación en PDF, descargando TXT');
            const transcriptionText = state.transcription
                .map(e => `[${e.time}] ${e.text}`)
                .join('\n\n');

            const content = `# ${state.sessionName}\n` +
                `Fecha: ${new Date().toLocaleDateString('es')}\n` +
                `Duracion: ${formatTime(state.elapsed)}\n` +
                `Palabras: ${state.wordCount}\n` +
                `Marcadores: ${state.markers}\n\n` +
                `${'='.repeat(50)}\n` +
                `TRANSCRIPCION\n${'='.repeat(50)}\n\n` +
                `${transcriptionText || '(Sin transcripcion)'}\n\n` +
                `${'='.repeat(50)}\n` +
                `APUNTES\n${'='.repeat(50)}\n\n` +
                `${els.notesEditor.value || '(Sin apuntes)'}`;

            downloadTextFile(content, `${sanitizeFilename(state.sessionName)}_apuntes.txt`);
        } finally {
            hideLoading();
        }
    }

    async function downloadAll() {
        await downloadAudio();
        setTimeout(() => downloadNotes(), 800);
    }

    function downloadTextFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        triggerDownload(blob, filename);
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);

        // Mobile browsers (especially Samsung Internet and Edge mobile) often
        // don't handle anchor click downloads properly. Use multiple strategies.
        if (isMobile && navigator.share && blob.size < 50 * 1024 * 1024) {
            // Try Web Share API on mobile (if available and file < 50MB)
            const file = new File([blob], filename, { type: blob.type });
            navigator.share({ files: [file] }).catch(() => {
                // Fallback to anchor download if share fails
                anchorDownload(url, filename);
            });
        } else {
            anchorDownload(url, filename);
        }
    }

    function anchorDownload(url, filename) {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        // Some mobile browsers need the anchor in the DOM and a target
        a.target = '_self';
        document.body.appendChild(a);

        // Use setTimeout to allow DOM update before triggering click
        setTimeout(() => {
            a.click();
            // Clean up safely
            requestAnimationFrame(() => {
                setTimeout(() => {
                    if (document.body.contains(a)) document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 10000); // Longer timeout for mobile browsers
            });
        }, 100);
    }

    function sanitizeFilename(name) {
        return name.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s\-_]/g, '').replace(/\s+/g, '_');
    }

    // ==========================================
    // Loading Overlay
    // ==========================================
    function showLoading(message) {
        els.loadingMessage.textContent = message || 'Procesando...';
        els.loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
        els.loadingOverlay.classList.add('hidden');
    }

    // ==========================================
    // History & Storage
    // ==========================================
    function saveToHistory() {
        const session = {
            id: Date.now(),
            name: state.sessionName,
            date: new Date().toISOString(),
            duration: formatTime(state.elapsed),
            wordCount: state.wordCount,
            markers: state.markers,
            transcription: state.transcription,
            notes: els.notesEditor.value
        };

        state.history.unshift(session);

        // Keep max 50 sessions
        if (state.history.length > 50) {
            state.history = state.history.slice(0, 50);
        }

        try {
            localStorage.setItem('noteclass_history', JSON.stringify(state.history));
        } catch (e) {
            console.warn('Could not save to localStorage:', e);
        }

        renderHistory();
    }

    function loadHistory() {
        try {
            const saved = localStorage.getItem('noteclass_history');
            if (saved) {
                state.history = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Could not load history:', e);
        }
        renderHistory();
    }

    function renderHistory() {
        if (state.history.length === 0) {
            els.historyList.innerHTML = '<p class="empty-history">No hay sesiones guardadas aún. ¡Comienza tu primera clase!</p>';
            return;
        }

        els.historyList.innerHTML = state.history.map(session => {
            const date = new Date(session.date).toLocaleDateString('es', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            return `
                <div class="history-item" data-id="${session.id}">
                    <div class="history-item-info">
                        <h4>${escapeHtml(session.name)}</h4>
                        <p>${date} · ${session.duration} · ${session.wordCount} palabras</p>
                    </div>
                    <div class="history-item-actions">
                        <button class="history-action-btn" onclick="window.__noteclass_downloadHistory(${session.id})" title="Descargar">📥</button>
                        <button class="history-action-btn" onclick="window.__noteclass_deleteHistory(${session.id})" title="Eliminar">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Expose history functions to window for inline handlers
    window.__noteclass_downloadHistory = async function (id) {
        const session = state.history.find(s => s.id === id);
        if (!session) return;

        showLoading('Generando PDF en el servidor...');

        const dateStr = new Date(session.date).toLocaleDateString('es-AR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const data = {
            sessionName: session.name,
            elapsed: session.duration,
            wordCount: session.wordCount,
            markers: session.markers,
            date: dateStr,
            transcription: session.transcription,
            notes: session.notes
        };

        try {
            const response = await fetch('/api/convert/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error('Error generando PDF en el backend');
            }

            const blob = await response.blob();
            triggerDownload(blob, `${sanitizeFilename(session.name)}_apuntes.pdf`);
            showToast('� Apuntes PDF descargados (Historial)');
        } catch (error) {
            console.error('Error in PDF backend history:', error);
            showToast('⚠️ Falló la generación en PDF, descargando TXT');

            // Fallback to TXT
            const transcriptionText = session.transcription
                .map(e => `[${e.time}] ${e.text}`)
                .join('\n\n');

            const content = `# ${session.name}\n` +
                `Fecha: ${new Date(session.date).toLocaleDateString('es')}\n` +
                `Duracion: ${session.duration}\n` +
                `Palabras: ${session.wordCount}\n\n` +
                `## TRANSCRIPCION\n\n${transcriptionText || '(Sin transcripcion)'}\n\n` +
                `## APUNTES\n\n${session.notes || '(Sin apuntes)'}`;

            downloadTextFile(content, `${sanitizeFilename(session.name)}_apuntes.txt`);
        } finally {
            hideLoading();
        }
    };

    window.__noteclass_deleteHistory = function (id) {
        state.history = state.history.filter(s => s.id !== id);
        try {
            localStorage.setItem('noteclass_history', JSON.stringify(state.history));
        } catch (e) {
            // ignore
        }
        renderHistory();
        showToast('🗑️ Sesión eliminada');
    };

    function autosaveSession() {
        if (!state.settings.autosave) return;

        try {
            const current = {
                name: state.sessionName,
                transcription: state.transcription,
                notes: els.notesEditor.value,
                wordCount: state.wordCount,
                markers: state.markers
            };
            localStorage.setItem('noteclass_autosave', JSON.stringify(current));
        } catch (e) {
            // Silently fail
        }
    }

    // ==========================================
    // Settings
    // ==========================================
    function loadSettings() {
        try {
            const saved = localStorage.getItem('noteclass_settings');
            if (saved) {
                Object.assign(state.settings, JSON.parse(saved));
            }
        } catch (e) {
            // Use defaults
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem('noteclass_settings', JSON.stringify(state.settings));
        } catch (e) {
            // ignore
        }
    }

    function applySettings() {
        els.settingLanguage.value = state.settings.language;
        els.settingMode.value = state.settings.mode;
        els.settingFontSize.value = state.settings.fontSize;
        els.fontSizeValue.textContent = state.settings.fontSize + 'px';
        els.settingAutosave.checked = state.settings.autosave;

        // Apply font size to transcription and notes
        document.documentElement.style.setProperty('--user-font-size', state.settings.fontSize + 'px');
        if (els.transcriptionContent) {
            els.transcriptionContent.style.fontSize = state.settings.fontSize + 'px';
        }
        if (els.notesEditor) {
            els.notesEditor.style.fontSize = state.settings.fontSize + 'px';
        }
    }

    // ==========================================
    // Modal Management
    // ==========================================
    function toggleModal(modal) {
        modal.classList.toggle('hidden');
    }

    // ==========================================
    // Toast Notifications
    // ==========================================
    function showToast(message) {
        els.toastMessage.textContent = message;
        els.toast.classList.remove('hidden');
        els.toast.classList.add('show');

        setTimeout(() => {
            els.toast.classList.remove('show');
            setTimeout(() => els.toast.classList.add('hidden'), 400);
        }, 3000);
    }

    // ==========================================
    // Utilities
    // ==========================================
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==========================================
    // Start
    // ==========================================
    document.addEventListener('DOMContentLoaded', init);
})();
