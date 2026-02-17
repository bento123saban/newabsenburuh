



// --------------------
/**
 * Variabel untuk menyimpan referensi timer dari setTimeout.
 * Diletakkan di lingkup luar (closure) agar nilainya tetap bertahan 
 * di antara pemanggilan fungsi changeContent.
 */
let changeContentTime;
/**
 * Mengubah class CSS pada elemen ID '#app' secara asinkron dengan fitur pembatalan.
 * * Fungsi ini menggunakan mekanisme debounce: jika dipanggil berulang kali sebelum 
 * delay selesai, eksekusi sebelumnya akan dibatalkan dan timer akan diulang.
 * * @param {string} [content="loading"] - Nama class CSS yang akan diberikan ke elemen #app.
 * @param {number} [delay=0] - Penundaan eksekusi dalam milidetik (ms).
 * @example
 * changeContent("success", 500); // Elemen #app akan memiliki class "success" setelah 0.5 detik.
 */
export const changeContent = (content = "loading", delay = 0) => {
    /**
     * Membatalkan timer yang sedang berjalan (jika ada).
     * Ini memastikan jika fungsi dipanggil dua kali dalam waktu singkat,
     * pemanggilan pertama tidak akan pernah dieksekusi (Debounce).
     */
    clearTimeout(changeContentTime);

    /**
     * Menjadwalkan perubahan class CSS.
     * ID timer yang dihasilkan disimpan ke variabel 'changeContentTime'.
    */

    changeContentTime = setTimeout(() => {
        // Mencari elemen target di dalam dokumen
        const el = document.querySelector("#app");

        /**
         * Melakukan pengecekan apakah elemen ditemukan (Null-safety).
         * Jika elemen ada, ganti seluruh class-nya dengan nilai 'content'.
         */
        if (el) {
            el.className = content;
        }
    }, delay); // Menjalankan setelah waktu tunggu 'delay' terpenuhi
};


// -------------------
 /**
 * Mengonversi objek Blob atau File menjadi string Base64.
 * * Fungsi ini membuang Data URL Schema (misal: "data:image/png;base64,") 
 * dan hanya mengembalikan payload mentah Base64.
 * * @param {Blob} blob - Objek Blob atau File yang akan dibaca.
 * @returns {Promise<string>} Promise yang menghasilkan string Base64 saat pembacaan selesai.
 * @throws {TypeError} Jika input bukan merupakan instance dari Blob.
 */
export const blobToBase64 = (blob) => new Promise((res, rej) => {
    if (!(blob instanceof Blob)) return rej("Invalid Blob");
    const r = new FileReader();
    r.onload = () => res(r.result?.substring(r.result.indexOf(",") + 1));
    r.onerror = () => rej("Read Error");
    r.readAsDataURL(blob);
});


// -------------------
/**
 * Mengonversi string Base64 kembali menjadi objek Blob.
 * * Keunggulan versi ini:
 * 1. Performa Tinggi: Menggunakan TypedArray tanpa membuat Array perantara.
 * 2. Hemat Memori: Alokasi memori dilakukan sekaligus sesuai ukuran data.
 * 3. Robust: Mendukung Base64 dengan atau tanpa padding, serta validasi input.
 * * @param {string} base64 - String payload Base64 (tanpa prefix data:...).
 * @param {string} [mimeType="image/jpeg"] - Tipe media dari file yang dihasilkan.
 * @returns {Promise<Blob>} Promise yang menghasilkan objek Blob.
 * @throws {Error} Jika string Base64 tidak valid atau proses decode gagal.
 */
export const base64ToBlob = async (base64, mimeType = "image/jpeg") => {
    try {
        // 1. Decode base64 ke binary string menggunakan atob
        // Atob melakukan verifikasi internal terhadap integritas base64
        const byteChars = atob(base64);
        const len = byteChars.length;

        // 2. Alokasi buffer memori sekaligus (Fixed-size buffer)
        // Jauh lebih efisien daripada new Array() karena langsung masuk ke memory heap
        const bytes = new Uint8Array(len);

        // 3. Iterasi cepat untuk mengisi byte array
        for (let i = 0; i < len; i++) {
            bytes[i] = byteChars.charCodeAt(i);
        }

        // 4. Bungkus dalam Blob
        return new Blob([bytes], { type: mimeType });
    } catch (err) {
        throw new Error("Gagal mengonversi Base64 ke Blob: " + err.message);
    }
};


// -------------------
/**
 * Variabel global untuk menyimpan referensi timer toast.
 * Digunakan untuk mencegah pesan toast tertutup prematur jika ada pesan baru yang muncul.
 */
let toastTimer;
/**
 * Menampilkan pesan notifikasi (toast) ke layar.
 * * @param {string} msg - Pesan teks yang akan ditampilkan.
 * @param {string} [type="info"] - Tipe notifikasi (contoh: 'success', 'error', 'warning'). 
 * Mempengaruhi styling melalui class CSS.
 */
export const toast = (msg, type = "info") => {
    // 1. Mencari elemen kontainer toast di DOM
    const toastEl = document.querySelector("#toast");
    
    // 2. Guard Clause: Keluar dari fungsi jika elemen tidak ditemukan agar tidak error
    if (!toastEl) return console.warn("Toast element not found");

    // 3. Reset Timer: Jika ada toast yang sedang tayang, batalkan jadwal penutupannya
    clearTimeout(toastTimer);

    // 4. Update UI: Setel class untuk animasi muncul ('show') dan warna tipe ('success/info')
    toastEl.className = `show ${type}`;
    
    // 5. Render: Masukkan pesan ke dalam elemen
    toastEl.innerHTML = msg;

    // 6. Penjadwalan Sembunyi: Hapus class setelah 5 detik
    toastTimer = setTimeout(() => {
        // Menghapus class satu per satu untuk memicu animasi keluar (jika ada di CSS)
        toastEl.classList.remove("show", type);
    }, 5000);
}


// -------------------
/**
 * Menghentikan eksekusi sementara (sleep) dan menjalankan callback opsional.
 * * Fungsi ini dapat digunakan dengan dua cara:
 * 1. Sebagai jeda: await delay(2000);
 * 2. Sebagai timer callback: delay(2000, () => doSomething());
 * * @param {number} ms - Durasi jeda dalam milidetik.
 * @param {Function} [callback=""] - Fungsi opsional yang dijalankan setelah waktu habis.
 * @returns {Promise<any>} Mengembalikan Promise hasil dari callback atau undefined.
 */
export const delay = async (ms, callback = "") => {
    /**
     * Membuat janji (Promise) yang akan selesai (resolve) 
     * setelah durasi 'ms' terpenuhi menggunakan native setTimeout.
     */
    await new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Validasi tipe data: Memastikan 'callback' adalah sebuah fungsi.
     * Jika benar, jalankan fungsi tersebut dan kembalikan hasilnya.
     */
    if (typeof callback === "function") return callback();
}
