# MedicHall — Sprint B: İhale Filtre Arayüzü (portal.html)

**Tarih:** 19 Temmuz 2026
**Paket içeriği:** 1 dosya (`portal.html` — tam dosya, hazır-deploy)
**Ön koşul:** ⚠️ **Sprint A kurulu olmalı** (migration + ted-sync v1.4)

---

## Bu sürümde ne değişti

Hepsi **Opportunities → 🌍 All tenders** modunda; My matches moduna ve diğer
sekmelere DOKUNULMADI.

1. **"Filters" butonu** — arama çubuğunun yanında, yalnız besleme modunda
   görünür. Üstündeki rozet kaç filtrenin etkin olduğunu gösterir.
2. **Açılır filtre paneli:**
   - **CPV code / family** — "3319" yazınca 33190000 VE 33192000 ailesi gelir
     (kontrol haneli "33190000-8" de, boşluklu kirli girdi de çalışır;
     virgülle birden fazla kod girilebilir)
   - **Deadline within** — 7 / 30 / 90 gün
   - **Notice type** — beslemede gerçekten var olan türlerden dolar
     (uydurma seçenek yok; liste `tender_filter_facets()`'ten gelir)
   - **Estimated value (EUR)** min–max + **"Include tenders with no stated
     value"** onay kutusu — **varsayılan işaretli.** Değer aralığı girsen
     bile değeri belirtilmemiş ihaleler listede kalır; ancak kutuyu bilerek
     kaldırırsan elenirler. Hiçbir ihale sessizce kaybolmaz.
3. **Kartlarda değer gösterimi:** orijinal değer HER ZAMAN önce —
   `2,400,000 PLN (≈ 564,000 EUR)`. EUR karşılığı yalnız ECB kuru varsa
   gösterilir; kur yoksa sadece orijinal görünür. Panel altında hangi günün
   ECB kuruyla çevrildiği yazar.
4. **Sonuç sayacı:** "128 open tenders match these filters" — sunucudan gelen
   gerçek toplam (`total_count`), sayfalamayla tutarlı.
5. **Altyapı değişimi:** `loadFeed()` artık PostgREST query string yerine
   `search_tenders()` RPC'sini çağırıyor (CPV aile araması query string'le
   yapılamıyordu). Ülke listesi de 1000 satır çekmek yerine tek
   `tender_filter_facets()` çağrısı.
6. **Savunmalı düşüş:** Sprint A migration kurulu değilse sayfa kırılmaz —
   beslemede "Advanced filters need a database update" kutusu çıkar ve hangi
   SQL'in eksik olduğunu söyler. Ülke listesi de eski 1000-satır yöntemine
   düşer.

## Kurulum

1. Zip'ten çıkan `portal.html`'i GoDaddy cPanel → File Manager ile mevcut
   `portal.html`'in ÜZERİNE yükle.
2. Tarayıcıda **Ctrl+F5** (önbellek!).
3. Portala gir → Opportunities → **🌍 All tenders** → **Filters** butonuna bas.

## Doğrulama listesi

- [ ] Filters butonu yalnız All tenders modunda görünüyor (My matches'te yok)
- [ ] CPV kutusuna `3319` yaz → hem 33190xxx hem 33192xxx CPV'li ihaleler geliyor
- [ ] Notice type dropdown'ı doluyor (boşsa: Sprint A migration'daki backfill
      çalışmamış demektir — bana yaz)
- [ ] PLN/SEK/HUF ihalelerinde `(≈ … EUR)` görünüyor (görünmüyorsa ted-sync
      v1.4 yanıtındaki `fx_error` alanına bak)
- [ ] Min–Max değer gir, "Include tenders with no stated value" işaretliyken
      değersiz ihaleler listede; kaldırınca eleniyor
- [ ] "Clear filters" her şeyi varsayılana döndürüyor (kutu yeniden işaretli)
- [ ] Load 20 more ile sayfalama, üstteki toplam sayıyla tutarlı

## Test edildi

- ✅ JS sözdizimi (node --check, her iki script bloğu)
- ✅ HTML'den çağrılan tüm fonksiyonlar tanımlı; yeni id'lerin tamamı DOM'da
- ✅ Playwright ile davranış testi (mock Supabase):
  filtre paneli açılıyor, facets doluyor, RPC'ye giden parametreler doğru
  (CPV/değer/checkbox/deadline), rozet sayısı doğru, Clear varsayılana
  dönüyor, Sprint A yokken düşüş mesajı çıkıyor, matches modunda panel gizli
- ✅ Playwright ekran görüntüleriyle görsel doğrulama (tasarım dili: Inter,
  teal paleti, uppercase etiketler — mevcut portala birebir)

## Bilinen sınırlar

- Filtreler **beslemeye** uygulanır; My matches modunun kendi filtreleri
  (skor/tür) olduğu gibi duruyor.
- Ülke seçimi şimdilik tekli (mevcut dropdown korundu). Çoklu ülke seçimi
  istersen Sprint C'de saved search ile birlikte yaparız — RPC zaten dizi
  kabul ediyor (`p_countries`), UI'ı hazır.
- `FEED_COUNTRIES` değişkeni artık kullanılmıyor ama zararsız; büyük temizliği
  ayrı yapmamak için bilerek bırakıldı (tek amaçlı, küçük diff ilkesi).

## Sırada: Sprint C — Saved searches + günlük digest

Bu filtre setinin "kaydet" hali: `saved_searches` tablosu (filtre JSON'u +
isim), portalda "Save this search" butonu, pg_cron ile her sabah yeni düşen
ihaleleri Resend üzerinden e-postayla gönderme (senin kararın: günlük, tetik
kullanıcının kaydettiği arama).

Başlamadan önce Sprint A doğrulama sorgularının çıktısı hâlâ bende değil —
özellikle "değeri belirtilmemiş ihale yüzdesi". Digest e-postasında değer
bilgisini nasıl göstereceğimizi o oran belirleyecek.
