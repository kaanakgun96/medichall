# MedicHall Sprint 0 — Secure AI Patch

Bu paket `develop` branch'indeki mevcut AI altyapısını güvenli sürüme yükseltir.

## GitHub'a yüklenecek dosyalar

- `supabase/functions/medichall-ai/index.ts` (mevcut dosyanın üzerine yaz)
- `supabase/migrations/202607100002_secure_ai_limits.sql` (yeni dosya)
- `supabase/config.toml` (yeni dosya)

## Bu sürümde gelen korumalar

- Giriş yapmamış kullanıcılar için 401 engeli
- Supabase Auth ile gerçek kullanıcı doğrulaması
- Kullanıcı başına günlük 20 AI isteği (secret ile değiştirilebilir)
- Paralel isteklerde limiti aşmayı engelleyen atomik SQL rezervasyonu
- 12.000 karakter giriş ve 1.500 karakter talimat sınırı
- İzin verilen görev modları
- Yalnızca MedicHall alan adlarından browser çağrısı
- OpenAI Responses API kullanımı
- Başarılı / başarısız kullanım logları
- OpenAI anahtarının yalnızca Supabase Edge Function secret'ında tutulması

## Şimdilik yapma

GitHub commit'i kontrol edilmeden SQL migration'ı çalıştırma ve function deploy etme.
