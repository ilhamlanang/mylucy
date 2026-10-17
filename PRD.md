# Product Requirements Document (PRD) - MyLucy

## 1. Executive Summary

### Problem Statement
Pengguna kesulitan mengelola keuangan pribadi secara konsisten karena proses pencatatan manual yang menyita waktu, kurangnya analisis mendalam terhadap pola pengeluaran, serta aplikasi finansial yang ada sering kali terlalu rumit atau terbatas pada satu platform saja.

### Proposed Solution
**MyLucy** adalah sebuah Progressive Web App (PWA) manajemen keuangan pribadi berkonsep *mobile-first* dan *responsive desktop* yang terintegrasi dengan database cloud (**Supabase**) serta kecerdasan buatan (**Google Gemini API** via Supabase Edge Functions) untuk *auto-categorization*, *smart budgeting*, dan *AI financial advisor*.

### Success Criteria
* **Kecepatan Input**: Pengguna dapat menginput transaksi manual/otomatis dalam waktu `< 5 detik`.
* **Akurasi Parsing**: *Accuracy rate* untuk fitur AI Auto-Categorization & Smart Parsing `>= 90%`.
* **Aksesibilitas & Sinkronisasi**: Pengguna aktif dapat mengakses dan mengoperasikan aplikasi dengan sinkronisasi *real-time* tanpa hambatan di HP maupun Laptop, termasuk *graceful fallback* saat offline.
* **Tingkat Kepuasan AI**: *User Satisfaction Score* terhadap saran AI Advisor `>= 85%`.

---

## 2. User Experience & Functionality

### User Personas
* **Primary Persona**: Individu/Profesional muda yang ingin melacak pengeluaran harian, mengontrol anggaran (*budgeting*), dan mendapatkan saran analisis keuangan pribadi yang cerdas secara praktis dari HP maupun Laptop.

### User Stories & Acceptance Criteria (AC)

#### 1. Pencatatan Transaksi Cepat, Dompet, & Kategori Kustom
* **User Story**: *As a user, I want to quickly log my income and expenses with customizable categories and wallets so that I can keep an accurate track of my cash flow without hassle.*
* **Acceptance Criteria**:
  * Menyediakan form input manual (tanggal, nominal dalam IDR, deskripsi, kantong/dompet, jenis: Pemasukan/Pengeluaran).
  * Pengguna dapat memilih sumber dana/dompet (misal: *Tunai/Cash*, *Bank BCA*, *GoPay*) atau menggunakan saldo utama.
  * Pengguna dapat membuat, mengubah, dan menghapus kategori secara mandiri (misal: *Makan/Minum*, *Transport*, *Belanja*, *Hiburan*, *Tabungan*, *Tagihan*).
  * Data transaksi langsung tersimpan ke Supabase Database secara *real-time* (atau disimpan di lokal cache saat *offline* dan otomatis *sync* saat kembali *online*).

#### 2. Ringkasan Saldo & Dashboard Visual
* **User Story**: *As a user, I want to view my total balance, monthly summary, and visual charts so that I can easily evaluate my financial status at a glance.*
* **Acceptance Criteria**:
  * Menampilkan total saldo, total pemasukan, dan total pengeluaran bulan berjalan.
  * Menampilkan grafik interaktif (*pie chart* / *bar chart*) distribusi pengeluaran per kategori.
  * Tampilan responsif: *Bottom Navigation Bar* di layar HP dan *Sidebar Navigation* multi-kolom di layar Laptop/Desktop.

#### 3. Smart Budgeting & Peringatan Proaktif
* **User Story**: *As a user, I want to set monthly budget limits per category and receive proactive warnings so that I don't overspend before the month ends.*
* **Acceptance Criteria**:
  * Fitur alokasi anggaran bulanan per kategori (*Envelope System*).
  * Sistem menampilkan *Warning Banner/Alert* otomatis jika pengeluaran pada suatu kategori melampaui ambang batas aman (misal: `>= 80%` dari kuota atau melebihi laju batas harian/mingguan yang wajar).

