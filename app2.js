"use strict";

class RequestManager {
    constructor(main) {
        this.maxRetries         = 3;
        this.retryDelay         = 1000;      // ms
        this.timeoutMs          = 60000;    // ms
        this.deferWhenHidden    = false;
        this.maxHiddenDeferMs   = 4000;
        this.appCTRL            = {
            baseURL : "https://absensiburuhtaling.dlhpambon2025.workers.dev/"
        };
        this.baseURL            = (typeof STATIC !== "undefined" && STATIC.URL) ? STATIC.URL : "https://absensiburuhtaling.dlhpambon2025.workers.dev/";
        var self = this;
        if (!Object.getOwnPropertyDescriptor(this, "URL")) {
            Object.defineProperty(this, "URL", {
                enumerable   : true,
                configurable : false,
                get          : function () {
                    var raw = (self.appCTRL && self.appCTRL.baseURL) ? self.appCTRL.baseURL : self.baseURL;
                    return self._normalizeBaseURL(raw);
                }
            });
        }
    }

    // ====== PUBLIC ======
    async isOnline() {
        return await this.appCTRL.connect.isOnLine();
    }

    _log() { 
        try { 
            var args = Array.prototype.slice.call(arguments);
            console.log.apply(console, ["[RequestManager]"].concat(args)); 
        } catch(_) {}
    }

    async post(pathOrData, dataArg, optionsArg) {
        var path = "", data = {}, options = {};
        if (typeof pathOrData === "string") {
            path = pathOrData || "";
            data = dataArg || {};
            options = optionsArg || {};
        } else {
            data = pathOrData || {};
            options = dataArg || {};
        }

        var base = this._requireBaseURL();                 // <- perbaikan utama
        var url  = this._joinURL(base, path);
        var isOnLine = true //await this.isOnline()
        if (!isOnLine) {
            var offlineRes = this._makeResult(false, "OFFLINE", null, {
                code: "OFFLINE",
                message: "Tidak ada koneksi internet."
            }, url, 0, 0, false);
            this._log("📴 OFFLINE:", offlineRes);
            this._safeToast("error", "Perangkat sedang offline!");
            return offlineRes;
        }
        this._log("Sending Request")

        if (this.deferWhenHidden && typeof document !== "undefined" && document.hidden) {
            this._log("⏸️ Menunda POST karena tab hidden");
            await this._waitUntilVisible(this.maxHiddenDeferMs);
        }

        var requestId = this._makeUUID();
        var headers = Object.assign({
            "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
            "Idempotency-Key": requestId
        }, options.headers || {});

        var body = null;
        var isFormData = (typeof FormData !== "undefined") && (data instanceof FormData);
        if (isFormData) {
            body = data;
            delete headers["Content-Type"];
        } else {
            headers["Content-Type"] = headers["Content-Type"] || "application/json";
            body = headers["Content-Type"].indexOf("application/json") >= 0 ? JSON.stringify(data || {}) : (data || "");
        }

        var attempt = 0;
        var retried = false;
        var startAll = this._nowMs();

        while (attempt < this.maxRetries) {
            attempt++;
            var controller = new AbortController();
            var to = setTimeout(function () { try{ controller.abort("TIMEOUT"); }catch(_){}} , this.timeoutMs);

            try {
                this._log("📤 POST attempt " + attempt + "/" + this.maxRetries, { url: url });
                var res = await fetch("https://absensiburuhtaling.dlhpambon2025.workers.dev/", {
                    method: "POST",
                    headers: headers,
                    body: body,
                    signal: controller.signal
                });
                clearTimeout(to);

                var parsed = await this._smartParseResponse(res);

                if (res.ok) {
                    var okRes = this._makeResult(true, "SUCCESS", res.status, null, url, attempt, this._nowMs() - startAll, retried, requestId, parsed.data);
                    this._log("✅ Sukses:", okRes);
                    return okRes;
                }

                if (!this._shouldRetryHTTP(res) || attempt >= this.maxRetries) {
                    this._safeToast("error", failRes.error.message);
                    const fail = this._log("Failed", this._makeResult(false, this._statusFromHttp(res.status), res.status, {
                        code: parsed.errorCode || "ERROR",
                        message: parsed.errorMessage || ("Gagal (status " + res.status + ")")
                    }, url, attempt, this._nowMs() - startAll, retried, requestId, parsed.data))
                    this._log("❌ Gagal:", fail);
                    return fail
                }

                retried = true;
                await this._delay(this._computeBackoff(attempt, this.retryDelay, res));

            } catch (err) {
                clearTimeout(to);

                var code = this._classifyFetchError(err);
                if (code === "ABORTED") {
                    return this._makeResult(false, "ABORTED", null, { code: code, message: "Dibatalkan." }, url, attempt, this._nowMs() - startAll, retried, requestId);
                }

                if (attempt >= this.maxRetries) {
                    var fail = this._makeResult(false, code, null, {
                        code: code,
                        message: this._readableFetchError(err, code)
                    }, url, attempt, this._nowMs() - startAll, retried, requestId);
                    this._safeToast("error", fail.error.message);
                    return fail;
                }

                retried = true;
                await this._delay(this._computeBackoff(attempt, this.retryDelay));
            }
        }

        return this._makeResult(false, "FAILED", null, {
            code: "UNKNOWN",
            message: "Gagal tanpa alasan yang diketahui."
        }, url, attempt, this._nowMs() - startAll, retried, requestId);
    }

