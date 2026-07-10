# MedicHall Match Engine v1.1

Bu paket, Match Engine v1 veri modelini çalıştırılabilir ve daha güvenli hale getirir.

## Düzeltilen güvenlik konusu

v1 taslağında şirket sahibi `opportunity_matches` satırını doğrudan güncelleyebiliyordu. Bu durum teorik olarak `match_score`, `reasons` veya `ai_summary` gibi sistem alanlarının değiştirilmesine izin verebilirdi.

v1.1 ile:

- doğrudan owner update politikası kaldırılır,
- kullanıcı yalnızca `set_opportunity_match_status()` RPC fonksiyonuyla durum değiştirir,
- skor ve analiz alanları sistem/admin kontrolünde kalır.

## Eklenen fonksiyonlar

- `array_overlap_score()` — normalize edilmiş dizi benzerliği
- `country_match_score()` — hedef ülke uyumu
- `refresh_company_opportunity_matches()` — ihale ve distribütör skorlarını üretir
- `set_opportunity_match_status()` — güvenli durum güncellemesi

## İlk skor ağırlıkları

### Tender

- ürün anahtar kelimeleri: %40
- hedef ülke: %20
- sertifikalar: %20
- CPV kodları: %20

### Distributor

- ürün portföyü: %45
- hedef ülke: %25
- sertifikalar: %15
- şirket/partner tipi: %15

## GitHub'a yüklenecek dosyalar

```text
supabase/migrations/202607100004_match_engine_rules.sql
supabase/seeds/match_engine_demo.sql
docs/MATCH_ENGINE_V1_1.md
```

Commit mesajı:

```text
feat: add secure rule-based opportunity matching
```

## Henüz Supabase'te çalıştırma

Önce dosyaları `develop` branch'ine yükle. Ardından migration sırasını birlikte uygulayacağız:

1. `202607100003_match_engine_foundation.sql`
2. `202607100004_match_engine_rules.sql`
3. İsteğe bağlı demo seed