#### 4. Auto-Categorization & Smart Parsing (AI)
* **User Story**: *As a user, I want to paste notification text or banking mutation logs so that the system automatically extracts the amount, merchant, and category without manual typing.*
* **Acceptance Criteria**:
  * Menyediakan kotak input teks untuk menempelkan (*paste*) riwayat/notifikasi transaksi (contoh: *"QRIS Rp45.000 at Kopi Janji Jiwa"*).
  * Menggunakan AI dengan *Structured Outputs (JSON Schema)* untuk mengekstraksi nominal, tanggal, merchant, jenis transaksi, dan menetapkan kategori secara otomatis dengan akurasi tinggi.
  * Pengguna dapat meninjau (*preview*) hasil ekstraksi AI sebelum menyimpannya ke database.

#### 5. AI Financial Advisor Chatbot (Lucy)
* **User Story**: *As a user, I want to consult Lucy (AI financial assistant) about my spending habits so that I can get personalized financial advice and savings strategies.*
* **Acceptance Criteria**:
  * Antarmuka percakapan (*chat*) terintegrasi di dalam aplikasi dengan dukungan *streaming response* agar balasan terasa instan.
  * AI (Lucy) merespons pertanyaan pengguna berdasarkan konteks agregasi data riwayat transaksi dan status anggaran bulan berjalan yang ada di database.

### Non-Goals
* **Fitur Multi-User / Family Account**: Aplikasi versi ini dirancang khusus untuk manajemen keuangan pribadi (*single user* per akun).
* **Koneksi Direct Banking API**: Tidak melakukan integrasi langsung ke *core banking* / OJK Open API untuk penarikan mutasi otomatis.
* **Integrasi Pembayaran / Transfer Uang**: Aplikasi ini murni bersifat pencatatan dan analisis finansial, bukan alat pembayaran (*payment gateway*).

---

## 3. AI System Requirements

### Tool & Model Requirements
* **AI Model/LLM**: Google Gemini API (`gemini-3.8-flash` / `gemini-3.5-flash-lite`).
* **Integration Library**: `@google/genai` SDK (`client.interactions.create`) yang dijalankan di sisi server (**Supabase Edge Functions**).
* **AI Capabilities**:
  * **Structured Outputs (`response_format`)**: Menjamin output JSON deterministik pada fitur Smart Parsing (`amount`, `merchant`, `category_name`, `type`, `transaction_date`, `confidence`).
  * **Context Aggregation**: Mengirimkan ringkasan statistik keuangan pengguna (total per kategori, rasio budget, top pengeluaran) ke prompt Lucy Advisor untuk menghemat kuota token dan mempercepat *latency*.

### Evaluation Strategy

| Parameter Evaluasi | Target Metrik / Kriteria |
| :--- | :--- |
| **Parsing Benchmark** | Diuji menggunakan 30 variasi teks format notifikasi bank & e-wallet populer di Indonesia (GoPay, ShopeePay, OVO, BCA, Mandiri, BRI). |
| **Target Pass Rate** | Minimal **90%** variabel (`Nominal`, `Merchant`, `Kategori`, `Tipe`) terekstraksi dengan benar. |
| **Response Latency (TTFT)** | Smart Parsing dan AI Chatbot Advisor (melalui *streaming*) harus mengembalikan respons awal (*Time-to-First-Token*) dalam waktu **`<= 2 detik`**. |

---

## 4. Technical Specifications

### Architecture Overview
* **Frontend**: React.js (Vite) + Tailwind CSS (*Mobile-first responsive design*).
* **App Framework**: Progressive Web App (PWA) dengan `vite-plugin-pwa` & Service Workers agar dapat di-install ke Home Screen (HP) / Desktop App, serta mendukung *offline-first* untuk pencatatan manual.
* **Backend & Database**: **Supabase** (PostgreSQL) untuk Autentikasi Pengguna (Auth) dan Penyimpanan Data Transaksi.
* **Serverless AI Proxy**: **Supabase Edge Functions** (Deno) sebagai middleware aman yang memvalidasi sesi JWT pengguna sebelum memanggil Gemini API.
* **Offline Strategy & Graceful Degradation**:
  * Saat *offline*, input transaksi manual disimpan ke *Local Queue (IndexedDB/LocalStorage)* dan disinkronkan otomatis saat koneksi kembali *online*.
  * Fitur berbasis AI (Smart Parsing & Lucy Chatbot) otomatis menampilkan indikator status *Offline* dengan pesan ramah bahwa fitur AI memerlukan koneksi internet.

### Database Schema Design (Supabase PostgreSQL)

