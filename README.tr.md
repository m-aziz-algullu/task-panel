# Task Panel

[![CI](https://github.com/m-aziz-algullu/task-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/m-aziz-algullu/task-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · **Türkçe**

Kendi sunucuna kurduğun, tek kullanıcılı bir kanban panosu. Kendi renklerinle etiketler, story point'ler, her taskın bir günü var. Biten tasklar gece yarısı panodan kalkıp gün gün listelenen bir arşive geçer. İstersen gömülü bir yapay zekâ ajanı ona verdiğin tasklar üzerinde çalışır.

![Pano](docs/screenshots/board-light.png)

| Koyu tema | Task detayı | Tamamlananlar (gün gün) | Bir rutin |
| --- | --- | --- | --- |
| ![Koyu temada pano](docs/screenshots/board-dark.png) | ![Task penceresi](docs/screenshots/task-light.png) | ![Tamamlanan tasklar](docs/screenshots/completed-dark.png) | ![Rutin](docs/screenshots/routine-light.png) |

## Özellikler

- **Pano:** dört sabit kolon (Backlog, In Progress, Pending, Done). Kolonlar arasında ve kolon içinde sürükle-bırak; fare, dokunmatik ve klavyeyle çalışır.
- **Task:** başlık, açıklama, gün, story point (1, 2, 3, 5, 8, 13, 21) ve etiketler. Kartta etiketler, gün, `#id` ve puan görünür. Günü geçmiş açık taskların günü kırmızı yazılır.
- **Zengin metin açıklama** (Jira gibi): başlıklar, kalın/italik/altı çizili/üstü çizili, yazı rengi ve vurgu, madde ve numaralı listeler, yapılacaklar listesi, alıntı, kod, link, tablo ve ayırıcı. Markdown kısayolları (`# `, `- `, `[ ] `, `**kalın**`…), `/` ile hızlı ekleme menüsü, link için `Ctrl+K`, açmak için `Ctrl`+tık.
- **Yorumlar:** her taskta senin, ajanın ve sistemin yorumları (örneğin bir ajan çalışmasının neden durduğu).
- **Etiketler:** isim ve istediğin renk. Panoyu etikete göre filtreleyebilir ya da metinle arayabilirsin.
- **Gün sonu:** Done'a taşınan tasklar gece yarısına kadar (`APP_TIMEZONE`'a göre) panoda kalır, sonra **Tamamlananlar** sayfasına geçer. Orada gün gün ve panodakiyle aynı kart boyutunda listelenir; son 7 ya da 30 güne veya bir aya bakabilirsin. Açık sekme gece yarısı kendini yeniler. Başka bir güne planlanmış bir taskı Done'a taşıyınca, o günde mi tamamlandı sayılacağı yoksa bugüne mi taşınacağı sorulur.
- **Rutinler:** panonun sonunda, tekrarlayan işler için bir kolon. Her rutin bir başlık ve Markdown notlardan oluşur; zamanı gelince açıp bakarsın. Task değildirler, yani durumları, günleri ya da puanları yoktur.
- **Yapay zekâ ajanı (isteğe bağlı):** varsayılan Docker imajında tasklarının üzerinde çalışan bir [OpenClaw](https://openclaw.ai) ajanı gelir. Claude aboneliğinle ya da bir model sağlayıcısının API anahtarıyla çalışır ([Kendi sunucuna kurulum](#kendi-sunucuna-kurulum) bölümüne bak).
  - Taskta **Ajana ver** bir çalışmayı kuyruğa ekler: task In Progress'e geçer, ajan raporunu yorum olarak yazar ve taskı ilerletir (varsayılan olarak Pending'e). Her çalışmanın kendi modeli, düşünme seviyesi, süre sınırı ve token bütçesi vardır (Basit, Orta ya da Zor; ajanın uyduğu yumuşak bir bütçe ya da Task Panel'in uyguladığı sert bir bütçe).
  - Seçtiğin bir etiketi eklemek taskı ajana otomatik verir. Ajanın üzerinde çalıştığı bir taska yazdığın yorum aynı konuşmayı sürdürür.
  - **Ajanla konuş** bir sohbet penceresi açar: ona kendinden ve tercihlerinden bahsedebilir ya da dosya gönderebilirsin (en fazla 5 dosya, her biri 10 MB); kalıcı olanları hafızasına kaydeder.
  - **Ajan** sayfası bağlantıyı ve Claude girişini gösterir, varsayılanları tutar (model, bütçeler, aynı anda kaç çalışma olacağı, biten ya da takılan taskların nereye gideceği, kalıcı talimatlar) ve OpenClaw'ın kendi arayüzünü açar.
- **Türkçe ve İngilizce** arayüz. Tarayıcı diline göre seçilir, header'dan değiştirilebilir.
- Açık ve koyu tema.
- Kısayollar: `N` yeni task, `/` arama, `Ctrl+Enter` kaydet, `Esc` kapat.
- **Tek yönetici hesabı, korumalı kurulum** (aşağıda).

## Ajan iş başında

Ajana verilen bir task (burada *Agent* etiketiyle) bir çalıştırma başlatır; ajan raporunu yorum olarak yazar ve taskı ilerletir. Yorumlarda cevap yazarak aynı konuşmaya devam edebilirsin.

![Ajanın bir taska yazdığı rapor](docs/screenshots/agent-run-light.png)

| Ajan sayfası | Sohbet penceresi |
| --- | --- |
| ![Ajan sayfası](docs/screenshots/agent-light.png) | ![Ajan sohbet penceresi](docs/screenshots/chat-dark.png) |

**OpenClaw'ın kendi arayüzünde** (Ajan sayfası → *OpenClaw arayüzünü aç*) ajanla doğrudan konuşabilir, yeni ajanlar oluşturabilir, her ajanın tool'larını ve skill'lerini seçebilirsin.

| OpenClaw'da sohbet | Ajanların |
| --- | --- |
| ![OpenClaw'da sohbet](docs/screenshots/openclaw-chat.png) | ![OpenClaw'da ajanlar](docs/screenshots/openclaw-agents.png) |
| **Bir ajanın tool'ları** | **Bir ajanın skill'leri** |
| ![Ajan tool'ları](docs/screenshots/openclaw-tools.png) | ![Ajan skill'leri](docs/screenshots/openclaw-skills.png) |

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

**Gömülü OpenClaw ajanı (isteğe bağlı):** ikinci bir terminalde `npm run agent:dev` çalıştır. OpenClaw Gateway'i ilk seferde `./.data/openclaw-runtime` altına kurar ve `./.data/openclaw` klasörünü HOME olarak kullanarak `127.0.0.1:18799` üzerinde açar. Kendi `~/.openclaw` klasörüne dokunmaz. Claude aboneliğini kullanması için bilgisayarında Claude Code'a giriş yap (`claude auth login`) ve `npm run agent:cli -- models auth login --provider anthropic --method cli --set-default` çalıştır, ardından `npm run agent:cli -- config set agents.defaults.models.anthropic/claude-sonnet-5-5.agentRuntime.id claude-cli` ve `npm run agent:cli -- models set anthropic/claude-sonnet-5-5` ile Sonnet 5.5'i seç; işe yarayıp yaramadığını **Ajan** sayfası gösterir.

## Kendi sunucuna kurulum

Production **sadece PostgreSQL** ile çalışır: `DATABASE_URL` yoksa sunucu açılmaz. Tablolar açılışta otomatik oluşturulur ve güncellenir.

Varsayılan Docker imajı Task Panel'le aynı container'da gömülü bir [OpenClaw](https://openclaw.ai) Gateway'i de çalıştırır:
- Gateway sadece container içinden (loopback) erişilir ve token'ını ilk açılışta kendisi üretir. Ona sadece model sağlayıcı anahtarları ve OpenClaw'ın kendi ayarları aktarılır; `DATABASE_URL` ve uygulamanın diğer değişkenleri Task Panel'de kalır.
- OpenClaw'ın kendi web arayüzü (Control UI: ayarlar, oturumlar, ajanlar, dosyalar) **Ajan** sayfasındaki **OpenClaw arayüzünü aç** butonuyla açılır. Task Panel'in kendi adresinde `/openclaw/` altında, sadece giriş yapmış kullanıcıya sunulur; SSH tüneli ya da ek port gerekmez. Task Panel'in her açılışta yazdığı ayarlar (o sayfada listelenir) orada değiştirilse de kalıcı olmaz.
- Ajanın hafızası, oturumları, sağlayıcı anahtarları ve skill'leri `/data` altında tutulur. **`/data`'ya bir volume bağla**, yoksa her deploy'da sıfırlanır.
- Bu imaj için en az 2 GB RAM öner.
- Ajanın tarayıcısı (Chromium) `browser.noSandbox` ve `--disable-dev-shm-usage` ile çalışır: Chromium'un kendi sandbox'ı Docker'ın vermediği izinler ister, Docker'ın `/dev/shm`'i de sadece 64 MB. Tarayıcıyı container ve root olmayan kullanıcısı yine yalıtır. Chromium'un sandbox'ını korumak istersen container'a `--cap-add=SYS_ADMIN` (ya da buna izin veren bir seccomp profili) ver ve `TASKPANEL_BROWSER_SANDBOX=on` ayarla.
- Her model çağrısı küçük kalsın diye ajana sadece Task Panel'in işine yarayan araçlar verilir (`tools.allow`: dosyalar, shell, `web_search`, `web_fetch`, hafıza, hedefler, PDF, görsel ve skill'ler; tarayıcı, oturumlar, canvas ve medya üretimi yok). OpenClaw'la gelen skill'lerden birkaçı açık kalır (`skills.allowBundled`; senin kurduğun skill'ler etkilenmez). Sonnet 5.5 ve Opus 5.5 için bağlam 150k token'la sınırlıdır (`models.providers.anthropic.models[].contextTokens`); Claude Code konuşmayı bu noktada sıkıştırır. Bunlar her açılışta yeniden yazılır; ajana daha fazlasını vermek için `docker/openclaw-bootstrap.mjs` içindeki `managedConfig`'i değiştir.
- Ajan web'de OpenClaw'ın `web_search` aracıyla arar, sayfaları `web_fetch` ile okur. Her açılışta Parallel eklentisi (`@openclaw/parallel-plugin`, OpenClaw ile aynı versiyon) eksikse kurulur, hiçbir arama sağlayıcısı seçili değilse anahtarsız `parallel-free` seçilir. Kendin seçtiğin bir sağlayıcı (`tools.web.search.provider`) korunur.
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
openclaw config set agents.defaults.models.anthropic/claude-sonnet-5-5.agentRuntime.id claude-cli
openclaw models set anthropic/claude-sonnet-5-5    # ajan Sonnet 5.5 ile çalışır
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

Next.js 16 (App Router, Cache Components, Server Actions), React 19, Tailwind CSS 4, Drizzle ORM, PostgreSQL, dnd-kit, TipTap ve ajan için [OpenClaw](https://openclaw.ai). Şifreler scrypt ile hash'lenir; oturumlar rastgele token'lardır ve veritabanında SHA-256 hash'i olarak tutulur.

## Proje yapısı

```
src/app/[lang]/(panel)/        Pano, Tamamlananlar ve Ajan sayfaları
src/app/[lang]/(auth)/         Kurulum (ilk yönetici), giriş, çıkış
src/app/actions.ts             Task, yorum, etiket, rutin ve ajan çalışması Server Action'ları
src/app/api/health/            Sağlık kontrolü
src/app/api/agent/             Ajan sohbeti, Claude giriş durumu, çalışma seçenekleri, Control UI oturumu
docker/                        Container supervisor'ı, gömülü OpenClaw kurulumu, Control UI proxy'si
scripts/agent-dev.mjs          Geliştirmede OpenClaw Gateway'i
src/proxy.ts                   Dil yönlendirmesi ve oturum çerezi kontrolü
src/i18n/                      Sözlükler (en, tr) ve yardımcılar
src/lib/db/                    Bağlantı, şema, migration'lar
src/lib/session.ts             Oturum doğrulama (veritabanından)
src/lib/auth.ts                Şifre hash'leme, oturum token'ları
src/lib/setup*.ts              Tek seferlik kurulum kodu
src/lib/rate-limit*.ts         Giriş denemesi sınırları
src/lib/dates.ts               Saat dilimine göre gün hesapları
src/lib/rich-text/             Açıklama şeması, her kayıtta kontrol edilir
src/lib/agent/                 Ajan çalışma kuyruğu ve worker'ı, prompt'lar, sohbet, ayarlar
src/lib/openclaw/              OpenClaw Gateway bağlantısı
src/components/                Arayüz
```

Şema değişiklikleri `src/lib/db/migrations.ts` dosyasına yeni bir sürüm olarak eklenir; yayınlanmış sürümler düzenlenmez.

## Lisans

[MIT](LICENSE)
