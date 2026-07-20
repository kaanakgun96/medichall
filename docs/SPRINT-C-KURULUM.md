# MedicHall — Sprint C: Kayıtlı Aramalar + Günlük E-posta Digest

**Tarih:** 20 Temmuz 2026
**Paket:** 3 dosya — `202607200003_saved_searches.sql` + `tender-digest.ts` + `portal.html`
**Ön koşul:** Sprint A + EN normalize katmanı kurulu (ikisi de canlında ✓)

---

## Ne yapıyor?

Filtre zincirinin son halkası. Kullanıcı feed'de filtre kurar → **💾 Save this
search** → çip olarak kaydedilir. Her sabah 07:00 UTC'de (sync + çeviri +
skorlamadan 30 dk sonra) `tender-digest` fonksiyonu koşar: her kayıtlı arama
için **son korşudan beri beslemeye YENİ düşen** ihaleleri bulur ve kullanıcıya
Resend ile TEK e-posta gönderir (birden çok araması varsa aynı mailde
bölümlenir).

Senin verdiğin iki karar aynen uygulandı:
- **Günlük** digest (haftalık değil)
- Tetik: **kullanıcının kaydettiği aramaya düşen her yeni ihale** (sabit %80
  skor eşiği değil — kontrol kullanıcıda; 🔔/🔕 ile arama başına aç/kapa)

İlkeler:
- **Yeni ihale yoksa e-posta GİTMEZ.** "0 sonuç" maili yok — gürültüsüz bildirim.
- Mailde orijinal başlık + varsa *"EN (machine translation)"* satırı; değerde
  orijinal + varsa "≈ EUR" (ECB) — portaldaki dürüstlük kuralları mailde de aynı.
- Gönderim patlarsa damga atılmaz → ihaleler kaybolmaz, ertesi sabah yeniden
  denenir.

## Kurulum

### 0. Resend secret'ları (bir kere)
Edge Functions → Secrets:
- `RESEND_API_KEY` → Resend panelindeki API anahtarın
- (opsiyonel) `DIGEST_FROM` → gönderen adres, varsayılan
  `MedicHall <alerts@medichall.com>`. **Not:** bu adresin alan adı
  (medichall.com) Resend'de doğrulanmış olmalı — Resend → Domains'te
  "verified" görünüyor mu kontrol et; değilse önce orayı tamamla, yoksa
  gönderimler 403 alır.

### 1. Migration
SQL Editor → dosyayı aç, **önce içindeki `BURAYA_CRON_SECRET_YAZ` metnini
kendi CRON_SECRET değerinle değiştir** (en altta, 1 yerde) → Run.
Kurduğu şeyler: `saved_searches` tablosu (RLS: herkes yalnız kendi kayıtları;
kullanıcı başına 20 tavan), **search_tenders v4** (`p_created_after` — digest
"yenileri" bununla çeker; portal çağrıları etkilenmez), digest RPC'leri,
07:00 UTC pg_cron zamanlaması.

### 2. tender-digest fonksiyonu
Edge Functions → **yeni fonksiyon** oluştur, adı `tender-digest` →
`tender-digest.ts` içeriğini yapıştır → Deploy.
### 🚨 Verify JWT: **KAPALI** (ted-sync gibi x-cron-secret ile korunur)

### 3. portal.html
GoDaddy → üzerine yaz → Ctrl+F5. (Taban: EN normalize'lı son sürüm — bugüne
kadarki her şey tek dosyada.)

### 4. İlk test (cron'u beklemeden)
Portal → All tenders → bir filtre kur (ör. CPV 3314) → **Save this search**.
Sonra elle tetikle:
```bash
curl -X POST 'https://azdmuarzntzqdyirysux.supabase.co/functions/v1/tender-digest' \
  -H 'x-cron-secret: <CRON_SECRET>' -H 'Content-Type: application/json' -d '{}'
```
İlk çağrıda büyük ihtimalle `emails_sent: 0` görürsün — **bu doğru
davranış**: kayıt anından beri yeni ihale düşmediyse mail gitmez. Gerçek
test ertesi sabah 07:00 sonrası gelen mail; sabırsızsan SQL ile bir aramanın
`last_digest_at`'ını düne çek, yeniden tetikle:
```sql
update saved_searches set last_digest_at = now() - interval '1 day';
```

## Doğrulama

- [ ] Save this search → çip beliriyor; filtre boşken kaydetmeye izin yok
- [ ] Çipe tıkla → filtreler geri doluyor; 🔔→🔕 tıklanınca toast + kalıcı
- [ ] × ile silme çalışıyor
- [ ] Elle tetik yanıtı `ok: true` + `searches_checked` doğru sayı
- [ ] `last_digest_at`'ı geri çekip tetikleyince mail geliyor; mailde
      orijinal başlık + EN satırı + "≈ EUR" biçimi doğru
- [ ] `send_errors` boş (doluysa çoğu zaman Resend domain doğrulaması eksiktir)

## Test edildi

- ✅ Migration tam yığında 2 kez (idempotent) — cron bloğu hariç: pg_cron
  uzantısı yerelde yok (Supabase'e özgü), o blok canlıdaki ted_cron ile
  birebir aynı desen
- ✅ RLS: kullanıcı yalnız kendi aramalarını görüyor (2 kullanıcılı test)
- ✅ Digest seçimi yalnız email_alerts=true olanları döndürüyor
- ✅ `p_created_after`: yeni ihale geliyor, eskiler elenmiyor/eleniyor ayrımı doğru
- ✅ tender-digest: tsc typecheck + esbuild bundle temiz
- ✅ Portal: JS sözdizimi + playwright (kaydet/çip/uygula/🔔-🔕/sil, boş filtre
  reddi) + ekran görüntüsü
- ⚠️ Test edilemedi: Resend'e canlı gönderim (sandbox'ta API key yok) ve
  auth.admin ile e-posta çekimi. İlk elle tetikte `send_errors` alanına bak.

## Sırada

Sprint D (CSV/PDF export + takvim) hâlâ backlog'da. Bir de bu üç paketi
(EN normalize + CPV seçici + Sprint C) repoya push'lamak için yeni token
lazım olacak — Contents: Read and write, artık ezbere biliyorsun. 😊