| Nama Tabel | Kolom Utama | Keterangan & Relasi |
| :--- | :--- | :--- |
| **`profiles`** | `id (PK, FK auth.users)`, `full_name`, `currency (default 'IDR')`, `created_at` | Menyimpan profil pengguna dan preferensi dasar. |
| **`wallets`** | `id (PK)`, `user_id (FK)`, `name`, `type (cash/bank/ewallet)`, `initial_balance (BIGINT)` | Menyimpan kantong/sumber dana pengguna (mendukung saldo global maupun per akun). |
| **`categories`** | `id (PK)`, `user_id (FK, nullable)`, `name`, `icon`, `color`, `type (income/expense)` | Kategori bawaan sistem (`user_id = null`) dan kategori kustom per pengguna. |
| **`transactions`** | `id (PK)`, `user_id (FK)`, `wallet_id (FK)`, `category_id (FK)`, `amount (BIGINT)`, `type (income/expense)`, `merchant`, `description`, `transaction_date`, `source (manual/ai_parsed)` | Menyimpan seluruh catatan transaksi. Menggunakan `BIGINT` untuk menghindari *floating-point error* pada Rupiah. |
| **`budgets`** | `id (PK)`, `user_id (FK)`, `category_id (FK)`, `month (YYYY-MM)`, `amount_limit (BIGINT)`, `alert_threshold (INT, default 80)` | Menyimpan batas anggaran bulanan per kategori. |

### Integration Points
* **Supabase Client SDK**: Mengelola autentikasi pengguna dan operasi CRUD/sinkronisasi data tabel (`profiles`, `wallets`, `categories`, `transactions`, `budgets`).
* **Supabase Edge Functions (`/functions/v1/ai-parse` & `/functions/v1/ai-advisor`)**: Endpoint API internal yang menghubungkan aplikasi React dengan Google Gemini API.

### Security & Privacy
* **Data Encryption**: Data dienkripsi *in-transit* (HTTPS/TLS) dan *at-rest* pada infrastruktur Supabase.
* **Row Level Security (RLS)**: Kebijakan RLS diaktifkan secara ketat pada seluruh tabel PostgreSQL (`auth.uid() = user_id`) untuk memastikan setiap pengguna hanya dapat mengakses dan memodifikasi datanya sendiri.
* **API Key Isolation**: `GEMINI_API_KEY` disimpan secara eksklusif di **Supabase Secrets (Server-side Environment Variables)** pada Edge Functions dan **tidak pernah** diekspos ke bundle frontend (`VITE_*`).

---

## 5. Risks & Roadmap

### Phased Rollout

| Fase | Cakupan Fitur | Target Utama |
| :--- | :--- | :--- |
| **Phase 1 (MVP - Basic PWA & Core)** | Setup PWA (React + Vite + Tailwind), Integrasi Supabase (Auth + DB Schema + RLS), Manajemen Dompet & Kategori Kustom, Pencatatan Manual, Ringkasan Saldo & Grafik Visual. | *Core Infrastructure & Manual Tracking* |
| **Phase 2 (v1.1 - Smart AI Layer)** | Setup Supabase Edge Functions + Gemini API, Auto-Categorization & Smart Parsing via Teks (`responseSchema`), AI Financial Advisor Chatbot (Lucy) dengan *Context Aggregation*. | *Intelligence Layer Implementation* |
| **Phase 3 (v1.2 - Proactive & Offline Maturity)** | Smart Budgeting + Proactive Warning Alert, Offline Queue Sync (IndexedDB), Optimasi Layout Desktop Multi-kolom, Ekspor Data (CSV/Excel). | *Advanced Features & Platform Maturity* |

### Technical Risks & Mitigation Strategies

