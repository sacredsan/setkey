# Setkey — Harmonic playlist builder

**TR** · Müzik klasörünü analiz et (BPM, ton/Camelot, enerji), harmonik geçişli playlist'ler oluştur, Rekordbox'a gönder ve USB'ye sırayla kopyala. **Tamamen tarayıcıda çalışır; dosyaların bilgisayarından çıkmaz.**

**EN** · Analyze your music folder (BPM, key/Camelot, energy), build harmonic playlists, send them to Rekordbox and copy them to USB in order. **Runs entirely in your browser; your files never leave your computer.**

👉 **https://setkey.pages.dev**

## Özellikler / Features
- Essentia.js ile tarayıcıda BPM, ton ve enerji analizi · In-browser BPM/key/energy analysis with Essentia.js
- Akıllı ve BPM kilitli playlist motorları, Camelot çarkı, BPM eğrisi · Smart & BPM-locked engines, Camelot wheel, BPM curve
- Rekordbox XML içe/dışa aktarma, karşılaştırma ve ton kalibrasyonu · Rekordbox XML import/export, comparison and key calibration
- USB'ye numaralı kopyalama + playlist.m3u · Numbered copy to USB + playlist.m3u
- Kopya şarkı bulma (silmez, `_kopyalar` klasörüne taşır) · Duplicate finder (moves, never deletes)
- WAV → MP3 (320 kbps, BPM/ton etiketleriyle) · WAV → MP3 (320 kbps, with BPM/key tags)
- "Kullanıldı" işareti ve "Bunun yerine" önerileri · "Used" marks and "replace with" suggestions

## Gizlilik / Privacy
Sunucu yok, hesap yok, çerez yok. Analiz sonuçları seçtiğin klasördeki `setkey-kutuphane.json` dosyasına yazılır.
No server, no accounts, no cookies. Results are stored in `setkey-kutuphane.json` inside the folder you pick.

## Tarayıcı / Browser
Google Chrome veya Microsoft Edge (bilgisayar). · Google Chrome or Microsoft Edge on desktop (File System Access API).

## Geliştirme / Development
Derleme adımı yok; sabit dosyalar. Yerelde denemek için: `python -m http.server 8080` → http://localhost:8080
Mantık testleri: `node tests/logic.test.mjs` · Essentia testi: `tests/essentia.html`

## Lisans / License
AGPL-3.0. Essentia.js © Music Technology Group, Universitat Pompeu Fabra — AGPL-3.0 (`vendor/`).
LAME MP3 kodlayıcı / encoder: lamejs — LGPL-3.0 (`vendor/lame.min.js`).
