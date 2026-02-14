import React, { useState, useEffect } from 'react';
import { Upload, FileVideo, Sparkles, Youtube, Instagram, Share2, LogOut, ChevronDown, Check, Activity, LayoutDashboard, Settings, PlusCircle, History, Menu, X, Terminal, Shield, LayoutGrid, Search, SlidersHorizontal, Eye } from 'lucide-react';
import KeyInput from './components/KeyInput';
import MediaInput from './components/MediaInput';
import ResultCard from './components/ResultCard';
import ProcessingAnimation from './components/ProcessingAnimation';
// import Gallery from './components/Gallery';
import { apiFetch, getApiBaseUrl, normalizeApiBaseUrl, setApiBaseUrl } from './config';

// Enhanced "Encryption" using XOR + Base64 with a Salt
// This is better than plain Base64 but still client-side.
const SECRET_KEY = import.meta.env.VITE_ENCRYPTION_KEY || "OpenShorts-Static-Salt-Change-Me";
const ENCRYPTION_PREFIX = "ENC:";

const encrypt = (text) => {
  if (!text) return '';
  try {
    const xor = text.split('').map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length))
    ).join('');
    return ENCRYPTION_PREFIX + btoa(xor);
  } catch (e) {
    console.error("Encryption failed", e);
    return text;
  }
};

const decrypt = (text) => {
  if (!text) return '';
  if (text.startsWith(ENCRYPTION_PREFIX)) {
    try {
      const raw = text.slice(ENCRYPTION_PREFIX.length);
      // Check if it's plain base64 or our custom XOR (simple try)
      const xor = atob(raw);
      const result = xor.split('').map((c, i) =>
        String.fromCharCode(c.charCodeAt(0) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length))
      ).join('');
      return result;
    } catch (e) {
      // Fallback if decryption fails (might be old plain text)
      return '';
    }
  }
  // Backward compatibility: If no prefix, assume old plain text (or return empty if you want to force re-login)
  // For migration: Return text as is, so it populates the field, and next save will encrypt it.
  return text;
};

// Simple TikTok icon sine Lucide might not have it or it varies
const TikTokIcon = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z" />
  </svg>
);

