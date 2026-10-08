/**
 * Jellyfin Subtitle Rewind (Auto-Sub on Rewind) v1.0.0
 * 
 * An Apple TV-inspired Jellyfin Web plugin that automatically turns on subtitles
 * for 60 seconds when skipping back up to 90 seconds to catch missed dialogue,
 * reverting seamlessly with zero UI disruption.
 * 
 * Target: Jellyfin Web 10.9+, Jellyfin Media Player (JMP), Jellyfin Desktop
 * License: MIT
 */

(function (window, document) {
    'use strict';

    if (!window || !document) return;
    if (window.__jellyfinSubtitleRewindInitialized) return;
    window.__jellyfinSubtitleRewindInitialized = true;

    // 1. TRACK SELECTOR MODULE (FR-04, FR-05)
    const TEXT_CODECS = new Set([
        'subrip', 'srt', 'vtt', 'webvtt', 'ass', 'ssa', 'mov_text', 'text', 'sub', 'ttml'
    ]);
    const BITMAP_CODECS = new Set([
        'pgs', 'pgssub', 'hdmv_pgs_subtitle', 'dvdsub', 'dvd_subtitle', 'vobsub', 'xsub', 'dvbsub'
    ]);
    const LANG_SYNONYMS = {
        'en': 'eng', 'eng': 'eng', 'english': 'eng',
        'es': 'spa', 'spa': 'spa', 'spanish': 'spa',
        'fr': 'fra', 'fra': 'fra', 'fre': 'fra', 'french': 'fra',
        'de': 'deu', 'deu': 'deu', 'ger': 'deu', 'german': 'deu',
        'it': 'ita', 'ita': 'ita', 'italian': 'ita',
        'ja': 'jpn', 'jpn': 'jpn', 'japanese': 'jpn',
        'ko': 'kor', 'kor': 'kor', 'korean': 'kor',
        'zh': 'zho', 'zho': 'zho', 'chi': 'zho', 'chinese': 'zho',
        'pt': 'por', 'por': 'por', 'portuguese': 'por',
        'ru': 'rus', 'rus': 'rus', 'russian': 'rus',
        'ar': 'ara', 'ara': 'ara', 'arabic': 'ara',
        'hi': 'hin', 'hin': 'hin', 'hindi': 'hin'
    };

    function normalizeLanguage(lang) {
        if (!lang || typeof lang !== 'string') return '';
        const clean = lang.trim().toLowerCase().split('-')[0].split('_')[0];
        return LANG_SYNONYMS[clean] || clean;
    }

    function isTextSubtitle(stream) {
        if (!stream) return false;
        if (typeof stream.IsTextSubtitleStream === 'boolean') {
            return stream.IsTextSubtitleStream;
        }
        const codec = (stream.Codec || '').toLowerCase();
        if (TEXT_CODECS.has(codec)) return true;
        if (BITMAP_CODECS.has(codec)) return false;
        if (stream.DeliveryMethod === 'External') return true;
        const title = (stream.DisplayTitle || stream.Title || '').toLowerCase();
        return title.includes('.srt') || title.includes('.vtt') || title.includes('.ass');
    }

    function isForcedStream(stream) {
        if (!stream) return false;
        if (stream.IsForced === true) return true;
        const title = (stream.DisplayTitle || stream.Title || '').toLowerCase();
        return title.includes('forced') || title.includes('foreign parts');
    }

    function isCommentaryStream(stream) {
        if (!stream) return false;
        if (stream.IsCommentary === true) return true;
        const title = (stream.DisplayTitle || stream.Title || '').toLowerCase();
        return title.includes('commentary') || title.includes('director') || title.includes('description');
    }

    function isHearingImpairedStream(stream) {
        if (!stream) return false;
        if (stream.IsHearingImpaired === true) return true;
        const title = (stream.DisplayTitle || stream.Title || '').toLowerCase();
        return title.includes('sdh') || title.includes('cc') || title.includes('closed caption') || title.includes('hearing impaired');
    }

    function scoreSubtitleStream(stream, context) {
        if (!stream || stream.Type !== 'Subtitle') return -1;
        if (isForcedStream(stream) || isCommentaryStream(stream)) return -1;

        let score = 0;
        const isText = isTextSubtitle(stream);
        const prioritizeText = context.prioritizeText !== false;

        if (isText) {
            score += 10000;
        } else if (!prioritizeText) {
            score += 5000;
        }

        const streamLang = normalizeLanguage(stream.Language || stream.LanguageCode);
        const preferredLang = normalizeLanguage(context.preferredLanguage);
        const audioLang = normalizeLanguage(context.activeAudioLanguage);
        const englishLang = 'eng';

        if (preferredLang && streamLang === preferredLang) {
            score += 4000;
        } else if (audioLang && streamLang === audioLang) {
            score += 2500;
        } else if (streamLang === englishLang) {
            score += 1500;
        } else if (streamLang) {
            score += 500;
        } else {
            score += 100;
        }

        const isSDH = isHearingImpairedStream(stream);
        if (!isSDH) {
            score += 300;
        } else if (context.allowSDH !== false) {
            score += 50;
        } else {
            return -1;
        }

        if (stream.IsExternal) score += 20;
        if (stream.IsDefault) score += 10;
        return score;
    }

    function selectBestSubtitleTrack(streams, options) {
        if (!Array.isArray(streams) || streams.length === 0) return null;
        let bestStream = null;
        let highestScore = -1;

        for (const stream of streams) {
            if (!stream || stream.Type !== 'Subtitle') continue;
            const score = scoreSubtitleStream(stream, options || {});
            if (score > highestScore) {
                highestScore = score;
                bestStream = stream;
            }
        }
        return highestScore > 0 ? bestStream : null;
    }

    // 2. SETTINGS MODULE (FR-08)
    const STORAGE_KEY = 'jellyfin_subtitle_rewind_settings';
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        rewindCapSeconds: 90,
        displayDurationSeconds: 60,
        preferredLanguage: '',
        prioritizeTextOverBitmap: true,
        allowSDH: true,
        debugLogging: false
    });

    class SettingsManager {
        constructor() {
            this.settings = this.load();
            this.listeners = new Set();
        }

        load() {
            try {
                if (window.localStorage) {
                    const stored = window.localStorage.getItem(STORAGE_KEY);
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        return {
                            ...DEFAULT_SETTINGS,
                            ...parsed,
                            rewindCapSeconds: Number(parsed.rewindCapSeconds) || DEFAULT_SETTINGS.rewindCapSeconds,
                            displayDurationSeconds: Number(parsed.displayDurationSeconds) || DEFAULT_SETTINGS.displayDurationSeconds
                        };
                    }
                }
            } catch (e) {
                console.warn('[SubtitleRewind] Failed to read settings:', e);
            }
            return { ...DEFAULT_SETTINGS };
        }

        save(newSettings) {
            this.settings = {
                ...this.settings,
                ...newSettings,
                rewindCapSeconds: Math.max(5, Math.min(300, Number(newSettings.rewindCapSeconds) || 90)),
                displayDurationSeconds: Math.max(5, Math.min(600, Number(newSettings.displayDurationSeconds) || 60))
            };
            try {
                if (window.localStorage) {
                    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
                }
            } catch (e) {}
            this.notify();
            return this.settings;
        }

        reset() {
            this.settings = { ...DEFAULT_SETTINGS };
            try {
                if (window.localStorage) window.localStorage.removeItem(STORAGE_KEY);
            } catch (e) {}
            this.notify();
            return this.settings;
        }

        get() { return { ...this.settings }; }

        onChange(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
        }

        notify() {
            for (const cb of this.listeners) {
                try { cb(this.settings); } catch (e) {}
            }
        }

        openSettingsModal() {
            const existing = document.getElementById('subtitle-rewind-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.id = 'subtitle-rewind-modal';
            modal.className = 'sr-modal-backdrop';
            modal.innerHTML = `
                <div class="sr-modal-content">
                    <div class="sr-modal-header">
                        <div class="sr-modal-title-row">
                            <span class="sr-modal-icon">⏪💬</span>
                            <h2>Subtitle Rewind Settings</h2>
                        </div>
                        <button class="sr-close-btn" id="sr-close-btn" aria-label="Close">&times;</button>
                    </div>

                    <div class="sr-modal-body">
                        <p class="sr-description">
                            Automatically turn on subtitles for a brief window when skipping back to catch missed dialogue.
                        </p>

                        <div class="sr-field-group">
                            <label class="sr-toggle-label">
                                <span class="sr-field-title">Enable Auto-Sub on Rewind</span>
                                <input type="checkbox" id="sr-enabled-toggle" ${this.settings.enabled ? 'checked' : ''} />
                                <span class="sr-toggle-slider"></span>
                            </label>
                        </div>

                        <div class="sr-field-group">
                            <div class="sr-slider-header">
                                <label for="sr-rewind-cap" class="sr-field-title">Rewind Trigger Cap</label>
                                <span class="sr-value-badge" id="sr-rewind-cap-val">${this.settings.rewindCapSeconds}s</span>
                            </div>
                            <input type="range" id="sr-rewind-cap" min="10" max="180" step="5" value="${this.settings.rewindCapSeconds}" />
                            <span class="sr-field-hint">Skips exceeding this duration are treated as scene navigation and ignored.</span>
                        </div>

                        <div class="sr-field-group">
                            <div class="sr-slider-header">
                                <label for="sr-display-duration" class="sr-field-title">Subtitle Display Duration</label>
                                <span class="sr-value-badge" id="sr-display-duration-val">${this.settings.displayDurationSeconds}s</span>
                            </div>
                            <input type="range" id="sr-display-duration" min="10" max="180" step="5" value="${this.settings.displayDurationSeconds}" />
                            <span class="sr-field-hint">How long subtitles remain visible before automatically reverting to Off.</span>
                        </div>

                        <div class="sr-field-group">
                            <label class="sr-field-title" for="sr-pref-lang">Preferred Language Override</label>
                            <input type="text" id="sr-pref-lang" placeholder="Auto (from profile, e.g. eng, spa, fra)" value="${this.settings.preferredLanguage || ''}" class="sr-text-input" />
                            <span class="sr-field-hint">Leave blank to use profile settings or active audio language.</span>
                        </div>

                        <div class="sr-field-group">
                            <label class="sr-toggle-label">
                                <span class="sr-field-title">Format-Safe Direct Play (Prioritize Text SRT/VTT)</span>
                                <input type="checkbox" id="sr-text-priority" ${this.settings.prioritizeTextOverBitmap ? 'checked' : ''} />
                                <span class="sr-toggle-slider"></span>
                            </label>
                            <span class="sr-field-hint">Prioritizes text subtitles over bitmap (PGS/VobSub) to prevent video transcoding buffer stalls.</span>
                        </div>

                        <div class="sr-field-group">
                            <label class="sr-toggle-label">
                                <span class="sr-field-title">Allow SDH (Hearing Impaired) as Fallback</span>
                                <input type="checkbox" id="sr-allow-sdh" ${this.settings.allowSDH ? 'checked' : ''} />
                                <span class="sr-toggle-slider"></span>
                            </label>
                            <span class="sr-field-hint">Full dialogue tracks are always prioritized first over SDH tracks.</span>
                        </div>
                    </div>

                    <div class="sr-modal-footer">
                        <button class="sr-btn sr-btn-secondary" id="sr-reset-btn">Reset Defaults</button>
                        <button class="sr-btn sr-btn-primary" id="sr-save-btn">Save & Close</button>
                    </div>
                </div>
            `;

            this.injectStyles();
            document.body.appendChild(modal);

            const capInput = modal.querySelector('#sr-rewind-cap');
            const capVal = modal.querySelector('#sr-rewind-cap-val');
            capInput.addEventListener('input', (e) => { capVal.textContent = `${e.target.value}s`; });

            const durInput = modal.querySelector('#sr-display-duration');
            const durVal = modal.querySelector('#sr-display-duration-val');
            durInput.addEventListener('input', (e) => { durVal.textContent = `${e.target.value}s`; });

            const closeModal = () => modal.remove();
            modal.querySelector('#sr-close-btn').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            modal.querySelector('#sr-reset-btn').addEventListener('click', () => {
                this.reset();
                modal.querySelector('#sr-enabled-toggle').checked = DEFAULT_SETTINGS.enabled;
                capInput.value = DEFAULT_SETTINGS.rewindCapSeconds;
                capVal.textContent = `${DEFAULT_SETTINGS.rewindCapSeconds}s`;
                durInput.value = DEFAULT_SETTINGS.displayDurationSeconds;
                durVal.textContent = `${DEFAULT_SETTINGS.displayDurationSeconds}s`;
                modal.querySelector('#sr-pref-lang').value = DEFAULT_SETTINGS.preferredLanguage;
                modal.querySelector('#sr-text-priority').checked = DEFAULT_SETTINGS.prioritizeTextOverBitmap;
                modal.querySelector('#sr-allow-sdh').checked = DEFAULT_SETTINGS.allowSDH;
            });

            modal.querySelector('#sr-save-btn').addEventListener('click', () => {
                this.save({
                    enabled: modal.querySelector('#sr-enabled-toggle').checked,
                    rewindCapSeconds: parseInt(capInput.value, 10),
                    displayDurationSeconds: parseInt(durInput.value, 10),
                    preferredLanguage: modal.querySelector('#sr-pref-lang').value.trim(),
                    prioritizeTextOverBitmap: modal.querySelector('#sr-text-priority').checked,
                    allowSDH: modal.querySelector('#sr-allow-sdh').checked
                });
                closeModal();
            });
        }

        injectStyles() {
            if (document.getElementById('sr-modal-styles')) return;
            const style = document.createElement('style');
            style.id = 'sr-modal-styles';
            style.textContent = `
                .sr-modal-backdrop {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background-color: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(4px);
                    z-index: 99999;
                    display: flex; align-items: center; justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .sr-modal-content {
                    background: #18191c; color: #e0e0e0; width: 90%; max-width: 500px;
                    border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.6);
                    border: 1px solid #2d3038; overflow: hidden;
                    animation: srFadeIn 0.15s ease-out;
                }
                @keyframes srFadeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
                .sr-modal-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 16px 20px; border-bottom: 1px solid #282a32;
                }
                .sr-modal-title-row { display: flex; align-items: center; gap: 10px; }
                .sr-modal-icon { font-size: 20px; }
                .sr-modal-header h2 { margin: 0; font-size: 1.15rem; font-weight: 600; color: #ffffff; }
                .sr-close-btn { background: none; border: none; color: #8e929b; font-size: 24px; cursor: pointer; padding: 0 4px; line-height: 1; }
                .sr-close-btn:hover { color: #ffffff; }
                .sr-modal-body { padding: 20px; max-height: 70vh; overflow-y: auto; }
                .sr-description { font-size: 0.88rem; color: #a0a4b0; margin: 0 0 18px 0; line-height: 1.4; }
                .sr-field-group { margin-bottom: 20px; }
                .sr-field-title { display: block; font-size: 0.92rem; font-weight: 500; color: #e6e6e6; margin-bottom: 4px; }
                .sr-field-hint { display: block; font-size: 0.78rem; color: #888d99; margin-top: 4px; line-height: 1.3; }
                .sr-slider-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
                .sr-value-badge { font-size: 0.85rem; font-weight: 600; color: #00a4dc; background: rgba(0,164,220,0.15); padding: 2px 8px; border-radius: 4px; }
                input[type="range"] { width: 100%; accent-color: #00a4dc; cursor: pointer; }
                .sr-text-input { width: 100%; box-sizing: border-box; padding: 8px 12px; background: #111215; border: 1px solid #363945; border-radius: 6px; color: #ffffff; font-size: 0.88rem; }
                .sr-text-input:focus { outline: none; border-color: #00a4dc; }
                .sr-toggle-label { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
                .sr-toggle-label input { cursor: pointer; width: 18px; height: 18px; accent-color: #00a4dc; }
                .sr-modal-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 14px 20px; border-top: 1px solid #282a32; background: #141518; }
                .sr-btn { padding: 8px 16px; border-radius: 6px; font-size: 0.88rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.15s ease; }
                .sr-btn-primary { background: #00a4dc; color: #ffffff; }
                .sr-btn-primary:hover { opacity: 0.9; }
                .sr-btn-secondary { background: #2a2c35; color: #b5b9c5; }
                .sr-btn-secondary:hover { background: #363844; color: #ffffff; }
            `;
            document.head.appendChild(style);
        }
    }

    // 3. VERSION-AGNOSTIC ADAPTER MODULE
    class JellyfinAdapter {
        constructor() {
            this.videoElement = null;
            this.eventListeners = new Map();
            this.cachedPreferredLanguage = null;
            this.initVideoWatcher();
        }

        getPlaybackManager() {
            return window.playbackManager || window.PlaybackManager || null;
        }

        getActivePlayer() {
            const pm = this.getPlaybackManager();
            if (!pm) return null;
            if (typeof pm.getCurrentPlayer === 'function') return pm.getCurrentPlayer();
            if (typeof pm.getPlayers === 'function') {
                const players = pm.getPlayers();
                return Array.isArray(players) && players.length > 0 ? players[0] : null;
            }
            return pm;
        }

        getVideoElement() {
            if (this.videoElement && document.contains(this.videoElement)) {
                return this.videoElement;
            }
            this.videoElement = document.querySelector('video.htmlvideoplayer') || document.querySelector('video') || null;
            return this.videoElement;
        }

        initVideoWatcher() {
            if (typeof MutationObserver === 'undefined') return;
            const observer = new MutationObserver(() => {
                const video = this.getVideoElement();
                if (video && (!this.boundVideo || this.boundVideo !== video)) {
                    this.bindVideoEvents(video);
                }
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

            const initialVideo = this.getVideoElement();
            if (initialVideo) this.bindVideoEvents(initialVideo);
        }

        bindVideoEvents(video) {
            if (this.boundVideo === video) return;
            this.boundVideo = video;

            const forwardEvent = (eventName) => (e) => {
                this.emit(eventName, {
                    currentTime: video.currentTime,
                    duration: video.duration,
                    paused: video.paused,
                    originalEvent: e
                });
            };

            video.addEventListener('timeupdate', forwardEvent('timeupdate'));
            video.addEventListener('seeking', forwardEvent('seeking'));
            video.addEventListener('seeked', forwardEvent('seeked'));
            video.addEventListener('pause', forwardEvent('pause'));
            video.addEventListener('play', forwardEvent('play'));
            video.addEventListener('playing', forwardEvent('playing'));
            video.addEventListener('ended', forwardEvent('ended'));
        }

        isPlaybackActive() {
            const pm = this.getPlaybackManager();
            if (pm && typeof pm.isPlaying === 'function') return pm.isPlaying();
            const video = this.getVideoElement();
            return !!(video && !isNaN(video.duration) && video.duration > 0);
        }

        getCurrentTime() {
            const pm = this.getPlaybackManager();
            const player = this.getActivePlayer();
            if (pm && typeof pm.currentTime === 'function') {
                try {
                    const time = pm.currentTime(player);
                    if (typeof time === 'number' && !isNaN(time)) {
                        return time > 100000 && this.getDuration() < 10000 ? time / 1000 : time;
                    }
                } catch (e) {}
            }
            const video = this.getVideoElement();
            return video ? video.currentTime : 0;
        }

        getDuration() {
            const pm = this.getPlaybackManager();
            const player = this.getActivePlayer();
            if (pm && typeof pm.duration === 'function') {
                try {
                    const dur = pm.duration(player);
                    if (typeof dur === 'number' && !isNaN(dur)) return dur;
                } catch (e) {}
            }
            const video = this.getVideoElement();
            return video && !isNaN(video.duration) ? video.duration : 0;
        }

        getCurrentMediaSource() {
            const pm = this.getPlaybackManager();
            const player = this.getActivePlayer();
            if (pm) {
                try {
                    if (typeof pm.currentMediaSource === 'function') {
                        const s = pm.currentMediaSource(player);
                        if (s) return s;
                    }
                    if (typeof pm.currentItem === 'function') {
                        const item = pm.currentItem(player);
                        if (item && item.MediaStreams) return item;
                        if (item && item.MediaSources && item.MediaSources[0]) return item.MediaSources[0];
                    }
                } catch (e) {}
            }
            return null;
        }

        getMediaStreams() {
            const source = this.getCurrentMediaSource();
            if (source && Array.isArray(source.MediaStreams)) return source.MediaStreams;
            return [];
        }

        getActiveAudioStream() {
            const streams = this.getMediaStreams();
            const pm = this.getPlaybackManager();
            const player = this.getActivePlayer();

            let audioIndex = -1;
            if (pm && typeof pm.getAudioStreamIndex === 'function') {
                try { audioIndex = pm.getAudioStreamIndex(player); } catch (e) {}
            }

            if (audioIndex >= 0) {
                const match = streams.find(s => s.Type === 'Audio' && s.Index === audioIndex);
                if (match) return match;
            }
            return streams.find(s => s.Type === 'Audio' && s.IsDefault) ||
                   streams.find(s => s.Type === 'Audio') || null;
        }

        getSubtitleStreamIndex() {
            const pm = this.getPlaybackManager();
            const player = this.getActivePlayer();
            if (pm && typeof pm.getSubtitleStreamIndex === 'function') {
                try {
                    const idx = pm.getSubtitleStreamIndex(player);
                    if (typeof idx === 'number') return idx;
                } catch (e) {}
            }

            const video = this.getVideoElement();
            if (video && video.textTracks) {
                for (let i = 0; i < video.textTracks.length; i++) {
                    if (video.textTracks[i].mode === 'showing') return i;
                }
            }
            return -1;
        }

        setSubtitleStreamIndex(index) {
            const pm = this.getPlaybackManager();
            const player = this.getActivePlayer();
            let success = false;

            if (pm && typeof pm.setSubtitleStreamIndex === 'function') {
                try {
                    pm.setSubtitleStreamIndex(index, player);
                    success = true;
                } catch (e) {}
            }

            if (!success && window.ApiClient && player) {
                try {
                    if (typeof window.ApiClient.setSubtitleStreamIndex === 'function') {
                        window.ApiClient.setSubtitleStreamIndex(player, index);
                        success = true;
                    }
                } catch (e) {}
            }

            const video = this.getVideoElement();
            if (video && video.textTracks && video.textTracks.length > 0) {
                try {
                    for (let i = 0; i < video.textTracks.length; i++) {
                        video.textTracks[i].mode = (i === index) ? 'showing' : 'disabled';
                    }
                    success = true;
                } catch (e) {}
            }

            return success;
        }

        async getUserPreferredLanguage() {
            if (this.cachedPreferredLanguage) return this.cachedPreferredLanguage;
            if (window.ApiClient && typeof window.ApiClient.getCurrentUser === 'function') {
                try {
                    const user = await window.ApiClient.getCurrentUser();
                    if (user && user.Configuration && user.Configuration.SubtitleLanguagePreference) {
                        this.cachedPreferredLanguage = user.Configuration.SubtitleLanguagePreference;
                        return this.cachedPreferredLanguage;
                    }
                } catch (e) {}
            }
            return '';
        }

        on(eventName, callback) {
            if (!this.eventListeners.has(eventName)) {
                this.eventListeners.set(eventName, new Set());
            }
            this.eventListeners.get(eventName).add(callback);
            return () => this.off(eventName, callback);
        }

        off(eventName, callback) {
            if (this.eventListeners.has(eventName)) {
                this.eventListeners.get(eventName).delete(callback);
            }
        }

        emit(eventName, data) {
            if (this.eventListeners.has(eventName)) {
                for (const cb of this.eventListeners.get(eventName)) {
                    try { cb(data); } catch (err) {}
                }
            }
        }
    }

    // 4. CORE ORCHESTRATOR & STATE MACHINE
    class SubtitleRewindPlugin {
        constructor(adapter, settingsManager) {
            this.adapter = adapter;
            this.settingsManager = settingsManager;

            this.isActive = false;
            this.baselineSubtitleIndex = -1;
            this.activeSubtitleIndex = -1;
            this.initialResumeSpot = 0;
            this.targetExpiryPosition = 0;
            this.preRewindPosition = 0;
            this.lastPlaybackPosition = 0;
            this.lastSkipDetectedTime = 0;
            this.isScrubbing = false;
            this.isPluginAction = false;

            this.init();
        }

        init() {
            this.bindInputListeners();
            this.bindPlaybackEvents();
            this.bindScrubbingListeners();
        }

        log(...args) {
            if (this.settingsManager.get().debugLogging) {
                console.log('[SubtitleRewind]', ...args);
            }
        }

        bindInputListeners() {
            document.addEventListener('keydown', (e) => {
                const target = e.target;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                    return;
                }
                if (e.key === 'ArrowLeft' || e.code === 'ArrowLeft' || e.code === 'KeyJ' || e.key === 'MediaTrackPrevious') {
                    this.recordDiscreteSkipTrigger();
                }
            }, true);

            document.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest(
                    'button.btnRewind, button[data-action="rewind"], button.skip-backward, button[title*="rewind" i], button[aria-label*="rewind" i], button[aria-label*="skip back" i]'
                );
                if (btn) this.recordDiscreteSkipTrigger();
            }, true);

            if ('mediaSession' in navigator) {
                try {
                    navigator.mediaSession.setActionHandler('seekbackward', () => {
                        this.recordDiscreteSkipTrigger();
                    });
                } catch (err) {}
            }
        }

        bindScrubbingListeners() {
            const scrubStart = (e) => {
                const slider = e.target.closest && e.target.closest(
                    'input[type="range"], .slider, .mdl-slider, .osdTimelineSlider, .sliderMarker, .timelineScroller'
                );
                if (slider) {
                    this.isScrubbing = true;
                    this.log('Timeline scrubbing started - auto-sub disabled');
                }
            };

            const scrubEnd = () => {
                if (this.isScrubbing) {
                    setTimeout(() => {
                        this.isScrubbing = false;
                        this.log('Timeline scrubbing ended');
                    }, 150);
                }
            };

            document.addEventListener('mousedown', scrubStart, true);
            document.addEventListener('touchstart', scrubStart, true);
            document.addEventListener('pointerdown', scrubStart, true);

            document.addEventListener('mouseup', scrubEnd, true);
            document.addEventListener('touchend', scrubEnd, true);
            document.addEventListener('pointerup', scrubEnd, true);
            document.addEventListener('change', scrubEnd, true);
        }

        recordDiscreteSkipTrigger() {
            this.lastSkipDetectedTime = Date.now();
            this.preRewindPosition = this.adapter.getCurrentTime();
            this.log('Discrete skip registered at playback position:', this.preRewindPosition);
        }

        bindPlaybackEvents() {
            this.adapter.on('timeupdate', (data) => {
                this.handleTimeUpdate(data.currentTime);
            });

            this.adapter.on('seeking', (data) => {
                this.handleSeeking(data.currentTime);
            });

            this.adapter.on('subtitlestreamchange', (data) => {
                this.handleSubtitleChange(data.index);
            });

            this.adapter.on('ended', () => this.resetState());
            this.adapter.on('playbackstop', () => this.resetState());
        }

        handleSeeking(newPos) {
            const settings = this.settingsManager.get();
            if (!settings.enabled) return;

            if (this.isScrubbing) {
                this.log('Ignoring seek due to timeline scrubbing (FR-01)');
                this.lastPlaybackPosition = newPos;
                return;
            }

            const oldPos = this.preRewindPosition || this.lastPlaybackPosition;
            const rewindDelta = oldPos - newPos;

            if (rewindDelta <= 0.5) {
                this.preRewindPosition = newPos;
                this.lastPlaybackPosition = newPos;
                return;
            }

            const isRecentDiscreteInput = (Date.now() - this.lastSkipDetectedTime) < 800;
            const isDiscreteDelta = (rewindDelta >= 4 && rewindDelta <= 35) || isRecentDiscreteInput;

            if (!isDiscreteDelta && !isRecentDiscreteInput) {
                this.log('Ignoring seek: not discrete skip (delta:', rewindDelta, ')');
                this.preRewindPosition = newPos;
                this.lastPlaybackPosition = newPos;
                return;
            }

            const rewindCap = settings.rewindCapSeconds;
            if (rewindDelta > rewindCap) {
                this.log(`Rewind of ${rewindDelta.toFixed(1)}s exceeds cap of ${rewindCap}s - ignored`);
                this.preRewindPosition = newPos;
                this.lastPlaybackPosition = newPos;
                return;
            }

            this.log(`Eligible skip-back detected! Rewind delta: ${rewindDelta.toFixed(1)}s`);
            this.processRewindTrigger(newPos);

            this.preRewindPosition = newPos;
            this.lastPlaybackPosition = newPos;
        }

        async processRewindTrigger(resumePosition) {
            const settings = this.settingsManager.get();
            const currentSubIndex = this.adapter.getSubtitleStreamIndex();

            if (this.isActive) {
                this.log('Subsequent rewind while active - maintaining locked expiration anchor at:', this.targetExpiryPosition);
                return;
            }

            if (currentSubIndex !== -1 && currentSubIndex !== null && currentSubIndex !== undefined) {
                this.log('Subtitles already active (index:', currentSubIndex, ') - remaining idle per PRD 4.2');
                return;
            }

            this.baselineSubtitleIndex = -1;

            const streams = this.adapter.getMediaStreams();
            const activeAudio = this.adapter.getActiveAudioStream();
            const preferredLang = settings.preferredLanguage || await this.adapter.getUserPreferredLanguage();

            const bestTrack = selectBestSubtitleTrack(streams, {
                preferredLanguage: preferredLang,
                activeAudioLanguage: activeAudio ? (activeAudio.Language || activeAudio.LanguageCode) : '',
                prioritizeText: settings.prioritizeTextOverBitmap,
                allowSDH: settings.allowSDH
            });

            if (!bestTrack) {
                this.log('No eligible subtitle track found - failing silently per FR-05');
                return;
            }

            this.log(`Activating track: [Index ${bestTrack.Index}] ${bestTrack.DisplayTitle || bestTrack.Title || bestTrack.Language} (${bestTrack.Codec})`);

            this.isPluginAction = true;
            let activated = false;
            try {
                activated = this.adapter.setSubtitleStreamIndex(bestTrack.Index);
            } finally {
                this.isPluginAction = false;
            }

            if (!activated) return;

            this.isActive = true;
            this.activeSubtitleIndex = bestTrack.Index;
            this.initialResumeSpot = resumePosition;
            this.targetExpiryPosition = resumePosition + settings.displayDurationSeconds;

            this.log(`Auto-subtitles armed until media position ${this.targetExpiryPosition.toFixed(1)}s (${settings.displayDurationSeconds}s duration)`);
        }

        handleTimeUpdate(currentPos) {
            if (!this.isActive) {
                this.lastPlaybackPosition = currentPos;
                return;
            }

            if (currentPos >= this.targetExpiryPosition) {
                this.log(`Display duration expired at media position ${currentPos.toFixed(1)}s. Reverting to Off.`);
                this.revertToBaseline();
            }

            this.lastPlaybackPosition = currentPos;
        }

        revertToBaseline() {
            if (!this.isActive) return;

            this.isPluginAction = true;
            try {
                this.adapter.setSubtitleStreamIndex(this.baselineSubtitleIndex);
            } finally {
                this.isPluginAction = false;
            }

            this.resetState();
        }

        handleSubtitleChange(newIndex) {
            if (this.isPluginAction) return;

            if (this.isActive && newIndex !== this.activeSubtitleIndex) {
                this.log(`Manual subtitle override detected (${newIndex}). Disarming auto-reversion.`);
                this.resetState();
            }
        }

        resetState() {
            this.isActive = false;
            this.activeSubtitleIndex = -1;
            this.targetExpiryPosition = 0;
            this.initialResumeSpot = 0;
            this.preRewindPosition = 0;
        }
    }

    // 5. INITIALIZATION & UI HOOKS
    const settingsManager = new SettingsManager();
    const adapter = new JellyfinAdapter();
    const plugin = new SubtitleRewindPlugin(adapter, settingsManager);

    window.JellyfinSubtitleRewind = {
        version: '1.0.0',
        plugin,
        adapter,
        settingsManager,
        selectBestSubtitleTrack,
        scoreSubtitleStream,
        openSettings: () => settingsManager.openSettingsModal()
    };

    console.log('[SubtitleRewind] Plugin loaded successfully (v1.0.0). Press Alt+S for settings.');

    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            settingsManager.openSettingsModal();
        }
    });

    function tryInjectSettingsButton() {
        if (document.getElementById('sr-header-btn')) return;
        const headerRight = document.querySelector('.headerRight') ||
                            document.querySelector('.headerButtons') ||
                            document.querySelector('.viewSettingsMenu');
        if (headerRight) {
            const btn = document.createElement('button');
            btn.id = 'sr-header-btn';
            btn.className = 'headerButton paper-icon-button-light';
            btn.title = 'Subtitle Rewind Settings (Alt+S)';
            btn.setAttribute('aria-label', 'Subtitle Rewind Settings');
            btn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 6px; background: transparent; border: none; color: inherit; font-size: 1.1rem;';
            btn.innerHTML = '⏪💬';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsManager.openSettingsModal();
            });
            headerRight.prepend(btn);
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(tryInjectSettingsButton, 1500);
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryInjectSettingsButton, 1500));
    }

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