    // ====== PRIVATE UTILS ======
    _normalizeBaseURL(u) {
        if (typeof u !== "string") return "";
        var s = u.trim();
        if (!s) return "";
        if (/^\/\//.test(s)) s = "https:" + s;
        if (!/^https?:\/\//i.test(s)) s = "https://" + s;
        s = s.replace(/\/+$/, "");
        return s;
    }
    _requireBaseURL() {
        var u = this.URL;
        if (!u) throw new Error("RequestManager.baseURL belum diset (AppController/baseURL kosong).");
        return u;
    }
    _nowMs() {
        try { return (typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : Date.now(); }
        catch(_) { return Date.now(); }
    }
    _delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    _makeUUID() {
        try { return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2)); }
        catch(_) { return (Date.now() + "-" + Math.random().toString(16).slice(2)); }
    }
    _joinURL(base, p) {
        if (!p) return base;
        if (base.endsWith("/") && p.startsWith("/")) return base + p.slice(1);
        if (!base.endsWith("/") && !p.startsWith("/")) return base + "/" + p;
        return base + p;
    }
    _makeResult(confirm, status, httpStatus, errorObj, url, attempt, durationMs, retried, requestId, data) {
        return {
            confirm: !!confirm,
            status : status,
            httpStatus: (typeof httpStatus === "number") ? httpStatus : null,
            data   : data || null,
            error  : errorObj || null,
            meta   : {
                requestId : requestId || this._makeUUID(),
                attempt   : attempt || 0,
                retried   : !!retried,
                durationMs: Math.max(0, Math.round(durationMs || 0)),
                url       : url
            }
        };
    }
    async _smartParseResponse(res) {
        var ct = (res.headers.get("Content-Type") || "").toLowerCase();
        var out = { data: null, errorMessage: null, errorCode: null, raw: null };
        try {
            if (ct.indexOf("application/json") >= 0) {
                out.data = await res.json();
                if (!res.ok) {
                    out.errorMessage = (out.data && (out.data.message || out.data.error || out.data.msg)) || null;
                    out.errorCode    = (out.data && (out.data.code    || out.data.errorCode)) || null;
                }
            } else if (ct.indexOf("text/") >= 0) {
                var txt = await res.text();
                out.raw = txt;
                try { out.data = JSON.parse(txt); } catch(_) { out.data = txt; }
                if (!res.ok) out.errorMessage = (typeof out.data === "string") ? out.data.slice(0, 300) : null;
            } else {
                // blob/unknown
                try { out.raw = await res.blob(); } catch(_) { out.raw = null; }
                out.data = out.raw;
            }
        } catch(_) {
            out.errorMessage = "Gagal mem-parse respons server.";
            out.errorCode = "PARSE_ERROR";
        }
        return out;
    }
    _shouldRetryHTTP(res) {
        var s = res.status;
        return (s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599));
    }
    _statusFromHttp(s) {
        if (s === 429) return "THROTTLED";
        if (s === 408) return "TIMEOUT";
        if (s >= 500) return "SERVER_ERROR";
        if (s >= 400) return "CLIENT_ERROR";
        return "FAILED";
    }
    _computeBackoff(attempt, baseDelay, res) {
        var retryAfterMs = 0;
        try {
            var ra = res && res.headers && res.headers.get && res.headers.get("Retry-After");
            if (ra) {
                var sec = parseInt(ra, 10);
                if (!isNaN(sec)) retryAfterMs = sec * 1000;
            }
        } catch(_) {}
        var expo   = Math.min(30000, Math.round(baseDelay * Math.pow(2, Math.max(0, attempt - 1))));
        var jitter = Math.floor(Math.random() * Math.min(1000, baseDelay));
        return Math.max(retryAfterMs, expo + jitter);
    }
    _classifyFetchError(err) {
        var msg = (err && (err.message || "")) || "";
        var name = (err && err.name) || "";
        if (name === "AbortError" || msg === "ABORTED") return "ABORTED";
        if (msg === "TIMEOUT") return "TIMEOUT";
        // Heuristik: kalau online tapi gagal, kemungkinan CORS; kalau offline, network error

        return (typeof navigator !== "undefined" && navigator.onLine) ? "OFFLINE" : "NETWORK_ERROR";
    }
    _readableFetchError(err, code) {
        if (code === "TIMEOUT") return "Timeout! Periksa koneksi.";
        if (code === "OFFLINE")    return "Offline. Cek koneksi.";
        if (code === "NETWORK_ERROR") return "Jaringan error. Cek koneksi.";
        if (code === "ABORTED") return "Permintaan dibatalkan.";
        return (err && err.message) || "Terjadi kesalahan jaringan.";
    }
    async _waitUntilVisible(ms) {
        if (typeof document === "undefined" || !document.hidden) return;
        return new Promise(function (resolve) {
            var t = setTimeout(function () { resolve(); }, Math.max(0, ms || 0));
            function onVis() {
                if (!document.hidden) { clearTimeout(t); resolve(); }
            }
            document.addEventListener("visibilitychange", onVis, { once: true });
        });
    }
    _safeToast(type, msg) {
        try {
            if (!msg) return;
            if (typeof STATIC !== "undefined" && typeof STATIC.toast === "function") {
                STATIC.toast(msg, type || "info");
            }
        } catch(_) {}
    }
}
class STATIC {
    