const UserProfileSelector = ({ profiles, selectedUserId, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!profiles || profiles.length === 0) return null;

  const selectedProfile = profiles.find(p => p.username === selectedUserId) || profiles[0];

  return (
    <div className="relative z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors min-w-[180px]"
      >
        <span className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-[10px] font-bold text-white">
            {selectedProfile?.username?.substring(0, 1).toUpperCase() || "U"}
          </div>
          <span className="font-medium text-slate-800 truncate max-w-[100px]">{selectedProfile?.username || "Select User"}</span>
        </span>
        <ChevronDown size={14} className={`text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {profiles.map((profile) => (
              <button
                key={profile.username}
                onClick={() => {
                  onSelect(profile.username);
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left group border-b border-slate-100 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center text-xs font-bold text-white border border-white/10 shrink-0">
                    {profile.username.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors truncate">
                      {profile.username}
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {/* Status indicators */}
                      <div className={`flex items-center gap-1 text-[10px] ${profile.connected.includes('tiktok') ? 'text-zinc-300' : 'text-zinc-600'}`}>
                        <TikTokIcon size={10} />
                      </div>
                      <div className={`flex items-center gap-1 text-[10px] ${profile.connected.includes('instagram') ? 'text-pink-400' : 'text-zinc-600'}`}>
                        <Instagram size={10} />
                      </div>
                      <div className={`flex items-center gap-1 text-[10px] ${profile.connected.includes('youtube') ? 'text-red-400' : 'text-zinc-600'}`}>
                        <Youtube size={10} />
                      </div>
                    </div>
                  </div>
                </div>
                {selectedUserId === profile.username && <Check size={14} className="text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Mock polling function
const pollJob = async (jobId) => {
  const res = await apiFetch(`/api/status/${jobId}`);
  if (!res.ok) throw new Error('Status check failed');
  return res.json();
};

function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_key') || '');
  // Social API State - Load encrypted or plain
  const [uploadPostKey, setUploadPostKey] = useState(() => {
    const stored = localStorage.getItem('uploadPostKey_v3');
    if (stored) return decrypt(stored);
    return '';
  });
  // ElevenLabs API State - Load encrypted
  const [elevenLabsKey, setElevenLabsKey] = useState(() => {
    const stored = localStorage.getItem('elevenLabsKey_v1');
    if (stored) return decrypt(stored);
    return '';
  });

  const [uploadUserId, setUploadUserId] = useState(() => localStorage.getItem('uploadUserId') || '');
  const [userProfiles, setUserProfiles] = useState([]); // List of {username, connected: []}
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, processing, complete, error
  const [results, setResults] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsVisible, setLogsVisible] = useState(true);
  const [processingMedia, setProcessingMedia] = useState(null);
  const [processStartedAt, setProcessStartedAt] = useState(null);
  const [resultsSearch, setResultsSearch] = useState('');
  const [selectedResultClipId, setSelectedResultClipId] = useState(null);
  const [showSelectedClipEditor, setShowSelectedClipEditor] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, settings
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(() => getApiBaseUrl() || '');
  const [apiBaseUrlActive, setApiBaseUrlActive] = useState(() => getApiBaseUrl() || '');
  const [apiBaseUrlMessage, setApiBaseUrlMessage] = useState('');
  const [apiBaseUrlMessageType, setApiBaseUrlMessageType] = useState('neutral');
  const [isTestingApiBaseUrl, setIsTestingApiBaseUrl] = useState(false);

  // Sync state for original video playback
  const [syncedTime, setSyncedTime] = useState(0);
  const [isSyncedPlaying, setIsSyncedPlaying] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);

  const handleClipPlay = (startTime) => {
    setSyncedTime(startTime);
    setIsSyncedPlaying(true);
    setSyncTrigger(prev => prev + 1);
  };

  const handleClipPause = () => {
    setIsSyncedPlaying(false);
  };

  useEffect(() => {
    // Encrypt Gemini Key too for consistency if desired, but user asked specifically about Social integration not saving well.
    // For now keeping gemini plain for compatibility unless requested.
    if (apiKey) localStorage.setItem('gemini_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (uploadPostKey) {
      localStorage.setItem('uploadPostKey_v3', encrypt(uploadPostKey));
    }
    if (uploadUserId) {
      localStorage.setItem('uploadUserId', uploadUserId);
    }
  }, [uploadPostKey, uploadUserId]);

  useEffect(() => {
    if (elevenLabsKey) {
      localStorage.setItem('elevenLabsKey_v1', encrypt(elevenLabsKey));
    }
  }, [elevenLabsKey]);

  useEffect(() => {
    if (uploadPostKey && userProfiles.length === 0) {
      fetchUserProfiles();
    }
  }, [uploadPostKey]);

  useEffect(() => {
    if (!results || !Array.isArray(results.clips) || results.clips.length === 0) {
      setSelectedResultClipId(null);
      return;
    }
    if (!selectedResultClipId) {
      const firstId = results.clips[0]?.video_url || `clip-0`;
      setSelectedResultClipId(firstId);
    }
  }, [results, selectedResultClipId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncApiBaseUrl = () => {
      const current = getApiBaseUrl() || '';
      setApiBaseUrlInput(current);
      setApiBaseUrlActive(current);
    };
    syncApiBaseUrl();
    window.addEventListener('openshorts-api-base-url-changed', syncApiBaseUrl);
    return () => window.removeEventListener('openshorts-api-base-url-changed', syncApiBaseUrl);
  }, []);

  useEffect(() => {
    let interval;
    if ((status === 'processing' || status === 'completed') && jobId) {
      interval = setInterval(async () => {
        try {
          const data = await pollJob(jobId);
          console.log("Job status:", data);

          // Update results if available (real-time)
          if (data.result) {
            setResults(data.result);
          }

          if (data.status === 'completed') {
            setStatus('complete');
            clearInterval(interval);
          } else if (data.status === 'failed') {
            setStatus('error');
            const errorMsg = data.error || (data.logs && data.logs.length > 0 ? data.logs[data.logs.length - 1] : "Process failed");
            setLogs(prev => [...prev, "Error: " + errorMsg]);
            clearInterval(interval);
          } else {
            // Update logs if available
            if (data.logs) setLogs(data.logs);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [status, jobId]);


  const fetchUserProfiles = async () => {
    if (!uploadPostKey) return;
    try {
      const res = await apiFetch('/api/social/user', {
        headers: { 'X-Upload-Post-Key': uploadPostKey }
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (data.profiles && data.profiles.length > 0) {
        setUserProfiles(data.profiles);
        // Auto select first if none selected
        if (!uploadUserId) {
          setUploadUserId(data.profiles[0].username);
        }
      } else {
        alert("No profiles found for this API Key.");
      }
    } catch (e) {
      alert("Error fetching User Profiles. Please check key.");
      console.error(e);
    }
  };

  const handleProcess = async (data) => {
    setStatus('processing');
    setLogs(["Starting process..."]);
    setResults(null);
    setProcessingMedia(data);
    setProcessStartedAt(Date.now());

    try {
      let body;
      const headers = {};
      if (apiKey) headers['X-Gemini-Key'] = apiKey;
      const opts = data.options || {};

      if (data.type === 'url') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({
          url: data.payload,
          basket_max_shots: opts.basketMaxShots,
          basket_pre_seconds: opts.basketPreSeconds,
          basket_post_seconds: opts.basketPostSeconds,
        });
      } else {
        const formData = new FormData();
        formData.append('file', data.payload);
        if (opts.basketMaxShots != null) formData.append('basket_max_shots', String(opts.basketMaxShots));
        if (opts.basketPreSeconds != null) formData.append('basket_pre_seconds', String(opts.basketPreSeconds));
        if (opts.basketPostSeconds != null) formData.append('basket_post_seconds', String(opts.basketPostSeconds));
        body = formData;
      }

      const res = await apiFetch('/api/process', {
        method: 'POST',
        headers: data.type === 'url' ? headers : (apiKey ? { 'X-Gemini-Key': apiKey } : {}),
        body
      });

      if (!res.ok) throw new Error(await res.text());
      const resData = await res.json();
      setJobId(resData.job_id);

    } catch (e) {
      setStatus('error');
      setLogs(l => [...l, `Error starting job: ${e.message}`]);
    }
  };

  const handleSaveApiBaseUrl = () => {
    const rawInput = String(apiBaseUrlInput || '').trim();
    const normalizedInput = normalizeApiBaseUrl(rawInput);
    if (rawInput && !normalizedInput) {
      setApiBaseUrlMessage('URL invalida. Usa un formato como https://xxxx.ngrok-free.app');
      setApiBaseUrlMessageType('error');
      return;
    }

    const normalized = setApiBaseUrl(apiBaseUrlInput);
    const effective = getApiBaseUrl() || '';
    setApiBaseUrlInput(effective);
    setApiBaseUrlActive(effective);

    if (normalized) {
      setApiBaseUrlMessage(`API remota guardada: ${normalized}`);
      setApiBaseUrlMessageType('success');
      setLogs((prev) => [...prev, `API remota activa: ${normalized}`]);
      return;
    }

    setApiBaseUrlMessage('Sin URL remota. Se usara backend local/proxy.');
    setApiBaseUrlMessageType('neutral');
    setLogs((prev) => [...prev, 'API remota desactivada.']);
  };

  const handleTestApiBaseUrl = async () => {
    const target = normalizeApiBaseUrl(apiBaseUrlInput || apiBaseUrlActive);
    if (!target) {
      setApiBaseUrlMessage('Pega una URL valida primero (ej: https://xxxx.ngrok-free.app).');
      setApiBaseUrlMessageType('neutral');
      return;
    }

    setIsTestingApiBaseUrl(true);
    setApiBaseUrlMessage(`Probando conexion a ${target} ...`);
    setApiBaseUrlMessageType('neutral');

    try {
      const res = await fetch(`${target}/docs`, {
        method: 'GET',
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (res.ok) {
        setApiBaseUrlMessage(`Conexion OK con ${target}`);
        setApiBaseUrlMessageType('success');
        return;
      }
      setApiBaseUrlMessage(`La URL respondio ${res.status}. Verifica que OpenShorts este corriendo en ese tunel.`);
      setApiBaseUrlMessageType('neutral');
    } catch (_) {
      setApiBaseUrlMessage('No se pudo conectar. En ngrok suele ser URL vencida/offline o tunel apuntando a otro servicio.');
      setApiBaseUrlMessageType('error');
    } finally {
      setIsTestingApiBaseUrl(false);
    }
  };

  const handleResetApiBaseUrl = () => {
    setApiBaseUrl('');
    const effective = getApiBaseUrl() || '';
    setApiBaseUrlInput(effective);
    setApiBaseUrlActive(effective);
    if (effective) {
      setApiBaseUrlMessage(`Se restauro la URL de entorno: ${effective}`);
      setApiBaseUrlMessageType('neutral');
      return;
    }
    setApiBaseUrlMessage('Restaurado a local/proxy (sin URL remota).');
    setApiBaseUrlMessageType('neutral');
  };

  const handleReset = () => {
    setStatus('idle');
    setJobId(null);
    setResults(null);
    setLogs([]);
    setProcessingMedia(null);
    setProcessStartedAt(null);
  };

  // --- UI Components ---

  const Sidebar = () => (
    <div className="w-20 lg:w-64 bg-white border-r border-slate-200 flex flex-col h-full shrink-0 transition-all duration-300">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-slate-200">
          <img src="/logo-openshorts.png" alt="Logo" className="w-full h-full object-cover" />
        </div>
        <span className="font-bold text-lg text-slate-900 hidden lg:block tracking-tight">OpenShorts Basket</span>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-2">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${activeTab === 'dashboard' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
        >
          <LayoutDashboard size={20} />
          <span className="font-medium hidden lg:block">Dashboard</span>
        </button>

        {/* <button
          onClick={() => setActiveTab('gallery')}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${activeTab === 'gallery' ? 'bg-primary/10 text-primary' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
        >
          <LayoutGrid size={20} />
          <span className="font-medium hidden lg:block">Gallery</span>
        </button> */}

        <button
          onClick={() => setActiveTab('settings')}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${activeTab === 'settings' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
        >
          <Settings size={20} />
          <span className="font-medium hidden lg:block">Settings</span>
        </button>
      </nav>

      <div className="p-4 border-t border-slate-200">
        <a
          href="https://github.com/mutonby/openshorts"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors group border border-slate-200"
        >
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
            <svg height="20" viewBox="0 0 16 16" version="1.1" width="20" aria-hidden="true"><path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
          </div>
          <div className="hidden lg:block overflow-hidden">
            <p className="text-sm font-bold text-slate-800 leading-none mb-0.5">Open Source</p>
            <p className="text-[10px] text-slate-500 group-hover:text-slate-700 transition-colors truncate">Free & Community Driven</p>
          </div>
        </a>
      </div>
    </div>
  );

  const processingSourceLabel = (() => {
    if (!processingMedia) return 'video.mp4';
    if (processingMedia.type === 'file') return processingMedia?.payload?.name || 'video.mp4';
    const raw = String(processingMedia?.payload || '').trim();
    if (!raw) return 'URL';
    return raw.length > 50 ? `${raw.slice(0, 50)}...` : raw;
  })();

  const targetClips = Math.max(1, Number(processingMedia?.options?.basketMaxShots || 4));
  const readyClips = Array.isArray(results?.clips) ? results.clips.length : 0;
  const uniqueEventLogs = Array.from(new Set(
    (logs || []).filter((line) => /detected.*(attempt|made|event|canasta)/i.test(String(line || '')))
  ));
  const detectedEvents = uniqueEventLogs.length;
  const hasScanStarted = (logs || []).some((line) => /detecting basketball events|analizando|scanning/i.test(String(line || '')));
  const hasRenderStarted = readyClips > 0 || (logs || []).some((line) => /saved metadata|render|clip/i.test(String(line || '')));

  let progressPercent = 10;
  if (hasScanStarted) progressPercent = 42;
  if (detectedEvents > 0) progressPercent = Math.max(progressPercent, 52 + Math.min(20, detectedEvents * 5));
  if (hasRenderStarted) {
    const renderRatio = Math.max(0, Math.min(1, readyClips / targetClips));
    progressPercent = Math.max(progressPercent, 72 + Math.round(renderRatio * 24));
  }
  if (status === 'complete') progressPercent = 100;
  if (status === 'error') progressPercent = Math.max(8, progressPercent - 5);

  const elapsedSeconds = processStartedAt ? Math.max(0, Math.floor((Date.now() - processStartedAt) / 1000)) : 0;
  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const ss = String(elapsedSeconds % 60).padStart(2, '0');

  const progressSteps = [
    { label: 'Cargando archivo', state: logs.length > 0 ? 'done' : 'active', hint: logs.length > 0 ? `Completado (${mm}:${ss})` : 'En progreso' },
    { label: 'Escaneando canastas', state: hasScanStarted ? (hasRenderStarted ? 'done' : 'active') : 'pending', hint: hasScanStarted ? 'Analizando fotogramas clave...' : 'Pendiente' },
    { label: 'Renderizando clips', state: hasRenderStarted ? 'active' : 'pending', hint: hasRenderStarted ? `${readyClips}/${targetClips} clips` : 'Pendiente' }
  ];

  const allResultClips = Array.isArray(results?.clips)
    ? results.clips.map((clip, originalIndex) => ({
      clip,
      originalIndex,
      id: clip?.video_url || `clip-${originalIndex}`
    }))
    : [];

  const normalizeSearchText = (val) => String(val || '').toLowerCase().trim();
  const query = normalizeSearchText(resultsSearch);

  const filteredResultClips = allResultClips.filter(({ clip, originalIndex }) => {
    if (!query) return true;
    const title = String(clip?.video_title_for_youtube_short || `Clip ${originalIndex + 1}`).toLowerCase();
    const evt = String(clip?.event_type || '').toLowerCase();
    const ratio = String(clip?.aspect_ratio || '').toLowerCase();
    return title.includes(query) || evt.includes(query) || ratio.includes(query);
  });

  const selectedResultEntry = filteredResultClips.find((entry) => entry.id === selectedResultClipId) || filteredResultClips[0] || null;
  const selectedResultClip = selectedResultEntry?.clip || null;
  const selectedResultIndex = Number.isFinite(selectedResultEntry?.originalIndex) ? selectedResultEntry.originalIndex : 0;
  const selectedResultVideoUrl = selectedResultClip?.video_url ? getApiUrl(selectedResultClip.video_url) : '';

  const formatClipDuration = (clip) => {
    const duration = Math.max(0, Number(clip?.end || 0) - Number(clip?.start || 0));
    if (!Number.isFinite(duration)) return '0s';
    if (duration < 60) return `${Math.round(duration)}s`;
    const mins = Math.floor(duration / 60);
    const secs = Math.round(duration % 60);
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  };

  useEffect(() => {
    if (!filteredResultClips.length) return;
    const exists = filteredResultClips.some((entry) => entry.id === selectedResultClipId);
    if (!exists) {
      setSelectedResultClipId(filteredResultClips[0].id);
    }
  }, [filteredResultClips, selectedResultClipId]);

  return (
    <div className="flex h-screen bg-background overflow-hidden selection:bg-primary/20">
      <Sidebar />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Background Gradients */}
        <div className="absolute inset-0 overflow-hidden -z-10 pointer-events-none">
          <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px]" />
          <div className="absolute -bottom-[15%] -left-[10%] w-[40%] h-[40%] bg-amber-200/50 rounded-full blur-[120px]" />
        </div>

        {/* Top Header */}
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-4">
            {status !== 'idle' && (
              <button
                onClick={handleReset}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
              >
                <PlusCircle size={16} />
                <span className="hidden sm:inline">New Project</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            {userProfiles.length > 0 && (
              <UserProfileSelector
                profiles={userProfiles}
                selectedUserId={uploadUserId}
                onSelect={setUploadUserId}
              />
            )}

            {!apiKey && (
              <span className="text-xs text-amber-700 bg-amber-100 px-3 py-1 rounded-full border border-amber-200">
                API Key Missing
              </span>
            )}
          </div>
        </header>

        {/* Main Workspace */}
        <div className="flex-1 overflow-hidden relative">

          {/* View: Settings */}
          {activeTab === 'settings' && (
            <div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto animate-[fadeIn_0.3s_ease-out]">
              <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold">Settings</h1>
                <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full text-[10px] text-green-400 font-medium flex items-center gap-2">
                  <Shield size={12} /> Privacy: keys only live in your browser (sent to backend just to process)
                </div>
              </div>
              <KeyInput onKeySet={setApiKey} savedKey={apiKey} />

              <div className="glass-panel p-6 mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Backend remoto (Colab / ngrok)</h2>
                  <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded text-zinc-500 uppercase tracking-wider">Recomendado</span>
                </div>
                <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
                  Pega aqui tu URL publica de Colab/ngrok para que el frontend mande todas las peticiones a ese backend.
                  Asi aprovechas GPU T4 en Colab sin cambiar comandos locales.
                </p>
                <div className="space-y-3">
                  <label className="block text-sm text-zinc-400">URL API remota</label>
                  <input
                    type="url"
                    value={apiBaseUrlInput}
                    onChange={(e) => setApiBaseUrlInput(e.target.value)}
                    className="input-field"
                    placeholder="https://62cb-34-168-226-133.ngrok-free.app"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSaveApiBaseUrl}
                      className="btn-primary py-2 px-4 text-sm"
                    >
                      Guardar URL
                    </button>
                    <button
                      type="button"
                      onClick={handleTestApiBaseUrl}
                      disabled={isTestingApiBaseUrl}
                      className="py-2 px-4 text-sm rounded-lg border border-white/15 text-zinc-300 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isTestingApiBaseUrl ? 'Probando...' : 'Probar conexion'}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetApiBaseUrl}
                      className="py-2 px-4 text-sm rounded-lg border border-white/15 text-zinc-300 hover:bg-white/5"
                    >
                      Volver a local
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    {apiBaseUrlActive ? `Activa ahora: ${apiBaseUrlActive}` : 'Activa ahora: local/proxy'}
                  </p>
                  {apiBaseUrlMessage && (
                    <p className={`text-[11px] ${
                      apiBaseUrlMessageType === 'success'
                        ? 'text-emerald-400'
                        : apiBaseUrlMessageType === 'error'
                          ? 'text-rose-400'
                          : 'text-zinc-500'
                    }`}>
                      {apiBaseUrlMessage}
                    </p>
                  )}
                </div>
              </div>

              <div className="glass-panel p-6 mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Social Integration</h2>
                  <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded text-zinc-500 uppercase tracking-wider">Optional</span>
                </div>
                <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
                  Automatically publish your clips to TikTok, Instagram Reels, and YouTube Shorts via <strong>Upload-Post</strong>.
                  Includes a <strong>free tier</strong> (no credit card required).
                  If you prefer, you can skip this and manually download/upload your videos.
                </p>
                <div className="space-y-4">
                  <label className="block text-sm text-zinc-400">Upload-Post API Key</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={uploadPostKey}
                      onChange={(e) => setUploadPostKey(e.target.value)}
                      className="input-field"
                      placeholder="ey..."
                    />
                    <button onClick={fetchUserProfiles} className="btn-primary py-2 px-4 text-sm">
                      Connect
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Connect your Upload-Post account to enable one-click publishing.
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <a href="https://app.upload-post.com/login" target="_blank" rel="noopener noreferrer" className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1">
                        <span className="text-zinc-400 font-medium">1. Login</span>
                        <span className="text-[10px] text-zinc-600">Register account</span>
                      </a>
                      <a href="https://app.upload-post.com/manage-users" target="_blank" rel="noopener noreferrer" className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1">
                        <span className="text-zinc-400 font-medium">2. Profiles</span>
                        <span className="text-[10px] text-zinc-600">Create & Connect</span>
                      </a>
                      <a href="https://app.upload-post.com/api-keys" target="_blank" rel="noopener noreferrer" className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1">
                        <span className="text-zinc-400 font-medium">3. API Key</span>
                        <span className="text-[10px] text-zinc-600">Generate key</span>
                      </a>
                    </div>
                    <br />
                    <span className="text-zinc-600 italic">
                      Keys are only stored in your browser. They are sent to the backend only to process your request, never stored server-side.
                    </span>
                  </p>
                </div>
              </div>

              <div className="glass-panel p-6 mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Video Translation</h2>
                  <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded text-zinc-500 uppercase tracking-wider">Optional</span>
                </div>
                <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
                  Translate your clips to different languages using <strong>ElevenLabs</strong> AI dubbing.
                  Automatically translates speech while preserving the original voice characteristics.
                </p>
                <div className="space-y-4">
                  <label className="block text-sm text-zinc-400">ElevenLabs API Key</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={elevenLabsKey}
                      onChange={(e) => setElevenLabsKey(e.target.value)}
                      className="input-field"
                      placeholder="sk_..."
                    />
                    <button
                      onClick={() => {
                        if (elevenLabsKey) {
                          localStorage.setItem('elevenLabsKey_v1', encrypt(elevenLabsKey));
                          alert('ElevenLabs API Key saved!');
                        }
                      }}
                      className="btn-primary py-2 px-4 text-sm"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Get your API key from ElevenLabs to enable video translation.
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <a href="https://elevenlabs.io/sign-up" target="_blank" rel="noopener noreferrer" className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1">
                        <span className="text-zinc-400 font-medium">1. Sign Up</span>
                        <span className="text-[10px] text-zinc-600">Create account</span>
                      </a>
                      <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer" className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1">
                        <span className="text-zinc-400 font-medium">2. API Key</span>
                        <span className="text-[10px] text-zinc-600">Generate key</span>
                      </a>
                    </div>
                    <br />
                    <span className="text-zinc-600 italic">
                      Keys are only stored in your browser. They are sent to the backend only to process your request, never stored server-side.
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* View: Gallery */}
          {/* {activeTab === 'gallery' && (
            <Gallery />
          )} */}

          {/* View: Dashboard (Idle) */}
          {activeTab === 'dashboard' && status === 'idle' && (
            <div className="h-full overflow-y-auto px-6 pb-8 animate-[fadeIn_0.3s_ease-out]">
              <div className="max-w-6xl mx-auto pt-6 space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-bold text-slate-900">Nueva Extracción</h1>
                    <p className="text-slate-500 text-sm mt-1">Configura y genera clips automáticos de tus partidos.</p>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm text-xs text-slate-600">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Sistema listo
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <MediaInput onProcess={handleProcess} isProcessing={status === 'processing'} variant="light" />

                    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                      <h3 className="text-sm font-bold text-slate-800 mb-3">Canales objetivo</h3>
                      <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                        <span className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"><Youtube size={16} /> YouTube</span>
                        <span className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"><Instagram size={16} /> Instagram</span>
                        <span className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"><TikTokIcon size={16} /> TikTok</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Estado del Trabajo</h4>
                      <div className="flex items-center gap-3">
                        <div className="relative flex items-center justify-center w-10 h-10">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-20"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">Listo para empezar</p>
                          <p className="text-xs text-slate-500">Esperando configuración...</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col min-h-[280px]">
                      <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
                        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                          <Terminal size={14} className="text-slate-400" /> Panel de Logs
                        </h4>
                        <button
                          onClick={() => setLogsVisible(!logsVisible)}
                          className="text-slate-500 hover:text-slate-700 transition-colors"
                          title={logsVisible ? 'Ocultar logs' : 'Mostrar logs'}
                        >
                          <ChevronDown size={14} className={logsVisible ? '' : 'rotate-180'} />
                        </button>
                      </div>
                      {logsVisible && (
                        <div className="p-5 flex-1 bg-slate-50 rounded-b-2xl overflow-y-auto relative font-mono text-sm custom-scrollbar">
                          {logs.length === 0 ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 opacity-70">
                              <Terminal size={28} className="text-slate-300 mb-2" />
                              <p className="text-slate-400">Los registros de procesamiento aparecerán aquí</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {logs.slice(-20).map((log, i) => (
                                <div key={i} className="text-xs text-slate-600">{log}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View: Processing */}
          {activeTab === 'dashboard' && status === 'processing' && (
            <div className="h-full overflow-y-auto px-6 py-6 animate-[fadeIn_0.3s_ease-out]">
              <div className="max-w-7xl mx-auto">
                <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-1">Procesando Video</h1>
                    <p className="text-slate-500 text-sm flex items-center gap-2">
                      <FileVideo size={14} />
                      {processingSourceLabel}
                    </p>
                  </div>
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 text-sm font-medium text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors bg-white"
                  >
                    Cancelar Proceso
                  </button>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[640px]">
                  <div className="lg:col-span-8 flex flex-col">
                    <div className="relative w-full h-full bg-black rounded-xl overflow-hidden shadow-lg border border-slate-200">
                      {processingMedia && (
                        <ProcessingAnimation
                          media={processingMedia}
                          isComplete={false}
                          syncedTime={syncedTime}
                          isSyncedPlaying={isSyncedPlaying}
                          syncTrigger={syncTrigger}
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
                        <div className="w-20 h-20 rounded-full border-4 border-primary/30 flex items-center justify-center mb-6 relative bg-black/30 backdrop-blur-sm">
                          <Activity size={36} className="text-primary animate-pulse" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2 tracking-wide">Analizando jugadas...</h2>
                        <p className="text-slate-200 max-w-md text-sm">Nuestro sistema esta identificando canastas, tiros y eventos clave en tu video.</p>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-4 flex flex-col gap-5 h-full overflow-y-auto pr-1">
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-slate-800">Estado General</h3>
                        <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded">~2 MIN</span>
                      </div>
                      <div className="flex items-center gap-5">
                        <div className="relative w-20 h-20 shrink-0">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <path className="text-slate-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3"></path>
                            <path className="text-primary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray={`${Math.max(6, Math.min(100, progressPercent))}, 100`} strokeWidth="3"></path>
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xl font-bold text-primary">{progressPercent}%</span>
                          </div>
                        </div>
                        <div className="flex-1 space-y-2.5 text-sm">
                          <div className="flex justify-between"><span className="text-slate-500">Tiempo</span><span className="font-medium text-slate-800">{mm}:{ss}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Objetivo</span><span className="font-medium text-slate-800">{targetClips} clips</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Eventos</span><span className="font-medium text-primary">{detectedEvents} detectados</span></div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                      <h3 className="text-lg font-semibold text-slate-800 mb-5">Progreso</h3>
                      <div className="relative pl-4 border-l-2 border-slate-200 space-y-6">
                        {progressSteps.map((step, idx) => (
                          <div className="relative" key={`${step.label}-${idx}`}>
                            <div className={`absolute -left-[21px] h-5 w-5 rounded-full border-2 border-white flex items-center justify-center ${
                              step.state === 'done' ? 'bg-emerald-500' : step.state === 'active' ? 'bg-primary animate-pulse' : 'bg-slate-300'
                            }`}>
                              {step.state === 'done' ? (
                                <Check size={12} className="text-white" />
                              ) : (
                                <Activity size={10} className={step.state === 'active' ? 'text-white' : 'text-slate-500'} />
                              )}
                            </div>
                            <h4 className={`text-sm font-semibold ${step.state === 'active' ? 'text-primary' : 'text-slate-800'}`}>{step.label}</h4>
                            <p className="text-xs text-slate-400 mt-0.5">{step.hint}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-0 shadow-sm border border-slate-200 flex-grow flex flex-col overflow-hidden min-h-[250px]">
                      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          Panel de Deteccion
                        </h3>
                        <span className="text-xs text-slate-400">Live Feed</span>
                      </div>
                      <div className="overflow-y-auto p-4 space-y-2.5 flex-grow custom-scrollbar">
                        {(logs || []).slice(-40).map((line, idx) => {
                          const msg = String(line || '');
                          const lower = msg.toLowerCase();
                          const isError = lower.includes('error') || lower.includes('failed');
                          const isMade = lower.includes('made');
                          const isAttempt = lower.includes('attempt');
                          const tone = isError
                            ? 'bg-rose-50 border-rose-100 text-rose-700'
                            : isMade
                              ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                              : isAttempt
                                ? 'bg-blue-50 border-blue-100 text-blue-700'
                                : 'bg-slate-50 border-slate-200 text-slate-600';
                          return (
                            <div key={`log-${idx}`} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${tone}`}>
                              <span className="text-[11px] font-bold font-mono mt-0.5">{idx + 1}</span>
                              <p className="text-xs leading-relaxed break-words">{msg}</p>
                            </div>
                          );
                        })}
                        {(logs || []).length === 0 && (
                          <div className="text-xs text-slate-400">Esperando logs del backend...</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View: Results / Error */}
          {activeTab === 'dashboard' && (status === 'complete' || status === 'error') && (
            <div className="h-full flex overflow-hidden animate-[fadeIn_0.3s_ease-out]">
              <main className="flex-1 flex flex-col min-w-0 bg-white border-r border-slate-200 relative">
                <div className="p-4 border-b border-slate-200 bg-white sticky top-0 z-10">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-black text-slate-900 flex items-center gap-3 uppercase tracking-tight">
                      Resultados
                      <span className="text-primary text-xs font-black bg-primary/10 px-2 py-0.5 rounded-full">{allResultClips.length} clips</span>
                    </h2>
                    <div className="flex items-center gap-2">
                      {status === 'error' && (
                        <span className="text-[11px] text-rose-700 bg-rose-100 border border-rose-200 px-2 py-1 rounded-full font-semibold">
                          Error en procesamiento
                        </span>
                      )}
                      <button
                        onClick={handleReset}
                        className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        Nuevo
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                      <input
                        value={resultsSearch}
                        onChange={(e) => setResultsSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded text-sm text-slate-900 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder-slate-400 font-medium"
                        placeholder="Buscar clips, jugadores, jugadas..."
                      />
                    </div>
                    <button className="w-10 h-10 flex items-center justify-center border border-slate-200 rounded bg-slate-50 hover:bg-white transition-colors">
                      <SlidersHorizontal size={15} className="text-slate-500" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {filteredResultClips.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {filteredResultClips.map((entry, listIndex) => {
                        const clip = entry.clip;
                        const title = clip?.video_title_for_youtube_short || `${clip?.event_type === 'made' ? 'Canasta' : 'Jugada'} ${entry.originalIndex + 1}`;
                        const isSelected = selectedResultEntry?.id === entry.id;
                        const ratioLabel = clip?.aspect_ratio || '9:16';
                        return (
                          <button
                            key={entry.id}
                            onClick={() => setSelectedResultClipId(entry.id)}
                            className={`group relative text-left bg-slate-50 rounded border overflow-hidden cursor-pointer shadow-sm transition-all duration-300 ${
                              isSelected ? 'border-primary ring-1 ring-primary/25' : 'border-slate-200 hover:border-primary hover:shadow-md'
                            }`}
                          >
                            <div className="relative aspect-video bg-black">
                              <video
                                src={getApiUrl(clip.video_url)}
                                className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <div className="absolute bottom-2 right-2 flex gap-1">
                                <span className="bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">{ratioLabel}</span>
                                <span className="bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">ESP</span>
                              </div>
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                                <Eye size={28} className="text-white drop-shadow-lg" />
                              </div>
                            </div>
                            <div className="p-3 bg-white">
                              <h3 className={`text-sm font-bold line-clamp-1 uppercase tracking-tight ${isSelected ? 'text-primary' : 'text-slate-800 group-hover:text-primary'}`}>
                                {title}
                              </h3>
                              <div className="flex justify-between items-center mt-2 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                <span>Clip {entry.originalIndex + 1}</span>
                                <span className="text-slate-700">{formatClipDuration(clip)}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
                      <p>{status === 'error' ? 'No se pudieron generar clips.' : 'No hay clips para mostrar.'}</p>
                    </div>
                  )}
                </div>
              </main>

              <aside className="w-96 lg:w-[480px] flex-shrink-0 bg-white flex flex-col border-l border-slate-200 h-full">
                <div className="h-14 border-b border-slate-200 flex items-center justify-between px-4 bg-white shrink-0">
                  <h2 className="font-black text-slate-900 uppercase tracking-tight">Panel de Visualizacion</h2>
                  <button
                    onClick={() => setShowSelectedClipEditor((v) => !v)}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 px-2.5 py-1 rounded-md"
                  >
                    {showSelectedClipEditor ? 'Ocultar editor' : 'Abrir editor'}
                  </button>
                </div>

                <div className="bg-black relative aspect-video flex flex-col justify-between group overflow-hidden">
                  {selectedResultClip ? (
                    <video
                      key={selectedResultEntry?.id}
                      src={selectedResultVideoUrl}
                      className="w-full h-full object-cover"
                      controls
                      playsInline
                      onPlay={(e) => {
                        const t = e.currentTarget?.currentTime || 0;
                        handleClipPlay((Number(selectedResultClip?.start || 0) + Number(t || 0)));
                      }}
                      onPause={handleClipPause}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm">Sin clip seleccionado</div>
                  )}
                </div>

                <div className="flex-1 bg-slate-50 flex flex-col min-h-0">
                  <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-white">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                      Lista de Reproduccion <span className="text-primary">({filteredResultClips.length})</span>
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                    {filteredResultClips.map((entry, idx) => {
                      const clip = entry.clip;
                      const isSelected = selectedResultEntry?.id === entry.id;
                      const title = clip?.video_title_for_youtube_short || `${clip?.event_type === 'made' ? 'Canasta' : 'Jugada'} ${entry.originalIndex + 1}`;
                      return (
                        <button
                          key={`playlist-${entry.id}`}
                          onClick={() => setSelectedResultClipId(entry.id)}
                          className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all shadow-sm border ${
                            isSelected ? 'bg-white border-primary' : 'bg-white border-slate-200 hover:border-primary/50'
                          }`}
                        >
                          <div className="relative w-28 aspect-video bg-black rounded overflow-hidden flex-shrink-0">
                            <video
                              src={getApiUrl(clip.video_url)}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                            />
                            <span className="absolute bottom-1 right-1 bg-black/80 text-[9px] text-white px-1.5 rounded font-bold">{formatClipDuration(clip)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className={`text-[11px] font-bold truncate uppercase tracking-tight ${isSelected ? 'text-primary' : 'text-slate-800'}`}>{title}</h4>
                            <p className="text-[9px] text-slate-500 mt-1 font-bold uppercase tracking-wider">Clip {entry.originalIndex + 1}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {showSelectedClipEditor && selectedResultClip && (
                    <div className="border-t border-slate-200 bg-white p-3 max-h-[58vh] overflow-y-auto custom-scrollbar">
                      <ResultCard
                        clip={selectedResultClip}
                        index={selectedResultIndex}
                        jobId={jobId}
                        uploadPostKey={uploadPostKey}
                        uploadUserId={uploadUserId}
                        geminiApiKey={apiKey}
                        elevenLabsKey={elevenLabsKey}
                        onPlay={(time) => handleClipPlay(time)}
                        onPause={handleClipPause}
                      />
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default App;
