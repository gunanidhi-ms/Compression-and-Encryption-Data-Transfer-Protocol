"use client";

import { useState, useRef, useEffect } from "react";

type Mode = "sender" | "receiver";

export default function Home() {
  const [mode, setMode] = useState<Mode>("sender");

  // ===== SENDER STATE =====
  const [files, setFiles] = useState<File[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const [senderPin, setSenderPin] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  // ===== RECEIVER STATE =====
  const [receiverLogs, setReceiverLogs] = useState<string[]>([]);
  const [isReceiving, setIsReceiving] = useState(false);
  const [receiverPinInput, setReceiverPinInput] = useState("");
  const [savePath, setSavePath] = useState("");
  const receiverLogEndRef = useRef<HTMLDivElement>(null);

  // ===== GENERATE PIN =====
  const generatePin = () => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    setSenderPin(pin);
  };

  useEffect(() => { generatePin(); }, []);

  // ===== SENDER HANDLERS =====
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setIsDragActive(true);
    else if (e.type === "dragleave") setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles(Array.from(e.dataTransfer.files));
      setLogs([]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(Array.from(e.target.files));
      setLogs([]);
    }
  };

  const startSenderProcess = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    setUploadProgress(10);
    setLogs(["🚀 Uploading files to secure environment..."]);

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));

      const uploadRes = await fetch("/api/upload-file", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("File upload failed.");

      const { rootPath } = await uploadRes.json();
      setUploadProgress(100);
      setLogs((prev) => [...prev, "✅ Upload complete.", ""]);

      const params = new URLSearchParams({
        filePath: rootPath,
        pinCode: senderPin,
      });

      const response = await fetch(`/api/stream-logs?${params}`);
      if (!response.body) throw new Error("ReadableStream not supported.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        setLogs((prev) => [...prev, ...text.split("\n")]);
      }
    } catch (error: any) {
      console.error(error);
      setLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  const stopSenderProcess = async () => {
    try {
      await fetch("/api/stop-sender", { method: "POST" });
      setLogs((prev) => [...prev, "🛑 Sender stopped and processes aborted."]);
      setIsProcessing(false);
      setUploadProgress(0);
    } catch (e) {
      console.error(e);
    }
  };

  // ===== RECEIVER HANDLERS =====
  const browseSaveFolder = async () => {
    if (isReceiving) return;
    try {
      const res = await fetch("/api/browse-folder");
      const data = await res.json();
      if (data.path) setSavePath(data.path);
    } catch (e) { console.error(e); }
  };

  const startReceiver = async () => {
    if (!receiverPinInput.trim() || receiverPinInput.length !== 6) {
      setReceiverLogs(["❌ Please enter the 6-digit PIN from the sender."]);
      return;
    }

    setIsReceiving(true);
    setReceiverLogs(["🔒 Initializing CETP WebRTC Receiver..."]);

    try {
      const params = new URLSearchParams({
        pin: receiverPinInput.trim(),
        savePath: savePath.trim(),
      });

      const response = await fetch(`/api/start-receiver?${params}`);
      if (!response.body) throw new Error("ReadableStream not supported.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);

        for (const line of text.split("\n")) {
          setReceiverLogs((prev) => [...prev, line]);
        }
      }
    } catch (error: any) {
      console.error(error);
      setReceiverLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
    } finally {
      setIsReceiving(false);
    }
  };

  const stopReceiver = async () => {
    try {
      await fetch("/api/stop-receiver", { method: "POST" });
      setReceiverLogs((prev) => [...prev, "📴 Receiver stopped."]);
      setIsReceiving(false);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => { receiverLogEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [receiverLogs]);

  // Log line color helper
  const logColor = (line: string) => {
    if (line.includes("Verification Code") || line.includes("🔐")) return "text-amber-400 font-bold";
    if (line.includes("ERROR") || line.includes("MALWARE") || line.includes("❌") || line.includes("mismatch") || line.includes("🚨")) return "text-red-400";
    if (line.includes("SUCCESS") || line.includes("✅") || line.includes("✔") || line.includes("VERDICT")) return "text-green-400";
    if (line.includes("⚠")) return "text-yellow-400";
    if (line.includes("━")) return "text-neutral-700";
    if (line.includes("🔍") || line.includes("🔒") || line.includes("HTTPS")) return "text-cyan-400";
    if (line.includes("🔑") || line.includes("PIN")) return "text-purple-400";
    return "text-neutral-400";
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-cyan-500/30">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20" />
            <h1 className="text-xl font-bold tracking-tight text-white">
              Secure<span className="text-indigo-400">Processor</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-mono">WebRTC</span>
            <span className="text-xs font-mono text-neutral-500">v5.0</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        {/* Intro */}
        <section className="space-y-4 text-center max-w-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            Analyze. Compress. Encrypt.
          </h2>
          <p className="text-neutral-400 text-lg">
            Military-grade encryption with WebRTC NAT traversal.
            <br />
            Secure transfer to any device across any network.
          </p>
        </section>

        {/* Mode Toggle */}
        <section className="flex justify-center">
          <div className="inline-flex rounded-2xl border border-neutral-800 bg-neutral-900/60 p-1.5 shadow-lg">
            <button
              onClick={() => setMode("sender")}
              className={`px-8 py-3 rounded-xl text-sm font-bold tracking-wide transition-all duration-300 ${mode === "sender"
                ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                SENDER
              </span>
            </button>
            <button
              onClick={() => setMode("receiver")}
              className={`px-8 py-3 rounded-xl text-sm font-bold tracking-wide transition-all duration-300 ${mode === "receiver"
                ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                RECEIVER
              </span>
            </button>
          </div>
        </section>

        {/* =========== SENDER MODE =========== */}
        {mode === "sender" && (
          <>
            {/* Step 1: Drag & Drop */}
            <section className="max-w-3xl mx-auto">
              <div
                className={`relative group rounded-2xl border-2 border-dashed transition-all duration-300 p-12 text-center
                  ${isDragActive ? "border-indigo-500 bg-indigo-500/10 scale-[1.02]" : "border-neutral-800 bg-neutral-900/30 hover:border-neutral-700"}
                  ${isProcessing ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                onClick={() => document.getElementById("fileInput")?.click()}
              >
                <input id="fileInput" type="file" multiple className="hidden" onChange={handleFileChange} disabled={isProcessing} />
                <div className="space-y-4 pointer-events-none">
                  <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center transition-colors ${isDragActive ? "bg-indigo-500/20 text-indigo-400" : "bg-neutral-800 text-neutral-500"}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {files.length > 0
                        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      }
                    </svg>
                  </div>
                  {files.length > 0 ? (
                    <div>
                      <p className="text-xl font-bold text-white">{files.length === 1 ? files[0].name : `${files.length} files selected`}</p>
                      <p className="text-sm text-neutral-400">{(files.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(2)} MB ready</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-lg font-medium text-neutral-200">Drag & drop your files here, or click to select</p>
                      <p className="text-sm text-neutral-500 mt-2">Supports single files, multiple files, and folders</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex justify-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const input = document.createElement("input");
                    input.type = "file";
                    // @ts-ignore
                    input.webkitdirectory = true;
                    input.multiple = true;
                    input.onchange = (ev: any) => {
                      if (ev.target.files?.length > 0) { setFiles(Array.from(ev.target.files)); setLogs([]); }
                    };
                    input.click();
                  }}
                  disabled={isProcessing}
                  className="text-sm text-neutral-500 hover:text-indigo-400 transition-colors flex items-center gap-2 border border-neutral-800 rounded-lg px-4 py-2 hover:border-indigo-500/50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Upload Entire Folder
                </button>
              </div>
            </section>

            {/* Step 2: Sharing PIN */}
            <section className="max-w-3xl mx-auto">
              <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/50 to-purple-950/30 p-8 text-center space-y-5">
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                  Your Sharing PIN — Share with Receiver
                </p>
                <div className="flex justify-center gap-3">
                  {senderPin.split("").map((digit, i) => (
                    <div key={i} className="w-14 h-16 rounded-xl bg-neutral-950 border-2 border-indigo-500/40 flex items-center justify-center text-3xl font-bold text-indigo-400 font-mono shadow-lg shadow-indigo-500/10">
                      {digit}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-neutral-500">
                  Share this PIN with the receiver. They&apos;ll enter it and the connection will be authenticated.
                </p>
                <button onClick={generatePin} disabled={isProcessing} className="text-xs text-neutral-500 hover:text-indigo-400 transition-colors border border-neutral-800 rounded-lg px-4 py-1.5 hover:border-indigo-500/50">
                  ↻ Generate New PIN
                </button>
              </div>
            </section>

            {/* Start / Stop Button */}
            <section className="max-w-3xl mx-auto flex justify-center">
              <button
                onClick={(e) => { e.stopPropagation(); isProcessing ? stopSenderProcess() : startSenderProcess(); }}
                disabled={!isProcessing && files.length === 0}
                className={`h-14 px-10 rounded-full font-bold text-sm tracking-wide transition-all shadow-xl flex items-center gap-3
                  ${(!isProcessing && files.length === 0)
                    ? "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700"
                    : isProcessing
                      ? "bg-red-600/20 border-2 border-red-500 text-red-400 hover:bg-red-600/30 hover:scale-105 active:scale-95 shadow-red-500/10"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 hover:scale-105 active:scale-95"}`}
              >
                {isProcessing ? (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    STOP SENDER
                  </>
                ) : (
                  <span>START SECURE PROTOCOL</span>
                )}
              </button>
            </section>

            {/* Sender Logs */}
            <section className="space-y-4 max-w-3xl mx-auto">
              <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2 px-1">
                <span className={`w-2 h-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-neutral-600"}`}></span>
                System Output
              </h3>
              <div className="relative rounded-xl overflow-hidden border border-neutral-800 bg-neutral-950 shadow-inner h-[400px] flex flex-col font-mono text-sm">
                <div className="absolute top-0 left-0 right-0 h-8 bg-neutral-900/80 backdrop-blur border-b border-neutral-800 flex items-center px-4 gap-2 z-10">
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-700"></div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 pt-12 space-y-1 scrollbar-hide">
                  {logs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-800 select-none"><p>Ready to engage terminal...</p></div>
                  ) : (
                    logs.map((line, i) => (
                      <div key={i} className={`${logColor(line)} break-words`}>
                        <span className="text-neutral-800 mr-3 select-none text-[10px]">{(i + 1).toString().padStart(3, "0")}</span>
                        {line}
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            </section>
          </>
        )}

        {/* =========== RECEIVER MODE =========== */}
        {mode === "receiver" && (
          <>
            <section className="max-w-3xl mx-auto space-y-6">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-6 space-y-6">
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Receiver Settings
                </h3>

                {/* PIN Input */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Enter Sender&apos;s 6-Digit PIN</label>
                  <div className="flex justify-start gap-2">
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                      <input key={idx} id={`pin-${idx}`} type="text" inputMode="numeric" maxLength={1}
                        value={receiverPinInput[idx] || ""} disabled={isReceiving}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          const newPin = receiverPinInput.split("");
                          newPin[idx] = val;
                          setReceiverPinInput(newPin.join("").slice(0, 6));
                          if (val && idx < 5) document.getElementById(`pin-${idx + 1}`)?.focus();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !receiverPinInput[idx] && idx > 0)
                            document.getElementById(`pin-${idx - 1}`)?.focus();
                        }}
                        className="w-12 h-14 rounded-xl bg-neutral-950 border-2 border-neutral-700 text-center text-2xl font-bold text-emerald-400 font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                      />
                    ))}
                  </div>
                </div>

                {/* Save Location */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Save Location</label>
                  <div onClick={browseSaveFolder}
                    className={`w-full bg-neutral-950 border border-neutral-700 rounded-xl px-4 py-3 text-sm flex items-center gap-3 transition-all ${isReceiving ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-emerald-500 hover:ring-1 hover:ring-emerald-500/30"}`}>
                    <svg className="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className={savePath ? "text-white" : "text-neutral-600"}>
                      {savePath || "Click to select folder..."}
                    </span>
                  </div>
                </div>

                {/* Start/Stop */}
                <div className="flex items-center gap-4">
                  <button onClick={isReceiving ? stopReceiver : startReceiver}
                    className={`h-12 px-8 rounded-xl font-bold text-sm tracking-wide transition-all flex items-center gap-2
                      ${isReceiving
                        ? "bg-red-600/20 border border-red-500/50 text-red-400 hover:bg-red-600/30"
                        : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/20 hover:scale-105 active:scale-95"}`}>
                    {isReceiving ? (
                      <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg> STOP RECEIVER</>
                    ) : (
                      <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> START RECEIVER</>
                    )}
                  </button>
                </div>
              </div>
            </section>

            {/* Receiver Logs */}
            <section className="space-y-4 max-w-3xl mx-auto">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isReceiving ? "bg-emerald-500 animate-pulse" : "bg-neutral-600"}`}></span>
                  Receiver Terminal
                </h3>
                {isReceiving && <span className="text-xs font-mono text-emerald-400 animate-pulse">● LISTENING</span>}
              </div>
              <div className="relative rounded-xl overflow-hidden border border-neutral-800 bg-neutral-950 shadow-inner h-[400px] flex flex-col font-mono text-sm">
                <div className="absolute top-0 left-0 right-0 h-8 bg-neutral-900/80 backdrop-blur border-b border-neutral-800 flex items-center px-4 gap-2 z-10">
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-neutral-700"></div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 pt-12 space-y-1 scrollbar-hide">
                  {receiverLogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-800 select-none"><p>Enter PIN and click &quot;Start Receiver&quot; to begin listening...</p></div>
                  ) : (
                    receiverLogs.map((line, i) => (
                      <div key={i} className={`${logColor(line)} break-words`}>
                        <span className="text-neutral-800 mr-3 select-none text-[10px]">{(i + 1).toString().padStart(3, "0")}</span>
                        {line}
                      </div>
                    ))
                  )}
                  <div ref={receiverLogEndRef} />
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
