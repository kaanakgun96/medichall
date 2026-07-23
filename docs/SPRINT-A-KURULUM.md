# MedicHall — Sprint A: İhale Filtreleri Veri Katmanı

**Tarih:** 17 Temmuz 2026
**Paket içeriği:** 2 dosya
**Tahmini kurulum süresi:** 10 dakika

---

## ⚠️ ÖNCE ŞUNU OKU — Canlıda bir hata var

`ted-sync` **v1.3 canlıda bozuk.** Kodun 290. satırı tanımlanmamış bir
değişkeni (`profiles`) kullanıyor. v1.3'te ülke kısıtı kaldırılırken, o kısıtı
üreten blok silinmiş — ama blok aynı zamanda `company_match_profiles`'ı çeken
sorguyu da içeriyormuş. Döngü kaldı, veri kaynağı gitti.

Bunu TypeScript derleyicisiyle doğruladım:

```
old.ts(290,19): error TS2304: Cannot find name 'profiles'.
```

**Pratikte ne oluyor:**

| Adım | Durum |
|---|---|
| TED'den ihaleler çekiliyor | ✅ çalışıyor |
| `tenders` tablosuna yazılıyor | ✅ çalışıyor (döngüden ÖNCE) |
| Adım 5: eşleşme tazeleme | 💥 ReferenceError |
| `refresh_company_opportunity_matches` | ❌ **hiç çağrılmıyor** |

Yani **ihaleler her sabah geliyor ama kimsenin eşleşmeleri yenilenmiyor.**
Dıştaki `catch` bloğu HTTP **200** döndürdüğü için pg_cron da bunu "başarılı"
sanıyor — sessiz arıza. Kullanıcı portalda elle **Find matches**'e bastığında
çalıştığı için fark edilmemiş.

### Kurulumdan ÖNCE teyit et

Supabase → Edge Functions → `ted-sync` → **Logs**. Ya da elle tetikle:

```bash
curl -X POST '<SUPABASE_PROJECT_URL>/functions/v1/ted-sync' \
  -H 'x-cron-secret: <CRON_SECRET>' \
  -H 'Content-Type: application/json' \
  -d '{"lookback_days":2,"max_pages":1}'
```

Şunu görüyorsan hata doğrulanmıştır:

```json
{ "ok": false, "fatal": "ReferenceError: profiles is not defined" }
```

**Eğer bunu GÖRMÜYORSAN** (yani `companies_refreshed` alanlı normal bir yanıt
geliyorsa): canlıdaki sürüm bana verdiğin dosya değil demektir. O durumda
**dur, bana haber ver** — canlı dosyayı görmeden üzerine yazmayalım.

---

## Kurulum

### Adım 1 — Migration (önce bu)

Supabase → **SQL Editor** → `202607170001_tender_filters.sql` içeriğini
yapıştır → **Run**.

Dosya idempotent: iki kez çalıştırırsan hata vermez, veriyi bozmaz.

Ne kuruyor:

1. **`tenders.notice_type` kolonu + geriye dönük doldurma.**
   TED bu veriyi zaten gönderiyordu (`fields` listesinde `notice-type` var) ama
   satıra yazılmıyordu. Neyse ki `raw_payload` tüm bildirimi saklıyor →
   **TED'i yeniden taramaya gerek yok**, mevcut kayıtlar SQL ile dolduruluyor.
2. **`cpv_codes_norm`** generated column + GIN indeks. Kontrol hanesi atılır
   (`33190000-8` → `33190000`), böylece aile araması çalışır.
3. **`fx_rates`** tablosu — ECB resmi günlük kurları.
4. **`estimated_value_eur`** + **`eur_rate_as_of`** kolonları + tazeleme
   fonksiyonu.
5. **`search_tenders()`** RPC — tüm filtreler tek çağrıda.
6. **`tender_filter_facets()`** RPC — ülke/tür/para birimi listeleri.

### Adım 2 — ted-sync v1.4 deploy

Supabase → Edge Functions → `ted-sync` → kodu **`ted-sync-v14.ts`** ile
tamamen değiştir → Deploy.

> ### 🚨 Verify JWT ayarı: **KAPALI**
> `ted-sync` `x-cron-secret` başlığıyla korunuyor, JWT ile değil. Verify JWT
> AÇIK bırakırsan cron 401 alır. En sık yapılan kurulum hatası bu.

### Adım 3 — Doğrula

```bash
curl -X POST '<SUPABASE_PROJECT_URL>/functions/v1/ted-sync' \
  -H 'x-cron-secret: <CRON_SECRET>' \
  -H 'Content-Type: application/json' \
  -d '{"lookback_days":7,"max_pages":2}'
```

Beklenen yanıt — **`ok: true`** ve `companies_refreshed` **0'dan büyük**
(profili olan firma sayısı kadar):

```json
{
  "ok": true,
  "fetched": 340,
  "upserted": 340,
  "fx_rates_updated": 31,
  "fx_as_of": "2026-07-17",
  "fx_error": null,
  "companies_refreshed": 3,
  "refresh_errors": []
}
```

Sonra SQL Editor'de:

