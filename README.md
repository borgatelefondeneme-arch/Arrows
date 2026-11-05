# Ok Küp 🧊➜🐥

Küpün (ve ileriki bölümlerde dikdörtgen prizma, piramit, merdiven, elmas, çerçeve…) üzerindeki
okları temizleyip ortadaki kafeste kilitli tatlı karakteri kurtardığın 3D bulmaca oyunu.
iPhone'da Safari'de çalışır; **Ana Ekrana Ekle** ile uygulama gibi tam ekran açılır.

## Kurallar
- Bir bloğa dokun → blok **sadece okunun ucunun gösterdiği yöne** uçar.
- Yolunda başka blok ya da kafes varsa **çarpar** ve geri döner (oklar birbirinin içinden geçemez).
  Çarpınca 1,2 sn sersemlersin.
- ⦿ = ok sana bakıyor, ⊗ = okun kuyruğu.
- Tüm oklar temizlenince kafesin kilidi açılır, karakter kurtulur.
- **Puan** bitirme süresine göre: hızlı = çok puan + 3 ⭐. 💡 ipucu +5 sn ekler.
- Bir parmakla döndür, iki parmakla büyüt/küçült (ya da ＋/－ düğmeleri).

## Bölümler
20 el yapımı bölüm kolaydan zora gider (3×3×3 artı şeklinden 6×6×6 usta küpe), sonra sonsuz
bölümler gelir. Bulmacalar tersten üretilir, bu yüzden **her bölümün çözümü vardır ve asla
kilitlenmez** (bkz. `public/js/puzzle.js`).

## VS (arkadaşınla düello)
1. **Arkadaşlar & VS** ekranında adını yaz; 6 karakterlik **arkadaş kodunu** paylaş.
2. Arkadaşın kodunu ekleyince ikiniz de birbirinizin listesine eklenirsiniz.
3. **⚔️ VS** → ikinizin de açtığı **ortak bölümlerden** birini seç → davet gönder.
4. Kabul edilince ikinize de **aynı bulmaca** gelir, sunucu aynı anda 3-2-1 geri sayımı başlatır.
5. Karakteri **ilk kurtaran** kazanır (sunucunun saatine göre). Rakibin ilerlemesini canlı görürsün.

## Çalıştırma
```bash
npm install
npm start          # http://localhost:3000
npm test           # bulmaca + sunucu testleri
```
Sunucu açılınca aynı Wi-Fi'deki iPhone için adresi yazdırır (`http://192.168.x.x:3000`).
Arkadaşınla internet üzerinden oynamak için sunucuyu bir yere yayınla (Dockerfile hazır; ör.
Render, Fly.io, Railway). Oyuncu verisi `DATA_FILE` (varsayılan `data/players.json`) dosyasında tutulur.

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket portu |
| `HOST` | `0.0.0.0` | Dinlenen adres |
| `DATA_FILE` | `data/players.json` | Oyuncular ve arkadaş listeleri |

## Yapı
- `public/js/puzzle.js` – bulmaca üretici, kurallar, puanlama (tarayıcı + sunucu ortak)
- `public/js/scene.js` – Three.js sahnesi, oklar, kafes, karakter, animasyonlar
- `public/js/main.js` – ekranlar, oyun akışı, VS
- `server/game-server.js` – Express + WebSocket: arkadaşlar, davetler, maçlar