| Potensi Risiko | Tingkat Dampak | Strategi Mitigasi |
| :--- | :---: | :--- |
| **AI Rate Limits / Kuota Token** | Sedang | Penggunaan kuota Free Tier Gemini API bisa melampaui batas jika *prompt* tidak dioptimalkan. **Mitigasi**: Terapkan *rate-limiting* per user di Edge Function, gunakan agregasi ringkasan data (bukan *raw dump* transaksi), dan gunakan skema JSON yang ringkas. |
| **Eksposur API Key di Client** | Tinggi | Menyimpan API key di frontend berisiko dicuri pihak ketiga. **Mitigasi**: Seluruh request ke Gemini API wajib melewati **Supabase Edge Functions** yang terproteksi JWT Auth Supabase. |
| **Perubahan Format Notifikasi Bank** | Sedang | Format teks SMS/notifikasi e-wallet dapat berubah sewaktu-waktu. **Mitigasi**: Manfaatkan fleksibilitas *few-shot prompting* dan *Structured Outputs* pada LLM (Gemini) daripada mengandalkan aturan Regex yang kaku. |
| **Konflik Data Saat Offline Sync** | Rendah - Sedang | Pengguna menginput transaksi saat tidak ada sinyal lalu membuka di perangkat lain. **Mitigasi**: Gunakan UUID v4 yang di-generate di client dan mekanisme *Last-Write-Wins (LWW)* berbasis `updated_at` timestamp saat koneksi pulih. |

---

## 3. AI System Requirements

### Tool & Model Requirements
* **AI Model/LLM**: Google Gemini API (`gemini-2.5-flash` / `gemini-2.5-flash-lite`).
* **Integration Library**: `@google/genai` SDK yang dijalankan di sisi server (**Supabase Edge Functions**).
* **AI Capabilities**:
  * **Structured Outputs (`responseSchema`)**: Menjamin output JSON deterministik pada fitur Smart Parsing (`amount`, `merchant`, `category`, `type`, `date`, `confidence`).
  * **Context Aggregation**: Mengirimkan ringkasan statistik keuangan pengguna (total per kategori, rasio budget, top pengeluaran) ke prompt Lucy Advisor untuk menghemat kuota token dan mempercepat *latency*.

### Evaluation Strategy

| Parameter Evaluasi | Target Metrik / Kriteria |
| :--- | :--- |
| **Parsing Benchmark** | Diuji menggunakan 30 variasi teks format notifikasi bank & e-wallet populer di Indonesia (GoPay, ShopeePay, OVO, BCA, Mandiri, BRI). |
| **Target Pass Rate** | Minimal **90%** variabel (`Nominal`, `Merchant`, `Kategori`, `Tipe`) terekstraksi dengan benar. |
| **Response Latency (TTFT)** | Smart Parsing dan AI Chatbot Advisor (melalui *streaming*) harus mengembalikan respons awal (*Time-to-First-Token*) dalam waktu **`<= 2 detik`**. |

---

## 4. Technical Specifications

### Architecture Overview
* **Frontend**: React.js (Vite) + Tailwind CSS (*Mobile-first responsive design*).
* **App Framework**: Progressive Web App (PWA) dengan `vite-plugin-pwa` & Service Workers agar dapat di-install ke Home Screen (HP) / Desktop App, serta mendukung *offline-first* untuk pencatatan manual.
* **Backend & Database**: **Supabase** (PostgreSQL) untuk Autentikasi Pengguna (Auth) dan Penyimpanan Data Transaksi.
* **Serverless AI Proxy**: **Supabase Edge Functions** (Deno) sebagai middleware aman yang memvalidasi sesi JWT pengguna sebelum memanggil Gemini API.
* **Offline Strategy & Graceful Degradation**:
  * Saat *offline*, input transaksi manual disimpan ke *Local Queue (IndexedDB/LocalStorage)* dan disinkronkan otomatis saat koneksi kembali *online*.
  * Fitur berbasis AI (Smart Parsing & Lucy Chatbot) otomatis menampilkan indikator status *Offline* dengan pesan ramah bahwa fitur AI memerlukan koneksi internet.

### Database Schema Design (Supabase PostgreSQL)

| Nama Tabel | Kolom Utama | Keterangan & Relasi |
| :--- | :--- | :--- |
| **`profiles`** | `id (PK, FK auth.users)`, `full_name`, `currency (default 'IDR')`, `created_at` | Menyimpan profil pengguna dan preferensi dasar. |
| **`wallets`** | `id (PK)`, `user_id (FK)`, `name`, `type (cash/bank/ewallet)`, `initial_balance (BIGINT)` | Menyimpan kantong/sumber dana pengguna (mendukung saldo global maupun per akun). |
| **`categories`** | `id (PK)`, `user_id (FK, nullable)`, `name`, `icon`, `color`, `type (income/expense)` | Kategori bawaan sistem (`user_id = null`) dan kategori kustom per pengguna. |
| **`transactions`** | `id (PK)`, `user_id (FK)`, `wallet_id (FK)`, `category_id (FK)`, `amount (BIGINT)`, `type (income/expense)`, `merchant`, `description`, `transaction_date`, `source (manual/ai_parsed)` | Menyimpan seluruh catatan transaksi. Menggunakan `BIGINT` untuk menghindari *floating-point error* pada Rupiah. |
| **`budgets`** | `id (PK)`, `user_id (FK)`, `category_id (FK)`, `month (YYYY-MM)`, `amount_limit (BIGINT)`, `alert_threshold (INT, default 80)` | Menyimpan batas anggaran bulanan per kategori. |