    static changeContent(targetId){
        const main = document.querySelector("#main")
        main.className = `content grid-center ${targetId}`
    }
    static verifyController(data){
        return {
            show : (callback = "") => {
                STATIC.changeContent("verify")
                document.querySelector("#verify h4").innerHTML      = data.head
                document.querySelector("#verify span").innerHTML    = data.text
                if (data.status == 'denied') {
                    document.querySelector("#verify i").className   = (data.icon) ? data.icon + " red" : "fas fa-triangle-exclamation red"
                    document.querySelector("#verify h4").className  = "denied"
                }
                else {
                    document.querySelector("#verify i").className   = (data.icon) ? data.icon + " green"  : "fas fa-check green"
                    document.querySelector("#verify h4").className  = "granted"
                }
                if(typeof callback === "function") callback()
            },
            clear : (callback = "") => {
                document.querySelector("#verify").classList.add("dis-none")
                document.querySelector("#verify h4").innerHTML = ""
                document.querySelector("#verify span").innerHTML = ""
                document.querySelector("#verify i").className = ""
                
                if(typeof callback === "function") callback()
                else if (typeof callback === "string") this.changeContent(callback)
            }
        }
    }
    static toast(msg, type = "info") {
        const toastEl = document.querySelector("#toast");
        if (!toastEl) return console.warn("Toast element not found");
        toastEl.className = `show ${type}`;
        toastEl.innerHTML = msg;
        setTimeout(() => {
            toastEl.classList.remove(`show`, `${type}`);
        }, 5000);
    }
    static async delay (ms, callback = "") {
        await new Promise(resolve => setTimeout(resolve, ms))
        if(typeof callback === "function") return callback()
    }
    static loaderRun(text = 'Sending Request') {
        try {
            document.querySelector("#loader").classList.remove("dis-none");
            document.querySelector("#the-loader").classList.remove("dis-none");
            document.querySelector("#loader-text").textContent = text;
        } catch (err) {
            console.error("[loaderRun] Gagal menampilkan loader :", err);
        }
    }
    static loaderStop(callback = "") {
        document.querySelector("#loader").classList.add("dis-none")
        document.querySelector('#loader-text').textContent = ""
        if (typeof callback === "function") return callback()
    }
    static blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(",")[1]; // buang prefix data:image/jpeg;base64,
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    static async base64ToBlob(base64, mimeType = "image/jpeg") {
        const byteChars = atob(base64); // decode base64 → binary string
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], {type: mimeType});
    }
    static async blobToBase64(blob) {
        if (!blob) throw new Error("Blob tidak valid");
        return await new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = reader.result || "";
                    const base64 = result.includes(",") ? result.split(",")[1] : result;
                    resolve(base64);
                };
                reader.onerror = () => reject(new Error("Gagal membaca blob"));
                reader.readAsDataURL(blob);
            } catch (err) {
                reject(err);
            }
        });
    }
}
 

