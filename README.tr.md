# Task Panel

[![CI](https://github.com/m-aziz-algullu/task-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/m-aziz-algullu/task-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · **Türkçe**

Kendi sunucuna kurduğun, tek kullanıcılı bir kanban panosu. Kendi renklerinle etiketler, story point'ler, her taskın bir günü var. Biten tasklar gece yarısı panodan kalkıp gün gün listelenen bir arşive geçer.

![Pano](docs/screenshots/board-light.png)

| Koyu tema | Task detayı | Tamamlananlar (gün gün) |
| --- | --- | --- |
| ![Koyu temada pano](docs/screenshots/board-dark.png) | ![Task penceresi](docs/screenshots/task-light.png) | ![Tamamlanan tasklar](docs/screenshots/completed-dark.png) |

## Özellikler

- **Pano:** dört sabit kolon (Backlog, In Progress, Pending, Done). Kolonlar arasında ve kolon içinde sürükle-bırak; fare, dokunmatik ve klavyeyle çalışır.
- **Task:** başlık, açıklama, gün, story point (1, 2, 3, 5, 8, 13, 21) ve etiketler. Kartta etiketler, gün, `#id` ve puan görünür. Günü geçmiş açık taskların günü kırmızı yazılır.
- **Zengin metin açıklama** (Jira gibi): başlıklar, kalın/italik/altı çizili/üstü çizili, yazı rengi ve vurgu, madde ve numaralı listeler, yapılacaklar listesi, alıntı, kod, link, tablo ve ayırıcı. Markdown kısayolları (`# `, `- `, `[ ] `, `**kalın**`…), `/` ile hızlı ekleme menüsü, link için `Ctrl+K`, açmak için `Ctrl`+tık.
- **Etiketler:** isim ve istediğin renk. Panoyu etikete göre filtreleyebilir ya da metinle arayabilirsin.
- **Gün sonu:** Done'a taşınan tasklar gece yarısına kadar (`APP_TIMEZONE`'a göre) panoda kalır, sonra **Tamamlananlar** sayfasına geçer. Orada gün gün ve panodakiyle aynı kart boyutunda listelenir. Açık sekme gece yarısı kendini yeniler.
- **Türkçe ve İngilizce** arayüz. Tarayıcı diline göre seçilir, header'dan değiştirilebilir.
- Açık ve koyu tema.
- Kısayollar: `N` yeni task, `/` arama, `Ctrl+Enter` kaydet, `Esc` kapat.
- **Tek yönetici hesabı, korumalı kurulum** (aşağıda).

## Kayıt nasıl çalışır

Sadece bir hesap var. Yeni kurulumda hiç kullanıcı yokken:

1. Sunucu açılışta loglarına tek seferlik bir **kurulum kodu** basar:
   ```
   ============================================================
    Task Panel setup: no admin account yet.
    Open /register and enter this setup code:

        K7PQ-3XMA-9WRT-H2CD
   ============================================================
   ```
2. Uygulamayı açınca **Kurulum** sayfası gelir. Bu kodu, adını, e-postanı ve şifreni ister.
3. Yönetici hesabı oluştuktan sonra kurulum sayfası ve kayıt işlemi kalıcı olarak kapanır, sadece giriş kalır.

Hesabı sadece sunucu loglarını okuyabilen kişi oluşturabilir. Yani adresini senden önce bulan biri hesabı ele geçiremez. Kodu kendin belirlemek istersen `SETUP_TOKEN` ortam değişkenini ver.

**Kaba kuvvet koruması:** girişte 15 dakika içinde IP başına 10, hesap başına 50 başarısız denemeye izin verilir. Sonrasında süre dolana kadar yeni denemeler şifre kontrol edilmeden reddedilir. Kurulum kodu denemeleri de IP başına aynı şekilde sınırlıdır. Yanıtlar `Strict-Transport-Security` başlığı da gönderir; tarayıcı domain'ini bir kez HTTPS ile gördükten sonra hep HTTPS kullanır.

<img src="docs/screenshots/setup.png" alt="Kurulum sayfası" width="420">

## Hızlı başlangıç (lokal geliştirme)

Node.js 24+ gerekir.

```bash
npm install
npm run dev
```

http://localhost:3000 adresini aç ve terminalde yazan kurulum kodunu kullan. `DATABASE_URL` yoksa geliştirme ortamı `./.data/pglite` altında gömülü bir PostgreSQL ([PGlite](https://pglite.dev)) kullanır, başka bir şey kurman gerekmez. Gerçek bir Postgres kullanmak istersen `.env.example` dosyasını `.env.local` olarak kopyalayıp `DATABASE_URL` gir.

```bash
npm run lint
npm run typecheck
npm test
```

**Gömülü OpenClaw ajanı (isteğe bağlı):** ikinci bir terminalde `npm run agent:dev` çalıştır. OpenClaw Gateway'i ilk seferde `./.data/openclaw-runtime` altına kurar ve `./.data/openclaw` klasörünü HOME olarak kullanarak `127.0.0.1:18799` üzerinde açar. Kendi `~/.openclaw` klasörüne dokunmaz. Claude aboneliğini kullanması için bilgisayarında Claude Code'a giriş yap (`claude auth login`) ve `npm run agent:cli -- models auth login --provider anthropic --method cli --set-default` çalıştır; işe yarayıp yaramadığını **Ajan** sayfası gösterir.

## Kendi sunucuna kurulum

Production **sadece PostgreSQL** ile çalışır: `DATABASE_URL` yoksa sunucu açılmaz. Tablolar açılışta otomatik oluşturulur ve güncellenir.

Varsayılan Docker imajı Task Panel'le aynı container'da gömülü bir [OpenClaw](https://openclaw.ai) Gateway'i de çalıştırır:
- Gateway sadece container içinden (loopback) erişilir ve token'ını ilk açılışta kendisi üretir. Ona sadece model sağlayıcı anahtarları ve OpenClaw'ın kendi ayarları aktarılır; `DATABASE_URL` ve uygulamanın diğer değişkenleri Task Panel'de kalır.
- Ajanın hafızası, oturumları, sağlayıcı anahtarları ve skill'leri `/data` altında tutulur. **`/data`'ya bir volume bağla**, yoksa her deploy'da sıfırlanır.
- Bu imaj için en az 2 GB RAM öner.
- Ajanın tarayıcısı (Chromium) `browser.noSandbox` ve `--disable-dev-shm-usage` ile çalışır: Chromium'un kendi sandbox'ı Docker'ın vermediği izinler ister, Docker'ın `/dev/shm`'i de sadece 64 MB. Tarayıcıyı container ve root olmayan kullanıcısı yine yalıtır. Chromium'un sandbox'ını korumak istersen container'a `--cap-add=SYS_ADMIN` (ya da buna izin veren bir seccomp profili) ver ve `TASKPANEL_BROWSER_SANDBOX=on` ayarla.
- Ajan istemiyorsan daha küçük imaj için `docker build --target plain .` kullan, ya da imaj içinde `TASKPANEL_AGENT=off` ver.

### Docker Compose

```bash
POSTGRES_PASSWORD=bir-sifre-sec docker compose up -d
docker compose logs app   # kurulum kodu burada
```

Sonra http://localhost:3000 adresini aç. `app-data` volume'ü `/data`'ya bağlıdır.

### Dokploy

1. **Veritabanı:** *Create Service → Database → PostgreSQL* oluştur, deploy et ve **Internal Connection URL**'i kopyala.
2. **Uygulama:** *Create Service → Application*, bu repoyu bağla, **Build Type: Dockerfile** seç.
3. **Environment:**
   ```
   DATABASE_URL=<1. adımdaki internal URL>
   APP_TIMEZONE=Europe/Istanbul
   ```
4. **Volume:** *Advanced → Volumes → Volume Mount* altında adı `task-panel-data`, mount yolu `/data` olan bir volume ekle.
5. **Domain:** **Container Port 3000** ile domain ekle, HTTPS'i aç.
6. **Deploy** et, **Logs** sekmesinden kurulum kodunu kopyala ve domain'ini açıp yönetici hesabını oluştur.

**Yedekleme:** task'lar sunucudaki Postgres volume'ünde, ajan verisi `task-panel-data` volume'ünde durur. Dokploy'da *Settings → S3 Destinations* altında bir S3 hedefi ekle (AWS S3, Cloudflare R2, Backblaze B2 vb.), sonra veritabanının **Backups** sekmesinden zamanlanmış yedek kur (ör. her gün `0 3 * * *`).

### Ajan: Claude hesabınla giriş

Ajan, API anahtarı olmadan kendi Claude aboneliğinle, resmi Claude Code CLI üzerinden çalışabilir. Bunu sunucu başına bir kez yap; CLI ve girişi `/data` volume'unda kalır:

```bash
docker exec -it -u node <container> /srv/docker/agent-shell.sh
curl -fsSL https://claude.ai/install.sh | bash     # Claude Code'u /data altına kurar
claude auth login                                   # Anthropic'in kendi giriş akışını açar
openclaw models auth login --provider anthropic --method cli --set-default
```

Herkes kendi hesabıyla giriş yapar ve giriş her zaman Anthropic'in akışında tamamlanır; Task Panel Claude kimlik bilgilerini hiç görmez ve saklamaz. Abonelik limitleri olağan bireysel kullanıma göre belirlenir; Anthropic'in [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) sayfasına bak. Yoğun ve sürekli kullanım için bunun yerine `ANTHROPIC_API_KEY` ver.

### Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
| --- | --- | --- |
| `DATABASE_URL` | Production'da | PostgreSQL bağlantı adresi. |
| `APP_TIMEZONE` | Hayır | Günün ne zaman bittiğini belirleyen IANA saat dilimi. Varsayılan `Europe/Istanbul`. |
| `SETUP_TOKEN` | Hayır | Kendi kurulum kodun. Verilmezse kod üretilip loglara yazılır. |
| `DATABASE_POOL_SIZE` | Hayır | En fazla Postgres bağlantısı. Varsayılan `5`. |
| `PGLITE_DIR` | Hayır | Sadece geliştirme: gömülü veritabanının klasörü. |
| `TASKPANEL_AGENT` | Hayır | `off` verilirse ajan imajı OpenClaw'ı başlatmaz. |
| `TASKPANEL_BROWSER_SANDBOX` | Hayır | `on` verilirse ajanın tarayıcısı Chromium'un kendi sandbox'ıyla çalışır; container'a `SYS_ADMIN` ya da uygun bir seccomp profili gerekir. |
| `OPENCLAW_GATEWAY_TOKEN` | Hayır | Gateway token'ını kendin sabitlemek istersen. Verilmezse üretilip `/data/secrets` altında saklanır. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | Hayır | Model sağlayıcı anahtarları, OpenClaw'a aktarılır. |

Sağlık kontrolü: `GET /api/health`.

## Teknolojiler

Next.js 16 (App Router, Cache Components, Server Actions), React 19, Tailwind CSS 4, Drizzle ORM, PostgreSQL, dnd-kit. Şifreler scrypt ile hash'lenir; oturumlar rastgele token'lardır ve veritabanında SHA-256 hash'i olarak tutulur.

## Proje yapısı

```
src/app/[lang]/(panel)/        Pano ve Tamamlananlar sayfaları
src/app/[lang]/(auth)/         Kurulum (ilk yönetici), giriş, çıkış
src/app/actions.ts             Task, etiket ve taşıma Server Action'ları
src/app/api/health/            Sağlık kontrolü
docker/                        Container supervisor'ı ve gömülü OpenClaw kurulumu
scripts/agent-dev.mjs          Geliştirmede OpenClaw Gateway'i
src/proxy.ts                   Dil yönlendirmesi ve oturum çerezi kontrolü
src/i18n/                      Sözlükler (en, tr) ve yardımcılar
src/lib/db/                    Bağlantı, şema, migration'lar
src/lib/session.ts             Oturum doğrulama (veritabanından)
src/lib/auth.ts                Şifre hash'leme, oturum token'ları
src/lib/setup*.ts              Tek seferlik kurulum kodu
src/lib/rate-limit*.ts         Giriş denemesi sınırları
src/lib/dates.ts               Saat dilimine göre gün hesapları
src/components/                Arayüz
```

Şema değişiklikleri `src/lib/db/migrations.ts` dosyasına yeni bir sürüm olarak eklenir; yayınlanmış sürümler düzenlenmez.

## Lisans

[MIT](LICENSE)