```sql
-- notice_type doldu mu?
select notice_type, count(*) from tenders where status='open'
group by 1 order by 2 desc;

-- EUR çevirisi çalışıyor mu? (orijinal değer korunmalı)
select currency, count(*), min(estimated_value_eur), max(estimated_value_eur)
from tenders where status='open' and estimated_value_eur is not null
group by 1;

-- Kaç ihalenin değeri belirtilmemiş? (null filtresi kararı bunun için önemliydi)
select count(*) filter (where estimated_value is null) as degeri_yok,
       count(*) as toplam
from tenders where status='open';

-- CPV aile araması: '3319' hem 33190000 hem 33192000 getirmeli
select title, cpv_codes from search_tenders(p_cpv => array['3319']) limit 5;
```

---

## Kararların gerekçesi

### Para birimi: ECB kurları (senin seçtiğin (c) şıkkı)

Test verisinde somutlaştı:

| İhale | Orijinal | EUR karşılığı |
|---|---|---|
| Polonya | 2.400.000 PLN | ≈ 564.000 € |
| Macaristan | 180.000.000 HUF | ≈ 459.000 € |
| İsveç | 12.000.000 SEK | ≈ 1.056.000 € |

Çeviri olmasaydı Macaristan ihalesi (180 milyon!) beslemedeki **en büyük**
ihale görünürdü; gerçekte orta boy. "500K–2M €" filtresi çevirisiz tamamen
yanıltıcı olurdu.

**Uydurma kur yok:** ECB resmi kaynak, günlük, ücretsiz, anahtar gerektirmiyor.
`eur_rate_as_of` kolonu hangi günün kuruyla çevrildiğini saklıyor — UI'da
"≈ 564.000 € (ECB kuru, 17.07.2026)" diye gösterebiliriz. **Orijinal değer ve
para birimi hiçbir zaman silinmiyor**, ikisi birden gösterilecek.

**Kur bulunamazsa:** `estimated_value_eur` NULL kalır, çeviri gösterilmez,
o ihale "değeri bilinmeyen" muamelesi görür. ECB erişilemezse sync **durmaz** —
kur bloğu try/catch içinde, hatayı `fx_error` alanında raporlar.

### Null değerler: kullanıcı kontrolünde (senin kararın)

`search_tenders(p_include_unknown_value => true)` **varsayılan**. Yani değer
aralığı filtresi açıkken bile, değeri belirtilmemiş ihaleler listede kalır.
Testte kanıtlandı:

```
500K-2M EUR, "Value not stated" AÇIK   → 4 sonuç (biri değersiz ihale)
500K-2M EUR, "Value not stated" KAPALI → 3 sonuç
```

Kullanıcı bilerek kapatmadıkça hiçbir ihale sessizce kaybolmuyor. Bu, "skorlama
≠ filtre" ilkesinin devamı.

### Neden RPC, neden PostgREST query string değil?

CPV aile eşleşmesi **prefix** araması gerektiriyor (`3319%`). PostgREST'in
dizi operatörleri (`cs.`, `ov.`) tam eşleşme yapar, prefix yapamaz. Yani
kullanıcı "3319" yazınca hiçbir şey bulamazdı. Ayrıca `total_count` ile
sayfalamayı tek çağrıda çözüyoruz.

---

## Test edildi (Sprint B'ye geçmeden önce)

Canlı şemanın birebir kopyası üstünde, gerçek TED veri şekilleriyle:

- ✅ Migration iki kez çalıştırıldı, hata yok (idempotent)
- ✅ `notice_type` backfill — TED'in **3 farklı** formatı da çözüldü:
  `{"eng":["Contract notice"]}`, `"cn-standard"`, `["Contract notice"]`;
  `notice-type` hiç yoksa NULL kalıyor
- ✅ CPV normalizasyonu: `33141420-0` → `33141420`
- ✅ CPV aile araması: `3319` → 33190000 **ve** 33192000 ✓
- ✅ Kirli girdi: `"33 19"` ve `"33190000-8"` ikisi de doğru çalışıyor
- ✅ EUR çevirisi, orijinal değer korunarak
- ✅ Null değer davranışı — her iki yönde
- ✅ Deadline aciliyeti filtresi
- ✅ Kapalı ihale sızıntısı **yok** (`status='open'` zorlanıyor)
- ✅ `total_count` sayfalamayla tutarlı (limit 2 → 2 satır, total 6)
- ✅ ted-sync v1.4: TypeScript typecheck temiz + esbuild bundle başarılı
- ✅ ECB XML ayrıştırma, gerçek format örneğiyle

**Test edilemedi:** ECB'nin canlı endpoint'i — sandbox'ımda
`ecb.europa.eu` ağ izni yok. Ayrıştırma mantığını ECB'nin gerçek XML
formatına birebir uyan örnekle doğruladım, ama ilk deploy'da
`fx_as_of` ve `fx_rates_updated` alanlarına bakmanı isterim. `fx_error`
doluysa bana at.

---

## Sırada ne var (Sprint B)

Bu katman oturduktan sonra `portal.html` filtre UI'ı:

- CPV arama kutusu (aile eşleşmesi hazır)
- Deadline aciliyeti: Bu hafta / Bu ay / Bu çeyrek
- Değer aralığı + "Value not stated" onay kutusu
- Notice type çoklu seçim
- `fillFeedCountries()` → `tender_filter_facets()` (şu an ülke listesi için
  1000 satır çekiyor, tek çağrıya inecek)
- `loadFeed()` → `search_tenders()` RPC

**Bana lazım:** Adım 3'teki doğrulama sorgularının çıktısı. Özellikle "kaç
ihalenin değeri belirtilmemiş" sorusu — oran yüksekse (%50+) değer filtresini
UI'da nasıl konumlandıracağımızı yeniden düşünmemiz gerekebilir.
