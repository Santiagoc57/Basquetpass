import React, { useState } from 'react';
import { Youtube, Upload, FileVideo, X } from 'lucide-react';

export default function MediaInput({ onProcess, isProcessing }) {
    const [mode, setMode] = useState('url'); // 'url' | 'file'
    const [url, setUrl] = useState('');
    const [file, setFile] = useState(null);
    const [basketMaxShots, setBasketMaxShots] = useState(4);
    const [basketPreSeconds, setBasketPreSeconds] = useState(4);
    const [basketPostSeconds, setBasketPostSeconds] = useState(6);

    const handleSubmit = (e) => {
        e.preventDefault();
        const options = {
            basketMaxShots: Math.max(1, parseInt(basketMaxShots, 10) || 4),
            basketPreSeconds: Math.max(0.5, parseFloat(basketPreSeconds) || 4),
            basketPostSeconds: Math.max(0.5, parseFloat(basketPostSeconds) || 6),
        };

        if (mode === 'url' && url) {
            onProcess({ type: 'url', payload: url, options });
        } else if (mode === 'file' && file) {
            onProcess({ type: 'file', payload: file, options });
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setFile(e.dataTransfer.files[0]);
            setMode('file');
        }
    };

    return (
        <div className="bg-surface border border-white/5 rounded-2xl p-6 animate-[fadeIn_0.6s_ease-out]">
            <div className="flex gap-4 mb-6 border-b border-white/5 pb-4">
                <button
                    onClick={() => setMode('url')}
                    className={`flex items-center gap-2 pb-2 px-2 transition-all ${mode === 'url'
                        ? 'text-primary border-b-2 border-primary -mb-[17px]'
                        : 'text-zinc-400 hover:text-white'
                        }`}
                >
                    <Youtube size={18} />
                    YouTube URL
                </button>
                <button
                    onClick={() => setMode('file')}
                    className={`flex items-center gap-2 pb-2 px-2 transition-all ${mode === 'file'
                        ? 'text-primary border-b-2 border-primary -mb-[17px]'
                        : 'text-zinc-400 hover:text-white'
                        }`}
                >
                    <Upload size={18} />
                    Upload File
                </button>
            </div>

            <form onSubmit={handleSubmit}>
                {mode === 'url' ? (
                    <div className="space-y-4 mb-5">
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://www.youtube.com/watch?v=..."
                            className="input-field"
                            required
                        />
                    </div>
                ) : (
                    <div
                        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${file ? 'border-primary/50 bg-primary/5' : 'border-zinc-700 hover:border-zinc-500 bg-white/5'
                            }`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                    >
                        {file ? (
                            <div className="flex items-center justify-center gap-3 text-white">
                                <FileVideo className="text-primary" />
                                <span className="font-medium">{file.name}</span>
                                <button
                                    type="button"
                                    onClick={() => setFile(null)}
                                    className="p-1 hover:bg-white/10 rounded-full"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer block">
                                <input
                                    type="file"
                                    accept="video/*"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    className="hidden"
                                />
                                <Upload className="mx-auto mb-3 text-zinc-500" size={24} />
                                <p className="text-zinc-400">Click to upload or drag and drop</p>
                                <p className="text-xs text-zinc-600 mt-1">MP4, MOV up to 500MB</p>
                            </label>
                        )}
                    </div>
                )}

                <div className="mt-5 p-4 rounded-xl border border-white/10 bg-black/20 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                        Basketball Clip Settings
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="text-left">
                            <div className="text-[11px] text-zinc-500 mb-1">Number of baskets</div>
                            <input
                                type="number"
                                min="1"
                                max="12"
                                step="1"
                                value={basketMaxShots}
                                onChange={(e) => setBasketMaxShots(e.target.value)}
                                className="input-field py-2 text-sm"
                            />
                        </label>
                        <label className="text-left">
                            <div className="text-[11px] text-zinc-500 mb-1">Seconds before</div>
                            <input
                                type="number"
                                min="0.5"
                                max="20"
                                step="0.5"
                                value={basketPreSeconds}
                                onChange={(e) => setBasketPreSeconds(e.target.value)}
                                className="input-field py-2 text-sm"
                            />
                        </label>
                        <label className="text-left">
                            <div className="text-[11px] text-zinc-500 mb-1">Seconds after</div>
                            <input
                                type="number"
                                min="0.5"
                                max="25"
                                step="0.5"
                                value={basketPostSeconds}
                                onChange={(e) => setBasketPostSeconds(e.target.value)}
                                className="input-field py-2 text-sm"
                            />
                        </label>
                    </div>
                    <div className="text-[11px] text-zinc-500">
                        Example: `4` baskets, `4s` before and `6s` after each detected play.
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isProcessing || (mode === 'url' && !url) || (mode === 'file' && !file)}
                    className="w-full btn-primary mt-6 flex items-center justify-center gap-2"
                >
                    {isProcessing ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Processing Video...
                        </>
                    ) : (
                        <>
                            Generate Clips
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}