class absensi {
    constructor () {
        this.request        = new RequestManager()
        this.coordLoader    = document.getElementById('loader-koordinat')
        this.getCoord       = document.getElementById('getCoord')
        this.coordProscess  = false
        this.loaderContent  = document.querySelector("#loader-content")
        this.Submit         = document.querySelector('button')
        this.lokasiBox      = document.querySelector("#lokasi-box")

        this.toCapture      = document.querySelector("#to-capture")
        this.closeCapture   = document.querySelector("#close-btn")
        this.captureBtn     = document.querySelector("#capture-btn")
        this.switchBtn      = document.querySelector("#switch-btn")
        this.videoElement   = document.querySelector("video#video")
        this.canvasElement  = document.createElement("canvas")
        this.cameraError    = document.querySelector("#camera-error")

        this.Docs           = null
        this.file           = null
        this.Reciept        = this.makeInsecureUUID()

        this.cams           = []
        this.camsIndex      = 0
        this.cameraID       = 0

        this.device         = new Device(this)

        this.manualInput    = document.querySelector("#lokasi-manual")
        this.manualBox      = document.querySelector("#lokasi-manual-box")
        
        if (!localStorage.getItem("last-update")) {
            //this.allRequest()
        } else {
            const last = JSON.parse(localStorage.getItem("last-update"))
            const satuJam = 1000 * 60 * 60
            //if (last + satuJam <= Date.now()) return this.allRequest()
        }
    }
    start () {
        this.device.set()
        this.eventListener()
        this.checkInterval = setInterval(() => this.collectAndCheck(), 2000)
    }
    elements () {
        return {
            Koordinat   : document.querySelector("#koordinat"),
            Tipe        : document.querySelectorAll(`input[name="tipe"]`),
            Pengawas    : document.querySelector("#pengawas"),
            Lokasi      : document.querySelectorAll(`input[name="lokasi"]`),
            Buruh       : document.querySelector("#buruh"),
            Photo       : document.querySelector("#image-photo"),
            Keterangan  : document.querySelector("#keterangan"),
            Submit      : document.querySelector("#submit"),
            Status      : document.querySelectorAll("input[name='status']"),
            Docs        : document.querySelector("#other-file")
        }
    }
    
    
    eventListener(){
        window.addEventListener("change", async (e) => {
            if (e.target && e.target.name == "lokasi" && e.target.checked) {
                document.querySelector("#manual").checked = false
                this.manualBox.classList.add("dis-none")
            }
        })

        window.addEventListener("click", (e) => {
            const target = e.target
            //console.log(target)
            if (target.classList.contains("mnx")) {
                console.log("mnx")
                this.manualBox.classList.toggle("dis-none", !e.target.checked)
                document.querySelectorAll('input[name="lokasi"]').forEach(input => input.checked = false)
                return
            }
            if (target.id == "verify-retry") return this.submit()
            if (target.id == "verify-absen") return this.reset()
            if (target.id == "verify-cek_data") return document.querySelector("#to-data").click()
        })

        this.elements().Status.forEach(radio => {
            radio.addEventListener("change", () => {
                if (radio.value == "Sakit" || radio.value == "Izin") {
                    document.querySelectorAll("[data-hide='hide'").forEach(hide => hide.classList.contains("dis-none") ? "" : hide.classList.add("dis-none"))
                    //document.querySelector("#other-form").classList.remove("dis-none")
                }
                else {
                    //document.querySelectorAll("#other-form").forEach(form => form.classList.add("dis-none"))
                    document.querySelectorAll("[data-hide='hide'").forEach(hide => hide.classList.contains("dis-none") ? hide.classList.remove("dis-none") : "")
                }
            })
        })

        this.elements().Docs.addEventListener('change', (event) => {
            const resultElement = document.querySelector("#base64Result")
            resultElement.textContent = ""; // Bersihkan hasil sebelumnya

            if (event.target.files.length === 0) {
                resultElement.textContent = "Tidak ada file yang dipilih.";
                this.Docs = null
                return;
            }

            const file = event.target.files[0]; 
            const fileType = file.type; // Contoh: "image/jpeg", "image/png"

            // 1. Pengecekan Inti: Cek apakah MIME Type adalah GAMBAR
            if (!fileType.startsWith('image/')) {
                resultElement.style.color = 'red';
                resultElement.textContent = `❌ ERROR: Hanya file gambar (foto) yang diperbolehkan. Tipe file Anda: ${fileType}`;
                
                // Opsional: Reset input agar pengguna memilih ulang
                event.target.value = ''; 
                return; 
            }

            // --- 2. JIKA LULUS, LANJUTKAN KE KONVERSI BASE64 ---
            
            // Konversi ke Base64
            const reader = new FileReader();
            reader.onload = function(e) {
                const base64String = e.target.result.split(',')[1]
                this.Docs = base64String    
                resultElement.style.color = 'green';
                resultElement.innerHTML = ``;
                // Lakukan pengiriman data ke server atau operasi lain di sini
            };

            reader.readAsDataURL(file);
        });

        document.querySelector("#update-data").onclick = async () => this.requestData()

        document.querySelectorAll(".fa-home, .to-home").forEach(home => {
            home.onclick = () => window.location.reload()
        })
        document.querySelector("#to-data").onclick = async () => {
            STATIC.loaderRun('update_data')
            await this.getThreeDays()
            this.setDataPengawas()
            document.querySelector("#home").classList.add("dis-none")
            document.querySelector("#list-data").classList.remove("dis-none")
            document.querySelector("#main").classList.add("dis-none")
            const formInterval = setInterval(() => {
                if (!localStorage.getItem('data3hari')) return
                STATIC.loaderStop()
                clearInterval(formInterval)
            }, 1000)
        }

        this.getCoord.onclick = () => {
            console.log("clicked")
            if (this.coordProscess) return
            this.coordLoader.classList.remove("dis-none")
            this.elements().Koordinat.placeholder = "Mendeteksi lokasi..."
            this.coordProscess = true
            this.autoDetectLocation()
            setTimeout(() => {
                this.coordLoader.classList.add("dis-none")
                this.coordProscess = false
            }, 2000)
        }


        this.elements().Tipe.forEach(radio => {
            // Pilih Tipe. Taman atau Berem
            radio.addEventListener("change", async () => {
                const data = await this.readData()
                const tipe = document.querySelector(`input[name="tipe"]:checked`).value.toUpperCase()

                let pengawasHTML = `<option value="" disabled selected>-- pilih pengawas --</option>`
                // looping data pengawas
                data.pengawas.forEach(man => { 
                    const TIPE = man.TIPE.toUpperCase();
                    TIPE.indexOf(tipe) >= 0 ? pengawasHTML += `<option value="${man.NAMA}">${man.NAMA}</option>` : ''
                })

                this.elements().Pengawas.disabled = false
                this.elements().Pengawas.innerHTML = pengawasHTML
                this.elements().Buruh.disabled = true
                this.elements().Buruh.innerHTML = ""
                this.lokasiBox.innerHTML = "-"
                
                // Pilih pengawas. Tentukan lokasi dan buruh
                this.elements().Pengawas.addEventListener("change", async (e) => {
                    const pengawas = this.elements().Pengawas.value.toUpperCase()

                    let lokasiHTML = ``
                    // looping data lokasi
                    data.lokasi.forEach(place => {
                        const PENGAWAS = place.PENGAWAS;
                        PENGAWAS.toUpperCase().indexOf(pengawas) >= 0 ? lokasiHTML += `
                            <label class="radio-inline radio2 pointer">
                                <input type="radio" name="lokasi" value="${place.LOKASI}"> ${place.LOKASI}
                            </label>` : ''
                    })
                    lokasiHTML += `
                            <label class="radio-inline radio2 pointer mnx" for="manual">
                                <input type="checkbox" name="" value="manual" id="manual" class="mnx"> --- lokasi lainnya ---
                            </label>`
                    
                    let buruhHTML = `<option value="" disabled selected>-- pilih buruh --</option>`
                    // looping data buruh
                    data.buruh.forEach(man => {
                        const TIPE      = man.TIPE.toUpperCase()
                        const PENGAWAS  = man.PENGAWAS.toUpperCase()
                        PENGAWAS.indexOf(pengawas) >= 0 /*&& TIPE.indexOf(tipe) >= 0*/ ? buruhHTML += `<option value="${man.NAMA}">${man.NAMA}</option>` : ''
                    })
                    this.elements().Buruh.disabled      = false
                    this.elements().Buruh.innerHTML     = buruhHTML
                    this.lokasiBox.innerHTML            = lokasiHTML
                })
            })
        })
        this.elements().Submit.onclick = async () => {
            if (!this.boolean) return
            this.submit()
        }

 
        this.switchBtn.onclick = async () => this.switchCamera()
        this.toCapture.onclick = async () => {
            const camPermision = await this.requestCameraPermission()
            if (!camPermision.confirm) return STATIC.verifyController({
                status  : "denied",
                head    : "Akses kamera ditolak",
                text    : "Izinkan akses kamera di pengaturan browser anda <br> (Google Chrome)",
                icon    : "fas fa-camera slash"
            }).show(() => this.verifyBtn("reload"))
            this.cameraError.classList.add("dis-none")
            try {
                const count = await this.countCamera()
                if (!count.confirm) throw new Error(count.message);
                
                // --- Perubahan di sini: Tambahkan 'await' ---
                const setupSuccess = await this.setCamera() 
                // ---------------------------------------------
                
                if (setupSuccess) { // setCamera mengembalikan boolean
                    document.querySelector("#form").classList.add("dis-none")
                    document.querySelector("#capture").classList.remove("dis-none")
                } else {
                    // Jika setCamera tidak mengembalikan true (meskipun ia sudah menangani error-nya)
                    throw new Error("Gagal mengatur kamera.");
                }
            }
            catch (e) {
                this.cameraError.classList.remove("dis-none")
                this.cameraError.innerHTML = e.message
            }
        }
        this.closeCapture.onclick = () => {
            this.stopCameraStream()
            document.querySelector("#form").classList.remove("dis-none")
            document.querySelector("#capture").classList.add("dis-none")
        }
        this.captureBtn.onclick = () => {
            this.capture()
        }

        window.addEventListener('online', (event) => {
            console.log("🎉 Koneksi pulih! Browser sekarang ONLINE.");
            // Di sini Anda bisa melanjutkan ping atau sinkronisasi data
            this.loaderContent.classList.remove("off")
            STATIC.loaderRun("CONNECTING")
            setTimeout(() => {
                STATIC.loaderStop()
                //this.pingStart()
            }, 2500);
        });
        window.addEventListener('offline', (event) => {
            console.log("🚨 Koneksi terputus! Browser sekarang OFFLINE.");
            // Di sini Anda harus menunda semua operasi ping eksternal
            STATIC.loaderRun("OFFLINE")
            this.loaderContent.classList.add("off")
            //this.pingStop()
        });

    }

    
    // camera method
    async requestCameraPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });  
            stream.getTracks().forEach(track => track.stop());
            return {
                confirm : true,
                message : "Izin kamera diberikan"
            }
        } catch (e) {
            return {
                confirm : false,
                message : "Izin kamera ditolak"
            }
        }
    }
    async countCamera() {
        try {
            const devices   = await navigator.mediaDevices.enumerateDevices()
            const cams      = devices.filter(device => device.kind == 'videoinput')
            if (!cams || cams.length == 0) throw new Error("Kamera tidak ditemukan")
            this.cams       = cams
            console.log(this.cams)
            this.cameraID   = cams[0].deviceId
            this.switchBtn.classList.toggle("dis-none", (cams.length < 2 || !cams))
            STATIC.toast(`${cams.length} kamera ditemukan`, 'success')
            return {
                confirm : true,
                message : `${cams.length} kamera ditemukan`
            }
        }
        catch (e) {
            return {
                confirm : false,
                message : e.message
            }
        }
    }
    async setCamera() {
        STATIC.loaderRun("Setup Camera")
        try {
            const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
            if (!hasMediaDevices) throw new Error("Perangkat tidak mendukung kamera.");
    
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: {exact : this.cameraID }},
                audio: false
            }).catch(err => {throw new Error(err.message)});
    
            if (!stream) throw new Error("Stream kamera tidak tersedia.");
    
            this.videoElement.srcObject = stream;
    
            await this.videoElement.play().catch(err => {throw new Error("Gagal memutar video kamera: " + err.message);});

            if (!this.videoElement || this.videoElement.readyState < 3) throw new Error("Kamera belum siap, mohon tunggu sebentar.");

            STATIC.loaderStop()
            return true

        } catch (err) {
            console.error(err)
            STATIC.toast("Kamera gagal dinyalakan: " + err.message, 'error');
            console.error("Kamera gagal dinyalakan:", err.message);
            STATIC.loaderStop()
            //setTimeout(() => STATIC.changeContent("main"), 2000)
            STATIC.verifyController({
                status  : "denied",
                head    :  "Kamera gagal dinyalakan",
                text    : (err.message == "") ? "Agar kamera dapat digunakan. Berikan akses ke kamera di setelan browser di setelan situs" : err.message
            }).show(() => this.verifyBtn("reload"))
            return false
        }

    }
    stopCameraStream() {
        if (this.videoElement && this.videoElement.srcObject) {
            const stream = this.videoElement.srcObject;
            const tracks = stream.getTracks();

            tracks.forEach(track => {
                track.stop(); // Hentikan setiap track (video, audio, dll.)
            });

            this.videoElement.srcObject = null; // Lepaskan stream dari elemen video
        }
    }
    async capture() {
        if (this.onCapture) return
        this.onCapture = true
        console.log("OnCapture")
        STATIC.loaderRun("proccesing image")
        try {
            if (!this.videoElement || !this.canvasElement) return STATIC.toast("Error: Elemen video atau canvas tidak ditemukan.", 'error');
            const width = this.videoElement.videoWidth;
            const height = this.videoElement.videoHeight;
            
            this.canvasElement.width = width;
            this.canvasElement.height = height;

            const context = this.canvasElement.getContext('2d',{ willReadFrequently: true });
            if (!context) return STATIC.toast("Error: Gagal mendapatkan konteks canvas.", 'error');

            context.drawImage(this.videoElement, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            
            const imageDataURL = this.canvasElement.toDataURL('image/jpeg', 0.9); // 0.9 adalah kualitas

            this.stopCameraStream();
            const resultImage = document.querySelector("#image-photo");
            if (resultImage) resultImage.src = imageDataURL;

            // 3. Panggil fungsi untuk memproses gambar (misalnya, mengunggah atau memverifikasi)
            await this.processImage();
            console.log(this.file)
            

            // Kembalikan data URL jika diperlukan, meskipun proses sudah dilanjutkan
            return imageDataURL;
        }
        catch (e) {
            console.error(e)
        }
        finally {
            this.onCapture = false
        }
    }
    switchCamera() {
        if (this.onSwitch) return
        this.onSwitch = true
        this.stopCameraStream()
        this.camsIndex = (this.camsIndex + 1 >= this.cams.length) ? 0 : this.camsIndex + 1
        this.cameraID = this.cams[this.camsIndex].deviceId
        STATIC.toast(`Switching to camera ${this.camsIndex + 1} : ${this.cams[this.camsIndex].label}`, 'info')
        this.setCamera()
        this.onSwitch = false
    }
    async processImage() {
        this.file = await new Promise((resolve, reject) => {
            try {
                const date  = new Date(),
                    month   = date.getMonth() + 1,
                    year    = date.getFullYear(),
                    min     = date.getMinutes(),
                    sec     = date.getSeconds()
                this.canvasElement.toBlob(async (blob) => {
                    if (!blob) return reject(new Error("Canvas menghasilkan blob null"));
                    try {
                        const base64 = await STATIC.blobToBase64(blob);
                        resolve({
                            nama   : `${this.elements().Buruh.value.toUpperCase()} - ${date.getDate() > 9 ? date.getDate() : "0" + date.getDate()}/${month > 9 ? month : "0" + month}/${year}_${min}:${sec}.jpg`,
                            mime   : "image/jpeg",
                            base64 : base64
                        });
                    } catch (err) {
                        reject(err);
                    }
                }, "image/jpeg", 0.9);
            }
            catch (err) {
                reject(err);
            }
            finally {
                this.closeCapture.click()
                window.location.href = "#photo-box-content"
                STATIC.loaderStop()
            }
        });
    }


    // location method
    autoDetectLocation() {
        const latLongInput = this.elements().Koordinat;
        if (navigator.geolocation) {
            latLongInput.placeholder = "";
            const options = { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 };
            const success = (position) => this.showSuccess(position);
            const error = (err) => this.showError(err);
            navigator.geolocation.getCurrentPosition(success, error, options);
        } else {
            /*
            STATIC.verifyController({
                status : "denied",
                head   : "Geolocation Tidak Didukung",
                text   : "Perangkat atau browser Anda tidak mendukung fitur geolokasi. Silakan masukkan lokasi secara manual."
            }).show(() => this.verifyBtn("reload"))
            */
            latLongInput.placeholder = "Geolocation tidak didukung.";
        }
    }
    showSuccess(position) {
        const lat = position.coords.latitude.toFixed(6); 
        const lon = position.coords.longitude.toFixed(6); 
        this.elements().Koordinat.value = `${lat} ${lon}`;
        this.elements().Koordinat.placeholder = "Lokasi terdeteksi";
        this.KoordinatData(lat, lon)
        //this.verifyController().clear()
    }
    async KoordinatData(lat, lon) {
        const options   = {method: 'GET', headers: {accept: 'application/json'}};
        const response  = await fetch(`https://us1.locationiq.com/v1/reverse?lat=${lat}&lon=${lon}&key=pk.a9bd630f0a7845193817de89ad1c07ab`, options)
        const json      = this.xmlToJson(await response.text())
        const JSX = JSON.parse(json);
        if (JSX.reversegeocode) {
            const geoData = JSX.reversegeocode.result["#text"]
            document.getElementById("koordinat-text").innerHTML = geoData
            //console.log(geoData)
        }
    }
    showError(error) {
        let pesan;
        switch(error.code) {
            case error.PERMISSION_DENIED:
                pesan = "Akses lokasi ditolak.";
                break;
            case error.TIMEOUT:
                pesan = "Deteksi lokasi gagal (Timeout). Coba lagi...";
                break;
            default:
                pesan = "Gagal mendeteksi lokasi. Coba lagi...";
        }
        this.locationReject({
            code    : error.code,
            pesan   : pesan
        })
        STATIC.toast(pesan, "error")
        if (!this.elements().Koordinat.value) {
            this.elements().Koordinat.value = ""
            this.elements().Koordinat.placeholder = pesan;
        }
    }
    xmlToJson(xmlString) {
        // Fungsi rekursif internal untuk parsing satu elemen menjadi objek JS
        const parseElement = (element) => {
            const obj = {};

            // 1. Tangani Atribut (@attributes)
            if (element.attributes.length > 0) {
                obj['@attributes'] = {};
                for (let i = 0; i < element.attributes.length; i++) {
                    const attr = element.attributes[i];
                    obj['@attributes'][attr.nodeName] = attr.nodeValue;
                }
            }

            const children = element.children;
            const textContent = element.textContent.trim(); 

            // 2. Tangani Elemen Anak (Child Elements)
            if (children.length > 0) {
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    const tagName = child.tagName;
                    const childObj = parseElement(child);
                    
                    if (obj[tagName]) {
                        // Jika sudah ada (array), dorong ke array
                        if (!Array.isArray(obj[tagName])) {
                            obj[tagName] = [obj[tagName]];
                        }
                        obj[tagName].push(childObj);
                    } else {
                        // Jika belum ada, tambahkan
                        obj[tagName] = childObj;
                    }
                }
            }

            // 3. Tangani Teks Konten (#text)
            if (children.length === 0 && textContent) {
                // Jika ada teks tapi tidak ada elemen anak:
                if (Object.keys(obj).length === 0) {
                    return textContent; // Jika tidak ada atribut, kembalikan langsung teks
                }
                obj['#text'] = textContent; // Jika ada atribut, tambahkan teks di bawah kunci #text
            }

            // Khusus untuk elemen yang hanya memiliki teks
            if (Object.keys(obj).length === 0 && textContent) {
                return textContent;
            }

            return obj;
        };

        // --- LOGIKA UTAMA FUNGSINYA ---
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, "text/xml");
            
            // Cek jika ada error parsing
            if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
                return JSON.stringify({ error: "Gagal parsing XML. Pastikan XML valid." }, null, 4);
            }

            const rootElement = xmlDoc.documentElement;
            
            // Panggil fungsi rekursif internal
            const parsedObject = parseElement(rootElement);

            // Bungkus hasilnya dengan nama root element
            const finalJson = {};
            finalJson[rootElement.tagName] = parsedObject; 

            // Konversi objek JavaScript ke string JSON yang terformat
            return JSON.stringify(finalJson, null, 4);

        } catch (e) {
            return JSON.stringify({ error: `Error saat konversi XML: ${e.message}` }, null, 4);
        }
    }
    locationReject (error) {
        document.querySelector("#koordinat-text").textContent = ""
        if (error.code !== 1) return 
        STATIC.verifyController({
            status : "denied",
            head   : error.pesan,
            text   : "Nyalakan lokasi dan izinkan akses lokasi pada browser dan perangkat Anda kemudian segarkan halaman ini.",
            icon   : "fas fa-location-dot slash"
        }).show(()=> this.verifyBtn("reload"))
    }


    // main data method
    async readData(){
        navigator.permissions.query({name: 'geolocation'}).then(function(result) {
            if (result.state === 'denied') this.locationReject({code : 1, pesan : "Akses lokasi ditolak."})
            else if (result.state === 'prompt') this.getCoord.click()
        });

        const data = await JSON.parse(localStorage.getItem("dataBuruh"))
        if (!data || data.length == 0 || data == null) {
            this.requestData()
            return false
        }
        return data
        STATIC.verifyController({
            status  : "denied",
            head    : "Error membaca data",
            text    : "Tekan tombol update di kanan atas untuk memperbarui data. <br>"
        }).show(() => setTimeout(() => STATIC.changeContent("main"), 2000))
    }
    async requestData() {
        STATIC.loaderRun('request_data')
        const device = this.device.get()
        const post = await this.request.post({
            type : "getData",
            data : "Bendhard16",
            device : device
        })
        try {
            if (!post.confirm) throw ({
                status  : "denied",
                head    : post.error.code,
                text    : post.error.message,
                retry   : true,
                local   : true,
                icon    : post.error.code.toUpperCase() == "OFFLINE" ? "fas fa-wifi slash" : false
            })
            else if (!post.data.confirm) throw ({
                status  : "denied",
                head    : post.data.status,
                text    : post.data.msg,
                retry   : false,
                local   : true,
                icon    : !post.data.icon ? false : post.data.icon                                       
            })
            else if (post.data.confirm) {
                this.requestGood = true
                STATIC.loaderStop()
                localStorage.setItem("dataBuruh", JSON.stringify(post.data.data))
                STATIC.changeContent("main")
            }
        }
        catch (error) {
            if (JSON.parse(localStorage.getItem("dataBuruh"))) this.requestGood = ""
            else this.requestGood = false
            STATIC.loaderStop()
            STATIC.verifyController(error).show()
            if (error.retry) return this.verifyBtn("retry, reload");
            this.verifyBtn("reload");
        }
    }
    async getThreeDays() {
        console.log("get 3")
        const post = await this.request.post({
            type : "getThreeDays",
            data : "Bendhard16"
        })
        try {
            console.log(post)
            if (!post.confirm) throw new Error(post.error.message)
            else if (!post.data.confirm) {
                throw new Error("Server Respon")
            }
            else if (post.data.confirm) {
                this.threeDaysGood = true
                STATIC.loaderStop()
                localStorage.setItem("data3hari", JSON.stringify(post.data.data))
                console.log(post.data.data)
            }
        }
        catch (e) {
            if (JSON.parse(localStorage.getItem("data3hari"))) this.threeDaysGood = true
            else this.threeDaysGood = false
            console.log("Post Failed", e)
            STATIC.verifyController({
                status  : "denied",
                head    : e.message,
                text    : ""
            }).show()
        }

    }
    setDataPengawas() {

        this.dataBrx = false
        const data3hari = JSON.parse(localStorage.getItem("data3hari"))
        if (!data3hari) document.querySelector("#to-data").classList.add("dis-none")

        this.dataBrx = true
        document.querySelector("#to-data").classList.remove("dis-none")
        
        let html = `<option value="" selected disabled>-- pilih pengawas --</option>`
        data3hari.pengawas.forEach(man => {
            console.log(man)
            html += `<option value="${man}">${man}</option>`
        })
        document.querySelector("#pengawas-data").innerHTML = html
        document.querySelector("#pengawas-data").onchange = (e) => {
            const value = e.target.value
            const data  = data3hari.data[value]
            if (!data || data == "") return document.querySelector("#list-buruh").innerHTML = "Tidak ada data"
            
            let dataHTML = ``
            Object.keys(data).forEach(date => {
                dataHTML += `
                    <div class="form-group  white p-10 borad-5">
                        <label class=" dis-block ask-label bolder w-100 fz-18">${date}</label>`
                        
                Object.keys(data[date]).forEach((lokasi, i) => {
                        dataHTML += `
                        <label class=" dis-block ask-label bolder w-100 mt-2">&nbsp; &nbsp; ${lokasi}</label>
                        <ul class="m-0 fz-14">`
                            data[date][lokasi].forEach(buruh => dataHTML += `<li>${buruh.buruh} - ${buruh.timestamp}</li>`)
                        dataHTML += `</ul>`
                })
                dataHTML += `
                    </div>
                `
            })
            return document.querySelector("#list-buruh").innerHTML = dataHTML
        }
    }

    
    // form control method
    collectAndCheck() {
        try {
            let param = true
            const status    = document.querySelector(`input[name="status"]:checked`)
            const STATUS    = status ? status.value : false
            const tipe      = document.querySelector(`input[name="tipe"]:checked`)
            const TIPE      = tipe ? tipe.value : " "
            const lokasi    = document.querySelector(`input[name="lokasi"]:checked`)
            const manual    = this.manualInput.value.trim()
            const LOKASI    = lokasi ? lokasi.value : (manual == "" ? " " : manual)
            if (STATUS == "Izin" || STATUS == "Sakit") this.collectData = {
                Koordinat   : "x",
                Tempat      : "x",
                Tipe        : TIPE.trim(),
                Pengawas    : this.elements().Pengawas.value.trim(),
                Buruh       : this.elements().Buruh.value.trim(),
                Lokasi      : "x",
                File        : this.Docs,
                Keterangan  : this.elements().Keterangan.value,
                Reciept     : this.Reciept,
                Status      : STATUS,
            }
            else this.collectData = {
                Koordinat   : this.elements().Koordinat.value.trim(),
                Tempat      : document.querySelector("#koordinat-text").textContent,
                Tipe        : TIPE.trim(),
                Pengawas    : this.elements().Pengawas.value.trim(),
                Buruh       : this.elements().Buruh.value.trim(),
                Lokasi      : LOKASI.trim(),
                File        : this.file,
                Keterangan  : this.elements().Keterangan.value,
                Reciept     : this.Reciept,
                Status      : STATUS
            }
            Object.keys(this.collectData).forEach(data => {
                if (data == "Keterangan" && STATUS == "Hadir") return
                if (STATUS !== "Hadir" && data == "File") return
                if (data == "File" && !this.collectData[data].nama ) return param = false
                if (this.collectData[data] == "" || !this.collectData[data]) return param = false
            })
            this.boolean = param
            if (!param) {
                this.elements().Submit.classList.add("grey")
                this.elements().Submit.classList.remove("green")
            }
            else {
                this.elements().Submit.classList.remove("grey")
                this.elements().Submit.classList.add("green")
            }
        }
        catch (e) {

        }
    }
    async submit() {
        STATIC.loaderRun("Sending Request")
        try {
            const post = await this.request.post({
                type    : "addTRX",
                data    : this.collectData,
                device  : this.device.get()
            })
            if (!post.confirm) throw ({
                status  : "denied",
                head    : post.error.code,
                text    : post.error.message,
                retry   : true
            })
            else if (!post.data.confirm) throw ({
                status : "denied",
                head   : post.data.status,
                text   : post.data.msg,
                retry  : false
            })
            else if (post.data.confirm) {
                STATIC.loaderStop()
                const verify = STATIC.verifyController({
                    text : "Kembali otomatis ke absen dalam 5 detik",
                    head : post.data.status,
                }).show(async () => {
                    let counter = 5
                    this.verifyBtn("absen");
                    const interval = setInterval(() => {
                        document.querySelector("#verify-text").textContent = "Kembali otomatis ke absen dalam " +  counter + " detik"
                        counter --
                        if (counter <= 0) return this.reset(), clearInterval(interval)
                    }, 1000)
                })
            }

        } catch (error) {
            STATIC.loaderStop()
            STATIC.verifyController(error).show()
            if (error.retry) return this.verifyBtn("retry, reload");
            this.verifyBtn("reload");
        }
    }

    // other method
    verifyBtn(param) {
        console.log("verify btn", param)
        document.querySelectorAll("#verify-btn span").forEach(btn => {
            btn.classList.add("dis-none")
            console.log(btn.id)
        })
        param.split(", ").forEach(p => {
            try {
                const docs = document.querySelector("#verify-" + p)
                docs.classList.remove("dis-none")
                console.log(docs)
            } catch (e) {
                console.error(e)
            }
        })
    }
    makeInsecureUUID() {
        let d = new Date().getTime(); // Dapatkan timestamp saat ini
        console.log(new Date())
        
        const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = (d + Math.random() * 16) % 16 | 0;
            d = Math.floor(d / 16);
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

        
        return uuid + " " + new Date().getDate() + "/" + (new Date().getMonth() + 1) + "/" + new Date().getFullYear() + "_" + new Date().getHours() + ":" + new Date().getMinutes() ;
    }
    reset() {
        document.querySelectorAll("input[type='radio'], input[type='checkbox']").forEach(radio => radio.checked = false)
        document.querySelectorAll("input[type='text'], select, textarea").forEach(input => input.value = "")
        document.querySelector("#image-photo").src = ""
        this.file = null
        this.Docs = null
        this.Reciept = null
        this.collectData = null
        this.elements().Submit.classList.add("grey")
        this.elements().Submit.classList.remove("green")
        this.elements().Pengawas.innerHTML = ""
        this.elements().Koordinat.value = ""
        this.elements().Buruh.innerHTML = ""
        this.lokasiBox.innerHTML = "-"
        this.manualBox.classList.add("dis-none")
        this.manualInput.value = ""
        this.Reciept = this.makeInsecureUUID()
        STATIC.changeContent("main")
        this.elements().Koordinat.placeholder = "Klik tombol untuk mendeteksi lokasi"
        document.querySelector("#koordinat-text").textContent = ""
        document.querySelector("#other-file").value = ""
        document.querySelector("#hadir-button").click()
    }
}

