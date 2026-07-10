# MedicHall Match Engine v1

Bu sprint yalnızca veri modelini ve güvenli erişim temelini kurar. Canlı portal arayüzünü henüz değiştirmez.

## Eklenen çekirdek yapılar

- `company_match_profiles`: üreticinin hedef ülkeleri, ürün anahtar kelimeleri, CPV kodları ve sertifikaları
- `tenders`: TED ve diğer resmi kaynaklardan gelen ihale kayıtları
- `distributor_candidates`: doğrulanacak distribütör / partner adayları
- `opportunity_matches`: ihale ve distribütör eşleşmelerinin tek skor tablosu
- `calculate_keyword_overlap_score`: ilk kurallı eşleştirme motorunun yardımcı fonksiyonu

## Skor yaklaşımı

İlk sürümde toplam skor dört ana bileşenden oluşacak:

- Ürün / anahtar kelime uyumu: %40
- Ülke / hedef pazar uyumu: %20
- Sertifika uyumu: %20
- Kategori / kanal uyumu: %20

AI daha sonra aynı kaydı `ai_summary`, `reasons`, `risks` ve `confidence_score` alanlarıyla zenginleştirecek. Bu sayede temel sonuçlar AI olmadan da üretilebilir; API maliyeti yalnızca değerli eşleşmelerde kullanılır.

## GitHub yükleme

`develop` branch'ine şu dosyaları yükle:

- `supabase/migrations/202607100003_match_engine_foundation.sql`
- `docs/MATCH_ENGINE_V1.md`

Commit mesajı:

`feat: add matchmaking data foundation`

## Önemli

Henüz Supabase SQL Editor'da çalıştırma. Önce repository yüklemesini ve mevcut şema ile uyumluluğu kontrol edeceğiz.