### Integration Points
* **Supabase Client SDK**: Mengelola autentikasi pengguna dan operasi CRUD/sinkronisasi data tabel (`profiles`, `wallets`, `categories`, `transactions`, `budgets`).
* **Supabase Edge Functions (`/functions/v1/ai-parse` & `/functions/v1/ai-advisor`)**: Endpoint API internal yang menghubungkan aplikasi React dengan Google Gemini API.

### Security & Privacy
* **Data Encryption**: Data dienkripsi *in-transit* (HTTPS/TLS) dan *at-rest* pada infrastruktur Supabase.
* **Row Level Security (RLS)**: Kebijakan RLS diaktifkan secara ketat pada seluruh tabel PostgreSQL (`auth.uid() = user_id`) untuk memastikan setiap pengguna hanya dapat mengakses dan memodifikasi datanya sendiri.
* **API Key Isolation**: `GEMINI_API_KEY` disimpan secara eksklusif di **Supabase Secrets (Server-side Environment Variables)** pada Edge Functions dan **tidak pernah** diekspos ke bundle frontend (`VITE_*`).

---

## 5. Risks & Roadmap

### Phased Rollout

| Fase | Cakupan Fitur | Target Utama |
| :--- | :--- | :--- |
| **Phase 1 (MVP - Basic PWA & Core)** | Setup PWA (React + Vite + Tailwind), Integrasi Supabase (Auth + DB Schema + RLS), Manajemen Dompet & Kategori Kustom, Pencatatan Manual, Ringkasan Saldo & Grafik Visual. | *Core Infrastructure & Manual Tracking* |
| **Phase 2 (v1.1 - Smart AI Layer)** | Setup Supabase Edge Functions + Gemini API, Auto-Categorization & Smart Parsing via Teks (`responseSchema`), AI Financial Advisor Chatbot (Lucy) dengan *Context Aggregation*. | *Intelligence Layer Implementation* |
| **Phase 3 (v1.2 - Proactive & Offline Maturity)** | Smart Budgeting + Proactive Warning Alert, Offline Queue Sync (IndexedDB), Optimasi Layout Desktop Multi-kolom, Ekspor Data (CSV/Excel). | *Advanced Features & Platform Maturity* |

### Technical Risks & Mitigation Strategies

| Potensi Risiko | Tingkat Dampak | Strategi Mitigasi |
| :--- | :---: | :--- |
| **AI Rate Limits / Kuota Token** | Sedang | Penggunaan kuota Free Tier Gemini API bisa melampaui batas jika *prompt* tidak dioptimalkan. **Mitigasi**: Terapkan *rate-limiting* per user di Edge Function, gunakan agregasi ringkasan data (bukan *raw dump* transaksi), dan gunakan skema JSON yang ringkas. |
| **Eksposur API Key di Client** | Tinggi | Menyimpan API key di frontend berisiko dicuri pihak ketiga. **Mitigasi**: Seluruh request ke Gemini API wajib melewati **Supabase Edge Functions** yang terproteksi JWT Auth Supabase. |
| **Perubahan Format Notifikasi Bank** | Sedang | Format teks SMS/notifikasi e-wallet dapat berubah sewaktu-waktu. **Mitigasi**: Manfaatkan fleksibilitas *few-shot prompting* dan *Structured Outputs* pada LLM (Gemini) daripada mengandalkan aturan Regex yang kaku. |
| **Konflik Data Saat Offline Sync** | Rendah - Sedang | Pengguna menginput transaksi saat tidak ada sinyal lalu membuka di perangkat lain. **Mitigasi**: Gunakan UUID v4 yang di-generate di client dan mekanisme *Last-Write-Wins (LWW)* berbasis `updated_at` timestamp saat koneksi pulih. |