class Device {
    constructor (main) {
        this.main       = main
        this.token      = null
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    }
    set () {
        const device = this.get()
        if (!device) this.create()
    }
    create() {
        return localStorage.setItem("device", JSON.stringify({
            NAMA    : "Bendhard16",
            JWT     : null,
            ID      : crypto.randomUUID() + "-" + Date.now(),
            EMAIL   : null,
        }))
    }
    get () {
        const device = JSON.parse(localStorage.getItem("device"))
        if (!device) return undefined
        return device
    }
    async onGoogleSuccess(JWT) {
        await this.update({
            JWT : JWT
        })
        document.querySelector("#home-text").classList.add("dis-none")
        STATIC.changeContent("blank")
        STATIC.loaderRun("Validating Acount and Device")
        const device = await this.get()

        const res = await this.main.request.post({
            type    : "validate",
            device  : device
        })

        if (!res.confirm) return STATIC.verifyController({
            status  : "denied",
            head    : res.error.code,
            text    : res.error.message
        }).show(() => this.main.verifyBtn("reload, cek_data"))

        if (!res.data.confirm) return STATIC.verifyController({
            status  : "denied",
            head    : res.data.status,
            text    : res.data.msg
        }).show(() =>  this.main.verifyBtn("reload, cek_data"))

        if (res.data.confirm) {
            STATIC.toast("Device terdaftar", "success")
            const device = res.data.device
            await this.update({
                NAMA    : device.NAMA,
                LAST    : Date.now()
            })
            const read = this.main.readData()
            if (read) STATIC.changeContent("main")
        }
    }
    async update(data){
        try {
            const device = await this.get()
            data.EMAIL ? device.EMAIL =  data.EMAIL : ""
            data.LAST ? device.LAST =  data.LAST : ""
            data.NAMA ? device.NAMA = data.NAMA : ""
            data.JWT ? device.JWT  = data.JWT : ""
            localStorage.setItem("device", JSON.stringify(device))
            console.log(data)
        }
        catch (err) { 
            console.error("Gagal update device:", err)  
        }
    }
}



//testAPI()