# MedicHall — İngilizce Normalize Katmanı (v1.5)

**Tarih:** 20 Temmuz 2026
**Paket:** 3 dosya — migration + `ted-sync-v15.ts` + `portal.html`
**Onaylı maliyet:** ~1-2 $/ay + tek seferlik backfill ~1 $ (Haiku 1$/5$ MTok, günde ~20 ihale × ~700 karakter — senin sorgu çıktınla hesaplandı)

---

## Ne çözüyor?

İki şeyi birden:

1. **Arama:** "ultrasound" yazınca artık "Ultraschallsonden-Schutzhüllen"
   başlıklı Alman ihalesi de bulunur — arama hem orijinal hem İngilizce
   kolonları tarar. (Test kanıtı aşağıda.)
2. **PRODUCT %0 hastalığı:** Match engine'in keyword skoru artık İngilizce
   kolonları da tarıyor. Profil keyword'lerin İngilizce, ihale metni değildi;
   ekranında gördüğün "PRODUCT 0%" bundandı. Yerel testte aynı senaryo:
   çeviri öncesi keyword_score **0** / toplam **30** → sonrası keyword **50**
   / toplam **55**. (50 doğru: 2 keyword'den 1'i geçiyor.)

Beklenti çerçevesi (dürüstlük): bu katman **başlık/açıklamada geçen** ürünü
dil fark etmeksizin bulunur yapar. Senin sorgularının gösterdiği asıl gerçek —
ihalelerin ~%98'inin başlığında ürün adı HİÇ geçmiyor — değişmez; o bölge CPV
seçici + derin analizin işi.

## Kurulum (sıra önemli)

### 1. Migration
SQL Editor → `202607200002_english_normalization.sql` → Run. (İdempotent.)
Kurduğu şeyler: `title_en` / `description_en` / `translation_status`
kolonları; **search_tenders v3** (EN kolonları da tarar, kartlar için
title_en döndürür); **refresh_company_opportunity_matches** güncellemesi —
fonksiyon metni repodaki canlı sürümden birebir alınıp yalnız 2 keyword
samanlığı ifadesi genişletildi, başka satırına dokunulmadı.

### 2. ted-sync v1.5
Edge Functions → ted-sync → kodu `ted-sync-v15.ts` ile değiştir → Deploy.
**Verify JWT: KAPALI** (her zamanki gibi).
Yeni adım 4c: pending ihaleleri 10'arlı partilerle Haiku'ya çevirtir,
koşu başına 60 tavan. Çeviri patlarsa **sync durmaz**, satır pending kalır,
ertesi sabah yeniden denenir. Yanıtta `translated` ve `translate_error`
alanları.

### 3. Backfill (tek seferlik, ~1 $)
Mevcut ~600 kaydı doldurmak için elle tetikle:
```bash
curl -X POST '<SUPABASE_PROJECT_URL>/functions/v1/ted-sync' \
  -H 'x-cron-secret: <CRON_SECRET>' -H 'Content-Type: application/json' \
  -d '{"lookback_days":1,"max_pages":1,"translate_backlog":600}'
```
Yanıtta `"translated": ~600` görmelisin (birkaç dakika sürebilir). Sonra
eşleşmelerin İngilizce metinle yeniden skorlanması aynı yanıt içinde zaten
olur (`companies_refreshed`).

### 4. portal.html
GoDaddy'ye üzerine yaz → Ctrl+F5. Kartlarda orijinal başlığın altında
*"EN (machine translation): …"* satırı görünür — çevirinin makine işi olduğu
her yerde açık etiketli, orijinal asla gizlenmez.

## Doğrulama

```sql
-- Çeviri ilerleme durumu
select translation_status, count(*) from tenders where status='open' group by 1;
-- Arama testi (backfill sonrası)
select title, title_en from search_tenders(p_query => 'ultrasound') limit 5;
```
Portal: All tenders'ta "gloves" ara → yerel dilli ihalelerin gelmesi; bir
ihalede Find matches sonrası PRODUCT göstergesinin artık 0 olmaması
(profil keyword'ü ihale metninde gerçekten karşılığı varsa).

## Test edildi

- ✅ Migration, repodaki GERÇEK motor migration'ları (0003+0004+0005) üstüne
  kurulu tam yığında 2 kez koştu (idempotent)
- ✅ **Altın test:** İngilizce keyword'lü profil × Almanca ihale —
  keyword 0→50, toplam 30→55; "ultrasound" araması Almanca ihaleyi buldu
- ✅ ted-sync v1.5: tsc typecheck + esbuild bundle temiz
- ✅ Çeviri yanıtı işleme (node birim testi): temiz JSON, ```json çitli
  yanıt, modelin uydurduğu id'nin süzülmesi
- ✅ Portal JS sözdizimi
- ⚠️ Test edilemedi: Anthropic'e canlı çeviri çağrısı (sandbox'ta API key
  yok). İlk koşuda `translated` ve `translate_error` alanlarına bak;
  `translate_error` doluysa bana at.

## Notlar

- `TRANSLATE_MODEL` secret'ıyla çeviri modeli ayrıca seçilebilir (varsayılan
  ANTHROPIC_MODEL → claude-haiku-4-5 zinciri).
- İngilizce yazılmış ihalelerde model metni olduğu gibi döndürür — ayrıca
  dil tespiti maliyeti yerine bu basit yol seçildi (fark kuruş mertebesi).
- Sıradaki doğal adım hâlâ Sprint C: saved searches + günlük digest — artık
  İngilizce aranabilir bir beslemenin üstüne kurulacak, tam zamanı.
